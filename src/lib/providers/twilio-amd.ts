import type { DeliveryResult, RvmDeliveryProvider, SendRvmInput } from "./types";

/**
 * Twilio AMD leave-a-message adapter (NOT true ringless).
 * Phone rings; on machine_end_* play audioUrl; on human hang up or route elsewhere.
 *
 * Requires TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN and a public status + TwiML URL.
 * This scaffold returns a clear "not configured" result until wired.
 */
export function createTwilioAmdProvider(config: {
  accountSid?: string;
  authToken?: string;
  twimlUrl?: string;
  statusCallbackUrl?: string;
}): RvmDeliveryProvider {
  return {
    id: "TWILIO_AMD",
    supportsTrueRingless: false,
    async send(input: SendRvmInput): Promise<DeliveryResult> {
      if (!config.accountSid || !config.authToken || !config.twimlUrl) {
        return {
          ok: false,
          status: "failed",
          errorCode: "TWILIO_NOT_CONFIGURED",
          errorDetail:
            "Set Twilio credentials + TwiML URL. AMD path rings the handset (not RVM).",
        };
      }

      if (!input.audioUrl) {
        return {
          ok: false,
          status: "failed",
          errorCode: "NO_AUDIO_URL",
          errorDetail: "Twilio AMD requires a public audioUrl",
        };
      }

      // Lazy require so the UI scaffold builds without live credentials.
      const twilio = await import("twilio");
      const client = twilio.default(config.accountSid, config.authToken);
      const call = await client.calls.create({
        to: input.toE164,
        from: input.fromE164,
        url: `${config.twimlUrl}?audioUrl=${encodeURIComponent(input.audioUrl)}`,
        machineDetection: "DetectMessageEnd",
        asyncAmd: "true",
        statusCallback: config.statusCallbackUrl,
        statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      });

      return {
        ok: true,
        status: "queued",
        providerMessageId: call.sid,
        costEstimateUsd: 0.03,
        raw: { note: "AMD attempt queued — not ringless" },
      };
    },
  };
}
