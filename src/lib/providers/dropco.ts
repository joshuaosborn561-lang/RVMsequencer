import type { DeliveryResult, RvmDeliveryProvider, SendRvmInput } from "./types";

export type DropCoConfig = {
  apiKey?: string;
  /** Existing campaign token — optional if createCampaign is used first */
  campaignToken?: string;
  baseUrl?: string;
};

/**
 * Drop.co Customer API — pay-as-you-go RVM.
 * Docs: https://apidocs.drop.co/
 *
 * Sequencer flow:
 * 1. createDropCoCampaign(audioUrl) once per static script → campaign token
 * 2. provider.send() posts each lead into that campaign
 */
export function createDropCoProvider(config: DropCoConfig): RvmDeliveryProvider {
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
          errorDetail: "Set DROP_CO_API_KEY + DROP_CO_CAMPAIGN_TOKEN (or create campaign first)",
        };
      }

      const phone = input.toE164.replace(/\D/g, "").replace(/^1/, "");
      const qs = new URLSearchParams({
        key: config.apiKey,
        token: config.campaignToken,
        phone,
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
        raw && typeof raw === "object" && "ActivityToken" in raw
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

/** Create a Drop.co VMDrop campaign from a hosted audio URL. */
export async function createDropCoCampaign(input: {
  apiKey: string;
  name: string;
  audioUrl: string;
  forwardingNumber?: string;
  baseUrl?: string;
}): Promise<{ campaignToken: string; raw: unknown }> {
  const baseUrl = input.baseUrl ?? "https://customerapi.drop.co";
  const qs = new URLSearchParams({
    key: input.apiKey,
    VMDropName: input.name,
    VMDropFileUrl: input.audioUrl,
    EnableMissedCall: "false",
    // Immediate transfer if forwarding number provided
    CallbackForwardingType: input.forwardingNumber ? "1" : "3",
  });
  if (input.forwardingNumber) {
    qs.set(
      "ForwardingNumber",
      input.forwardingNumber.replace(/\D/g, "").replace(/^1/, ""),
    );
  }

  const res = await fetch(`${baseUrl}/VMDropCreate/?${qs.toString()}`, {
    method: "POST",
  });
  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Drop.co VMDropCreate failed HTTP ${res.status}`);
  }

  const token =
    raw && typeof raw === "object"
      ? String(
          (raw as Record<string, unknown>).CampaignToken ??
            (raw as Record<string, unknown>).Token ??
            (raw as Record<string, unknown>).campaignToken ??
            "",
        )
      : "";

  if (!token) {
    throw new Error("Drop.co VMDropCreate returned no campaign token");
  }

  return { campaignToken: token, raw };
}
