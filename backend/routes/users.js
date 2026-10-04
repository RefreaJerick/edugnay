const express = require('express');
const {
  createUser,
  deleteUser,
  getMyParents,
  getMyProfile,
  getParentChildren,
  getUser,
  listUsers,
  setUserStatus,
  updateMyProfile,
  updateUser
} = require('../controllers/usersController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');
const { avatarUpload } = require('../config/avatars');
const { getAvatar, removeMyAvatar, uploadMyAvatar } = require('../controllers/avatarsController');

const router = express.Router();

router.use(requireAuth);
router.post('/me/avatar', avatarUpload.single('avatar'), uploadMyAvatar);
router.delete('/me/avatar', removeMyAvatar);
router.get('/:userId/avatar', getAvatar);
router.get('/me/profile', getMyProfile);
router.patch('/me/profile', updateMyProfile);
router.get('/me/parents', requireRoles('student'), getMyParents);
router.get('/me/children', requireRoles('parent'), getParentChildren);
router.get('/', requireRoles('school_admin'), listUsers);
router.post('/', requireRoles('school_admin'), createUser);
router.get('/:userId', getUser);
router.get('/:userId/children', requireRoles('school_admin'), getParentChildren);
router.get('/:userId/profile', getUser);
router.patch('/:userId', requireRoles('school_admin'), updateUser);
router.delete('/:userId', requireRoles('school_admin'), deleteUser);
router.post('/:userId/activate', requireRoles('school_admin'), (req, res, next) => {
  req.params.action = 'activate';
  setUserStatus(req, res, next);
});
router.post('/:userId/deactivate', requireRoles('school_admin'), (req, res, next) => {
  req.params.action = 'deactivate';
  setUserStatus(req, res, next);
});

module.exports = router;
