#!/usr/bin/env node
/**
 * Seed mock activity data for PROJ-005 (Gujarat Refinery - Piping Flexibility).
 *
 * Dev-only credentials exercised by this data (dev DB — fine to keep here):
 *   admin@accent.test  / Admin@123   (super admin, user id 88)
 *   rahul.sharma@accent.test / User@123   (employee user, id 89)
 *
 * What it does (idempotent — safe to re-run):
 *   1. Adds Rahul Sharma to the PROJ-005 project team JSON (`projects.project_team`).
 *   2. Seeds the activity master (functions → activities → sub-activities) when empty.
 *   3. Inserts mock `user_activity_assignments` rows for Rahul on PROJ-005,
 *      including April 2026 daily entries so the manhours-billing report has
 *      April data.
 *
 * Run: node scripts/seed-proj005-mock.js
 */
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

dotenv.config();

const PROJECT_CODE = 'PROJ-005';
const ADMIN_EMAIL = 'admin@accent.test';
const RAHUL_EMAIL = 'rahul.sharma@accent.test';

// Discipline → activity → [sub-activity, default manhours]
const ACTIVITY_MASTER = {
	Piping: {
		'Pipe Routing': [
			['Process Lines Routing', 6],
			['Utility Lines Routing', 4],
		],
		'Isometric Drawings': [
			['Stress Iso Extraction', 2],
			['Fabrication Iso', 3],
		],
	},
	'Stress Analysis': {
		'Flexibility Analysis': [
			['Critical Line Selection', 4],
			['CAESAR II Modelling', 8],
			['Stress Report Preparation', 3],
		],
		'Pipe Support Design': [
			['Standard Support Selection', 3],
			['Special Support Design', 6],
		],
	},
	'Civil & Structural': {
		'Equipment Foundation': [
			['Foundation Sizing', 5],
			['Reinforcement Detailing', 6],
		],
	},
};

// date helper — YYYY-MM-DD in local time
const d = (str) => str;

// Mock assignments for Rahul on PROJ-005. activity/sub-activity names must
// exist in ACTIVITY_MASTER above. daily_entries include April 2026 so the
// manhours-billing report's April has assignment-backed hours.
const MOCK_ASSIGNMENTS = [
	{
		discipline: 'Stress Analysis',
		activity: 'Flexibility Analysis',
		subActivity: 'CAESAR II Modelling',
		status: 'In Progress',
		priority: 'High',
		estimated_hours: 40,
		actual_hours: 30,
		qty_assigned: 20,
		qty_completed: 12,
		start_date: '2026-04-06',
		due_date: '2026-04-30',
		description: 'Stress-critical lines loop 100–140 flexibility checks.',
		remarks: 'Loops 120/130 pending client nozzle data.',
		daily_entries: [
			{ date: d('2026-04-06'), hours: 8, qty_done: 2 },
			{ date: d('2026-04-07'), hours: 8, qty_done: 2 },
			{ date: d('2026-04-08'), hours: 7.5, qty_done: 1 },
			{ date: d('2026-04-09'), hours: 8, qty_done: 2 },
			{ date: d('2026-04-10'), hours: 6.5, qty_done: 1 },
			{ date: d('2026-04-13'), hours: 8, qty_done: 2 },
			{ date: d('2026-04-14'), hours: 8, qty_done: 1 },
			{ date: d('2026-04-15'), hours: 7.5, qty_done: 1 },
		],
	},
	{
		discipline: 'Stress Analysis',
		activity: 'Flexibility Analysis',
		subActivity: 'Critical Line Selection',
		status: 'Completed',
		priority: 'Medium',
		estimated_hours: 12,
		actual_hours: 11,
		qty_assigned: 18,
		qty_completed: 18,
		start_date: '2026-03-09',
		due_date: '2026-03-20',
		completion_date: '2026-03-19 16:30:00',
		description: 'Shortlist stress-critical lines from P&IDs rev B.',
		remarks: 'Signed off by lead.',
		daily_entries: [
			{ date: d('2026-03-16'), hours: 6, qty_done: 9 },
			{ date: d('2026-03-17'), hours: 5, qty_done: 9 },
		],
	},
	{
		discipline: 'Piping',
		activity: 'Pipe Routing',
		subActivity: 'Process Lines Routing',
		status: 'In Progress',
		priority: 'Medium',
		estimated_hours: 60,
		actual_hours: 24,
		qty_assigned: 80,
		qty_completed: 30,
		start_date: '2026-07-20',
		due_date: '2026-08-31',
		description: 'Route process lines for the naphtha treatment unit.',
		remarks: '',
		daily_entries: [
			{ date: new Date().toISOString().split('T')[0], hours: 4, qty_done: 3 },
		],
	},
	{
		discipline: 'Piping',
		activity: 'Isometric Drawings',
		subActivity: 'Fabrication Iso',
		status: 'Not Started',
		priority: 'Low',
		estimated_hours: 24,
		actual_hours: 0,
		qty_assigned: 25,
		qty_completed: 0,
		start_date: null,
		due_date: '2026-09-15',
		description: 'Fabrication isos for approved stress lines.',
		remarks: '',
		daily_entries: [],
	},
	{
		discipline: 'Stress Analysis',
		activity: 'Pipe Support Design',
		subActivity: 'Standard Support Selection',
		status: 'On Hold',
		priority: 'Medium',
		estimated_hours: 16,
		actual_hours: 5,
		qty_assigned: 10,
		qty_completed: 4,
		start_date: '2026-05-04',
		due_date: '2026-05-15',
		description: 'Select standard supports from company catalogue.',
		remarks: 'On hold — awaiting spring hanger vendor data.',
		daily_entries: [{ date: d('2026-05-04'), hours: 5, qty_done: 4 }],
	},
];

