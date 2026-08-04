import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// POST /api/payroll/salary-profile - Create/Update employee salary profile
// If `id` is provided, it updates that specific profile
// If `id` is not provided, it creates a new profile
export async function POST(request) {
	let db;
	try {
		// Check permission - wrap in try-catch to provide better error messages
		try {
			await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.UPDATE);
		} catch (permErr) {
			console.error('Permission check failed:', permErr);
			return NextResponse.json(
				{
					success: false,
					error:
						'Permission denied: ' +
						(permErr.message ||
							'You do not have permission to update employees'),
				},
				{ status: 403 }
			);
		}

		const body = await request.json();
		console.log('Received salary profile data:', JSON.stringify(body, null, 2));

		const {
			id, // If provided, update existing profile; otherwise create new
			employee_id,
			gross_salary,
			other_allowances = 0,
			effective_from = new Date().toISOString().split('T')[0],
			effective_to = null,
			da_year = new Date().getFullYear(),
			pf_applicable = true,
			esic_applicable = true,
			pt_applicable = false,
			mlwf_applicable = false,
			retention_applicable = false,
			bonus_applicable = false,
			monthly_bonus = false,
			incentive_applicable = false,
			insurance_applicable = false,
			// Salary type fields
			salary_type = 'monthly',
			hourly_rate,
			std_hours_per_day = 8,
			std_in_time = '09:00',
			std_out_time = '17:30',
			ot_multiplier = 1.5,
			daily_rate,
			std_working_days = 26,
			contract_amount,
			contract_duration = 'monthly',
			contract_end_date,
			lumpsum_amount,
			lumpsum_description,
			tds_percentage,
			// Additional breakdown fields
			basic_plus_da,
			da,
			basic,
			hra,
			conveyance,
			call_allowance,
			bonus,
			incentive,
			pf_employee,
			esic_employee,
			pf_employer,
			esic_employer,
			pt,
			mlwf,
			mlwf_employer,
			retention,
			insurance,
			total_earnings,
			total_deductions,
			net_pay,
			employer_cost,
			is_manual_override = false,
			// Privilege Leave (PL) fields
			pl_total = 0,
			pl_used = 0,
			pl_balance = 0,
			// Loan fields
			loan_amount = 0,
			loan_amount_per_month = 0,
			loan_no_of_months = 0,
			loan_total_amount = 0,
			loan_active = false,
			// Advance fields
			advance_amount = 0,
			advance_active = false,
		} = body;

		// Validate required fields
		if (
			!employee_id ||
			gross_salary === undefined ||
			gross_salary === null ||
			gross_salary === ''
		) {
			return NextResponse.json(
				{
					success: false,
					error:
						'Missing required fields: employee_id and gross_salary are required',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// Check if employee exists
		const [empRows] = await db.query('SELECT id FROM employees WHERE id = ?', [
			employee_id,
		]);

		console.log('Employee check result:', empRows);

		if (empRows.length === 0) {
			if (db) db.release();
			return NextResponse.json(
				{ success: false, error: `Employee not found with ID: ${employee_id}` },
				{ status: 404 }
			);
		}

		let result;
		let isUpdate = false;

		// Prepare common values array
		const values = [
			parseFloat(gross_salary) || 0, // gross (legacy column)
			parseFloat(gross_salary) || 0, // gross_salary
			parseFloat(other_allowances) || 0,
			effective_from,
			effective_to || null,
			da_year,
			pf_applicable ? 1 : 0,
			esic_applicable ? 1 : 0,
			pt_applicable ? 1 : 0,
			mlwf_applicable ? 1 : 0,
			retention_applicable ? 1 : 0,
			bonus_applicable ? 1 : 0,
			monthly_bonus ? 1 : 0,
			incentive_applicable ? 1 : 0,
			insurance_applicable ? 1 : 0,
			parseFloat(basic_plus_da) || null,
			parseFloat(da) || null,
			parseFloat(basic) || null,
			parseFloat(hra) || null,
			parseFloat(conveyance) || null,
			parseFloat(call_allowance) || null,
			parseFloat(bonus) || null,
			parseFloat(incentive) || null,
			parseFloat(pf_employee) || null,
			parseFloat(esic_employee) || null,
			parseFloat(pf_employer) || null,
			parseFloat(esic_employer) || null,
			parseFloat(pt) || null,
			parseFloat(mlwf) || null,
			parseFloat(mlwf_employer) || null,
			parseFloat(retention) || null,
			parseFloat(insurance) || null,
			parseFloat(total_earnings) || null,
			parseFloat(total_deductions) || null,
			parseFloat(net_pay) || null,
			parseFloat(employer_cost) || null,
			is_manual_override ? 1 : 0,
			salary_type || 'monthly',
			parseFloat(hourly_rate) || null,
			parseFloat(std_hours_per_day) || 8,
			std_in_time || '09:00',
			std_out_time || '17:30',
			parseFloat(ot_multiplier) || 1.5,
			parseFloat(daily_rate) || null,
			parseInt(std_working_days) || 26,
			parseFloat(contract_amount) || null,
			contract_duration || 'monthly',
			contract_end_date || null,
			parseFloat(lumpsum_amount) || null,
			lumpsum_description || null,
			parseFloat(tds_percentage) || null,
			parseInt(pl_total) || 0,
			parseInt(pl_used) || 0,
			parseInt(pl_balance) || 0,
			parseFloat(loan_amount) || 0,
			parseFloat(loan_amount_per_month) || 0,
			parseInt(loan_no_of_months) || 0,
			parseFloat(loan_total_amount) || 0,
			loan_active ? 1 : 0,
			parseFloat(advance_amount) || 0,
			advance_active ? 1 : 0,
		];

		if (id) {
			// UPDATE existing salary profile by ID
			console.log('Updating existing salary profile with ID:', id);
			[result] = await db.query(
				`UPDATE employee_salary_profile SET
          gross = ?, gross_salary = ?, other_allowances = ?, effective_from = ?, effective_to = ?, da_year = ?,
          pf_applicable = ?, esic_applicable = ?, pt_applicable = ?, mlwf_applicable = ?,
          retention_applicable = ?, bonus_applicable = ?, monthly_bonus = ?, incentive_applicable = ?, insurance_applicable = ?,
          basic_plus_da = ?, da = ?, basic = ?, hra = ?, conveyance = ?, call_allowance = ?, bonus = ?, incentive = ?,
          pf_employee = ?, esic_employee = ?, pf_employer = ?, esic_employer = ?, pt = ?, mlwf = ?, mlwf_employer = ?,
          retention = ?, insurance = ?, total_earnings = ?, total_deductions = ?, net_pay = ?, employer_cost = ?,
          is_manual_override = ?, salary_type = ?, hourly_rate = ?, std_hours_per_day = ?, std_in_time = ?, std_out_time = ?, ot_multiplier = ?,
          daily_rate = ?, std_working_days = ?, contract_amount = ?, contract_duration = ?, contract_end_date = ?,
          lumpsum_amount = ?, lumpsum_description = ?, tds_percentage = ?,
          pl_total = ?, pl_used = ?, pl_balance = ?,
          loan_amount = ?, loan_amount_per_month = ?, loan_no_of_months = ?, loan_total_amount = ?, loan_active = ?,
          advance_amount = ?, advance_active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND employee_id = ?`,
				[...values, id, employee_id]
			);
			isUpdate = result.affectedRows > 0;
		} else {
			// Check if a profile already exists for this employee and effective_from date
			const [existing] = await db.query(
				`SELECT id FROM employee_salary_profile WHERE employee_id = ? AND effective_from = ? LIMIT 1`,
				[employee_id, effective_from]
			);

			if (existing && existing.length > 0) {
				// UPDATE existing profile for this date
				console.log(
					'Updating existing salary profile for employee:',
					employee_id,
					'effective_from:',
					effective_from
				);
				const existingId = existing[0].id;
				[result] = await db.query(
					`UPDATE employee_salary_profile SET
            gross = ?, gross_salary = ?, other_allowances = ?, effective_from = ?, effective_to = ?, da_year = ?,
            pf_applicable = ?, esic_applicable = ?, pt_applicable = ?, mlwf_applicable = ?,
            retention_applicable = ?, bonus_applicable = ?, monthly_bonus = ?, incentive_applicable = ?, insurance_applicable = ?,
            basic_plus_da = ?, da = ?, basic = ?, hra = ?, conveyance = ?, call_allowance = ?, bonus = ?, incentive = ?,
            pf_employee = ?, esic_employee = ?, pf_employer = ?, esic_employer = ?, pt = ?, mlwf = ?, mlwf_employer = ?,
            retention = ?, insurance = ?, total_earnings = ?, total_deductions = ?, net_pay = ?, employer_cost = ?,
            is_manual_override = ?, salary_type = ?, hourly_rate = ?, std_hours_per_day = ?, std_in_time = ?, std_out_time = ?, ot_multiplier = ?,
            daily_rate = ?, std_working_days = ?, contract_amount = ?, contract_duration = ?, contract_end_date = ?,
            lumpsum_amount = ?, lumpsum_description = ?, tds_percentage = ?,
            pl_total = ?, pl_used = ?, pl_balance = ?,
          loan_amount = ?, loan_amount_per_month = ?, loan_no_of_months = ?, loan_total_amount = ?, loan_active = ?,
          advance_amount = ?, advance_active = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
					[...values, existingId]
				);
				isUpdate = true;
				result.insertId = existingId; // Use existing ID for response
			} else {
				// INSERT new salary profile
				console.log('Creating new salary profile for employee:', employee_id);
				[result] = await db.query(
					`INSERT INTO employee_salary_profile 
           (employee_id, gross, gross_salary, other_allowances, effective_from, effective_to, da_year, 
            pf_applicable, esic_applicable, pt_applicable, mlwf_applicable, retention_applicable, bonus_applicable, monthly_bonus, incentive_applicable, insurance_applicable,
            basic_plus_da, da, basic, hra, conveyance, call_allowance, bonus, incentive,
            pf_employee, esic_employee, pf_employer, esic_employer, pt, mlwf, mlwf_employer, retention, insurance,
            total_earnings, total_deductions, net_pay, employer_cost, is_manual_override,
            salary_type, hourly_rate, std_hours_per_day, std_in_time, std_out_time, ot_multiplier, daily_rate, std_working_days,
            contract_amount, contract_duration, contract_end_date, lumpsum_amount, lumpsum_description, tds_percentage,
            pl_total, pl_used, pl_balance,
            loan_amount, loan_amount_per_month, loan_no_of_months, loan_total_amount, loan_active,
            advance_amount, advance_active) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[employee_id, ...values]
				);
			}
		}

		console.log('Insert/Update result:', result);

		if (db) db.release();

		return NextResponse.json({
			success: true,
			message: isUpdate
				? 'Salary profile updated successfully'
				: 'Salary profile created successfully',
			data: {
				id: id || result.insertId || null,
				employee_id,
				gross_salary,
				other_allowances,
				effective_from,
				effective_to,
				da_year,
				pf_applicable,
				esic_applicable,
			},
		});
	} catch (error) {
		console.error('Error saving salary profile:', error);
		if (db) {
			try {
				db.release();
			} catch {}
		}
		return NextResponse.json(
			{ success: false, error: error.message || 'Internal server error' },
			{ status: 500 }
		);
	}
}

// GET /api/payroll/salary-profile?employee_id=X - Get employee's salary profile history
export async function GET(request) {
	let db;
	try {
		await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);

		const { searchParams } = new URL(request.url);
		const employee_id = searchParams.get('employee_id');

		if (!employee_id) {
			return NextResponse.json(
				{ success: false, error: 'Missing employee_id parameter' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		try {
			// Get all salary profiles for this employee, ordered by effective_from descending
			// Use SELECT * to avoid errors when columns don't exist yet
			const [profiles] = await db.query(
				`SELECT * FROM employee_salary_profile 
         WHERE employee_id = ?
         ORDER BY effective_from DESC, updated_at DESC`,
				[employee_id]
			);

			// Map profiles to ensure consistent field names
			const mappedProfiles = profiles.map((p) => ({
				...p,
				gross_salary: p.gross_salary || p.gross || 0,
				std_in_time: p.std_in_time || '09:00:00',
				std_out_time: p.std_out_time || '17:30:00',
			}));

			return NextResponse.json({
				success: true,
				data: mappedProfiles,
			});
		} finally {
			if (db) {
				try {
					db.release();
				} catch (releaseErr) {
					console.error('Release error:', releaseErr);
				}
			}
		}
	} catch (error) {
		console.error('Error fetching salary profiles:', error);
		return NextResponse.json(
			{ success: false, error: error.message || 'Internal server error' },
			{ status: 500 }
		);
	}
}

// DELETE /api/payroll/salary-profile?id=X - Delete a salary profile
export async function DELETE(request) {
	let db;
	try {
		await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.DELETE);

		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Missing id parameter' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		try {
			const [result] = await db.query(
				'DELETE FROM employee_salary_profile WHERE id = ?',
				[id]
			);

			if (result.affectedRows === 0) {
				return NextResponse.json(
					{ success: false, error: 'Salary profile not found' },
					{ status: 404 }
				);
			}

			return NextResponse.json({
				success: true,
				message: 'Salary profile deleted successfully',
			});
		} finally {
			if (db) {
				try {
					db.release();
				} catch (releaseErr) {
					console.error('Release error:', releaseErr);
				}
			}
		}
	} catch (error) {
		console.error('Error deleting salary profile:', error);
		return NextResponse.json(
			{ success: false, error: error.message || 'Internal server error' },
			{ status: 500 }
		);
	}
}
