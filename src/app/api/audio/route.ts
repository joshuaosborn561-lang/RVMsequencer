import { NextResponse } from "next/server";
import { z } from "zod";
import { listAudioAssets, registerAudioUrl, uploadAudioAsset } from "@/lib/store/db";

export async function GET() {
  const assets = await listAudioAssets();
  return NextResponse.json({ assets });
}

const Body = z.object({
  name: z.string().min(1).max(120).optional(),
  /** Register an already-hosted public WAV/MP3/M4A URL */
  url: z.string().url().optional(),
  /** Base64 audio bytes (with or without data: URL prefix) */
  base64: z.string().min(8).optional(),
  contentType: z.string().optional(),
});

/**
 * Audio library for Claude:
 * - reuse prior assets via GET
 * - register a hosted URL, or upload base64 → served at /api/audio/{id}/file
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const name = parsed.data.name?.trim() || "Voicemail";

  if (parsed.data.url) {
    const asset = await registerAudioUrl({ name, url: parsed.data.url });
    return NextResponse.json({ asset }, { status: 201 });
  }

  if (parsed.data.base64) {
    let b64 = parsed.data.base64.trim();
    let contentType = parsed.data.contentType;
    const dataUrl = /^data:([^;]+);base64,([\s\S]+)$/.exec(b64);
    if (dataUrl) {
      contentType = contentType || dataUrl[1];
      b64 = dataUrl[2];
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, "base64");
    } catch {
      return NextResponse.json({ error: "invalid_base64" }, { status: 400 });
    }
    if (bytes.length < 1000) {
      return NextResponse.json(
        { error: "audio_too_small", hint: "Need a real WAV/MP3 ≥ ~1KB (Slybroadcast wants ≥5s)." },
        { status: 400 },
      );
    }
    if (bytes.length > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "audio_too_large", hint: "Max 15MB" }, { status: 400 });
    }
    const asset = await uploadAudioAsset({ name, bytes, contentType });
    return NextResponse.json({ asset }, { status: 201 });
  }

  return NextResponse.json(
    {
      error: "url_or_base64_required",
      hint: "Pass url (hosted file) or base64 (upload). Claude can ask the user to record then upload.",
    },
    { status: 400 },
  );
}
