const API_URL = 'https://api.semaphore.co/api/v4/messages';
const STATUS_URL = 'https://api.semaphore.co/api/v4/messages';
const SENDER_NAME = 'AcadeMix';

function isSemaphoreConfigured() {
  return Boolean(String(process.env.SEMAPHORE_API_KEY || '').trim());
}

function normalizePhilippineMobile(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw || !/^\+?[\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0063')) digits = digits.slice(2);
  if (digits.startsWith('63') && /^639\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  return null;
}

function providerRecord(payload) {
  if (Array.isArray(payload)) return payload[0] || null;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) return payload.data[0] || null;
    return payload;
  }
  return null;
}

function messageIdOf(record) {
  const value = record?.message_id ?? record?.messageId ?? record?.id;
  return value == null || String(value).trim() === '' ? null : String(value);
}

function statusOf(record) {
  return String(record?.status || record?.message_status || '').trim().toLowerCase();
}

async function readJson(response) {
  try { return await response.json(); } catch { return null; }
}

async function request(url, options, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    return { response, payload: await readJson(response) };
  } finally {
    clearTimeout(timer);
  }
}

async function sendSemaphoreSms({ number, message, fetchImpl = global.fetch }) {
  if (!isSemaphoreConfigured()) return { outcome: 'failed', errorCode: 'provider_not_configured' };
  if (!fetchImpl) return { outcome: 'failed', errorCode: 'provider_unavailable' };
  const normalizedNumber = normalizePhilippineMobile(number);
  if (!normalizedNumber || typeof message !== 'string' || !message.trim()) {
    return { outcome: 'failed', errorCode: 'invalid_message_or_number' };
  }

  const body = new URLSearchParams({
    apikey: process.env.SEMAPHORE_API_KEY.trim(),
    number: normalizedNumber,
    message,
    sendername: SENDER_NAME
  });
  let result;
  try {
    result = await request(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    }, fetchImpl);
  } catch (error) {
    return { outcome: 'uncertain', errorCode: error?.name === 'AbortError' ? 'request_timeout' : 'network_error' };
  }
  const { response, payload } = result;

  if (response.status === 429) {
    const retryAfter = Number(response.headers?.get?.('retry-after'));
    return {
      outcome: 'retryable', errorCode: 'rate_limited',
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: Math.min(3600, Math.ceil(retryAfter)) } : {})
    };
  }
  if (!response.ok) {
    return response.status >= 500
      ? { outcome: 'uncertain', errorCode: `http_${response.status}` }
      : { outcome: 'failed', errorCode: `http_${response.status}` };
  }
  const record = providerRecord(payload);
  const status = statusOf(record);
  const providerMessageId = messageIdOf(record);
  if (['queued', 'pending', 'accepted', 'processing'].includes(status)) {
    return providerMessageId
      ? { outcome: 'queued', providerMessageId }
      : { outcome: 'uncertain', errorCode: 'accepted_without_message_id' };
  }
  if (['sent', 'success', 'delivered'].includes(status)) {
    return { outcome: 'sent', providerMessageId };
  }
  if (['failed', 'refunded', 'rejected', 'invalid'].includes(status)) {
    return { outcome: 'failed', errorCode: 'provider_rejected' };
  }
  return { outcome: 'uncertain', errorCode: 'unrecognized_provider_response' };
}

async function getSemaphoreMessageStatus(providerMessageId, fetchImpl = global.fetch) {
  if (!isSemaphoreConfigured() || !fetchImpl) return { outcome: 'unknown' };
  const query = new URLSearchParams({ apikey: process.env.SEMAPHORE_API_KEY.trim() });
  let result;
  try {
    result = await request(`${STATUS_URL}/${encodeURIComponent(providerMessageId)}?${query}`, {}, fetchImpl);
  } catch {
    return { outcome: 'unknown' };
  }
  const { response, payload } = result;
  if (!response.ok) return { outcome: 'unknown' };
  const record = providerRecord(payload);
  const status = statusOf(record);
  if (['sent', 'success', 'delivered'].includes(status)) return { outcome: 'sent' };
  if (['failed', 'refunded', 'rejected', 'invalid'].includes(status)) return { outcome: 'failed', errorCode: 'provider_failed' };
  if (['queued', 'pending', 'accepted', 'processing'].includes(status)) return { outcome: 'queued' };
  return { outcome: 'unknown' };
}

module.exports = {
  getSemaphoreMessageStatus,
  isSemaphoreConfigured,
  normalizePhilippineMobile,
  sendSemaphoreSms
};
