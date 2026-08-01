import { NextResponse } from "next/server";
import { z } from "zod";
import { renderScript } from "@/lib/compliance/gates";
import { evaluateSendWindow } from "@/lib/sequencer/send-window";
import { getCampaign, listLeads } from "@/lib/store/db";
import { timezoneFromPhone } from "@/lib/timezone/from-phone";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  leadId: z.string().optional(),
  stepPosition: z.number().int().positive().optional(),
});

/** Preview personalized script for a lead (Smartlead-style variable preview). */
export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const json: unknown = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  const leads = await listLeads(id);
  const lead =
    (parsed.success && parsed.data.leadId
      ? leads.find((l) => l.id === parsed.data.leadId)
      : null) ?? leads[0];

  if (!lead) {
    return NextResponse.json(
      { error: "no_leads", hint: "Import a CSV first" },
      { status: 400 },
    );
  }

  const stepPos = parsed.success ? (parsed.data.stepPosition ?? 1) : 1;
  const step =
    campaign.steps.find((s) => s.position === stepPos) ?? campaign.steps[0];
  if (!step) {
    return NextResponse.json({ error: "no_steps" }, { status: 400 });
  }

  const vars: Record<string, string> = {
    first_name: lead.firstName ?? "",
    last_name: lead.lastName ?? "",
    company: lead.company ?? "",
    email: lead.email ?? "",
    phone: lead.phoneE164,
    ...lead.custom,
  };

  const rendered = renderScript(step.scriptTemplate, vars);
  const window = evaluateSendWindow({
    phoneE164: lead.phoneE164,
    timezone: lead.timezone,
    dnc: lead.dnc,
    consentStatus: lead.consentStatus,
    schedule: {
      sendWindowStart: campaign.schedule.sendWindowStart,
      sendWindowEnd: campaign.schedule.sendWindowEnd,
      sendDays: campaign.schedule.sendDays,
      requireConsent: campaign.schedule.requireConsent,
    },
  });

  return NextResponse.json({
    lead,
    step,
    rendered,
    timezone: timezoneFromPhone(lead.phoneE164, lead.timezone),
    variables: vars,
    inWindow: window.allow,
    reason: window.allow ? undefined : window.reason,
  });
}
