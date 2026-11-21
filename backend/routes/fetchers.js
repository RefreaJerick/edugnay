const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');
const { fetcherPhotoUpload } = require('../config/fetcherPhotos');
const controller = require('../controllers/fetchersController');

const router = express.Router();
router.use(requireAuth);

router.get('/mine', requireRoles('parent'), controller.listMine);
router.post('/', requireRoles('parent'), fetcherPhotoUpload.single('photo'), controller.createFetcher);
router.patch('/:fetcherId', requireRoles('parent'), fetcherPhotoUpload.single('photo'), controller.updateFetcher);
router.post('/:fetcherId/students/:studentId/request', requireRoles('parent'), controller.requestChild);
router.post('/:fetcherId/students/:studentId/revoke', requireRoles('parent'), controller.revokeChild);
router.get('/requests', requireRoles('school_admin'), controller.listRequests);
router.post('/authorizations/:authorizationId/:decision', requireRoles('school_admin'), controller.decideAuthorization);
router.get('/:fetcherId/photo', requireRoles('parent', 'school_admin'), controller.getPhoto);

module.exports = router;
