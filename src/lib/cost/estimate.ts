/**
 * Rough unit-economics helpers for the "$100 / 2k drops" target.
 * Numbers are approximate 2026 public rates — re-verify before budgeting.
 *
 * Preference order for Dropseq (PAYG + API, not Drop Cowboy):
 * 1. Drop.co — true PAYG, modern Customer API, $0.05 → $100/2k
 * 2. Slybroadcast PAYG — never-expire credits + c_callerID
 * 3. LeadsRain — lowest cents, older API surface
 */

export type CostScenario = {
  id: string;
  label: string;
  perDropUsd: number;
  notes: string;
  includesAiVoice: boolean;
  hasApi: boolean;
};

export const DELIVERY_SCENARIOS: CostScenario[] = [
  {
    id: "slybroadcast_2k_monthly",
    label: "Slybroadcast monthly 2k plan",
    perDropUsd: 0.05,
    notes: "$100/mo for 2,000 deliveries. JSON API + c_callerID. Credits expire monthly.",
    includesAiVoice: false,
    hasApi: true,
  },
  {
    id: "slybroadcast_payg_5k",
    label: "Slybroadcast PAYG (~5k pack)",
    perDropUsd: 0.05,
    notes: "~$250 / 5,000 ≈ $0.05; PAYG credits do not expire. AI personalization = 2 credits.",
    includesAiVoice: false,
    hasApi: true,
  },
  {
    id: "dropco_simple",
    label: "Drop.co Simple tier",
    perDropUsd: 0.05,
    notes: "$0.05/drop @ 1k volume, no monthly fee. Customer API + webhooks. Scales to $0.012 @ 100k.",
    includesAiVoice: false,
    hasApi: true,
  },
  {
    id: "leadsrain_static",
    label: "LeadsRain static + DNC scrub",
    perDropUsd: 0.022,
    notes: "~$0.02 drop + ~$0.002 scrub; API exists (legacy). Credits expire ~90 days.",
    includesAiVoice: false,
    hasApi: true,
  },
  {
    id: "topa_ai",
    label: "Topa AI RVM (0.5 credit @ $0.05)",
    perDropUsd: 0.025,
    notes: "Bundled AI voice + drop. Great price; less control over your Twilio CID fleet.",
    includesAiVoice: true,
    hasApi: true,
  },
  {
    id: "voicedrop_static_budget",
    label: "VoiceDrop static (Budget utilization)",
    perDropUsd: 0.095,
    notes: "$95/mo / ~1000 static drops at full use — pricier than Sly/Drop.co for static.",
    includesAiVoice: false,
    hasApi: true,
  },
  {
    id: "dropcowboy_platform",
    label: "Drop Cowboy (typical platform path)",
    perDropUsd: 0.025,
    notes: "Entry plans ~$125/mo + overage/compliance fees. BYOC can go lower at scale — overkill if you only need an API.",
    includesAiVoice: false,
    hasApi: true,
  },
  {
    id: "twilio_amd",
    label: "Twilio AMD leave-message attempt",
    perDropUsd: 0.03,
    notes: "~$0.014/min + $0.0075 AMD; phone rings — not true RVM.",
    includesAiVoice: false,
    hasApi: true,
  },
];

export type TtsScenario = {
  id: string;
  label: string;
  usdPer1kChars: number;
  notes: string;
};

export const TTS_SCENARIOS: TtsScenario[] = [
  {
    id: "eleven_flash",
    label: "ElevenLabs Flash/Turbo",
    usdPer1kChars: 0.05,
    notes: "Good cost/quality for bulk personalized RVM.",
  },
  {
    id: "eleven_multi",
    label: "ElevenLabs Multilingual v2/v3",
    usdPer1kChars: 0.1,
    notes: "Higher fidelity; can blow the $100 budget alone at 2k unique.",
  },
  {
    id: "cartesia_startup",
    label: "Cartesia Sonic (Startup effective)",
    usdPer1kChars: 0.039,
    notes: "~$49/1.25M credits; instant clone at 1 credit/char.",
  },
  {
    id: "static_reuse",
    label: "Static recording / one-time render",
    usdPer1kChars: 0,
    notes: "Amortized TTS ~$0 after first generation.",
  },
];

export function estimateRun(input: {
  drops: number;
  delivery: CostScenario;
  tts?: TtsScenario;
  charsPerMessage?: number;
  personalizedFraction?: number;
}): {
  deliveryUsd: number;
  ttsUsd: number;
  totalUsd: number;
  under100: boolean;
  perDropUsd: number;
} {
  const chars = input.charsPerMessage ?? 400;
  const personalized = input.personalizedFraction ?? (input.delivery.includesAiVoice ? 0 : 1);
  const deliveryUsd = input.drops * input.delivery.perDropUsd;
  let ttsUsd = 0;
  if (!input.delivery.includesAiVoice && input.tts && input.tts.usdPer1kChars > 0) {
    ttsUsd =
      input.drops *
      personalized *
      (chars / 1000) *
      input.tts.usdPer1kChars;
  }
  const totalUsd = deliveryUsd + ttsUsd;
  return {
    deliveryUsd: round2(deliveryUsd),
    ttsUsd: round2(ttsUsd),
    totalUsd: round2(totalUsd),
    under100: totalUsd <= 100,
    perDropUsd: round4(totalUsd / input.drops),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}
