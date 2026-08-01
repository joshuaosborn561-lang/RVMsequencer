import { NextResponse } from "next/server";
import { z } from "zod";
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

const PatchBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    status: z
      .enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"])
      .optional(),
    steps: z
      .array(
        z.object({
          id: z.string(),
          position: z.number().int().positive(),
          delayDays: z.number().int().min(0),
          scriptTemplate: z.string(),
          voiceId: z.string().optional(),
          audioUrl: z.string().optional(),
        }),
      )
      .optional(),
    lineIds: z.array(z.string()).optional(),
    schedule: z
      .object({
        sendWindowStart: z.number().int().min(0).max(23).optional(),
        sendWindowEnd: z.number().int().min(1).max(24).optional(),
        sendDays: z.array(z.number().int().min(0).max(6)).optional(),
        timezoneMode: z.enum(["RECIPIENT_LOCAL", "FIXED"]).optional(),
        fixedTimezone: z.string().optional(),
        newLeadsPerDay: z.number().int().min(1).max(100_000).optional(),
        requireConsent: z.boolean().optional(),
        stopOnCallback: z.boolean().optional(),
        stopOnOptOut: z.boolean().optional(),
      })
      .optional(),
    dropCoCampaignToken: z.string().optional(),
    elevenVoiceId: z.string().optional(),
    audioUrl: z.string().optional(),
  })
  .strict();

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const parsed = PatchBody.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await getCampaign(id);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (parsed.data.status === "ACTIVE") {
    const leads = await listLeads(id);
    const sendable = leads.filter(
      (l) =>
        !l.dnc &&
        l.consentStatus !== "OPTED_OUT" &&
        (l.status ?? "PENDING") !== "SUPPRESSED" &&
        (l.status ?? "PENDING") !== "SENT",
    );
    const lineIds = parsed.data.lineIds ?? existing.lineIds;
    const audioUrl = parsed.data.audioUrl || existing.audioUrl;
    const elevenVoiceId =
      parsed.data.elevenVoiceId ||
      existing.elevenVoiceId ||
      existing.steps[0]?.voiceId;
    const stepAudio = existing.steps[0]?.audioUrl;
    const hasAudio = Boolean(audioUrl || stepAudio || elevenVoiceId);

    const blockers: string[] = [];
    if (sendable.length === 0) blockers.push("no_sendable_leads");
    if (lineIds.length === 0) blockers.push("no_lines");
    if (!hasAudio) blockers.push("no_audio_or_voice");
    const days = parsed.data.schedule?.sendDays ?? existing.schedule.sendDays;
    if (!days.length) blockers.push("no_send_days");

    if (blockers.length) {
      return NextResponse.json(
        {
          error: "launch_blocked",
          blockers,
          hint: "Need sendable leads, at least one line, audio URL or ElevenLabs voice id, and send days.",
        },
        { status: 400 },
      );
    }
  }

  if (parsed.data.schedule?.sendDays && parsed.data.schedule.sendDays.length === 0) {
    return NextResponse.json(
      { error: "send_days_required" },
      { status: 400 },
    );
  }

  const { schedule: schedulePatch, ...rest } = parsed.data;
  const campaign = await updateCampaign(id, {
    ...rest,
    ...(schedulePatch
      ? { schedule: { ...existing.schedule, ...schedulePatch } }
      : {}),
  });
  return NextResponse.json({ campaign });
}
