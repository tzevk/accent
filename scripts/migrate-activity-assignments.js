#!/usr/bin/env node

/**
 * One-time migration: copies user assignment data from
 * projects.project_activities_list JSON blobs into the normalized
 * user_activity_assignments table.
 *
 * Usage: node scripts/migrate-activity-assignments.js
 */

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

dotenv.config();

const env = process.env.NODE_ENV || 'development';
const dbConfig = {
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT) || 3306,
	dateStrings: true,
};

if (env === 'production') {
	dbConfig.database = process.env.PROD_DB_NAME;
	dbConfig.user = process.env.PROD_DB_USER;
	dbConfig.password = process.env.PROD_DB_PASSWORD;
} else if (env === 'staging') {
	dbConfig.database = process.env.STAGING_DB_NAME;
	dbConfig.user = process.env.STAGING_DB_USER;
	dbConfig.password = process.env.STAGING_DB_PASSWORD;
} else {
	dbConfig.database = process.env.DEV_DB_NAME;
	dbConfig.user = process.env.DEV_DB_USER;
	dbConfig.password = process.env.DEV_DB_PASSWORD;
}

const UPSERT_SQL = `
INSERT INTO user_activity_assignments (
  id, user_id, project_id, activity_id,
  activity_name, discipline_name, sub_activity_name,
  description, due_date, start_date,
  status, estimated_hours, actual_hours,
  qty_assigned, qty_completed,
  notes, remarks, default_manhours,
  progress_percentage, daily_entries,
  assigned_date, created_at, updated_at
) VALUES (
  ?, ?, ?, ?,
  ?, ?, ?,
  ?, ?, ?,
  ?, ?, ?,
  ?, ?,
  ?, ?, ?,
  ?, ?,
  NOW(), NOW(), NOW()
)
ON DUPLICATE KEY UPDATE
  activity_name = VALUES(activity_name),
  discipline_name = VALUES(discipline_name),
  sub_activity_name = VALUES(sub_activity_name),
  description = VALUES(description),
  due_date = VALUES(due_date),
  start_date = VALUES(start_date),
  status = VALUES(status),
  estimated_hours = VALUES(estimated_hours),
  actual_hours = VALUES(actual_hours),
  qty_assigned = VALUES(qty_assigned),
  qty_completed = VALUES(qty_completed),
  notes = VALUES(notes),
  remarks = VALUES(remarks),
  default_manhours = VALUES(default_manhours),
  progress_percentage = VALUES(progress_percentage),
  daily_entries = VALUES(daily_entries),
  updated_at = NOW()
`;

