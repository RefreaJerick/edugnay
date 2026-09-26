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
    requireTLS: String(process.env.MAIL_SECURE).toLowerCase() !== 'true'
  });

  return transporter;
}

function normalizeRecipient(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function sendEmail({ to, subject, text }) {
  const recipient = normalizeRecipient(to);
  if (!recipient) return { status: 'skipped' };
  if (!isEmailConfigured()) return { status: 'not_configured' };

  try {
    await getTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to: recipient,
      subject,
      text
    });
    return { status: 'sent' };
  } catch (error) {
    console.error(`Email delivery failed: ${error.message}`);
    return { status: 'failed' };
  }
}

function getRecipient(user) {
  return normalizeRecipient(user?.personalEmail) || normalizeRecipient(user?.schoolEmail);
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

function sendPasswordResetEmail(user, token) {
  const resetUrl = `${String(process.env.FRONTEND_ORIGIN || '').replace(/\/$/, '')}/index.html?token=${encodeURIComponent(token)}`;
  return sendEmail({
    to: getRecipient(user),
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
        ? `${school.name} has been approved. Your administrator account is now active.`
        : `${school.name} was not approved at this time.${reason ? ` Reason: ${reason}` : ''}`
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
  sendAccountCreatedEmail,
  sendAccountStatusEmail,
  sendEmail,
  sendPasswordResetEmail,
  sendSchoolRegistrationDecisionEmail,
  sendSchoolRegistrationSubmittedEmail,
  verifyEmailConnection
};
