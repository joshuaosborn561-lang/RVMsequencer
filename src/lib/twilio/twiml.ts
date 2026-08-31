import { toE164 } from "@/lib/phone";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** TwiML that dials your direct line.
 * Uses the Twilio DID as callerId (not the lead) so your phone recognizes
 * the business line and Silence Unknown Callers / spam filters don't dump
 * callbacks straight to voicemail. answerOnBridge keeps the lead on hold
 * with ringtone until you pick up.
 */
export function dialForwardTwiml(input: {
  forwardToE164: string;
  /** Inbound From (lead) — kept for logging / whisper, not used as callerId */
  leadE164?: string;
  /** Twilio DID that was dialed — used as callerId on the forward leg */
  didE164?: string;
  timeoutSec?: number;
}): string {
  const to = toE164(input.forwardToE164) ?? input.forwardToE164;
  const timeout = Math.min(120, Math.max(15, input.timeoutSec ?? 45));
  // Prefer DID as caller ID so your handset sees a known business number.
  const callerId =
    (input.didE164 && toE164(input.didE164)) ||
    (input.leadE164 && toE164(input.leadE164)) ||
    undefined;

  const callerAttr = callerId ? ` callerId="${xmlEscape(callerId)}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${timeout}" answerOnBridge="true"${callerAttr}>
    <Number>${xmlEscape(to)}</Number>
  </Dial>
</Response>`;
}

export function sayTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${xmlEscape(message)}</Say>
  <Hangup/>
</Response>`;
}

export function emptyTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}