async function main() {
	let connection;
	const stats = {
		projectsProcessed: 0,
		activitiesProcessed: 0,
		assignmentsInserted: 0,
		assignmentsUpdated: 0,
		skippedInvalidUserId: 0,
		skippedMissingActivityId: 0,
		errors: 0,
	};

	try {
		console.log('Connecting to database...');
		connection = await mysql.createConnection(dbConfig);
		console.log('Connected.');

		// Fetch valid user IDs for validation
		const [users] = await connection.execute('SELECT id FROM users');
		const validUserIds = new Set(users.map((u) => u.id));
		console.log(`Loaded ${validUserIds.size} valid user IDs.`);

		// Fetch all projects with non-empty project_activities_list
		const [projects] = await connection.execute(
			`SELECT project_id, project_activities_list
       FROM projects
       WHERE project_activities_list IS NOT NULL
         AND project_activities_list != ''
         AND project_activities_list != '[]'`
		);
		console.log(`Found ${projects.length} projects with activity data.`);

		for (const project of projects) {
			const projectId = project.project_id;
			let activitiesList;

			try {
				activitiesList =
					typeof project.project_activities_list === 'string'
						? JSON.parse(project.project_activities_list)
						: project.project_activities_list;
			} catch {
				console.warn(
					`  [WARN] Project ${projectId}: unparseable activities, skipping`
				);
				stats.errors++;
				continue;
			}

			if (!Array.isArray(activitiesList) || activitiesList.length === 0) {
				continue;
			}

			stats.projectsProcessed++;

			for (const activity of activitiesList) {
				stats.activitiesProcessed++;

				let activityId = activity.id || activity.activity_id;
				if (!activityId) {
					// Generate UUID for activities missing an ID
					activityId = randomUUID();
					stats.skippedMissingActivityId++;
				}

				const activityName = activity.activity_name || activity.name || '';
				const disciplineName =
					activity.function_name || activity.discipline || '';
				const subActivityName = activity.sub_activity_name || '';
				const defaultManhours = parseFloat(activity.default_manhours) || 0;

				// Collect all assignments from both formats
				const assignments = [];

				// Multi-user format
				if (Array.isArray(activity.assigned_users)) {
					for (const u of activity.assigned_users) {
						const userData = typeof u === 'object' ? u : { user_id: u };
						assignments.push(userData);
					}
				}

				// Old single-user format
				if (
					activity.assigned_user &&
					activity.assigned_user !== '' &&
					activity.assigned_user !== null
				) {
					const uid = parseInt(activity.assigned_user);
					if (!isNaN(uid) && uid > 0) {
						// Check not already in multi-user list
						const alreadyPresent = assignments.some(
							(a) => parseInt(a.user_id) === uid
						);
						if (!alreadyPresent) {
							assignments.push({
								user_id: uid,
								qty_assigned: 0,
								qty_completed: 0,
								planned_hours: 0,
								actual_hours: 0,
								status: 'Not Started',
								remarks: '',
								notes: activity.deliverables || activity.remarks || '',
								description: '',
								start_date: null,
								due_date: activity.due_date || null,
								progress_percentage: 0,
								daily_entries: null,
							});
						}
					}
				}

				for (const userData of assignments) {
					const userId = parseInt(userData.user_id);
					if (isNaN(userId) || userId <= 0) {
						stats.skippedInvalidUserId++;
						console.warn(
							`  [WARN] Project ${projectId}, activity ${activityId}: invalid user_id "${userData.user_id}", skipping`
						);
						continue;
					}
					if (!validUserIds.has(userId)) {
						stats.skippedInvalidUserId++;
						console.warn(
							`  [WARN] Project ${projectId}, activity ${activityId}: user_id ${userId} not in users table, skipping`
						);
						continue;
					}

					const dailyEntries = userData.daily_entries
						? typeof userData.daily_entries === 'string'
							? userData.daily_entries
							: JSON.stringify(userData.daily_entries)
						: null;

					const params = [
						randomUUID(), // id
						userId,
						projectId,
						String(activityId),
						activityName,
						disciplineName,
						subActivityName || null,
						userData.description || '',
						userData.due_date || null,
						userData.start_date || null,
						userData.status || 'Not Started',
						parseFloat(userData.planned_hours) || 0,
						parseFloat(userData.actual_hours) || 0,
						parseFloat(userData.qty_assigned) || 0,
						parseFloat(userData.qty_completed) || 0,
						userData.notes || '',
						userData.remarks || '',
						defaultManhours,
						parseFloat(userData.progress_percentage) || 0,
						dailyEntries,
					];

					try {
						const [result] = await connection.execute(UPSERT_SQL, params);
						if (result.affectedRows === 1) {
							stats.assignmentsInserted++;
						} else if (result.affectedRows === 2) {
							// MySQL ON DUPLICATE KEY UPDATE returns 2 for updates
							stats.assignmentsUpdated++;
						} else {
							stats.assignmentsInserted++;
						}
					} catch (err) {
						stats.errors++;
						console.error(
							`  [ERROR] Project ${projectId}, activity ${activityId}, user ${userId}: ${err.message}`
						);
					}
				}
			}
		}

		// Stats summary
		console.log('\n--- Migration Summary ---');
		console.log(`Projects processed:      ${stats.projectsProcessed}`);
		console.log(`Activities processed:    ${stats.activitiesProcessed}`);
		console.log(`Assignments inserted:    ${stats.assignmentsInserted}`);
		console.log(`Assignments updated:     ${stats.assignmentsUpdated}`);
		console.log(`Skipped (invalid user):  ${stats.skippedInvalidUserId}`);
		console.log(`Missing activity IDs:    ${stats.skippedMissingActivityId}`);
		console.log(`Errors:                  ${stats.errors}`);

		// Verification query
		const [countResult] = await connection.execute(
			'SELECT COUNT(*) AS cnt FROM user_activity_assignments'
		);
		console.log(
			`\nTotal rows in user_activity_assignments: ${countResult[0].cnt}`
		);
	} catch (error) {
		console.error('Fatal error:', error);
		process.exit(1);
	} finally {
		if (connection) await connection.end();
	}
}

main();
