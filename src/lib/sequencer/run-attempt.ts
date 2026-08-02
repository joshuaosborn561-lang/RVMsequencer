import { evaluateSendWindow, type SendSchedule } from "@/lib/sequencer/send-window";
import { pickLine, type PickableLine } from "@/lib/sequencer/line-picker";
import { scrubWithAll } from "@/lib/dnc/scrub";
import type { DncScrubber } from "@/lib/dnc/types";
import type { ConsentStatus } from "@/lib/compliance/gates";
import type { RvmDeliveryProvider } from "@/lib/providers/types";
import type { VoiceProviderClient } from "@/lib/providers/types";
import { renderScript } from "@/lib/compliance/gates";

export type AttemptLead = {
  id: string;
  phoneE164: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  timezone?: string | null;
  consentStatus: ConsentStatus;
  dnc: boolean;
};

export type AttemptCampaign = {
  id: string;
  schedule: SendSchedule;
  scriptTemplate: string;
  /** Pre-rendered static audio URL — preferred (generate once) */
  audioUrl?: string | null;
  /** If no audioUrl, render via ElevenLabs once using this voice id */
  elevenVoiceId?: string | null;
  dropCoCampaignToken?: string | null;
};

export type RunAttemptResult =
  | {
      status: "SENT";
      lineId: string;
      providerMessageId?: string;
      audioUrl: string;
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
 * suppress → DNC scrub → local-time send window → line pick → ensure audio → Drop.co send.
 */
export async function runAttempt(input: {
  lead: AttemptLead;
  campaign: AttemptCampaign;
  lines: PickableLine[];
  dncScrubbers: DncScrubber[];
  delivery: RvmDeliveryProvider;
  voice?: VoiceProviderClient;
  now?: Date;
  /** Prefer this line for follow-ups if still eligible. */
  stickyLineId?: string;
  /** Global suppression check (workspace-wide). */
  isSuppressed?: (phoneE164: string) => boolean | Promise<boolean>;
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

  // 3) Line pool rotation (sticky → weighted / gap-aware)
  const line = pickLine(input.lines, input.lead.phoneE164, {
    now: input.now,
    stickyLineId: input.stickyLineId,
  });
  if (!line) {
    return { status: "SKIPPED", reason: "NO_LINE_CAPACITY" };
  }

  // 4) Audio — reuse static URL, or generate once via ElevenLabs
  let audioUrl = input.campaign.audioUrl ?? null;
  if (!audioUrl) {
    if (!input.voice || !input.campaign.elevenVoiceId) {
      return {
        status: "FAILED",
        error: "No audioUrl and no ElevenLabs voice configured",
      };
    }
    const script = renderScript(input.campaign.scriptTemplate, {
      first_name: input.lead.firstName,
      last_name: input.lead.lastName,
      company: input.lead.company,
    });
    const rendered = await input.voice.render({
      text: script,
      voiceExternalId: input.campaign.elevenVoiceId,
      format: "mp3",
    });
    audioUrl = rendered.audioUrl;
  }

  // 5) Deliver via Drop.co (or whatever provider is injected)
  const sent = await input.delivery.send({
    toE164: input.lead.phoneE164,
    fromE164: line.e164,
    audioUrl,
    foreignId: `${input.campaign.id}_${input.lead.id}`,
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
  };
}
