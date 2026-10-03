function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have access to this resource.' });
    }

    next();
  };
}

const requireRoles = requireRole;
const requirePlatformAdmin = requireRole('platform_admin');
const requireSchoolAdmin = requireRole('school_admin');
const requireTeacher = requireRole('teacher');
const requireStudent = requireRole('student');
const requireParent = requireRole('parent');

function requireSchoolUser(req, res, next) {
  const roles = ['school_admin', 'teacher', 'student', 'parent'];
  const schoolId = Number(req.user?.schoolId);
  if (!roles.includes(req.user?.role) || !Number.isSafeInteger(schoolId) || schoolId < 1) {
    return res.status(403).json({ message: 'You do not have access to this resource.' });
  }
  next();
}

module.exports = {
  requireParent,
  requirePlatformAdmin,
  requireRole,
  requireRoles,
  requireSchoolAdmin,
  requireSchoolUser,
  requireStudent,
  requireTeacher
};
