const express = require('express');
const { getMyProfile, updateMyProfile } = require('../controllers/usersController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/', getMyProfile);
router.patch('/', updateMyProfile);
module.exports = router;
