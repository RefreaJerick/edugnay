const express = require('express');
const controller = require('../controllers/tasksController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/', controller.listTasks);
router.post('/', controller.createTask);
router.patch('/:taskId', controller.updateTask);
router.delete('/:taskId', controller.deleteTask);

module.exports = router;
