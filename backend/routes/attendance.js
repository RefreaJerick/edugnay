const express = require('express');
const { getParentAttendance, getSchoolAttendanceSummary, getSectionAttendance, getSectionAttendanceHistory, saveSectionAttendance } = require('../controllers/attendanceController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/children', requireRoles('parent'), getParentAttendance);
router.get('/school-summary', requireRoles('school_admin'), getSchoolAttendanceSummary);
router.use(requireRoles('teacher'));
router.get('/sections/:sectionId/subjects/:subjectId/history', getSectionAttendanceHistory);
router.get('/sections/:sectionId/subjects/:subjectId', getSectionAttendance);
router.put('/sections/:sectionId/subjects/:subjectId', saveSectionAttendance);

module.exports = router;
