/**
 * Hourly fan-out: harvest decisions, apply every destination, retry failures.
 * Adding a channel is registering one more Destination.
 */

import { listAllLeads, listSuppressions } from "@/lib/store/db";
import { isAlloSyncConfigured, listAlloTags } from "@/lib/allo/client";
import { DNC_TAG } from "@/lib/allo/rules";
import { isSmartleadConfigured } from "@/lib/smartlead/client";
import { defaultDestinations } from "./destinations";
import {
  harvestAlloEvents,
  harvestRvmEvents,
  harvestSmartleadBlockList,
  harvestSmartleadQueue,
} from "./harvest";
import { hasAnyIdentity, resolveIdentity, type IdentityLookup } from "./identity";
import {
  enqueueSmartleadUnsub,
  getFanoutState,
  readSmartleadQueue,
  saveFanoutState,
  writeSmartleadQueue,
  type FanoutState,
  type SmartleadQueueItem,
} from "./state";
import {
  DESTINATIONS,
  deliveryKey,
  emptyDestinationCounts,
  emptyOutcomeCounts,
  type DeliveryReceipt,
  type Destination,
  type FanoutRunStats,
  type SuppressionEvent,
} from "./types";

export type FanoutResult = FanoutRunStats & {
  ran: boolean;
  skippedReason?: string;
};

export type FanoutDeps = {
  destinations: Destination[];
  identity: IdentityLookup;
  now?: () => Date;
};

export function defaultFanoutDeps(): FanoutDeps {
  return {
    destinations: defaultDestinations,
    identity: { listLeads: listAllLeads },
  };
}

function bump(
  dest: FanoutRunStats["destinations"],
  receipt: DeliveryReceipt,
) {
  dest[receipt.destination][receipt.status] += 1;
}

async function applyOne(
  event: SuppressionEvent,
  dest: Destination,
  state: FanoutState,
  deps: FanoutDeps,
): Promise<DeliveryReceipt> {
  const key = deliveryKey(event.id, dest.id);
  const prev = state.deliveries[key];
  if (prev?.status === "ok" || prev?.status === "skipped") return prev;

  const receipt: DeliveryReceipt = {
    eventId: event.id,
    destination: dest.id,
    status: "pending",
    attempts: prev?.attempts ?? 0,
  };

  if (!dest.configured()) {
    receipt.status = "pending";
    receipt.lastError = "not_configured";
    receipt.lastAttemptAt = new Date().toISOString();
    state.deliveries[key] = receipt;
    return receipt;
  }

  try {
    const identity = await resolveIdentity(event, deps.identity);
    if (identity.email && !event.email) event.email = identity.email;
    if (identity.domain && !event.domain) event.domain = identity.domain;
    if (identity.phoneE164 && !event.phoneE164) event.phoneE164 = identity.phoneE164;
    if (identity.firstName && !event.firstName) event.firstName = identity.firstName;
    if (identity.lastName && !event.lastName) event.lastName = identity.lastName;
    if (identity.company && !event.company) event.company = identity.company;
    state.events[event.id] = event;
    if (!hasAnyIdentity(identity) && dest.id !== "rvm") {
      receipt.status = "skipped";
      receipt.skipReason = "no_identity";
      receipt.lastAttemptAt = new Date().toISOString();
      state.deliveries[key] = receipt;
      return receipt;
    }
    const result = await dest.apply(event, identity);
    receipt.attempts += 1;
    receipt.lastAttemptAt = new Date().toISOString();
    if (result.status === "ok") {
      receipt.status = "ok";
      receipt.okAt = receipt.lastAttemptAt;
    } else if (result.status === "skipped") {
      receipt.status = "skipped";
      receipt.skipReason = result.reason;
    } else {
      receipt.status = "failed";
      receipt.lastError = result.error;
    }
  } catch (err) {
    receipt.attempts += 1;
    receipt.status = "failed";
    receipt.lastError = err instanceof Error ? err.message : "apply_failed";
    receipt.lastAttemptAt = new Date().toISOString();
  }
  state.deliveries[key] = receipt;
  return receipt;
}

async function harvest(state: FanoutState): Promise<SuppressionEvent[]> {
  const rows = await listSuppressions();
  const known = new Set(Object.keys(state.events));
  const alloKnown = new Set(state.harvested.allo);
  const rvmKnown = new Set(state.harvested.rvm);
  const slKnown = new Set(state.harvested.smartlead);

  const allo = harvestAlloEvents(rows, new Set([...known, ...alloKnown]));
  const rvm = harvestRvmEvents(rows, new Set([...known, ...rvmKnown]));

  const queue = await readSmartleadQueue();
  const slQueue = harvestSmartleadQueue(queue, new Set([...known, ...slKnown]));
  if (slQueue.consumedIds.length > 0) {
    const leftover = queue.filter((q) => !slQueue.consumedIds.includes(q.id));
    await writeSmartleadQueue(leftover);
  }

  let slBlock: SuppressionEvent[] = [];
  if (isSmartleadConfigured()) {
    try {
      slBlock = await harvestSmartleadBlockList(new Set([...known, ...slKnown]));
    } catch (err) {
      console.error(
        "[fanout] smartlead block-list harvest failed",
        err instanceof Error ? err.message : "error",
      );
    }
  }

  const fresh = [...allo, ...rvm, ...slQueue.events, ...slBlock];
  for (const ev of allo) state.harvested.allo.push(ev.id);
  for (const ev of rvm) state.harvested.rvm.push(ev.id);
  for (const ev of [...slQueue.events, ...slBlock]) {
    state.harvested.smartlead.push(ev.id);
  }
  return fresh;
}

