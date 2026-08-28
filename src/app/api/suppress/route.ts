import { NextResponse } from "next/server";
import { z } from "zod";
import { toE164 } from "@/lib/phone";
import { suppressLeadByPhone } from "@/lib/store/db";

const Body = z.object({
  phone: z.string().min(7),
  reason: z.string().max(120).optional(),
  markDnc: z.boolean().optional(),
  optOut: z.boolean().optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const phoneE164 = toE164(parsed.data.phone);
  if (!phoneE164) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  const n = await suppressLeadByPhone(
    phoneE164,
    parsed.data.reason ?? "MCP_SUPPRESS",
    {
      markDnc: parsed.data.markDnc,
      optOut: parsed.data.optOut,
      source: parsed.data.optOut ? "SMS_STOP" : "MANUAL",
    },
  );
  return NextResponse.json({ ok: true, phoneE164, leadsUpdated: n });
}
