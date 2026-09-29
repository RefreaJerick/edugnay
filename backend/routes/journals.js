const express = require('express');
const controller = require('../controllers/journalsController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.get('/journal-subjects', requireAuth, requireRoles('teacher', 'student'), controller.listJournalSubjects);
router.get('/journal-sections', requireAuth, requireRoles('teacher'), controller.listJournalSections);
router.get('/journal-prompts', requireAuth, requireRoles('teacher', 'student'), controller.listJournalPrompts);
router.post('/journal-prompts', requireAuth, requireRoles('teacher'), controller.createJournalPrompt);
router.patch('/journal-prompts/:promptId', requireAuth, requireRoles('teacher'), controller.updateJournalPrompt);
router.get('/journal-entries', requireAuth, requireRoles('teacher', 'student'), controller.listJournalEntries);
router.post('/journal-entries', requireAuth, requireRoles('student'), controller.submitJournalEntry);
router.post('/journal-entries/:entryId/review', requireAuth, requireRoles('teacher'), controller.reviewJournalEntry);
router.post('/journal-entries/:entryId/feedback', requireAuth, requireRoles('teacher'), controller.addJournalFeedback);

module.exports = router;
