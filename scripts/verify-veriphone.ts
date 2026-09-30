/**
 * Veriphone mobile-line gate — unit + ingest/send checks.
 * Never prints an API key. Uses a mock fetch only.
 */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isMobileLine,
  normalizePhoneType,
  notMobileReason,
} from "../src/lib/veriphone/types";
import { mockRvmProvider } from "../src/lib/providers/mock-rvm";

async function main() {
// Isolate file cache / store from the workspace .data and any real DATABASE_URL.
process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "rvm-veriphone-"));
delete process.env.DATABASE_URL;
delete process.env.VERIPHONE_API_KEY;

const {
  evaluateMobileGate,
  recordedResultFresh,
  verifyPhoneForGate,
} = await import("../src/lib/veriphone/gate");
const {
  resetVeriphoneTestHooks,
  setVeriphoneTestHooks,
  isVeriphoneConfigured,
  isVeriphoneEnabled,
  lookupVeriphone,
} = await import("../src/lib/veriphone/client");
const { getVeriphoneHealth } = await import("../src/lib/veriphone/health");
const { getPhoneTypeCache, putPhoneTypeCache, entryFromLookup } = await import(
  "../src/lib/veriphone/cache"
);
const { writeVeriphonePauseState, readVeriphonePauseState } = await import(
  "../src/lib/veriphone/state"
);
const { runAttempt } = await import("../src/lib/sequencer/run-attempt");

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function mobileBody(e164: string) {
  return {
    phone_valid: true,
    phone_type: "mobile",
    carrier: "T-Mobile",
    e164,
    country: "United States",
  };
}

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  process.env.VERIPHONE_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    delete process.env.VERIPHONE_API_KEY;
    resetVeriphoneTestHooks();
  }
}

// --- Reason helpers ---
assert.equal(normalizePhoneType("fixed_line"), "fixed_line");
assert.equal(normalizePhoneType("Fixed Line"), "fixed_line");
assert.equal(normalizePhoneType(""), "unknown");
assert.equal(notMobileReason("fixed_line"), "NOT_MOBILE_VERIPHONE_fixed_line");
assert.equal(notMobileReason("voip"), "NOT_MOBILE_VERIPHONE_voip");
assert.equal(notMobileReason(undefined), "NOT_MOBILE_VERIPHONE_unknown");
assert.equal(isMobileLine(true, "mobile"), true);
assert.equal(isMobileLine(true, "fixed_line"), false);
assert.equal(isMobileLine(false, "mobile"), false);

assert.equal(isVeriphoneConfigured(), false);
assert.equal(isVeriphoneEnabled(), false);

{
  const health = await getVeriphoneHealth();
  assert.equal(health.enabled, false);
  assert.equal(health.flag, "disabled");
  assert.equal(health.paused, false);
  assert.equal(health.error, null);
}

{
  const open = await evaluateMobileGate("+14155550123");
  assert.equal(open.allow, true);
  if (open.allow) assert.equal(open.source, "disabled");
}

{
  const sent = await runAttempt({
    lead: {
      id: "l-off",
      phoneE164: "+14155550123",
      consentStatus: "UNKNOWN",
      dnc: false,
    },
    campaign: {
      id: "c-off",
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
    dncScrubbers: [],
    delivery: mockRvmProvider,
    now: new Date("2026-08-03T18:00:00.000Z"),
  });
  assert.equal(sent.status, "SENT");
}

await withKey(async () => {
  let calls = 0;
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async (input) => {
      calls += 1;
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("key"), "test-key");
      const phone = url.searchParams.get("phone") ?? "";
      if (phone === "+14155550101") return jsonResponse(mobileBody(phone));
      if (phone === "+14155550102") {
        return jsonResponse({
          phone_valid: true,
          phone_type: "fixed_line",
          carrier: "AT&T",
          e164: phone,
          country: "United States",
        });
      }
      if (phone === "+14155550103") {
        return jsonResponse({
          phone_valid: true,
          phone_type: "voip",
          e164: phone,
        });
      }
      if (phone === "+14155550104") {
        return jsonResponse({
          phone_valid: false,
          phone_type: "unknown",
          e164: phone,
        });
      }
      return jsonResponse({ error: "unexpected" }, 500);
    },
  });

  const mobile = await evaluateMobileGate("+14155550101");
  assert.equal(mobile.allow, true);
  if (mobile.allow) {
    assert.equal(mobile.source, "api");
    assert.equal(mobile.phoneType, "mobile");
  }

  const cached = await evaluateMobileGate("+14155550101");
  assert.equal(cached.allow, true);
  if (cached.allow) assert.equal(cached.source, "cache");
  assert.equal(calls, 1, "cache must prevent a second credit");

  const landline = await verifyPhoneForGate("+14155550102");
  assert.equal(landline.kind, "not_mobile");
  if (landline.kind === "not_mobile") {
    assert.equal(landline.reason, "NOT_MOBILE_VERIPHONE_fixed_line");
  }

  const voip = await evaluateMobileGate("+14155550103");
  assert.equal(voip.allow, false);
  if (!voip.allow && voip.reason === "NOT_MOBILE") {
    assert.equal(voip.detail, "NOT_MOBILE_VERIPHONE_voip");
  }

  const invalid = await evaluateMobileGate("+14155550104");
  assert.equal(invalid.allow, false);
  if (!invalid.allow && invalid.reason === "NOT_MOBILE") {
    assert.equal(invalid.detail, "NOT_MOBILE_VERIPHONE_unknown");
  }
});

