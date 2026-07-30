import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

/**
 * GET /api/projects/[id]/work-logs
 *
 * Returns user_activity_assignments for a given project, grouped by user
 * then by date — exploded from the daily_entries JSON column.
 *
 * Query params:
 *   start_date  – YYYY-MM-DD (optional, defaults to 30 days ago)
 *   end_date    – YYYY-MM-DD (optional, defaults to today)
 *   user_id     – filter to a single user (optional)
 */
export async function GET(request, { params }) {
	let db;
	try {
		const auth = await ensurePermission(
			request,
			RESOURCES.PROJECTS,
			PERMISSIONS.READ
		);
		if (auth instanceof NextResponse) return auth;

		const { id } = await params;
		const projectId = id;

		const { searchParams } = new URL(request.url);
		const endDate =
			searchParams.get('end_date') || new Date().toISOString().split('T')[0];
		const startDate =
			searchParams.get('start_date') ||
			new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
		const filterUserId = searchParams.get('user_id');

		db = await dbConnect();

		// Query user_activity_assignments joined with users
		let query = `
      SELECT
        uaa.id,
        uaa.user_id,
        uaa.activity_name,
        uaa.discipline_name,
        uaa.daily_entries,
        uaa.status,
        uaa.priority,
        uaa.description,
        uaa.estimated_hours,
        uaa.actual_hours,
        uaa.qty_assigned,
        uaa.qty_completed,
        u.full_name,
        u.username,
        u.email
      FROM user_activity_assignments uaa
      LEFT JOIN users u ON uaa.user_id = u.id
      WHERE uaa.project_id = ?
    `;
		const queryParams = [projectId];

		if (filterUserId) {
			query += ' AND uaa.user_id = ?';
			queryParams.push(filterUserId);
		}

		query += ' ORDER BY u.full_name ASC, uaa.activity_name ASC';

		const [rows] = await db.execute(query, queryParams);

		// ---------- group by user → then by date ----------
		// Parse daily_entries JSON per row and explode each entry into a "log"
		const userMap = {};

		for (const row of rows) {
			const uid = row.user_id;
			if (!userMap[uid]) {
				userMap[uid] = {
					user_id: uid,
					full_name: row.full_name || row.username || `User #${uid}`,
					username: row.username,
					email: row.email,
					dates: {},
					total_logs: 0,
					total_time_minutes: 0,
				};
			}

			// Parse daily_entries JSON
			let entries = [];
			if (row.daily_entries) {
				try {
					entries =
						typeof row.daily_entries === 'string'
							? JSON.parse(row.daily_entries)
							: row.daily_entries;
				} catch {
					entries = [];
				}
			}
			if (!Array.isArray(entries)) entries = [];

			for (const entry of entries) {
				if (!entry || typeof entry !== 'object') continue;

				const entryDate = entry.date || null;
				if (!entryDate) continue;

				// Filter by date range in JS (daily_entries is a JSON blob)
				if (entryDate < startDate || entryDate > endDate) continue;

				const dateStr = entryDate;

				if (!userMap[uid].dates[dateStr]) {
					userMap[uid].dates[dateStr] = {
						date: dateStr,
						logs: [],
						day_time_minutes: 0,
						day_qty_total: 0,
					};
				}
				const timeMinutes = Math.round(parseFloat(entry.hours || 0) * 60);

				const priority = (row.priority || 'medium').toLowerCase();
				const status = (row.status || '').toLowerCase();

				userMap[uid].dates[dateStr].logs.push({
					id: row.id,
					log_type: 'activity',
					title: row.activity_name || 'Untitled',
					description: entry.remarks || '',
					category: row.discipline_name || '',
					priority,
					status,
					time_spent: timeMinutes,
					time_minutes: timeMinutes,
					qty_done: entry.qty_done != null ? entry.qty_done : null,
					created_at: entryDate,
				});

				userMap[uid].dates[dateStr].day_time_minutes += timeMinutes;
				if (
					entry.qty_done != null &&
					entry.qty_done !== '' &&
					!Number.isNaN(Number(entry.qty_done))
				) {
					userMap[uid].dates[dateStr].day_qty_total +=
						Number(entry.qty_done) || 0;
				}
				userMap[uid].total_logs += 1;
				userMap[uid].total_time_minutes += timeMinutes;
			}
		}

		// Convert dates object to sorted array per user
		const grouped = Object.values(userMap).map((u) => ({
			...u,
			dates: Object.values(u.dates).sort((a, b) => (b.date > a.date ? 1 : -1)),
		}));

		// Sort users alphabetically
		grouped.sort((a, b) =>
			(a.full_name || '').localeCompare(b.full_name || '')
		);

		// Compute total log count across all users
		const totalLogs = grouped.reduce((sum, u) => sum + u.total_logs, 0);

		// Compute grand total quantity across all users (sum of all day_qty_total)
		const totalQty = grouped.reduce(
			(sum, u) =>
				sum + (u.dates || []).reduce((s, d) => s + (d.day_qty_total || 0), 0),
			0
		);

		return NextResponse.json({
			success: true,
			data: {
				project_id: projectId,
				start_date: startDate,
				end_date: endDate,
				total_logs: totalLogs,
				total_qty: totalQty,
				users: grouped,
			},
		});
	} catch (error) {
		console.error('Error fetching project work logs:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch project work logs' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
