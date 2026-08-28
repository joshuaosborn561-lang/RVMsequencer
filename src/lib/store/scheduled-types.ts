export type ScheduledSendStatus =
  | "PENDING"
  | "CLAIMED"
  | "SENT"
  | "SKIPPED"
  | "FAILED"
  | "CANCELLED"
  | "SUPPRESSED";

export type ScheduledSendRecord = {
  id: string;
  campaignId: string;
  leadId: string;
  stepPosition: number;
  phoneE164: string;
  stickyLineId?: string;
  status: ScheduledSendStatus;
  runAt: string;
  claimedAt?: string;
  claimOwner?: string;
  idempotencyKey: string;
  providerMsgId?: string;
  lastError?: string;
  attemptCount: number;
  /** Provider delivery outcome after accept (webhook reconciler). */
  deliveryStatus?:
    | "queued"
    | "sent"
    | "delivered"
    | "failed"
    | "rejected"
    | "human_answered";
  createdAt: string;
  updatedAt: string;
};

/** Provider outcomes that unlock the next sequence touch. */
export const DELIVERY_UNLOCK_STATUSES = ["delivered", "sent"] as const;

export function priorStepUnlocksNext(
  deliveryStatus:
    | ScheduledSendRecord["deliveryStatus"]
    | string
    | null
    | undefined,
): boolean {
  return deliveryStatus === "delivered" || deliveryStatus === "sent";
}

/** Prior step is terminal — later touches must not send. */
export function priorStepBlocksSequence(
  prior:
    | Pick<ScheduledSendRecord, "status" | "deliveryStatus">
    | null
    | undefined,
): boolean {
  if (!prior) return true;
  if (
    prior.status === "FAILED" ||
    prior.status === "CANCELLED" ||
    prior.status === "SUPPRESSED"
  ) {
    return true;
  }
  if (
    prior.deliveryStatus === "failed" ||
    prior.deliveryStatus === "rejected" ||
    prior.deliveryStatus === "human_answered"
  ) {
    return true;
  }
  return false;
}

export function stepIdempotencyKey(
  campaignId: string,
  leadId: string,
  stepPosition: number,
): string {
  return `${campaignId}_${leadId}_step${stepPosition}`;
}
