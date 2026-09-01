import { NextResponse } from "next/server";
import { z } from "zod";
import { getCampaign } from "@/lib/store/db";
import {
  createRecorderToken,
  recorderLinkUrl,
  RECORDER_DEFAULT_TTL_HOURS,
} from "@/lib/security/recorder-link";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  ttlHours: z.number().int().min(1).max(24 * 30).optional(),
});

/** Mint a signed operator recording link for a campaign. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let ttlHours = RECORDER_DEFAULT_TTL_HOURS;
  try {
    const json: unknown = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(json ?? {});
    if (parsed.success && parsed.data.ttlHours != null) {
      ttlHours = parsed.data.ttlHours;
    }
  } catch {
    /* empty body ok */
  }

  try {
    const { token, expiresAt } = createRecorderToken(
      id,
      ttlHours * 60 * 60 * 1000,
    );
    const url = recorderLinkUrl({ campaignId: id, token });
    return NextResponse.json({
      url,
      expiresAt,
      campaignName: campaign.name,
      campaignId: id,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "token_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
