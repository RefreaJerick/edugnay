const express = require('express');
const {
  createUser,
  getMyProfile,
  getUser,
  listUsers,
  setUserStatus,
  updateMyProfile,
  updateUser
} = require('../controllers/usersController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/me/profile', getMyProfile);
router.patch('/me/profile', updateMyProfile);
router.get('/', requireRoles('platform_admin', 'school_admin'), listUsers);
router.post('/', requireRoles('platform_admin', 'school_admin'), createUser);
router.get('/:userId', getUser);
router.get('/:userId/profile', getUser);
router.patch('/:userId', requireRoles('platform_admin', 'school_admin'), updateUser);
router.post('/:userId/activate', requireRoles('platform_admin', 'school_admin'), (req, res, next) => {
  req.params.action = 'activate';
  setUserStatus(req, res, next);
});
router.post('/:userId/deactivate', requireRoles('platform_admin', 'school_admin'), (req, res, next) => {
  req.params.action = 'deactivate';
  setUserStatus(req, res, next);
});

module.exports = router;
