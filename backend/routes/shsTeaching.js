const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolUser, requireTeacher, requireParent } = require('../middleware/authorize');
const { requireShsTeachingEnabled } = require('../utils/shsTeachingAccess');
const controller = require('../controllers/shsTeachingController');
const attendance = require('../controllers/attendanceController');
const qr = require('../controllers/qrAttendanceController');
const assignments = require('../controllers/assignmentsController');
const materials = require('../controllers/materialsController');
const { materialUpload } = require('../config/uploads');

const router = express.Router();
router.use(requireAuth, requireSchoolUser, requireShsTeachingEnabled);
router.get('/classes', controller.classList);
router.get('/classes/:classId/roster', requireRoles('teacher', 'school_admin'), controller.roster);
router.get('/classes/:classId/students/:studentId/details', requireTeacher, controller.studentDetails);
router.get('/classes/:classId/students/:studentId', requireParent, controller.parentClassHistory);
router.get('/classes/:classId/attendance', requireTeacher, attendance.getElectiveAttendance);
router.put('/classes/:classId/attendance', requireTeacher, attendance.saveElectiveAttendance);
router.get('/classes/:classId/attendance/history', requireTeacher, attendance.getElectiveAttendanceHistory);
router.get('/classes/:classId/qr-attendance', requireTeacher, qr.getElectiveQrAttendance);
router.post('/classes/:classId/qr-attendance/start', requireTeacher, qr.startElectiveQrAttendance);
router.post('/qr-sessions/:sessionId/scan', requireTeacher, qr.scanElectiveQrAttendance);
router.put('/qr-sessions/:sessionId/confirm', requireTeacher, qr.confirmElectiveQrAttendance);
router.post('/classes/:classId/assignments', requireTeacher, assignments.createElectiveAssignment);
router.post('/classes/:classId/materials', requireTeacher, materials.authorizeElectiveUpload,
  materialUpload.single('file'), materials.createMaterial);
module.exports = router;

function requireRoles(...roles) {
  return (req, res, next) => roles.includes(req.user?.role)
    ? next() : res.status(403).json({ message: 'You do not have access to this resource.' });
}
