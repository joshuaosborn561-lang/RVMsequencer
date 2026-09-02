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
import {
  humanizeSendAt,
  shouldDeferClaimedSendForJitter,
} from "../src/lib/sequencer/jitter";
import { checkRateLimit } from "../src/lib/security/rate-limit";
import { evaluateCompliance, renderScript } from "../src/lib/compliance/gates";
import { evaluateLineHealth } from "../src/lib/reputation/evaluate";
import {
  internalCallbackHealth,
  labelFromSpamScore,
  mergeReputation,
  mergeReputationResults,
  reputationRiskHint,
} from "../src/lib/reputation/check";
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

// Campaign ramp removed — per-line dailyCap is the only volume limit
assert.equal(
  campaignRampCeiling({
    enabled: true,
    startPerDay: 25,
    incrementPerDay: 25,
    ceilingPerDay: 200,
    activeDay: 0,
    newLeadsPerDay: 200,
  }),
  Number.MAX_SAFE_INTEGER,
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
  Number.MAX_SAFE_INTEGER,
);

// Jitter is deterministic for a salt and moves forward
const base = new Date("2026-08-01T12:00:00.000Z");
const j1 = humanizeSendAt(base, { salt: "lead_a" });
const j2 = humanizeSendAt(base, { salt: "lead_a" });
assert.equal(j1.getTime(), j2.getTime());
assert.ok(j1.getTime() >= base.getTime());

// 8h window / dailyCap 80 → max jitter ~144s. Almost every salt is >5s
// (the old drain threshold). Already-due rows must not re-defer.
{
  const dueNow = new Date("2026-09-02T18:00:00.000Z");
  let highSalt = "lead_stuck:1";
  for (const s of [
    "lead_stuck:1",
    "lead_a:1",
    "lead_b:1",
    "cmp_1aeda8fe:1",
  ]) {
    const j = humanizeSendAt(dueNow, {
      salt: s,
      windowHours: 8,
      dailyCap: 80,
    });
    if (j.getTime() > dueNow.getTime() + 5_000) {
      highSalt = s;
      break;
    }
  }
  const wouldDefer = humanizeSendAt(dueNow, {
    salt: highSalt,
    windowHours: 8,
    dailyCap: 80,
  });
  assert.ok(
    wouldDefer.getTime() > dueNow.getTime() + 5_000,
    "precondition: salt exceeds the old 5s JITTER_DEFER threshold",
  );
  assert.equal(
    shouldDeferClaimedSendForJitter({
      runAt: dueNow,
      now: dueNow,
    }),
    false,
    "already-due row must not re-defer for jitter",
  );
  assert.equal(
    shouldDeferClaimedSendForJitter({
      runAt: new Date(dueNow.getTime() - 60_000),
      now: dueNow,
    }),
    false,
  );
  assert.equal(
    shouldDeferClaimedSendForJitter({
      immediate: true,
      runAt: new Date(dueNow.getTime() + 60_000),
      now: dueNow,
    }),
    false,
  );
  assert.equal(
    shouldDeferClaimedSendForJitter({
      isSeed: true,
      runAt: new Date(dueNow.getTime() + 60_000),
      now: dueNow,
    }),
    false,
  );
}


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

// Reputation quarantine from external FLAGGED
const burned = evaluateLineHealth({
  spamLabel: "FLAGGED",
  attempts7d: 10,
});
assert.equal(burned.action, "quarantine");

// Unused DID (0 attempts) must not be MIXED_HIGH from the internal callback path
const unusedInternal = internalCallbackHealth({
  e164: "+18173857803",
  callbackRate7d: 0,
  poolAvgCallbackRate7d: 0.04,
});
assert.equal(unusedInternal.label, "UNFLAGGED");
assert.equal(unusedInternal.flagged, false);
assert.notEqual(unusedInternal.label, "MIXED_HIGH");
assert.notEqual(unusedInternal.label, "FLAGGED");

const unusedHealth = evaluateLineHealth({
  spamLabel: "UNFLAGGED",
  attempts7d: 0,
  callbackRate7d: 0,
});
assert.equal(unusedHealth.action, "keep");

const unusedUnknown = evaluateLineHealth({
  spamLabel: "UNKNOWN",
  attempts7d: 0,
  callbackRate7d: 0,
});
assert.equal(unusedUnknown.action, "keep");

// Callback collapse must not degrade (display-only metric)
const callbackOnly = evaluateLineHealth({
  spamLabel: "UNFLAGGED",
  attempts7d: 80,
  callbackRate7d: 0,
});
assert.equal(callbackOnly.action, "keep");

