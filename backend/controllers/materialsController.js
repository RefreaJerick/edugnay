const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { getDatabase } = require('../config/database');
const { materialUploadDirectory, materialTypes } = require('../config/uploads');

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function id(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) fail(`Invalid ${label}.`);
  return number;
}

async function teacherAssignment(database, user, sectionId, subjectId) {
  const [rows] = await database.execute(
    `SELECT sections.id FROM section_teachers
     INNER JOIN sections ON sections.id = section_teachers.section_id
       AND sections.school_id = section_teachers.school_id
     WHERE sections.id = ? AND sections.school_id = ? AND sections.status = 'active'
       AND section_teachers.subject_id = ? AND section_teachers.teacher_user_id = ? LIMIT 1`,
    [sectionId, user.schoolId, subjectId, user.id]
  );
  return Boolean(rows.length);
}

async function authorizeUpload(req, res, next) {
  try {
    req.materialSectionId = id(req.params.sectionId, 'section ID');
    req.materialSubjectId = id(req.params.subjectId, 'subject ID');
    if (!await teacherAssignment(getDatabase(), req.user, req.materialSectionId, req.materialSubjectId)) {
      fail('You are not assigned to this section and subject.', 403);
    }
    next();
  } catch (error) { next(error); }
}

function materialSelect() {
  return `SELECT materials.id, materials.school_id AS schoolId, materials.section_id AS sectionId,
    materials.subject_id AS subjectId, materials.academic_term_id AS academicTermId,
    materials.teacher_user_id AS teacherUserId, materials.title,
    materials.original_file_name AS originalFileName, materials.stored_file_name AS storedFileName,
    materials.file_type AS type, materials.mime_type AS mimeType, materials.file_size_bytes AS fileSizeBytes,
    materials.status, materials.posted_at AS postedAt, materials.created_at AS createdAt,
    subjects.name AS subjectName, teachers.display_name AS teacherName, academic_terms.name AS academicTermName
  FROM learning_materials AS materials
  INNER JOIN subjects ON subjects.id = materials.subject_id AND subjects.school_id = materials.school_id
  INNER JOIN users AS teachers ON teachers.id = materials.teacher_user_id AND teachers.school_id = materials.school_id
  LEFT JOIN academic_terms ON academic_terms.id = materials.academic_term_id AND academic_terms.school_id = materials.school_id`;
}

function publicMaterial(row) {
  const { storedFileName, mimeType, ...visible } = row;
  return { ...visible, id: String(row.id), sectionId: String(row.sectionId),
    subjectId: String(row.subjectId), fileSizeBytes: Number(row.fileSizeBytes) };
}

async function listMaterials(req, res, next) {
  try {
    const where = ['materials.school_id = ?', "materials.status <> 'archived'"];
    const values = [req.user.schoolId];
    if (req.user.role === 'teacher') {
      where.push('materials.teacher_user_id = ?');
      where.push(`EXISTS (SELECT 1 FROM section_teachers WHERE section_teachers.section_id = materials.section_id
        AND section_teachers.school_id = materials.school_id
        AND section_teachers.subject_id = materials.subject_id AND section_teachers.teacher_user_id = ?)`);
      values.push(req.user.id, req.user.id);
    } else if (req.user.role === 'student') {
      where.push("materials.status = 'published'");
      where.push(`EXISTS (SELECT 1 FROM section_students
        INNER JOIN sections ON sections.id = section_students.section_id
          AND sections.school_id = section_students.school_id AND sections.status = 'active'
        WHERE section_students.section_id = materials.section_id
        AND section_students.school_id = materials.school_id
        AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL)`);
      values.push(req.user.id);
    } else fail('Learning materials are available only to teachers and students.', 403);
    if (req.query.sectionId) { where.push('materials.section_id = ?'); values.push(id(req.query.sectionId, 'section ID')); }
    if (req.query.subjectId) { where.push('materials.subject_id = ?'); values.push(id(req.query.subjectId, 'subject ID')); }
    const [rows] = await getDatabase().execute(`${materialSelect()} WHERE ${where.join(' AND ')} ORDER BY materials.created_at DESC`, values);
    res.json({ materials: rows.map(publicMaterial) });
  } catch (error) { next(error); }
}

