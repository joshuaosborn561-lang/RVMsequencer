import { buildWarmupSchedule, dailyCapForWarmupDay } from "@/lib/warmup/schedule";
import { DELIVERY_SCENARIOS, TTS_SCENARIOS, estimateRun } from "@/lib/cost/estimate";

export type DemoLine = {
  id: string;
  e164: string;
  areaCode: string;
  status: "WARMING" | "HEALTHY" | "DEGRADED" | "QUARANTINED";
  warmupDay: number;
  dailyCap: number;
  sentToday: number;
  deliveryRate7d: number;
  callbackRate7d: number;
  reputationLabel: "UNFLAGGED" | "MIXED_LOW" | "MIXED_HIGH" | "FLAGGED" | "UNKNOWN";
  registeredFcr: boolean;
  voiceIntegrity: boolean;
};

export const demoLines: DemoLine[] = [
  {
    id: "ln_1",
    e164: "+14155550101",
    areaCode: "415",
    status: "HEALTHY",
    warmupDay: 18,
    dailyCap: dailyCapForWarmupDay(18),
    sentToday: 42,
    deliveryRate7d: 0.78,
    callbackRate7d: 0.041,
    reputationLabel: "UNFLAGGED",
    registeredFcr: true,
    voiceIntegrity: true,
  },
  {
    id: "ln_2",
    e164: "+12125550188",
    areaCode: "212",
    status: "WARMING",
    warmupDay: 4,
    dailyCap: dailyCapForWarmupDay(4),
    sentToday: 12,
    deliveryRate7d: 0.81,
    callbackRate7d: 0.03,
    reputationLabel: "UNKNOWN",
    registeredFcr: true,
    voiceIntegrity: false,
  },
  {
    id: "ln_3",
    e164: "+13105550144",
    areaCode: "310",
    status: "DEGRADED",
    warmupDay: 22,
    dailyCap: 60,
    sentToday: 8,
    deliveryRate7d: 0.52,
    callbackRate7d: 0.009,
    reputationLabel: "MIXED_LOW",
    registeredFcr: true,
    voiceIntegrity: true,
  },
  {
    id: "ln_4",
    e164: "+13055550177",
    areaCode: "305",
    status: "QUARANTINED",
    warmupDay: 9,
    dailyCap: 0,
    sentToday: 0,
    deliveryRate7d: 0.31,
    callbackRate7d: 0.002,
    reputationLabel: "FLAGGED",
    registeredFcr: false,
    voiceIntegrity: false,
  },
];

export const demoCampaigns = [
  {
    id: "cmp_1",
    name: "Q3 seller follow-up",
    status: "ACTIVE" as const,
    enrolled: 1840,
    sentToday: 126,
    deliveredToday: 101,
    provider: "MOCK",
    mode: "RVM_PROVIDER",
  },
  {
    id: "cmp_2",
    name: "Webinar no-show chase",
    status: "PAUSED" as const,
    enrolled: 420,
    sentToday: 0,
    deliveredToday: 0,
    provider: "MOCK",
    mode: "RVM_PROVIDER",
  },
];

export const warmupSchedule = buildWarmupSchedule();

export const costMatrix = DELIVERY_SCENARIOS.flatMap((delivery) => {
  const ttsOptions = delivery.includesAiVoice
    ? [TTS_SCENARIOS.find((t) => t.id === "static_reuse")!]
    : TTS_SCENARIOS.filter((t) =>
        ["static_reuse", "cartesia_startup", "eleven_flash"].includes(t.id),
      );
  return ttsOptions.map((tts) => {
    const run = estimateRun({
      drops: 2000,
      delivery,
      tts,
      charsPerMessage: 400,
      personalizedFraction: tts.id === "static_reuse" ? 0 : 1,
    });
    return {
      delivery: delivery.label,
      tts: delivery.includesAiVoice ? "(bundled)" : tts.label,
      ...run,
    };
  });
});
