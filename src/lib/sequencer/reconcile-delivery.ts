import {
  findAttemptByKey,
  listLeads,
  updateAttempt,
  updateLead,
} from "@/lib/store/db";
import {
  updateScheduledSendByIdempotency,
  updateScheduledSendByProviderMsg,
} from "@/lib/store/scheduled";
import type { ScheduledSendRecord } from "@/lib/store/scheduled-types";

export type ProviderDeliveryEvent = {
  provider: "DROP_CO" | "TWILIO" | "SLYBROADCAST" | "UNKNOWN";
  providerMessageId?: string;
  foreignId?: string;
  status:
    | "queued"
    | "sent"
    | "delivered"
    | "failed"
    | "rejected"
    | "human_answered";
  errorDetail?: string;
  raw?: unknown;
};

/**
 * Map provider status webhooks onto the attempt / scheduled-send ledger.
 */
export async function reconcileProviderDelivery(
  event: ProviderDeliveryEvent,
): Promise<{ ok: boolean; updated?: ScheduledSendRecord | null; reason?: string }> {
  if (!event.providerMessageId && !event.foreignId) {
    return { ok: false, reason: "missing_id" };
  }

  const statusPatch: Partial<ScheduledSendRecord> = {
    deliveryStatus: event.status,
    lastError: event.errorDetail,
  };
  if (event.status === "failed" || event.status === "rejected") {
    statusPatch.status = "FAILED";
  } else if (event.status === "delivered" || event.status === "sent") {
    statusPatch.status = "SENT";
  }
  if (event.providerMessageId) {
    statusPatch.providerMsgId = event.providerMessageId;
  }

  let row: ScheduledSendRecord | null = null;
  if (event.providerMessageId) {
    row = await updateScheduledSendByProviderMsg(
      event.providerMessageId,
      statusPatch,
    );
  }
  if (!row && event.foreignId) {
    row = await updateScheduledSendByIdempotency(event.foreignId, statusPatch);
  }

  if (!row) {
    return { ok: false, reason: "not_found" };
  }

  const existing = await findAttemptByKey(row.idempotencyKey);
  if (existing) {
    await updateAttempt(existing.id, {
      providerMessageId: event.providerMessageId ?? row.providerMsgId,
      status:
        event.status === "failed" || event.status === "rejected"
          ? "FAILED"
          : event.status === "delivered" || event.status === "sent"
            ? "SENT"
            : existing.status,
      reason: event.errorDetail,
      completedAt: new Date().toISOString(),
    });
  }

  if (event.status === "failed" || event.status === "rejected") {
    await updateLead(row.leadId, {
      lastError: event.errorDetail ?? event.status,
      status: "FAILED",
    });
  }

  if (event.status === "human_answered") {
    const leads = await listLeads(row.campaignId);
    const lead = leads.find((l) => l.id === row!.leadId);
    if (lead) {
      await updateLead(lead.id, { lastError: "HUMAN_ANSWERED" });
    }
  }

  return { ok: true, updated: row };
}
