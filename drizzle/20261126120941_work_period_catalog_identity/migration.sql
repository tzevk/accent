-- Project Activity UUIDs and Activity Master identities are separate. Existing
-- rows remain nullable and may use the explicit, unambiguous label fallback in
-- the Work Period command; new catalog-backed assignments persist all three
-- stable master identifiers.
ALTER TABLE `user_activity_assignments`
  ADD COLUMN `catalog_activity_id` char(36)
    CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL
    AFTER `discipline_id`,
  ADD COLUMN `catalog_sub_activity_id` varchar(50)
    CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci DEFAULT NULL
    AFTER `catalog_activity_id`,
  ADD KEY `idx_user_project_catalog_identity`
    (`user_id`, `project_id`, `catalog_activity_id`, `catalog_sub_activity_id`),
  ADD CONSTRAINT `user_activity_assignments_catalog_activity_fk`
    FOREIGN KEY (`catalog_activity_id`) REFERENCES `activities_master` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `user_activity_assignments_catalog_sub_activity_fk`
    FOREIGN KEY (`catalog_sub_activity_id`) REFERENCES `sub_activities` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;