// CallTracer score thresholds
assert.equal(labelFromSpamScore(0, 0), "UNFLAGGED");
assert.equal(labelFromSpamScore(14, 0), "UNFLAGGED");
assert.equal(labelFromSpamScore(15, 0), "MIXED_LOW");
assert.equal(labelFromSpamScore(39, 1), "MIXED_LOW");
assert.equal(labelFromSpamScore(40, 0), "MIXED_HIGH");
assert.equal(labelFromSpamScore(10, 3), "MIXED_HIGH");
assert.equal(labelFromSpamScore(70, 0), "FLAGGED");
assert.equal(labelFromSpamScore(10, 10), "FLAGGED");

// Merge without internal still works; unused internal must not worsen UNFLAGGED
const mergedExternalOnly = mergeReputationResults({
  e164: "+18175524412",
  label: "UNFLAGGED",
  score: 2,
  reportCount: 0,
  source: "calltracer",
  flagged: false,
});
assert.equal(mergedExternalOnly.label, "UNFLAGGED");
assert.equal(mergedExternalOnly.source, "calltracer");

const mergedIgnoreInternal = mergeReputation(
  {
    e164: "+18176979217",
    label: "UNFLAGGED",
    score: 1,
    source: "calltracer",
    flagged: false,
  },
  unusedInternal,
);
assert.equal(mergedIgnoreInternal.label, "UNFLAGGED");
assert.equal(mergedIgnoreInternal.source, "calltracer");

const mergedHiyaWorse = mergeReputationResults(
  {
    e164: "+18177014205",
    label: "UNFLAGGED",
    score: 0,
    source: "calltracer",
    flagged: false,
  },
  {
    e164: "+18177014205",
    label: "MIXED_HIGH",
    score: 55,
    source: "hiya",
    flagged: true,
  },
);
assert.equal(mergedHiyaWorse.label, "MIXED_HIGH");
assert.equal(mergedHiyaWorse.source, "hiya");
assert.equal(
  evaluateLineHealth({ spamLabel: "MIXED_HIGH", attempts7d: 0 }).action,
  "degrade",
);

assert.equal(reputationRiskHint("FLAGGED", 10), "Likely spam");
assert.equal(reputationRiskHint("UNFLAGGED", 80), "Likely spam");
assert.equal(reputationRiskHint("MIXED_HIGH", 45), "Elevated");
assert.equal(reputationRiskHint("MIXED_LOW", 20), "Elevated");
assert.equal(reputationRiskHint("UNFLAGGED", 4), "Clean");
assert.equal(reputationRiskHint("UNKNOWN"), "Unknown");

// Slybroadcast monthly 2k + static recording reuse = $100 flat
const slybroadcast = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "slybroadcast_2k_monthly")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "static_reuse")!,
  personalizedFraction: 0,
});
assert.equal(slybroadcast.under100, true);
assert.equal(slybroadcast.totalUsd, 100);

