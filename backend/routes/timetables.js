const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin, requireSchoolUser, requireRole } = require('../middleware/authorize');
const controller = require('../controllers/timetablesController');

const router = express.Router();
router.use(requireAuth, requireSchoolUser);
router.get('/years', requireRole('school_admin', 'teacher', 'student'), controller.listYears);
router.get('/', requireRole('school_admin', 'teacher', 'student'), controller.list);
router.post('/assignments/:assignmentId/meetings', requireSchoolAdmin, controller.save);
router.patch('/assignments/:assignmentId/meetings/:meetingId', requireSchoolAdmin, controller.save);
router.post('/elective-classes/:classId/meetings', requireSchoolAdmin, controller.saveElective);
router.patch('/elective-classes/:classId/meetings/:meetingId', requireSchoolAdmin, controller.saveElective);
router.delete('/meetings/:meetingId', requireSchoolAdmin, controller.remove);

module.exports = router;
