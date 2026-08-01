import { NextResponse } from "next/server";
import { addInboxMessage } from "@/lib/store/db";

/**
 * Twilio voice/SMS inbound → Master Inbox.
 * Point the DID's Voice URL / Messaging URL here when live.
 * Validates optional TWILIO_AUTH_TOKEN signature later; accepts form posts now.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  let from = "";
  let to = "";
  let body = "";
  let channel: "VOICE_CALLBACK" | "SMS" = "VOICE_CALLBACK";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await req.formData();
    from = String(form.get("From") ?? "");
    to = String(form.get("To") ?? "");
    const sms = form.get("Body");
    if (sms != null) {
      channel = "SMS";
      body = String(sms);
    } else {
      body = `Inbound call · CallSid ${String(form.get("CallSid") ?? "unknown")} · status ${String(form.get("CallStatus") ?? "")}`;
    }
  } else {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    from = String(json.From ?? json.from ?? "");
    to = String(json.To ?? json.to ?? "");
    body = String(json.Body ?? json.body ?? "Inbound event");
    if (json.Body || json.body) channel = "SMS";
  }

  if (!from || !to) {
    return NextResponse.json({ error: "missing_from_to" }, { status: 400 });
  }

  const message = await addInboxMessage({
    fromE164: from,
    toE164: to,
    channel,
    body,
    category: "UNREAD",
  });

  // TwiML empty response so Twilio doesn't retry voice; SMS gets empty 200.
  if (channel === "VOICE_CALLBACK") {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { headers: { "content-type": "text/xml" } },
    );
  }

  return NextResponse.json({ ok: true, id: message.id });
}
