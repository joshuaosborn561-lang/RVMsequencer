import { randomUUID } from "node:crypto";
import { getDncScrubbers, getDefaultDelivery } from "@/lib/config";
import { HARD_CAP_ACTIVE_CAMPAIGNS } from "@/lib/hardening/constants";
import {
  nextFailureEligibleAt,
  shouldGiveUp,
} from "@/lib/sequencer/backoff";
import { humanizeSendAt } from "@/lib/sequencer/jitter";
import { campaignRampCeiling } from "@/lib/sequencer/line-picker";
import {
  poolExhausted,
  rebalanceOnCapacityExhausted,
} from "@/lib/sequencer/rebalance";
import { runAttempt } from "@/lib/sequencer/run-attempt";
import {
  acquireCampaignLease,
  bumpLineSent,
  countSentToday,
  createAttempt,
  ensureLine,
  findSentAttemptForStep,
  getSettings,
  isSuppressed,
  listCampaigns,
  listLeads,
  listLines,
  releaseCampaignLease,
  updateAttempt,
  updateCampaign,
  updateLead,
} from "@/lib/store/db";
import {
  getSharedOrgSendsToday,
  incrementSharedOrgSends,
  sharedOrgDailyCap,
} from "@/lib/store/org-counters";
import {
  cancelSubsequentSteps,
  claimScheduledSends,
  countDueScheduled,
  countPendingScheduled,
  deferScheduledSend,
  updateScheduledSend,
} from "@/lib/store/scheduled";
import type { CampaignRecord, LeadRecord, LineRecord } from "@/lib/store/types";

