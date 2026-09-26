const { sendEmail, verifyEmailConnection } = require('../config/email');

async function sendTestEmail(req, res, next) {
  try {
    const connection = await verifyEmailConnection();
    if (connection.status !== 'ready') {
      const error = new Error('Email delivery is not configured or the SMTP server is unavailable.');
      error.status = 503;
      throw error;
    }

    const result = await sendEmail({
      to: req.user.personalEmail || req.user.schoolEmail,
      subject: 'Academix email delivery test',
      text: `Hello ${req.user.displayName},\n\nThis confirms that your Academix SMTP email configuration is working.`
    });
    if (result.status !== 'sent') {
      const error = new Error('The test email could not be delivered.');
      error.status = 502;
      throw error;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

module.exports = { sendTestEmail };
