import { NextResponse } from "next/server";
import { z } from "zod";
import { guardApiRateLimit } from "@/lib/security/api-guard";
import { createCampaign, listCampaigns } from "@/lib/store/db";

export async function GET() {
  const campaigns = await listCampaigns();
  return NextResponse.json({ campaigns });
}

const CreateBody = z.object({
  name: z.string().min(1).max(120),
  clientId: z.string().optional(),
});

export async function POST(req: Request) {
  const limited = await guardApiRateLimit(req, "campaigns");
  if (limited) return limited;
  const json: unknown = await req.json();
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const campaign = await createCampaign(parsed.data);
  return NextResponse.json({ campaign }, { status: 201 });
}
