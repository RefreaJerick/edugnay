const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  changePassword,
  confirmPasswordReset,
  getCurrentUser,
  login,
  logout,
  requestPasswordReset
} = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many sign-in attempts. Please try again later.' }
});
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password-change attempts. Please try again later.' }
});
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many password-reset attempts. Please try again later.' }
});

router.post('/login', loginLimiter, login);
router.post('/logout', requireAuth, logout);
router.post('/change-password', requireAuth, passwordChangeLimiter, changePassword);
router.post('/password-reset/request', passwordResetLimiter, requestPasswordReset);
router.post('/password-reset/confirm', passwordResetLimiter, confirmPasswordReset);
router.get('/me', requireAuth, getCurrentUser);

module.exports = router;
