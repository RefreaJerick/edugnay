const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  confirmQrAttendance,
  getCurrentQrAttendance,
  scanQrAttendance,
  startQrAttendance
} = require('../controllers/qrAttendanceController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();
const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many QR scans. Please wait a moment and try again.' }
});

router.use(requireAuth, requireRoles('teacher'));
router.get('/sections/:sectionId', getCurrentQrAttendance);
router.post('/sections/:sectionId/start', startQrAttendance);
router.post('/sessions/:sessionId/scan', scanLimiter, scanQrAttendance);
router.put('/sessions/:sessionId/confirm', confirmQrAttendance);

module.exports = router;
