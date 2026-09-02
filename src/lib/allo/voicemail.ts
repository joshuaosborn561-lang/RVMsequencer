import type { AlloConversationItem, AlloTranscriptEntry } from "./client";

const VM_SUMMARY_RE =
  /\b(voicemail|voice mail|left a message|vm left|went to vm)\b/i;

export type VoicemailVerdict =
  | { kind: "voicemail"; rung: 1 | 2 | 3 }
  | { kind: "conversation"; rung: 3 }
  | { kind: "undetermined"; rung: 4 };

/** Rungs 1–2 only (no transcript fetch). */
export function classifyVoicemailCheap(
  item: AlloConversationItem,
): VoicemailVerdict | null {
  if (item.result === "VOICEMAIL") {
    return { kind: "voicemail", rung: 1 };
  }
  const summary = item.summary ?? "";
  if (summary && VM_SUMMARY_RE.test(summary)) {
    return { kind: "voicemail", rung: 2 };
  }
  return null;
}

export function classifyVoicemailFromTranscript(
  transcript:
    | AlloTranscriptEntry[]
    | { transcripts?: AlloTranscriptEntry[] }
    | null
    | undefined,
): VoicemailVerdict {
  const entries = Array.isArray(transcript)
    ? transcript
    : transcript && Array.isArray(transcript.transcripts)
      ? transcript.transcripts
      : null;
  if (!entries || entries.length === 0) {
    return { kind: "undetermined", rung: 4 };
  }
  const sources = new Set(
    entries
      .map((t) => (t.source ?? "").toUpperCase())
      .filter((s) => s === "USER" || s === "EXTERNAL" || Boolean(s)),
  );
  if (sources.size >= 2) {
    return { kind: "conversation", rung: 3 };
  }
  if (sources.size === 1) {
    return { kind: "voicemail", rung: 3 };
  }
  return { kind: "undetermined", rung: 4 };
}
