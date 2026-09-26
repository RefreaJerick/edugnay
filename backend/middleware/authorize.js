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

function requireOwnSchool(req, res, next) {
  const schoolId = Number.parseInt(req.params.schoolId || req.body.schoolId || req.query.schoolId, 10);
  if (!Number.isSafeInteger(schoolId) || schoolId < 1 || req.user?.role !== 'school_admin' || req.user.schoolId !== schoolId) {
    return res.status(403).json({ message: 'You do not have access to this school.' });
  }
  next();
}

module.exports = {
  requireOwnSchool,
  requireParent,
  requirePlatformAdmin,
  requireRole,
  requireRoles,
  requireSchoolAdmin,
  requireStudent,
  requireTeacher
};
