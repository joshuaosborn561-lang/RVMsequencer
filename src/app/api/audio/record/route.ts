import { NextResponse } from "next/server";
import { saveRecordingToCampaign, getCampaign } from "@/lib/store/db";
import { verifyRecorderToken } from "@/lib/security/recorder-link";

export const runtime = "nodejs";

/**
 * Operator recorder upload: multipart file + campaignId + token.
 * Attaches WAV to campaign without changing status.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });
  }

  const campaignId = String(form.get("campaignId") ?? "").trim();
  const token = String(form.get("token") ?? "").trim();
  const file = form.get("file");

  if (!campaignId) {
    return NextResponse.json({ error: "campaignId_required" }, { status: 400 });
  }

  const auth = verifyRecorderToken(campaignId, token);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.reason },
      { status: 401 },
    );
  }

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }

  const contentType = (file.type || "").toLowerCase();
  const allowedType =
    !contentType ||
    contentType === "audio/wav" ||
    contentType === "audio/wave" ||
    contentType === "audio/x-wav" ||
    contentType === "application/octet-stream";
  if (!allowedType) {
    return NextResponse.json(
      { error: "audio_wav_required", hint: `Got ${contentType}` },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length < 8 * 1024) {
    return NextResponse.json(
      { error: "audio_too_small", hint: "Minimum 8KB WAV" },
      { status: 400 },
    );
  }
  if (bytes.length > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: "audio_too_large", hint: "Max 10MB" },
      { status: 400 },
    );
  }

  // Basic RIFF/WAVE check
  if (
    bytes.length < 12 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return NextResponse.json({ error: "not_wav" }, { status: 400 });
  }

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
  }

  // Estimate duration from PCM size (16-bit mono 8kHz ≈ 16000 bytes/sec + 44 header)
  const durationSeconds = Math.max(
    0,
    Math.round(((bytes.length - 44) / 16000) * 10) / 10,
  );

  const saved = await saveRecordingToCampaign({
    campaignId,
    bytes,
    durationSeconds,
  });
  if (!saved) {
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      id: saved.asset.id,
      url: saved.asset.url,
      bytes: bytes.length,
      durationSeconds: saved.durationSeconds ?? durationSeconds,
    },
    { status: 201 },
  );
}
