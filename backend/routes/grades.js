const express = require('express');
const controller = require('../controllers/gradesController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles, requireTeacher } = require('../middleware/authorize');

const router = express.Router();

router.get('/grading-items', requireAuth, requireRoles('school_admin', 'teacher'), controller.listGradingItems);
router.post('/grading-items', requireAuth, requireTeacher, controller.createGradingItem);
router.patch('/grading-items/:gradingItemId', requireAuth, requireRoles('school_admin', 'teacher'), controller.updateGradingItem);
router.get('/student-scores', requireAuth, requireRoles('school_admin', 'teacher'), controller.listStudentScores);
router.post('/student-scores', requireAuth, requireRoles('school_admin', 'teacher'), controller.saveStudentScore);
router.patch('/student-scores/:scoreId', requireAuth, requireRoles('school_admin', 'teacher'), controller.updateStudentScore);
router.get('/final-grades/overview', requireAuth, requireRoles('student', 'parent'), controller.getFinalGradesOverview);
router.get('/final-grades', requireAuth, requireRoles('student', 'parent', 'teacher', 'school_admin'), controller.listPublishedFinalGrades);
router.get('/final-grades/preview', requireAuth, requireTeacher, controller.previewFinalGrades);
router.post('/final-grades/publish', requireAuth, requireTeacher, controller.publishFinalGrades);

module.exports = router;
