const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');
const controller = require('../controllers/pickupController');

const router = express.Router();
const verifyLimiter = rateLimit({ windowMs: 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { message: 'Too many verification attempts. Please wait and try again.' } });

router.use(requireAuth);
router.get('/credentials/:reference', requireRoles('parent'), controller.getCredential);
router.post('/credentials/:reference/issue', requireRoles('parent'), controller.issueCredential);
router.post('/credentials/:reference/reissue', requireRoles('parent'), controller.issueCredential);
router.get('/history', requireRoles('parent', 'school_admin', 'school_guard'), controller.pickupHistory);
router.get('/today', requireRoles('school_guard'), controller.todayCounts);
router.post('/verify', requireRoles('school_guard'), verifyLimiter, controller.verifyCode);
router.post('/photo', requireRoles('school_guard'), verifyLimiter, controller.getVerifiedPhoto);
router.post('/confirm', requireRoles('school_guard'), verifyLimiter, controller.confirmPickup);

module.exports = router;
