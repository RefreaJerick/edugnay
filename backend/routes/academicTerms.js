const express = require('express');
const controller = require('../controllers/academicTermsController');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin } = require('../middleware/authorize');

const router = express.Router();

const schoolAdminOnly = [requireAuth, requireSchoolAdmin];

router.get('/academic-years', ...schoolAdminOnly, controller.listAcademicYears);
router.post('/academic-years', ...schoolAdminOnly, controller.createAcademicYear);
router.patch('/academic-years/:yearId', ...schoolAdminOnly, controller.updateAcademicYear);
router.get('/academic-terms', requireAuth, controller.listAcademicTerms);
router.post('/academic-terms', ...schoolAdminOnly, controller.createAcademicTerm);
router.get('/academic-terms/:termId', ...schoolAdminOnly, controller.getAcademicTerm);
router.patch('/academic-terms/:termId', ...schoolAdminOnly, controller.updateAcademicTerm);
router.post('/academic-terms/:termId/activate', ...schoolAdminOnly, (req, res, next) => { req.params.action = 'activate'; controller.termAction(req, res, next); });
router.post('/academic-terms/:termId/complete', ...schoolAdminOnly, (req, res, next) => { req.params.action = 'complete'; controller.termAction(req, res, next); });
router.post('/academic-terms/:termId/extend', ...schoolAdminOnly, (req, res, next) => { req.params.action = 'extend'; controller.termAction(req, res, next); });
router.get('/grading-categories', requireAuth, controller.listGradingCategories);
router.patch('/grading-categories', ...schoolAdminOnly, controller.updateGradingCategories);

module.exports = router;
