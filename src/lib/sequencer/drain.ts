import { getDncScrubbers, getDropCoDelivery, getElevenLabs } from "@/lib/config";
import { demoLines } from "@/lib/demo/data";
import { runAttempt } from "@/lib/sequencer/run-attempt";
import { listCampaigns, listLeads, updateCampaign } from "@/lib/store/db";
import type { CampaignRecord, LeadRecord } from "@/lib/store/types";

export type DrainResult = {
  campaigns: number;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  details: Array<{
    campaignId: string;
    leadId: string;
    status: string;
    reason?: string;
  }>;
};

function linesForCampaign(campaign: CampaignRecord) {
  const pool = new Set(campaign.lineIds.map((id) => id.trim()));
  const fromDemo = demoLines.filter(
    (l) => pool.size === 0 || pool.has(l.id) || pool.has(l.e164),
  );
  const source = fromDemo.length > 0 ? fromDemo : demoLines;
  return source.map((l) => ({
    id: l.id,
    e164: l.e164,
    areaCode: l.areaCode,
    status: l.status as
      | "PROVISIONING"
      | "WARMING"
      | "HEALTHY"
      | "DEGRADED"
      | "QUARANTINED"
      | "RETIRED",
    dailyCap: l.dailyCap,
    sentToday: l.sentToday,
    reputationLabel: l.reputationLabel as
      | "UNFLAGGED"
      | "MIXED_LOW"
      | "MIXED_HIGH"
      | "FLAGGED"
      | "UNKNOWN",
  }));
}

function eligibleLead(lead: LeadRecord): boolean {
  return !lead.dnc && lead.consentStatus !== "OPTED_OUT";
}

/**
 * Drain ACTIVE campaigns from the file/Postgres-backed store.
 * Cron-safe: processes up to `limit` leads per invocation.
 */
export async function drainActiveCampaigns(limit = 25): Promise<DrainResult> {
  const campaigns = (await listCampaigns()).filter((c) => c.status === "ACTIVE");
  const out: DrainResult = {
    campaigns: campaigns.length,
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  const voice = process.env.ELEVENLABS_API_KEY ? getElevenLabs() : undefined;

  for (const campaign of campaigns) {
    if (out.attempted >= limit) break;
    const leads = (await listLeads(campaign.id)).filter(eligibleLead);
    const step = campaign.steps[0];
    if (!step) continue;

    const lines = linesForCampaign(campaign);
    for (const lead of leads) {
      if (out.attempted >= limit) break;
      out.attempted += 1;

      const result = await runAttempt({
        lead: {
          id: lead.id,
          phoneE164: lead.phoneE164,
          firstName: lead.firstName,
          lastName: lead.lastName,
          company: lead.company,
          timezone: lead.timezone,
          consentStatus: lead.consentStatus,
          dnc: lead.dnc,
        },
        campaign: {
          id: campaign.id,
          scriptTemplate: step.scriptTemplate,
          audioUrl: campaign.audioUrl ?? step.audioUrl,
          elevenVoiceId: campaign.elevenVoiceId ?? step.voiceId,
          dropCoCampaignToken: campaign.dropCoCampaignToken,
          schedule: {
            sendWindowStart: campaign.schedule.sendWindowStart,
            sendWindowEnd: campaign.schedule.sendWindowEnd,
            sendDays: campaign.schedule.sendDays,
            requireConsent: campaign.schedule.requireConsent,
          },
        },
        lines,
        dncScrubbers: getDncScrubbers(),
        delivery: getDropCoDelivery(campaign.dropCoCampaignToken),
        voice,
      });

      if (result.status === "SENT") out.sent += 1;
      else if (result.status === "SKIPPED") out.skipped += 1;
      else out.failed += 1;

      out.details.push({
        campaignId: campaign.id,
        leadId: lead.id,
        status: result.status,
        reason:
          result.status === "SKIPPED"
            ? result.reason
            : result.status === "FAILED"
              ? result.error
              : undefined,
      });
    }

    // Touch updatedAt so UI shows last drain activity
    await updateCampaign(campaign.id, {});
  }

  return out;
}
