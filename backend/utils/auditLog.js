async function writeAuditLog(connection, req, actionType, entityType, entityId, details = {}, schoolId = req.user.schoolId) {
  await connection.execute(
    `INSERT INTO audit_logs (school_id, actor_user_id, action_type, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [schoolId, req.user.id, actionType, entityType, entityId || null, JSON.stringify(details)]
  );
}

module.exports = { writeAuditLog };
