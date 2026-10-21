const DEFAULT_WEEK = Object.freeze({ weekStartDay: 1, weekEndDay: 6 });

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

module.exports = { DEFAULT_WEEK, normalizeWeekSettings };
