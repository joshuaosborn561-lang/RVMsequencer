/**
 * US quiet-hours / calling-window clamps (TCPA federal floor + stricter state rules).
 * Not legal advice — conservative product defaults for RVM send windows.
 *
 * Federal TCPA telephone solicitation floor: 8:00–21:00 recipient local time.
 * Several states tighten start/end or ban Sundays.
 */

export type QuietHoursRule = {
  /** USPS 2-letter state, or "*" for federal default */
  state: string;
  /** Inclusive local hour start (0–23) */
  windowStart: number;
  /** Exclusive local hour end (0–24) */
  windowEnd: number;
  /** Allowed JS getDay() values; omit = all days ok at state level */
  allowedDays?: number[];
  note?: string;
};

/** Federal floor applied when state unknown / missing from table. */
export const FEDERAL_QUIET_HOURS: QuietHoursRule = {
  state: "*",
  windowStart: 8,
  windowEnd: 21,
  note: "TCPA 8am–9pm local floor",
};

/**
 * Stricter-than-federal state rules commonly cited for outbound calling.
 * States not listed inherit the federal floor only.
 */
export const STATE_QUIET_HOURS: QuietHoursRule[] = [
  { state: "AL", windowStart: 8, windowEnd: 20, note: "AL ends 8pm" },
  { state: "FL", windowStart: 8, windowEnd: 20, note: "FL ends 8pm" },
  { state: "KY", windowStart: 10, windowEnd: 21, note: "KY starts 10am" },
  { state: "LA", windowStart: 8, windowEnd: 20, note: "LA ends 8pm" },
  { state: "MA", windowStart: 8, windowEnd: 20, note: "MA ends 8pm" },
  { state: "MS", windowStart: 8, windowEnd: 20, note: "MS ends 8pm" },
  { state: "NV", windowStart: 9, windowEnd: 20, note: "NV 9am–8pm" },
  { state: "NJ", windowStart: 8, windowEnd: 21, allowedDays: [1, 2, 3, 4, 5, 6], note: "NJ no Sunday" },
  { state: "NM", windowStart: 9, windowEnd: 21, note: "NM starts 9am" },
  { state: "NY", windowStart: 8, windowEnd: 21, note: "NY follows federal" },
  { state: "NC", windowStart: 8, windowEnd: 21, note: "NC follows federal" },
  { state: "OK", windowStart: 8, windowEnd: 21, allowedDays: [1, 2, 3, 4, 5, 6], note: "OK no Sunday soliciting" },
  { state: "OR", windowStart: 9, windowEnd: 21, note: "OR starts 9am" },
  { state: "PA", windowStart: 8, windowEnd: 21, note: "PA follows federal" },
  { state: "RI", windowStart: 9, windowEnd: 18, note: "RI 9am–6pm" },
  { state: "SC", windowStart: 8, windowEnd: 21, note: "SC follows federal" },
  { state: "SD", windowStart: 9, windowEnd: 21, note: "SD starts 9am" },
  { state: "TX", windowStart: 9, windowEnd: 21, note: "TX starts 9am" },
  { state: "UT", windowStart: 8, windowEnd: 21, note: "UT follows federal" },
  { state: "WY", windowStart: 8, windowEnd: 20, note: "WY ends 8pm" },
];

const BY_STATE = new Map(
  STATE_QUIET_HOURS.map((r) => [r.state.toUpperCase(), r]),
);

export function quietHoursForState(state?: string | null): QuietHoursRule {
  if (!state) return FEDERAL_QUIET_HOURS;
  const key = state.trim().toUpperCase();
  return BY_STATE.get(key) ?? FEDERAL_QUIET_HOURS;
}

export type ClampedWindow = {
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
  appliedState: string;
  stateRule: QuietHoursRule;
  federal: QuietHoursRule;
};

/**
 * Intersect operator campaign window with federal + state legal floors.
 * Effective start = max(all starts); end = min(all ends); days = intersection.
 */
export function clampSendWindow(input: {
  state?: string | null;
  sendWindowStart: number;
  sendWindowEnd: number;
  sendDays: number[];
}): ClampedWindow {
  const federal = FEDERAL_QUIET_HOURS;
  const stateRule = quietHoursForState(input.state);
  const sendWindowStart = Math.max(
    input.sendWindowStart,
    federal.windowStart,
    stateRule.windowStart,
  );
  const sendWindowEnd = Math.min(
    input.sendWindowEnd,
    federal.windowEnd,
    stateRule.windowEnd,
  );
  const stateDays = stateRule.allowedDays;
  const sendDays = stateDays
    ? input.sendDays.filter((d) => stateDays.includes(d))
    : [...input.sendDays];

  return {
    sendWindowStart,
    sendWindowEnd: Math.max(sendWindowStart + 1, sendWindowEnd),
    sendDays: sendDays.length ? sendDays : input.sendDays,
    appliedState: stateRule.state,
    stateRule,
    federal,
  };
}

/** Primary IANA zone for a US state (multi-zone states use the plurality zone). */
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
  DC: "America/New_York",
};

export function timezoneFromUsState(state?: string | null): string | null {
  if (!state) return null;
  return STATE_TZ[state.trim().toUpperCase()] ?? null;
}

export function listQuietHoursRules(): QuietHoursRule[] {
  return [FEDERAL_QUIET_HOURS, ...STATE_QUIET_HOURS];
}