// Legacy Drop.co Simple still models $100 for 2k
const dropco = estimateRun({
  drops: 2000,
  delivery: DELIVERY_SCENARIOS.find((d) => d.id === "dropco_simple")!,
  tts: TTS_SCENARIOS.find((t) => t.id === "static_reuse")!,
  personalizedFraction: 0,
});
assert.equal(dropco.under100, true);
assert.equal(dropco.totalUsd, 100);

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
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "rvm-verify-"));
  process.env.RVM_PROVIDER = "mock";

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

  const {
    eagerScheduleCampaign,
    claimScheduledSends,
    listScheduledForCampaign,
    updateScheduledSend,
  } = await import("../src/lib/store/scheduled");
  const { poolExhausted } = await import("../src/lib/sequencer/rebalance");
  const { stepIdempotencyKey } = await import(
    "../src/lib/store/scheduled-types"
  );

  const campId = `cmp_verify_${Date.now()}`;
  const leadId = `lead_verify_${Date.now()}`;
  const camp = {
    id: campId,
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
    id: leadId,
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
  assert.equal(
    stepIdempotencyKey(camp.id, lead.id, 2),
    `${campId}_${leadId}_step2`,
  );

  const queued = await listScheduledForCampaign(camp.id);
  const step1Queued = queued.find((s) => s.stepPosition === 1);
  assert.ok(step1Queued, "step 1 must be enqueued");
  assert.ok(
    Date.parse(step1Queued.runAt) >= Date.parse("2026-08-01T12:00:00.000Z"),
    "enqueue jitter must not move runAt backward",
  );

  const claimed = await claimScheduledSends({
    campaignId: camp.id,
    limit: 10,
    owner: "verify",
    now: new Date(step1Queued.runAt),
  });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0]?.stepPosition, 1);

  // Step 2 is calendar-due but must NOT claim until step 1 is delivered
  const tooSoon = await claimScheduledSends({
    campaignId: camp.id,
    limit: 10,
    owner: "verify2",
    now: new Date("2026-08-05T12:00:00.000Z"),
  });
  assert.equal(
    tooSoon.filter((s) => s.stepPosition === 2).length,
    0,
    "step 2 must wait for prior delivery",
  );

  assert.ok(claimed[0]?.id);
  await updateScheduledSend(claimed[0]!.id, {
    status: "SENT",
    deliveryStatus: "delivered",
  });

  const afterDelivered = await claimScheduledSends({
    campaignId: camp.id,
    limit: 10,
    owner: "verify3",
    now: new Date("2026-08-05T12:00:00.000Z"),
  });
  assert.equal(afterDelivered.length, 1);
  assert.equal(afterDelivered[0]?.stepPosition, 2);

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

  // Subsequent drain tick: already-due PENDING must not JITTER_DEFER.
  {
    const { createCampaign, updateCampaign, importLeads, listLeads } =
      await import("../src/lib/store/db");
    const { drainActiveCampaigns } = await import(
      "../src/lib/sequencer/drain"
    );
    const { localClockAt } = await import("../src/lib/timezone/from-phone");

    const drainNow = new Date();
    const zones = [
      "Pacific/Honolulu",
      "America/Anchorage",
      "America/Los_Angeles",
      "America/Denver",
      "America/Chicago",
      "America/New_York",
      "America/Sao_Paulo",
      "UTC",
      "Europe/London",
      "Europe/Berlin",
      "Africa/Cairo",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Bangkok",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "Australia/Sydney",
      "Pacific/Auckland",
    ];
    const inWindowTz =
      zones.find((tz) => {
        const hour = localClockAt("+14155550123", drainNow, tz).localHour;
        return hour >= 9 && hour < 17;
      }) ?? "UTC";

    const campaign = await createCampaign({ name: "jitter-defer-drain" });
    await updateCampaign(campaign.id, {
      status: "ACTIVE",
      audioUrl: "https://example.com/a.mp3",
      lineIds: ["ln_1"],
      schedule: {
        sendWindowStart: 8,
        sendWindowEnd: 21,
        sendDays: [0, 1, 2, 3, 4, 5, 6],
        timezoneMode: "FIXED",
        fixedTimezone: inWindowTz,
        newLeadsPerDay: 200,
        requireConsent: false,
        stopOnCallback: true,
        stopOnOptOut: true,
      },
      steps: [
        {
          id: "s1",
          position: 1,
          delayDays: 0,
          scriptTemplate: "Hey {{first_name}}",
          audioUrl: "https://example.com/a.mp3",
        },
      ],
    });
    await importLeads(campaign.id, [
      {
        phoneE164: "+14155550123",
        firstName: "Alex",
        custom: {},
        dnc: false,
        consentStatus: "UNKNOWN",
      },
    ]);
    const leads = await listLeads(campaign.id);
    const refreshed = (await import("../src/lib/store/db")).getCampaign;
    const live = await refreshed(campaign.id);
    assert.ok(live);
    const scheduled = await eagerScheduleCampaign({
      campaign: live!,
      leads,
      now: drainNow,
      dailyCap: 80,
    });
    assert.ok(scheduled.created >= 1);

    const dueRows = await listScheduledForCampaign(campaign.id);
    assert.ok(dueRows[0]);
    // Simulate a subsequent cron tick: row is already due (runAt in the past).
    await updateScheduledSend(dueRows[0]!.id, {
      status: "PENDING",
      runAt: new Date(drainNow.getTime() - 60_000).toISOString(),
      lastError: undefined,
      claimOwner: undefined,
      claimedAt: undefined,
    });

    const firstTick = await drainActiveCampaigns(10);
    const afterFirst = await listScheduledForCampaign(campaign.id);
    assert.ok(
      afterFirst.every((s) => s.lastError !== "JITTER_DEFER"),
      "due PENDING must not be deferred solely for JITTER_DEFER",
    );
    assert.ok(
      firstTick.details.every((d) => d.reason !== "JITTER_DEFER"),
      "drain details must not report JITTER_DEFER for a due row",
    );

    const secondTick = await drainActiveCampaigns(10);
    const afterSecond = await listScheduledForCampaign(campaign.id);
    assert.ok(
      afterSecond.every((s) => s.lastError !== "JITTER_DEFER"),
      "subsequent drain tick must not JITTER_DEFER an already-due row",
    );
    assert.ok(
      afterFirst.some((s) => s.status === "SENT") ||
        afterSecond.some((s) => s.status === "SENT") ||
        firstTick.sent + secondTick.sent > 0,
      "due row should progress to SENT under cron without salt luck",
    );
  }

  console.log("verify-core: all assertions passed");
}

void main();
