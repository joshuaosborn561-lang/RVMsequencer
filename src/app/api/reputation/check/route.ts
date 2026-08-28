import { NextResponse } from "next/server";
import {
  runDailyReputationChecks,
  shouldRunDailyReputation,
} from "@/lib/reputation/run-daily";

/**
 * Daily spam / blacklist / health check for Twilio from-numbers.
 * Auth: CRON_SECRET (x-cron-secret or Bearer).
 *
 * Body: `{ "force": true }` to run even if checked in the last ~20h.
 */
function authorize(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const header = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  return header === secret || auth === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const gate = await shouldRunDailyReputation(false);
  return NextResponse.json({
    due: gate.run,
    reason: gate.reason ?? null,
    hiyaEnabled: Boolean(process.env.HIYA_API_KEY?.trim()),
  });
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let force = false;
  const raw = await req.text();
  if (raw.trim()) {
    try {
      const json = JSON.parse(raw) as { force?: boolean };
      force = json.force === true;
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
  }

  const result = await runDailyReputationChecks({ force });
  return NextResponse.json(result);
}
