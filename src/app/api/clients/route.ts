import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApiRateLimit } from "@/lib/security/api-guard";
import {
  createClient,
  listClients,
  updateClient,
} from "@/lib/store/db";

export async function GET() {
  return NextResponse.json({ clients: await listClients() });
}

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  hubspotOptIn: z.boolean().optional(),
  hubspotOwnerId: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const limited = await guardApiRateLimit(req, "clients");
  if (limited) return limited;
  const parsed = CreateBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const client = await createClient(parsed.data);
  return NextResponse.json({ client }, { status: 201 });
}

const PatchBody = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  hubspotOptIn: z.boolean().optional(),
  hubspotOwnerId: z.string().max(64).nullable().optional(),
});

export async function PATCH(req: Request) {
  const limited = await guardApiRateLimit(req, "clients");
  if (limited) return limited;
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { id, hubspotOwnerId, ...rest } = parsed.data;
  const client = await updateClient(id, {
    ...rest,
    hubspotOwnerId:
      hubspotOwnerId === null ? "" : hubspotOwnerId ?? undefined,
  });
  if (!client) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ client });
}
