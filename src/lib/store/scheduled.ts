import { randomUUID } from "node:crypto";
import { getPrisma, postgresEnabled } from "@/lib/db/prisma";
import { STALE_SENDING_MS } from "@/lib/hardening/constants";
import type { CampaignRecord, LeadRecord } from "@/lib/store/types";
import {
  stepIdempotencyKey,
  type ScheduledSendRecord,
  type ScheduledSendStatus,
} from "@/lib/store/scheduled-types";
import { withStoreLock } from "@/lib/store/lock";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), ".data");
const QUEUE_PATH = path.join(DATA_DIR, "scheduled-sends.json");

type QueueFile = { sends: ScheduledSendRecord[] };

async function readFileQueue(): Promise<QueueFile> {
  try {
    const raw = await readFile(QUEUE_PATH, "utf8");
    const parsed = JSON.parse(raw) as QueueFile;
    return { sends: parsed.sends ?? [] };
  } catch {
    return { sends: [] };
  }
}

async function writeFileQueue(q: QueueFile): Promise<void> {
  await mkdir(path.dirname(QUEUE_PATH), { recursive: true });
  await writeFile(QUEUE_PATH, JSON.stringify(q, null, 2));
}

function rowFromPrisma(r: {
  id: string;
  campaignId: string;
  leadId: string;
  stepPosition: number;
  phoneE164: string;
  stickyLineId: string | null;
  status: string;
  runAt: Date;
  claimedAt: Date | null;
  claimOwner: string | null;
  idempotencyKey: string;
  providerMsgId: string | null;
  lastError: string | null;
  attemptCount: number;
  deliveryStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ScheduledSendRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    leadId: r.leadId,
    stepPosition: r.stepPosition,
    phoneE164: r.phoneE164,
    stickyLineId: r.stickyLineId ?? undefined,
    status: r.status as ScheduledSendStatus,
    runAt: r.runAt.toISOString(),
    claimedAt: r.claimedAt?.toISOString(),
    claimOwner: r.claimOwner ?? undefined,
    idempotencyKey: r.idempotencyKey,
    providerMsgId: r.providerMsgId ?? undefined,
    lastError: r.lastError ?? undefined,
    attemptCount: r.attemptCount,
    deliveryStatus: r.deliveryStatus as ScheduledSendRecord["deliveryStatus"],
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Eager-schedule all sequence steps for sendable leads (idempotent upsert). */
export async function eagerScheduleCampaign(input: {
  campaign: CampaignRecord;
  leads: LeadRecord[];
  now?: Date;
}): Promise<{ created: number; existing: number }> {
  const now = input.now ?? new Date();
  const steps = [...input.campaign.steps].sort((a, b) => a.position - b.position);
  if (steps.length === 0) return { created: 0, existing: 0 };

  const rows: ScheduledSendRecord[] = [];
  for (const lead of input.leads) {
    if (
      lead.dnc ||
      lead.consentStatus === "OPTED_OUT" ||
      lead.status === "SUPPRESSED"
    ) {
      continue;
    }
    let offsetMs = 0;
    for (const step of steps) {
      if (step.position > 1) {
        offsetMs += Math.max(0, step.delayDays) * 86_400_000;
      }
      const key = stepIdempotencyKey(
        input.campaign.id,
        lead.id,
        step.position,
      );
      const iso = new Date(now.getTime() + offsetMs).toISOString();
      rows.push({
        id: `sch_${randomUUID().slice(0, 10)}`,
        campaignId: input.campaign.id,
        leadId: lead.id,
        stepPosition: step.position,
        phoneE164: lead.phoneE164,
        stickyLineId: lead.stickyLineId,
        status: "PENDING",
        runAt: iso,
        idempotencyKey: key,
        attemptCount: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
  }

  let created = 0;
  let existing = 0;

  // File queue
  await withStoreLock(async () => {
    const q = await readFileQueue();
    const keys = new Set(q.sends.map((s) => s.idempotencyKey));
    for (const row of rows) {
      if (keys.has(row.idempotencyKey)) {
        existing += 1;
        continue;
      }
      q.sends.push(row);
      keys.add(row.idempotencyKey);
      created += 1;
    }
    await writeFileQueue(q);
  });

  // Postgres mirror (source of truth for SKIP LOCKED claim when available)
  const prisma = getPrisma();
  if (prisma) {
    for (const row of rows) {
      try {
        await prisma.scheduledSend.upsert({
          where: { idempotencyKey: row.idempotencyKey },
          create: {
            id: row.id,
            campaignId: row.campaignId,
            leadId: row.leadId,
            stepPosition: row.stepPosition,
            phoneE164: row.phoneE164,
            stickyLineId: row.stickyLineId,
            status: "PENDING",
            runAt: new Date(row.runAt),
            idempotencyKey: row.idempotencyKey,
            attemptCount: 0,
          },
          update: {},
        });
      } catch {
        /* unique race — ok */
      }
    }
  }

  return { created, existing };
}

/** Claim due scheduled sends — Postgres SKIP LOCKED when available. */
export async function claimScheduledSends(input: {
  campaignId: string;
  limit: number;
  owner: string;
  now?: Date;
}): Promise<ScheduledSendRecord[]> {
  const now = input.now ?? new Date();
  if (input.limit <= 0) return [];

  const prisma = getPrisma();
  if (prisma && postgresEnabled()) {
    try {
      return await claimPostgres(prisma, input.campaignId, input.limit, input.owner, now);
    } catch (err) {
      console.error("pg_claim_failed_fallback_file", err);
    }
  }
  return claimFile(input.campaignId, input.limit, input.owner, now);
}

async function claimPostgres(
  prisma: NonNullable<ReturnType<typeof getPrisma>>,
  campaignId: string,
  limit: number,
  owner: string,
  now: Date,
): Promise<ScheduledSendRecord[]> {
  const staleBefore = new Date(now.getTime() - STALE_SENDING_MS);

  // Reclaim stale CLAIMED first
  await prisma.scheduledSend.updateMany({
    where: {
      campaignId,
      status: "CLAIMED",
      claimedAt: { lt: staleBefore },
    },
    data: {
      status: "PENDING",
      claimOwner: null,
      claimedAt: null,
      lastError: "STALE_CLAIM_RECLAIMED",
    },
  });

  const claimed = await prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "ScheduledSend"
      WHERE "campaignId" = ${campaignId}
        AND status = 'PENDING'
        AND "runAt" <= ${now}
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
    if (due.length === 0) return [];
    const ids = due.map((d) => d.id);
    await tx.scheduledSend.updateMany({
      where: { id: { in: ids } },
      data: {
        status: "CLAIMED",
        claimOwner: owner,
        claimedAt: now,
        attemptCount: { increment: 1 },
      },
    });
    return tx.scheduledSend.findMany({ where: { id: { in: ids } } });
  });

  return claimed.map(rowFromPrisma);
}

async function claimFile(
  campaignId: string,
  limit: number,
  owner: string,
  now: Date,
): Promise<ScheduledSendRecord[]> {
  return withStoreLock(async () => {
    const q = await readFileQueue();
    const claimed: ScheduledSendRecord[] = [];
    const nowMs = now.getTime();
    for (const s of q.sends) {
      if (claimed.length >= limit) break;
      if (s.campaignId !== campaignId) continue;
      if (s.status === "CLAIMED" && s.claimedAt) {
        if (nowMs - Date.parse(s.claimedAt) >= STALE_SENDING_MS) {
          s.status = "PENDING";
          s.claimOwner = undefined;
          s.claimedAt = undefined;
          s.lastError = "STALE_CLAIM_RECLAIMED";
        }
      }
      if (s.status !== "PENDING") continue;
      if (Date.parse(s.runAt) > nowMs) continue;
      s.status = "CLAIMED";
      s.claimOwner = owner;
      s.claimedAt = now.toISOString();
      s.attemptCount += 1;
      s.updatedAt = now.toISOString();
      claimed.push({ ...s });
    }
    await writeFileQueue(q);
    return claimed;
  });
}

export async function updateScheduledSend(
  id: string,
  patch: Partial<ScheduledSendRecord>,
): Promise<ScheduledSendRecord | null> {
  let updated: ScheduledSendRecord | null = null;

  await withStoreLock(async () => {
    const q = await readFileQueue();
    const idx = q.sends.findIndex((s) => s.id === id);
    if (idx >= 0) {
      q.sends[idx] = {
        ...q.sends[idx]!,
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      };
      updated = q.sends[idx]!;
      await writeFileQueue(q);
    }
  });

  const prisma = getPrisma();
  if (prisma) {
    try {
      const data: Record<string, unknown> = {};
      if (patch.status) data.status = patch.status;
      if (patch.runAt) data.runAt = new Date(patch.runAt);
      if (patch.claimedAt !== undefined) {
        data.claimedAt = patch.claimedAt ? new Date(patch.claimedAt) : null;
      }
      if ("claimOwner" in patch) data.claimOwner = patch.claimOwner ?? null;
      if ("stickyLineId" in patch) data.stickyLineId = patch.stickyLineId ?? null;
      if ("providerMsgId" in patch) data.providerMsgId = patch.providerMsgId ?? null;
      if ("lastError" in patch) data.lastError = patch.lastError ?? null;
      if (patch.attemptCount != null) data.attemptCount = patch.attemptCount;
      if ("deliveryStatus" in patch) {
        data.deliveryStatus = patch.deliveryStatus ?? null;
      }
      const row = await prisma.scheduledSend.update({
        where: { id },
        data,
      });
      updated = rowFromPrisma(row);
    } catch {
      /* file-only row */
    }
  }
  return updated;
}

export async function updateScheduledSendByProviderMsg(
  providerMsgId: string,
  patch: Partial<ScheduledSendRecord>,
): Promise<ScheduledSendRecord | null> {
  const prisma = getPrisma();
  if (prisma) {
    const found = await prisma.scheduledSend.findFirst({
      where: { providerMsgId },
    });
    if (found) return updateScheduledSend(found.id, patch);
  }

  return withStoreLock(async () => {
    const q = await readFileQueue();
    const row = q.sends.find((s) => s.providerMsgId === providerMsgId);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    await writeFileQueue(q);
    return { ...row };
  });
}

export async function updateScheduledSendByIdempotency(
  idempotencyKey: string,
  patch: Partial<ScheduledSendRecord>,
): Promise<ScheduledSendRecord | null> {
  const prisma = getPrisma();
  if (prisma) {
    const found = await prisma.scheduledSend.findUnique({
      where: { idempotencyKey },
    });
    if (found) return updateScheduledSend(found.id, patch);
  }
  return withStoreLock(async () => {
    const q = await readFileQueue();
    const row = q.sends.find((s) => s.idempotencyKey === idempotencyKey);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    await writeFileQueue(q);
    return { ...row };
  });
}

export async function deferScheduledSend(
  id: string,
  runAt: Date,
  reason: string,
): Promise<void> {
  await updateScheduledSend(id, {
    status: "PENDING",
    runAt: runAt.toISOString(),
    claimOwner: undefined,
    claimedAt: undefined,
    lastError: reason,
  });
}

export async function cancelScheduledForLead(
  leadId: string,
  reason: string,
): Promise<number> {
  let n = 0;
  await withStoreLock(async () => {
    const q = await readFileQueue();
    for (const s of q.sends) {
      if (s.leadId !== leadId) continue;
      if (s.status === "SENT" || s.status === "CANCELLED") continue;
      s.status = "CANCELLED";
      s.lastError = reason;
      s.updatedAt = new Date().toISOString();
      n += 1;
    }
    await writeFileQueue(q);
  });
  const prisma = getPrisma();
  if (prisma) {
    const res = await prisma.scheduledSend.updateMany({
      where: {
        leadId,
        status: { in: ["PENDING", "CLAIMED", "FAILED", "SKIPPED"] },
      },
      data: { status: "CANCELLED", lastError: reason },
    });
    n = Math.max(n, res.count);
  }
  return n;
}

export async function cancelScheduledForPhone(
  phoneE164: string,
  reason: string,
): Promise<number> {
  let n = 0;
  await withStoreLock(async () => {
    const q = await readFileQueue();
    for (const s of q.sends) {
      if (s.phoneE164 !== phoneE164) continue;
      if (s.status === "SENT" || s.status === "CANCELLED" || s.status === "SUPPRESSED") {
        continue;
      }
      s.status = "SUPPRESSED";
      s.lastError = reason;
      s.updatedAt = new Date().toISOString();
      n += 1;
    }
    await writeFileQueue(q);
  });
  const prisma = getPrisma();
  if (prisma) {
    const res = await prisma.scheduledSend.updateMany({
      where: {
        phoneE164,
        status: { in: ["PENDING", "CLAIMED", "FAILED", "SKIPPED"] },
      },
      data: { status: "SUPPRESSED", lastError: reason },
    });
    n = Math.max(n, res.count);
  }
  return n;
}

export async function countDueScheduled(
  campaignId: string,
  now = new Date(),
): Promise<number> {
  const prisma = getPrisma();
  if (prisma) {
    return prisma.scheduledSend.count({
      where: {
        campaignId,
        status: "PENDING",
        runAt: { lte: now },
      },
    });
  }
  const q = await readFileQueue();
  return q.sends.filter(
    (s) =>
      s.campaignId === campaignId &&
      s.status === "PENDING" &&
      Date.parse(s.runAt) <= now.getTime(),
  ).length;
}

export async function countPendingScheduled(campaignId: string): Promise<number> {
  const prisma = getPrisma();
  if (prisma) {
    return prisma.scheduledSend.count({
      where: {
        campaignId,
        status: { in: ["PENDING", "CLAIMED", "FAILED"] },
      },
    });
  }
  const q = await readFileQueue();
  return q.sends.filter(
    (s) =>
      s.campaignId === campaignId &&
      (s.status === "PENDING" ||
        s.status === "CLAIMED" ||
        s.status === "FAILED"),
  ).length;
}

export async function rebalanceCampaignSchedule(input: {
  campaignId: string;
  deferMs: number;
  now?: Date;
  reason?: string;
}): Promise<number> {
  const now = input.now ?? new Date();
  const runAt = new Date(now.getTime() + input.deferMs).toISOString();
  const reason = input.reason ?? "CAPACITY_REBALANCE";
  let n = 0;

  await withStoreLock(async () => {
    const q = await readFileQueue();
    for (const s of q.sends) {
      if (s.campaignId !== input.campaignId) continue;
      if (s.status !== "PENDING" && s.status !== "CLAIMED") continue;
      if (s.status === "CLAIMED") {
        s.status = "PENDING";
        s.claimOwner = undefined;
        s.claimedAt = undefined;
      }
      const current = Date.parse(s.runAt);
      if (current < Date.parse(runAt)) {
        s.runAt = runAt;
        s.lastError = reason;
        s.updatedAt = now.toISOString();
        n += 1;
      }
    }
    await writeFileQueue(q);
  });

  const prisma = getPrisma();
  if (prisma) {
    const res = await prisma.scheduledSend.updateMany({
      where: {
        campaignId: input.campaignId,
        status: { in: ["PENDING", "CLAIMED"] },
        runAt: { lt: new Date(runAt) },
      },
      data: {
        status: "PENDING",
        claimOwner: null,
        claimedAt: null,
        runAt: new Date(runAt),
        lastError: reason,
      },
    });
    n = Math.max(n, res.count);
  }
  return n;
}

export async function listScheduledForCampaign(
  campaignId: string,
): Promise<ScheduledSendRecord[]> {
  const prisma = getPrisma();
  if (prisma) {
    const rows = await prisma.scheduledSend.findMany({
      where: { campaignId },
      orderBy: [{ leadId: "asc" }, { stepPosition: "asc" }],
    });
    return rows.map(rowFromPrisma);
  }
  const q = await readFileQueue();
  return q.sends
    .filter((s) => s.campaignId === campaignId)
    .sort(
      (a, b) =>
        a.leadId.localeCompare(b.leadId) || a.stepPosition - b.stepPosition,
    );
}
