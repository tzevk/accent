import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';
import { NextResponse } from 'next/server';

async function buildMigrationPlan(db) {
	// All existing company_id values (including already-good COM-XXXXX ones) so we never collide
	const [allIds] = await db.execute(
		`SELECT company_id FROM companies WHERE company_id IS NOT NULL AND company_id != ''`
	);
	const takenIds = new Set(allIds.map((r) => r.company_id));

	// Highest COM-XXXXX counter already in use
	const [maxRow] = await db.execute(
		`SELECT company_id FROM companies WHERE company_id REGEXP '^COM-[0-9]+$' ORDER BY CAST(SUBSTRING(company_id, 5) AS UNSIGNED) DESC LIMIT 1`
	);
	let counter =
		maxRow && maxRow.length > 0
			? parseInt(maxRow[0].company_id.replace('COM-', ''), 10)
			: 0;

	// Rows that need a new ID: NULL, empty, or anything that is not already COM-XXXXX format
	const [rows] = await db.execute(
		`SELECT id, company_id, company_name FROM companies WHERE company_id IS NULL OR company_id = '' OR company_id NOT REGEXP '^COM-[0-9]+$' ORDER BY id ASC`
	);

	// Build plan: assign a collision-safe COM-XXXXX to each row
	const plan = [];
	for (const row of rows) {
		do {
			counter++;
		} while (takenIds.has(`COM-${String(counter).padStart(5, '0')}`));
		const newId = `COM-${String(counter).padStart(5, '0')}`;
		takenIds.add(newId); // reserve it for subsequent iterations
		plan.push({
			id: row.id,
			old_company_id: row.company_id,
			company_name: row.company_name,
			new_company_id: newId,
		});
	}

	return plan;
}

// GET /api/companies/migrate-ids  — dry run, shows what will be changed without touching the DB
export async function GET(request) {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user || !user.is_super_admin) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden: super admin only' },
				{ status: 403 }
			);
		}

		db = await dbConnect();
		const plan = await buildMigrationPlan(db);

		return NextResponse.json({
			success: true,
			dry_run: true,
			would_update: plan.length,
			plan,
			message:
				plan.length === 0
					? 'All companies already have valid COM-XXXXX IDs — nothing to do.'
					: `${plan.length} companies would be updated. POST this endpoint to apply.`,
		});
	} catch (error) {
		console.error('Migration dry-run error:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				db.release();
			} catch (e) {
				console.error('Error releasing connection:', e);
			}
		}
	}
}

// POST /api/companies/migrate-ids  — applies the migration inside a transaction
export async function POST(request) {
	let db;
	try {
		const user = await getCurrentUser(request);
		if (!user || !user.is_super_admin) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden: super admin only' },
				{ status: 403 }
			);
		}

		db = await dbConnect();
		const plan = await buildMigrationPlan(db);

		if (plan.length === 0) {
			return NextResponse.json({
				success: true,
				updated: 0,
				message:
					'All companies already have valid COM-XXXXX IDs — nothing to do.',
			});
		}

		await db.beginTransaction();
		try {
			for (const item of plan) {
				await db.execute(`UPDATE companies SET company_id = ? WHERE id = ?`, [
					item.new_company_id,
					item.id,
				]);
			}
			await db.commit();
		} catch (err) {
			await db.rollback();
			throw err;
		}

		return NextResponse.json({
			success: true,
			updated: plan.length,
			plan,
			message: `Successfully assigned COM-XXXXX IDs to ${plan.length} companies.`,
		});
	} catch (error) {
		console.error('Migration error:', error);
		return NextResponse.json(
			{ success: false, error: error.message },
			{ status: 500 }
		);
	} finally {
		if (db) {
			try {
				db.release();
			} catch (e) {
				console.error('Error releasing connection:', e);
			}
		}
	}
}
