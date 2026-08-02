import assert from "node:assert/strict";
import {
  dailyCapForWarmupDay,
  buildWarmupSchedule,
  suggestLineStatus,
  DEFAULT_WARMUP_PROFILE,
} from "../src/lib/warmup/schedule";
import {
  campaignRampCeiling,
  pickLine,
  poolRemainingCapacity,
} from "../src/lib/sequencer/line-picker";
import { humanizeSendAt } from "../src/lib/sequencer/jitter";
import { checkRateLimit } from "../src/lib/security/rate-limit";
import { evaluateCompliance, renderScript } from "../src/lib/compliance/gates";
import { evaluateLineHealth } from "../src/lib/reputation/evaluate";
import { estimateRun, DELIVERY_SCENARIOS, TTS_SCENARIOS } from "../src/lib/cost/estimate";
import { mockRvmProvider } from "../src/lib/providers/mock-rvm";
import { timezoneFromPhone } from "../src/lib/timezone/from-phone";
import { evaluateSendWindow } from "../src/lib/sequencer/send-window";
import { mockDncScrubber, scrubWithAll } from "../src/lib/dnc/scrub";
import { runAttempt } from "../src/lib/sequencer/run-attempt";
import {
  failureBackoffMs,
  nextFailureEligibleAt,
  shouldGiveUp,
} from "../src/lib/sequencer/backoff";
import { MAX_SEND_ATTEMPTS } from "../src/lib/store/types";

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

// Sticky line preferred when still eligible
const sticky = pickLine(lines, "+13055550999", { stickyLineId: "a" });
assert.equal(sticky?.id, "a");

// Min gap excludes recently used line
const gapped = pickLine(
  [
    {
      id: "recent",
      e164: "+12125550101",
      areaCode: "212",
      status: "HEALTHY" as const,
      dailyCap: 80,
      sentToday: 0,
      reputationLabel: "UNFLAGGED" as const,
      lastSentAt: new Date().toISOString(),
      minGapSec: 600,
    },
    {
      id: "cool",
      e164: "+14155550101",
      areaCode: "415",
      status: "HEALTHY" as const,
      dailyCap: 80,
      sentToday: 0,
      reputationLabel: "UNFLAGGED" as const,
      minGapSec: 600,
    },
  ],
  "+12125550999",
);
assert.equal(gapped?.id, "cool");

// Ramp can only lower vs newLeadsPerDay
assert.equal(
  campaignRampCeiling({
    enabled: true,
    startPerDay: 25,
    incrementPerDay: 25,
    ceilingPerDay: 200,
    activeDay: 0,
    newLeadsPerDay: 200,
  }),
  25,
);
assert.equal(
  campaignRampCeiling({
    enabled: false,
    startPerDay: 25,
    incrementPerDay: 25,
    ceilingPerDay: 200,
    activeDay: 10,
    newLeadsPerDay: 50,
  }),
  50,
);

// Jitter is deterministic for a salt and moves forward
const base = new Date("2026-08-01T12:00:00.000Z");
const j1 = humanizeSendAt(base, { salt: "lead_a" });
const j2 = humanizeSendAt(base, { salt: "lead_a" });
assert.equal(j1.getTime(), j2.getTime());
assert.ok(j1.getTime() >= base.getTime());


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

// PAYG Drop.co + static reuse = exactly $100 for 2k
const dropco = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "dropco_simple")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "static_reuse")!,
  personalizedFraction: 0,
});
assert.equal(dropco.under100, true);
assert.equal(dropco.totalUsd, 100);

// One-shot high-quality TTS is noise (~$0.04) if not personalized per lead
const once = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "dropco_simple")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "eleven_multi")!,
  personalizedFraction: 0, // generate once → amortized ~0 across 2k in this model
  charsPerMessage: 400,
});
assert.equal(once.under100, true);

// Regenerating Multilingual per lead on $0.05 deposit breaks $100
const expensive = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "dropco_simple")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "eleven_multi")!,
  personalizedFraction: 1,
  charsPerMessage: 400,
});
assert.equal(expensive.under100, false);

