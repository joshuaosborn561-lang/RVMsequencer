import type { DeliveryResult, RvmDeliveryProvider, SendRvmInput } from "./types";

export type DropCowboyConfig = {
  teamId: string;
  secret: string;
  brandId: string;
  /** Default recording when send input omits recordingId */
  recordingId?: string;
  /** Private number pool GUID (optional) */
  poolId?: string;
  /**
   * When true, send `caller_id` = fromE164 (requires Drop Cowboy BYOC).
   * Otherwise fromE164 is used as `forwarding_number` so return calls hit your Twilio DIDs.
   */
  byocCallerId?: boolean;
  baseUrl?: string;
};

function toE164ish(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed.startsWith("+") ? trimmed : `+${digits}`;
}

/**
 * Drop Cowboy Public API — 1:1 RVM deposit.
 * Docs: https://drop-cowboy.gitbook.io/drop-cowboy-docs/
 *
 * POST https://api.dropcowboy.com/v1/rvm
 * Auth headers: x-team-id, x-secret
 * Audio: recording_id (dashboard) or audio_url (approval / BYOC)
 * Return calls: forwarding_number (shared/private pool) or caller_id (BYOC)
 */
export function createDropCowboyProvider(
  config: DropCowboyConfig,
): RvmDeliveryProvider {
  const baseUrl = config.baseUrl ?? "https://api.dropcowboy.com/v1";

  return {
    id: "DROP_COWBOY",
    supportsTrueRingless: true,
    async send(input: SendRvmInput): Promise<DeliveryResult> {
      const recordingId = input.recordingId ?? config.recordingId;
      const audioUrl = input.audioUrl?.trim() || undefined;

      if (!recordingId && !audioUrl) {
        return {
          ok: false,
          status: "failed",
          errorCode: "DROPCOWBOY_NO_AUDIO",
          errorDetail:
            "Set campaign dropCowboyRecordingId (or audio URL if account allows audio_url)",
        };
      }

      const phone_number = toE164ish(input.toE164);
      const from = toE164ish(input.fromE164);

      const body: Record<string, unknown> = {
        team_id: config.teamId,
        secret: config.secret,
        foreign_id: input.foreignId.slice(0, 256),
        brand_id: config.brandId,
        phone_number,
      };

      if (recordingId) body.recording_id = recordingId;
      else if (audioUrl) body.audio_url = audioUrl;

      if (config.byocCallerId) {
        body.caller_id = from;
      } else {
        body.forwarding_number = from;
      }

      if (config.poolId) body.pool_id = config.poolId;
      if (input.postalCode) body.postal_code = input.postalCode;
      if (input.callbackUrl) body.callback_url = input.callbackUrl;

      const res = await fetch(`${baseUrl}/rvm`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-team-id": config.teamId,
          "x-secret": config.secret,
        },
        body: JSON.stringify(body),
      });

      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const detail =
          raw && typeof raw === "object" && "message" in raw
            ? String((raw as { message: unknown }).message)
            : raw && typeof raw === "object" && "error" in raw
              ? String((raw as { error: unknown }).error)
              : `Drop Cowboy RVM failed HTTP ${res.status}`;
        return {
          ok: false,
          status: "failed",
          errorCode: `HTTP_${res.status}`,
          errorDetail: detail.slice(0, 400),
          raw,
        };
      }

      const dropId =
        raw && typeof raw === "object" && "drop_id" in raw
          ? String((raw as { drop_id: unknown }).drop_id)
          : raw && typeof raw === "object" && "id" in raw
            ? String((raw as { id: unknown }).id)
            : undefined;

      return {
        ok: true,
        status: "queued",
        providerMessageId: dropId ?? input.foreignId,
        costEstimateUsd: 0.1,
        raw,
      };
    },
  };
}