async function main() {
	const env = process.env.NODE_ENV || 'development';
	const conn = await mysql.createConnection({
		host: process.env.DB_HOST,
		port: Number(process.env.DB_PORT) || 3306,
		database: process.env.DEV_DB_NAME,
		user: process.env.DEV_DB_USER,
		password: process.env.DEV_DB_PASSWORD,
		dateStrings: true,
	});
	console.log(
		`Connected to ${process.env.DB_HOST}/${process.env.DEV_DB_NAME} (env=${env})`
	);

	try {
		// ── Resolve actors ──
		const [[project]] = await conn.execute(
			'SELECT project_id, project_code, name FROM projects WHERE project_code = ? AND isDelete = 0',
			[PROJECT_CODE]
		);
		if (!project) throw new Error(`Project ${PROJECT_CODE} not found`);

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

		console.log(`Project: ${project.project_code} (#${project.project_id})`);
		console.log(`Assigning to: ${rahul.full_name} (user #${rahul.id})`);

		// ── 1. Add Rahul to the project team JSON ──
		const [[projRow]] = await conn.execute(
			'SELECT project_team FROM projects WHERE project_id = ?',
			[project.project_id]
		);
		let team = [];
		try {
			team = projRow.project_team ? JSON.parse(projRow.project_team) : [];
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
				employee_id: rahulEmp?.employee_id || rahul.employee_id,
				employee_pk: rahul.employee_id,
				employee_code: rahulEmp?.employee_id || null,
				account_type: 'employee',
				vendor_id: null,
				name: rahul.full_name,
				email: RAHUL_EMAIL,
				department: rahulEmp?.department || 'Engineering',
				position: rahulEmp?.position || 'Engineer',
				role: 'Engineer',
			});
			await conn.execute(
				'UPDATE projects SET project_team = ? WHERE project_id = ?',
				[JSON.stringify(team), project.project_id]
			);
			console.log(
				`✓ Added ${rahul.full_name} to project team (${team.length} members)`
			);
		} else {
			console.log(`• ${rahul.full_name} already in project team`);
		}

		// ── 2. Seed activity master (idempotent by name) ──
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
		const findOrCreateSubActivity = async (
			activityId,
			name,
			defaultManhours
		) => {
			const [rows] = await conn.execute(
				'SELECT id FROM sub_activities WHERE activity_id = ? AND name = ?',
				[activityId, name]
			);
			if (rows.length > 0) return rows[0].id;
			const id = randomUUID().slice(0, 50);
			await conn.execute(
				'INSERT INTO sub_activities (id, activity_id, name, default_manhours) VALUES (?, ?, ?, ?)',
				[id, activityId, name, defaultManhours]
			);
			return id;
		};

		const masterIds = {};
		for (const [fnName, activities] of Object.entries(ACTIVITY_MASTER)) {
			const fnId = await findOrCreateFunction(fnName);
			masterIds[fnName] = {};
			for (const [actName, subs] of Object.entries(activities)) {
				const actId = await findOrCreateActivity(fnId, actName);
				masterIds[fnName][actName] = { id: actId, subs: {} };
				for (const [subName, dmh] of subs) {
					masterIds[fnName][actName].subs[subName] =
						await findOrCreateSubActivity(actId, subName, dmh);
				}
			}
		}
		console.log(
			'✓ Activity master ready (functions/activities/sub-activities)'
		);

		// ── 3. Insert mock assignments for Rahul on PROJ-005 ──
		let inserted = 0;
		for (const a of MOCK_ASSIGNMENTS) {
			const fnId = masterIds[a.discipline]?.id ?? null;
			const act = masterIds[a.discipline]?.[a.activity] ?? null;
			if (!act)
				throw new Error(
					`Master activity missing: ${a.discipline} / ${a.activity}`
				);

			const [existing] = await conn.execute(
				'SELECT id FROM user_activity_assignments WHERE user_id = ? AND project_id = ? AND activity_id = ?',
				[rahul.id, project.project_id, act.id]
			);
			if (existing.length > 0) {
				console.log(`• Assignment exists: ${a.activity} / ${a.subActivity}`);
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
					rahul.employee_id,
					project.project_id,
					act.id,
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
			console.log(`✓ Assigned: ${a.activity} / ${a.subActivity} (${a.status})`);
		}
		console.log(`\nDone. ${inserted} assignment(s) inserted.`);
		console.log(
			'Dev logins — admin@accent.test / Admin@123 · rahul.sharma@accent.test / User@123'
		);
	} finally {
		await conn.end();
	}
}

main().catch((err) => {
	console.error('Seed failed:', err.message);
	process.exit(1);
});
