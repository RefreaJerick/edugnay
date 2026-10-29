const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolUser, requireSchoolAdmin, requireStudent } = require('../middleware/authorize');
const controller = require('../controllers/shsSelectionController');

const router = express.Router();
router.use(requireAuth, requireSchoolUser, controller.enabled);
router.get('/mine', requireStudent, controller.studentView);
router.put('/mine', requireStudent, controller.submit);
router.get('/students', requireSchoolAdmin, controller.adminList);
router.get('/students/:studentId/choices', requireSchoolAdmin, controller.staffStudentChoices);
router.put('/students/:studentId/choices', requireSchoolAdmin, controller.recordStudentChoices);
router.post('/requests/:requestId/decision', requireSchoolAdmin, controller.decide);
router.put('/requests/:requestId/classes', requireSchoolAdmin, controller.changeApproved);
router.post('/requests/:requestId/clear', requireSchoolAdmin, controller.clearApproved);
module.exports = router;
