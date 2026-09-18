import { DNC_TAG } from "@/lib/allo/rules";
import {
  addConversationTags,
  createConversationNote,
  isAlloSyncConfigured,
  listAlloNumbers,
  listConversationNotes,
} from "@/lib/allo/client";
import { alloInternalNote, noteMarker } from "../outcomes";
import {
  shouldTagAlloDnc,
  type Destination,
  type DestinationApplyResult,
  type ResolvedIdentity,
  type SuppressionEvent,
} from "../types";

export const alloDestination: Destination = {
  id: "allo",
  configured: isAlloSyncConfigured,
  apply: applyAllo,
};

async function resolveAlloLine(preferred?: string): Promise<string | undefined> {
  if (preferred) return preferred;
  try {
    const numbers = await listAlloNumbers();
    return numbers.find((n) => n.number)?.number ?? undefined;
  } catch {
    return undefined;
  }
}

export async function applyAllo(
  event: SuppressionEvent,
  identity: ResolvedIdentity,
): Promise<DestinationApplyResult> {
  if (!isAlloSyncConfigured()) {
    return { status: "failed", error: "allo_not_configured" };
  }
  const phone = identity.phoneE164 ?? event.phoneE164;
  if (!phone) return { status: "skipped", reason: "no_phone" };

  const line = await resolveAlloLine(event.alloLine);
  if (!line) return { status: "failed", error: "no_allo_line" };

  const errors: string[] = [];

  if (shouldTagAlloDnc(event.outcome) && event.alloCallId) {
    try {
      await addConversationTags(event.alloCallId, [DNC_TAG], event.id);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "tag_failed");
    }
  }

  try {
    const existing = await listConversationNotes({
      contactNumber: phone,
      alloNumber: line,
    }).catch(() => []);
    const marker = noteMarker(event.id);
    const already = existing.some((n) => (n.content ?? "").includes(marker));
    if (!already) {
      await createConversationNote({
        contactNumber: phone,
        alloNumber: line,
        content: alloInternalNote(event),
      });
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : "note_failed");
  }

  if (errors.length > 0) {
    return { status: "failed", error: errors.join("; ").slice(0, 180) };
  }
  return { status: "ok" };
}