export async function ingestSmartleadUnsub(item: SmartleadQueueItem): Promise<void> {
  await enqueueSmartleadUnsub(item);
}

export async function runSuppressionFanout(
  opts?: { backfill?: boolean; force?: boolean },
  deps: FanoutDeps = defaultFanoutDeps(),
): Promise<FanoutResult> {
  const now = deps.now?.() ?? new Date();
  const state = await getFanoutState();
  const doBackfill = Boolean(opts?.backfill) || !state.backfillCompletedAt;
  const stats: FanoutRunStats = {
    at: now.toISOString(),
    mode: doBackfill ? "backfill" : "hourly",
    eventsHarvested: 0,
    eventsNew: 0,
    eventsApplied: 0,
    outcomes: emptyOutcomeCounts(),
    destinations: emptyDestinationCounts(),
    retrying: 0,
    errors: 0,
  };

  if (!doBackfill && !opts?.force && state.lastRun?.at) {
    const elapsed = now.getTime() - Date.parse(state.lastRun.at);
    if (elapsed < 55 * 60 * 1000) {
      return {
        ran: false,
        skippedReason: "hourly_gate",
        ...stats,
        at: state.lastRun.at,
        outcomes: state.lastRun.outcomes,
        destinations: state.lastRun.destinations,
        retrying: state.lastRun.retrying,
      };
    }
  }

  if (isAlloSyncConfigured()) {
    try {
      const tags = await listAlloTags();
      state.alloTagPresent = tags.some(
        (t) => (t.key ?? t.name ?? "").toLowerCase() === DNC_TAG,
      );
    } catch {
      /* tag catalog is advisory */
    }
  }

  const harvested = await harvest(state);
  stats.eventsHarvested = harvested.length;
  for (const ev of harvested) {
    if (!state.events[ev.id]) {
      state.events[ev.id] = ev;
      stats.eventsNew += 1;
    }
  }

  const needsWork = (ev: SuppressionEvent) =>
    deps.destinations.some((dest) => {
      const prev = state.deliveries[deliveryKey(ev.id, dest.id)];
      return !prev || prev.status === "failed" || prev.status === "pending";
    });

  const toApply = Object.values(state.events).filter(
    (ev) => harvested.some((h) => h.id === ev.id) || needsWork(ev),
  );

  for (const ev of harvested) {
    stats.outcomes[ev.outcome] += 1;
  }

  for (const ev of toApply) {
    for (const dest of deps.destinations) {
      const before = state.deliveries[deliveryKey(ev.id, dest.id)];
      if (before?.status === "ok" || before?.status === "skipped") continue;
      const receipt = await applyOne(ev, dest, state, deps);
      bump(stats.destinations, receipt);
      if (receipt.status === "ok") stats.eventsApplied += 1;
      if (receipt.status === "failed" || receipt.status === "pending") {
        stats.retrying += 1;
        if (receipt.status === "failed") stats.errors += 1;
      }
    }
  }

  for (const id of DESTINATIONS) {
    stats.destinations[id] = stats.destinations[id] ?? {
      ok: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
    };
  }

  state.lastRun = stats;
  if (stats.errors === 0) {
    state.cursorIso = now.toISOString();
    if (doBackfill) state.backfillCompletedAt = now.toISOString();
  }
  await saveFanoutState(state);

  return { ran: true, ...stats };
}

export async function getSuppressionFanoutStatus() {
  const state = await getFanoutState();
  const lr = state.lastRun;
  const destConfigured = {
    rvm: true,
    central: Boolean(
      process.env.SUPABASE_URL?.trim() &&
        (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
          process.env.SUPABASE_ANON_KEY?.trim()),
    ),
    smartlead: isSmartleadConfigured(),
    allo: isAlloSyncConfigured(),
  };
  return {
    backfillCompletedAt: state.backfillCompletedAt ?? null,
    lastRunAt: lr?.at ?? null,
    lastRunMode: lr?.mode ?? null,
    eventsTracked: Object.keys(state.events).length,
    eventsHarvested: lr?.eventsHarvested ?? 0,
    eventsNew: lr?.eventsNew ?? 0,
    outcomes: lr?.outcomes ?? emptyOutcomeCounts(),
    destinations: lr?.destinations ?? emptyDestinationCounts(),
    destinationsConfigured: destConfigured,
    retrying: lr?.retrying ?? 0,
    errors: lr?.errors ?? 0,
    alloDoNotCallTagPresent: state.alloTagPresent ?? null,
  };
}
