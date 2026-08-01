import type { DeliveryResult, RvmDeliveryProvider, SendRvmInput } from "./types";

const DEFAULT_URL = "https://www.slybroadcast.com/gateway/vmb.json.php";

/**
 * Slybroadcast JSON gateway — cheapest well-documented RVM API with caller ID.
 * Docs: https://www.slybroadcast.com/documentationjson.php (updated Jan 2026)
 *
 * Auth is account email + password form fields (not Bearer).
 * c_callerID maps to your Twilio DID shown in the recipient voicemail box.
 */
export function createSlybroadcastProvider(config: {
  uid?: string;
  password?: string;
  endpoint?: string;
}): RvmDeliveryProvider {
  const endpoint = config.endpoint ?? DEFAULT_URL;

  return {
    id: "SLYBROADCAST",
    supportsTrueRingless: true,
    async send(input: SendRvmInput): Promise<DeliveryResult> {
      if (!config.uid || !config.password) {
        return {
          ok: false,
          status: "failed",
          errorCode: "SLYBROADCAST_NOT_CONFIGURED",
          errorDetail: "Set SLYBROADCAST_UID + SLYBROADCAST_PASSWORD",
        };
      }

      const toDigits = input.toE164.replace(/\D/g, "").replace(/^1/, "");
      const fromDigits = input.fromE164.replace(/\D/g, "").replace(/^1/, "");
      const audioExt = guessAudioExt(input.audioUrl);

      const body = new URLSearchParams({
        c_uid: config.uid,
        c_password: config.password,
        c_method: "new_campaign",
        c_url: input.audioUrl,
        c_audio: audioExt,
        c_phone: toDigits,
        c_callerID: fromDigits,
        c_date: "now",
        c_title: input.foreignId.slice(0, 64),
        mobile_only: "1",
      });

      if (input.callbackUrl) {
        body.set("c_dispo_url", input.callbackUrl);
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      const raw: unknown = await res.json().catch(() => null);

      if (
        raw &&
        typeof raw === "object" &&
        "ERROR" in raw
      ) {
        return {
          ok: false,
          status: "failed",
          errorCode: "SLYBROADCAST_ERROR",
          errorDetail: String((raw as { ERROR: unknown }).ERROR),
          raw,
        };
      }

      const sessionId =
        raw && typeof raw === "object" && "session_id" in raw
          ? String((raw as { session_id: unknown }).session_id)
          : undefined;

      return {
        ok: true,
        status: "queued",
        providerMessageId: sessionId,
        costEstimateUsd: 0.05,
        raw,
      };
    },
  };
}

function guessAudioExt(url: string): "wav" | "mp3" | "m4a" {
  const lower = url.toLowerCase();
  if (lower.includes(".mp3")) return "mp3";
  if (lower.includes(".m4a")) return "m4a";
  return "wav";
}
