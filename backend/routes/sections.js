const express = require('express');
const controller = require('../controllers/sectionsController');
const { requireAuth } = require('../middleware/auth');
const { requireSchoolAdmin } = require('../middleware/authorize');

const router = express.Router();

router.use(requireAuth);
router.get('/', controller.listSections);
router.post('/', requireSchoolAdmin, controller.createSection);
router.get('/:sectionId/students', controller.listSectionStudents);
router.post('/:sectionId/students', requireSchoolAdmin, controller.enrollStudent);
router.post('/:sectionId/students/:studentId/move', requireSchoolAdmin, controller.moveStudent);
router.delete('/:sectionId/students/:studentId', requireSchoolAdmin, controller.withdrawStudent);
router.get('/:sectionId/teachers', controller.listSectionTeachers);
router.post('/:sectionId/teachers', requireSchoolAdmin, controller.assignTeacher);
router.patch('/:sectionId/teachers/:assignmentId', requireSchoolAdmin, controller.updateTeacherAssignment);
router.delete('/:sectionId/teachers/:assignmentId', requireSchoolAdmin, controller.removeTeacherAssignment);
router.get('/:sectionId', controller.getSection);
router.patch('/:sectionId', requireSchoolAdmin, controller.updateSection);
router.delete('/:sectionId', requireSchoolAdmin, controller.deleteSection);

module.exports = router;
