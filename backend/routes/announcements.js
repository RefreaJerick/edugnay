const express = require('express');
const controller = require('../controllers/announcementsController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/', controller.listAnnouncements);
router.post('/', requireRoles('school_admin', 'teacher'), controller.createAnnouncement);
router.patch('/:announcementId', requireRoles('school_admin', 'teacher'), controller.updateAnnouncement);
router.delete('/:announcementId', requireRoles('school_admin', 'teacher'), controller.deleteAnnouncement);
router.post('/:announcementId/read', controller.markAnnouncementRead);

module.exports = router;
