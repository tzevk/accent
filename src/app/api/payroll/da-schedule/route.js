import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

/**
 * GET - Fetch all DA schedule entries
 */
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		db = await dbConnect();

		const [rows] = await db.execute(
			`SELECT id, value AS da_amount, effective_from, effective_to, is_active, remarks
       FROM payroll_schedules
       WHERE component_type = 'da'
       ORDER BY effective_from DESC`
		);

		return NextResponse.json({
			success: true,
			data: rows,
		});
	} catch (error) {
		console.error('GET /api/payroll/da-schedule error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch DA schedule',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

/**
 * POST - Create new DA schedule entry
 */
export async function POST(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.CREATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { da_amount, effective_from, effective_to, is_active, remarks } =
			await request.json();

		if (!da_amount || !effective_from) {
			return NextResponse.json(
				{ success: false, error: 'DA amount and effective_from are required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// If marking as active, deactivate sibling DA rates only — never other component types.
		if (is_active) {
			await db.execute(
				`UPDATE payroll_schedules SET is_active = 0 WHERE component_type = 'da'`
			);
		}

		const [result] = await db.execute(
			`INSERT INTO payroll_schedules (component_type, value_type, value, effective_from, effective_to, is_active, remarks)
       VALUES ('da', 'fixed', ?, ?, ?, ?, ?)`,
			[
				da_amount,
				effective_from,
				effective_to || null,
				is_active ? 1 : 0,
				remarks || null,
			]
		);

		return NextResponse.json(
			{
				success: true,
				message: 'DA schedule entry created successfully',
				id: result.insertId,
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('POST /api/payroll/da-schedule error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to create DA schedule entry',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

/**
 * PUT - Update DA schedule entry
 */
export async function PUT(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.UPDATE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { id, da_amount, effective_from, effective_to, is_active, remarks } =
			await request.json();

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// If marking as active, deactivate sibling DA rates only — never other component types.
		if (is_active) {
			await db.execute(
				`UPDATE payroll_schedules SET is_active = 0 WHERE component_type = 'da' AND id != ?`,
				[id]
			);
		}

		await db.execute(
			`UPDATE payroll_schedules 
       SET value = COALESCE(?, value),
           effective_from = COALESCE(?, effective_from),
           effective_to = ?,
           is_active = COALESCE(?, is_active),
           remarks = ?
       WHERE id = ? AND component_type = 'da'`,
			[
				da_amount ?? null,
				effective_from ?? null,
				effective_to !== undefined ? effective_to : undefined,
				is_active !== undefined ? (is_active ? 1 : 0) : null,
				remarks !== undefined ? remarks : undefined,
				id,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'DA schedule entry updated successfully',
		});
	} catch (error) {
		console.error('PUT /api/payroll/da-schedule error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update DA schedule entry',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

/**
 * DELETE - Remove DA schedule entry
 */
export async function DELETE(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PAYROLL,
		PERMISSIONS.DELETE
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		await db.execute(
			`DELETE FROM payroll_schedules WHERE id = ? AND component_type = 'da'`,
			[id]
		);

		return NextResponse.json({
			success: true,
			message: 'DA schedule entry deleted successfully',
		});
	} catch (error) {
		console.error('DELETE /api/payroll/da-schedule error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete DA schedule entry',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
