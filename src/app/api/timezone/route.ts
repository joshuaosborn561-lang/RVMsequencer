import { NextResponse } from "next/server";
import { z } from "zod";
import { localClockAt, timezoneFromPhone } from "@/lib/timezone/from-phone";

const Query = z.object({
  phone: z.string().min(7),
});

/** Preview recipient local timezone/clock from phone NPA. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = Query.safeParse({ phone: url.searchParams.get("phone") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "phone query required" }, { status: 400 });
  }
  const timezone = timezoneFromPhone(parsed.data.phone);
  const clock = localClockAt(parsed.data.phone);
  return NextResponse.json({
    phone: parsed.data.phone,
    timezone,
    localHour: clock.localHour,
    localDayOfWeek: clock.localDayOfWeek,
  });
}
