import { toE164 } from "@/lib/phone";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** TwiML that dials your direct line and preserves the lead as caller ID when possible. */
export function dialForwardTwiml(input: {
  forwardToE164: string;
  /** Inbound From (lead) — shown on your phone when Twilio allows */
  leadE164?: string;
  /** Twilio DID that was dialed */
  didE164?: string;
  timeoutSec?: number;
}): string {
  const to = toE164(input.forwardToE164) ?? input.forwardToE164;
  const timeout = Math.min(120, Math.max(5, input.timeoutSec ?? 30));
  const callerId =
    (input.leadE164 && toE164(input.leadE164)) ||
    (input.didE164 && toE164(input.didE164)) ||
    undefined;

  const callerAttr = callerId ? ` callerId="${xmlEscape(callerId)}"` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${timeout}"${callerAttr}>
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
