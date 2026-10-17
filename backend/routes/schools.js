const express = require('express');
const rateLimit = require('express-rate-limit');
const controller = require('../controllers/schoolsController');
const depedK10SubjectsController = require('../controllers/depedK10SubjectsController');
const activityController = require('../controllers/activityController');
const parentNotificationTriggersController = require('../controllers/parentNotificationTriggersController');
const { getSchoolContext } = require('../controllers/schoolContextController');
const calendarNoticesController = require('../controllers/calendarNoticesController');
const attendanceSettingsController = require('../controllers/attendanceSettingsController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin, requireSchoolAdmin, requireSchoolUser } = require('../middleware/authorize');
const { schoolLogoUpload } = require('../config/schoolLogos');

const router = express.Router();
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });
const registrationStatusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

router.post('/schools/register', registrationLimiter, schoolLogoUpload.single('logo'), controller.registerSchool);
router.post('/schools/registration-status', registrationStatusLimiter, controller.getRegistrationStatus);
router.post('/schools/registration-details', registrationStatusLimiter, controller.getRegistrationDetails);
router.post('/schools/registration-resubmit', registrationStatusLimiter, schoolLogoUpload.single('logo'), controller.resubmitSchoolRegistration);
router.get('/schools/:schoolId/logo', requireAuth, controller.getSchoolLogo);
router.get('/platform/schools', requireAuth, requirePlatformAdmin, controller.listPlatformSchools);
router.get('/platform/schools/:schoolId', requireAuth, requirePlatformAdmin, controller.getPlatformSchool);
router.delete('/platform/schools/:schoolId', requireAuth, requirePlatformAdmin, controller.deletePlatformSchool);
router.post('/platform/schools/:schoolId/registration-email/retry', requireAuth, requirePlatformAdmin, controller.retrySchoolRegistrationEmail);
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
router.get('/school/context', requireAuth, requireSchoolUser, getSchoolContext);
router.get('/school/calendar-notices', requireAuth, requireSchoolUser, calendarNoticesController.listCalendarNotices);
router.post('/school/calendar-notices', requireAuth, requireSchoolAdmin, calendarNoticesController.createCalendarNotice);
router.delete('/school/calendar-notices/:noticeId', requireAuth, requireSchoolAdmin, calendarNoticesController.deleteCalendarNotice);
router.get('/school/attendance-settings', requireAuth, requireSchoolAdmin, attendanceSettingsController.getAttendanceSettings);
router.patch('/school/attendance-settings', requireAuth, requireSchoolAdmin, attendanceSettingsController.updateAttendanceSettings);
router.get('/school/logo', requireAuth, requireSchoolAdmin, controller.getSchoolLogo);
router.post('/school/logo', requireAuth, requireSchoolAdmin, schoolLogoUpload.single('logo'), controller.updateSchoolLogo);
router.get('/school/parent-notification-triggers', requireAuth, requireSchoolAdmin, parentNotificationTriggersController.getSettings);
router.patch('/school/parent-notification-triggers', requireAuth, requireSchoolAdmin, parentNotificationTriggersController.updateSettings);
router.get('/school/activity', requireAuth, requireSchoolAdmin, activityController.listSchoolActivity);
router.patch('/school/settings', requireAuth, requireSchoolAdmin, controller.updateSchoolSettings);
router.get('/school/portal-features', requireAuth, requireSchoolUser, controller.getPortalFeatures);
router.patch('/school/portal-features', requireAuth, requireSchoolAdmin, controller.updatePortalFeatures);
router.get('/school/academic-structure', requireAuth, requireSchoolAdmin, controller.getAcademicStructure);
router.patch('/school/academic-structure', requireAuth, requireSchoolAdmin, controller.updateAcademicStructure);
router.get('/school/academic-structure/deped-subjects', requireAuth, requireSchoolAdmin, depedK10SubjectsController.getDepedSubjectPreview);
router.post('/school/academic-structure/deped-subjects', requireAuth, requireSchoolAdmin, depedK10SubjectsController.applyDepedSubjectDefaults);

module.exports = router;
