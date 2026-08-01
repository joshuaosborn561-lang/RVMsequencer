import { NextResponse } from "next/server";
import { getCampaign, listLeads, updateCampaign } from "@/lib/store/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const leads = await listLeads(id);
  return NextResponse.json({ campaign, leads });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const patch: unknown = await req.json();
  if (!patch || typeof patch !== "object") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const campaign = await updateCampaign(id, patch as Parameters<typeof updateCampaign>[1]);
  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ campaign });
}
