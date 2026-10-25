const express = require('express');
const { getSchoolGradeSummary } = require('../controllers/reportsController');
const narrativeReportEvidenceController = require('../controllers/narrativeReportEvidenceController');
const narrativeReportDraftController = require('../controllers/narrativeReportDraftController');
const narrativeReportReviewController = require('../controllers/narrativeReportReviewController');
const narrativeReportParentController = require('../controllers/narrativeReportParentController');
const { requireAuth } = require('../middleware/auth');
const { requireRoles, requireSchoolUser } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/grade-summary', requireRoles('school_admin'), getSchoolGradeSummary);
router.get('/weekly-settings', requireSchoolUser, requireRoles('school_admin', 'teacher'), narrativeReportEvidenceController.getWeeklySettings);
router.patch('/weekly-settings', requireRoles('school_admin'), narrativeReportEvidenceController.updateWeeklySettings);
router.get('/weekly-evidence', requireSchoolUser, requireRoles('teacher'), narrativeReportEvidenceController.getWeeklyEvidence);
router.get('/weekly-drafts', requireSchoolUser, requireRoles('teacher'), narrativeReportDraftController.listWeeklyDrafts);
router.get('/weekly-drafts/pending-count', requireSchoolUser, requireRoles('teacher'), narrativeReportDraftController.getPendingDraftCount);
router.post('/weekly-drafts/generate', requireSchoolUser, requireRoles('teacher'), narrativeReportDraftController.generateWeeklyDrafts);
router.patch('/weekly-drafts/:reportId', requireSchoolUser, requireRoles('teacher'), narrativeReportReviewController.saveReview);
router.post('/weekly-drafts/:reportId/confirm', requireSchoolUser, requireRoles('teacher'), narrativeReportReviewController.confirmReview);
router.post('/weekly-drafts/:reportId/reopen', requireSchoolUser, requireRoles('teacher'), narrativeReportReviewController.reopenReview);
router.post('/weekly-drafts/:reportId/release', requireSchoolUser, requireRoles('teacher'), narrativeReportReviewController.releaseReview);
router.get('/weekly-drafts/:reportId/history', requireSchoolUser, requireRoles('teacher', 'school_admin'), narrativeReportReviewController.getReleaseHistory);
router.get('/weekly-release-history', requireSchoolUser, requireRoles('school_admin'), narrativeReportReviewController.listSchoolReleaseHistory);
router.get('/parent/children/:studentId', requireSchoolUser, requireRoles('parent'), narrativeReportParentController.listChildReports);
router.get('/parent/children/:studentId/:reportId', requireSchoolUser, requireRoles('parent'), narrativeReportParentController.getChildReport);

module.exports = router;
