import { NextResponse } from "next/server";
import { z } from "zod";
import { getCampaign, updateCampaign } from "@/lib/store/db";
import {
  createRecorderToken,
  recorderLinkUrl,
  RECORDER_DEFAULT_TTL_HOURS,
} from "@/lib/security/recorder-link";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  ttlHours: z.number().int().min(1).max(24 * 30).optional(),
  /** Voicemail script shown on the recorder page (step 1). */
  scriptTemplate: z.string().min(1).max(5000).optional(),
  /** Alias for scriptTemplate */
  script: z.string().min(1).max(5000).optional(),
});

/** Mint a signed operator recording link for a campaign. */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let ttlHours = RECORDER_DEFAULT_TTL_HOURS;
  let scriptIn: string | undefined;
  try {
    const json: unknown = await req.json().catch(() => ({}));
    const parsed = Body.safeParse(json ?? {});
    if (parsed.success) {
      if (parsed.data.ttlHours != null) ttlHours = parsed.data.ttlHours;
      scriptIn = parsed.data.scriptTemplate ?? parsed.data.script;
    }
  } catch {
    /* empty body ok */
  }

  if (scriptIn != null) {
    const script = scriptIn.trim();
    const steps = [...campaign.steps];
    const idx = steps.findIndex((s) => s.position === 1);
    if (idx >= 0) {
      steps[idx] = { ...steps[idx]!, scriptTemplate: script };
    } else if (steps.length > 0) {
      steps[0] = { ...steps[0]!, scriptTemplate: script };
    } else {
      steps.push({
        id: "step_1",
        position: 1,
        delayDays: 0,
        scriptTemplate: script,
      });
    }
    const updated = await updateCampaign(id, { steps });
    if (updated) campaign = updated;
  }

  try {
    const { token, expiresAt } = createRecorderToken(
      id,
      ttlHours * 60 * 60 * 1000,
    );
    const url = recorderLinkUrl({ campaignId: id, token });
    const step1 =
      campaign.steps.find((s) => s.position === 1) ?? campaign.steps[0];
    return NextResponse.json({
      url,
      expiresAt,
      campaignName: campaign.name,
      campaignId: id,
      scriptTemplate: step1?.scriptTemplate ?? "",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "token_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
