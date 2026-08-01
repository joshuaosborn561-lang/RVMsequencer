export type PickableLine = {
  id: string;
  e164: string;
  areaCode?: string | null;
  status: "PROVISIONING" | "WARMING" | "HEALTHY" | "DEGRADED" | "QUARANTINED" | "RETIRED";
  dailyCap: number;
  sentToday: number;
  reputationLabel: "UNFLAGGED" | "MIXED_LOW" | "MIXED_HIGH" | "FLAGGED" | "UNKNOWN";
};

const ELIGIBLE = new Set(["WARMING", "HEALTHY", "DEGRADED"]);

/**
 * Pick a line for the next RVM, preferring:
 * 1. Eligible status + remaining daily capacity
 * 2. Local presence (matching area code)
 * 3. Healthiest reputation
 * 4. Lowest utilization today (spread load like Smartlead inbox rotation)
 */
export function pickLine(
  lines: PickableLine[],
  destinationE164: string,
): PickableLine | null {
  const destArea = areaCodeFromE164(destinationE164);
  const candidates = lines
    .filter((l) => ELIGIBLE.has(l.status))
    .filter((l) => l.sentToday < l.dailyCap)
    .filter((l) => l.reputationLabel !== "FLAGGED");

  if (candidates.length === 0) return null;

  const scored = candidates.map((line) => {
    let score = 0;
    if (destArea && line.areaCode === destArea) score += 100;
    score += reputationScore(line.reputationLabel);
    const utilization = line.sentToday / Math.max(line.dailyCap, 1);
    score += (1 - utilization) * 20;
    if (line.status === "HEALTHY") score += 10;
    if (line.status === "DEGRADED") score -= 15;
    return { line, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.line ?? null;
}

export function areaCodeFromE164(e164: string): string | null {
  const digits = e164.replace(/\D/g, "");
  // US/CA: 1 + NPA + NXX + XXXX
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1, 4);
  if (digits.length === 10) return digits.slice(0, 3);
  return null;
}

function reputationScore(
  label: PickableLine["reputationLabel"],
): number {
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

/** Remaining capacity across the pool for pacing campaigns. */
export function poolRemainingCapacity(lines: PickableLine[]): number {
  return lines
    .filter((l) => ELIGIBLE.has(l.status) && l.reputationLabel !== "FLAGGED")
    .reduce((sum, l) => sum + Math.max(0, l.dailyCap - l.sentToday), 0);
}
