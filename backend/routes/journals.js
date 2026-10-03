const express = require('express');
const controller = require('../controllers/journalsController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/authorize');

const router = express.Router();

router.get('/journal-subjects', requireAuth, requireRoles('teacher', 'student'), controller.listJournalSubjects);
router.get('/journal-history', requireAuth, requireRoles('school_admin', 'teacher', 'student'), controller.listJournalHistory);
router.get('/journal-sections', requireAuth, requireRoles('teacher'), controller.listJournalSections);
router.get('/journal-prompts', requireAuth, requireRoles('teacher', 'student'), controller.listJournalPrompts);
router.post('/journal-prompts', requireAuth, requireRoles('teacher'), controller.createJournalPrompt);
router.patch('/journal-prompts/:promptId', requireAuth, requireRoles('teacher'), controller.updateJournalPrompt);
router.delete('/journal-prompts/:promptId', requireAuth, requireRoles('school_admin', 'teacher'), controller.deleteJournalPrompt);
router.get('/journal-entries', requireAuth, requireRoles('teacher', 'student'), controller.listJournalEntries);
router.post('/journal-entries', requireAuth, requireRoles('student'), controller.submitJournalEntry);
router.post('/journal-entries/:entryId/review', requireAuth, requireRoles('teacher'), controller.reviewJournalEntry);

module.exports = router;
