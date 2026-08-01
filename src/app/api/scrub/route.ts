import { NextResponse } from "next/server";
import { z } from "zod";
import { getDncScrubbers } from "@/lib/config";
import { scrubWithAll } from "@/lib/dnc/scrub";

const Body = z.object({
  numbers: z.array(z.string()).min(1).max(3000),
  internalBlocked: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const json: unknown = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const scrubbers = getDncScrubbers(parsed.data.internalBlocked ?? []);
  const results = await scrubWithAll(scrubbers, parsed.data.numbers);
  const blocked = results.filter((r) => r.blocked).length;

  return NextResponse.json({
    total: results.length,
    blocked,
    clean: results.length - blocked,
    results,
  });
}
