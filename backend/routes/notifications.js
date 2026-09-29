const express = require('express');
const controller = require('../controllers/notificationsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/', controller.listNotifications);
router.post('/read-all', controller.markAllNotificationsRead);
router.post('/:notificationId/read', controller.markNotificationRead);

module.exports = router;
