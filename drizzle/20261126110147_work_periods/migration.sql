-- Recorded Work Periods are authoritative intervals. Legacy duration-only
-- daily_entries remain untouched. The nullable projection is derived only by
-- refreshWorkPeriodEntries; canonical periods survive stale project saves and
-- the projection can always be rebuilt from them.
CREATE TABLE IF NOT EXISTS `work_periods` (
  `id` varchar(36) NOT NULL,
  `assignment_id` varchar(36) NOT NULL,
  `employee_id` int(11) NOT NULL,
  `start_ms` bigint(20) NOT NULL,
  `end_ms` bigint(20) NOT NULL,
  `date_completed` date NOT NULL,
  `quantity` decimal(10,2) NOT NULL,
  `remarks` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_work_periods_employee_interval` (`employee_id`, `start_ms`, `end_ms`),
  KEY `idx_work_periods_assignment` (`assignment_id`),
  KEY `idx_work_periods_date_completed` (`date_completed`),
  CONSTRAINT `work_periods_assignment_fk`
    FOREIGN KEY (`assignment_id`) REFERENCES `user_activity_assignments` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `work_periods_employee_fk`
    FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `work_periods_positive_interval` CHECK (`end_ms` > `start_ms`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
--> statement-breakpoint

ALTER TABLE `user_activity_assignments`
  ADD COLUMN `work_period_entries` longtext
    CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL
    AFTER `daily_entries`,
  ADD CONSTRAINT `user_activity_assignments_work_period_entries_json`
    CHECK (JSON_VALID(`work_period_entries`));
--> statement-breakpoint

-- Read-only compatibility surface. With no Work Period projection, the raw
-- legacy payload is exposed verbatim, including NULL, malformed JSON and
-- non-array JSON. Once a projection exists, only a valid legacy array is
-- merged; an invalid legacy payload can never hide derived Work Period time.
-- actual_hours and all estimate/assignment columns remain their base values.
CREATE OR REPLACE VIEW `logged_activity_assignments` AS
SELECT
  uaa.`id`,
  uaa.`user_id`,
  uaa.`employee_id`,
  uaa.`project_id`,
  uaa.`activity_id`,
  uaa.`activity_name`,
  uaa.`sub_activity_name`,
  uaa.`discipline_id`,
  uaa.`discipline_name`,
  uaa.`assigned_by`,
  uaa.`assigned_date`,
  uaa.`due_date`,
  uaa.`priority`,
  uaa.`status`,
  uaa.`progress_percentage`,
  uaa.`estimated_hours`,
  uaa.`default_manhours`,
  uaa.`actual_hours`,
  uaa.`notes`,
  uaa.`remarks`,
  uaa.`completion_date`,
  uaa.`created_at`,
  uaa.`updated_at`,
  uaa.`qty_assigned`,
  uaa.`qty_completed`,
  uaa.`start_date`,
  uaa.`description`,
  uaa.`work_period_entries`,
  uaa.`daily_entries` AS `legacy_daily_entries`,
  CASE
    WHEN uaa.`work_period_entries` IS NULL THEN uaa.`daily_entries`
    WHEN JSON_VALID(uaa.`daily_entries`) THEN
      CASE
        WHEN JSON_TYPE(uaa.`daily_entries`) = 'ARRAY'
          THEN JSON_MERGE_PRESERVE(uaa.`daily_entries`, uaa.`work_period_entries`)
        ELSE uaa.`work_period_entries`
      END
    ELSE uaa.`work_period_entries`
  END AS `daily_entries`
FROM `user_activity_assignments` AS uaa;