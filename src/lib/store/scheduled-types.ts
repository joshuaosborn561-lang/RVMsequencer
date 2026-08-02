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

export function stepIdempotencyKey(
  campaignId: string,
  leadId: string,
  stepPosition: number,
): string {
  return `${campaignId}_${leadId}_step${stepPosition}`;
}
