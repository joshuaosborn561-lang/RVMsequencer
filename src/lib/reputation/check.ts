/**
 * Daily spam / blacklist checks for RVM "from" numbers (Twilio DIDs).
 *
 * Default (free): CallTracer crowd-sourced spam reports
 *   GET https://calltracer.io/api/lookup/{digits} — no API key
 *
 * Optional (paid): Hiya when HIYA_API_KEY is set — closer to carrier labels
 *
 * Callback rates are monitoring metrics only. They never become MIXED_HIGH /
 * FLAGGED and never drive degrade/quarantine. Never-sent DIDs stay UNKNOWN
 * until an external check returns a label.
 */

export type ReputationLabel =
  | "UNFLAGGED"
  | "MIXED_LOW"
  | "MIXED_HIGH"
  | "FLAGGED"
  | "UNKNOWN";

/** Persisted / UI source of the spam label. Callback rates are not a source. */
export type ReputationSource = "calltracer" | "hiya" | "manual";

export type ReputationRiskHint = "Likely spam" | "Elevated" | "Clean" | "Unknown";

export type ReputationResult = {
  e164: string;
  label: ReputationLabel;
  score?: number;
  reportCount?: number;
  source: ReputationSource;
  flagged: boolean;
  details?: Record<string, unknown>;
};

const LABEL_RANK: Record<ReputationLabel, number> = {
  UNFLAGGED: 0,
  UNKNOWN: 1,
  MIXED_LOW: 2,
  MIXED_HIGH: 3,
  FLAGGED: 4,
};

function digitsOnly(e164: string): string {
  return e164.replace(/\D/g, "");
}

/** Map CallTracer spam_score + report total onto our labels. */
export function labelFromSpamScore(
  score: number,
  reportCount: number,
): ReputationLabel {
  if (score >= 70 || reportCount >= 10) return "FLAGGED";
  if (score >= 40 || reportCount >= 3) return "MIXED_HIGH";
  if (score >= 15 || reportCount >= 1) return "MIXED_LOW";
  return "UNFLAGGED";
}

/**
 * Plain-English hint for operators. Score (when present) can raise the hint
 * above the stored label so a stale UNFLAGGED + high score still warns.
 */
export function reputationRiskHint(
  label: ReputationLabel,
  score?: number | null,
): ReputationRiskHint {
  const s = typeof score === "number" && Number.isFinite(score) ? score : null;
  if (label === "FLAGGED" || (s != null && s >= 70)) return "Likely spam";
  if (
    label === "MIXED_HIGH" ||
    label === "MIXED_LOW" ||
    (s != null && s >= 15)
  ) {
    return "Elevated";
  }
  if (label === "UNFLAGGED") return "Clean";
  return "Unknown";
}

export function lineReputationView(input: {
  reputationLabel: ReputationLabel;
  reputationScore?: number | null;
  reputationSource?: ReputationSource | null;
  reputationReportCount?: number | null;
  lastReputationCheckAt?: string | null;
}): {
  reputationLabel: ReputationLabel;
  score: number | null;
  source: ReputationSource | null;
  reportCount: number | null;
  lastReputationCheckAt: string | null;
  riskHint: ReputationRiskHint;
} {
  return {
    reputationLabel: input.reputationLabel,
    score: input.reputationScore ?? null,
    source: input.reputationSource ?? null,
    reportCount: input.reputationReportCount ?? null,
    lastReputationCheckAt: input.lastReputationCheckAt ?? null,
    riskHint: reputationRiskHint(input.reputationLabel, input.reputationScore),
  };
}

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function reportCountFromCallTracerBody(body: Record<string, unknown>): number {
  const reports =
    body.reports && typeof body.reports === "object"
      ? (body.reports as Record<string, unknown>)
      : body;
  const total = reports.total;
  return typeof total === "number" && Number.isFinite(total) ? total : 0;
}

/**
 * Free CallTracer lookup (crowd-sourced spam reports).
 * Rate limit ~10/min — we space requests for small DID pools.
 */
export async function checkCallTracerReputation(
  phones: string[],
): Promise<ReputationResult[]> {
  const out: ReputationResult[] = [];
  for (let i = 0; i < phones.length; i++) {
    const e164 = phones[i]!;
    if (i > 0) await sleep(700); // stay under ~10/min
    const digits = digitsOnly(e164);
    try {
      const res = await fetch(`https://calltracer.io/api/lookup/${digits}`, {
        headers: { Accept: "application/json" },
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body !== "object") {
        out.push({
          e164,
          label: "UNKNOWN",
          source: "calltracer",
          flagged: false,
          details: { error: body, status: res.status },
        });
        continue;
      }
      const record = body as Record<string, unknown>;
      const reports =
        (record.reports && typeof record.reports === "object"
          ? (record.reports as Record<string, unknown>)
          : {}) ?? {};
      const score =
        typeof reports.spam_score === "number" ? reports.spam_score : 0;
      const total = reportCountFromCallTracerBody(record);
      const label = labelFromSpamScore(score, total);
      out.push({
        e164,
        label,
        score,
        reportCount: total,
        source: "calltracer",
        flagged: label === "FLAGGED" || label === "MIXED_HIGH",
        details: record,
      });
    } catch (err) {
      out.push({
        e164,
        label: "UNKNOWN",
        source: "calltracer",
        flagged: false,
        details: { error: String(err) },
      });
    }
  }
  return out;
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
    const reportCount =
      typeof r.reportCount === "number"
        ? r.reportCount
        : typeof r.reports === "number"
          ? r.reports
          : undefined;
    byPhone.set(phone, {
      e164: phone.startsWith("+") ? phone : `+${phone.replace(/\D/g, "")}`,
      label,
      score: typeof r.score === "number" ? r.score : undefined,
      reportCount,
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
 * Callback-rate snapshot for ops insight only.
 * Never returns MIXED_HIGH / FLAGGED — unused DIDs (rate 0) must not be
 * branded as spam just because siblings in the pool have callbacks.
 */
export function internalCallbackHealth(input: {
  e164: string;
  callbackRate7d: number;
  poolAvgCallbackRate7d: number;
}): ReputationResult {
  const { e164, callbackRate7d, poolAvgCallbackRate7d } = input;
  return {
    e164,
    label: "UNFLAGGED",
    source: "manual",
    flagged: false,
    details: {
      callbackRate7d,
      poolAvgCallbackRate7d,
      monitoringOnly: true,
    },
  };
}

/** Merge external reputation signals; worst label wins. Do not pass internal metrics. */
export function mergeReputationResults(
  ...results: Array<ReputationResult | undefined>
): ReputationResult {
  const present = results.filter((r): r is ReputationResult => Boolean(r));
  if (present.length === 0) {
    return {
      e164: "",
      label: "UNKNOWN",
      source: "manual",
      flagged: false,
    };
  }
  let winner = present[0]!;
  for (const r of present.slice(1)) {
    if (LABEL_RANK[r.label] > LABEL_RANK[winner.label]) winner = r;
  }
  return {
    ...winner,
    flagged: present.some((r) => r.flagged),
    details: {
      sources: present.map((r) => r.source),
      bySource: Object.fromEntries(present.map((r) => [r.source, r.details ?? r])),
    },
  };
}

/** @deprecated prefer mergeReputationResults — second arg is ignored for labels */
export function mergeReputation(
  external: ReputationResult | undefined,
  _internal?: ReputationResult,
): ReputationResult {
  return mergeReputationResults(external);
}
