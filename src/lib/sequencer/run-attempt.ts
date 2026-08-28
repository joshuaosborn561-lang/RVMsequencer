import {
  evaluateSuppressionOrder,
  toSkipReason,
} from "@/lib/compliance/suppression-order";
import type { ConsentStatus } from "@/lib/compliance/gates";
import { scrubWithAll } from "@/lib/dnc/scrub";
import type { DncScrubber } from "@/lib/dnc/types";
import type { RvmDeliveryProvider } from "@/lib/providers/types";
import { pickLine, type PickableLine } from "@/lib/sequencer/line-picker";
import { evaluateSendWindow, type SendSchedule } from "@/lib/sequencer/send-window";

export type AttemptLead = {
  id: string;
  phoneE164: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  timezone?: string | null;
  postalCode?: string | null;
  /** US state for quiet hours + address TZ */
  state?: string | null;
  city?: string | null;
  consentStatus: ConsentStatus;
  dnc: boolean;
};
export type AttemptCampaign = {
  id: string;
  clientId?: string | null;
  schedule: SendSchedule;
  scriptTemplate: string;
  audioUrl?: string | null;
};

export type RunAttemptResult =
  | {
      status: "SENT";
      lineId: string;
      providerMessageId?: string;
      audioUrl?: string;
      timezone: string;
      costEstimateUsd?: number;
      appliedWindow?: {
        sendWindowStart: number;
        sendWindowEnd: number;
        sendDays: number[];
        appliedState: string;
      };
      deliveryStatus?:
        | "queued"
        | "sent"
        | "delivered"
        | "failed"
        | "rejected"
        | "human_answered";
    }
  | {
      status: "SKIPPED";
      reason:
        | "DNC"
        | "OPTED_OUT"
        | "MISSING_CONSENT"
        | "OUTSIDE_SEND_WINDOW"
        | "OUTSIDE_SEND_DAYS"
        | "NO_LINE_CAPACITY"
        | "SCRUB_BLOCKED"
        | "SUPPRESSED";
      nextEligibleAt?: Date;
      timezone?: string;
      detail?: string;
      appliedWindow?: {
        sendWindowStart: number;
        sendWindowEnd: number;
        sendDays: number[];
        appliedState: string;
      };
    }
  | { status: "FAILED"; error: string };

/**
 * One sequencer tick:
 * ordered suppress → external scrub → quiet-hours window → line pick → send.
 */
export async function runAttempt(input: {
  lead: AttemptLead;
  campaign: AttemptCampaign;
  lines: PickableLine[];
  dncScrubbers: DncScrubber[];
  delivery: RvmDeliveryProvider;
  now?: Date;
  stickyLineId?: string;
  isSuppressed?: (phoneE164: string) => boolean | Promise<boolean>;
  getSuppressionSource?: (
    phoneE164: string,
  ) => string | null | Promise<string | null>;
  isClientExcluded?: (
    clientId: string | null | undefined,
    phoneE164: string,
  ) => boolean | Promise<boolean>;
  attemptsToday?: number;
  maxAttemptsPerDay?: number;
  requireFcr?: boolean;
  callbackUrl?: string;
  foreignId?: string;
}): Promise<RunAttemptResult> {
  const globallySuppressed = input.isSuppressed
    ? await input.isSuppressed(input.lead.phoneE164)
    : false;
  const suppressSource =
    globallySuppressed && input.getSuppressionSource
      ? await input.getSuppressionSource(input.lead.phoneE164)
      : null;
  const clientExcluded = input.isClientExcluded
    ? await input.isClientExcluded(input.campaign.clientId, input.lead.phoneE164)
    : false;

  const ordered = evaluateSuppressionOrder({
    phoneE164: input.lead.phoneE164,
    dnc: input.lead.dnc,
    consentStatus: input.lead.consentStatus,
    clientId: input.campaign.clientId,
    isGloballySuppressed: Boolean(globallySuppressed),
    globalSuppressSource: suppressSource,
    isClientExcluded: clientExcluded,
    attemptsToday: input.attemptsToday ?? 0,
    maxAttemptsPerDay: input.maxAttemptsPerDay,
  });
  if (ordered.blocked) {
    return {
      status: "SKIPPED",
      reason: toSkipReason(ordered.reason),
      detail: `${ordered.reason}${ordered.detail ? `:${ordered.detail}` : ""}`,
    };
  }

  const scrubbed = await scrubWithAll(input.dncScrubbers, [input.lead.phoneE164]);
  const scrub = scrubbed[0];
  if (scrub?.blocked) {
    return {
      status: "SKIPPED",
      reason: "SCRUB_BLOCKED",
      detail: scrub.reasons.join(","),
    };
  }

  const window = evaluateSendWindow({
    phoneE164: input.lead.phoneE164,
    timezone: input.lead.timezone,
    state: input.lead.state,
    dnc: false,
    consentStatus: input.lead.consentStatus,
    schedule: input.campaign.schedule,
    now: input.now,
  });
  if (!window.allow) {
    return {
      status: "SKIPPED",
      reason: window.reason,
      nextEligibleAt: window.nextEligibleAt,
      timezone: window.timezone,
      appliedWindow: window.appliedWindow,
    };
  }

  const line = pickLine(input.lines, input.lead.phoneE164, {
    now: input.now,
    stickyLineId: input.stickyLineId,
    requireFcr: input.requireFcr,
  });
  if (!line) {
    return { status: "SKIPPED", reason: "NO_LINE_CAPACITY" };
  }

  const audioUrl = input.campaign.audioUrl?.trim() || undefined;
  if (!audioUrl) {
    return {
      status: "FAILED",
      error: "No audio URL configured for Slybroadcast",
    };
  }

  const sent = await input.delivery.send({
    toE164: input.lead.phoneE164,
    fromE164: line.e164,
    audioUrl,
    postalCode: input.lead.postalCode?.trim() || undefined,
    foreignId: input.foreignId ?? `${input.campaign.id}_${input.lead.id}`,
    callbackUrl: input.callbackUrl,
  });

  if (!sent.ok) {
    return {
      status: "FAILED",
      error: sent.errorDetail ?? sent.errorCode ?? "delivery_failed",
    };
  }

  return {
    status: "SENT",
    lineId: line.id,
    providerMessageId: sent.providerMessageId,
    audioUrl,
    timezone: window.timezone,
    costEstimateUsd: sent.costEstimateUsd,
    deliveryStatus: sent.status,
    appliedWindow: window.appliedWindow,
  };
}
