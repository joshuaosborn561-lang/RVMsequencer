import { addMinutes, setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import {
  clampSendWindow,
  timezoneFromUsState,
} from "@/lib/compliance/quiet-hours";
import { evaluateCompliance, type ConsentStatus } from "@/lib/compliance/gates";
import { localClockAt } from "@/lib/timezone/from-phone";

/** JS Date.getDay() for Friday. */
export const JS_FRIDAY = 5;

export type SendSchedule = {
  /** Local hour inclusive start (e.g. 9) */
  sendWindowStart: number;
  /** Local hour exclusive end (e.g. 17 → until 16:59) */
  sendWindowEnd: number;
  /** Optional Friday-only inclusive start. Absent → sendWindowStart. */
  fridaySendWindowStart?: number | null;
  /** Optional Friday-only exclusive end. Absent → sendWindowEnd. */
  fridaySendWindowEnd?: number | null;
  /** JS getDay() values allowed */
  sendDays: number[];
  requireConsent?: boolean;
  timezoneMode?: "RECIPIENT_LOCAL" | "FIXED";
  fixedTimezone?: string;
};

export type DaySendWindow = {
  sendWindowStart: number;
  sendWindowEnd: number;
};

/** Campaign hours for a local JS getDay() value. Friday may be shorter. */
export function campaignWindowForLocalDay(
  schedule: Pick<
    SendSchedule,
    | "sendWindowStart"
    | "sendWindowEnd"
    | "fridaySendWindowStart"
    | "fridaySendWindowEnd"
  >,
  localDayOfWeek: number,
): DaySendWindow {
  if (localDayOfWeek === JS_FRIDAY) {
    return {
      sendWindowStart:
        schedule.fridaySendWindowStart ?? schedule.sendWindowStart,
      sendWindowEnd: schedule.fridaySendWindowEnd ?? schedule.sendWindowEnd,
    };
  }
  return {
    sendWindowStart: schedule.sendWindowStart,
    sendWindowEnd: schedule.sendWindowEnd,
  };
}

export type ScheduleDecision =
  | {
      allow: true;
      timezone: string;
      localHour: number;
      localDayOfWeek: number;
      appliedWindow: {
        sendWindowStart: number;
        sendWindowEnd: number;
        sendDays: number[];
        appliedState: string;
      };
    }
  | {
      allow: false;
      reason: "DNC" | "OPTED_OUT" | "MISSING_CONSENT" | "OUTSIDE_SEND_WINDOW" | "OUTSIDE_SEND_DAYS";
      timezone: string;
      localHour: number;
      localDayOfWeek: number;
      nextEligibleAt: Date;
      appliedWindow: {
        sendWindowStart: number;
        sendWindowEnd: number;
        sendDays: number[];
        appliedState: string;
      };
    };

function resolveTimezone(input: {
  phoneE164: string;
  timezone?: string | null;
  state?: string | null;
  schedule: SendSchedule;
}): string | null {
  if (input.schedule.timezoneMode === "FIXED" && input.schedule.fixedTimezone) {
    return input.schedule.fixedTimezone;
  }
  if (input.timezone) return input.timezone;
  const fromState = timezoneFromUsState(input.state);
  if (fromState) return fromState;
  return null; // fall through to phone NPA in localClockAt
}

/**
 * Smartlead-style sending window in recipient-local time, clamped by
 * federal + state quiet-hours. TZ preference: FIXED → explicit → address state → NPA.
 */
export function evaluateSendWindow(input: {
  phoneE164: string;
  timezone?: string | null;
  /** US state from lead address (custom.state) for quiet hours + TZ. */
  state?: string | null;
  dnc: boolean;
  consentStatus: ConsentStatus;
  schedule: SendSchedule;
  now?: Date;
}): ScheduleDecision {
  const now = input.now ?? new Date();
  const explicitTz = resolveTimezone({
    phoneE164: input.phoneE164,
    timezone: input.timezone,
    state: input.state,
    schedule: input.schedule,
  });
  const clock = localClockAt(input.phoneE164, now, explicitTz);
  const dayWindow = campaignWindowForLocalDay(
    input.schedule,
    clock.localDayOfWeek,
  );
  const clamped = clampSendWindow({
    state: input.state,
    sendWindowStart: dayWindow.sendWindowStart,
    sendWindowEnd: dayWindow.sendWindowEnd,
    sendDays: input.schedule.sendDays,
  });
  const appliedWindow = {
    sendWindowStart: clamped.sendWindowStart,
    sendWindowEnd: clamped.sendWindowEnd,
    sendDays: clamped.sendDays,
    appliedState: clamped.appliedState,
  };

  const gate = evaluateCompliance({
    consentStatus: input.consentStatus,
    dnc: input.dnc,
    requireConsent: input.schedule.requireConsent ?? false,
    localHour: clock.localHour,
    sendWindowStart: clamped.sendWindowStart,
    sendWindowEnd: clamped.sendWindowEnd,
    localDayOfWeek: clock.localDayOfWeek,
    sendDays: clamped.sendDays,
  });

  if (gate.allow) {
    return {
      allow: true,
      timezone: clock.timezone,
      localHour: clock.localHour,
      localDayOfWeek: clock.localDayOfWeek,
      appliedWindow,
    };
  }

  return {
    allow: false,
    reason: gate.reason,
    timezone: clock.timezone,
    localHour: clock.localHour,
    localDayOfWeek: clock.localDayOfWeek,
    appliedWindow,
    nextEligibleAt: nextEligibleUtc({
      phoneE164: input.phoneE164,
      timezone: clock.timezone,
      schedule: {
        ...input.schedule,
        sendDays: clamped.sendDays,
      },
      state: input.state,
      from: now,
    }),
  };
}

function clampedWindowAtLocalDay(
  schedule: Pick<
    SendSchedule,
    | "sendWindowStart"
    | "sendWindowEnd"
    | "sendDays"
    | "fridaySendWindowStart"
    | "fridaySendWindowEnd"
  >,
  localDayOfWeek: number,
  state?: string | null,
) {
  const dayWindow = campaignWindowForLocalDay(schedule, localDayOfWeek);
  return clampSendWindow({
    state,
    sendWindowStart: dayWindow.sendWindowStart,
    sendWindowEnd: dayWindow.sendWindowEnd,
    sendDays: schedule.sendDays,
  });
}

/** Next UTC time the recipient's local clock is inside send days + window. */
export function nextEligibleUtc(input: {
  phoneE164: string;
  timezone: string;
  schedule: Pick<
    SendSchedule,
    | "sendWindowStart"
    | "sendWindowEnd"
    | "sendDays"
    | "fridaySendWindowStart"
    | "fridaySendWindowEnd"
  >;
  state?: string | null;
  from: Date;
}): Date {
  let cursor = input.from;
  for (let i = 0; i < 14 * 48; i++) {
    const clock = localClockAt(input.phoneE164, cursor, input.timezone);
    const clamped = clampedWindowAtLocalDay(
      input.schedule,
      clock.localDayOfWeek,
      input.state,
    );
    const inDay = clamped.sendDays.includes(clock.localDayOfWeek);
    const inHour =
      clock.localHour >= clamped.sendWindowStart &&
      clock.localHour < clamped.sendWindowEnd;
    if (inDay && inHour) {
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

  const tomorrow = addMinutes(input.from, 24 * 60);
  const tClock = localClockAt(input.phoneE164, tomorrow, input.timezone);
  const tomorrowWindow = clampedWindowAtLocalDay(
    input.schedule,
    tClock.localDayOfWeek,
    input.state,
  );
  const localOpen = setMilliseconds(
    setSeconds(
      setMinutes(setHours(tClock.localDate, tomorrowWindow.sendWindowStart), 0),
      0,
    ),
    0,
  );
  return fromZonedTime(localOpen, input.timezone);
}
