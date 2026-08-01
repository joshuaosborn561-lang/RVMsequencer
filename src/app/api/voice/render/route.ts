import { NextResponse } from "next/server";
import { z } from "zod";
import { getElevenLabs } from "@/lib/config";

const Body = z.object({
  text: z.string().min(5).max(5000),
  voiceId: z.string().min(1),
});

/** Generate once (cached by script hash) via ElevenLabs Multilingual v2. */
export async function POST(req: Request) {
  const json: unknown = await req.json();
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY not configured" },
      { status: 503 },
    );
  }

  try {
    const client = getElevenLabs();
    const result = await client.render({
      text: parsed.data.text,
      voiceExternalId: parsed.data.voiceId,
      format: "mp3",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "render_failed" },
      { status: 502 },
    );
  }
}
