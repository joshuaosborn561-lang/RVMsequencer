import { NextResponse } from "next/server";
import { listQuietHoursRules } from "@/lib/compliance/quiet-hours";

/** List federal + state quiet-hours clamps used by the sequencer. */
export async function GET() {
  return NextResponse.json({ rules: listQuietHoursRules() });
}
