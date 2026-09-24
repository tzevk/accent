import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { findEffectiveDAOn } from '@/lib/payroll';

/**
 * GET - Fetch the DA Component Rate effective on a specific date
 * Query params: date (optional, defaults to today)
 */
export async function GET(request) {
	let db;
	try {
		// DA is one Component Rate among many, so it authorizes like the rest of
		// the payroll namespace (issue #239 — this route had no check at all
		// before that ticket).
		const authResult = await ensurePermission(
			request,
			RESOURCES.PAYROLL,
			PERMISSIONS.READ
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { searchParams } = new URL(request.url);
		const dateParam = searchParams.get('date');
		const forDate = dateParam || new Date().toISOString().split('T')[0];

		db = await dbConnect();

		// DA resolves through the one shared lookup, so the rate this endpoint
		// reports is the rate the calculator, the listing and the exports use.
		const da = await findEffectiveDAOn(db, forDate);

		if (!da) {
			return NextResponse.json({
				success: true,
				data: { da_amount: 0, effective_from: forDate, effective_to: null },
				message: 'No active DA found, using 0',
			});
		}

		return NextResponse.json({
			success: true,
			data: {
				// The same rule the calculator, the listing, the PDF and the export
				// apply: only a fixed DA is an amount, so a percentage-valued row
				// reports 0 here and says so in value_type rather than handing back
				// a percentage dressed up as rupees.
				da_amount: da.value_type === 'percentage' ? 0 : Number(da.value) || 0,
				value_type: da.value_type,
				effective_from: da.effective_from,
				effective_to: da.effective_to,
			},
		});
	} catch (error) {
		console.error('GET /api/payroll/da-schedule/current error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to fetch current DA',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
