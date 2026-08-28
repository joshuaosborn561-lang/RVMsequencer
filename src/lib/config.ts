import { createSlybroadcastProvider } from "@/lib/providers/slybroadcast";
import {
  createDncProjectScrubber,
  createInternalDncScrubber,
  mockDncScrubber,
} from "@/lib/dnc/scrub";
import { mockRvmProvider } from "@/lib/providers/mock-rvm";
import type { RvmDeliveryProvider } from "@/lib/providers/types";

export type RvmProviderId = "SLYBROADCAST" | "MOCK";

/** Default delivery provider. Override with RVM_PROVIDER=slybroadcast|mock */
export function getRvmProviderId(): RvmProviderId {
  const raw = (process.env.RVM_PROVIDER ?? "slybroadcast").trim().toLowerCase();
  if (raw === "mock") return "MOCK";
  return "SLYBROADCAST";
}

export function getSlybroadcastDelivery(): RvmDeliveryProvider {
  const uid = process.env.SLYBROADCAST_UID?.trim();
  const password = process.env.SLYBROADCAST_PASSWORD?.trim();
  if (!uid || !password) return mockRvmProvider;
  return createSlybroadcastProvider({ uid, password });
}

/**
 * Default RVM deposit adapter.
 * Slybroadcast: hosted audio URL + Twilio DID as c_callerID.
 */
export function getDefaultDelivery(): RvmDeliveryProvider {
  const id = getRvmProviderId();
  if (id === "MOCK") return mockRvmProvider;
  return getSlybroadcastDelivery();
}

export function getDncScrubbers(internalBlocked: string[] = []) {
  const scrubbers = [createInternalDncScrubber(new Set(internalBlocked))];
  if (process.env.DNC_PROJECT_API_TOKEN) {
    scrubbers.push(
      createDncProjectScrubber({ apiToken: process.env.DNC_PROJECT_API_TOKEN }),
    );
  } else if (process.env.NODE_ENV !== "production") {
    scrubbers.push(mockDncScrubber);
  }
  return scrubbers;
}
