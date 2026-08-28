import { evaluateSendWindow, type SendSchedule } from "@/lib/sequencer/send-window";
import { pickLine, type PickableLine } from "@/lib/sequencer/line-picker";
import { scrubWithAll } from "@/lib/dnc/scrub";
import type { DncScrubber } from "@/lib/dnc/types";
import type { ConsentStatus } from "@/lib/compliance/gates";
import type { RvmDeliveryProvider } from "@/lib/providers/types";

export type AttemptLead = {
  id: string;
  phoneE164: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  timezone?: string | null;
  /** Optional zip for Drop Cowboy postal_code / TCPA accuracy */
  postalCode?: string | null;
  consentStatus: ConsentStatus;
  dnc: boolean;
};
export type AttemptCampaign = {
  id: string;
  schedule: SendSchedule;
  scriptTemplate: string;
  /** Drop Cowboy recording GUID (preferred) */
  recordingId?: string | null;
  /** Hosted audio URL if account allows audio_url */
  audioUrl?: string | null;
};

export type RunAttemptResult =
  | {
      status: "SENT";
      lineId: string;
      providerMessageId?: string;
      audioUrl?: string;
      recordingId?: string;
      timezone: string;
      costEstimateUsd?: number;
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
    }
  | { status: "FAILED"; error: string };

/**
 * One sequencer tick for a single enrollment:
 * suppress → DNC scrub → local-time send window → line pick → Drop Cowboy send.
 */
export async function runAttempt(input: {
  lead: AttemptLead;
  campaign: AttemptCampaign;
  lines: PickableLine[];
  dncScrubbers: DncScrubber[];
  delivery: RvmDeliveryProvider;
  now?: Date;
  /** Prefer this line for follow-ups if still eligible. */
  stickyLineId?: string;
  /** Global suppression check (workspace-wide). */
  isSuppressed?: (phoneE164: string) => boolean | Promise<boolean>;
  /** Status webhook URL passed to providers that support callbacks. */
  callbackUrl?: string;
  /** Idempotency / foreign id for provider + webhook reconcile. */
  foreignId?: string;
}): Promise<RunAttemptResult> {
  // 0) Global suppression list
  if (input.isSuppressed) {
    const blocked = await input.isSuppressed(input.lead.phoneE164);
    if (blocked) {
      return { status: "SKIPPED", reason: "SUPPRESSED", detail: "GLOBAL_SUPPRESSION" };
    }
  }

  // 1) Internal flag + external scrub
  if (input.lead.dnc || input.lead.consentStatus === "OPTED_OUT") {
    return { status: "SKIPPED", reason: input.lead.dnc ? "DNC" : "OPTED_OUT" };
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

  // 2) Recipient-local send window (Smartlead-style)
  const window = evaluateSendWindow({
    phoneE164: input.lead.phoneE164,
    timezone: input.lead.timezone,
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
    };
  }

  // 3) Line pool — used as Drop Cowboy forwarding_number (or BYOC caller_id)
  const line = pickLine(input.lines, input.lead.phoneE164, {
    now: input.now,
    stickyLineId: input.stickyLineId,
  });
  if (!line) {
    return { status: "SKIPPED", reason: "NO_LINE_CAPACITY" };
  }

  const recordingId = input.campaign.recordingId?.trim() || undefined;
  const audioUrl = input.campaign.audioUrl?.trim() || undefined;
  if (!recordingId && !audioUrl) {
    return {
      status: "FAILED",
      error: "No Drop Cowboy recording_id (or audio URL) configured",
    };
  }

  // 4) Deliver via Drop Cowboy (or injected provider)
  const sent = await input.delivery.send({
    toE164: input.lead.phoneE164,
    fromE164: line.e164,
    recordingId,
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
    recordingId,
    timezone: window.timezone,
    costEstimateUsd: sent.costEstimateUsd,
  };
}
