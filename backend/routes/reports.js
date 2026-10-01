const express = require('express');
const { getSchoolGradeSummary } = require('../controllers/reportsController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/grade-summary', requireRoles('school_admin'), getSchoolGradeSummary);

module.exports = router;
