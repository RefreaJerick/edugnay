const crypto = require('node:crypto');
const { createQrToken, decryptQrToken, encryptQrToken, hashQrToken } = require('./qrCredentials');

function createCodes() {
  const qrToken = createQrToken();
  const manualCode = crypto.randomBytes(10).toString('hex').toUpperCase().match(/.{1,4}/g).join('-');
  return { qrToken, manualCode, qrHash: hashQrToken(qrToken),
    manualHash: hashQrToken(manualCode.replaceAll('-', '')),
    qrCiphertext: encryptQrToken(qrToken), manualCiphertext: encryptQrToken(manualCode) };
}

function visibleCodes(row) {
  const qrToken = decryptQrToken(row.qrCiphertext);
  const manualCode = decryptQrToken(row.manualCiphertext);
  return qrToken && manualCode ? { qrPayload: `academix:fetcher:${qrToken}`, manualCode } : null;
}

function codeLookup(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('academix:fetcher:')) {
    const token = raw.slice('academix:fetcher:'.length);
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) return { column: 'qr_token_hash', hash: hashQrToken(token) };
  } else {
    const code = raw.replace(/[\s-]/g, '').toUpperCase();
    if (/^[A-F0-9]{20}$/.test(code)) return { column: 'manual_code_hash', hash: hashQrToken(code) };
  }
  const error = new Error('Invalid fetcher code.');
  error.status = 422;
  throw error;
}

function schoolDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.SCHOOL_TIME_ZONE || 'Asia/Manila',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

module.exports = { codeLookup, createCodes, schoolDate, visibleCodes };
