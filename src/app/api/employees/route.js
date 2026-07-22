import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES as API_RESOURCES,
	PERMISSIONS as API_PERMISSIONS,
} from '@/utils/api-permissions';

// GET - Fetch all employees
export async function GET(request) {
	let connection;
	try {
		// RBAC: read employees
		const auth = await ensurePermission(
			request,
			API_RESOURCES.EMPLOYEES,
			API_PERMISSIONS.READ
		);
		if (auth instanceof Response) return auth;

		const { searchParams } = new URL(request.url);
		const search = searchParams.get('search') || '';
		const department = searchParams.get('department') || '';
		const status = searchParams.get('status') || '';
		const workplace = searchParams.get('workplace') || '';
		const employment_status = searchParams.get('employment_status') || '';
		const page = parseInt(searchParams.get('page')) || 1;
		const limit = parseInt(searchParams.get('limit')) || 10;
		const offset = (page - 1) * limit;

		connection = await dbConnect();

		// Build WHERE clause for filtering (use alias to avoid ambiguity with self-join)
		let whereClause = 'WHERE 1=1 AND e.isDelete = 0';
		const params = [];

		if (search) {
			whereClause +=
				' AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ? OR e.employee_id LIKE ?)';
			const searchPattern = `%${search}%`;
			params.push(searchPattern, searchPattern, searchPattern, searchPattern);
		}

		if (department) {
			whereClause += ' AND e.department = ?';
			params.push(department);
		}

		if (status) {
			whereClause += ' AND e.status = ?';
			params.push(status);
		}

		if (workplace) {
			whereClause += ' AND e.workplace = ?';
			params.push(workplace);
		}

		if (employment_status) {
			if (employment_status === 'employed') {
				// Employed = active status and no exit_date
				whereClause += " AND (e.exit_date IS NULL OR e.exit_date = '')";
			} else if (employment_status === 'resigned') {
				// Resigned = has exit_date
				whereClause += " AND e.exit_date IS NOT NULL AND e.exit_date != ''";
			}
		}

		// Get total count for pagination
		const [countResult] = await connection.execute(
			`SELECT COUNT(*) as total
       FROM employees e
       LEFT JOIN employees m ON e.manager_id = m.id
       ${whereClause}`,
			params
		);
		const total = countResult[0].total;

		// Get employees with pagination
		const limitNum = Math.max(1, Math.min(1000, limit));
		const offsetNum = Math.max(0, offset);
		const [employees] = await connection.execute(
			`SELECT 
        e.*,
        CONCAT(m.first_name, ' ', m.last_name) as manager_name
       FROM employees e
       LEFT JOIN employees m ON e.manager_id = m.id
       ${whereClause}
       ORDER BY e.created_at DESC
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
			params
		);

		// Get unique departments for filter options
		const [departments] = await connection.execute(
			'SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND isDelete = 0 ORDER BY department'
		);

		// Get unique workplaces for filter options
		const [workplaces] = await connection.execute(
			"SELECT DISTINCT workplace FROM employees WHERE workplace IS NOT NULL AND workplace != '' AND isDelete = 0 ORDER BY workplace"
		);

		return NextResponse.json({
			employees,
			departments: departments.map((d) => d.department),
			workplaces: workplaces.map((w) => w.workplace),
			pagination: {
				current: page,
				total: Math.ceil(total / limit),
				limit,
				totalRecords: total,
			},
		});
	} catch (error) {
		console.error('Error fetching employees:', error);
		return NextResponse.json(
			{ error: error?.message || 'Failed to fetch employees' },
			{ status: 500 }
		);
	} finally {
		if (connection) {
			try {
				await connection.end();
			} catch {}
		}
	}
}

// POST - Create new employee
export async function POST(request) {
	let connection;
	try {
		// RBAC: create employees
		const auth = await ensurePermission(
			request,
			API_RESOURCES.EMPLOYEES,
			API_PERMISSIONS.CREATE
		);
		if (auth instanceof Response) return auth;
		const data = await request.json();
		// Trim and sanitize incoming values
		const sanitized = {};
		for (const [k, v] of Object.entries(data)) {
			if (v === undefined || v === null) continue;
			if (typeof v === 'string') {
				const t = v.trim();
				if (t === '') continue; // drop empty strings to avoid strict mode issues
				sanitized[k] = t;
			} else {
				sanitized[k] = v;
			}
		}
		// Debug: surface sanitized payload keys (avoid logging full PII in prod)
		try {
			console.debug('[employees.POST] sanitized keys:', Object.keys(sanitized));
		} catch {}

		// Validation
		const requiredFields = ['employee_id', 'first_name', 'last_name', 'email'];
		for (const field of requiredFields) {
			if (!sanitized[field]) {
				return NextResponse.json(
					{ error: `${field} is required` },
					{ status: 400 }
				);
			}
		}

		// Email validation
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
		if (!emailRegex.test(sanitized.email)) {
			return NextResponse.json(
				{ error: 'Invalid email format' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		// Check if employee_id or email already exists
		// Auto-generate ATS-prefixed employee_id when missing or only prefix provided
		try {
			if (
				!sanitized.employee_id ||
				/^ATS\s*$/i.test(sanitized.employee_id) ||
				/^ATS\d*$/i.test(sanitized.employee_id)
			) {
				const [rows] = await connection.execute(
					"SELECT employee_id FROM employees WHERE employee_id LIKE 'ATS%' AND isDelete = 0"
				);
				let maxNum = 0;
				for (const r of rows) {
					const m = String(r.employee_id || '').match(/ATS0*(\d+)$/i);
					if (m) {
						const n = parseInt(m[1], 10);
						if (Number.isFinite(n)) maxNum = Math.max(maxNum, n);
					}
				}
				const next = String(maxNum + 1).padStart(3, '0');
				sanitized.employee_id = `ATS${next}`;
			}
		} catch (genErr) {
			console.warn(
				'Failed to auto-generate ATS id:',
				genErr?.message || genErr
			);
		}

		const [existing] = await connection.execute(
			'SELECT id FROM employees WHERE employee_id = ? OR email = ? AND isDelete = 0',
			[sanitized.employee_id, sanitized.email]
		);

		if (existing.length > 0) {
			return NextResponse.json(
				{ error: 'Employee ID or email already exists' },
				{ status: 409 }
			);
		}

		// Dynamic insert for provided fields
		const allowedFields = [
			'employee_id',
			'first_name',
			'middle_name',
			'last_name',
			'username',
			'email',
			'personal_email',
			'phone',
			'mobile',
			'department',
			'position',
			'hire_date',
			'joining_date',
			'status',
			'employment_status',
			'manager_id',
			'reporting_to',
			'address',
			'present_address',
			'city',
			'pin',
			'state',
			'country',
			'gender',
			'employee_type',
			'grade',
			'workplace',
			'level',
			'pf_no',
			'dob',
			'marital_status',
			'role',
			'profile_photo_url',
			'emergency_contact_name',
			'emergency_contact_phone',
			'notes',
			'bonus_eligible',
			'stat_pf',
			'stat_mlwf',
			'stat_pt',
			'stat_esic',
			'stat_tds',
			'qualification',
			'institute',
			'passing_year',
			'work_experience',
			'bank_account_no',
			'bank_ifsc',
			'bank_name',
			'bank_branch',
			'account_holder_name',
			'pan',
			'aadhar',
			'gratuity_no',
			'uan',
			'esi_no',
			'attendance_id',
			'biometric_code',
			'exit_date',
			'exit_reason',
			'company_name',
		];
		// Only include columns that actually exist in DB
		const [colsInfo] = await connection.execute('SHOW COLUMNS FROM employees');
		const existingCols = new Set(colsInfo.map((r) => r.Field));
		const insertable = allowedFields.filter((f) => existingCols.has(f));
		const cols = [];
		const placeholders = [];
		const vals = [];
		for (const key of insertable) {
			if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
				cols.push(key);
				placeholders.push('?');
				vals.push(sanitized[key]);
			}
		}
		// Safety: log and fail fast if something unexpected occurs with columns/values
		try {
			console.debug(
				'[employees.POST] insert columns count:',
				cols.length,
				'values count:',
				vals.length
			);
		} catch {}
		if (cols.length !== vals.length) {
			// helpful diagnostic for developers when payload/DB diverge
			console.error('[employees.POST] column/value mismatch', { cols, vals });
			return NextResponse.json(
				{
					error:
						'Server misconfiguration: column/value mismatch when saving employee',
				},
				{ status: 500 }
			);
		}
		// Required fields safety
		if (
			!cols.includes('employee_id') ||
			!cols.includes('first_name') ||
			!cols.includes('last_name') ||
			!cols.includes('email')
		) {
			return NextResponse.json(
				{
					error:
						'Missing required fields (employee_id, first_name, last_name, email)',
				},
				{ status: 400 }
			);
		}
		let result;
		try {
			[result] = await connection.execute(
				`INSERT INTO employees (${cols.join(',')}) VALUES (${placeholders.join(',')})`,
				vals
			);
		} catch (e) {
			// Handle duplicate key errors gracefully
			if (e && (e.code === 'ER_DUP_ENTRY' || e.errno === 1062)) {
				return NextResponse.json(
					{ error: 'Employee ID or email already exists' },
					{ status: 409 }
				);
			}
			throw e;
		}

		return NextResponse.json(
			{
				message: 'Employee created successfully',
				employeeId: result.insertId,
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('Error creating employee:', error);
		return NextResponse.json(
			{ error: error?.message || 'Failed to create employee' },
			{ status: 500 }
		);
	} finally {
		if (connection && typeof connection.release === 'function') {
			try {
				connection.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}

// PUT - Update employee
export async function PUT(request) {
	let connection;
	try {
		// RBAC: update employees
		const auth = await ensurePermission(
			request,
			API_RESOURCES.EMPLOYEES,
			API_PERMISSIONS.UPDATE
		);
		if (auth instanceof Response) return auth;

		// Get ID from query params or body
		const { searchParams } = new URL(request.url);
		const idFromQuery = searchParams.get('id');

		const raw = await request.json();
		// Trim and sanitize
		const data = {};
		for (const [k, v] of Object.entries(raw)) {
			if (v === undefined || v === null) continue;
			if (typeof v === 'string') {
				const t = v.trim();
				if (t === '') continue;
				data[k] = t;
			} else {
				data[k] = v;
			}
		}

		// Use ID from query params if available, otherwise from body
		const employeeId = idFromQuery || data.id;

		if (!employeeId) {
			return NextResponse.json(
				{ success: false, error: 'Employee ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();
		const pkCol = 'id';

		// Check if employee exists
		const [existing] = await connection.execute(
			`SELECT ${pkCol} FROM employees WHERE ${pkCol} = ? AND isDelete = 0`,
			[employeeId]
		);
		if (existing.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Employee not found' },
				{ status: 404 }
			);
		}

		// Check for duplicate employee_id or email (excluding current employee)
		if (data.employee_id || data.email) {
			const [duplicates] = await connection.execute(
				`SELECT ${pkCol} FROM employees WHERE (employee_id = ? OR email = ?) AND ${pkCol} != ? AND isDelete = 0`,
				[data.employee_id, data.email, employeeId]
			);

			if (duplicates.length > 0) {
				return NextResponse.json(
					{ success: false, error: 'Employee ID or email already exists' },
					{ status: 409 }
				);
			}
		}

		// Build dynamic update query
		const updateFields = [];
		const values = [];

		const allowedFields = [
			'employee_id',
			'first_name',
			'middle_name',
			'last_name',
			'username',
			'email',
			'personal_email',
			'phone',
			'mobile',
			'department',
			'position',
			'hire_date',
			'joining_date',
			'status',
			'employment_status',
			'manager_id',
			'reporting_to',
			'address',
			'present_address',
			'city',
			'pin',
			'state',
			'country',
			'gender',
			'employee_type',
			'grade',
			'workplace',
			'level',
			'pf_no',
			'dob',
			'marital_status',
			'role',
			'profile_photo_url',
			'emergency_contact_name',
			'emergency_contact_phone',
			'notes',
			'bonus_eligible',
			'stat_pf',
			'stat_mlwf',
			'stat_pt',
			'stat_esic',
			'stat_tds',
			'qualification',
			'institute',
			'passing_year',
			'work_experience',
			'bank_account_no',
			'bank_ifsc',
			'bank_name',
			'bank_branch',
			'account_holder_name',
			'pan',
			'aadhar',
			'gratuity_no',
			'uan',
			'esi_no',
			'attendance_id',
			'biometric_code',
			'device_code',
			'exit_date',
			'exit_reason',
			'company_name',
		];
		const [colsInfo] = await connection.execute('SHOW COLUMNS FROM employees');
		const existingCols = new Set(colsInfo.map((r) => r.Field));
		const updatable = allowedFields.filter((f) => existingCols.has(f));

		updatable.forEach((field) => {
			if (Object.prototype.hasOwnProperty.call(data, field)) {
				const val = data[field];
				// Skip empty string or null to avoid wiping existing DB values unintentionally
				if (val === '' || val === null || typeof val === 'undefined') return;
				updateFields.push(`${field} = ?`);
				values.push(val);
			}
		});

		if (updateFields.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'No valid fields to update' },
				{ status: 400 }
			);
		}

		values.push(employeeId);

		await connection.execute(
			`UPDATE employees SET ${updateFields.join(', ')} WHERE ${pkCol} = ? AND isDelete = 0`,
			values
		);

		// Keep Users table in sync for role/status changes when possible
		try {
			// If a role name was provided, map to roles_master.id and update user's role_id
			if (Object.prototype.hasOwnProperty.call(data, 'role') && data.role) {
				const [roleRows] = await connection.execute(
					'SELECT id FROM roles_master WHERE role_name = ? AND status = "active" LIMIT 1',
					[data.role]
				);
				if (roleRows && roleRows.length > 0) {
					await connection.execute(
						'UPDATE users SET role_id = ? WHERE employee_id = ?',
						[roleRows[0].id, employeeId]
					);
				}
			}
			// If employment status provided, toggle user's is_active accordingly
			if (
				Object.prototype.hasOwnProperty.call(data, 'status') ||
				Object.prototype.hasOwnProperty.call(data, 'employment_status')
			) {
				const statusVal = (
					data.status ||
					data.employment_status ||
					''
				).toLowerCase();
				if (['active', 'inactive', 'terminated'].includes(statusVal)) {
					await connection.execute(
						'UPDATE users SET is_active = ? , status = ? WHERE employee_id = ?',
						[
							statusVal === 'active',
							statusVal === 'inactive' ? 'inactive' : 'active',
							employeeId,
						]
					);
				}
			}
		} catch (syncErr) {
			// Non-fatal: syncing users is best-effort
			console.warn('Employee->User sync warning:', syncErr?.message || syncErr);
		}

		return NextResponse.json({
			success: true,
			message: 'Employee updated successfully',
		});
	} catch (error) {
		console.error('Error updating employee:', error);
		return NextResponse.json(
			{ success: false, error: error?.message || 'Failed to update employee' },
			{ status: 500 }
		);
	} finally {
		if (connection && typeof connection.release === 'function') {
			try {
				connection.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}

// DELETE - Delete employee
export async function DELETE(request) {
	let connection;
	try {
		// RBAC: delete employees
		const auth = await ensurePermission(
			request,
			API_RESOURCES.EMPLOYEES,
			API_PERMISSIONS.DELETE
		);
		if (auth instanceof Response) return auth;
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ error: 'Employee ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();
		const pkCol = 'id';

		// Check if employee exists
		const [existing] = await connection.execute(
			`SELECT ${pkCol} FROM employees WHERE ${pkCol} = ? AND isDelete = 0`,
			[id]
		);
		if (existing.length === 0) {
			return NextResponse.json(
				{ error: 'Employee not found' },
				{ status: 404 }
			);
		}

		// Check if employee is a manager of other employees
		const [managedEmployees] = await connection.execute(
			'SELECT COUNT(*) as count FROM employees WHERE manager_id = ? AND isDelete = 0',
			[id]
		);

		if (managedEmployees[0].count > 0) {
			return NextResponse.json(
				{
					error:
						'Cannot delete employee who is managing other employees. Please reassign their reports first.',
				},
				{ status: 400 }
			);
		}

		// Delete employee
		await connection.execute(
			`UPDATE employees SET isDelete = 1 WHERE ${pkCol} = ? AND isDelete = 0`,
			[id]
		);
		// Optionally deactivate linked user instead of hard delete
		try {
			await connection.execute(
				'UPDATE users SET is_active = FALSE, status = "inactive" WHERE employee_id = ?',
				[id]
			);
		} catch {}

		return NextResponse.json({
			message: 'Employee deleted successfully',
		});
	} catch (error) {
		console.error('Error deleting employee:', error);
		return NextResponse.json(
			{ error: 'Failed to delete employee' },
			{ status: 500 }
		);
	} finally {
		if (connection && typeof connection.release === 'function') {
			try {
				connection.release();
			} catch (_) {
				/* ignore */
			}
		}
	}
}
