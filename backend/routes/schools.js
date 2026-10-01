const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/schoolsController');
const activityController = require('../controllers/activityController');
const parentNotificationTriggersController = require('../controllers/parentNotificationTriggersController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin, requireSchoolAdmin } = require('../middleware/authorize');
const { schoolLogoUpload } = require('../config/schoolLogos');

const router = express.Router();
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

router.post('/schools/register', registrationLimiter, schoolLogoUpload.single('logo'), controller.registerSchool);
router.get('/schools/:schoolId/logo', requireAuth, controller.getSchoolLogo);
router.get('/platform/schools', requireAuth, requirePlatformAdmin, controller.listPlatformSchools);
router.get('/platform/schools/:schoolId', requireAuth, requirePlatformAdmin, controller.getPlatformSchool);
router.get('/platform/activity', requireAuth, requirePlatformAdmin, activityController.listPlatformActivity);
router.post('/platform/schools/:schoolId/approve', requireAuth, requirePlatformAdmin, (req, res, next) => {
  req.params.action = 'approve';
  controller.reviewSchool(req, res, next);
});
router.post('/platform/schools/:schoolId/reject', requireAuth, requirePlatformAdmin, (req, res, next) => {
  req.params.action = 'reject';
  controller.reviewSchool(req, res, next);
});
router.post('/platform/schools/:schoolId/suspend', requireAuth, requirePlatformAdmin, (req, res, next) => {
  req.params.action = 'suspend';
  controller.changeSchoolAccess(req, res, next);
});
router.post('/platform/schools/:schoolId/reactivate', requireAuth, requirePlatformAdmin, (req, res, next) => {
  req.params.action = 'reactivate';
  controller.changeSchoolAccess(req, res, next);
});
router.get('/school/settings', requireAuth, requireSchoolAdmin, controller.getSchoolSettings);
router.get('/school/logo', requireAuth, requireSchoolAdmin, controller.getSchoolLogo);
router.post('/school/logo', requireAuth, requireSchoolAdmin, schoolLogoUpload.single('logo'), controller.updateSchoolLogo);
router.get('/school/parent-notification-triggers', requireAuth, requireSchoolAdmin, parentNotificationTriggersController.getSettings);
router.patch('/school/parent-notification-triggers', requireAuth, requireSchoolAdmin, parentNotificationTriggersController.updateSettings);
router.get('/school/activity', requireAuth, requireSchoolAdmin, activityController.listSchoolActivity);
router.patch('/school/settings', requireAuth, requireSchoolAdmin, controller.updateSchoolSettings);
router.get('/school/portal-features', requireAuth, controller.getPortalFeatures);
router.patch('/school/portal-features', requireAuth, requireSchoolAdmin, controller.updatePortalFeatures);
router.get('/school/academic-structure', requireAuth, requireSchoolAdmin, controller.getAcademicStructure);
router.patch('/school/academic-structure', requireAuth, requireSchoolAdmin, controller.updateAcademicStructure);

module.exports = router;
