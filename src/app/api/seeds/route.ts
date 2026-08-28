import { NextResponse } from "next/server";
import { z } from "zod";
import { toE164 } from "@/lib/phone";
import {
  appendAudit,
  deleteSeedNumber,
  listSeedNumbers,
  upsertSeedNumber,
} from "@/lib/store/db";
import { upsertSeedNumberRow } from "@/lib/supabase/rvm-sync";

export async function GET() {
  const seeds = await listSeedNumbers();
  return NextResponse.json({ seeds });
}

const PostBody = z.object({
  e164: z.string().min(7),
  label: z.string().optional(),
  carrier: z.string().optional(),
  active: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = PostBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const e164 = toE164(parsed.data.e164);
  if (!e164) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  const seed = await upsertSeedNumber({
    e164,
    label: parsed.data.label,
    carrier: parsed.data.carrier,
    active: parsed.data.active,
  });
  await appendAudit({
    action: "SEED_INJECTED",
    actor: "api",
    entityType: "seed",
    entityId: seed.id,
    detail: { e164: seed.e164, label: seed.label },
  });
  void upsertSeedNumberRow({
    id: seed.id,
    e164: seed.e164,
    label: seed.label,
    carrier: seed.carrier,
    active: seed.active,
    last_drop_at: seed.lastDropAt,
  });
  return NextResponse.json({ seed }, { status: 201 });
}

const PatchBody = z.object({
  id: z.string().optional(),
  e164: z.string().optional(),
  label: z.string().optional(),
  carrier: z.string().optional(),
  active: z.boolean().optional(),
  delete: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const key = parsed.data.id || parsed.data.e164;
  if (!key) {
    return NextResponse.json({ error: "id_or_e164_required" }, { status: 400 });
  }
  if (parsed.data.delete) {
    const ok = await deleteSeedNumber(key);
    return NextResponse.json({ deleted: ok });
  }

  const existing = (await listSeedNumbers()).find(
    (s) => s.id === key || s.e164 === key,
  );
  const e164 =
    (parsed.data.e164 ? toE164(parsed.data.e164) : null) ||
    existing?.e164 ||
    (parsed.data.e164 ? null : null);
  if (!e164) {
    return NextResponse.json({ error: "invalid_phone_or_not_found" }, { status: 400 });
  }
  const seed = await upsertSeedNumber({
    e164,
    label: parsed.data.label,
    carrier: parsed.data.carrier,
    active: parsed.data.active,
  });
  return NextResponse.json({ seed });
}
