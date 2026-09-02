/**
 * Append-only audit trail for sequencer / compliance actions.
 * Never mutate or delete events — only append.
 */

export type AuditAction =
  | "CAMPAIGN_ACTIVATED"
  | "CAMPAIGN_PAUSED"
  | "ATTEMPT_SENT"
  | "ATTEMPT_SKIPPED"
  | "ATTEMPT_FAILED"
  | "SUPPRESSED"
  | "LINE_QUARANTINED"
  | "LINE_DEGRADED"
  | "REPUTATION_CHECK"
  | "SEED_INJECTED"
  | "WARMUP_ADVANCED"
  | "SETTINGS_UPDATED"
  | "FCR_UPDATED"
  | "QUIET_HOURS_APPLIED"
  | "RECEIPT_HEALTH";

export type AuditEvent = {
  id: string;
  at: string;
  action: AuditAction;
  actor: "system" | "cron" | "mcp" | "api" | "webhook" | "user";
  entityType: string;
  entityId?: string;
  campaignId?: string;
  clientId?: string;
  detail?: Record<string, unknown>;
};

export function createAuditEvent(
  partial: Omit<AuditEvent, "id" | "at"> & { at?: string; id?: string },
): AuditEvent {
  return {
    id: partial.id ?? `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: partial.at ?? new Date().toISOString(),
    action: partial.action,
    actor: partial.actor,
    entityType: partial.entityType,
    entityId: partial.entityId,
    campaignId: partial.campaignId,
    clientId: partial.clientId,
    detail: partial.detail,
  };
}
