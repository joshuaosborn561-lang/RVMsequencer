import { NextResponse } from "next/server";

/**
 * ElevenLabs TTS was removed. Host a WAV/MP3 and set campaign audioUrl
 * for Slybroadcast c_url.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "tts_removed",
      hint: "Host a WAV/MP3 (≥5s) and set audioUrl on the campaign Sequence tab for Slybroadcast.",
    },
    { status: 410 },
  );
}