export type DrainResult = {
  campaigns: number;
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  suppressed: number;
  rebalanced: number;
  paused: string[];
  details: Array<{
    campaignId: string;
    leadId: string;
    step?: number;
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

function stepFor(
  campaign: CampaignRecord,
  position: number,
) {
  return campaign.steps.find((s) => s.position === position);
}

/**
 * Hardened multi-step drain: SKIP LOCKED scheduled sends, leases, suppression,
 * line spacing, sticky DID, ramp, org cap, rebalance, auto-pause.
 */
export async function drainActiveCampaigns(
  limit = 25,
  opts?: { immediate?: boolean },
): Promise<DrainResult> {
  const owner = `drain_${randomUUID().slice(0, 8)}`;
  const now = new Date();
  const settings = await getSettings();
  const minGap = settings.lineMinGapSec ?? 600;
  const orgCap = await sharedOrgDailyCap();
  let orgSent = await getSharedOrgSendsToday(now);
  const immediate = Boolean(opts?.immediate);

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
    rebalanced: 0,
    paused: [],
    details: [],
  };

  const statusWebhook =
    process.env.NEXT_PUBLIC_APP_URL && process.env.RVM_STATUS_WEBHOOK_SECRET
      ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/rvm-status`
      : undefined;

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
      if (campaign.steps.length === 0) {
        await autoPause(campaign.id, "NO_SEQUENCE_STEP", out);
        continue;
      }

      for (const id of campaign.lineIds) {
        if (id.startsWith("+")) await ensureLine(id);
      }
      let lines = linesForCampaign(campaign, await listLines(), minGap);
      if (lines.length === 0) {
        await autoPause(campaign.id, "NO_LINES_CONFIGURED", out);
        continue;
      }

      if (poolExhausted(lines, now)) {
        const { deferred } = await rebalanceOnCapacityExhausted({
          campaignId: campaign.id,
          lines,
          now,
        });
        out.rebalanced += deferred;
        out.details.push({
          campaignId: campaign.id,
          leadId: "-",
          status: "REBALANCED",
          reason: "POOL_EXHAUSTED",
        });
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
      const claimed = await claimScheduledSends({
        campaignId: campaign.id,
        limit: batch,
        owner,
        now,
      });
      out.claimed += claimed.length;

      const leadsById = new Map(
        (await listLeads(campaign.id)).map((l) => [l.id, l]),
      );

      let campaignSent = 0;
      let campaignSkipped = 0;
      let campaignFailed = 0;
      let hardProviderFail = false;
      let hitCapacity = false;

      for (const sch of claimed) {
        const lead = leadsById.get(sch.leadId);
        if (!lead) {
          await updateScheduledSend(sch.id, {
            status: "CANCELLED",
            lastError: "LEAD_MISSING",
          });
          continue;
        }

        const step = stepFor(campaign, sch.stepPosition);
        if (!step) {
          await updateScheduledSend(sch.id, {
            status: "CANCELLED",
            lastError: "STEP_MISSING",
          });
          continue;
        }

        const jittered = humanizeSendAt(now, {
          salt: `${sch.leadId}:${sch.stepPosition}`,
          maxJitterSec: immediate ? 0 : undefined,
        });
        if (!immediate && jittered.getTime() > now.getTime() + 5_000) {
          await deferScheduledSend(sch.id, jittered, "JITTER_DEFER");
          campaignSkipped += 1;
          out.skipped += 1;
          continue;
        }

        const already = await findSentAttemptForStep(
          campaign.id,
          lead.id,
          sch.stepPosition,
        );
        if (already) {
          await updateScheduledSend(sch.id, {
            status: "SENT",
            providerMsgId: already.providerMessageId,
          });
          await advanceLeadAfterStep(lead, campaign, sch.stepPosition, now);
          continue;
        }

        const attempt = await createAttempt({
          campaignId: campaign.id,
          leadId: lead.id,
          idempotencyKey: sch.idempotencyKey,
        });
        if (attempt.status === "SENT") {
          await updateScheduledSend(sch.id, {
            status: "SENT",
            providerMsgId: attempt.providerMessageId,
          });
          await advanceLeadAfterStep(lead, campaign, sch.stepPosition, now);
          continue;
        }
        await updateAttempt(attempt.id, { status: "SENDING" });

        // Refresh line caps mid-batch
        lines = linesForCampaign(campaign, await listLines(), minGap);
        if (poolExhausted(lines, now)) {
          hitCapacity = true;
          await deferScheduledSend(
            sch.id,
            new Date(now.getTime() + 15 * 60 * 1000),
            "NO_LINE_CAPACITY",
          );
          campaignSkipped += 1;
          out.skipped += 1;
          break;
        }

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
            postalCode: lead.custom?.zip ?? lead.custom?.postal_code ?? lead.custom?.postalCode,
            consentStatus: lead.consentStatus,
            dnc: lead.dnc,
          },
          campaign: {
            id: campaign.id,
            scriptTemplate: step.scriptTemplate,
            audioUrl: step.audioUrl ?? campaign.audioUrl,
            schedule: {
              sendWindowStart: campaign.schedule.sendWindowStart,
              sendWindowEnd: campaign.schedule.sendWindowEnd,
              sendDays: campaign.schedule.sendDays,
              requireConsent: campaign.schedule.requireConsent,
            },
          },
          lines: pickable,
          stickyLineId: sch.stickyLineId ?? lead.stickyLineId,
          dncScrubbers: getDncScrubbers(),
          delivery: getDefaultDelivery(),
          now,
          isSuppressed: (phone) => isSuppressed(phone),
          callbackUrl: statusWebhook,
          foreignId: sch.idempotencyKey,
        });

        if (result.status === "SENT") {
          campaignSent += 1;
          out.sent += 1;
          orgSent = await incrementSharedOrgSends(now);
          await bumpLineSent(result.lineId, now);
          // Update in-memory line for poolExhausted mid-batch
          const ln = lines.find((l) => l.id === result.lineId);
          if (ln) {
            ln.sentToday += 1;
            ln.lastSentAt = now.toISOString();
          }
          await updateAttempt(attempt.id, {
            status: "SENT",
            lineId: result.lineId,
            providerMessageId: result.providerMessageId,
            completedAt: now.toISOString(),
          });
          await updateScheduledSend(sch.id, {
            status: "SENT",
            providerMsgId: result.providerMessageId,
            stickyLineId: result.lineId,
            deliveryStatus: result.deliveryStatus ?? "queued",
          });
          await advanceLeadAfterStep(
            lead,
            campaign,
            sch.stepPosition,
            now,
            result.lineId,
            result.providerMessageId,
          );
          const fromDid =
            lines.find((l) => l.id === result.lineId)?.e164 ??
            campaign.lineIds[0];
          void Promise.all([
            import("@/lib/supabase/rvm-sync"),
            import("@/lib/store/db"),
          ])
            .then(async ([{ upsertRvmDrop }, { listClients }]) => {
              const clients = await listClients();
              const client = clients.find((c) => c.id === campaign.clientId);
              return upsertRvmDrop({
                campaign_id: campaign.id,
                campaign_name: campaign.name,
                client_id: campaign.clientId,
                client_name: client?.name,
                lead_id: lead.id,
                lead_phone: lead.phoneE164,
                from_did: fromDid,
                audio_url: step.audioUrl ?? campaign.audioUrl,
                provider: "SLYBROADCAST",
                provider_session_id: result.providerMessageId,
                queued_at: now.toISOString(),
                dial_status: "Pending",
                app_lead_status: "SENT",
                raw: { drain: true },
              });
            })
            .catch((err) => console.error("[supabase] upsertRvmDrop failed", err));
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
            await updateScheduledSend(sch.id, {
              status: "SUPPRESSED",
              lastError: result.detail ?? result.reason,
            });
            await updateLead(lead.id, {
              status: "SUPPRESSED",
              dnc: true,
              suppressReason: result.reason,
              consentStatus:
                result.reason === "OPTED_OUT" ? "OPTED_OUT" : lead.consentStatus,
              lastError: result.detail ?? result.reason,
            });
          } else if (result.reason === "NO_LINE_CAPACITY") {
            hitCapacity = true;
            await deferScheduledSend(
              sch.id,
              result.nextEligibleAt ?? new Date(now.getTime() + 15 * 60 * 1000),
              result.reason,
            );
            await updateAttempt(attempt.id, {
              status: "SKIPPED",
              reason: result.reason,
              completedAt: now.toISOString(),
            });
          } else {
            const next =
              result.nextEligibleAt ??
              new Date(now.getTime() + 15 * 60 * 1000);
            await deferScheduledSend(sch.id, next, result.reason);
            await updateAttempt(attempt.id, {
              status: "SKIPPED",
              reason: result.reason,
              completedAt: now.toISOString(),
            });
            await updateLead(lead.id, {
              status: "PENDING",
              nextEligibleAt: next.toISOString(),
              lastError: result.reason,
            });
          }
        } else {
          campaignFailed += 1;
          out.failed += 1;
          const err = result.error;
          if (
            /NOT_CONFIGURED|UNAUTHORIZED|401|403|SLYBROADCAST/i.test(err) ||
            err === "No audio URL configured for Slybroadcast"
          ) {
            hardProviderFail = true;
          }
          const attempts = sch.attemptCount;
          await updateAttempt(attempt.id, {
            status: "FAILED",
            reason: err,
            completedAt: now.toISOString(),
          });
          if (shouldGiveUp(attempts)) {
            out.suppressed += 1;
            await updateScheduledSend(sch.id, {
              status: "SUPPRESSED",
              lastError: "MAX_ATTEMPTS",
              deliveryStatus: "failed",
            });
            await cancelSubsequentSteps({
              campaignId: campaign.id,
              leadId: lead.id,
              afterStepPosition: sch.stepPosition,
              reason: "PRIOR_STEP_MAX_ATTEMPTS",
            });
            await updateLead(lead.id, {
              status: "SUPPRESSED",
              suppressReason: "MAX_ATTEMPTS",
              lastError: err,
            });
          } else {
            const next = nextFailureEligibleAt(attempts, now);
            await deferScheduledSend(sch.id, next, err);
            await updateLead(lead.id, {
              status: "FAILED",
              nextEligibleAt: next.toISOString(),
              lastError: err,
            });
          }
        }

        out.details.push({
          campaignId: campaign.id,
          leadId: lead.id,
          step: sch.stepPosition,
          status: result.status,
          reason:
            result.status === "SKIPPED"
              ? result.reason
              : result.status === "FAILED"
                ? result.error
                : undefined,
        });
      }

      if (hitCapacity) {
        const { deferred } = await rebalanceOnCapacityExhausted({
          campaignId: campaign.id,
          lines,
          now,
        });
        out.rebalanced += deferred;
      }

      if (hardProviderFail) {
        await autoPause(campaign.id, "PROVIDER_HARD_FAIL", out);
      }

      const pending = await countPendingScheduled(campaign.id);
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
        ...(pending === 0 && campaignSent + sentToday > 0
          ? { status: "COMPLETED" as const }
          : {}),
      });
    } finally {
      await releaseCampaignLease(campaign.id, owner);
    }
  }

  return out;
}

async function advanceLeadAfterStep(
  lead: LeadRecord,
  campaign: CampaignRecord,
  stepPosition: number,
  now: Date,
  stickyLineId?: string,
  providerMessageId?: string,
) {
  const maxStep = Math.max(...campaign.steps.map((s) => s.position));
  const done = stepPosition >= maxStep;
  await updateLead(lead.id, {
    currentStepPosition: stepPosition,
    stickyLineId: stickyLineId ?? lead.stickyLineId,
    providerMessageId: providerMessageId ?? lead.providerMessageId,
    sentAt: now.toISOString(),
    status: done ? "SENT" : "PENDING",
    lastError: undefined,
    nextEligibleAt: undefined,
  });
  lead.currentStepPosition = stepPosition;
  if (stickyLineId) lead.stickyLineId = stickyLineId;
  lead.status = done ? "SENT" : "PENDING";
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

/** Reconciler: reclaim is handled inside claim; report ACTIVE with due work. */
export async function reconcileCampaigns(): Promise<{
  staleReclaimed: number;
  activeWithDue: number;
}> {
  const now = new Date();
  const campaigns = (await listCampaigns()).filter((c) => c.status === "ACTIVE");
  let activeWithDue = 0;
  for (const c of campaigns) {
    const due = await countDueScheduled(c.id, now);
    if (due > 0) activeWithDue += 1;
  }
  // Stale CLAIMED reclaim happens inside claimScheduledSends
  return { staleReclaimed: 0, activeWithDue };
}
