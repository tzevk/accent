#!/usr/bin/env node
/**
 * Seed mock multi-project activity data for Rahul Sharma so the Employee
 * Project Cost report (/reports/employee-project-cost) shows a consolidated
 * matrix across several projects.
 *
 * Dev-only credentials exercised by this data (dev DB — fine to keep here):
 *   admin@accent.test  / Admin@123   (super admin — used as assigned_by)
 *   rahul.sharma@accent.test / User@123   (employee user)
 *
 * What it does (idempotent — safe to re-run):
 *   For PROJ-001 … PROJ-004:
 *     1. Adds Rahul to the project team JSON (`projects.project_team`) when
 *        missing (same shape scripts/seed-proj005-mock.js uses).
 *     2. Find-or-creates the needed activity master rows
 *        (functions_master → activities_master → sub_activities).
 *     3. Inserts one `user_activity_assignments` row per activity with
 *        daily_entries spread over FY 2026–27 months (Apr–Aug 2026), giving
 *        the cost report a varied monthly matrix.
 *
 * Monthly hours added (this script): Apr 42 · May 46 · Jun 26 · Jul 32 · Aug 14
 *
 * Run: node scripts/seed-rahul-multi-project-cost.js
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

dotenv.config();

const ADMIN_EMAIL = 'admin@accent.test';
const RAHUL_EMAIL = 'rahul.sharma@accent.test';

// Discipline → activity → [sub-activity, default manhours]
const ACTIVITY_MASTER = {
	'Civil & Structural': {
		'Station Layout Drawings': [
			['Layout Drafting', 6],
			['Mark-up Updates', 3],
		],
	},
	'Project Management': {
		'Interdisciplinary Coordination': [
			['Coordination Meetings', 2],
			['Action Tracking', 1],
		],
	},
	Electrical: {
		'Cable Tray Routing': [
			['Tray Layouts', 5],
			['Support Marking', 3],
		],
		'Single Line Diagram Update': [['SLD Revision', 4]],
	},
	Structural: {
		'Structural Steel Take-off': [
			['Member Counting', 4],
			['Weight Estimation', 2],
		],
	},
	BIM: {
		'BIM Execution Plan': [['BEP Drafting', 6]],
	},
};

// Mock assignments grouped per target project. All dates are 2026 weekdays;
// hours land in FY 2026–27 months (Apr–Aug 2026).
const SEED_PLAN = [
	{
		projectCode: 'PROJ-001',
		role: 'Engineer',
		assignments: [
			{
				discipline: 'Civil & Structural',
				activity: 'Station Layout Drawings',
				subActivity: 'Layout Drafting',
				status: 'In Progress',
				priority: 'High',
				estimated_hours: 80,
				actual_hours: 56,
				qty_assigned: 40,
				qty_completed: 28,
				start_date: '2026-04-06',
				due_date: '2026-09-30',
				description: 'General arrangement layouts for stations A2–A4.',
				remarks: 'A4 platform level pending track loop freeze.',
				daily_entries: [
					{ date: '2026-04-06', hours: 8, qty_done: 2 },
					{ date: '2026-04-07', hours: 8, qty_done: 2 },
					{ date: '2026-04-08', hours: 8, qty_done: 2 },
					{ date: '2026-05-04', hours: 5, qty_done: 2 },
					{ date: '2026-05-05', hours: 5, qty_done: 2 },
					{ date: '2026-05-06', hours: 5, qty_done: 2 },
					{ date: '2026-05-07', hours: 5, qty_done: 2 },
					{ date: '2026-06-01', hours: 6, qty_done: 2 },
					{ date: '2026-06-02', hours: 6, qty_done: 2 },
				],
			},
			{
				discipline: 'Project Management',
				activity: 'Interdisciplinary Coordination',
				subActivity: 'Coordination Meetings',
				status: 'In Progress',
				priority: 'Medium',
				estimated_hours: 40,
				actual_hours: 24,
				qty_assigned: 12,
				qty_completed: 6,
				start_date: '2026-06-15',
				due_date: '2026-10-30',
				description: 'Weekly interface meetings with MEP and track teams.',
				remarks: '',
				daily_entries: [
					{ date: '2026-06-15', hours: 8, qty_done: 2 },
					{ date: '2026-07-06', hours: 8, qty_done: 2 },
					{ date: '2026-07-07', hours: 8, qty_done: 2 },
				],
			},
		],
	},
	{
		projectCode: 'PROJ-002',
		role: 'Engineer',
		assignments: [
			{
				discipline: 'Electrical',
				activity: 'Cable Tray Routing',
				subActivity: 'Tray Layouts',
				status: 'In Progress',
				priority: 'High',
				estimated_hours: 56,
				actual_hours: 44,
				qty_assigned: 30,
				qty_completed: 26,
				start_date: '2026-04-10',
				due_date: '2026-09-15',
				description: 'Power and control tray routing for the block-3 yard.',
				remarks: 'Vendor clamp sizes confirmed for sections C/D.',
				daily_entries: [
					{ date: '2026-04-10', hours: 8, qty_done: 4 },
					{ date: '2026-05-11', hours: 6, qty_done: 3 },
					{ date: '2026-05-12', hours: 6, qty_done: 3 },
					{ date: '2026-07-13', hours: 5, qty_done: 2 },
					{ date: '2026-07-14', hours: 5, qty_done: 2 },
					{ date: '2026-08-17', hours: 4, qty_done: 2 },
					{ date: '2026-08-18', hours: 4, qty_done: 2 },
					{ date: '2026-08-19', hours: 3, qty_done: 1 },
					{ date: '2026-08-20', hours: 3, qty_done: 1 },
				],
			},
			{
				discipline: 'Electrical',
				activity: 'Single Line Diagram Update',
				subActivity: 'SLD Revision',
				status: 'Completed',
				priority: 'Medium',
				estimated_hours: 12,
				actual_hours: 12,
				qty_assigned: 8,
				qty_completed: 8,
				start_date: '2026-05-18',
				due_date: '2026-06-26',
				completion_date: '2026-06-23 17:00:00',
				description: 'Rev-C SLD updates after transformer rating change.',
				remarks: 'Approved by client electrical lead.',
				daily_entries: [
					{ date: '2026-05-18', hours: 3, qty_done: 3 },
					{ date: '2026-05-19', hours: 3, qty_done: 2 },
					{ date: '2026-06-22', hours: 3, qty_done: 2 },
					{ date: '2026-06-23', hours: 3, qty_done: 1 },
				],
			},
		],
	},
	{
		projectCode: 'PROJ-003',
		role: 'Designer',
		assignments: [
			{
				discipline: 'Structural',
				activity: 'Structural Steel Take-off',
				subActivity: 'Member Counting',
				status: 'Completed',
				priority: 'Medium',
				estimated_hours: 18,
				actual_hours: 18,
				qty_assigned: 25,
				qty_completed: 25,
				start_date: '2026-04-13',
				due_date: '2026-05-29',
				completion_date: '2026-05-14 18:00:00',
				description: 'Steel take-off for the podium framing review model.',
				remarks: 'Weights handed to estimation team.',
				daily_entries: [
					{ date: '2026-04-13', hours: 5, qty_done: 9 },
					{ date: '2026-04-14', hours: 5, qty_done: 8 },
					{ date: '2026-05-13', hours: 4, qty_done: 5 },
					{ date: '2026-05-14', hours: 4, qty_done: 3 },
				],
			},
		],
	},
	{
		projectCode: 'PROJ-004',
		role: 'Team Member',
		assignments: [
			{
				discipline: 'BIM',
				activity: 'BIM Execution Plan',
				subActivity: 'BEP Drafting',
				status: 'On Hold',
				priority: 'Low',
				estimated_hours: 20,
				actual_hours: 6,
				qty_assigned: 5,
				qty_completed: 2,
				start_date: '2026-07-20',
				due_date: '2026-08-31',
				description: 'Draft internal BEP template v2 (ISO 19650 aligned).',
				remarks: 'On hold — pending HOD review of naming convention.',
				daily_entries: [{ date: '2026-07-20', hours: 6, qty_done: 2 }],
			},
		],
	},
];

async function main() {
	const conn = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT) || 3306,
		database: process.env.DEV_DB_NAME,
		user: process.env.DEV_DB_USER,
		password: process.env.DEV_DB_PASSWORD,
		dateStrings: true,
	});
	console.log(`Connected to ${process.env.DB_HOST}/${process.env.DEV_DB_NAME}`);

	try {
		// ── Resolve actors ──
		const [[admin]] = await conn.execute(
			'SELECT id, full_name FROM users WHERE email = ? AND isDelete = 0',
			[ADMIN_EMAIL]
		);
		if (!admin) throw new Error(`Admin user ${ADMIN_EMAIL} not found`);

		const [[rahul]] = await conn.execute(
			'SELECT id, employee_id, full_name FROM users WHERE email = ? AND isDelete = 0',
			[RAHUL_EMAIL]
		);
		if (!rahul) throw new Error(`User ${RAHUL_EMAIL} not found`);

		const [[rahulEmp]] = await conn.execute(
			'SELECT id, employee_id, department, position FROM employees WHERE id = ? AND isDelete = 0',
			[rahul.employee_id]
		);
		console.log(
			`Assigning to: ${rahul.full_name} (user #${rahul.id}, emp #${rahulEmp?.id})`
		);

		// ── Seed activity master (idempotent by name, mirrors proj005 script) ──
		const findOrCreateFunction = async (name) => {
			const [rows] = await conn.execute(
				'SELECT id FROM functions_master WHERE function_name = ?',
				[name]
			);
			if (rows.length > 0) return rows[0].id;
			const id = randomUUID();
			await conn.execute(
				'INSERT INTO functions_master (id, function_name, status) VALUES (?, ?, "active")',
				[id, name]
			);
			return id;
		};
		const findOrCreateActivity = async (functionId, name) => {
			const [rows] = await conn.execute(
				'SELECT id FROM activities_master WHERE function_id = ? AND activity_name = ?',
				[functionId, name]
			);
			if (rows.length > 0) return rows[0].id;
			const id = randomUUID();
			await conn.execute(
				'INSERT INTO activities_master (id, function_id, activity_name) VALUES (?, ?, ?)',
				[id, functionId, name]
			);
			return id;
		};
		const findOrCreateSubActivity = async (activityId, name, manhours) => {
			const [rows] = await conn.execute(
				'SELECT id FROM sub_activities WHERE activity_id = ? AND name = ?',
				[activityId, name]
			);
			if (rows.length > 0) return rows[0].id;
			const id = randomUUID().slice(0, 50);
			await conn.execute(
				'INSERT INTO sub_activities (id, activity_id, name, default_manhours) VALUES (?, ?, ?, ?)',
				[id, activityId, name, manhours]
			);
			return id;
		};

		const masterIds = {};
		for (const [fnName, activities] of Object.entries(ACTIVITY_MASTER)) {
			const fnId = await findOrCreateFunction(fnName);
			masterIds[fnName] = { fnId, activities: {} };
			for (const [actName, subs] of Object.entries(activities)) {
				const actId = await findOrCreateActivity(fnId, actName);
				masterIds[fnName].activities[actName] = { actId, subs: {} };
				for (const [subName, dmh] of subs) {
					masterIds[fnName].activities[actName].subs[subName] =
						await findOrCreateSubActivity(actId, subName, dmh);
				}
			}
		}
		console.log('✓ Activity master ready\n');

		// ── Per-project: team membership + assignments ──
		let inserted = 0;
		let skipped = 0;

		for (const plan of SEED_PLAN) {
			const [[project]] = await conn.execute(
				'SELECT project_id, project_code, project_team FROM projects WHERE project_code = ? AND isDelete = 0',
				[plan.projectCode]
			);
			if (!project) throw new Error(`Project ${plan.projectCode} not found`);

			// Team membership (ProjectTeamTab source)
			let team = [];
			try {
				team = project.project_team ? JSON.parse(project.project_team) : [];
			} catch {
				team = [];
			}
			if (!Array.isArray(team)) team = [];
			const alreadyMember = team.some(
				(m) => String(m?.id) === String(rahul.id) || m?.email === RAHUL_EMAIL
			);
			if (!alreadyMember) {
				team.push({
					id: rahul.id,
					employee_pk: rahulEmp?.id ?? rahul.employee_id,
					employee_code: rahulEmp?.employee_id || rahul.employee_id || null,
					account_type: 'employee',
					vendor_id: null,
					name: rahul.full_name,
					email: RAHUL_EMAIL,
					department: rahulEmp?.department || 'Engineering',
					position: rahulEmp?.position || 'Engineer',
					role: plan.role,
				});
				await conn.execute(
					'UPDATE projects SET project_team = ? WHERE project_id = ?',
					[JSON.stringify(team), project.project_id]
				);
				console.log(
					`${project.project_code}: added to project team (${team.length} members)`
				);
			}

			for (const a of plan.assignments) {
				const fnId = masterIds[a.discipline]?.fnId ?? null;
				const actRow = masterIds[a.discipline]?.activities?.[a.activity];
				const subId = actRow?.subs?.[a.subActivity] ?? null;
				if (!fnId || !actRow || !subId)
					throw new Error(
						`Master rows missing: ${a.discipline} / ${a.activity} / ${a.subActivity}`
					);

				const [existing] = await conn.execute(
					`SELECT id FROM user_activity_assignments
					 WHERE user_id = ? AND project_id = ? AND activity_id = ? AND sub_activity_name = ?`,
					[rahul.id, project.project_id, actRow.actId, a.subActivity]
				);
				if (existing.length > 0) {
					console.log(
						`${project.project_code}: exists — ${a.activity} / ${a.subActivity}`
					);
					skipped++;
					continue;
				}

				await conn.execute(
					`INSERT INTO user_activity_assignments
						(id, user_id, employee_id, project_id, activity_id, activity_name,
						 sub_activity_name, discipline_id, discipline_name, assigned_by,
						 due_date, priority, status, progress_percentage,
						 estimated_hours, actual_hours, default_manhours,
						 qty_assigned, qty_completed, start_date, completion_date,
						 daily_entries, description, notes, remarks)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						randomUUID(),
						rahul.id,
						rahulEmp?.id ?? rahul.employee_id,
						project.project_id,
						actRow.actId,
						a.activity,
						a.subActivity,
						fnId,
						a.discipline,
						admin.id,
						a.due_date,
						a.priority,
						a.status,
						a.qty_assigned > 0
							? Math.round((a.qty_completed / a.qty_assigned) * 100)
							: 0,
						a.estimated_hours,
						a.actual_hours,
						null,
						a.qty_assigned,
						a.qty_completed,
						a.start_date,
						a.completion_date || null,
						JSON.stringify(a.daily_entries),
						a.description,
						null,
						a.remarks,
					]
				);
				inserted++;
				console.log(
					`${project.project_code}: inserted — ${a.activity} / ${a.subActivity} (${a.status})`
				);
			}
		}

		console.log(
			`\nDone. ${inserted} assignment(s) inserted, ${skipped} already present.`
		);
		console.log('Open Reports → Employee Project Cost, pick Rahul Sharma.');
	} finally {
		await conn.end();
	}
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('Seed failed:', err.message);
		process.exit(1);
	});
