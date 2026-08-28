import type { DeliveryResult, RvmDeliveryProvider, SendRvmInput } from "./types";

/**
 * VoiceDrop REST adapter stub.
 * Docs: https://www.voicedrop.ai/api/ — confirm current auth + payload fields before production.
 */
export function createVoiceDropProvider(config: {
  apiKey?: string;
  baseUrl?: string;
}): RvmDeliveryProvider {
  const baseUrl = config.baseUrl ?? "https://api.voicedrop.ai";
  return {
    id: "VOICEDROP",
    supportsTrueRingless: true,
    async send(input: SendRvmInput): Promise<DeliveryResult> {
      if (!config.apiKey) {
        return {
          ok: false,
          status: "failed",
          errorCode: "VOICEDROP_NOT_CONFIGURED",
          errorDetail: "Set VOICEDROP_API_KEY",
        };
      }

      if (!input.audioUrl && !input.ttsBody) {
        return {
          ok: false,
          status: "failed",
          errorCode: "NO_AUDIO",
          errorDetail: "VoiceDrop requires audio_url or tts_body",
        };
      }

      const res = await fetch(`${baseUrl}/v1/rvm`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: input.toE164,
          from: input.fromE164,
          audio_url: input.audioUrl,
          foreign_id: input.foreignId,
          callback_url: input.callbackUrl,
          tts_body: input.ttsBody,
          voice_id: input.voiceExternalId,
        }),
      });

      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          status: "failed",
          errorCode: `HTTP_${res.status}`,
          errorDetail: "VoiceDrop send failed",
          raw,
        };
      }

      const id =
        raw && typeof raw === "object" && "id" in raw
          ? String((raw as { id: unknown }).id)
          : undefined;

      return {
        ok: true,
        status: "queued",
        providerMessageId: id,
        raw,
      };
    },
  };
}
