import { getDncScrubbers, getDropCoDelivery, getElevenLabs } from "@/lib/config";
import { demoLines } from "@/lib/demo/data";
import {
  nextFailureEligibleAt,
  shouldGiveUp,
} from "@/lib/sequencer/backoff";
import { runAttempt } from "@/lib/sequencer/run-attempt";
import {
  claimLeadsForDrain,
  countSentToday,
  listCampaigns,
  listLeads,
  updateCampaign,
  updateLead,
} from "@/lib/store/db";
import type { CampaignRecord } from "@/lib/store/types";

export type DrainResult = {
  campaigns: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  suppressed: number;
  details: Array<{
    campaignId: string;
    leadId: string;
    status: string;
    reason?: string;
  }>;
};

function linesForCampaign(campaign: CampaignRecord) {
  const pool = campaign.lineIds.map((id) => id.trim()).filter(Boolean);
  if (pool.length === 0) return [];

  const matched = demoLines.filter(
    (l) => pool.includes(l.id) || pool.includes(l.e164),
  );

  // Allow ad-hoc E.164 lines not in demo inventory (still fail closed if none parse).
  const known = new Set(matched.flatMap((l) => [l.id, l.e164]));
  const extras = pool
    .filter((p) => p.startsWith("+") && !known.has(p))
    .map((e164, i) => ({
      id: `adhoc_${i}`,
      e164,
      areaCode: e164.replace(/\D/g, "").slice(1, 4),
      status: "HEALTHY" as const,
      dailyCap: 80,
      sentToday: 0,
      reputationLabel: "UNKNOWN" as const,
    }));

  return [...matched, ...extras].map((l) => ({
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

/**
 * Drain ACTIVE campaigns with enrollment state:
 * claim → attempt → persist SENT / nextEligibleAt / FAILED backoff / SUPPRESSED.
 * Safe to run on a 5‑minute cron without re-depositing the same lead.
 */
export async function drainActiveCampaigns(limit = 25): Promise<DrainResult> {
  const campaigns = (await listCampaigns()).filter((c) => c.status === "ACTIVE");
  const out: DrainResult = {
    campaigns: campaigns.length,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    suppressed: 0,
    details: [],
  };

  const voice = process.env.ELEVENLABS_API_KEY ? getElevenLabs() : undefined;
  const now = new Date();

  for (const campaign of campaigns) {
    if (out.claimed >= limit) break;

    const step = campaign.steps[0];
    if (!step) continue;

    const lines = linesForCampaign(campaign);
    if (lines.length === 0) {
      out.details.push({
        campaignId: campaign.id,
        leadId: "-",
        status: "FAILED",
        reason: "NO_LINES_CONFIGURED",
      });
      continue;
    }

    const sentToday = await countSentToday(campaign.id, now);
    const remainingToday = Math.max(
      0,
      campaign.schedule.newLeadsPerDay - sentToday,
    );
    if (remainingToday <= 0) continue;

    const batch = Math.min(limit - out.claimed, remainingToday);
    const claimed = await claimLeadsForDrain(campaign.id, batch, now);
    out.claimed += claimed.length;

    let campaignSent = 0;
    let campaignSkipped = 0;
    let campaignFailed = 0;

    for (const lead of claimed) {
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
        now,
      });

      if (result.status === "SENT") {
        campaignSent += 1;
        out.sent += 1;
        await updateLead(lead.id, {
          status: "SENT",
          sentAt: now.toISOString(),
          providerMessageId: result.providerMessageId,
          lastError: undefined,
          nextEligibleAt: undefined,
        });
        // Persist generate-once audio on campaign
        if (result.audioUrl && !campaign.audioUrl) {
          await updateCampaign(campaign.id, { audioUrl: result.audioUrl });
          campaign.audioUrl = result.audioUrl;
        }
      } else if (result.status === "SKIPPED") {
        campaignSkipped += 1;
        out.skipped += 1;
        if (
          result.reason === "DNC" ||
          result.reason === "OPTED_OUT" ||
          result.reason === "SCRUB_BLOCKED"
        ) {
          out.suppressed += 1;
          await updateLead(lead.id, {
            status: "SUPPRESSED",
            dnc: true,
            suppressReason: result.reason,
            consentStatus:
              result.reason === "OPTED_OUT" ? "OPTED_OUT" : lead.consentStatus,
            lastError: result.detail ?? result.reason,
          });
        } else {
          // Soft skip (window / capacity) — do NOT burn an attempt forever.
          const next =
            result.nextEligibleAt ??
            new Date(now.getTime() + 15 * 60 * 1000);
          await updateLead(lead.id, {
            status: "PENDING",
            // Undo the claim increment for soft skips so window waits don't burn retries
            attemptCount: Math.max(0, (lead.attemptCount ?? 1) - 1),
            nextEligibleAt: next.toISOString(),
            lastError: result.reason,
          });
        }
      } else {
        campaignFailed += 1;
        out.failed += 1;
        const attempts = lead.attemptCount ?? 1;
        if (shouldGiveUp(attempts)) {
          out.suppressed += 1;
          await updateLead(lead.id, {
            status: "SUPPRESSED",
            suppressReason: "MAX_ATTEMPTS",
            lastError: result.error,
          });
        } else {
          await updateLead(lead.id, {
            status: "FAILED",
            nextEligibleAt: nextFailureEligibleAt(attempts, now).toISOString(),
            lastError: result.error,
          });
        }
      }

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

    const leads = await listLeads(campaign.id);
    const open = leads.filter((l) => {
      const s = l.status ?? "PENDING";
      return s === "PENDING" || s === "FAILED" || s === "SENDING";
    });
    await updateCampaign(campaign.id, {
      lastDrainAt: now.toISOString(),
      lastDrainStats: {
        attempted: claimed.length,
        sent: campaignSent,
        skipped: campaignSkipped,
        failed: campaignFailed,
      },
      ...(open.length === 0 && leads.some((l) => l.status === "SENT")
        ? { status: "COMPLETED" as const }
        : {}),
    });
  }

  return out;
}