// Soft consent: requireConsent=false allows UNKNOWN
assert.equal(
  evaluateCompliance({
    consentStatus: "UNKNOWN",
    dnc: false,
    requireConsent: false,
    localHour: 10,
    sendWindowStart: 9,
    sendWindowEnd: 20,
    localDayOfWeek: 2,
    sendDays: [1, 2, 3, 4, 5],
  }).allow,
  true,
);

// Phone → IANA timezone (Google libphonenumber prefix map)
assert.equal(timezoneFromPhone("+14155550123"), "America/Los_Angeles");
assert.equal(timezoneFromPhone("+12125550123"), "America/New_York");
assert.equal(timezoneFromPhone("+16025550123"), "America/Phoenix");

async function main() {
  // Rate limit trips after max (async — Redis or memory)
  {
    const rlKey = `verify_${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      assert.equal(
        (await checkRateLimit(rlKey, { windowMs: 60_000, max: 3 })).ok,
        true,
      );
    }
    assert.equal(
      (await checkRateLimit(rlKey, { windowMs: 60_000, max: 3 })).ok,
      false,
    );
  }

  const { eagerScheduleCampaign, claimScheduledSends } = await import(
    "../src/lib/store/scheduled"
  );
  const { poolExhausted } = await import("../src/lib/sequencer/rebalance");
  const { stepIdempotencyKey } = await import(
    "../src/lib/store/scheduled-types"
  );

  const camp = {
    id: "cmp_verify",
    name: "V",
    status: "ACTIVE" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps: [
      {
        id: "s1",
        position: 1,
        delayDays: 0,
        scriptTemplate: "Hey {{first_name}}",
      },
      {
        id: "s2",
        position: 2,
        delayDays: 2,
        scriptTemplate: "Follow up {{first_name}}",
      },
    ],
    lineIds: ["ln"],
    schedule: {
      sendWindowStart: 9,
      sendWindowEnd: 20,
      sendDays: [1, 2, 3, 4, 5],
      timezoneMode: "RECIPIENT_LOCAL" as const,
      newLeadsPerDay: 100,
      requireConsent: false,
      stopOnCallback: true,
      stopOnOptOut: true,
    },
  };
  const lead = {
    id: "lead_verify",
    campaignId: camp.id,
    phoneE164: "+14155550123",
    custom: {},
    dnc: false,
    consentStatus: "UNKNOWN" as const,
    createdAt: new Date().toISOString(),
    status: "PENDING" as const,
  };
  const sched = await eagerScheduleCampaign({
    campaign: camp,
    leads: [lead],
    now: new Date("2026-08-01T12:00:00.000Z"),
  });
  assert.ok(sched.created >= 2);
  assert.equal(stepIdempotencyKey(camp.id, lead.id, 2), "cmp_verify_lead_verify_step2");

  const claimed = await claimScheduledSends({
    campaignId: camp.id,
    limit: 10,
    owner: "verify",
    now: new Date("2026-08-01T12:00:00.000Z"),
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.stepPosition, 1);

  assert.equal(
    poolExhausted([
      {
        id: "x",
        e164: "+1",
        status: "HEALTHY",
        warmupDay: 10,
        dailyCap: 1,
        sentToday: 1,
        reputationLabel: "UNFLAGGED",
        minGapSec: 600,
      },
    ]),
    true,
  );

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

  // Local-time window: SF number at 8am PT should be outside 9–20 window
  const outside = evaluateSendWindow({
    phoneE164: "+14155550123",
    dnc: false,
    consentStatus: "UNKNOWN",
    schedule: {
      sendWindowStart: 9,
      sendWindowEnd: 20,
      sendDays: [0, 1, 2, 3, 4, 5, 6],
    },
    // 2026-08-03 15:00 UTC = 8:00 America/Los_Angeles
    now: new Date("2026-08-03T15:00:00.000Z"),
  });
  assert.equal(outside.allow, false);
  if (!outside.allow) assert.equal(outside.reason, "OUTSIDE_SEND_WINDOW");

  const inside = evaluateSendWindow({
    phoneE164: "+14155550123",
    dnc: false,
    consentStatus: "UNKNOWN",
    schedule: {
      sendWindowStart: 9,
      sendWindowEnd: 20,
      sendDays: [0, 1, 2, 3, 4, 5, 6],
    },
    // 2026-08-03 18:00 UTC = 11:00 PT
    now: new Date("2026-08-03T18:00:00.000Z"),
  });
  assert.equal(inside.allow, true);

  // DNC mock scrub
  const scrub = await scrubWithAll([mockDncScrubber], [
    "+14155550000",
    "+14155550123",
  ]);
  assert.equal(scrub[0]?.blocked, true);
  assert.equal(scrub[1]?.blocked, false);

  // Full attempt: scrub blocks ending 0000
  const blockedAttempt = await runAttempt({
    lead: {
      id: "l1",
      phoneE164: "+14155550000",
      consentStatus: "UNKNOWN",
      dnc: false,
    },
    campaign: {
      id: "c1",
      scriptTemplate: "Hey {{first_name}}",
      audioUrl: "https://example.com/a.mp3",
      schedule: {
        sendWindowStart: 0,
        sendWindowEnd: 24,
        sendDays: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    lines: [
      {
        id: "ln",
        e164: "+14155550999",
        areaCode: "415",
        status: "HEALTHY",
        dailyCap: 80,
        sentToday: 0,
        reputationLabel: "UNFLAGGED",
      },
    ],
    dncScrubbers: [mockDncScrubber],
    delivery: mockRvmProvider,
    now: new Date("2026-08-03T18:00:00.000Z"),
  });
  assert.equal(blockedAttempt.status, "SKIPPED");

  const sentAttempt = await runAttempt({
    lead: {
      id: "l2",
      phoneE164: "+14155550123",
      firstName: "Alex",
      consentStatus: "UNKNOWN",
      dnc: false,
    },
    campaign: {
      id: "c1",
      scriptTemplate: "Hey {{first_name}}",
      audioUrl: "https://example.com/a.mp3",
      schedule: {
        sendWindowStart: 9,
        sendWindowEnd: 20,
        sendDays: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    lines: [
      {
        id: "ln",
        e164: "+14155550999",
        areaCode: "415",
        status: "HEALTHY",
        dailyCap: 80,
        sentToday: 0,
        reputationLabel: "UNFLAGGED",
      },
    ],
    dncScrubbers: [mockDncScrubber],
    delivery: mockRvmProvider,
    now: new Date("2026-08-03T18:00:00.000Z"),
  });
  assert.equal(sentAttempt.status, "SENT");

  const suppressedAttempt = await runAttempt({
    lead: {
      id: "l3",
      phoneE164: "+14155550999",
      consentStatus: "UNKNOWN",
      dnc: false,
    },
    campaign: {
      id: "c1",
      scriptTemplate: "Hey",
      audioUrl: "https://example.com/a.mp3",
      schedule: {
        sendWindowStart: 0,
        sendWindowEnd: 24,
        sendDays: [0, 1, 2, 3, 4, 5, 6],
      },
    },
    lines: [
      {
        id: "ln",
        e164: "+14155550999",
        areaCode: "415",
        status: "HEALTHY",
        dailyCap: 80,
        sentToday: 0,
        reputationLabel: "UNFLAGGED",
      },
    ],
    dncScrubbers: [mockDncScrubber],
    delivery: mockRvmProvider,
    now: new Date("2026-08-03T18:00:00.000Z"),
    isSuppressed: () => true,
  });
  assert.equal(suppressedAttempt.status, "SKIPPED");
  if (suppressedAttempt.status === "SKIPPED") {
    assert.equal(suppressedAttempt.reason, "SUPPRESSED");
  }

  // Enrollment backoff — finite, capped, not infinite hammering
  assert.ok(failureBackoffMs(1) >= 5 * 60 * 1000);
  assert.ok(failureBackoffMs(20) <= 6 * 60 * 60 * 1000);
  assert.equal(shouldGiveUp(MAX_SEND_ATTEMPTS - 1), false);
  assert.equal(shouldGiveUp(MAX_SEND_ATTEMPTS), true);
  const nxt = nextFailureEligibleAt(1, new Date("2026-08-01T00:00:00.000Z"));
  assert.ok(nxt.getTime() > Date.parse("2026-08-01T00:00:00.000Z"));

  console.log("verify-core: all assertions passed");
}

void main();
