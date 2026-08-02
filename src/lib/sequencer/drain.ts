import { randomUUID } from "node:crypto";
import { getDncScrubbers, getDropCoDelivery, getElevenLabs } from "@/lib/config";
import {
  HARD_CAP_ACTIVE_CAMPAIGNS,
  STALE_SENDING_MS,
} from "@/lib/hardening/constants";
import {
  nextFailureEligibleAt,
  shouldGiveUp,
} from "@/lib/sequencer/backoff";
import { humanizeSendAt } from "@/lib/sequencer/jitter";
import { campaignRampCeiling } from "@/lib/sequencer/line-picker";
import { runAttempt } from "@/lib/sequencer/run-attempt";
import {
  acquireCampaignLease,
  bumpLineSent,
  claimLeadsForDrain,
  countDueLeads,
  countSentToday,
  createAttempt,
  ensureLine,
  findSentAttempt,
  getOrgSendsToday,
  getSettings,
  incrementOrgSends,
  isSuppressed,
  listCampaigns,
  listLeads,
  listLines,
  orgDailyCap,
  releaseCampaignLease,
  updateAttempt,
  updateCampaign,
  updateLead,
} from "@/lib/store/db";
import type { CampaignRecord, LineRecord } from "@/lib/store/types";

export type DrainResult = {
  campaigns: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  suppressed: number;
  paused: string[];
  details: Array<{
    campaignId: string;
    leadId: string;
    status: string;
    reason?: string;
  }>;
};

function linesForCampaign(
  campaign: CampaignRecord,
  allLines: LineRecord[],
  minGapSec: number,
): LineRecord[] {
  const pool = campaign.lineIds.map((id) => id.trim()).filter(Boolean);
  if (pool.length === 0) return [];
  return allLines
    .filter((l) => pool.includes(l.id) || pool.includes(l.e164))
    .map((l) => ({ ...l, minGapSec: l.minGapSec ?? minGapSec }));
}

function activeDay(campaign: CampaignRecord, now: Date): number {
  const activated = campaign.ramp?.activatedAt
    ? Date.parse(campaign.ramp.activatedAt)
    : Date.parse(campaign.updatedAt);
  return Math.max(0, Math.floor((now.getTime() - activated) / 86_400_000));
}

/**
 * Hardened drain: per-campaign lease, attempt ledger, global suppression,
 * line spacing, weighted pick, ramp ceiling, org hard cap, auto-pause.
 */
