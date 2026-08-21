#!/usr/bin/env node
// Verify PROJ-005 mock seed results. Read-only.
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const conn = await mysql.createConnection({
	host: process.env.DB_HOST,
	port: Number(process.env.DB_PORT) || 3306,
	database: process.env.DEV_DB_NAME,
	user: process.env.DEV_DB_USER,
	password: process.env.DEV_DB_PASSWORD,
	dateStrings: true,
});

try {
	const [[proj]] = await conn.execute(
		'SELECT project_id, project_team FROM projects WHERE project_code = "PROJ-005"'
	);
	console.log('=== TEAM ===');
	const team = JSON.parse(proj.project_team || '[]');
	for (const m of team)
		console.log(`- ${m.name} <${m.email}> role=${m.role} dept=${m.department}`);

	console.log('\n=== ASSIGNMENTS (Rahul on PROJ-005) ===');
	const [rows] = await conn.execute(
		`SELECT activity_name, sub_activity_name, discipline_name, status, priority,
		        estimated_hours, qty_assigned, qty_completed, due_date,
		        JSON_LENGTH(daily_entries) AS entry_count
		 FROM user_activity_assignments WHERE project_id = ? AND user_id = 89`,
		[proj.project_id]
	);
	for (const r of rows)
		console.log(
			`- [${r.status}] ${r.discipline_name} / ${r.activity_name} / ${r.sub_activity_name} — est ${r.estimated_hours}h, qty ${r.qty_completed}/${r.qty_assigned}, due ${r.due_date ? r.due_date.slice(0, 10) : '–'}, entries ${r.entry_count}`
		);

	console.log('\n=== APRIL 2026 COVERAGE ===');
	const [apr] = await conn.execute(
		`SELECT activity_name,
		        SUM(JSON_EXTRACT(e.value, '$.hours')) AS total_hours
		 FROM user_activity_assignments,
		      JSON_TABLE(daily_entries, '$[*]' COLUMNS (value JSON PATH '$')) e
		 WHERE project_id = ? AND user_id = 89
		   AND JSON_UNQUOTE(JSON_EXTRACT(e.value, '$.date')) LIKE '2026-04-%'
		 GROUP BY activity_name`,
		[proj.project_id]
	);
	if (apr.length === 0) console.log('No April entries found!');
	for (const r of apr)
		console.log(`- ${r.activity_name}: ${Number(r.total_hours)}h in Apr 2026`);

	console.log('\n=== MASTER COUNTS ===');
	const [[c]] = await conn.execute(
		`SELECT (SELECT COUNT(*) FROM functions_master) AS functions,
		        (SELECT COUNT(*) FROM activities_master) AS activities,
		        (SELECT COUNT(*) FROM sub_activities) AS sub_activities`
	);
	console.log(c);
} finally {
	await conn.end();
}
