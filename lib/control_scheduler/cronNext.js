'use strict'

// Pure, no I/O — computes the next run timestamp for a Control's frequency.
// No cron-parsing library: the only shapes seen anywhere (the frontend's own
// hand-rolled _calculateCronRunCount, "0 0 1 * *") don't need a general
// parser. Add a real dependency only if a shape shows up that this can't
// handle (see matchesCronField for exactly what's supported).

const DAY_MS = 24 * 60 * 60 * 1000

function startOfUtcDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function nextUtcMidnightAfter(from) {
  return new Date(startOfUtcDay(from).getTime() + DAY_MS)
}

function nextUtcMondayMidnightAfter(from) {
  const start = startOfUtcDay(from)
  const day = start.getUTCDay() // 0=Sun..6=Sat
  const daysUntilNextMonday = ((8 - day) % 7) || 7
  return new Date(start.getTime() + daysUntilNextMonday * DAY_MS)
}

function lastDayOfMonthUtc(year, month) {
  // day 0 of the *next* month is the last day of `month` (0-11)
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function nextLastDayOfMonthMidnightAfter(from) {
  let year = from.getUTCFullYear()
  let month = from.getUTCMonth()
  let candidate = new Date(Date.UTC(year, month, lastDayOfMonthUtc(year, month)))
  if (candidate.getTime() <= from.getTime()) {
    month += 1
    if (month > 11) { month = 0; year += 1 }
    candidate = new Date(Date.UTC(year, month, lastDayOfMonthUtc(year, month)))
  }
  return candidate
}

function nextQuarterStartAfter(from) {
  const year = from.getUTCFullYear()
  for (const m of [0, 3, 6, 9]) {
    const candidate = new Date(Date.UTC(year, m, 1))
    if (candidate.getTime() > from.getTime()) return candidate
  }
  return new Date(Date.UTC(year + 1, 0, 1))
}

function nextJan1After(from) {
  return new Date(Date.UTC(from.getUTCFullYear() + 1, 0, 1))
}

const DOW_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// Supports: '*', '*/N' (minute field only), exact numbers, comma-separated
// exact numbers, and MON..SUN names on the day-of-week field. No ranges
// ('1-5'), no combined step+range. Malformed/unsupported fields just never
// match, which computeNextCron's horizon cap turns into a safe fallback.
function matchesCronField(field, value, isDow) {
  if (field === '*') return true
  if (isDow) {
    return field.split(',').some((p) => {
      const upper = p.trim().toUpperCase()
      if (/^\d+$/.test(upper)) return Number(upper) === value
      return DOW_NAMES[value] === upper
    })
  }
  if (field.startsWith('*/')) {
    const step = Number(field.slice(2))
    return step > 0 && value % step === 0
  }
  return field.split(',').some((p) => Number(p.trim()) === value)
}

// Minute-by-minute forward scan, capped at a 2-year horizon. Only runs once
// per control when it's actually due, not on every scheduler tick, so O(minutes)
// is fine for the field shapes matchesCronField supports.
function computeNextCron(cronExpression, from) {
  const parts = (cronExpression || '').trim().split(/\s+/)
  if (parts.length !== 5) return new Date(from.getTime() + DAY_MS) // malformed - fall back to daily
  const [minuteField, hourField, domField, monthField, dowField] = parts

  const horizon = new Date(from.getTime() + 2 * 365 * DAY_MS)
  let candidate = new Date(Math.ceil((from.getTime() + 1) / 60000) * 60000) // next whole minute after `from`

  while (candidate.getTime() <= horizon.getTime()) {
    const matches =
      matchesCronField(minuteField, candidate.getUTCMinutes(), false) &&
      matchesCronField(hourField, candidate.getUTCHours(), false) &&
      matchesCronField(domField, candidate.getUTCDate(), false) &&
      matchesCronField(monthField, candidate.getUTCMonth() + 1, false) &&
      matchesCronField(dowField, candidate.getUTCDay(), true)
    if (matches) return candidate
    candidate = new Date(candidate.getTime() + 60000)
  }
  return horizon // shouldn't normally happen - safe fallback over spinning forever
}

function computeNextRunAt(frequency, cronExpression, from = new Date()) {
  switch (frequency) {
    case 'REALTIME': return new Date(from.getTime() + 60000) // no message bus - "due again next tick" is the approximation
    case 'DAILY': return nextUtcMidnightAfter(from)
    case 'WEEKLY': return nextUtcMondayMidnightAfter(from)
    case 'MONTHLY': return nextLastDayOfMonthMidnightAfter(from)
    case 'QUARTERLY': return nextQuarterStartAfter(from)
    case 'ANNUAL': return nextJan1After(from)
    case 'CRON': return computeNextCron(cronExpression, from)
    default: return nextUtcMidnightAfter(from)
  }
}

module.exports = { computeNextRunAt, computeNextCron }
