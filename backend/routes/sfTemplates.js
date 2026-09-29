const express = require('express');
const controller = require('../controllers/sfTemplatesController');
const { requireAuth } = require('../middleware/auth');
const { requireTeacher } = require('../middleware/authorize');

const router = express.Router();

router.get('/sf-templates', requireAuth, requireTeacher, controller.listTemplates);
router.get('/sf-templates/:templateId', requireAuth, requireTeacher, controller.getTemplateDetails);
router.get('/sf-templates/:templateId/preview', requireAuth, requireTeacher, controller.previewTemplate);
router.post('/sf-templates/:templateId/generate', requireAuth, requireTeacher, controller.generateTemplate);
router.get('/sf-exports/:exportId/download', requireAuth, requireTeacher, controller.downloadExport);

module.exports = router;
