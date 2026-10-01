const express = require('express');
const controller = require('../controllers/gradingPeriodReopenController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles, requireSchoolAdmin, requireTeacher } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/', requireRoles('teacher', 'school_admin'), controller.listRequests);
router.get('/access', requireTeacher, controller.getTeacherEditAccess);
router.post('/', requireTeacher, controller.createRequest);
router.post('/:requestId/approve', requireSchoolAdmin, controller.approveRequest);
router.post('/:requestId/reject', requireSchoolAdmin, controller.rejectRequest);
router.post('/:requestId/extend', requireSchoolAdmin, controller.extendRequest);
router.post('/:requestId/revoke', requireSchoolAdmin, controller.revokeRequest);

module.exports = router;
