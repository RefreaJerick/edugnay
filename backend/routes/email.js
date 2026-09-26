const express = require('express');
const { sendTestEmail } = require('../controllers/emailController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.post('/test', requireAuth, requireRoles('platform_admin', 'school_admin'), sendTestEmail);

module.exports = router;
