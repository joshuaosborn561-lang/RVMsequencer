import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/store/db";

export async function GET(req: Request) {
  const clientId = new URL(req.url).searchParams.get("clientId") ?? undefined;
  return NextResponse.json({ keys: await listApiKeys(clientId) });
}

const CreateBody = z.object({
  clientId: z.string(),
  name: z.string().min(1).max(80),
});

export async function POST(req: Request) {
  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const key = await createApiKey(parsed.data);
  return NextResponse.json({ key }, { status: 201 });
}

const RevokeBody = z.object({ id: z.string() });

export async function DELETE(req: Request) {
  const parsed = RevokeBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const ok = await revokeApiKey(parsed.data.id);
  return NextResponse.json({ ok });
}
