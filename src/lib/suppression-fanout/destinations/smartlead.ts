import {
  addToBlockList,
  findLeadCampaignIds,
  isSmartleadConfigured,
  unsubscribeCampaignLead,
  unsubscribeLeadGlobal,
} from "@/lib/smartlead/client";
import {
  shouldBlockDomain,
  shouldBlockEmail,
  shouldPauseSequence,
  type Destination,
  type DestinationApplyResult,
  type ResolvedIdentity,
  type SuppressionEvent,
} from "../types";

export const smartleadDestination: Destination = {
  id: "smartlead",
  configured: isSmartleadConfigured,
  apply: applySmartlead,
};

export async function applySmartlead(
  event: SuppressionEvent,
  identity: ResolvedIdentity,
): Promise<DestinationApplyResult> {
  if (!isSmartleadConfigured()) {
    return { status: "failed", error: "smartlead_not_configured" };
  }
  if (event.source === "smartlead" && shouldBlockEmail(event.outcome)) {
    return { status: "ok" };
  }

  const email = identity.email;
  const domain = identity.domain;

  if (shouldBlockEmail(event.outcome)) {
    if (email) {
      const blocked = await addToBlockList({ email });
      if (!blocked.ok) {
        return { status: "failed", error: `block_email_${blocked.status}` };
      }
      const found = await findLeadCampaignIds(email).catch(() => ({
        leadId: "" as const,
        campaignIds: [] as Array<string | number>,
      }));
      if (found.leadId) {
        const unsub = await unsubscribeLeadGlobal(found.leadId);
        if (!unsub.ok) {
          return { status: "failed", error: `unsub_${unsub.status}` };
        }
      }
      return { status: "ok" };
    }
    if (shouldBlockDomain(event.outcome) && domain) {
      const blocked = await addToBlockList({ domain });
      if (!blocked.ok) {
        return { status: "failed", error: `block_domain_${blocked.status}` };
      }
      return { status: "ok" };
    }
    return { status: "skipped", reason: "no_email_or_domain" };
  }

  if (shouldPauseSequence(event.outcome)) {
    if (!email) return { status: "skipped", reason: "no_email" };
    const found = await findLeadCampaignIds(email);
    if (!found.leadId) return { status: "skipped", reason: "lead_not_found" };
    if (found.campaignIds.length === 0) {
      // Global unsub would be a permanent block — skip; they are a live deal.
      return { status: "skipped", reason: "no_campaign_membership" };
    }
    let failed = 0;
    for (const campaignId of found.campaignIds) {
      const r = await unsubscribeCampaignLead(campaignId, found.leadId);
      if (!r.ok) failed += 1;
    }
    if (failed === found.campaignIds.length) {
      return { status: "failed", error: "pause_all_failed" };
    }
    return { status: "ok" };
  }

  return { status: "skipped", reason: "no_smartlead_action" };
}
