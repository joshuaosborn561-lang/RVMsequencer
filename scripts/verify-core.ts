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
import { localClockAt, timezoneFromPhone } from "../src/lib/timezone/from-phone";
import {
  campaignWindowForLocalDay,
  evaluateSendWindow,
} from "../src/lib/sequencer/send-window";
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

  // Friday optional window: end exclusive (13 = last send 12:59). Mon–Thu keep 9–17.
  {
    const fridaySchedule = {
      sendWindowStart: 9,
      sendWindowEnd: 17,
      fridaySendWindowStart: 9,
      fridaySendWindowEnd: 13,
      sendDays: [1, 2, 3, 4, 5],
    };
    assert.deepEqual(campaignWindowForLocalDay(fridaySchedule, 4), {
      sendWindowStart: 9,
      sendWindowEnd: 17,
    });
    assert.deepEqual(campaignWindowForLocalDay(fridaySchedule, 5), {
      sendWindowStart: 9,
      sendWindowEnd: 13,
    });
    assert.deepEqual(
      campaignWindowForLocalDay(
        { sendWindowStart: 9, sendWindowEnd: 17 },
        5,
      ),
      { sendWindowStart: 9, sendWindowEnd: 17 },
    );

    const friPhone = "+14155550123";
    const friTz = "America/Los_Angeles";
    // 2026-09-04 is Friday; PDT = UTC−7
    const fri1259 = new Date("2026-09-04T19:59:00.000Z");
    const fri1300 = new Date("2026-09-04T20:00:00.000Z");
    const thu1600 = new Date("2026-09-03T23:00:00.000Z");
    const fri1600 = new Date("2026-09-04T23:00:00.000Z");

    const clock1259 = localClockAt(friPhone, fri1259, friTz);
    assert.equal(clock1259.localDayOfWeek, 5);
    assert.equal(clock1259.localHour, 12);
    const clock1300 = localClockAt(friPhone, fri1300, friTz);
    assert.equal(clock1300.localDayOfWeek, 5);
    assert.equal(clock1300.localHour, 13);
    const clockThu = localClockAt(friPhone, thu1600, friTz);
    assert.equal(clockThu.localDayOfWeek, 4);
    assert.equal(clockThu.localHour, 16);

    const friAllowed = evaluateSendWindow({
      phoneE164: friPhone,
      timezone: friTz,
      dnc: false,
      consentStatus: "UNKNOWN",
      schedule: fridaySchedule,
      now: fri1259,
    });
    assert.equal(friAllowed.allow, true);
    assert.equal(friAllowed.appliedWindow.sendWindowEnd, 13);

    const friBlocked = evaluateSendWindow({
      phoneE164: friPhone,
      timezone: friTz,
      dnc: false,
      consentStatus: "UNKNOWN",
      schedule: fridaySchedule,
      now: fri1300,
    });
    assert.equal(friBlocked.allow, false);
    if (!friBlocked.allow) assert.equal(friBlocked.reason, "OUTSIDE_SEND_WINDOW");
    assert.equal(friBlocked.appliedWindow.sendWindowEnd, 13);

    const thuAllowed = evaluateSendWindow({
      phoneE164: friPhone,
      timezone: friTz,
      dnc: false,
      consentStatus: "UNKNOWN",
      schedule: fridaySchedule,
      now: thu1600,
    });
    assert.equal(thuAllowed.allow, true);
    assert.equal(thuAllowed.appliedWindow.sendWindowEnd, 17);

    const legacyFriday = evaluateSendWindow({
      phoneE164: friPhone,
      timezone: friTz,
      dnc: false,
      consentStatus: "UNKNOWN",
      schedule: {
        sendWindowStart: 9,
        sendWindowEnd: 17,
        sendDays: [1, 2, 3, 4, 5],
      },
      now: fri1600,
    });
    assert.equal(legacyFriday.allow, true);
    assert.equal(legacyFriday.appliedWindow.sendWindowEnd, 17);

    const fridayAttempt = await runAttempt({
      lead: {
        id: "l-fri",
        phoneE164: friPhone,
        timezone: friTz,
        consentStatus: "UNKNOWN",
        dnc: false,
      },
      campaign: {
        id: "c-fri",
        scriptTemplate: "Hey",
        audioUrl: "https://example.com/a.mp3",
        schedule: fridaySchedule,
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
      dncScrubbers: [],
      delivery: mockRvmProvider,
      now: fri1300,
    });
    assert.equal(fridayAttempt.status, "SKIPPED");
    if (fridayAttempt.status === "SKIPPED") {
      assert.equal(fridayAttempt.reason, "OUTSIDE_SEND_WINDOW");
    }
  }

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
    assert.equal(campaign.schedule.sendWindowStart, 9);
    assert.equal(campaign.schedule.sendWindowEnd, 17);
    assert.equal(campaign.schedule.fridaySendWindowStart, 9);
    assert.equal(campaign.schedule.fridaySendWindowEnd, 13);
    assert.deepEqual(campaign.schedule.sendDays, [1, 2, 3, 4, 5]);
    assert.equal(campaign.schedule.timezoneMode, "RECIPIENT_LOCAL");
    await updateCampaign(campaign.id, {
      status: "ACTIVE",
      audioUrl: "https://example.com/a.mp3",
      lineIds: ["ln_1"],
      schedule: {
        sendWindowStart: 8,
        sendWindowEnd: 21,
        fridaySendWindowStart: null,
        fridaySendWindowEnd: null,
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

  // Receipt poll: campaign_result → deliveryStatus (no live Slybroadcast)
  {
    const {
      mapDialStatusToDelivery,
      receiptHealthFlag,
      refreshPendingReceipts,
    } = await import("../src/lib/sequencer/refresh-receipts");
    const { refreshSlybroadcastOutcome } = await import(
      "../src/lib/supabase/rvm-sync"
    );
    const { listPendingReceiptCandidates } = await import(
      "../src/lib/store/scheduled"
    );
    const {
      createCampaign,
      updateCampaign,
      importLeads,
      listLeads,
      getCampaign,
      listAuditEvents,
    } = await import("../src/lib/store/db");

    assert.equal(mapDialStatusToDelivery("OK"), "delivered");
    assert.equal(mapDialStatusToDelivery("ok"), "delivered");
    assert.equal(mapDialStatusToDelivery("Failure"), "failed");
    assert.equal(mapDialStatusToDelivery("Pending"), "queued");
    assert.equal(mapDialStatusToDelivery(""), "queued");
    assert.equal(mapDialStatusToDelivery("sent"), "sent");

    assert.equal(
      receiptHealthFlag({ ok: 7, failed: 3, stalePending: 0 }).flag,
      "RECEIPT_HEALTH",
    );
    assert.equal(
      receiptHealthFlag({ ok: 8, failed: 2, stalePending: 0 }).flag,
      undefined,
    );
    assert.equal(
      receiptHealthFlag({ ok: 0, failed: 3, stalePending: 0 }).flag,
      undefined,
    );
    assert.equal(
      receiptHealthFlag({ ok: 0, failed: 0, stalePending: 10 }).flag,
      "RECEIPT_HEALTH",
    );

    const origFetch = globalThis.fetch;
    let fetchHits = 0;
    globalThis.fetch = (async () => {
      fetchHits += 1;
      return new Response(JSON.stringify({ ERROR: "live slybroadcast" }));
    }) as typeof fetch;
    const guarded = await refreshSlybroadcastOutcome("sess_must_not_hit");
    assert.equal(guarded.ok, false);
    assert.equal(fetchHits, 0, "RVM_PROVIDER=mock must not call Slybroadcast");
    const skipped = await refreshPendingReceipts({ settleMs: 0 });
    assert.equal(skipped.refreshed, 0);
    assert.equal(fetchHits, 0);
    globalThis.fetch = origFetch;

    async function seedQueuedSend(opts: {
      name: string;
      phone: string;
      sessionId: string;
    }) {
      const campaign = await createCampaign({ name: opts.name });
      await updateCampaign(campaign.id, {
        status: "ACTIVE",
        audioUrl: "https://example.com/a.mp3",
        lineIds: ["ln_1"],
        schedule: {
          sendWindowStart: 8,
          sendWindowEnd: 21,
          fridaySendWindowStart: null,
          fridaySendWindowEnd: null,
          sendDays: [0, 1, 2, 3, 4, 5, 6],
          timezoneMode: "FIXED",
          fixedTimezone: "UTC",
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
            scriptTemplate: "Hey",
            audioUrl: "https://example.com/a.mp3",
          },
          {
            id: "s2",
            position: 2,
            delayDays: 2,
            scriptTemplate: "Follow",
            audioUrl: "https://example.com/a.mp3",
          },
        ],
      });
      await importLeads(campaign.id, [
        {
          phoneE164: opts.phone,
          firstName: "Pat",
          custom: {},
          dnc: false,
          consentStatus: "UNKNOWN",
        },
      ]);
      const leads = await listLeads(campaign.id);
      const live = await getCampaign(campaign.id);
      assert.ok(live);
      await eagerScheduleCampaign({
        campaign: live!,
        leads,
        now: new Date(),
      });
      const rows = await listScheduledForCampaign(campaign.id);
      const step1 = rows.find((s) => s.stepPosition === 1);
      assert.ok(step1, "step 1 must be scheduled");
      await updateScheduledSend(step1!.id, {
        status: "SENT",
        providerMsgId: opts.sessionId,
        deliveryStatus: "queued",
      });
      return { campaignId: campaign.id };
    }

    const okSeed = await seedQueuedSend({
      name: "receipt-ok",
      phone: "+14155551101",
      sessionId: "sess_ok_1",
    });
    const failSeed = await seedQueuedSend({
      name: "receipt-fail",
      phone: "+14155551102",
      sessionId: "sess_fail_1",
    });
    await seedQueuedSend({
      name: "receipt-pending",
      phone: "+14155551103",
      sessionId: "sess_pend_1",
    });

    const mapped = await refreshPendingReceipts({
      settleMs: 0,
      fetchOutcome: async (sessionId) => {
        if (sessionId === "sess_ok_1") return { ok: true, dialStatus: "OK" };
        if (sessionId === "sess_fail_1") {
          return { ok: true, dialStatus: "Failure", failReason: "NOANSWER" };
        }
        return { ok: true, dialStatus: "Pending" };
      },
    });
    assert.ok(mapped.ok >= 1, "OK receipt must count as ok");
    assert.ok(mapped.failed >= 1, "Failure receipt must count as failed");
    assert.ok(mapped.stillPending >= 1, "Pending receipt must remain pending");
    const afterOk = (await listScheduledForCampaign(okSeed.campaignId)).find(
      (s) => s.stepPosition === 1,
    );
    const afterFail = (await listScheduledForCampaign(failSeed.campaignId)).find(
      (s) => s.stepPosition === 1,
    );
    const afterPend = (await listScheduledForCampaign(okSeed.campaignId)).find(
      (s) => s.providerMsgId === "sess_ok_1",
    );
    assert.equal(afterOk?.deliveryStatus, "delivered");
    assert.equal(afterFail?.deliveryStatus, "failed");
    assert.equal(afterFail?.status, "FAILED");
    assert.equal(afterFail?.lastError, "NOANSWER");
    const failStep2 = (await listScheduledForCampaign(failSeed.campaignId)).find(
      (s) => s.stepPosition === 2,
    );
    assert.equal(failStep2?.status, "CANCELLED");
    assert.equal(afterPend?.deliveryStatus, "delivered");

    const capCamp = await createCampaign({ name: "receipt-cap" });
    await updateCampaign(capCamp.id, {
      status: "ACTIVE",
      audioUrl: "https://example.com/a.mp3",
      lineIds: ["ln_1"],
      schedule: {
        sendWindowStart: 8,
        sendWindowEnd: 21,
        fridaySendWindowStart: null,
        fridaySendWindowEnd: null,
        sendDays: [0, 1, 2, 3, 4, 5, 6],
        timezoneMode: "FIXED",
        fixedTimezone: "UTC",
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
          scriptTemplate: "Hey",
          audioUrl: "https://example.com/a.mp3",
        },
      ],
    });
    await importLeads(
      capCamp.id,
      Array.from({ length: 12 }, (_, i) => ({
        phoneE164: `+14155553${String(i).padStart(3, "0")}`,
        firstName: "Cap",
        custom: {},
        dnc: false,
        consentStatus: "UNKNOWN" as const,
      })),
    );
    const capLive = await getCampaign(capCamp.id);
    const capLeads = await listLeads(capCamp.id);
    await eagerScheduleCampaign({
      campaign: capLive!,
      leads: capLeads,
      now: new Date(),
    });
    const capRows = await listScheduledForCampaign(capCamp.id);
    let n = 0;
    for (const row of capRows) {
      await updateScheduledSend(row.id, {
        status: "SENT",
        providerMsgId: `sess_cap_${n}`,
        deliveryStatus: "queued",
      });
      n += 1;
    }
    const allPending = await listPendingReceiptCandidates({
      now: new Date(),
      settleMs: 0,
      lookbackMs: 48 * 60 * 60 * 1000,
      limit: 1000,
    });
    assert.ok(allPending.length >= 12, "need enough pending receipts for cap");
    const cappedList = await listPendingReceiptCandidates({
      now: new Date(),
      settleMs: 0,
      lookbackMs: 48 * 60 * 60 * 1000,
      limit: 5,
    });
    assert.equal(cappedList.length, 5, "listPendingReceiptCandidates honors cap");

    let pollCalls = 0;
    await refreshPendingReceipts({
      settleMs: 0,
      batchCap: 5,
      fetchOutcome: async () => {
        pollCalls += 1;
        return { ok: true, dialStatus: "Pending" };
      },
    });
    assert.equal(pollCalls, 5, "refreshPendingReceipts honors batch cap");

    const fresh = await seedQueuedSend({
      name: "receipt-fresh",
      phone: "+14155551199",
      sessionId: "sess_fresh_1",
    });
    const tooSoon = await listPendingReceiptCandidates({
      now: new Date(),
      settleMs: 5 * 60 * 1000,
      lookbackMs: 48 * 60 * 60 * 1000,
      limit: 200,
    });
    assert.equal(
      tooSoon.some((s) => s.providerMsgId === "sess_fresh_1"),
      false,
      "rows newer than settle window must not be polled",
    );
    const dueNow = await listPendingReceiptCandidates({
      now: new Date(),
      settleMs: 0,
      lookbackMs: 48 * 60 * 60 * 1000,
      limit: 200,
    });
    assert.equal(
      dueNow.some((s) => s.providerMsgId === "sess_fresh_1"),
      true,
    );
    assert.ok(fresh.campaignId);

    const healthIds = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const sessionId = `sess_health_${i}`;
      healthIds.add(sessionId);
      await seedQueuedSend({
        name: `receipt-health-${i}`,
        phone: `+14155554${String(i).padStart(3, "0")}`,
        sessionId,
      });
    }
    const healthResult = await refreshPendingReceipts({
      settleMs: 0,
      batchCap: 100,
      fetchOutcome: async (sessionId) => {
        if (healthIds.has(sessionId)) {
          return sessionId.endsWith("0") ||
            sessionId.endsWith("1") ||
            sessionId.endsWith("2")
            ? { ok: true, dialStatus: "Failure", failReason: "BUSY" }
            : { ok: true, dialStatus: "OK" };
        }
        return { ok: true, dialStatus: "Pending" };
      },
    });
    assert.equal(healthResult.flag, "RECEIPT_HEALTH");
    assert.ok(healthResult.failed >= 3);
    assert.ok(healthResult.ok >= 7);
    const audits = await listAuditEvents({ limit: 30 });
    assert.ok(
      audits.some((a) => a.action === "RECEIPT_HEALTH"),
      "RECEIPT_HEALTH must be audited (no auto-pause)",
    );
  }

  // Narrow per-lead suppress — pending, idempotent, wrong ids, SENT history
  {
    const {
      createCampaign,
      updateCampaign,
      importLeads,
      listLeads,
      getLead,
      getSuppression,
      suppressCampaignLead,
      updateLead,
      createAttempt,
      updateAttempt,
      findAttemptByKey,
      listAuditEvents,
    } = await import("../src/lib/store/db");
    const {
      eagerScheduleCampaign,
      listScheduledForCampaign,
      updateScheduledSend,
    } = await import("../src/lib/store/scheduled");

    const campaign = await createCampaign({ name: "lane-mismatch-cleanup" });
    const other = await createCampaign({ name: "other-campaign" });
    await updateCampaign(campaign.id, {
      status: "PAUSED",
      audioUrl: "https://example.com/a.mp3",
      lineIds: ["ln_1"],
      steps: [
        {
          id: "s1",
          position: 1,
          delayDays: 0,
          scriptTemplate: "Hey {{first_name}}",
          audioUrl: "https://example.com/a.mp3",
        },
        {
          id: "s2",
          position: 2,
          delayDays: 1,
          scriptTemplate: "Follow up",
          audioUrl: "https://example.com/b.mp3",
        },
      ],
    });

    await importLeads(campaign.id, [
      {
        phoneE164: "+14155551001",
        firstName: "Pending",
        custom: {},
        dnc: false,
        consentStatus: "UNKNOWN",
      },
      {
        phoneE164: "+14155551002",
        firstName: "Keep",
        custom: {},
        dnc: false,
        consentStatus: "UNKNOWN",
      },
      {
        phoneE164: "+14155551003",
        firstName: "AlreadySent",
        custom: {},
        dnc: false,
        consentStatus: "UNKNOWN",
      },
    ]);
    const leads = await listLeads(campaign.id);
    const pending = leads.find((l) => l.phoneE164 === "+14155551001")!;
    const sibling = leads.find((l) => l.phoneE164 === "+14155551002")!;
    const sentLead = leads.find((l) => l.phoneE164 === "+14155551003")!;
    assert.ok(pending && sibling && sentLead);

    const live = await (await import("../src/lib/store/db")).getCampaign(
      campaign.id,
    );
    assert.ok(live);
    await eagerScheduleCampaign({ campaign: live!, leads });

    const sentAt = "2026-09-01T15:00:00.000Z";
    const sentKey = `${campaign.id}_${sentLead.id}_step1`;
    await updateLead(sentLead.id, {
      status: "SENT",
      sentAt,
      providerMessageId: "sess_keep_history",
      attemptCount: 1,
      currentStepPosition: 1,
    });
    const sentAttempt = await createAttempt({
      campaignId: campaign.id,
      leadId: sentLead.id,
      idempotencyKey: sentKey,
    });
    await updateAttempt(sentAttempt.id, {
      status: "SENT",
      providerMessageId: "sess_keep_history",
      completedAt: sentAt,
    });

    const queueBefore = await listScheduledForCampaign(campaign.id);
    const sentStep1 = queueBefore.find(
      (s) => s.leadId === sentLead.id && s.stepPosition === 1,
    )!;
    assert.ok(sentStep1);
    await updateScheduledSend(sentStep1.id, {
      status: "SENT",
      providerMsgId: "sess_keep_history",
      deliveryStatus: "delivered",
    });

    const failedKey = `${campaign.id}_${pending.id}_step1`;
    const failedAttempt = await createAttempt({
      campaignId: campaign.id,
      leadId: pending.id,
      idempotencyKey: failedKey,
    });
    await updateAttempt(failedAttempt.id, {
      status: "FAILED",
      reason: "PROVIDER_TEMP",
    });

    const first = await suppressCampaignLead(campaign.id, pending.id, {
      reason: "LANE_MISMATCH",
    });
    assert.equal(first.ok, true);
    if (first.ok) {
      assert.equal(first.lead.status, "SUPPRESSED");
      assert.equal(first.lead.dnc, true);
      assert.equal(first.lead.suppressReason, "LANE_MISMATCH");
      assert.equal(first.idempotent, false);
      assert.equal(first.historyPreserved, false);
      assert.ok(first.cancelledScheduled >= 1);
    }

    const afterPending = await getLead(campaign.id, pending.id);
    assert.equal(afterPending?.status, "SUPPRESSED");
    assert.equal(afterPending?.dnc, true);
    assert.equal(afterPending?.suppressReason, "LANE_MISMATCH");

    const afterSibling = await getLead(campaign.id, sibling.id);
    assert.equal(afterSibling?.status, "PENDING");
    assert.equal(afterSibling?.dnc, false);
    assert.equal(afterSibling?.suppressReason, undefined);

    assert.equal(
      await getSuppression("+14155551001"),
      null,
      "per-lead suppress must not write a global suppression row",
    );

    const queueAfterPending = await listScheduledForCampaign(campaign.id);
    assert.ok(
      queueAfterPending
        .filter((s) => s.leadId === pending.id)
        .every((s) => s.status === "CANCELLED" || s.status === "SENT"),
    );
    assert.ok(
      queueAfterPending.some(
        (s) => s.leadId === sibling.id && s.status === "PENDING",
      ),
      "sibling scheduled rows must stay pending",
    );

    const failedAfter = await findAttemptByKey(failedKey);
    assert.equal(failedAfter?.status, "FAILED");
    assert.equal(failedAfter?.reason, "PROVIDER_TEMP");
    assert.equal(failedAfter?.id, failedAttempt.id);

    const again = await suppressCampaignLead(campaign.id, pending.id, {
      reason: "LANE_MISMATCH",
    });
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.idempotent, true);
      assert.equal(again.lead.status, "SUPPRESSED");
      assert.equal(again.lead.suppressReason, "LANE_MISMATCH");
    }

    const missingCampaign = await suppressCampaignLead(
      "cmp_does_not_exist",
      pending.id,
    );
    assert.equal(missingCampaign.ok, false);
    if (!missingCampaign.ok) {
      assert.equal(missingCampaign.error, "campaign_not_found");
    }

    const wrongCampaign = await suppressCampaignLead(other.id, pending.id);
    assert.equal(wrongCampaign.ok, false);
    if (!wrongCampaign.ok) {
      assert.equal(wrongCampaign.error, "lead_not_found");
    }

    const missingLead = await suppressCampaignLead(
      campaign.id,
      "lead_does_not_exist",
    );
    assert.equal(missingLead.ok, false);
    if (!missingLead.ok) {
      assert.equal(missingLead.error, "lead_not_found");
    }

    const sentSnapshot = await getLead(campaign.id, sentLead.id);
    const sentAttemptBefore = await findAttemptByKey(sentKey);
    const sentQueueBefore = (await listScheduledForCampaign(campaign.id)).find(
      (s) => s.id === sentStep1.id,
    );
    assert.ok(sentSnapshot && sentAttemptBefore && sentQueueBefore);

    const sentResult = await suppressCampaignLead(campaign.id, sentLead.id, {
      reason: "LANE_MISMATCH",
    });
    assert.equal(sentResult.ok, true);
    if (sentResult.ok) {
      assert.equal(sentResult.historyPreserved, true);
      assert.equal(sentResult.lead.status, "SENT");
      assert.equal(sentResult.lead.sentAt, sentAt);
      assert.equal(sentResult.lead.providerMessageId, "sess_keep_history");
      assert.equal(sentResult.lead.dnc, false);
    }

    const sentAfter = await getLead(campaign.id, sentLead.id);
    assert.deepEqual(
      {
        status: sentAfter?.status,
        sentAt: sentAfter?.sentAt,
        providerMessageId: sentAfter?.providerMessageId,
        dnc: sentAfter?.dnc,
        attemptCount: sentAfter?.attemptCount,
        suppressReason: sentAfter?.suppressReason,
      },
      {
        status: "SENT",
        sentAt,
        providerMessageId: "sess_keep_history",
        dnc: false,
        attemptCount: 1,
        suppressReason: undefined,
      },
    );

    const sentAttemptAfter = await findAttemptByKey(sentKey);
    assert.equal(sentAttemptAfter?.status, "SENT");
    assert.equal(sentAttemptAfter?.providerMessageId, "sess_keep_history");
    assert.equal(sentAttemptAfter?.completedAt, sentAt);
    assert.equal(sentAttemptAfter?.updatedAt, sentAttemptBefore?.updatedAt);

    const sentQueueAfter = (await listScheduledForCampaign(campaign.id)).find(
      (s) => s.id === sentStep1.id,
    );
    assert.equal(sentQueueAfter?.status, "SENT");
    assert.equal(sentQueueAfter?.providerMsgId, "sess_keep_history");
    assert.equal(sentQueueAfter?.deliveryStatus, "delivered");
    assert.ok(
      (await listScheduledForCampaign(campaign.id))
        .filter((s) => s.leadId === sentLead.id && s.stepPosition > 1)
        .every((s) => s.status === "CANCELLED"),
      "unsent follow-up steps on a SENT lead still cancel",
    );

    const siblingFinal = await getLead(campaign.id, sibling.id);
    assert.equal(siblingFinal?.status, "PENDING");

    const suppressAudits = await listAuditEvents({ campaignId: campaign.id });
    assert.ok(
      suppressAudits.some(
        (a) =>
          a.action === "SUPPRESSED" &&
          a.entityId === pending.id &&
          (a.detail as { reason?: string } | undefined)?.reason ===
            "LANE_MISMATCH",
      ),
    );

    process.env.CRON_SECRET = process.env.CRON_SECRET || "verify-cron-secret";
    const { POST: suppressPost } = await import(
      "../src/app/api/campaigns/[id]/leads/[leadId]/suppress/route"
    );
    const unauth = await suppressPost(
      new Request("http://local/api/campaigns/x/leads/y/suppress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      { params: Promise.resolve({ id: campaign.id, leadId: sibling.id }) },
    );
    assert.equal(unauth.status, 401);

    const httpOk = await suppressPost(
      new Request("http://local/api/campaigns/x/leads/y/suppress", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-cron-secret": process.env.CRON_SECRET,
        },
        body: JSON.stringify({ reason: "LANE_MISMATCH" }),
      }),
      { params: Promise.resolve({ id: campaign.id, leadId: sibling.id }) },
    );
    assert.equal(httpOk.status, 200);
    const httpBody = (await httpOk.json()) as {
      ok: boolean;
      lead: { status: string; dnc: boolean; suppressReason?: string };
      idempotent: boolean;
    };
    assert.equal(httpBody.ok, true);
    assert.equal(httpBody.lead.status, "SUPPRESSED");
    assert.equal(httpBody.lead.dnc, true);
    assert.equal(httpBody.lead.suppressReason, "LANE_MISMATCH");

    const http404 = await suppressPost(
      new Request("http://local/api/campaigns/x/leads/y/suppress", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: "{}",
      }),
      {
        params: Promise.resolve({
          id: campaign.id,
          leadId: "lead_missing",
        }),
      },
    );
    assert.equal(http404.status, 404);
  }

  console.log("verify-core: all assertions passed");
}

void main();
