/**
 * Daily spam / blacklist checks for RVM "from" numbers (Twilio DIDs).
 *
 * Prefer Hiya Number Reputation API when HIYA_API_KEY is set:
 * https://developer.hiya.com/docs/protect/business-partner-api/endpoints/get-reputation-for-phones
 *
 * Always also records an internal signal from our callback rates.
 */

export type ReputationLabel =
  | "UNFLAGGED"
  | "MIXED_LOW"
  | "MIXED_HIGH"
  | "FLAGGED"
  | "UNKNOWN";

export type ReputationResult = {
  e164: string;
  label: ReputationLabel;
  score?: number;
  source: "hiya" | "internal" | "manual";
  flagged: boolean;
  details?: Record<string, unknown>;
};

function normalizeHiyaLabel(raw: unknown): ReputationLabel {
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (s.includes("flag") || s.includes("spam") || s.includes("scam")) return "FLAGGED";
  if (s.includes("mixed_high") || s === "mixed-high") return "MIXED_HIGH";
  if (s.includes("mixed_low") || s === "mixed-low") return "MIXED_LOW";
  if (s.includes("unflag") || s.includes("clean") || s.includes("ok")) return "UNFLAGGED";
  return "UNKNOWN";
}

/** Hiya Business Partner reputation lookup (paid API key required). */
export async function checkHiyaReputation(
  phones: string[],
): Promise<ReputationResult[]> {
  const apiKey = process.env.HIYA_API_KEY?.trim();
  const base =
    process.env.HIYA_API_BASE?.trim() || "https://api.hiyaapi.com";
  if (!apiKey || phones.length === 0) return [];

  const qs = phones
    .slice(0, 100)
    .map((p) => `phones=${encodeURIComponent(p)}`)
    .join("&");
  const res = await fetch(`${base.replace(/\/$/, "")}/reputation?${qs}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    console.error("[reputation] hiya error", res.status, body);
    return phones.map((e164) => ({
      e164,
      label: "UNKNOWN" as const,
      source: "hiya" as const,
      flagged: false,
      details: { error: body, status: res.status },
    }));
  }

  const rows = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)
      ? ((body as { data: unknown[] }).data)
      : body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results)
        ? ((body as { results: unknown[] }).results)
        : [];

  const byPhone = new Map<string, ReputationResult>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const phone = String(r.phone ?? r.number ?? r.e164 ?? "");
    if (!phone) continue;
    const label = normalizeHiyaLabel(
      r.status ?? r.label ?? r.reputation ?? r.reputationStatus,
    );
    byPhone.set(phone, {
      e164: phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`,
      label,
      score: typeof r.score === "number" ? r.score : undefined,
      source: "hiya",
      flagged: label === "FLAGGED" || label === "MIXED_HIGH",
      details: r,
    });
  }

  return phones.map(
    (e164) =>
      byPhone.get(e164) || {
        e164,
        label: "UNKNOWN" as const,
        source: "hiya" as const,
        flagged: false,
        details: { note: "not_in_response" },
      },
  );
}

/**
 * Internal signal: if this DID's callback rate is &lt; 50% of pool average,
 * treat as degraded (doc auto-retire rule). Not a carrier spam label, but
 * a useful daily health check with no extra API.
 */
export function internalCallbackHealth(input: {
  e164: string;
  callbackRate7d: number;
  poolAvgCallbackRate7d: number;
}): ReputationResult {
  const { e164, callbackRate7d, poolAvgCallbackRate7d } = input;
  let label: ReputationLabel = "UNFLAGGED";
  let flagged = false;
  if (poolAvgCallbackRate7d > 0 && callbackRate7d < poolAvgCallbackRate7d * 0.5) {
    label = "MIXED_HIGH";
    flagged = true;
  }
  return {
    e164,
    label,
    source: "internal",
    flagged,
    details: { callbackRate7d, poolAvgCallbackRate7d },
  };
}

export function mergeReputation(
  external: ReputationResult | undefined,
  internal: ReputationResult,
): ReputationResult {
  // Worst label wins
  const rank: Record<ReputationLabel, number> = {
    UNFLAGGED: 0,
    UNKNOWN: 1,
    MIXED_LOW: 2,
    MIXED_HIGH: 3,
    FLAGGED: 4,
  };
  if (!external) return internal;
  const winner =
    rank[external.label] >= rank[internal.label] ? external : internal;
  return {
    ...winner,
    flagged: external.flagged || internal.flagged,
    details: {
      external: external.details,
      internal: internal.details,
      sources: [external.source, internal.source],
    },
  };
}
