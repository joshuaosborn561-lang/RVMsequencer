import type { DeliveryResult, RvmDeliveryProvider, SendRvmInput } from "./types";

/** Deterministic mock for local UI / sequencer tests — no network. */
export const mockRvmProvider: RvmDeliveryProvider = {
  id: "MOCK",
  supportsTrueRingless: true,
  async send(input: SendRvmInput): Promise<DeliveryResult> {
    const lastDigit = Number(input.toE164.replace(/\D/g, "").slice(-1));
    if (Number.isNaN(lastDigit)) {
      return {
        ok: false,
        status: "failed",
        errorCode: "INVALID_TO",
        errorDetail: "Destination must be E.164",
      };
    }
    // ~10% simulated carrier reject for monitoring demos
    if (lastDigit === 9) {
      return {
        ok: false,
        status: "rejected",
        providerMessageId: `mock_rej_${input.foreignId}`,
        errorCode: "CARRIER_REJECT",
        errorDetail: "Simulated carrier reject",
        costEstimateUsd: 0,
      };
    }
    return {
      ok: true,
      status: "delivered",
      providerMessageId: `mock_${input.foreignId}`,
      costEstimateUsd: 0.025,
    };
  },
};
