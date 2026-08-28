import { NextResponse } from "next/server";
import {
  resolveOwnerFromDid,
  syncCallbackIfClientOptedIn,
} from "@/lib/integrations/callback-hubspot";
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
 * Voice callbacks (+ SMS callback intent) sync to HubSpot when the owning client opted in.
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
    const configuredUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/twilio/inbound`
      : "";
    const candidates = [configuredUrl, req.url].filter(Boolean);
    const ok = candidates.some((url) =>
      isValidTwilioSignature({
        authToken: process.env.TWILIO_AUTH_TOKEN!,
        signature,
        url,
        params,
      }),
    );
    // Fail-open: still forward so callbacks ring through; log bad signatures.
    if (!ok) {
      console.warn("[twilio] invalid signature — still forwarding", {
        from,
        to,
        callSid,
      });
    }
  }

  if (!from || !to) {
    return NextResponse.json({ error: "missing_from_to" }, { status: 400 });
  }

  const providerEventId = callSid || messageSid || undefined;
  const owner = await resolveOwnerFromDid(to);

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
      campaignId: owner.campaignId,
      clientId: owner.clientId,
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

    void syncCallbackIfClientOptedIn({
      phoneE164: from,
      didE164: to,
      channel: "VOICE_CALLBACK",
      body: note,
      providerEventId,
      campaignId: owner.campaignId,
      clientId: owner.clientId,
    }).catch((err) => console.error("[hubspot] voice callback sync failed", err));

    if (!forward.e164) {
      return new NextResponse(
        sayTwiml(
          "This number is not accepting callbacks right now. Please try again later.",
        ),
        { headers: { "content-type": "text/xml" } },
      );
    }

    void import("@/lib/supabase/rvm-sync")
      .then(({ insertRvmCallback }) =>
        insertRvmCallback({
          call_sid: callSid || undefined,
          from_phone: from,
          to_did: to,
          forward_to: forward.e164 ?? undefined,
          channel: "VOICE_CALLBACK",
          category: "CALLBACK",
          body: note,
          raw: { params },
        }),
      )
      .catch((err) => console.error("[supabase] insertRvmCallback failed", err));

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
  const isCallbackSms =
    !isStop &&
    /\b(call\s*back|callback|call\s*me|interested|please\s*call)\b/i.test(body);

  const { message } = await addInboxMessage({
    fromE164: from,
    toE164: to,
    channel,
    body,
    category: isStop ? "DNC" : isCallbackSms ? "CALLBACK" : "UNREAD",
    providerEventId,
    campaignId: owner.campaignId,
    clientId: owner.clientId,
  });

  if (isStop) {
    await suppressLeadByPhone(from, "SMS_STOP", {
      optOut: true,
      markDnc: true,
      source: "SMS_STOP",
    });
  }

  if (isCallbackSms) {
    void syncCallbackIfClientOptedIn({
      phoneE164: from,
      didE164: to,
      channel: "SMS",
      body,
      providerEventId,
      campaignId: owner.campaignId,
      clientId: owner.clientId,
    }).catch((err) => console.error("[hubspot] sms callback sync failed", err));
  }

  return new NextResponse(emptyTwiml(), {
    headers: {
      "content-type": "text/xml",
      "x-inbox-id": message.id,
    },
  });
}
