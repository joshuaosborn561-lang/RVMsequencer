import { addMinutes, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { localClockAt } from "@/lib/timezone/from-phone";
import { evaluateCompliance, type ConsentStatus } from "@/lib/compliance/gates";

export type SendSchedule = {
  /** Local hour inclusive start (e.g. 9) */
  sendWindowStart: number;
  /** Local hour exclusive end (e.g. 20 → until 7:59pm) */
  sendWindowEnd: number;
  /** JS getDay() values allowed */
  sendDays: number[];
  requireConsent?: boolean;
};

export type ScheduleDecision =
  | { allow: true; timezone: string; localHour: number; localDayOfWeek: number }
  | {
      allow: false;
      reason: "DNC" | "OPTED_OUT" | "MISSING_CONSENT" | "OUTSIDE_SEND_WINDOW" | "OUTSIDE_SEND_DAYS";
      timezone: string;
      localHour: number;
      localDayOfWeek: number;
      /** Next UTC instant when this lead's local clock enters the window */
      nextEligibleAt: Date;
    };

/**
 * Smartlead-style sending window evaluated in the *recipient's* local time
 * (derived from phone NPA via timezone map, or explicit lead.timezone).
 */
export function evaluateSendWindow(input: {
  phoneE164: string;
  timezone?: string | null;
  dnc: boolean;
  consentStatus: ConsentStatus;
  schedule: SendSchedule;
  now?: Date;
}): ScheduleDecision {
  const now = input.now ?? new Date();
  const clock = localClockAt(input.phoneE164, now, input.timezone);
  const gate = evaluateCompliance({
    consentStatus: input.consentStatus,
    dnc: input.dnc,
    requireConsent: input.schedule.requireConsent ?? false,
    localHour: clock.localHour,
    sendWindowStart: input.schedule.sendWindowStart,
    sendWindowEnd: input.schedule.sendWindowEnd,
    localDayOfWeek: clock.localDayOfWeek,
    sendDays: input.schedule.sendDays,
  });

  if (gate.allow) {
    return {
      allow: true,
      timezone: clock.timezone,
      localHour: clock.localHour,
      localDayOfWeek: clock.localDayOfWeek,
    };
  }

  return {
    allow: false,
    reason: gate.reason,
    timezone: clock.timezone,
    localHour: clock.localHour,
    localDayOfWeek: clock.localDayOfWeek,
    nextEligibleAt: nextEligibleUtc({
      phoneE164: input.phoneE164,
      timezone: clock.timezone,
      schedule: input.schedule,
      from: now,
    }),
  };
}

/** Next UTC time the recipient's local clock is inside send days + window. */
export function nextEligibleUtc(input: {
  phoneE164: string;
  timezone: string;
  schedule: SendSchedule;
  from: Date;
}): Date {
  // Walk local half-hours for up to 14 days
  let cursor = input.from;
  for (let i = 0; i < 14 * 48; i++) {
    const clock = localClockAt(input.phoneE164, cursor, input.timezone);
    const inDay = input.schedule.sendDays.includes(clock.localDayOfWeek);
    const inHour =
      clock.localHour >= input.schedule.sendWindowStart &&
      clock.localHour < input.schedule.sendWindowEnd;
    if (inDay && inHour) {
      // Snap to start of current local hour if we're already inside
      const localStart = setMilliseconds(
        setSeconds(
          setMinutes(setHours(clock.localDate, clock.localHour), 0),
          0,
        ),
        0,
      );
      return fromZonedTime(localStart, input.timezone);
    }
    cursor = addMinutes(cursor, 30);
  }

  // Fallback: tomorrow at window start in their TZ
  const tomorrow = addMinutes(input.from, 24 * 60);
  const tClock = localClockAt(input.phoneE164, tomorrow, input.timezone);
  const localOpen = setMilliseconds(
    setSeconds(
      setMinutes(setHours(tClock.localDate, input.schedule.sendWindowStart), 0),
      0,
    ),
    0,
  );
  return fromZonedTime(localOpen, input.timezone);
}
