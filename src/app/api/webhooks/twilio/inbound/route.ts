import { NextResponse } from "next/server";
import { addInboxMessage, resolveCallForwardTo } from "@/lib/store/db";
import {
  dialForwardTwiml,
  emptyTwiml,
  sayTwiml,
} from "@/lib/twilio/twiml";

/**
 * Twilio voice/SMS inbound → Master Inbox + call forward to your direct line.
 *
 * Point each DID's Voice URL + Messaging URL here:
 *   POST $NEXT_PUBLIC_APP_URL/api/webhooks/twilio/inbound
 *
 * Set CALL_FORWARD_TO_E164 (env) or save the number under Go live / settings.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let from = "";
  let to = "";
  let body = "";
  let callSid = "";
  let channel: "VOICE_CALLBACK" | "SMS" = "VOICE_CALLBACK";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    from = String(form.get("From") ?? "");
    to = String(form.get("To") ?? "");
    callSid = String(form.get("CallSid") ?? "");
    const sms = form.get("Body");
    if (sms != null) {
      channel = "SMS";
      body = String(sms);
    } else {
      body = `Inbound callback · CallSid ${callSid || "unknown"} · status ${String(form.get("CallStatus") ?? "ringing")}`;
    }
  } else {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    from = String(json.From ?? json.from ?? "");
    to = String(json.To ?? json.to ?? "");
    body = String(json.Body ?? json.body ?? "Inbound event");
    callSid = String(json.CallSid ?? "");
    if (json.Body || json.body) channel = "SMS";
  }

  if (!from || !to) {
    return NextResponse.json({ error: "missing_from_to" }, { status: 400 });
  }

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
    });

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

  // SMS — log only (no forward)
  const message = await addInboxMessage({
    fromE164: from,
    toE164: to,
    channel,
    body,
    category: "UNREAD",
  });

  return new NextResponse(emptyTwiml(), {
    headers: {
      "content-type": "text/xml",
      "x-inbox-id": message.id,
    },
  });
}
