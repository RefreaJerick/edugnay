const express = require('express');
const { getSection, listSectionStudents, listSections } = require('../controllers/sectionsController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);
router.get('/', listSections);
router.get('/:sectionId/students', listSectionStudents);
router.get('/:sectionId', getSection);

module.exports = router;
