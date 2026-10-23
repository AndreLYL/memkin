import { z } from "zod";

export function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function isDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

export function isInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) &&
    isDate(value.slice(0, 10)) &&
    Number.isFinite(Date.parse(value))
  );
}

export const TimezoneSchema = z
  .string()
  .max(100)
  .refine(isTimezone, "Use an IANA timezone, e.g. Asia/Shanghai");
export const InstantSchema = z
  .string()
  .refine(isInstant, "Use an ISO datetime with seconds and an explicit offset");
export const TimeSchema = z
  .object({
    value: z.string().max(100).nullable(),
    precision: z.enum(["unknown", "year", "month", "day", "minute", "second"]),
    timezone: TimezoneSchema.optional(),
    original: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((t, ctx) => {
    const valid =
      t.precision === "unknown"
        ? t.value === null
        : t.value !== null &&
          (t.precision === "year"
            ? /^\d{4}$/.test(t.value) && Number(t.value) > 0
            : t.precision === "month"
              ? /^\d{4}-(0[1-9]|1[0-2])$/.test(t.value) && Number(t.value.slice(0, 4)) > 0
              : t.precision === "day"
                ? isDate(t.value)
                : isInstant(t.value));
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message: "Time value must match its precision; unknown time uses null",
      });
  });

export type MemoryTime = z.infer<typeof TimeSchema>;
export const UNKNOWN_TIME: MemoryTime = { value: null, precision: "unknown" };

/** Calendar dates keep their precision; these bounds are for overlap queries only. */
export function timeBounds(t: MemoryTime): [string | null, string | null] {
  if (t.value === null) return [null, null];
  if (t.precision === "minute" || t.precision === "second") {
    const start = Date.parse(t.value);
    return [
      new Date(start).toISOString(),
      new Date(start + (t.precision === "minute" ? 60_000 : 1_000)).toISOString(),
    ];
  }
  const date = `${t.value}${t.precision === "year" ? "-01-01" : t.precision === "month" ? "-01" : ""}`;
  const next = new Date(`${date}T00:00:00Z`);
  if (t.precision === "year") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else if (t.precision === "month") next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + 1);
  const zone = t.timezone ?? "UTC";
  return [calendarMidnight(date, zone), calendarMidnight(next.toISOString().slice(0, 10), zone)];
}

function calendarMidnight(date: string, timezone: string): string {
  const target = Date.parse(`${date}T00:00:00Z`);
  let utc = target;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(fmt.formatToParts(utc).map((p) => [p.type, p.value]));
    const local = Date.parse(
      `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`,
    );
    const correction = target - local;
    utc += correction;
    if (correction === 0) break;
  }
  return new Date(utc).toISOString();
}

export function filterInstant(value: string, upper = false): string {
  if (isDate(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (upper) date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }
  return InstantSchema.parse(value);
}
