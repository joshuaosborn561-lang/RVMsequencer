import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, listClients } from "@/lib/store/db";

export async function GET() {
  return NextResponse.json({ clients: await listClients() });
}

const Body = z.object({ name: z.string().min(1).max(120) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const client = await createClient(parsed.data.name);
  return NextResponse.json({ client }, { status: 201 });
}
