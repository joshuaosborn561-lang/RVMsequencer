import { NextResponse } from "next/server";
import { z } from "zod";
import { toE164 } from "@/lib/phone";
import { ensureLine, listLines } from "@/lib/store/db";

export async function GET() {
  const lines = await listLines();
  return NextResponse.json({ lines });
}

const Body = z.object({
  e164: z.string().min(7),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const e164 = toE164(parsed.data.e164);
  if (!e164) {
    return NextResponse.json(
      { error: "invalid_phone", hint: "Use US/CA 10-digit or E.164" },
      { status: 400 },
    );
  }
  const line = await ensureLine(e164);
  return NextResponse.json({ line }, { status: 201 });
}
