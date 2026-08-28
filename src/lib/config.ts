import { createDropCowboyProvider } from "@/lib/providers/dropcowboy";
import {
  createDncProjectScrubber,
  createInternalDncScrubber,
  mockDncScrubber,
} from "@/lib/dnc/scrub";
import { mockRvmProvider } from "@/lib/providers/mock-rvm";

/**
 * Default delivery: Drop Cowboy Public API.
 * Falls back to mock when team/secret/brand are unset (local / CI).
 */
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