export async function drainActiveCampaigns(limit = 25): Promise<DrainResult> {
  const owner = `drain_${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const settings = await getSettings();
  const minGap = settings.lineMinGapSec ?? 600;
  const orgCap = await orgDailyCap(settings);
  let orgSent = await getOrgSendsToday(now);

  let campaigns = (await listCampaigns()).filter((c) => c.status === "ACTIVE");
  if (campaigns.length > HARD_CAP_ACTIVE_CAMPAIGNS) {
    campaigns = campaigns.slice(0, HARD_CAP_ACTIVE_CAMPAIGNS);
  }

  const out: DrainResult = {
    campaigns: campaigns.length,
    claimed: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    suppressed: 0,
    paused: [],
    details: [],
  };

  const voice = process.env.ELEVENLABS_API_KEY ? getElevenLabs() : undefined;
  const allLines = await listLines();

  for (const campaign of campaigns) {
    if (out.claimed >= limit) break;
    if (orgSent >= orgCap) break;

    const leased = await acquireCampaignLease(campaign.id, owner, now);
    if (!leased) {
      out.details.push({
        campaignId: campaign.id,
        leadId: "-",
        status: "SKIPPED",
        reason: "LEASE_HELD",
      });
      continue;
    }

    try {
      const step = campaign.steps[0];
      if (!step) {
        await autoPause(campaign.id, "NO_SEQUENCE_STEP", out);
        continue;
      }

      // Ensure ad-hoc E.164s exist as line records
      for (const id of campaign.lineIds) {
        if (id.startsWith("+")) await ensureLine(id);
      }
      const freshLines = await listLines();
      const lines = linesForCampaign(campaign, freshLines, minGap);
      if (lines.length === 0) {
        await autoPause(campaign.id, "NO_LINES_CONFIGURED", out);
        continue;
      }

      const sentToday = await countSentToday(campaign.id, now);
      const rampDay = activeDay(campaign, now);
      const budget = campaignRampCeiling({
        enabled: Boolean(campaign.ramp?.enabled),
        startPerDay: campaign.ramp?.startPerDay ?? 25,
        incrementPerDay: campaign.ramp?.incrementPerDay ?? 25,
        ceilingPerDay: campaign.ramp?.ceilingPerDay ?? 200,
        activeDay: rampDay,
        newLeadsPerDay: campaign.schedule.newLeadsPerDay,
      });
      const remainingToday = Math.max(0, budget - sentToday);
      if (remainingToday <= 0) continue;

      const batch = Math.min(limit - out.claimed, remainingToday, orgCap - orgSent);
      const claimed = await claimLeadsForDrain(campaign.id, batch, now);
      out.claimed += claimed.length;

      let campaignSent = 0;
      let campaignSkipped = 0;
      let campaignFailed = 0;
      let hardProviderFail = false;

      for (const lead of claimed) {
        // Humanize: if jitter pushes past "now", soft-defer (don't burn attempt)
        const jittered = humanizeSendAt(now, { salt: lead.id });
        if (jittered.getTime() > now.getTime() + 5_000) {
          await updateLead(lead.id, {
            status: "PENDING",
            attemptCount: Math.max(0, (lead.attemptCount ?? 1) - 1),
            nextEligibleAt: jittered.toISOString(),
            lastError: "JITTER_DEFER",
          });
          campaignSkipped += 1;
          out.skipped += 1;
          continue;
        }

        const already = await findSentAttempt(campaign.id, lead.id);
        if (already) {
          await updateLead(lead.id, {
            status: "SENT",
            sentAt: already.completedAt ?? now.toISOString(),
            providerMessageId: already.providerMessageId,
          });
          continue;
        }

        const idempotencyKey = `${campaign.id}_${lead.id}_step1`;
        const attempt = await createAttempt({
          campaignId: campaign.id,
          leadId: lead.id,
          idempotencyKey,
        });
        if (attempt.status === "SENT") {
          await updateLead(lead.id, {
            status: "SENT",
            sentAt: attempt.completedAt ?? now.toISOString(),
            providerMessageId: attempt.providerMessageId,
          });
          continue;
        }
        await updateAttempt(attempt.id, { status: "SENDING" });

        const pickable = lines.map((l) => ({
          id: l.id,
          e164: l.e164,
          areaCode: l.areaCode,
          status: l.status,
          dailyCap: l.dailyCap,
          sentToday: l.sentToday,
          reputationLabel: l.reputationLabel,
          warmupDay: l.warmupDay,
          lastSentAt: l.lastSentAt,
          minGapSec: l.minGapSec,
        }));

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
          lines: pickable,
          stickyLineId: lead.stickyLineId,
          dncScrubbers: getDncScrubbers(),
          delivery: getDropCoDelivery(campaign.dropCoCampaignToken),
          voice,
          now,
          isSuppressed: (phone) => isSuppressed(phone),
        });

        if (result.status === "SENT") {
          campaignSent += 1;
          out.sent += 1;
          orgSent = await incrementOrgSends(now);
          await bumpLineSent(result.lineId, now);
          await updateAttempt(attempt.id, {
            status: "SENT",
            lineId: result.lineId,
            providerMessageId: result.providerMessageId,
            completedAt: now.toISOString(),
          });
          await updateLead(lead.id, {
            status: "SENT",
            sentAt: now.toISOString(),
            providerMessageId: result.providerMessageId,
            stickyLineId: result.lineId,
            lastError: undefined,
            nextEligibleAt: undefined,
          });
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
            result.reason === "SCRUB_BLOCKED" ||
            result.reason === "SUPPRESSED"
          ) {
            out.suppressed += 1;
            await updateAttempt(attempt.id, {
              status: "SUPPRESSED",
              reason: result.reason,
              completedAt: now.toISOString(),
            });
            await updateLead(lead.id, {
              status: "SUPPRESSED",
              dnc: true,
              suppressReason: result.reason,
              consentStatus:
                result.reason === "OPTED_OUT" ? "OPTED_OUT" : lead.consentStatus,
              lastError: result.detail ?? result.reason,
            });
          } else {
            const next =
              result.nextEligibleAt ??
              new Date(now.getTime() + 15 * 60 * 1000);
            await updateAttempt(attempt.id, {
              status: "SKIPPED",
              reason: result.reason,
              completedAt: now.toISOString(),
            });
            await updateLead(lead.id, {
              status: "PENDING",
              attemptCount: Math.max(0, (lead.attemptCount ?? 1) - 1),
              nextEligibleAt: next.toISOString(),
              lastError: result.reason,
            });
          }
        } else {
          campaignFailed += 1;
          out.failed += 1;
          const err = result.error;
          if (
            /NOT_CONFIGURED|UNAUTHORIZED|401|403|DROP_CO/i.test(err) ||
            err === "No audioUrl and no ElevenLabs voice configured"
          ) {
            hardProviderFail = true;
          }
          const attempts = lead.attemptCount ?? 1;
          await updateAttempt(attempt.id, {
            status: "FAILED",
            reason: err,
            completedAt: now.toISOString(),
          });
          if (shouldGiveUp(attempts)) {
            out.suppressed += 1;
            await updateLead(lead.id, {
              status: "SUPPRESSED",
              suppressReason: "MAX_ATTEMPTS",
              lastError: err,
            });
          } else {
            await updateLead(lead.id, {
              status: "FAILED",
              nextEligibleAt: nextFailureEligibleAt(attempts, now).toISOString(),
              lastError: err,
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

      if (hardProviderFail) {
        await autoPause(campaign.id, "PROVIDER_HARD_FAIL", out);
      }

      const leads = await listLeads(campaign.id);
      const open = leads.filter((l) => {
        const s = l.status ?? "PENDING";
        return s === "PENDING" || s === "FAILED" || s === "SENDING";
      });

      await updateCampaign(campaign.id, {
        lastDrainAt: now.toISOString(),
        lastError: hardProviderFail ? "PROVIDER_HARD_FAIL" : undefined,
        lastDrainStats: {
          attempted: claimed.length,
          sent: campaignSent,
          skipped: campaignSkipped,
          failed: campaignFailed,
        },
        ramp: campaign.ramp
          ? { ...campaign.ramp, activeDay: rampDay }
          : campaign.ramp,
        ...(open.length === 0 && leads.some((l) => l.status === "SENT")
          ? { status: "COMPLETED" as const }
          : {}),
      });
    } finally {
      await releaseCampaignLease(campaign.id, owner);
    }
  }

  return out;
}

async function autoPause(
  campaignId: string,
  reason: string,
  out: DrainResult,
) {
  await updateCampaign(campaignId, {
    status: "PAUSED",
    lastError: reason,
  });
  out.paused.push(campaignId);
  out.details.push({
    campaignId,
    leadId: "-",
    status: "PAUSED",
    reason,
  });
}

/** Reconciler: reclaim stale SENDING + report ACTIVE campaigns with due work. */
export async function reconcileCampaigns(): Promise<{
  staleReclaimed: number;
  activeWithDue: number;
}> {
  const now = new Date();
  const campaigns = (await listCampaigns()).filter((c) => c.status === "ACTIVE");
  let staleReclaimed = 0;
  let activeWithDue = 0;

  for (const c of campaigns) {
    const leads = await listLeads(c.id);
    for (const lead of leads) {
      if (
        lead.status === "SENDING" &&
        lead.lastAttemptAt &&
        now.getTime() - Date.parse(lead.lastAttemptAt) >= STALE_SENDING_MS
      ) {
        await updateLead(lead.id, {
          status: "PENDING",
          lastError: "STALE_SENDING_RECLAIMED",
        });
        staleReclaimed += 1;
      }
    }
    const due = await countDueLeads(c.id, now);
    if (due > 0) activeWithDue += 1;
  }

  return { staleReclaimed, activeWithDue };
}
