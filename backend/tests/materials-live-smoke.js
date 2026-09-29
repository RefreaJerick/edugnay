// Run with `node tests/materials-live-smoke.js` while the local API is running.
// Creates a temporary draft, verifies access, then removes its exact row and file.
require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const assert = require('node:assert/strict');
const { getDatabase } = require('../config/database');
const { createSession, deleteSession } = require('../config/session');
const { materialUploadDirectory } = require('../config/uploads');

async function main() {
  const database = getDatabase();
  const title = `Integration check ${crypto.randomUUID()}`;
  let teacherToken = null;
  let studentToken = null;
  let otherTeacherToken = null;
  let outsiderToken = null;
  let materialId = null;
  try {
    const [assignments] = await database.execute(
      'SELECT subject_id AS subjectId, teacher_user_id AS teacherId FROM section_teachers WHERE section_id = ? LIMIT 1', [8]);
    const [students] = await database.execute(
      `SELECT section_students.student_user_id AS studentId FROM section_students
       INNER JOIN users ON users.id = section_students.student_user_id
       WHERE section_students.section_id = ? AND section_students.withdrawn_at IS NULL
         AND users.account_status = 'active' LIMIT 1`, [8]);
    const [otherTeachers] = await database.execute(
      "SELECT id FROM users WHERE role = 'teacher' AND account_status = 'active' AND id <> ? LIMIT 1",
      [assignments[0]?.teacherId || 0]);
    const [outsiders] = await database.execute(
      `SELECT users.id FROM users WHERE users.role = 'student' AND users.account_status = 'active'
       AND NOT EXISTS (SELECT 1 FROM section_students WHERE section_students.student_user_id = users.id
         AND section_students.section_id = ? AND section_students.withdrawn_at IS NULL) LIMIT 1`, [8]);
    if (!assignments[0] || !students[0]) throw new Error('The demo teacher/student assignment is unavailable.');
    teacherToken = await createSession(assignments[0].teacherId);
    studentToken = await createSession(students[0].studentId);
    if (otherTeachers[0]) otherTeacherToken = await createSession(otherTeachers[0].id);
    if (outsiders[0]) outsiderToken = await createSession(outsiders[0].id);
    const base = `http://127.0.0.1:${process.env.PORT || 3000}/api/materials`;
    async function request(route, token, options = {}) {
      return fetch(`${base}${route}`, {
        ...options, headers: { cookie: `academix_session=${token}`, ...(options.headers || {}) }
      });
    }

    const form = new FormData();
    form.set('title', title);
    form.set('description', 'Temporary integration check');
    form.set('status', 'draft');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/kZkAAAAASUVORK5CYII=', 'base64');
    form.set('file', new Blob([png], { type: 'image/png' }), 'check.png');
    const upload = await request(`/sections/8/subjects/${assignments[0].subjectId}`, teacherToken, { method: 'POST', body: form });
    const uploadBody = await upload.json();
    assert.equal(upload.status, 201, `Upload failed: ${JSON.stringify(uploadBody)}`);
    materialId = uploadBody.material.id;

    const studentDraft = await request('/', studentToken);
    assert.equal(studentDraft.status, 200);
    assert.ok(!(await studentDraft.json()).materials.some(item => item.id === String(materialId)));
    const draftFile = await request(`/${materialId}/file`, studentToken);
    assert.equal(draftFile.status, 404);

    const publish = await request(`/${materialId}`, teacherToken, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'published' })
    });
    assert.equal(publish.status, 200);
    const studentPublished = await request('/', studentToken);
    assert.ok((await studentPublished.json()).materials.some(item => item.id === String(materialId)));
    const file = await request(`/${materialId}/file`, studentToken);
    assert.equal(file.status, 200);
    assert.ok(Buffer.from(await file.arrayBuffer()).equals(png));
    if (otherTeacherToken) {
      const otherTeacherFile = await request(`/${materialId}/file`, otherTeacherToken);
      assert.equal(otherTeacherFile.status, 404);
    }
    if (outsiderToken) {
      const outsiderFile = await request(`/${materialId}/file`, outsiderToken);
      assert.equal(outsiderFile.status, 404);
    }

    const archive = await request(`/${materialId}`, teacherToken, { method: 'DELETE' });
    assert.equal(archive.status, 204);
    const studentArchived = await request('/', studentToken);
    assert.ok(!(await studentArchived.json()).materials.some(item => item.id === String(materialId)));
    console.log('Live materials upload, draft, publish, protected download, and archive passed.');
  } finally {
    const [testRows] = await database.execute(
      'SELECT id, stored_file_name AS storedFileName FROM learning_materials WHERE title = ?', [title]);
    for (const row of testRows) {
      if (/^[a-f0-9-]{36}\.png$/.test(row.storedFileName)) {
        await database.execute('DELETE FROM learning_materials WHERE id = ? AND title = ?', [row.id, title]);
        const filePath = path.resolve(materialUploadDirectory, row.storedFileName);
        if (filePath.startsWith(`${path.resolve(materialUploadDirectory)}${path.sep}`)) {
          await fs.unlink(filePath).catch(() => {});
        }
      }
    }
    if (teacherToken) await deleteSession(teacherToken);
    if (studentToken) await deleteSession(studentToken);
    if (otherTeacherToken) await deleteSession(otherTeacherToken);
    if (outsiderToken) await deleteSession(outsiderToken);
    await database.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
