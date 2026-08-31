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
 * Dial the Allo / forward line for an inbound callback on a campaign DID.
 *
 * Live symptom Allo reports: "dropped while ringing" — that is our <Dial>
 * timeout cancelling the B-leg while Allo is still ringing. Twimlets forward
 * defaults to ~20s; Allo's ring step is often 30–60s. Keep timeout ≥ Allo ring.
 *
 * - answerOnBridge: lead hears ringtone until Allo accepts
 * - lead as callerId: Allo can match CRM contact
 * - screenUrl (optional press-1): only after Allo answers; off by default
 */
export function dialForwardTwiml(input: {
  forwardToE164: string;
  /** Inbound From (lead) — preferred callerId so Allo shows the contact */
  leadE164?: string;
  /** Twilio DID that was dialed — fallback callerId */
  didE164?: string;
  timeoutSec?: number;
  /** When set, Number url runs press-1 screening before bridge */
  screenUrl?: string;
}): string {
  const to = toE164(input.forwardToE164) ?? input.forwardToE164;
  const timeout = Math.min(120, Math.max(45, input.timeoutSec ?? 90));
  // Prefer lead CID for Allo CRM match; DID only if lead missing.
  const callerId =
    (input.leadE164 && toE164(input.leadE164)) ||
    (input.didE164 && toE164(input.didE164)) ||
    undefined;

  const callerAttr = callerId ? ` callerId="${xmlEscape(callerId)}"` : "";
  const screenAttr = input.screenUrl
    ? ` url="${xmlEscape(input.screenUrl)}" method="POST"`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="${timeout}" answerOnBridge="true" ringTone="us"${callerAttr}>
    <Number${screenAttr}>${xmlEscape(to)}</Number>
  </Dial>
</Response>`;
}

/** Whisper on the Allo/callee leg — press 1 or we hang up (blocks Allo VM bridge). */
export function forwardScreenGatherTwiml(input?: { leadE164?: string }): string {
  const who = input?.leadE164
    ? ` from ${xmlEscape(input.leadE164)}`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" timeout="10" actionOnEmptyResult="true">
    <Say voice="Polly.Joanna">RVM callback${who}. Press 1 to connect.</Say>
  </Gather>
  <Hangup/>
</Response>`;
}

/** After Gather — connect only on digit 1. */
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
