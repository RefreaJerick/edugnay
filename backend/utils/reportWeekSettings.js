const DEFAULT_WEEK = Object.freeze({ weekStartDay: 1, weekEndDay: 6 });
const WEEKDAY_LABELS = Object.freeze({ 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' });

function createError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeWeekday(value, label) {
  const day = typeof value === 'number' ? value : typeof value === 'string' && /^[1-7]$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(day) || day < 1 || day > 7) throw createError(`${label} must be a weekday from 1 to 7.`);
  return day;
}

function normalizeWeekSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).some(key => !['weekStartDay', 'weekEndDay'].includes(key)) ||
    !Object.hasOwn(body, 'weekStartDay') || !Object.hasOwn(body, 'weekEndDay')) {
    throw createError('Provide the report week start and end weekdays.');
  }
  const settings = {
    weekStartDay: normalizeWeekday(body.weekStartDay, 'Report week start day'),
    weekEndDay: normalizeWeekday(body.weekEndDay, 'Report week end day')
  };
  if (settings.weekStartDay === settings.weekEndDay) throw createError('Report week start and end days must be different.');
  return settings;
}

function normalizeDate(value, label = 'Report week start date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw createError(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw createError(`${label} is invalid.`);
  return value;
}

function isoWeekday(value) {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function schoolToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function reportWeekRange(startDate, settings) {
  const normalizedStart = normalizeDate(startDate);
  if (isoWeekday(normalizedStart) !== Number(settings.weekStartDay)) {
    throw createError(`Report weeks must start on ${WEEKDAY_LABELS[settings.weekStartDay]}.`);
  }
  const days = (Number(settings.weekEndDay) - Number(settings.weekStartDay) + 7) % 7;
  if (!days) throw createError('Report week start and end days must be different.');
  return { startDate: normalizedStart, endDate: addDays(normalizedStart, days) };
}

function currentReportWeekRange(settings, today = schoolToday()) {
  const normalizedToday = normalizeDate(today, 'Current date');
  const startDay = Number(settings?.weekStartDay);
  const endDay = Number(settings?.weekEndDay);
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 7
    || !Number.isInteger(endDay) || endDay < 1 || endDay > 7 || startDay === endDay) {
    throw createError('Report week start and end days must be different valid weekdays.');
  }
  const offset = (isoWeekday(normalizedToday) - startDay + 7) % 7;
  return reportWeekRange(addDays(normalizedToday, -offset), settings);
}

async function readWeekSettings(database, schoolId) {
  const [rows] = await database.execute(
    `SELECT narrative_report_week_start_day AS weekStartDay,
      narrative_report_week_end_day AS weekEndDay
    FROM school_settings WHERE school_id = ? LIMIT 1`,
    [schoolId]
  );
  const row = rows[0];
  return row ? {
    weekStartDay: Number(row.weekStartDay) || DEFAULT_WEEK.weekStartDay,
    weekEndDay: Number(row.weekEndDay) || DEFAULT_WEEK.weekEndDay
  } : { ...DEFAULT_WEEK };
}

module.exports = {
  DEFAULT_WEEK, addDays, currentReportWeekRange, isoWeekday, normalizeDate,
  normalizeWeekSettings, readWeekSettings, reportWeekRange, schoolToday
};
