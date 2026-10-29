const express = require('express');
const controller = require('../controllers/academicTermsController');
const subjectGradingController = require('../controllers/subjectGradingController');
const shsGradingSettingsController = require('../controllers/shsGradingSettingsController');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin, requireSchoolUser } = require('../middleware/authorize');

const router = express.Router();

const schoolAdminOnly = [requireAuth, requireSchoolAdmin];

router.get('/academic-years', ...schoolAdminOnly, controller.listAcademicYears);
router.post('/academic-years', ...schoolAdminOnly, controller.createAcademicYear);
router.patch('/academic-years/:yearId', ...schoolAdminOnly, controller.updateAcademicYear);
router.get('/academic-terms', requireAuth, requireSchoolUser, controller.listAcademicTerms);
router.post('/academic-terms', ...schoolAdminOnly, controller.createAcademicTerm);
router.get('/academic-terms/:termId', ...schoolAdminOnly, controller.getAcademicTerm);
router.patch('/academic-terms/:termId', ...schoolAdminOnly, controller.updateAcademicTerm);
router.post('/academic-terms/:termId/activate', ...schoolAdminOnly, (req, res, next) => { req.params.action = 'activate'; controller.termAction(req, res, next); });
router.post('/academic-terms/:termId/complete', ...schoolAdminOnly, (req, res, next) => { req.params.action = 'complete'; controller.termAction(req, res, next); });
router.post('/academic-terms/:termId/extend', ...schoolAdminOnly, (req, res, next) => { req.params.action = 'extend'; controller.termAction(req, res, next); });
router.get('/grading-categories', requireAuth, requireSchoolUser, controller.listGradingCategories);
router.patch('/grading-categories', ...schoolAdminOnly, controller.updateGradingCategories);
router.get('/deped-k10/grading-preview', ...schoolAdminOnly, subjectGradingController.previewDepedDefaults);
router.post('/deped-k10/grading-defaults', ...schoolAdminOnly, subjectGradingController.applyDepedDefaults);
router.post('/deped-k10/subject-defaults', ...schoolAdminOnly, subjectGradingController.restoreDepedSubjectDefaults);
router.post('/deped-k10/subject-group-defaults', ...schoolAdminOnly, subjectGradingController.restoreDepedCatalogSubjectGroupDefaults);
router.put('/deped-k10/final-grade-rules', ...schoolAdminOnly, subjectGradingController.saveK10FinalGradeRules);
router.get('/subject-grading-config', requireAuth, requireSchoolUser, (req, res, next) => (
  req.user.role === 'teacher'
    ? subjectGradingController.getTeacherSubjectGradingConfig(req, res, next)
    : subjectGradingController.getAdminSubjectGradingConfig(req, res, next)
));
router.put('/subject-grading-config', ...schoolAdminOnly, subjectGradingController.saveSubjectGradingConfig);
router.put('/deped-k10/subject-group-config', ...schoolAdminOnly, subjectGradingController.saveK10CatalogSubjectGroupConfig);
router.get('/shs-grading', ...schoolAdminOnly, shsGradingSettingsController.list);
router.put('/shs-grading', ...schoolAdminOnly, shsGradingSettingsController.save);
router.post('/shs-grading/restore', ...schoolAdminOnly, shsGradingSettingsController.restore);

module.exports = router;
