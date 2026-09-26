const express = require('express');
const controller = require('../controllers/academicTermsController');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth, requireSchoolAdmin);
router.get('/academic-years', controller.listAcademicYears);
router.post('/academic-years', controller.createAcademicYear);
router.patch('/academic-years/:yearId', controller.updateAcademicYear);
router.get('/academic-terms', controller.listAcademicTerms);
router.post('/academic-terms', controller.createAcademicTerm);
router.get('/academic-terms/:termId', controller.getAcademicTerm);
router.patch('/academic-terms/:termId', controller.updateAcademicTerm);
router.post('/academic-terms/:termId/activate', (req, res, next) => { req.params.action = 'activate'; controller.termAction(req, res, next); });
router.post('/academic-terms/:termId/complete', (req, res, next) => { req.params.action = 'complete'; controller.termAction(req, res, next); });
router.post('/academic-terms/:termId/extend', (req, res, next) => { req.params.action = 'extend'; controller.termAction(req, res, next); });
router.get('/grading-categories', controller.listGradingCategories);
router.patch('/grading-categories', controller.updateGradingCategories);

module.exports = router;
