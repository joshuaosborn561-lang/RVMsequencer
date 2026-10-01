import {
  VERIPHONE_MAX_INGEST_LOOKUPS,
  VERIPHONE_MAX_TICK_LOOKUPS,
} from "@/lib/hardening/constants";
import type { AuditEvent } from "@/lib/audit/log";
import type { LeadRecord } from "@/lib/store/types";
import { getPhoneTypeCache } from "./cache";
import { isVeriphoneEnabled } from "./client";
import { recordedResultFresh, verifyPhoneForGate } from "./gate";
import { readVeriphonePauseState } from "./state";

export type ApplyVeriphoneResult = {
  enabled: boolean;
  checked: number;
  suppressed: number;
  unverified: number;
  cached: number;
  skipped: number;
};

function sendableForGate(lead: LeadRecord): boolean {
  const status = lead.status ?? "PENDING";
  if (lead.dnc || lead.consentStatus === "OPTED_OUT") return false;
  if (status === "SUPPRESSED" || status === "SENT") return false;
  return true;
}

/**
 * Verify leads and persist SUPPRESSED + audit for non-mobile numbers.
 * Leaves unverified leads PENDING. No-ops when the gate is disabled.
 */
export async function applyVeriphoneToLeads(input: {
  campaignId: string;
  leads: LeadRecord[];
  actor?: AuditEvent["actor"];
  purpose: "ingest" | "presend";
  maxLookups?: number;
  now?: Date;
}): Promise<ApplyVeriphoneResult> {
  const empty: ApplyVeriphoneResult = {
    enabled: false,
    checked: 0,
    suppressed: 0,
    unverified: 0,
    cached: 0,
    skipped: 0,
  };
  if (!isVeriphoneEnabled()) return empty;

  const now = input.now ?? new Date();
  const maxLookups =
    input.maxLookups ??
    (input.purpose === "ingest"
      ? VERIPHONE_MAX_INGEST_LOOKUPS
      : VERIPHONE_MAX_TICK_LOOKUPS);

  const { appendAudit, getCampaign, updateLead } = await import(
    "@/lib/store/db"
  );
  const { cancelScheduledForLead } = await import("@/lib/store/scheduled");
  const campaign = await getCampaign(input.campaignId);

  const seen = new Set<string>();
  let lookups = 0;
  const out: ApplyVeriphoneResult = { ...empty, enabled: true };

  for (const lead of input.leads) {
    if (!sendableForGate(lead)) {
      out.skipped += 1;
      continue;
    }
    if (seen.has(lead.phoneE164)) {
      out.skipped += 1;
      continue;
    }
    seen.add(lead.phoneE164);

    const recorded = {
      phoneType: lead.phoneType,
      phoneValid: lead.phoneValid,
      phoneVerifiedAt: lead.phoneVerifiedAt,
    };
    const fresh = recordedResultFresh(recorded, now);
    const cached = await getPhoneTypeCache(lead.phoneE164, now);
    let probeEvenIfPaused = false;
    if (!cached && !fresh) {
      const paused = await readVeriphonePauseState();
      if (paused.paused) {
        if (lookups >= 1) {
          out.unverified += 1;
          continue;
        }
        probeEvenIfPaused = true;
      } else if (lookups >= maxLookups) {
        out.unverified += 1;
        continue;
      }
      lookups += 1;
    }

    const result = await verifyPhoneForGate(lead.phoneE164, {
      recorded,
      now,
      probeEvenIfPaused,
    });
    if (result.kind === "disabled") return empty;

    if (result.kind === "mobile") {
      out.checked += 1;
      if (result.source === "cache" || result.source === "lead") out.cached += 1;
      if (!fresh || lead.phoneType !== result.phoneType) {
        await updateLead(lead.id, {
          phoneType: result.phoneType,
          phoneValid: true,
          phoneVerifiedAt: now.toISOString(),
        });
        lead.phoneType = result.phoneType;
        lead.phoneValid = true;
        lead.phoneVerifiedAt = now.toISOString();
      }
      continue;
    }

    if (result.kind === "not_mobile") {
      out.checked += 1;
      out.suppressed += 1;
      if (result.source === "cache" || result.source === "lead") out.cached += 1;
      await updateLead(lead.id, {
        status: "SUPPRESSED",
        suppressReason: result.reason,
        lastError: result.reason,
        phoneType: result.phoneType,
        phoneValid: result.phoneValid,
        phoneVerifiedAt: now.toISOString(),
      });
      lead.status = "SUPPRESSED";
      lead.suppressReason = result.reason;
      await cancelScheduledForLead(lead.id, result.reason);
      await appendAudit({
        action: "SUPPRESSED",
        actor: input.actor ?? (input.purpose === "presend" ? "cron" : "api"),
        entityType: "lead",
        entityId: lead.id,
        campaignId: input.campaignId,
        clientId: campaign?.clientId,
        detail: {
          reason: result.reason,
          phoneType: result.phoneType,
          source: "veriphone",
          purpose: input.purpose,
        },
      });
      continue;
    }

    out.unverified += 1;
  }

  return out;
}
