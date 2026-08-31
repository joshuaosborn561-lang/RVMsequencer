/**
 * Point a Twilio IncomingPhoneNumber at RVM Drop webhooks / call-forward.
 * @see https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
 *
 * Primary VoiceUrl = app inbound (Dial → Allo with answerOnBridge + press-1).
 * Twimlets forward is VoiceFallbackUrl only — used if the app is down.
 * Do NOT use Twimlets as primary: it bridges into Allo voicemail with no screening.
 */
export async function configureTwilioNumberWebhooks(input: {
  phoneNumberSid?: string;
  e164?: string;
}): Promise<{ ok: boolean; sid?: string; voiceUrl?: string; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (!accountSid || !authToken) {
    return { ok: false, error: "TWILIO_NOT_CONFIGURED" };
  }
  if (!appUrl) {
    return { ok: false, error: "NEXT_PUBLIC_APP_URL_MISSING" };
  }

  const { resolveCallForwardTo } = await import("@/lib/store/db");
  const forward = await resolveCallForwardTo();
  const forwardDigits = (forward.e164 || "").replace(/\D/g, "") || "12149107558";
  // Twimlets default Dial timeout is ~20s — Allo reports "dropped while ringing".
  const timeout = Math.max(forward.timeoutSec ?? 90, 90);
  const twimlet = `http://twimlets.com/forward?PhoneNumber=${forwardDigits}&Timeout=${timeout}`;
  const inboundUrl = `${appUrl}/api/webhooks/twilio/inbound`;
  const statusUrl = `${appUrl}/api/webhooks/twilio/status`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  let sid = input.phoneNumberSid;
  if (!sid && input.e164) {
    const qs = new URLSearchParams({ PhoneNumber: input.e164 });
    const listRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?${qs}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    const list = (await listRes.json()) as {
      incoming_phone_numbers?: { sid: string }[];
      message?: string;
    };
    sid = list.incoming_phone_numbers?.[0]?.sid;
    if (!sid) {
      return {
        ok: false,
        error: list.message || "NUMBER_NOT_IN_TWILIO_ACCOUNT",
      };
    }
  }
  if (!sid) return { ok: false, error: "SID_OR_E164_REQUIRED" };

  const body = new URLSearchParams({
    // App first: proper Dial (answerOnBridge + DID callerId) + inbox logging
    VoiceUrl: inboundUrl,
    VoiceMethod: "POST",
    VoiceFallbackUrl: twimlet,
    VoiceFallbackMethod: "GET",
    SmsUrl: inboundUrl,
    SmsMethod: "POST",
    StatusCallback: statusUrl,
    StatusCallbackMethod: "POST",
    VoiceApplicationSid: "",
    TrunkSid: "",
  });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${sid}.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  const json = (await res.json()) as {
    sid?: string;
    voice_url?: string;
    message?: string;
  };
  if (!res.ok) {
    return { ok: false, sid, error: json.message || `HTTP_${res.status}` };
  }
  return { ok: true, sid: json.sid, voiceUrl: json.voice_url };
}
