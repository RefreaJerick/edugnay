const crypto = require('crypto');

function getEncryptionKey() {
  const secret = String(process.env.QR_ENCRYPTION_KEY || process.env.SESSION_SECRET || '');
  if (!secret) {
    const error = new Error('QR credential encryption is not configured.');
    error.status = 503;
    throw error;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function createQrToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashQrToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function encryptQrToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

function decryptQrToken(value) {
  const [ivValue, tagValue, encryptedValue] = String(value || '').split('.');
  if (!ivValue || !tagValue || !encryptedValue) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function createQrPayload(token) {
  return `academix:attendance:${token}`;
}

async function issueStudentQrCredential(database, schoolId, studentId) {
  const token = createQrToken();
  await database.execute(
    `INSERT INTO student_qr_credentials (
      school_id, student_user_id, token_hash, token_ciphertext, credential_status, issued_at, revoked_at
    ) VALUES (?, ?, ?, ?, 'active', NOW(), NULL)`,
    [schoolId, studentId, hashQrToken(token), encryptQrToken(token)]
  );
  return { token, payload: createQrPayload(token) };
}

module.exports = {
  createQrPayload,
  createQrToken,
  decryptQrToken,
  encryptQrToken,
  hashQrToken,
  issueStudentQrCredential
};