await withKey(async () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await putPhoneTypeCache(
    entryFromLookup({
      e164: "+15551230000",
      phoneValid: true,
      phoneType: "mobile",
      now,
    }),
  );
  const hit = await getPhoneTypeCache("+15551230000", now);
  assert.ok(hit);
  const expired = await getPhoneTypeCache(
    "+15551230000",
    new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000),
  );
  assert.equal(expired, null);
  assert.equal(
    recordedResultFresh({
      phoneValid: true,
      phoneType: "mobile",
      phoneVerifiedAt: now.toISOString(),
    }, now),
    true,
  );
  assert.equal(
    recordedResultFresh({
      phoneValid: true,
      phoneType: "mobile",
      phoneVerifiedAt: now.toISOString(),
    }, new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000)),
    false,
  );
});

await withKey(async () => {
  let calls = 0;
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async () => {
      calls += 1;
      if (calls < 3) return jsonResponse({ error: "nope" }, 503);
      return jsonResponse(mobileBody("+14155550901"));
    },
  });
  const ok = await lookupVeriphone("+14155550901");
  assert.equal(ok.status, "ok");
  assert.equal(calls, 3);
});

await withKey(async () => {
  let calls = 0;
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async () => {
      calls += 1;
      return jsonResponse({ error: "slow" }, 429, { "retry-after": "0" });
    },
  });
  const r = await lookupVeriphone("+14155550902");
  assert.equal(r.status, "unverified");
  assert.ok(calls > 1);
});

await withKey(async () => {
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async () => jsonResponse({ error: "no" }, 401),
  });
  const r = await evaluateMobileGate("+14155550903");
  assert.equal(r.allow, false);
  if (!r.allow) {
    assert.equal(r.reason, "PHONE_UNVERIFIED");
    assert.equal(r.detail, "VERIPHONE_HTTP_401");
  }
  const paused = await readVeriphonePauseState();
  assert.equal(paused.paused, true);
  assert.equal(paused.pausedReason, "VERIPHONE_HTTP_401");
  const health = await getVeriphoneHealth();
  assert.equal(health.enabled, true);
  assert.equal(health.flag, "paused");
  assert.ok(health.error);

  const blocked = await runAttempt({
    lead: {
      id: "l-pause",
      phoneE164: "+14155550999",
      consentStatus: "UNKNOWN",
      dnc: false,
    },
    campaign: {
      id: "c-pause",
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
    dncScrubbers: [],
    delivery: mockRvmProvider,
    now: new Date("2026-08-03T18:00:00.000Z"),
  });
  assert.equal(blocked.status, "SKIPPED");
  if (blocked.status === "SKIPPED") {
    assert.equal(blocked.reason, "PHONE_UNVERIFIED");
  }
  await writeVeriphonePauseState({ paused: false });
});

await withKey(async () => {
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async () => jsonResponse({ error: "credits" }, 402),
  });
  const r = await evaluateMobileGate("+14155550904");
  assert.equal(r.allow, false);
  if (!r.allow) assert.equal(r.detail, "VERIPHONE_HTTP_402");
  await writeVeriphonePauseState({ paused: false });
});

await withKey(async () => {
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async () => {
      throw new Error("socket hang up");
    },
  });
  const r = await evaluateMobileGate("+14155550905");
  assert.equal(r.allow, false);
  if (!r.allow) assert.equal(r.reason, "PHONE_UNVERIFIED");
});

await withKey(async () => {
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async () =>
      jsonResponse({
        phone_valid: true,
        phone_type: "fixed_line",
        e164: "+14155550906",
      }),
  });
  const skipped = await runAttempt({
    lead: {
      id: "l-ll",
      phoneE164: "+14155550906",
      consentStatus: "UNKNOWN",
      dnc: false,
    },
    campaign: {
      id: "c-ll",
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
    dncScrubbers: [],
    delivery: mockRvmProvider,
    now: new Date("2026-08-03T18:00:00.000Z"),
  });
  assert.equal(skipped.status, "SKIPPED");
  if (skipped.status === "SKIPPED") {
    assert.equal(skipped.reason, "NOT_MOBILE");
    assert.equal(skipped.detail, "NOT_MOBILE_VERIPHONE_fixed_line");
  }
});

await withKey(async () => {
  setVeriphoneTestHooks({
    sleepFn: async () => undefined,
    fetchFn: async (input) => {
      const phone = new URL(String(input)).searchParams.get("phone");
      if (phone === "+14155551111") return jsonResponse(mobileBody(phone));
      return jsonResponse({
        phone_valid: true,
        phone_type: "fixed_line",
        e164: phone,
      });
    },
  });

  const { createCampaign, importLeads, listLeads } = await import(
    "../src/lib/store/db"
  );
  const campaign = await createCampaign({ name: "veriphone-ingest" });
  await importLeads(campaign.id, [
    {
      phoneE164: "+14155551111",
      firstName: "Mobile",
      custom: {},
      dnc: false,
      consentStatus: "UNKNOWN",
    },
    {
      phoneE164: "+14155552222",
      firstName: "Landline",
      custom: {},
      dnc: false,
      consentStatus: "UNKNOWN",
    },
  ]);
  const leads = await listLeads(campaign.id);
  const mobile = leads.find((l) => l.phoneE164 === "+14155551111");
  const land = leads.find((l) => l.phoneE164 === "+14155552222");
  assert.equal(mobile?.status, "PENDING");
  assert.equal(mobile?.phoneValid, true);
  assert.equal(mobile?.phoneType, "mobile");
  assert.equal(land?.status, "SUPPRESSED");
  assert.equal(land?.suppressReason, "NOT_MOBILE_VERIPHONE_fixed_line");
  assert.equal(land?.dnc, false);
});

console.log("verify-veriphone: ok");
}

void main();
