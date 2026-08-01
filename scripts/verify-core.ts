import assert from "node:assert/strict";
import {
  dailyCapForWarmupDay,
  buildWarmupSchedule,
  suggestLineStatus,
  DEFAULT_WARMUP_PROFILE,
} from "../src/lib/warmup/schedule";
import { pickLine, poolRemainingCapacity } from "../src/lib/sequencer/line-picker";
import { evaluateCompliance, renderScript } from "../src/lib/compliance/gates";
import { evaluateLineHealth } from "../src/lib/reputation/evaluate";
import { estimateRun, DELIVERY_SCENARIOS, TTS_SCENARIOS } from "../src/lib/cost/estimate";
import { mockRvmProvider } from "../src/lib/providers/mock-rvm";

// Warmup ramp is gradual and hits target near minWarmDays
const schedule = buildWarmupSchedule();
assert.equal(schedule[0].dailyCap, 20);
assert.ok(schedule[2].dailyCap <= schedule[6].dailyCap);
assert.equal(dailyCapForWarmupDay(20), DEFAULT_WARMUP_PROFILE.targetCap);

assert.equal(
  suggestLineStatus({
    warmupDay: 2,
    targetCap: 80,
    reputation: "UNKNOWN",
  }),
  "WARMING",
);
assert.equal(
  suggestLineStatus({
    warmupDay: 20,
    targetCap: 80,
    reputation: "FLAGGED",
  }),
  "QUARANTINED",
);

// Line picker prefers local presence + capacity
const lines = [
  {
    id: "a",
    e164: "+14155550101",
    areaCode: "415",
    status: "HEALTHY" as const,
    dailyCap: 80,
    sentToday: 70,
    reputationLabel: "UNFLAGGED" as const,
  },
  {
    id: "b",
    e164: "+12125550188",
    areaCode: "212",
    status: "HEALTHY" as const,
    dailyCap: 80,
    sentToday: 10,
    reputationLabel: "UNFLAGGED" as const,
  },
  {
    id: "c",
    e164: "+13055550177",
    areaCode: "305",
    status: "QUARANTINED" as const,
    dailyCap: 80,
    sentToday: 0,
    reputationLabel: "FLAGGED" as const,
  },
];
const picked = pickLine(lines, "+12125550999");
assert.equal(picked?.id, "b");
assert.equal(poolRemainingCapacity(lines), 80);

// Compliance hard gates
assert.equal(
  evaluateCompliance({
    consentStatus: "UNKNOWN",
    dnc: false,
    requireConsent: true,
    localHour: 10,
    sendWindowStart: 9,
    sendWindowEnd: 20,
    localDayOfWeek: 2,
    sendDays: [1, 2, 3, 4, 5],
  }).allow,
  false,
);
assert.equal(
  evaluateCompliance({
    consentStatus: "EXPRESS_WRITTEN",
    dnc: false,
    requireConsent: true,
    localHour: 10,
    sendWindowStart: 9,
    sendWindowEnd: 20,
    localDayOfWeek: 2,
    sendDays: [1, 2, 3, 4, 5],
  }).allow,
  true,
);
assert.equal(
  renderScript("Hey {{ first_name }}, this is Sam at {{ company }}.", {
    first_name: "Alex",
    company: "Acme",
  }),
  "Hey Alex, this is Sam at Acme.",
);

// Reputation quarantine
const burned = evaluateLineHealth({
  spamLabel: "FLAGGED",
  attempts7d: 10,
});
assert.equal(burned.action, "quarantine");

// Cost: Slybroadcast 2k monthly and LeadsRain static under $100;
// full personalized Eleven multilingual on top of $0.05 deposit often is not
const sly = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "slybroadcast_2k_monthly")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "static_reuse")!,
  personalizedFraction: 0,
});
assert.equal(sly.under100, true);
assert.equal(sly.totalUsd, 100);

const leadsrain = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "leadsrain_static")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "static_reuse")!,
  personalizedFraction: 0,
});
assert.equal(leadsrain.under100, true);

const expensive = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "dropco_simple")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "eleven_multi")!,
  personalizedFraction: 1,
  charsPerMessage: 400,
});
assert.equal(expensive.under100, false);

async function main() {
  const ok = await mockRvmProvider.send({
    toE164: "+15551234560",
    fromE164: "+14155550101",
    audioUrl: "https://example.com/a.mp3",
    foreignId: "t1",
  });
  assert.equal(ok.ok, true);

  const rej = await mockRvmProvider.send({
    toE164: "+15551234569",
    fromE164: "+14155550101",
    audioUrl: "https://example.com/a.mp3",
    foreignId: "t2",
  });
  assert.equal(rej.status, "rejected");

  console.log("verify-core: all assertions passed");
}

void main();
