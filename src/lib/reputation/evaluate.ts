export type ReputationSignals = {
  deliveryRate7d?: number | null;
  callbackRate7d?: number | null;
  optOutRate7d?: number | null;
  spamLabel: "UNFLAGGED" | "MIXED_LOW" | "MIXED_HIGH" | "FLAGGED" | "UNKNOWN";
  attempts7d: number;
};

export type ReputationAction =
  | { action: "keep"; statusHint: "HEALTHY" | "WARMING" }
  | { action: "degrade"; statusHint: "DEGRADED"; reason: string }
  | { action: "quarantine"; statusHint: "QUARANTINED"; reason: string };

/**
 * Burned-line heuristics for the deliverability monitor.
 * Thresholds are starting defaults — tune from live webhook data.
 */
export function evaluateLineHealth(signals: ReputationSignals): ReputationAction {
  if (signals.spamLabel === "FLAGGED") {
    return {
      action: "quarantine",
      statusHint: "QUARANTINED",
      reason: "Carrier analytics spam label (FLAGGED)",
    };
  }
  if (signals.spamLabel === "MIXED_HIGH") {
    return {
      action: "degrade",
      statusHint: "DEGRADED",
      reason: "Elevated spam labeling (MIXED_HIGH)",
    };
  }
  if (
    signals.attempts7d >= 40 &&
    signals.deliveryRate7d != null &&
    signals.deliveryRate7d < 0.45
  ) {
    return {
      action: "quarantine",
      statusHint: "QUARANTINED",
      reason: `Delivery rate ${(signals.deliveryRate7d * 100).toFixed(0)}% over 7d`,
    };
  }
  if (
    signals.attempts7d >= 30 &&
    signals.deliveryRate7d != null &&
    signals.deliveryRate7d < 0.6
  ) {
    return {
      action: "degrade",
      statusHint: "DEGRADED",
      reason: `Soft delivery drop (${(signals.deliveryRate7d * 100).toFixed(0)}%)`,
    };
  }
  if (signals.optOutRate7d != null && signals.optOutRate7d > 0.03) {
    return {
      action: "degrade",
      statusHint: "DEGRADED",
      reason: "Opt-out rate > 3%",
    };
  }
  if (
    signals.attempts7d >= 50 &&
    signals.callbackRate7d != null &&
    signals.callbackRate7d < 0.005
  ) {
    return {
      action: "degrade",
      statusHint: "DEGRADED",
      reason: "Callback rate collapsed vs healthy baseline",
    };
  }
  return { action: "keep", statusHint: "HEALTHY" };
}
