import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validate Twilio request signature.
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
export function isValidTwilioSignature(input: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!input.signature) return false;
  const data =
    input.url +
    Object.keys(input.params)
      .sort()
      .reduce((acc, key) => acc + key + input.params[key], "");
  const digest = createHmac("sha1", input.authToken).update(data, "utf8").digest("base64");
  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(input.signature);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function twilioAuthConfigured(): boolean {
  return Boolean(process.env.TWILIO_AUTH_TOKEN);
}
