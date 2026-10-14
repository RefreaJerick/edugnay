const express = require('express');
const controller = require('../controllers/assignmentsController');
const { assignmentSubmissionUpload } = require('../config/uploads');
const { requireAuth } = require('../middleware/auth');
const { requireRoles, requireSchoolUser, requireTeacher } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth, requireSchoolUser);
router.get('/', controller.listAssignments);
router.get('/activity', requireRoles('parent'), controller.getParentAssignmentActivity);
router.get('/children/:studentId', requireRoles('parent'), controller.getParentChildAssignments);
router.get('/history', requireRoles('student'), controller.getStudentAssignmentHistory);
router.get('/history/:assignmentId/file', requireRoles('student'), controller.downloadOwnHistoricalSubmission);
router.post('/', requireTeacher, controller.createAssignment);
router.patch('/:assignmentId', requireRoles('school_admin', 'teacher'), controller.updateAssignment);
router.delete('/:assignmentId', requireRoles('school_admin', 'teacher'), controller.deleteAssignment);
router.patch('/:assignmentId/students/:studentId/status', requireTeacher, controller.updateStudentAssignmentStatus);
router.post('/:assignmentId/submissions', requireRoles('student'), assignmentSubmissionUpload.single('file'), controller.submitAssignment);
router.get('/:assignmentId/submissions', controller.listSubmissions);
router.get('/:assignmentId/submissions/:submissionId/preview', requireRoles('school_admin', 'teacher'), controller.previewSubmission);
router.get('/:assignmentId/submissions/:submissionId/download', requireRoles('school_admin', 'teacher'), controller.downloadSubmission);

module.exports = router;
