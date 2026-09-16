/**
 * Cross-channel suppression events and destination receipts.
 * Destinations are plugins — add a channel by registering one more.
 */

export const DESTINATIONS = ["rvm", "central", "smartlead", "allo"] as const;
export type DestinationId = (typeof DESTINATIONS)[number];

export const OUTCOMES = [
  "do_not_call",
  "not_interested",
  "interested",
  "conversation",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type EventSource = "allo" | "rvm" | "smartlead";

export type SuppressionEvent = {
  id: string;
  source: EventSource;
  sourceEventId: string;
  outcome: Outcome;
  reason: string;
  occurredAt: string;
  phoneE164?: string;
  email?: string;
  domain?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  alloCallId?: string;
  alloRep?: string | null;
  alloLine?: string;
  recordingUrl?: string;
  direction?: string | null;
  durationSec?: number | null;
  tags?: string[];
};

export type ResolvedIdentity = {
  phoneE164?: string;
  email?: string;
  domain?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
};

export type DeliveryStatus = "ok" | "failed" | "skipped" | "pending";

export type DeliveryReceipt = {
  eventId: string;
  destination: DestinationId;
  status: DeliveryStatus;
  skipReason?: string;
  attempts: number;
  lastError?: string;
  lastAttemptAt?: string;
  okAt?: string;
};

export type DestinationApplyResult =
  | { status: "ok" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export type Destination = {
  id: DestinationId;
  configured: () => boolean;
  apply: (
    event: SuppressionEvent,
    identity: ResolvedIdentity,
  ) => Promise<DestinationApplyResult>;
};

export type OutcomeCounts = Record<Outcome, number>;
export type DestinationCounts = Record<
  DestinationId,
  { ok: number; failed: number; skipped: number; pending: number }
>;

export type FanoutRunStats = {
  at: string;
  mode: "hourly" | "backfill";
  eventsHarvested: number;
  eventsNew: number;
  eventsApplied: number;
  outcomes: OutcomeCounts;
  destinations: DestinationCounts;
  retrying: number;
  errors: number;
};

export function emptyOutcomeCounts(): OutcomeCounts {
  return {
    do_not_call: 0,
    not_interested: 0,
    interested: 0,
    conversation: 0,
  };
}

export function emptyDestinationCounts(): DestinationCounts {
  return {
    rvm: { ok: 0, failed: 0, skipped: 0, pending: 0 },
    central: { ok: 0, failed: 0, skipped: 0, pending: 0 },
    smartlead: { ok: 0, failed: 0, skipped: 0, pending: 0 },
    allo: { ok: 0, failed: 0, skipped: 0, pending: 0 },
  };
}

export function deliveryKey(eventId: string, destination: DestinationId): string {
  return `${eventId}::${destination}`;
}

export function isPermanent(outcome: Outcome): boolean {
  return outcome === "do_not_call";
}

/** Block the email (or domain for DNC-only-company) in Smartlead. */
export function shouldBlockEmail(outcome: Outcome): boolean {
  return outcome === "do_not_call" || outcome === "not_interested";
}

/** Domain-wide block only for an explicit removal request. */
export function shouldBlockDomain(outcome: Outcome): boolean {
  return outcome === "do_not_call";
}

/** Pause/unsub cold sequences without a permanent block. */
export function shouldPauseSequence(outcome: Outcome): boolean {
  return outcome === "interested" || outcome === "conversation";
}

export function shouldTagAlloDnc(outcome: Outcome): boolean {
  return outcome === "do_not_call";
}
