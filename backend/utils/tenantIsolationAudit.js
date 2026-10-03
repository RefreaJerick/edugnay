const TENANT_ISOLATION_CHECKS = [
  {
    name: 'user_role_school',
    area: 'accounts',
    description: 'Platform administrators must have no school; every school role must have one.',
    sql: `SELECT id AS recordId, school_id AS schoolId, role
      FROM users
      WHERE (role = 'platform_admin' AND school_id IS NOT NULL)
        OR (role IN ('school_admin', 'teacher', 'student', 'parent') AND school_id IS NULL)`
  },
  {
    name: 'profile_roles',
    area: 'accounts',
    description: 'Role profile rows must point to a user with the matching role.',
    sql: `SELECT profiles.recordId, profiles.expectedRole, users.role AS actualRole
      FROM (
        SELECT user_id AS recordId, 'school_admin' AS expectedRole FROM school_admin_profiles
        UNION ALL SELECT user_id, 'teacher' FROM teacher_profiles
        UNION ALL SELECT user_id, 'student' FROM student_profiles
        UNION ALL SELECT user_id, 'parent' FROM parent_profiles
      ) AS profiles
      INNER JOIN users ON users.id = profiles.recordId
      WHERE users.role <> profiles.expectedRole`
  },
  {
    name: 'student_parent_links',
    area: 'accounts',
    description: 'Linked students and parents must have the expected roles and belong to one school.',
    sql: `SELECT links.id AS recordId, students.school_id AS studentSchoolId,
        parents.school_id AS parentSchoolId, students.role AS studentRole, parents.role AS parentRole
      FROM student_parent_links AS links
      INNER JOIN users AS students ON students.id = links.student_user_id
      INNER JOIN users AS parents ON parents.id = links.parent_user_id
      WHERE students.school_id <> parents.school_id
        OR students.role <> 'student' OR parents.role <> 'parent'`
  },
  {
    name: 'school_configuration_editors',
    area: 'accounts',
    description: 'School configuration editors must be administrators from the configured school.',
    sql: `SELECT triggers.school_id AS recordId, triggers.school_id AS schoolId,
        users.school_id AS userSchoolId, users.role
      FROM parent_notification_triggers AS triggers
      INNER JOIN users ON users.id = triggers.updated_by_user_id
      WHERE users.school_id <> triggers.school_id OR users.role <> 'school_admin'`
  },
  {
    name: 'academic_year_archiver',
    area: 'academic structure',
    description: 'An academic-year archiver must belong to that school and be a school administrator.',
    sql: `SELECT years.id AS recordId, years.school_id AS schoolId, users.school_id AS userSchoolId, users.role
      FROM academic_years AS years
      INNER JOIN users ON users.id = years.archived_by_user_id
      WHERE users.school_id <> years.school_id OR users.role <> 'school_admin'`
  },
  {
    name: 'academic_terms',
    area: 'academic structure',
    description: 'An academic term year and school level must belong to the same school.',
    sql: `SELECT terms.id AS recordId, years.school_id AS yearSchoolId, levels.school_id AS levelSchoolId
      FROM academic_terms AS terms
      INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
      INNER JOIN school_levels AS levels ON levels.id = terms.school_level_id
      WHERE years.school_id <> levels.school_id`
  },
  {
    name: 'academic_term_actions',
    area: 'academic structure',
    description: 'Term actions must be performed by a school administrator from the term school.',
    sql: `SELECT actions.id AS recordId, years.school_id AS schoolId,
        users.school_id AS userSchoolId, users.role
      FROM academic_term_actions AS actions
      INNER JOIN academic_terms AS terms ON terms.id = actions.academic_term_id
      INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
      INNER JOIN users ON users.id = actions.performed_by_user_id
      WHERE users.school_id <> years.school_id OR users.role <> 'school_admin'`
  },
  {
    name: 'subjects',
    area: 'academic structure',
    description: 'Subject levels and grades must belong to the subject school.',
    sql: `SELECT subjects.id AS recordId, subjects.school_id AS schoolId,
        levels.school_id AS levelSchoolId, grade_levels.school_level_id AS gradeLevelParentId
      FROM subjects
      LEFT JOIN school_levels AS levels ON levels.id = subjects.school_level_id
      LEFT JOIN school_grade_levels AS grade_levels ON grade_levels.id = subjects.grade_level_id
      LEFT JOIN school_levels AS grade_schools ON grade_schools.id = grade_levels.school_level_id
      WHERE (subjects.school_level_id IS NOT NULL AND levels.school_id <> subjects.school_id)
        OR (subjects.grade_level_id IS NOT NULL AND grade_schools.school_id <> subjects.school_id)
        OR (subjects.school_level_id IS NOT NULL AND subjects.grade_level_id IS NOT NULL
          AND grade_levels.school_level_id <> subjects.school_level_id)`
  },
  {
    name: 'school_settings_journal_subject',
    area: 'academic structure',
    description: 'The configured journal subject must belong to the configured school.',
    sql: `SELECT settings.school_id AS recordId, settings.school_id AS schoolId,
        subjects.school_id AS subjectSchoolId
      FROM school_settings AS settings
      INNER JOIN subjects ON subjects.id = settings.journal_subject_id
      WHERE subjects.school_id <> settings.school_id`
  },
  {
    name: 'sections',
    area: 'classes',
    description: 'Every section relation must belong to the section school.',
    sql: `SELECT sections.id AS recordId, sections.school_id AS schoolId,
        years.school_id AS yearSchoolId, levels.school_id AS levelSchoolId,
        grade_schools.school_id AS gradeSchoolId, track_schools.school_id AS trackSchoolId,
        advisers.school_id AS adviserSchoolId, advisers.role AS adviserRole
      FROM sections
      INNER JOIN academic_years AS years ON years.id = sections.academic_year_id
      INNER JOIN school_levels AS levels ON levels.id = sections.school_level_id
      INNER JOIN school_grade_levels AS grades ON grades.id = sections.grade_level_id
      INNER JOIN school_levels AS grade_schools ON grade_schools.id = grades.school_level_id
      LEFT JOIN school_shs_tracks AS tracks ON tracks.id = sections.strand_id
      LEFT JOIN school_levels AS track_schools ON track_schools.id = tracks.school_level_id
      LEFT JOIN users AS advisers ON advisers.id = sections.adviser_user_id
      WHERE years.school_id <> sections.school_id OR levels.school_id <> sections.school_id
        OR grade_schools.school_id <> sections.school_id
        OR (sections.strand_id IS NOT NULL AND track_schools.school_id <> sections.school_id)
        OR (sections.adviser_user_id IS NOT NULL
          AND (advisers.school_id <> sections.school_id OR advisers.role <> 'teacher'))`
  },
  {
    name: 'section_students',
    area: 'classes',
    description: 'Enrolled users must be students from the section school.',
    sql: `SELECT enrollments.id AS recordId, sections.school_id AS schoolId,
        students.school_id AS studentSchoolId, students.role
      FROM section_students AS enrollments
      INNER JOIN sections ON sections.id = enrollments.section_id
      INNER JOIN users AS students ON students.id = enrollments.student_user_id
      WHERE students.school_id <> sections.school_id OR students.role <> 'student'`
  },
  {
    name: 'section_teachers',
    area: 'classes',
    description: 'Teacher assignments must use a teacher and subject from the section school.',
    sql: `SELECT assignments.id AS recordId, sections.school_id AS schoolId,
        teachers.school_id AS teacherSchoolId, subjects.school_id AS subjectSchoolId, teachers.role
      FROM section_teachers AS assignments
      INNER JOIN sections ON sections.id = assignments.section_id
      INNER JOIN users AS teachers ON teachers.id = assignments.teacher_user_id
      INNER JOIN subjects ON subjects.id = assignments.subject_id
      WHERE teachers.school_id <> sections.school_id OR subjects.school_id <> sections.school_id
        OR teachers.role <> 'teacher'`
  },
  {
    name: 'grading_categories',
    area: 'grades',
    description: 'Grading categories must use a school level from the same school.',
    sql: `SELECT categories.id AS recordId, categories.school_id AS schoolId,
        levels.school_id AS levelSchoolId
      FROM grading_categories AS categories
      INNER JOIN school_levels AS levels ON levels.id = categories.school_level_id
      WHERE levels.school_id <> categories.school_id`
  },
  {
    name: 'assignments',
    area: 'assignments',
    description: 'Assignment scope, term, category, teacher, and linked score component must match.',
    sql: `SELECT assignments.id AS recordId, assignments.school_id AS schoolId,
        sections.school_id AS sectionSchoolId, subjects.school_id AS subjectSchoolId,
        years.school_id AS termSchoolId, categories.school_id AS categorySchoolId,
        teachers.school_id AS teacherSchoolId, teachers.role
      FROM assignments
      INNER JOIN sections ON sections.id = assignments.section_id
      INNER JOIN subjects ON subjects.id = assignments.subject_id
      LEFT JOIN academic_terms AS terms ON terms.id = assignments.academic_term_id
      LEFT JOIN academic_years AS years ON years.id = terms.academic_year_id
      LEFT JOIN grading_categories AS categories ON categories.id = assignments.grading_category_id
      LEFT JOIN grading_items AS score_item ON score_item.id = assignments.grading_item_id
      INNER JOIN users AS teachers ON teachers.id = assignments.teacher_user_id
      WHERE sections.school_id <> assignments.school_id OR subjects.school_id <> assignments.school_id
        OR (assignments.academic_term_id IS NOT NULL AND years.school_id <> assignments.school_id)
        OR (assignments.grading_category_id IS NOT NULL AND categories.school_id <> assignments.school_id)
        OR (assignments.grading_item_id IS NOT NULL AND (score_item.id IS NULL
          OR score_item.school_id <> assignments.school_id
          OR score_item.section_id <> assignments.section_id
          OR score_item.subject_id <> assignments.subject_id
          OR score_item.academic_term_id <> assignments.academic_term_id
          OR score_item.grading_category_id <> assignments.grading_category_id
          OR score_item.teacher_user_id <> assignments.teacher_user_id))
        OR teachers.school_id <> assignments.school_id OR teachers.role <> 'teacher'`
  },
  {
    name: 'assignment_submissions',
    area: 'assignments',
    description: 'An assignment submission must come from a student in the assignment school.',
    sql: `SELECT submissions.id AS recordId, assignments.school_id AS schoolId,
        students.school_id AS studentSchoolId, students.role
      FROM assignment_submissions AS submissions
      INNER JOIN assignments ON assignments.id = submissions.assignment_id
      INNER JOIN users AS students ON students.id = submissions.student_user_id
      WHERE students.school_id <> assignments.school_id OR students.role <> 'student'`
  },
  {
    name: 'grading_items',
    area: 'grades',
    description: 'A grading item and its related records must belong to the section school.',
    sql: `SELECT items.id AS recordId, sections.school_id AS schoolId,
        subjects.school_id AS subjectSchoolId, years.school_id AS termSchoolId,
        categories.school_id AS categorySchoolId, teachers.school_id AS teacherSchoolId, teachers.role
      FROM grading_items AS items
      INNER JOIN sections ON sections.id = items.section_id
      INNER JOIN subjects ON subjects.id = items.subject_id
      INNER JOIN academic_terms AS terms ON terms.id = items.academic_term_id
      INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
      INNER JOIN grading_categories AS categories ON categories.id = items.grading_category_id
      INNER JOIN users AS teachers ON teachers.id = items.teacher_user_id
      WHERE subjects.school_id <> sections.school_id OR years.school_id <> sections.school_id
        OR categories.school_id <> sections.school_id OR teachers.school_id <> sections.school_id
        OR teachers.role <> 'teacher'`
  },
  {
    name: 'student_scores',
    area: 'grades',
    description: 'Scores must connect a student and recorder from the grading-item school.',
    sql: `SELECT scores.id AS recordId, sections.school_id AS schoolId,
        students.school_id AS studentSchoolId, recorders.school_id AS recorderSchoolId,
        students.role AS studentRole
      FROM student_scores AS scores
      INNER JOIN grading_items AS items ON items.id = scores.grading_item_id
      INNER JOIN sections ON sections.id = items.section_id
      INNER JOIN users AS students ON students.id = scores.student_user_id
      INNER JOIN users AS recorders ON recorders.id = scores.recorded_by_user_id
      WHERE students.school_id <> sections.school_id OR recorders.school_id <> sections.school_id
        OR students.role <> 'student'`
  },
  {
    name: 'published_final_grades',
    area: 'grades',
    description: 'Published grade relations must all belong to the stored school.',
    sql: `SELECT grades.id AS recordId, grades.school_id AS schoolId,
        sections.school_id AS sectionSchoolId, subjects.school_id AS subjectSchoolId,
        years.school_id AS termSchoolId, students.school_id AS studentSchoolId,
        publishers.school_id AS publisherSchoolId, students.role AS studentRole
      FROM published_final_grades AS grades
      INNER JOIN sections ON sections.id = grades.section_id
      INNER JOIN subjects ON subjects.id = grades.subject_id
      INNER JOIN academic_terms AS terms ON terms.id = grades.academic_term_id
      INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
      INNER JOIN users AS students ON students.id = grades.student_user_id
      INNER JOIN users AS publishers ON publishers.id = grades.published_by_user_id
      WHERE sections.school_id <> grades.school_id OR subjects.school_id <> grades.school_id
        OR years.school_id <> grades.school_id OR students.school_id <> grades.school_id
        OR publishers.school_id <> grades.school_id OR students.role <> 'student'`
  },
  {
    name: 'attendance_sessions',
    area: 'attendance',
    description: 'Attendance sessions and their actors must belong to the stored school.',
    sql: `SELECT sessions.id AS recordId, sessions.school_id AS schoolId,
        sections.school_id AS sectionSchoolId, subjects.school_id AS subjectSchoolId,
        creators.school_id AS creatorSchoolId, confirmers.school_id AS confirmerSchoolId
      FROM attendance_sessions AS sessions
      INNER JOIN sections ON sections.id = sessions.section_id
      LEFT JOIN subjects ON subjects.id = sessions.subject_id
      INNER JOIN users AS creators ON creators.id = sessions.created_by_user_id
      LEFT JOIN users AS confirmers ON confirmers.id = sessions.confirmed_by_user_id
      WHERE sections.school_id <> sessions.school_id
        OR (sessions.subject_id IS NOT NULL AND subjects.school_id <> sessions.school_id)
        OR creators.school_id <> sessions.school_id
        OR (sessions.confirmed_by_user_id IS NOT NULL AND confirmers.school_id <> sessions.school_id)`
  },
  {
    name: 'attendance_records',
    area: 'attendance',
    description: 'Attendance records must use students and markers from the session school.',
    sql: `SELECT records.id AS recordId, sessions.school_id AS schoolId,
        students.school_id AS studentSchoolId, markers.school_id AS markerSchoolId, students.role
      FROM attendance_records AS records
      INNER JOIN attendance_sessions AS sessions ON sessions.id = records.attendance_session_id
      INNER JOIN users AS students ON students.id = records.student_user_id
      INNER JOIN users AS markers ON markers.id = records.marked_by_user_id
      WHERE students.school_id <> sessions.school_id OR markers.school_id <> sessions.school_id
        OR students.role <> 'student'`
  },
  {
    name: 'qr_scan_events',
    area: 'attendance',
    description: 'QR scan participants must belong to the attendance-session school.',
    sql: `SELECT scans.id AS recordId, sessions.school_id AS schoolId,
        credential_students.school_id AS credentialSchoolId, scanned_students.school_id AS studentSchoolId,
        scanners.school_id AS scannerSchoolId
      FROM qr_scan_events AS scans
      INNER JOIN attendance_sessions AS sessions ON sessions.id = scans.attendance_session_id
      LEFT JOIN student_qr_credentials AS credentials ON credentials.id = scans.student_qr_credential_id
      LEFT JOIN users AS credential_students ON credential_students.id = credentials.student_user_id
      LEFT JOIN users AS scanned_students ON scanned_students.id = scans.scanned_student_user_id
      INNER JOIN users AS scanners ON scanners.id = scans.scanned_by_user_id
      WHERE (scans.student_qr_credential_id IS NOT NULL AND credential_students.school_id <> sessions.school_id)
        OR (scans.scanned_student_user_id IS NOT NULL AND scanned_students.school_id <> sessions.school_id)
        OR scanners.school_id <> sessions.school_id`
  },
  {
    name: 'student_qr_credentials',
    area: 'attendance',
    description: 'Student QR credentials must belong to student accounts.',
    sql: `SELECT credentials.id AS recordId, users.school_id AS schoolId, users.role
      FROM student_qr_credentials AS credentials
      INNER JOIN users ON users.id = credentials.student_user_id
      WHERE users.school_id IS NULL OR users.role <> 'student'`
  },
  {
    name: 'grading_period_reopen_requests',
    area: 'grades',
    description: 'A reopen request and its actors must belong to one school.',
    sql: `SELECT requests.id AS recordId, requests.school_id AS schoolId,
        years.school_id AS termSchoolId, sections.school_id AS sectionSchoolId,
        subjects.school_id AS subjectSchoolId, teachers.school_id AS teacherSchoolId,
        reviewers.school_id AS reviewerSchoolId, teachers.role AS teacherRole
      FROM grading_period_reopen_requests AS requests
      INNER JOIN academic_terms AS terms ON terms.id = requests.academic_term_id
      INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
      INNER JOIN sections ON sections.id = requests.section_id
      INNER JOIN subjects ON subjects.id = requests.subject_id
      INNER JOIN users AS teachers ON teachers.id = requests.teacher_user_id
      LEFT JOIN users AS reviewers ON reviewers.id = requests.reviewed_by_user_id
      WHERE years.school_id <> requests.school_id OR sections.school_id <> requests.school_id
        OR subjects.school_id <> requests.school_id OR teachers.school_id <> requests.school_id
        OR teachers.role <> 'teacher'
        OR (requests.reviewed_by_user_id IS NOT NULL AND reviewers.school_id <> requests.school_id)`
  },
  {
    name: 'announcements',
    area: 'communication',
    description: 'Announcement authors must belong to the announcement school.',
    sql: `SELECT announcements.id AS recordId, announcements.school_id AS schoolId,
        authors.school_id AS authorSchoolId, authors.role
      FROM announcements
      INNER JOIN users AS authors ON authors.id = announcements.author_user_id
      WHERE authors.school_id <> announcements.school_id
        OR authors.role NOT IN ('school_admin', 'teacher')`
  },
  {
    name: 'announcement_audiences',
    area: 'communication',
    description: 'A section audience must belong to the announcement school.',
    sql: `SELECT audiences.id AS recordId, announcements.school_id AS schoolId,
        sections.school_id AS sectionSchoolId
      FROM announcement_audiences AS audiences
      INNER JOIN announcements ON announcements.id = audiences.announcement_id
      INNER JOIN sections ON sections.id = audiences.section_id
      WHERE audiences.section_id IS NOT NULL AND sections.school_id <> announcements.school_id`
  },
  {
    name: 'announcement_recipients',
    area: 'communication',
    description: 'Announcement reads and queued emails must stay inside the announcement school.',
    sql: `SELECT recipients.recordId, recipients.source, announcements.school_id AS schoolId,
        users.school_id AS userSchoolId
      FROM (
        SELECT id AS recordId, announcement_id AS announcementId, user_id AS userId, 'read' AS source
          FROM announcement_reads
        UNION ALL
        SELECT id, announcement_id, user_id, 'email' FROM announcement_email_outbox
      ) AS recipients
      INNER JOIN announcements ON announcements.id = recipients.announcementId
      INNER JOIN users ON users.id = recipients.userId
      WHERE users.school_id <> announcements.school_id`
  },
  {
    name: 'notifications',
    area: 'communication',
    description: 'Notification announcement, recipient, and related student must share a school.',
    sql: `SELECT notifications.id AS recordId, recipients.school_id AS schoolId,
        announcements.school_id AS announcementSchoolId, students.school_id AS studentSchoolId
      FROM notifications
      INNER JOIN users AS recipients ON recipients.id = notifications.user_id
      LEFT JOIN announcements ON announcements.id = notifications.announcement_id
      LEFT JOIN users AS students ON students.id = notifications.related_student_user_id
      WHERE (notifications.announcement_id IS NOT NULL
          AND announcements.school_id <> recipients.school_id)
        OR (notifications.related_student_user_id IS NOT NULL
          AND students.school_id <> recipients.school_id)`
  },
  {
    name: 'learning_materials',
    area: 'materials',
    description: 'Material scope, term, and teacher must belong to the stored school.',
    sql: `SELECT materials.id AS recordId, materials.school_id AS schoolId,
        sections.school_id AS sectionSchoolId, subjects.school_id AS subjectSchoolId,
        years.school_id AS termSchoolId, teachers.school_id AS teacherSchoolId, teachers.role
      FROM learning_materials AS materials
      INNER JOIN sections ON sections.id = materials.section_id
      INNER JOIN subjects ON subjects.id = materials.subject_id
      LEFT JOIN academic_terms AS terms ON terms.id = materials.academic_term_id
      LEFT JOIN academic_years AS years ON years.id = terms.academic_year_id
      INNER JOIN users AS teachers ON teachers.id = materials.teacher_user_id
      WHERE sections.school_id <> materials.school_id OR subjects.school_id <> materials.school_id
        OR (materials.academic_term_id IS NOT NULL AND years.school_id <> materials.school_id)
        OR teachers.school_id <> materials.school_id OR teachers.role <> 'teacher'`
  },
  {
    name: 'journals',
    area: 'journals',
    description: 'Journal subjects, prompts, entries, and feedback must stay in one school.',
    sql: `SELECT records.recordId, records.source, records.schoolId, records.relatedSchoolId
      FROM (
        SELECT subjects.id AS recordId, 'subject' AS source, subjects.school_id AS schoolId,
          linked_subjects.school_id AS relatedSchoolId
          FROM journal_subjects AS subjects
          INNER JOIN subjects AS linked_subjects ON linked_subjects.id = subjects.subject_id
        UNION ALL
        SELECT prompts.id, 'prompt', journal_subjects.school_id, sections.school_id
          FROM journal_prompts AS prompts
          INNER JOIN journal_subjects ON journal_subjects.id = prompts.journal_subject_id
          INNER JOIN sections ON sections.id = prompts.section_id
        UNION ALL
        SELECT prompts.id, 'prompt creator', journal_subjects.school_id, creators.school_id
          FROM journal_prompts AS prompts
          INNER JOIN journal_subjects ON journal_subjects.id = prompts.journal_subject_id
          INNER JOIN users AS creators ON creators.id = prompts.created_by_user_id
        UNION ALL
        SELECT prompts.id, 'prompt grading item', journal_subjects.school_id, sections.school_id
          FROM journal_prompts AS prompts
          INNER JOIN journal_subjects ON journal_subjects.id = prompts.journal_subject_id
          INNER JOIN grading_items ON grading_items.id = prompts.grading_item_id
          INNER JOIN sections ON sections.id = grading_items.section_id
        UNION ALL
        SELECT entries.id, 'entry', journal_subjects.school_id, students.school_id
          FROM student_journal_entries AS entries
          INNER JOIN journal_subjects ON journal_subjects.id = entries.journal_subject_id
          INNER JOIN users AS students ON students.id = entries.student_user_id
        UNION ALL
        SELECT entries.id, 'entry section', journal_subjects.school_id, sections.school_id
          FROM student_journal_entries AS entries
          INNER JOIN journal_subjects ON journal_subjects.id = entries.journal_subject_id
          INNER JOIN sections ON sections.id = entries.section_id
        UNION ALL
        SELECT entries.id, 'entry prompt', journal_subjects.school_id, prompt_subjects.school_id
          FROM student_journal_entries AS entries
          INNER JOIN journal_subjects ON journal_subjects.id = entries.journal_subject_id
          INNER JOIN journal_prompts AS prompts ON prompts.id = entries.journal_prompt_id
          INNER JOIN journal_subjects AS prompt_subjects ON prompt_subjects.id = prompts.journal_subject_id
        UNION ALL
        SELECT feedback.id, 'feedback', journal_subjects.school_id, teachers.school_id
          FROM journal_feedback AS feedback
          INNER JOIN student_journal_entries AS entries ON entries.id = feedback.journal_entry_id
          INNER JOIN journal_subjects ON journal_subjects.id = entries.journal_subject_id
          INNER JOIN users AS teachers ON teachers.id = feedback.teacher_user_id
      ) AS records
      WHERE records.schoolId <> records.relatedSchoolId`
  },
  {
    name: 'narrative_reports',
    area: 'reports',
    description: 'Narrative report relations must belong to the stored school.',
    sql: `SELECT reports.id AS recordId, reports.school_id AS schoolId,
        students.school_id AS studentSchoolId, sections.school_id AS sectionSchoolId,
        teachers.school_id AS teacherSchoolId, years.school_id AS termSchoolId
      FROM narrative_reports AS reports
      INNER JOIN users AS students ON students.id = reports.student_user_id
      INNER JOIN sections ON sections.id = reports.section_id
      INNER JOIN users AS teachers ON teachers.id = reports.teacher_user_id
      LEFT JOIN academic_terms AS terms ON terms.id = reports.academic_term_id
      LEFT JOIN academic_years AS years ON years.id = terms.academic_year_id
      WHERE students.school_id <> reports.school_id OR sections.school_id <> reports.school_id
        OR teachers.school_id <> reports.school_id
        OR (reports.academic_term_id IS NOT NULL AND years.school_id <> reports.school_id)`
  },
  {
    name: 'report_reopen_requests',
    area: 'reports',
    description: 'Narrative-report reopen actors must belong to the report school.',
    sql: `SELECT requests.id AS recordId, reports.school_id AS schoolId,
        requesters.school_id AS requesterSchoolId, reviewers.school_id AS reviewerSchoolId
      FROM report_reopen_requests AS requests
      INNER JOIN narrative_reports AS reports ON reports.id = requests.narrative_report_id
      INNER JOIN users AS requesters ON requesters.id = requests.requested_by_user_id
      LEFT JOIN users AS reviewers ON reviewers.id = requests.reviewed_by_user_id
      WHERE requesters.school_id <> reports.school_id
        OR (requests.reviewed_by_user_id IS NOT NULL AND reviewers.school_id <> reports.school_id)`
  },
  {
    name: 'interventions',
    area: 'interventions',
    description: 'Intervention plans and progress actors must belong to the stored school.',
    sql: `SELECT records.recordId, records.source, records.schoolId, records.relatedSchoolId
      FROM (
        SELECT plans.id AS recordId, 'student' AS source, plans.school_id AS schoolId,
          students.school_id AS relatedSchoolId
          FROM intervention_plans AS plans
          INNER JOIN users AS students ON students.id = plans.student_user_id
        UNION ALL
        SELECT plans.id, 'section', plans.school_id, sections.school_id
          FROM intervention_plans AS plans
          INNER JOIN sections ON sections.id = plans.section_id
        UNION ALL
        SELECT plans.id, 'creator', plans.school_id, creators.school_id
          FROM intervention_plans AS plans
          INNER JOIN users AS creators ON creators.id = plans.created_by_user_id
        UNION ALL
        SELECT plans.id, 'term', plans.school_id, years.school_id
          FROM intervention_plans AS plans
          INNER JOIN academic_terms AS terms ON terms.id = plans.academic_term_id
          INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
        UNION ALL
        SELECT progress.id, 'progress', plans.school_id, users.school_id
          FROM intervention_progress_entries AS progress
          INNER JOIN intervention_plans AS plans ON plans.id = progress.intervention_plan_id
          INNER JOIN users ON users.id = progress.recorded_by_user_id
      ) AS records
      WHERE records.schoolId <> records.relatedSchoolId`
  },
  {
    name: 'school_form_template_publishers',
    area: 'school forms',
    description: 'Shared official templates may be published only by a platform administrator.',
    sql: `SELECT templates.id AS recordId, users.school_id AS userSchoolId, users.role
      FROM school_form_templates AS templates
      INNER JOIN users ON users.id = templates.published_by_user_id
      WHERE users.role <> 'platform_admin' OR users.school_id IS NOT NULL`
  },
  {
    name: 'school_form_exports',
    area: 'school forms',
    description: 'School-form export scope and requester must belong to the stored school.',
    sql: `SELECT exports.id AS recordId, exports.school_id AS schoolId,
        sections.school_id AS sectionSchoolId, years.school_id AS termSchoolId,
        users.school_id AS userSchoolId
      FROM school_form_exports AS exports
      LEFT JOIN sections ON sections.id = exports.section_id
      LEFT JOIN academic_terms AS terms ON terms.id = exports.academic_term_id
      LEFT JOIN academic_years AS years ON years.id = terms.academic_year_id
      INNER JOIN users ON users.id = exports.requested_by_user_id
      WHERE (exports.section_id IS NOT NULL AND sections.school_id <> exports.school_id)
        OR (exports.academic_term_id IS NOT NULL AND years.school_id <> exports.school_id)
        OR users.school_id <> exports.school_id`
  },
  {
    name: 'explicit_tenant_columns',
    area: 'database constraints',
    description: 'Explicit school ownership on relationship records must match their main parent record.',
    sql: `SELECT records.recordId, records.source, records.schoolId, records.parentSchoolId
      FROM (
        SELECT grade_levels.id AS recordId, 'school_grade_levels' AS source,
          grade_levels.school_id AS schoolId, levels.school_id AS parentSchoolId
          FROM school_grade_levels AS grade_levels
          INNER JOIN school_levels AS levels ON levels.id = grade_levels.school_level_id
        UNION ALL
        SELECT tracks.id, 'school_shs_tracks', tracks.school_id, levels.school_id
          FROM school_shs_tracks AS tracks
          INNER JOIN school_levels AS levels ON levels.id = tracks.school_level_id
        UNION ALL
        SELECT terms.id, 'academic_terms', terms.school_id, years.school_id
          FROM academic_terms AS terms
          INNER JOIN academic_years AS years ON years.id = terms.academic_year_id
        UNION ALL
        SELECT links.id, 'student_parent_links', links.school_id, students.school_id
          FROM student_parent_links AS links
          INNER JOIN users AS students ON students.id = links.student_user_id
        UNION ALL
        SELECT enrollments.id, 'section_students', enrollments.school_id, sections.school_id
          FROM section_students AS enrollments
          INNER JOIN sections ON sections.id = enrollments.section_id
        UNION ALL
        SELECT teachers.id, 'section_teachers', teachers.school_id, sections.school_id
          FROM section_teachers AS teachers
          INNER JOIN sections ON sections.id = teachers.section_id
        UNION ALL
        SELECT actions.id, 'academic_term_actions', actions.school_id, terms.school_id
          FROM academic_term_actions AS actions
          INNER JOIN academic_terms AS terms ON terms.id = actions.academic_term_id
        UNION ALL
        SELECT submissions.id, 'assignment_submissions', submissions.school_id, assignments.school_id
          FROM assignment_submissions AS submissions
          INNER JOIN assignments ON assignments.id = submissions.assignment_id
        UNION ALL
        SELECT items.id, 'grading_items', items.school_id, sections.school_id
          FROM grading_items AS items INNER JOIN sections ON sections.id = items.section_id
        UNION ALL
        SELECT scores.id, 'student_scores', scores.school_id, items.school_id
          FROM student_scores AS scores INNER JOIN grading_items AS items ON items.id = scores.grading_item_id
        UNION ALL
        SELECT records.id, 'attendance_records', records.school_id, sessions.school_id
          FROM attendance_records AS records
          INNER JOIN attendance_sessions AS sessions ON sessions.id = records.attendance_session_id
        UNION ALL
        SELECT credentials.id, 'student_qr_credentials', credentials.school_id, users.school_id
          FROM student_qr_credentials AS credentials
          INNER JOIN users ON users.id = credentials.student_user_id
        UNION ALL
        SELECT scans.id, 'qr_scan_events', scans.school_id, sessions.school_id
          FROM qr_scan_events AS scans
          INNER JOIN attendance_sessions AS sessions ON sessions.id = scans.attendance_session_id
        UNION ALL
        SELECT audiences.id, 'announcement_audiences', audiences.school_id, announcements.school_id
          FROM announcement_audiences AS audiences
          INNER JOIN announcements ON announcements.id = audiences.announcement_id
        UNION ALL
        SELECT announcement_read_rows.id, 'announcement_reads', announcement_read_rows.school_id, announcements.school_id
          FROM announcement_reads AS announcement_read_rows
          INNER JOIN announcements ON announcements.id = announcement_read_rows.announcement_id
        UNION ALL
        SELECT outbox.id, 'announcement_email_outbox', outbox.school_id, announcements.school_id
          FROM announcement_email_outbox AS outbox
          INNER JOIN announcements ON announcements.id = outbox.announcement_id
        UNION ALL
        SELECT prompts.id, 'journal_prompts', prompts.school_id, subjects.school_id
          FROM journal_prompts AS prompts
          INNER JOIN journal_subjects AS subjects ON subjects.id = prompts.journal_subject_id
        UNION ALL
        SELECT entries.id, 'student_journal_entries', entries.school_id, subjects.school_id
          FROM student_journal_entries AS entries
          INNER JOIN journal_subjects AS subjects ON subjects.id = entries.journal_subject_id
        UNION ALL
        SELECT feedback.id, 'journal_feedback', feedback.school_id, entries.school_id
          FROM journal_feedback AS feedback
          INNER JOIN student_journal_entries AS entries ON entries.id = feedback.journal_entry_id
        UNION ALL
        SELECT requests.id, 'report_reopen_requests', requests.school_id, reports.school_id
          FROM report_reopen_requests AS requests
          INNER JOIN narrative_reports AS reports ON reports.id = requests.narrative_report_id
        UNION ALL
        SELECT progress.id, 'intervention_progress_entries', progress.school_id, plans.school_id
          FROM intervention_progress_entries AS progress
          INNER JOIN intervention_plans AS plans ON plans.id = progress.intervention_plan_id
      ) AS records
      WHERE records.schoolId <> records.parentSchoolId`
  },
  {
    name: 'audit_log_actors',
    area: 'audit logs',
    description: 'A school audit actor must belong to that school unless it is a platform administrator.',
    sql: `SELECT logs.id AS recordId, logs.school_id AS schoolId,
        users.school_id AS userSchoolId, users.role
      FROM audit_logs AS logs
      INNER JOIN users ON users.id = logs.actor_user_id
      WHERE logs.school_id IS NOT NULL AND users.role <> 'platform_admin'
        AND users.school_id <> logs.school_id`
  }
];

async function runTenantIsolationAudit(database, sampleLimit = 20) {
  const checkedAt = new Date().toISOString();
  const checks = [];

  for (const check of TENANT_ISOLATION_CHECKS) {
    const [[countRow]] = await database.query(
      `SELECT COUNT(*) AS mismatchCount FROM (${check.sql}) AS tenant_mismatches`
    );
    const mismatchCount = Number(countRow.mismatchCount);
    let samples = [];
    if (mismatchCount) {
      [samples] = await database.query(`${check.sql} LIMIT ?`, [sampleLimit]);
    }
    checks.push({
      name: check.name,
      area: check.area,
      description: check.description,
      mismatchCount,
      samples
    });
  }

  return {
    checkedAt,
    checkCount: checks.length,
    totalMismatches: checks.reduce((total, check) => total + check.mismatchCount, 0),
    checks
  };
}

module.exports = { TENANT_ISOLATION_CHECKS, runTenantIsolationAudit };
