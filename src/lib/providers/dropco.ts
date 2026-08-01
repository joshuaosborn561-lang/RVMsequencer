import type { DeliveryResult, RvmDeliveryProvider, SendRvmInput } from "./types";

/**
 * Drop.co Customer API — pay-as-you-go RVM with modern REST + webhooks.
 * Docs: https://apidocs.drop.co/
 *
 * Flow for a sequencer:
 * 1. VMDropCreate once per campaign/audio (returns campaign token)
 * 2. Post records into that campaign per lead (this adapter)
 *
 * This stub posts a single record; campaignToken must be provisioned ahead of time
 * (or via a separate createCampaign helper).
 */
export function createDropCoProvider(config: {
  apiKey?: string;
  campaignToken?: string;
  baseUrl?: string;
}): RvmDeliveryProvider {
  const baseUrl = config.baseUrl ?? "https://customerapi.drop.co";

  return {
    id: "DROP_CO",
    supportsTrueRingless: true,
    async send(input: SendRvmInput): Promise<DeliveryResult> {
      if (!config.apiKey || !config.campaignToken) {
        return {
          ok: false,
          status: "failed",
          errorCode: "DROP_CO_NOT_CONFIGURED",
          errorDetail: "Set DROP_CO_API_KEY + DROP_CO_CAMPAIGN_TOKEN",
        };
      }

      const phone = input.toE164.replace(/\D/g, "").replace(/^1/, "");
      const qs = new URLSearchParams({
        key: config.apiKey,
        token: config.campaignToken,
        phone,
        // Optional per-record audio override
        fileurl: input.audioUrl,
      });

      const res = await fetch(`${baseUrl}/VMDropPostRecords/?${qs.toString()}`, {
        method: "POST",
      });

      const raw: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ok: false,
          status: "failed",
          errorCode: `HTTP_${res.status}`,
          errorDetail: "Drop.co post record failed",
          raw,
        };
      }

      const activityToken =
        raw &&
        typeof raw === "object" &&
        "ActivityToken" in raw
          ? String((raw as { ActivityToken: unknown }).ActivityToken)
          : undefined;

      return {
        ok: true,
        status: "queued",
        providerMessageId: activityToken ?? input.foreignId,
        costEstimateUsd: 0.05,
        raw,
      };
    },
  };
}