async function checkSignature(file) {
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const bytes = Buffer.alloc(16);
    await handle.read(bytes, 0, 16, 0);
    const extension = path.extname(file.filename).toLowerCase();
    const zip = bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const ole = bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    const valid = extension === '.pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
      : ['.docx', '.pptx', '.xlsx'].includes(extension) ? zip
        : ['.doc', '.ppt', '.xls'].includes(extension) ? ole
          : extension === '.jpg' ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
            : extension === '.png' ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
              : extension === '.mp4' ? bytes.subarray(4, 8).toString() === 'ftyp' : false;
    if (!valid) fail('The file contents do not match its extension.');
    if (zip) {
      const workbook = await JSZip.loadAsync(await fs.promises.readFile(file.path))
        .catch(() => fail('The Office document is invalid.'));
      const requiredPart = { '.docx': 'word/document.xml', '.pptx': 'ppt/presentation.xml', '.xlsx': 'xl/workbook.xml' }[extension];
      if (!workbook.file(requiredPart) || Object.keys(workbook.files).some(name => /vbaProject\.bin$/i.test(name))) {
        fail('The Office document is invalid or contains macros.');
      }
    }
  } finally { await handle.close(); }
}

async function createMaterial(req, res, next) {
  let connection = null;
  let committed = false;
  try {
    if (!req.file) fail('Choose a file to upload.');
    const title = String(req.body.title || '').trim();
    const status = String(req.body.status || 'published');
    if (!title || title.length > 255) fail('Enter a title of 255 characters or fewer.');
    if (!['draft', 'published'].includes(status)) fail('Invalid material visibility.');
    if (!req.file.size || (req.file.size > 20 * 1024 * 1024 && path.extname(req.file.filename) !== '.mp4')) {
      fail('Non-video materials must be 20 MB or smaller.');
    }
    await checkSignature(req.file);
    const originalName = path.basename(req.file.originalname).slice(0, 255);
    connection = await getDatabase().getConnection();
    await connection.beginTransaction();
    if (!await teacherAssignment(connection, req.user, req.materialSectionId, req.materialSubjectId)) {
      fail('You are not assigned to this section and subject.', 403);
    }
    const [terms] = await connection.execute(
      `SELECT academic_terms.id FROM academic_terms
       INNER JOIN sections ON sections.academic_year_id = academic_terms.academic_year_id
         AND sections.school_level_id = academic_terms.school_level_id
         AND sections.school_id = academic_terms.school_id
       WHERE sections.id = ? AND sections.school_id = ? AND academic_terms.status = 'active' LIMIT 1`,
      [req.materialSectionId, req.user.schoolId]
    );
    const [result] = await connection.execute(
      `INSERT INTO learning_materials
       (school_id, section_id, subject_id, academic_term_id, teacher_user_id, title,
        original_file_name, stored_file_name, file_type, mime_type, file_size_bytes, status, posted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'published' ? 'NOW()' : 'NULL'})`,
      [req.user.schoolId, req.materialSectionId, req.materialSubjectId, terms[0]?.id || null,
        req.user.id, title, originalName, req.file.filename,
        path.extname(req.file.filename).slice(1), materialTypes[path.extname(req.file.filename)], req.file.size, status]
    );
    const [rows] = await connection.execute(`${materialSelect()} WHERE materials.id = ? AND materials.school_id = ?`, [result.insertId, req.user.schoolId]);
    await connection.commit();
    committed = true;
    res.status(201).json({ material: publicMaterial(rows[0]) });
  } catch (error) {
    if (connection && !committed) await connection.rollback().catch(() => {});
    if (req.file && !committed) await fs.promises.unlink(req.file.path).catch(() => {});
    next(error);
  } finally {
    connection?.release();
  }
}

async function findMaterial(req, database) {
  const materialId = id(req.params.materialId, 'material ID');
  const where = ['materials.id = ?', 'materials.school_id = ?', "materials.status <> 'archived'"];
  const values = [materialId, req.user.schoolId];
  if (req.user.role === 'teacher') {
    where.push('materials.teacher_user_id = ?');
    values.push(req.user.id);
  } else if (req.user.role === 'student') {
    where.push("materials.status = 'published'");
    where.push(`EXISTS (SELECT 1 FROM section_students
      INNER JOIN sections ON sections.id = section_students.section_id
        AND sections.school_id = section_students.school_id AND sections.status = 'active'
      WHERE section_students.section_id = materials.section_id
      AND section_students.school_id = materials.school_id
      AND section_students.student_user_id = ? AND section_students.withdrawn_at IS NULL)`);
    values.push(req.user.id);
  } else fail('You cannot access this material.', 403);
  const [rows] = await database.execute(`${materialSelect()} WHERE ${where.join(' AND ')} LIMIT 1`, values);
  if (!rows[0]) fail('This learning material is unavailable.', 404);
  if (req.user.role === 'teacher' && !await teacherAssignment(database, req.user, rows[0].sectionId, rows[0].subjectId)) {
    fail('This learning material is unavailable.', 404);
  }
  return rows[0];
}

