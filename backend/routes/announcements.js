const express = require('express');
const controller = require('../controllers/announcementsController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles, requireSchoolUser } = require('../middleware/authorize');
const { announcementImageUpload } = require('../config/announcementImages');

const router = express.Router();

router.use(requireAuth, requireSchoolUser);
router.get('/', controller.listAnnouncements);
router.post('/', requireRoles('school_admin', 'teacher'), announcementImageUpload.single('image'), controller.createAnnouncement);
router.patch('/:announcementId', requireRoles('school_admin', 'teacher'), announcementImageUpload.single('image'), controller.updateAnnouncement);
router.get('/:announcementId/image', controller.getAnnouncementImage);
router.patch('/:announcementId/pin', requireRoles('school_admin'), controller.setAnnouncementPinned);
router.delete('/:announcementId', requireRoles('school_admin', 'teacher'), controller.deleteAnnouncement);
router.post('/:announcementId/read', controller.markAnnouncementRead);

module.exports = router;
