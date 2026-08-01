import { createDropCoProvider } from "@/lib/providers/dropco";
import { createElevenLabsClient } from "@/lib/voice/elevenlabs";
import {
  createDncProjectScrubber,
  createInternalDncScrubber,
  mockDncScrubber,
} from "@/lib/dnc/scrub";
import { mockRvmProvider } from "@/lib/providers/mock-rvm";

export function getDropCoDelivery(campaignToken?: string | null) {
  const apiKey = process.env.DROP_CO_API_KEY;
  const token = campaignToken ?? process.env.DROP_CO_CAMPAIGN_TOKEN;
  if (!apiKey || !token) return mockRvmProvider;
  return createDropCoProvider({ apiKey, campaignToken: token });
}

export function getElevenLabs() {
  return createElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
    publicBaseUrl: process.env.NEXT_PUBLIC_APP_URL,
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
