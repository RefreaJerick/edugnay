const express = require('express');
const controller = require('../controllers/notificationsController');
const push = require('../controllers/pushSubscriptionsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/push-key', push.pushKey);
router.post('/push-subscriptions/status', push.status);
router.post('/push-subscriptions', push.subscribe);
router.delete('/push-subscriptions', push.unsubscribe);
router.get('/', controller.listNotifications);
router.post('/read-all', controller.markAllNotificationsRead);
router.post('/:notificationId/read', controller.markNotificationRead);

module.exports = router;
