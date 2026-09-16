export type TwilioCredentials =
  | { ok: true; accountSid: string; authHeader: string }
  | { ok: false; error: "TWILIO_NOT_CONFIGURED" };

export function twilioCredentials(): TwilioCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) {
    return { ok: false, error: "TWILIO_NOT_CONFIGURED" };
  }
  return {
    ok: true,
    accountSid,
    authHeader: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
  };
}
