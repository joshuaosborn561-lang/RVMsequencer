import type { AlloSuppressRule } from "@/lib/allo/rules";
import type { SuppressionRecord } from "@/lib/store/types";
import type { Outcome } from "./types";

const INTERESTED_TAGS = new Set([
  "interested",
  "meeting_booked",
  "demo",
  "follow_up_later",
]);

/** Map an Allo rule the existing sync already chose. Do not re-classify the call. */
export function outcomeFromAlloRule(rule: AlloSuppressRule): Outcome {
  if (rule.rule === "allo_dnc") return "do_not_call";
  if (rule.rule === "allo_conversation") return "conversation";
  if (INTERESTED_TAGS.has(rule.tagKey)) return "interested";
  if (rule.tagKey === "not_interested") return "not_interested";
  // Unknown tag key — treat as not_interested (already classified as Rule B).
  return "not_interested";
}

export function outcomeFromAlloReason(reason: string, tagKey?: string): Outcome {
  if (reason === "allo_dnc") return "do_not_call";
  if (reason === "allo_conversation") return "conversation";
  const tag = tagKey ?? reason.replace(/^allo_tag:/, "");
  if (INTERESTED_TAGS.has(tag)) return "interested";
  if (tag === "not_interested") return "not_interested";
  if (reason.startsWith("allo_tag:")) return "not_interested";
  return "not_interested";
}

const RVM_DNC_REASONS = new Set([
  "SMS_STOP",
  "INBOX_DNC",
  "CALLBACK",
  "INBOX_CALLBACK",
]);

/**
 * Local voicemail/inbox suppressions. Removal language and STOP → do_not_call.
 * Other operator suppressions stay distinguishable.
 */
export function outcomeFromRvmSuppression(row: SuppressionRecord): Outcome {
  if (row.source === "ALLO" && row.reason) {
    return outcomeFromAlloReason(row.reason, row.alloMeta?.tagKey);
  }
  if (row.source === "SMS_STOP" || row.source === "CALLBACK") return "do_not_call";
  if (RVM_DNC_REASONS.has(row.reason)) return "do_not_call";
  if (row.reason === "INBOX_CALLBACK") return "do_not_call";
  if (row.source === "MANUAL" || row.source === "INBOX") {
    if (/dnc|opt.?out|stop|do_not_call/i.test(row.reason)) return "do_not_call";
    return "not_interested";
  }
  return "do_not_call";
}

export function outcomeFromSmartleadEvent(eventType?: string): Outcome {
  const t = (eventType ?? "LEAD_UNSUBSCRIBED").toUpperCase();
  if (t.includes("UNSUBSCRIB")) return "do_not_call";
  if (t.includes("NOT_INTERESTED") || t.includes("NOT INTERESTED")) {
    return "not_interested";
  }
  return "do_not_call";
}

export function alloRecordingUrl(input: {
  callId?: string | null;
  phoneE164?: string | null;
}): string | undefined {
  if (input.callId) {
    return `https://app.withallo.com/inbox?call=${encodeURIComponent(input.callId)}`;
  }
  if (input.phoneE164) {
    return `https://app.withallo.com/inbox?contact=${encodeURIComponent(input.phoneE164)}`;
  }
  return undefined;
}

export function noteMarker(eventId: string): string {
  return `[rvm-suppression:${eventId}]`;
}

export function alloInternalNote(
  event: {
    id: string;
    outcome: Outcome;
    reason: string;
    occurredAt: string;
    source: string;
    alloCallId?: string;
    alloRep?: string | null;
    recordingUrl?: string;
  },
): string {
  const when = event.occurredAt.slice(0, 19).replace("T", " ") + " UTC";
  const parts = [
    noteMarker(event.id),
    `Outcome: ${event.outcome}.`,
    `Reason: ${event.reason}.`,
    `When: ${when}.`,
    `Source: ${event.source}.`,
  ];
  if (event.alloRep) parts.push(`Rep: ${event.alloRep}.`);
  if (event.alloCallId) parts.push(`Call: ${event.alloCallId}.`);
  if (event.recordingUrl) parts.push(`Recording: ${event.recordingUrl}.`);
  parts.push("Do not contact this person on cold sequences.");
  return parts.join(" ");
}
