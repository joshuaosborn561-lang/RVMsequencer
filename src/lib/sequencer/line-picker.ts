export type PickableLine = {
  id: string;
  e164: string;
  areaCode?: string | null;
  status: "PROVISIONING" | "WARMING" | "HEALTHY" | "DEGRADED" | "QUARANTINED" | "RETIRED";
  dailyCap: number;
  sentToday: number;
  reputationLabel: "UNFLAGGED" | "MIXED_LOW" | "MIXED_HIGH" | "FLAGGED" | "UNKNOWN";
  warmupDay?: number;
  lastSentAt?: string | null;
  minGapSec?: number;
  registeredFcr?: boolean;
};

const ELIGIBLE = new Set(["WARMING", "HEALTHY", "DEGRADED"]);

export type PickLineOptions = {
  now?: Date;
  stickyLineId?: string;
  mode?: "weighted" | "lru" | "round_robin";
  roundRobinAfterId?: string;
  /** When true, only lines with registeredFcr may be picked. */
  requireFcr?: boolean;
};

/**
 * Pick a line for the next RVM (Warmbly-style mailbox-first):
 * capacity + min gap + FCR + local presence + reputation + warmup weight.
 */
export function pickLine(
  lines: PickableLine[],
  destinationE164: string,
  opts?: PickLineOptions,
): PickableLine | null {
  const now = opts?.now ?? new Date();
  const destArea = areaCodeFromE164(destinationE164);

  const candidates = lines
    .filter((l) => ELIGIBLE.has(l.status))
    .filter((l) => l.sentToday < l.dailyCap)
    .filter((l) => l.reputationLabel !== "FLAGGED")
    .filter((l) => (opts?.requireFcr ? Boolean(l.registeredFcr) : true))
    .filter((l) => respectsMinGap(l, now));

  if (candidates.length === 0) return null;

  if (opts?.stickyLineId) {
    const sticky = candidates.find((c) => c.id === opts.stickyLineId);
    if (sticky) return sticky;
  }

  const mode = opts?.mode ?? "weighted";
  if (mode === "lru") {
    return [...candidates].sort((a, b) => {
      const at = a.lastSentAt ? Date.parse(a.lastSentAt) : 0;
      const bt = b.lastSentAt ? Date.parse(b.lastSentAt) : 0;
      return at - bt;
    })[0]!;
  }

  if (mode === "round_robin") {
    if (!opts?.roundRobinAfterId) return candidates[0]!;
    const idx = candidates.findIndex((c) => c.id === opts.roundRobinAfterId);
    return candidates[(idx + 1) % candidates.length]!;
  }

  const scored = candidates.map((line) => {
    let score = 0;
    if (destArea && line.areaCode === destArea) score += 100;
    score += reputationScore(line.reputationLabel);
    const remaining = line.dailyCap - line.sentToday;
    score += remaining * 2;
    score += Math.min(line.warmupDay ?? 0, 30);
    if (line.status === "HEALTHY") score += 10;
    if (line.status === "DEGRADED") score -= 15;
    if (line.registeredFcr) score += 5;
    score += Math.random() * 3;
    return { line, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.line ?? null;
}

function respectsMinGap(line: PickableLine, now: Date): boolean {
  if (!line.lastSentAt || !line.minGapSec) return true;
  const elapsed = (now.getTime() - Date.parse(line.lastSentAt)) / 1000;
  return elapsed >= line.minGapSec;
}

export function areaCodeFromE164(e164: string): string | null {
  const digits = e164.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return null;
}

function reputationScore(label: PickableLine["reputationLabel"]): number {
  switch (label) {
    case "UNFLAGGED":
      return 30;
    case "UNKNOWN":
      return 15;
    case "MIXED_LOW":
      return 5;
    case "MIXED_HIGH":
      return -20;
    case "FLAGGED":
      return -100;
  }
}

export function poolRemainingCapacity(lines: PickableLine[]): number {
  return lines
    .filter((l) => ELIGIBLE.has(l.status) && l.reputationLabel !== "FLAGGED")
    .reduce((sum, l) => sum + Math.max(0, l.dailyCap - l.sentToday), 0);
}

/** @deprecated Campaign ramp removed — always returns a no-op high ceiling. */
export function campaignRampCeiling(_input: {
  enabled: boolean;
  startPerDay: number;
  incrementPerDay: number;
  ceilingPerDay: number;
  activeDay: number;
  newLeadsPerDay: number;
}): number {
  return Number.MAX_SAFE_INTEGER;
}
