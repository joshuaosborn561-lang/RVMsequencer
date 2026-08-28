import { NextResponse } from "next/server";

/**
 * ElevenLabs TTS was removed. Audio must be a Drop Cowboy recording_id
 * (or approved audio_url) set on the campaign.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "tts_removed",
      hint: "Upload audio in Drop Cowboy → Recordings and set dropCowboyRecordingId on the campaign.",
    },
    { status: 410 },
  );
}
