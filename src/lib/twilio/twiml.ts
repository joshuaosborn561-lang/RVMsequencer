import { toE164 } from "@/lib/phone";

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Simple call forward to Allo / handset.
 * Omit callerId so Twilio passes the inbound lead From (official Dial default).
 */
export function dialForwardTwiml(input: {
  forwardToE164: string;
  leadE164?: string;
  didE164?: string;
  timeoutSec?: number;
  /** @deprecated unused — keep signature for callers */
  screenUrl?: string;
}): string {
  const to = toE164(input.forwardToE164) ?? input.forwardToE164;
  const timeout = Math.min(120, Math.max(45, input.timeoutSec ?? 90));
  // No callerId → Twilio shows the original inbound From (the lead).
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${timeout}" answerOnBridge="true" ringTone="us">
    <Number>${xmlEscape(to)}</Number>
  </Dial>
</Response>`;
}

export function forwardScreenGatherTwiml(input: {
  leadE164?: string;
  requireAccept?: boolean;
}): string {
  const lead = input.leadE164 ? toE164(input.leadE164) : undefined;
  const who = lead ? ` from ${xmlEscape(lead)}` : "";
  if (!input.requireAccept) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">RVM callback${who}.</Say>
</Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" timeout="10" actionOnEmptyResult="true">
    <Say voice="Polly.Joanna">RVM callback${who}. Press 1 to connect.</Say>
  </Gather>
  <Hangup/>
</Response>`;
}

export function forwardScreenResultTwiml(digits: string | undefined): string {
  if ((digits ?? "").trim() === "1") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Not connecting. Goodbye.</Say>
  <Hangup/>
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
