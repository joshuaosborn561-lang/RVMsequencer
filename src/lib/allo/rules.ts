import type { AlloConversationItem } from "./client";

export const DNC_TAG = "do_not_call";

export const SUPPRESS_TAGS = new Set([
  "not_interested",
  "interested",
  "meeting_booked",
  "demo",
  "follow_up_later",
]);

export const SKIP_TAGS = new Set(["to_call_back"]);

const DNC_TEXT_RE =
  /\b(take me off|remove me|stop calling|don'?t call|do not call|off your list|unsubscribe)\b/i;

export type AlloSuppressRule =
  | { rule: "allo_dnc"; reason: "allo_dnc" }
  | { rule: "allo_tag"; reason: string; tagKey: string }
  | { rule: "allo_conversation"; reason: "allo_conversation" };

function normTags(tags: string[] | null | undefined): string[] {
  return (tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export function matchRuleA(item: AlloConversationItem): AlloSuppressRule | null {
  const tags = normTags(item.tags);
  if (tags.includes(DNC_TAG)) {
    return { rule: "allo_dnc", reason: "allo_dnc" };
  }
  const entries = Array.isArray(item.transcript)
    ? item.transcript
    : item.transcript &&
        typeof item.transcript === "object" &&
        Array.isArray(
          (item.transcript as { transcripts?: { text?: string }[] }).transcripts,
        )
      ? (item.transcript as { transcripts: { text?: string }[] }).transcripts
      : [];
  const text = `${item.summary ?? ""}\n${entries.map((t) => t.text ?? "").join("\n")}`;
  if (DNC_TEXT_RE.test(text)) {
    return { rule: "allo_dnc", reason: "allo_dnc" };
  }
  return null;
}

export function matchRuleB(item: AlloConversationItem): AlloSuppressRule | null {
  const tags = normTags(item.tags);
  for (const tag of tags) {
    if (SKIP_TAGS.has(tag)) continue;
    if (SUPPRESS_TAGS.has(tag)) {
      return { rule: "allo_tag", reason: `allo_tag:${tag}`, tagKey: tag };
    }
  }
  return null;
}

/** Rule C eligibility before voicemail ladder (outbound + duration > 15). */
export function isRuleCCandidate(item: AlloConversationItem): boolean {
  if ((item.direction ?? "").toUpperCase() !== "OUTBOUND") return false;
  const dur = item.duration ?? 0;
  return dur > 15;
}

/** First match wins: A → B → (C handled by caller after voicemail check). */
export function matchRuleAB(item: AlloConversationItem): AlloSuppressRule | null {
  return matchRuleA(item) ?? matchRuleB(item);
}
