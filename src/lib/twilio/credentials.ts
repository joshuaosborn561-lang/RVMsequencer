export type TwilioCredentials =
  | { ok: true; accountSid: string; authHeader: string }
  | { ok: false; error: "TWILIO_NOT_CONFIGURED" };

/**
 * URL path needs the Account SID (`AC…`).
 * Auth may be Account SID + Auth Token, or API Key SID (`SK…`) + secret.
 */
export function twilioCredentials(): TwilioCredentials {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  if (!accountSid || !accountSid.startsWith("AC")) {
    return { ok: false, error: "TWILIO_NOT_CONFIGURED" };
  }
  const user = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
  const pass = apiKeySid && apiKeySecret ? apiKeySecret : authToken;
  if (!pass) return { ok: false, error: "TWILIO_NOT_CONFIGURED" };
  return {
    ok: true,
    accountSid,
    authHeader: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
  };
}
