import { normalizeContactPhone } from "@/lib/phone";
import type { SuppressionRecord } from "@/lib/store/types";
import { getDomainBlockList } from "@/lib/smartlead/client";
import { domainFromEmail, normalizeEmail } from "./identity";
import {
  alloRecordingUrl,
  outcomeFromAlloReason,
  outcomeFromRvmSuppression,
  outcomeFromSmartleadEvent,
} from "./outcomes";
import type { SmartleadQueueItem } from "./state";
import type { SuppressionEvent } from "./types";

export function eventFromAlloSuppression(row: SuppressionRecord): SuppressionEvent | null {
  if (row.source !== "ALLO" && !row.alloMeta) return null;
  const meta = row.alloMeta;
  const sourceEventId = meta?.alloCallId || row.id;
  const reason = row.reason || meta?.rule || "allo";
  return {
    id: `allo:${sourceEventId}`,
    source: "allo",
    sourceEventId,
    outcome: outcomeFromAlloReason(reason, meta?.tagKey),
    reason,
    occurredAt: meta?.callDate || row.createdAt,
    phoneE164: row.phoneE164,
    alloCallId: meta?.alloCallId,
    alloRep: meta?.alloRep,
    alloLine: meta?.alloLine,
    recordingUrl: alloRecordingUrl({
      callId: meta?.alloCallId,
      phoneE164: row.phoneE164,
    }),
    direction: meta?.direction,
    durationSec: meta?.durationSec,
    tags: meta?.tags,
  };
}

export function eventFromRvmSuppression(row: SuppressionRecord): SuppressionEvent | null {
  if (row.source === "ALLO" || row.alloMeta) return null;
  return {
    id: `rvm:${row.id}`,
    source: "rvm",
    sourceEventId: row.id,
    outcome: outcomeFromRvmSuppression(row),
    reason: row.reason,
    occurredAt: row.createdAt,
    phoneE164: row.phoneE164,
  };
}

export function eventFromSmartleadQueueItem(
  item: SmartleadQueueItem,
): SuppressionEvent {
  const email = normalizeEmail(item.email);
  const domain =
    item.domain?.trim().toLowerCase() ||
    domainFromEmail(email) ||
    (item.email && !item.email.includes("@")
      ? item.email.trim().toLowerCase()
      : undefined);
  const phone = normalizeContactPhone(item.phone) ?? undefined;
  return {
    id: `smartlead:${item.id}`,
    source: "smartlead",
    sourceEventId: item.id,
    outcome: outcomeFromSmartleadEvent(item.eventType),
    reason: item.eventType ?? "LEAD_UNSUBSCRIBED",
    occurredAt: item.occurredAt,
    phoneE164: phone,
    email,
    domain,
    firstName: item.firstName,
    lastName: item.lastName,
    company: item.company,
  };
}

export function eventFromBlockListEntry(raw: string): SuppressionEvent | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const email = value.includes("@") ? normalizeEmail(value) : undefined;
  const domain = email ? domainFromEmail(email) : value.replace(/^www\./, "");
  if (!email && !domain) return null;
  return {
    id: `smartlead:block:${email || domain}`,
    source: "smartlead",
    sourceEventId: `block:${email || domain}`,
    outcome: "do_not_call",
    reason: "SMARTLEAD_BLOCK_LIST",
    occurredAt: new Date().toISOString(),
    email,
    domain,
  };
}

export function harvestAlloEvents(
  rows: SuppressionRecord[],
  already: Set<string>,
): SuppressionEvent[] {
  const out: SuppressionEvent[] = [];
  for (const row of rows) {
    const ev = eventFromAlloSuppression(row);
    if (!ev || already.has(ev.id)) continue;
    out.push(ev);
  }
  return out;
}

export function harvestRvmEvents(
  rows: SuppressionRecord[],
  already: Set<string>,
): SuppressionEvent[] {
  const out: SuppressionEvent[] = [];
  for (const row of rows) {
    const ev = eventFromRvmSuppression(row);
    if (!ev || already.has(ev.id)) continue;
    out.push(ev);
  }
  return out;
}

export function harvestSmartleadQueue(
  items: SmartleadQueueItem[],
  already: Set<string>,
): { events: SuppressionEvent[]; consumedIds: string[] } {
  const events: SuppressionEvent[] = [];
  const consumedIds: string[] = [];
  for (const item of items) {
    consumedIds.push(item.id);
    const ev = eventFromSmartleadQueueItem(item);
    if (already.has(ev.id)) continue;
    events.push(ev);
  }
  return { events, consumedIds };
}

export async function harvestSmartleadBlockList(
  already: Set<string>,
): Promise<SuppressionEvent[]> {
  const entries = await getDomainBlockList();
  const out: SuppressionEvent[] = [];
  for (const raw of entries) {
    const ev = eventFromBlockListEntry(raw);
    if (!ev || already.has(ev.id)) continue;
    out.push(ev);
  }
  return out;
}
