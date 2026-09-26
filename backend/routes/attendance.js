const express = require('express');
const { getSectionAttendance, saveSectionAttendance } = require('../controllers/attendanceController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth, requireRoles('teacher'));
router.get('/sections/:sectionId', getSectionAttendance);
router.put('/sections/:sectionId', saveSectionAttendance);

module.exports = router;
