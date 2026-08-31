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
 * Dial Allo for an inbound callback on a campaign DID.
 *
 * Evidence (Twilio Call events, 2026-08-31):
 *   Dial to +12149107558 completes in 2–7s with dial_call_status=completed
 *   and dial_bridged=true — Allo (or its VM/AI) is ANSWERING, not timing out.
 *   TwiML was using callerId=<lead>. Unknown/spam From is the usual reason a
 *   VOIP line rings once then dumps to voicemail.
 *
 * Rules:
 * - callerId MUST be the Twilio DID (Twilio only allows account numbers /
 *   verified IDs; DID also looks like a known business line to Allo)
 * - answerOnBridge so the lead hears ring until Allo actually answers
 * - optional whisperUrl announces the lead number to the Allo user after answer
 * - timeout ≥ Allo ring window (fallback only; live failures are early-answer)
 */
export function dialForwardTwiml(input: {
  forwardToE164: string;
  /** Lead who called — whispered to Allo, NOT used as callerId */
  leadE164?: string;
  /** Campaign DID — required callerId on the Dial leg */
  didE164?: string;
  timeoutSec?: number;
  /** Number url: whisper and/or press-1 before bridge */
  screenUrl?: string;
}): string {
  const to = toE164(input.forwardToE164) ?? input.forwardToE164;
  const timeout = Math.min(120, Math.max(45, input.timeoutSec ?? 90));
  // ONLY the DID — never the lead. Invalid/spam From → Allo one-ring-to-VM.
  const callerId = (input.didE164 && toE164(input.didE164)) || undefined;

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

/**
 * Runs on Allo's leg after answer, before bridge.
 * Default: whisper the lead number then connect (no digit required).
 * Opt-in press-1: set requireAccept on the webhook query string.
 */
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
