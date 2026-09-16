/**
 * Cross-channel suppression fan-out — unit checks.
 * No phones or emails should appear in status payloads or log masks.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  outcomeFromAlloReason,
  outcomeFromAlloRule,
  outcomeFromRvmSuppression,
  outcomeFromSmartleadEvent,
  alloInternalNote,
  noteMarker,
} from "../src/lib/suppression-fanout/outcomes";
import {
  domainFromEmail,
  identityFromEvent,
  mergeIdentity,
} from "../src/lib/suppression-fanout/identity";
import { maskEmail, maskPhone } from "../src/lib/suppression-fanout/mask";
import {
  eventFromAlloSuppression,
  eventFromBlockListEntry,
  eventFromRvmSuppression,
  eventFromSmartleadQueueItem,
} from "../src/lib/suppression-fanout/harvest";
import {
  isPermanent,
  shouldBlockDomain,
  shouldBlockEmail,
  shouldPauseSequence,
  shouldTagAlloDnc,
  type Destination,
  type SuppressionEvent,
} from "../src/lib/suppression-fanout/types";
import type { SuppressionRecord } from "../src/lib/store/types";

delete process.env.ALLO_API_KEY;
delete process.env.SMARTLEAD_API_KEY;
delete process.env.SMARTLEAD_API_TOKEN;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.SUPABASE_ANON_KEY;

const PHONE = "+15551234567";
const EMAIL = "owner@acme-roofing.com";

// --- Outcome mapping reuses Allo rules, does not re-guess ---
assert.equal(outcomeFromAlloReason("allo_dnc"), "do_not_call");
assert.equal(outcomeFromAlloReason("allo_conversation"), "conversation");
assert.equal(
  outcomeFromAlloReason("allo_tag:not_interested", "not_interested"),
  "not_interested",
);
assert.equal(
  outcomeFromAlloReason("allo_tag:meeting_booked", "meeting_booked"),
  "interested",
);
assert.equal(
  outcomeFromAlloRule({ rule: "allo_dnc", reason: "allo_dnc" }),
  "do_not_call",
);
assert.equal(outcomeFromSmartleadEvent("LEAD_UNSUBSCRIBED"), "do_not_call");
assert.equal(
  outcomeFromRvmSuppression({
    id: "s1",
    phoneE164: PHONE,
    reason: "SMS_STOP",
    source: "SMS_STOP",
    createdAt: "2026-09-16T17:03:00Z",
  }),
  "do_not_call",
);

assert.equal(isPermanent("do_not_call"), true);
assert.equal(isPermanent("not_interested"), false);
assert.equal(shouldBlockEmail("do_not_call"), true);
assert.equal(shouldBlockEmail("not_interested"), true);
assert.equal(shouldBlockEmail("interested"), false);
assert.equal(shouldBlockDomain("do_not_call"), true);
assert.equal(shouldBlockDomain("not_interested"), false);
assert.equal(shouldPauseSequence("interested"), true);
assert.equal(shouldPauseSequence("conversation"), true);
assert.equal(shouldTagAlloDnc("do_not_call"), true);
assert.equal(shouldTagAlloDnc("interested"), false);

// --- Identity: consumer domains are not company domains ---
assert.equal(domainFromEmail("pat@gmail.com"), undefined);
assert.equal(domainFromEmail(EMAIL), "acme-roofing.com");
assert.equal(
  mergeIdentity({ phoneE164: PHONE }, { email: EMAIL }).domain,
  "acme-roofing.com",
);

// --- Harvest mappers are stable / idempotent ids ---
const alloRow: SuppressionRecord = {
  id: "sup_abc",
  phoneE164: PHONE,
  reason: "allo_dnc",
  source: "ALLO",
  createdAt: "2026-09-16T17:03:00Z",
  alloMeta: {
    alloCallId: "cll-today-dnc",
    alloRep: "Alex",
    alloLine: "+15550001111",
    rule: "allo_dnc",
    callDate: "2026-09-16T17:03:00Z",
  },
};
const ev1 = eventFromAlloSuppression(alloRow);
const ev2 = eventFromAlloSuppression(alloRow);
assert.ok(ev1);
assert.equal(ev1!.id, ev2!.id);
assert.equal(ev1!.id, "allo:cll-today-dnc");
assert.equal(ev1!.outcome, "do_not_call");
assert.ok(ev1!.recordingUrl?.includes("cll-today-dnc"));

const rvm = eventFromRvmSuppression({
  id: "sup_stop",
  phoneE164: PHONE,
  reason: "SMS_STOP",
  source: "SMS_STOP",
  createdAt: "2026-09-16T12:00:00Z",
});
assert.equal(rvm?.id, "rvm:sup_stop");
assert.equal(eventFromAlloSuppression({
  id: "x",
  phoneE164: PHONE,
  reason: "SMS_STOP",
  source: "SMS_STOP",
  createdAt: "2026-09-16T12:00:00Z",
}), null);

const sl = eventFromSmartleadQueueItem({
  id: "unsub:lead1:",
  eventType: "LEAD_UNSUBSCRIBED",
  email: EMAIL,
  occurredAt: "2026-09-16T18:00:00Z",
});
assert.equal(sl.source, "smartlead");
assert.equal(sl.outcome, "do_not_call");
assert.equal(sl.domain, "acme-roofing.com");

const block = eventFromBlockListEntry(EMAIL);
assert.equal(block?.id, `smartlead:block:${EMAIL}`);

// --- Notes and masks never carry a raw phone/email ---
const note = alloInternalNote({
  id: ev1!.id,
  outcome: "do_not_call",
  reason: "allo_dnc",
  occurredAt: "2026-09-16T17:03:00Z",
  source: "allo",
  alloCallId: "cll-today-dnc",
  alloRep: "Alex",
  recordingUrl: ev1!.recordingUrl,
});
assert.ok(note.includes(noteMarker(ev1!.id)));
assert.ok(!note.includes("5551234567"));
assert.ok(!note.includes(EMAIL));
assert.equal(maskPhone(PHONE), "***4567");
assert.ok(!maskEmail(EMAIL).includes("owner@"));
assert.ok(!maskEmail(EMAIL).includes("acme-roofing"));

// --- Engine: one fail does not drop the others; retry is not a duplicate ---
async function main() {
  process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), "rvm-fanout-"));
  const calls: Record<string, string[]> = { rvm: [], central: [], smartlead: [], allo: [] };
  let centralFails = 1;

  const dest = (id: "rvm" | "central" | "smartlead" | "allo"): Destination => ({
    id,
    configured: () => true,
    apply: async (event) => {
      if (id === "central" && centralFails > 0) {
        centralFails -= 1;
        throw new Error("central_down");
      }
      calls[id]!.push(event.id);
      return { status: "ok" };
    },
  });

  const { addSuppression } = await import("../src/lib/store/db");
  const { runSuppressionFanout, getSuppressionFanoutStatus } = await import(
    "../src/lib/suppression-fanout/engine"
  );

  await addSuppression({
    phoneE164: PHONE,
    reason: "allo_dnc",
    source: "ALLO",
    markDnc: true,
    alloMeta: {
      alloCallId: "cll-today-dnc",
      alloRep: "Alex",
      alloLine: "+15550001111",
      rule: "allo_dnc",
      callDate: "2026-09-16T17:03:00Z",
    },
  });

  const first = await runSuppressionFanout(
    { force: true, backfill: true },
    {
      destinations: [dest("rvm"), dest("central"), dest("smartlead"), dest("allo")],
      identity: {
        listLeads: async () => [
          {
            id: "ld1",
            campaignId: "c1",
            phoneE164: PHONE,
            email: EMAIL,
            firstName: "Pat",
            lastName: "Owner",
            company: "Acme Roofing",
            custom: {},
            dnc: false,
            consentStatus: "UNKNOWN",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
        lookupMaps: async () => undefined,
      },
    },
  );

  assert.equal(first.ran, true);
  assert.equal(first.outcomes.do_not_call, 1);
  assert.equal(first.destinations.rvm.ok, 1);
  assert.equal(first.destinations.allo.ok, 1);
  assert.equal(first.destinations.smartlead.ok, 1);
  assert.equal(first.destinations.central.failed, 1);
  assert.equal(first.retrying, 1);
  assert.equal(calls.rvm.length, 1);
  assert.equal(calls.central.length, 0);

  const second = await runSuppressionFanout(
    { force: true },
    {
      destinations: [dest("rvm"), dest("central"), dest("smartlead"), dest("allo")],
      identity: {
        listLeads: async () => [],
        lookupMaps: async () => undefined,
      },
    },
  );
  assert.equal(second.destinations.central.ok, 1);
  assert.equal(second.destinations.rvm.ok, 0, "already-ok dest must not re-fire");
  assert.equal(calls.rvm.length, 1, "no double notify");
  assert.equal(calls.central.length, 1);

  const status = await getSuppressionFanoutStatus();
  const blob = JSON.stringify(status);
  assert.ok(!blob.includes("5551234567"));
  assert.ok(!blob.includes("owner@"));
  assert.ok(!blob.includes(EMAIL));
  assert.equal(status.retrying, 0);
  assert.ok("do_not_call" in status.outcomes);

  const gated = await runSuppressionFanout(
    {},
    {
      destinations: [dest("rvm")],
      identity: { listLeads: async () => [] },
    },
  );
  assert.equal(gated.ran, false);
  assert.equal(gated.skippedReason, "hourly_gate");

  await rm(process.env.DATA_DIR, { recursive: true, force: true });
}

// --- Destination policy for DNC vs live deal ---
{
  const dnc: SuppressionEvent = {
    id: "allo:x",
    source: "allo",
    sourceEventId: "x",
    outcome: "do_not_call",
    reason: "allo_dnc",
    occurredAt: "2026-09-16T17:03:00Z",
    phoneE164: PHONE,
    email: EMAIL,
    domain: "acme-roofing.com",
  };
  const booked = { ...dnc, id: "allo:y", outcome: "interested" as const, reason: "allo_tag:meeting_booked" };
  assert.equal(shouldBlockEmail(dnc.outcome) && shouldBlockDomain(dnc.outcome), true);
  assert.equal(shouldBlockEmail(booked.outcome), false);
  assert.equal(shouldPauseSequence(booked.outcome), true);
  assert.ok(identityFromEvent(dnc).email === EMAIL);
}

void main()
  .then(() => {
    console.log("suppression-fanout: ok");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
