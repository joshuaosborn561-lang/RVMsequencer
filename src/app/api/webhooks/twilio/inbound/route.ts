import { NextResponse } from "next/server";
import {
  addInboxMessage,
  listCampaigns,
  resolveCallForwardTo,
  suppressLeadByPhone,
} from "@/lib/store/db";
import {
  isValidTwilioSignature,
  twilioAuthConfigured,
} from "@/lib/twilio/validate";
import {
  dialForwardTwiml,
  emptyTwiml,
  sayTwiml,
} from "@/lib/twilio/twiml";

/**
 * Twilio voice/SMS inbound → Master Inbox + call forward to your direct line.
 * Idempotent on CallSid/MessageSid. Signature-checked when TWILIO_AUTH_TOKEN is set.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let from = "";
  let to = "";
  let body = "";
  let callSid = "";
  let messageSid = "";
  let channel: "VOICE_CALLBACK" | "SMS" = "VOICE_CALLBACK";
  const params: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      params[k] = String(v);
    }
    from = params.From ?? "";
    to = params.To ?? "";
    callSid = params.CallSid ?? "";
    messageSid = params.MessageSid ?? params.SmsSid ?? "";
    if (messageSid || "Body" in params) {
      channel = "SMS";
      body = params.Body ?? "";
    } else {
      channel = "VOICE_CALLBACK";
      body = `Inbound callback · CallSid ${callSid || "unknown"} · status ${params.CallStatus ?? "ringing"}`;
    }
    // Voice webhooks have CallSid and no MessageSid
    if (callSid && !messageSid) {
      channel = "VOICE_CALLBACK";
      body = `Inbound callback · CallSid ${callSid} · status ${params.CallStatus ?? "ringing"}`;
    }
  } else {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    from = String(json.From ?? json.from ?? "");
    to = String(json.To ?? json.to ?? "");
    body = String(json.Body ?? json.body ?? "Inbound event");
    callSid = String(json.CallSid ?? "");
    messageSid = String(json.MessageSid ?? "");
    if (json.Body || json.body || messageSid) channel = "SMS";
  }

  if (twilioAuthConfigured() && contentType.includes("application/x-www-form-urlencoded")) {
    const signature = req.headers.get("x-twilio-signature");
    const url = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/twilio/inbound`
      : req.url;
    const ok = isValidTwilioSignature({
      authToken: process.env.TWILIO_AUTH_TOKEN!,
      signature,
      url,
      params,
    });
    if (!ok && process.env.NODE_ENV === "production") {
      return new NextResponse("invalid signature", { status: 403 });
    }
  }

  if (!from || !to) {
    return NextResponse.json({ error: "missing_from_to" }, { status: 400 });
  }

  const providerEventId = callSid || messageSid || undefined;

  if (channel === "VOICE_CALLBACK") {
    const forward = await resolveCallForwardTo();
    const note = forward.e164
      ? `${body} · forwarding → ${forward.e164}`
      : `${body} · forward not configured`;

    await addInboxMessage({
      fromE164: from,
      toE164: to,
      channel,
      body: note,
      category: "CALLBACK",
      providerEventId,
    });

    const stopOnCallback = (await listCampaigns()).some(
      (c) =>
        (c.status === "ACTIVE" || c.status === "PAUSED") &&
        c.schedule.stopOnCallback,
    );
    if (stopOnCallback) {
      await suppressLeadByPhone(from, "CALLBACK", {
        source: "CALLBACK",
        markDnc: true,
      });
    }

    if (!forward.e164) {
      return new NextResponse(
        sayTwiml(
          "This number is not accepting callbacks right now. Please try again later.",
        ),
        { headers: { "content-type": "text/xml" } },
      );
    }

    return new NextResponse(
      dialForwardTwiml({
        forwardToE164: forward.e164,
        leadE164: from,
        didE164: to,
        timeoutSec: forward.timeoutSec,
      }),
      { headers: { "content-type": "text/xml" } },
    );
  }

  const isStop = /^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i.test(body);
  const { message } = await addInboxMessage({
    fromE164: from,
    toE164: to,
    channel,
    body,
    category: isStop ? "DNC" : "UNREAD",
    providerEventId,
  });

  if (isStop) {
    await suppressLeadByPhone(from, "SMS_STOP", {
      optOut: true,
      markDnc: true,
      source: "SMS_STOP",
    });
  }

  return new NextResponse(emptyTwiml(), {
    headers: {
      "content-type": "text/xml",
      "x-inbox-id": message.id,
    },
  });
}