async function updateMaterial(req, res, next) {
  try {
    const database = getDatabase();
    const material = await findMaterial(req, database);
    const status = String(req.body.status || '');
    if (!['draft', 'published'].includes(status)) fail('Choose draft or published visibility.');
    if (req.user.role !== 'teacher') fail('Only the uploading teacher can change this material.', 403);
    await database.execute(
      `UPDATE learning_materials SET status = ?, posted_at = CASE WHEN ? = 'published' THEN COALESCE(posted_at, NOW()) ELSE NULL END WHERE id = ? AND school_id = ? AND teacher_user_id = ?`,
      [status, status, material.id, req.user.schoolId, req.user.id]
    );
    const [rows] = await database.execute(`${materialSelect()} WHERE materials.id = ? AND materials.school_id = ?`, [material.id, req.user.schoolId]);
    res.json({ material: publicMaterial(rows[0]) });
  } catch (error) { next(error); }
}

async function deleteMaterial(req, res, next) {
  try {
    const database = getDatabase();
    const material = await findMaterial(req, database);
    if (req.user.role !== 'teacher') fail('Only the uploading teacher can remove this material.', 403);
    if (!/^[a-f0-9-]{36}\.(pdf|doc|docx|ppt|pptx|xls|xlsx|jpg|png|mp4)$/.test(material.storedFileName)) {
      fail('The stored file is invalid.', 500);
    }
    const filePath = path.join(materialUploadDirectory, material.storedFileName);
    const [result] = await database.execute(
      'DELETE FROM learning_materials WHERE id = ? AND school_id = ? AND teacher_user_id = ?',
      [material.id, req.user.schoolId, req.user.id]
    );
    if (!result.affectedRows) fail('This learning material is unavailable.', 404);
    let fileCleanupPending = false;
    try {
      await fs.promises.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        fileCleanupPending = true;
        console.error('A deleted learning material file needs cleanup.');
      }
    }
    if (fileCleanupPending) return res.status(200).json({ deleted: true, fileCleanupPending: true });
    res.status(204).end();
  } catch (error) { next(error); }
}

async function openMaterial(req, res, next) {
  try {
    const material = await findMaterial(req, getDatabase());
    if (!/^[a-f0-9-]{36}\.(pdf|doc|docx|ppt|pptx|xls|xlsx|jpg|png|mp4)$/.test(material.storedFileName)) {
      fail('The stored file is invalid.', 500);
    }
    const filePath = path.join(materialUploadDirectory, material.storedFileName);
    const stats = await fs.promises.stat(filePath).catch(() => null);
    if (!stats?.isFile()) fail('The material file is unavailable.', 404);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.query.download === '1') {
      return res.download(filePath, material.originalFileName, { dotfiles: 'allow' });
    }
    if (material.type === 'mp4') {
      const match = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
      const start = match ? Number(match[1]) : 0;
      const end = match && match[2] ? Number(match[2]) : stats.size - 1;
      if (start >= stats.size || end >= stats.size || start > end) {
        res.setHeader('Content-Range', `bytes */${stats.size}`);
        return res.status(416).end();
      }
      res.status(match ? 206 : 200);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', end - start + 1);
      if (match) res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', error => res.headersSent ? res.destroy(error) : next(error));
      return stream.pipe(res);
    }
    if (['pdf', 'jpg', 'png'].includes(material.type)) {
      res.setHeader('Content-Type', material.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="material.${material.type}"`);
      return res.sendFile(filePath, { dotfiles: 'allow' });
    }
    res.download(filePath, material.originalFileName, { dotfiles: 'allow' });
  } catch (error) { next(error); }
}

module.exports = { authorizeUpload, listMaterials, createMaterial, updateMaterial, deleteMaterial, openMaterial };
