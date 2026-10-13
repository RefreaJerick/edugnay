const nodemailer = require('nodemailer');

const REQUIRED_MAIL_VARIABLES = ['MAIL_HOST', 'MAIL_PORT', 'MAIL_USER', 'MAIL_PASSWORD', 'MAIL_FROM'];
let transporter;

function isEmailConfigured() {
  return REQUIRED_MAIL_VARIABLES.every(name => String(process.env[name] || '').trim());
}

function getTransporter() {
  if (!isEmailConfigured()) return null;
  if (transporter) return transporter;

  const port = Number(process.env.MAIL_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Email configuration has an invalid SMTP port.');
  }

  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure: String(process.env.MAIL_SECURE).toLowerCase() === 'true',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASSWORD
    },
    requireTLS: String(process.env.MAIL_SECURE).toLowerCase() !== 'true',
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    dnsTimeout: 10000
  });

  return transporter;
}

function normalizeRecipient(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function sanitizeSmtpValue(value, maxLength = 255) {
  const sanitized = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return sanitized || null;
}

function smtpResponseCode(value) {
  return String(value || '').match(/^\s*(\d{3})\b/)?.[1] || null;
}

async function sendEmail({ to, subject, text }) {
  const recipient = normalizeRecipient(to);
  if (!recipient) return { status: 'skipped' };
  if (!isEmailConfigured()) return { status: 'not_configured' };

  try {
    const result = await getTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to: recipient,
      subject,
      text
    });
    return {
      status: 'sent',
      messageId: sanitizeSmtpValue(result?.messageId),
      smtpResponse: sanitizeSmtpValue(result?.response),
      smtpResponseCode: smtpResponseCode(result?.response)
    };
  } catch (error) {
    const errorCode = String(error.code || 'smtp_failed').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 80);
    console.error('Email delivery failed', JSON.stringify({ errorCode: errorCode || 'smtp_failed' }));
    return { status: 'failed', errorCode: errorCode || 'smtp_failed' };
  }
}

function getRecipient(user) {
  return normalizeRecipient(user?.personalEmail);
}

function sendAccountCreatedEmail(user, temporaryPassword) {
  const recipient = getRecipient(user);
  return sendEmail({
    to: recipient,
    subject: 'Your Academix account is ready',
    text: [
      `Hello ${user.displayName},`,
      '',
      'Your Academix account has been created.',
      `School email: ${user.schoolEmail}`,
      `Temporary password: ${temporaryPassword}`,
      '',
      'Sign in and change this temporary password as soon as possible.'
    ].join('\n')
  });
}

function sendAccountStatusEmail(user) {
  const isActive = user.accountStatus === 'active';
  return sendEmail({
    to: getRecipient(user),
    subject: isActive ? 'Your Academix account has been activated' : 'Your Academix account has been deactivated',
    text: [
      `Hello ${user.displayName},`,
      '',
      isActive
        ? 'Your Academix account is active. You can now sign in using your school email.'
        : 'Your Academix account has been deactivated. Contact your school administrator if you need assistance.'
    ].join('\n')
  });
}

function sendAnnouncementEmail(user, announcement) {
  const title = String(announcement.title || '').replace(/[\r\n]+/g, ' ').trim();
  return sendEmail({
    to: getRecipient(user),
    subject: `New Academix announcement: ${title}`,
    text: [
      `Hello ${user.displayName || 'Academix user'},`,
      '',
      `${announcement.authorName || 'Your school'} published a new announcement:`,
      title,
      '',
      announcement.body,
      '',
      'Sign in to Academix to view the announcement.'
    ].join('\n')
  });
}

function sendPasswordResetEmail(user, token) {
  const resetUrl = `${String(process.env.FRONTEND_ORIGIN || '').replace(/\/$/, '')}/index.html?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to: user?.personalEmail,
    subject: 'Reset your Academix password',
    text: [
      `Hello ${user.displayName},`,
      '',
      'Use this link to choose a new Academix password:',
      resetUrl,
      '',
      'This link expires in one hour. If you did not request it, you can ignore this email.'
    ].join('\n')
  });
}

function sendSchoolRegistrationSubmittedEmail(user, school) {
  return sendEmail({
    to: getRecipient(user),
    subject: 'New Academix school registration',
    text: `A new school registration for ${school.name} is ready for platform review.`
  });
}

function sendSchoolRegistrationDecisionEmail(user, school, approved, reason = '') {
  return sendEmail({
    to: getRecipient(user),
    subject: approved ? 'Your Academix school registration was approved' : 'Your Academix school registration was not approved',
    text: [
      `Hello ${user.displayName},`,
      '',
      approved
        ? `${school.name} has been approved. Your administrator account is now active. Sign in with ${user.schoolEmail}.`
        : `${school.name} was not approved at this time.${reason ? ` Reason: ${reason}` : ''}`
    ].join('\n')
  });
}

function sendSchoolAccessStatusEmail(user, school, status) {
  if (status !== 'suspended' && status !== 'reactivated') {
    throw new Error('School access email status is invalid.');
  }

  const suspended = status === 'suspended';
  return sendEmail({
    to: getRecipient(user),
    subject: suspended
      ? 'Your Academix school access has been suspended'
      : 'Your Academix school access has been restored',
    text: [
      `Hello ${user.displayName || 'School administrator'},`,
      '',
      suspended
        ? `School access for ${school.name} has been suspended by the Platform Admin. You cannot sign in while access remains suspended. Please contact the Platform Admin if you need further information.`
        : `School access for ${school.name} has been reactivated. You may access Academix again.`
    ].join('\n')
  });
}

async function verifyEmailConnection() {
  if (!isEmailConfigured()) return { status: 'not_configured' };

  try {
    await getTransporter().verify();
    return { status: 'ready' };
  } catch (error) {
    console.error(`SMTP verification failed: ${error.message}`);
    return { status: 'failed' };
  }
}

module.exports = {
  isEmailConfigured,
  normalizeRecipient,
  sendAccountCreatedEmail,
  sendAccountStatusEmail,
  sendAnnouncementEmail,
  sendEmail,
  sendPasswordResetEmail,
  sendSchoolRegistrationDecisionEmail,
  sendSchoolAccessStatusEmail,
  sendSchoolRegistrationSubmittedEmail,
  sanitizeSmtpValue,
  smtpResponseCode,
  verifyEmailConnection
};
