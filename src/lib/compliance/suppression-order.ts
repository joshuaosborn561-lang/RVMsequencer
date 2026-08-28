/**
 * Ordered pre-send suppression gates (ELI18):
 * 1) national DNC / lead.dnc
 * 2) internal opt-out
 * 3) global workspace suppression
 * 4) client-scoped exclusion (optional list)
 * 5) callback / prior disposition halt (via global suppress source CALLBACK)
 * 6) max attempts per contact per UTC day (default 3)
 *
 * External scrub (The DNC Project etc.) runs separately after this passes.
 */

export type SuppressionReason =
  | "NATIONAL_DNC"
  | "INTERNAL_OPT_OUT"
  | "GLOBAL_SUPPRESSION"
  | "CLIENT_EXCLUSION"
  | "CALLBACK_HALT"
  | "DAILY_FREQUENCY_CAP"
  | "SCRUB_BLOCKED";

export type SuppressionOrderInput = {
  phoneE164: string;
  dnc: boolean;
  consentStatus: string;
  clientId?: string | null;
  /** Workspace-wide suppressed? */
  isGloballySuppressed: boolean;
  /** Suppression source when globally suppressed (CALLBACK → halt). */
  globalSuppressSource?: string | null;
  /** Client exclusion list hit? */
  isClientExcluded?: boolean;
  /** Attempts already sent to this phone today (UTC). */
  attemptsToday: number;
  maxAttemptsPerDay?: number;
};

export type SuppressionOrderResult =
  | { blocked: false }
  | { blocked: true; reason: SuppressionReason; detail?: string };

export const DEFAULT_MAX_ATTEMPTS_PER_CONTACT_PER_DAY = 3;

export function evaluateSuppressionOrder(
  input: SuppressionOrderInput,
): SuppressionOrderResult {
  if (input.dnc) {
    return { blocked: true, reason: "NATIONAL_DNC" };
  }
  if (input.consentStatus === "OPTED_OUT") {
    return { blocked: true, reason: "INTERNAL_OPT_OUT" };
  }
  if (input.isGloballySuppressed) {
    const src = (input.globalSuppressSource ?? "").toUpperCase();
    if (src === "CALLBACK") {
      return { blocked: true, reason: "CALLBACK_HALT", detail: src };
    }
    return { blocked: true, reason: "GLOBAL_SUPPRESSION", detail: src || undefined };
  }
  if (input.isClientExcluded) {
    return { blocked: true, reason: "CLIENT_EXCLUSION", detail: input.clientId ?? undefined };
  }
  const max = input.maxAttemptsPerDay ?? DEFAULT_MAX_ATTEMPTS_PER_CONTACT_PER_DAY;
  if (input.attemptsToday >= max) {
    return {
      blocked: true,
      reason: "DAILY_FREQUENCY_CAP",
      detail: `${input.attemptsToday}/${max}`,
    };
  }
  return { blocked: false };
}

/** Map ordered reason → runAttempt SKIPPED reason. */
export function toSkipReason(
  reason: SuppressionReason,
): "DNC" | "OPTED_OUT" | "SUPPRESSED" | "SCRUB_BLOCKED" {
  switch (reason) {
    case "NATIONAL_DNC":
      return "DNC";
    case "INTERNAL_OPT_OUT":
      return "OPTED_OUT";
    case "SCRUB_BLOCKED":
      return "SCRUB_BLOCKED";
    default:
      return "SUPPRESSED";
  }
}
