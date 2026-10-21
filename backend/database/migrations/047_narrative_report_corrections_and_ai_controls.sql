USE academix;

ALTER TABLE narrative_reports
  ADD COLUMN pending_correction BOOLEAN NOT NULL DEFAULT FALSE AFTER released_at;

ALTER TABLE school_portal_features
  ADD COLUMN ai_evidence_approved_at DATETIME NULL AFTER narrative_reports_enabled,
  ADD COLUMN ai_evidence_approved_by_user_id BIGINT UNSIGNED NULL AFTER ai_evidence_approved_at;

CREATE TABLE IF NOT EXISTS narrative_report_releases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  narrative_report_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  summary TEXT NOT NULL,
  parent_actions JSON NOT NULL,
  released_at DATETIME NOT NULL,
  released_by_user_id BIGINT UNSIGNED NULL,
  released_by_name VARCHAR(255) NOT NULL,
  UNIQUE KEY uq_narrative_release_version (school_id, narrative_report_id, version_number),
  KEY idx_narrative_release_latest (narrative_report_id, version_number),
  CONSTRAINT fk_narrative_release_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT,
  CONSTRAINT fk_narrative_release_report FOREIGN KEY (narrative_report_id) REFERENCES narrative_reports(id) ON DELETE RESTRICT,
  CONSTRAINT fk_narrative_release_adviser FOREIGN KEY (released_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_report_daily_usage (
  school_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  call_count INT UNSIGNED NOT NULL DEFAULT 0,
  input_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  output_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, usage_date),
  CONSTRAINT fk_ai_report_usage_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ai_report_daily_errors (
  school_id BIGINT UNSIGNED NOT NULL,
  usage_date DATE NOT NULL,
  error_category VARCHAR(40) NOT NULL,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, usage_date, error_category),
  CONSTRAINT fk_ai_report_errors_school FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

SET SESSION group_concat_max_len = 16384;

INSERT INTO narrative_report_releases
  (school_id, narrative_report_id, version_number, summary, parent_actions, released_at, released_by_user_id, released_by_name)
SELECT reports.school_id, reports.id, 1,
  COALESCE(reports.teacher_edited_summary, reports.generated_summary),
  CONCAT('[', COALESCE((
    SELECT GROUP_CONCAT(JSON_QUOTE(actions.recommendation_text) ORDER BY actions.display_order SEPARATOR ',')
    FROM report_recommendations AS actions WHERE actions.narrative_report_id = reports.id
  ), ''), ']'),
  reports.released_at,
  COALESCE((
    SELECT log.actor_user_id FROM audit_logs AS log
    WHERE log.school_id = reports.school_id AND log.entity_type = 'narrative_reports'
      AND log.entity_id = reports.id AND log.action_type = 'narrative_report_released_to_parents'
    ORDER BY log.id DESC LIMIT 1
  ), reports.teacher_user_id),
  COALESCE(advisers.display_name, 'Adviser')
FROM narrative_reports AS reports
LEFT JOIN users AS advisers ON advisers.id = COALESCE((
  SELECT log.actor_user_id FROM audit_logs AS log
  WHERE log.school_id = reports.school_id AND log.entity_type = 'narrative_reports'
    AND log.entity_id = reports.id AND log.action_type = 'narrative_report_released_to_parents'
  ORDER BY log.id DESC LIMIT 1
), reports.teacher_user_id) AND advisers.school_id = reports.school_id
WHERE reports.report_status = 'confirmed' AND reports.released_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM narrative_report_releases AS existing
    WHERE existing.school_id = reports.school_id AND existing.narrative_report_id = reports.id
      AND existing.version_number = 1
  );

CREATE TRIGGER narrative_release_no_update BEFORE UPDATE ON narrative_report_releases
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be changed';

CREATE TRIGGER narrative_release_no_delete BEFORE DELETE ON narrative_report_releases
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Released report snapshots cannot be deleted';
