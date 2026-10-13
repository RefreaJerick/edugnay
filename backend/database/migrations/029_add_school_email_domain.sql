-- Before applying: run scripts/auditSchoolEmailDomains.js and create a verified database backup.
-- Stop if the audit reports mixed domains within a school or a domain shared by schools.
-- Existing account addresses are not changed.
ALTER TABLE schools ADD COLUMN school_email_domain VARCHAR(253) NULL;

UPDATE schools AS schools
JOIN (
  SELECT school_id, LOWER(SUBSTRING_INDEX(MIN(school_email), '@', -1)) AS domain
  FROM users
  WHERE school_id IS NOT NULL
  GROUP BY school_id
  HAVING COUNT(DISTINCT LOWER(SUBSTRING_INDEX(school_email, '@', -1))) = 1
) AS existing ON existing.school_id = schools.id
SET schools.school_email_domain = existing.domain;

-- Preserve the known Mangaldan pilot's concise domain if it has no account addresses yet.
UPDATE schools SET school_email_domain = 'mnhs.academix.test'
WHERE school_code = 'manghi' AND school_email_domain IS NULL;

UPDATE schools
SET school_email_domain = CONCAT('school-', id, '.academix.test')
WHERE school_email_domain IS NULL;

ALTER TABLE schools MODIFY school_email_domain VARCHAR(253) NOT NULL;
ALTER TABLE schools ADD UNIQUE KEY uq_schools_school_email_domain (school_email_domain);
