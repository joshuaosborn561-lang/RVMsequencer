import { toZonedTime } from "date-fns-tz";
import { digitsOnly, toE164 } from "@/lib/phone";
import prefixes from "@/data/phone-timezone-prefixes.json";

const PREFIX_MAP = prefixes as Record<string, string>;

/**
 * Resolve IANA timezone from phone using Google libphonenumber timezone prefixes
 * (longest-prefix match). Falls back to America/New_York for unknown NANP.
 */
export function timezoneFromPhone(
  phone: string,
  explicitTimezone?: string | null,
): string {
  if (explicitTimezone) return explicitTimezone;

  const e164 = toE164(phone);
  const digits = e164 ? digitsOnly(e164) : digitsOnly(phone);
  if (!digits) return "America/New_York";

  for (let len = Math.min(digits.length, 10); len >= 1; len--) {
    const key = digits.slice(0, len);
    if (PREFIX_MAP[key]) return PREFIX_MAP[key];
  }
  return "America/New_York";
}

export type LocalClock = {
  timezone: string;
  localHour: number;
  localDayOfWeek: number; // 0=Sun … 6=Sat
  localDate: Date;
};

export function localClockAt(
  phone: string,
  at: Date = new Date(),
  explicitTimezone?: string | null,
): LocalClock {
  const timezone = timezoneFromPhone(phone, explicitTimezone);
  const localDate = toZonedTime(at, timezone);
  return {
    timezone,
    localHour: localDate.getHours(),
    localDayOfWeek: localDate.getDay(),
    localDate,
  };
}
