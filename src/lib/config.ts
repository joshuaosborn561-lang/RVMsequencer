import { createDropCowboyProvider } from "@/lib/providers/dropcowboy";
import { createSlybroadcastProvider } from "@/lib/providers/slybroadcast";
import {
  createDncProjectScrubber,
  createInternalDncScrubber,
  mockDncScrubber,
} from "@/lib/dnc/scrub";
import { mockRvmProvider } from "@/lib/providers/mock-rvm";
import type { RvmDeliveryProvider } from "@/lib/providers/types";

export type RvmProviderId = "SLYBROADCAST" | "DROP_COWBOY" | "MOCK";

/** Default delivery provider. Override with RVM_PROVIDER=slybroadcast|dropcowboy|mock */
export function getRvmProviderId(): RvmProviderId {
  const raw = (process.env.RVM_PROVIDER ?? "slybroadcast").trim().toLowerCase();
  if (raw === "dropcowboy" || raw === "drop_cowboy") return "DROP_COWBOY";
  if (raw === "mock") return "MOCK";
  return "SLYBROADCAST";
}

export function getSlybroadcastDelivery(): RvmDeliveryProvider {
  const uid = process.env.SLYBROADCAST_UID?.trim();
  const password = process.env.SLYBROADCAST_PASSWORD?.trim();
  if (!uid || !password) return mockRvmProvider;
  return createSlybroadcastProvider({ uid, password });
}

export function getDropCowboyDelivery(recordingId?: string | null) {
  const teamId = process.env.DROPCOWBOY_TEAM_ID?.trim();
  const secret = process.env.DROPCOWBOY_SECRET?.trim();
  const brandId = process.env.DROPCOWBOY_BRAND_ID?.trim();
  if (!teamId || !secret || !brandId) return mockRvmProvider;

  return createDropCowboyProvider({
    teamId,
    secret,
    brandId,
    recordingId: recordingId?.trim() || process.env.DROPCOWBOY_RECORDING_ID?.trim(),
    poolId: process.env.DROPCOWBOY_POOL_ID?.trim(),
    byocCallerId: process.env.DROPCOWBOY_BYOC_CALLER_ID === "1",
  });
}

/**
 * Default RVM deposit adapter.
 * Slybroadcast: hosted audio URL + Twilio DID as c_callerID.
 * Drop Cowboy: recording_id (optional via RVM_PROVIDER=dropcowboy).
 */
export function getDefaultDelivery(opts?: {
  recordingId?: string | null;
}): RvmDeliveryProvider {
  const id = getRvmProviderId();
  if (id === "MOCK") return mockRvmProvider;
  if (id === "DROP_COWBOY") return getDropCowboyDelivery(opts?.recordingId);
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
