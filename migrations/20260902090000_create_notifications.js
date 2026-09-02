/**
 * Notifications — in-app notification feed.
 *
 * v1 scope: leave-request alerts to approvers (super_admin or leaves:approve
 * holders). Recipients are resolved at insert time by the producer
 * (src/utils/notifications.js); the API + bell UI consume per-user rows.
 */

export async function up(knex) {
	await knex.raw(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL COMMENT 'Recipient (users.id)',
      type VARCHAR(30) NOT NULL DEFAULT 'leave_request'
        COMMENT 'Producer-defined notification kind',
      title VARCHAR(255) NOT NULL,
      body VARCHAR(500) DEFAULT NULL,
      link VARCHAR(255) DEFAULT NULL COMMENT 'Frontend route to open on click',
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      isDelete TINYINT(1) NOT NULL DEFAULT 0,
      deleted_at TIMESTAMP NULL DEFAULT NULL,
      KEY idx_notifications_user (user_id, isDelete, is_read),
      KEY idx_notifications_user_created (user_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function down(knex) {
	await knex.schema.dropTableIfExists('notifications');
}
