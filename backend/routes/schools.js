const express = require('express');
const controller = require('../controllers/schoolsController');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin, requireSchoolAdmin } = require('../middleware/authorize');

const router = express.Router();

router.post('/schools/register', controller.registerSchool);
router.get('/platform/schools', requireAuth, requirePlatformAdmin, controller.listPlatformSchools);
router.get('/platform/schools/:schoolId', requireAuth, requirePlatformAdmin, controller.getPlatformSchool);
router.post('/platform/schools/:schoolId/approve', requireAuth, requirePlatformAdmin, (req, res, next) => {
  req.params.action = 'approve';
  controller.reviewSchool(req, res, next);
});
router.post('/platform/schools/:schoolId/reject', requireAuth, requirePlatformAdmin, (req, res, next) => {
  req.params.action = 'reject';
  controller.reviewSchool(req, res, next);
});
router.get('/school/settings', requireAuth, requireSchoolAdmin, controller.getSchoolSettings);
router.patch('/school/settings', requireAuth, requireSchoolAdmin, controller.updateSchoolSettings);
router.get('/school/portal-features', requireAuth, requireSchoolAdmin, controller.getPortalFeatures);
router.patch('/school/portal-features', requireAuth, requireSchoolAdmin, controller.updatePortalFeatures);
router.get('/school/academic-structure', requireAuth, requireSchoolAdmin, controller.getAcademicStructure);
router.patch('/school/academic-structure', requireAuth, requireSchoolAdmin, controller.updateAcademicStructure);

module.exports = router;
