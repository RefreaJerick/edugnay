const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolUser, requireTeacher } = require('../middleware/authorize');
const { requireShsTeachingEnabled } = require('../utils/shsTeachingAccess');
const controller = require('../controllers/shsGradesController');

const router = express.Router();
router.use(requireAuth, requireSchoolUser, requireShsTeachingEnabled, requireTeacher);
router.get('/workspace', controller.workspace);
router.get('/preview', controller.preview);
router.post('/items', controller.createItem);
router.put('/scores', controller.saveScore);
router.put('/scores/correction', controller.correctScore);
router.post('/publish', controller.publish);
module.exports = router;
