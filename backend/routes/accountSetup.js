const express = require('express');
const { completeAccountSetup, getAccountSetupStatus } = require('../controllers/usersController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/status', getAccountSetupStatus);
router.patch('/student', requireRoles('student'), completeAccountSetup);
router.patch('/parent', requireRoles('parent'), completeAccountSetup);

module.exports = router;
