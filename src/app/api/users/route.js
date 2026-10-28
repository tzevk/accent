import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import {
	ensurePermission,
	RESOURCES as API_RESOURCES,
	PERMISSIONS as API_PERMISSIONS,
	invalidateUserCache,
	canModifyTargetUser,
	validateUserGrants,
} from '@/utils/api-permissions';
import { hashPassword } from '@/utils/password';
import { revokeAllUserSessions } from '@/utils/session';
import {
	isAccountLinkConflict,
	resolveAccessState,
	ownershipChangeRequested,
} from '@/utils/account-links';
// GET - list users with optional pagination and role information
export async function GET(request) {
	let db;
	try {
		// RBAC: read users
		const auth = await ensurePermission(
			request,
			API_RESOURCES.USERS,
			API_PERMISSIONS.READ
		);
		if (auth instanceof Response) return auth;
		const { searchParams } = new URL(request.url);
		const page = parseInt(searchParams.get('page')) || 1;
		const limit = parseInt(searchParams.get('limit')) || 50;
		const offset = (page - 1) * limit;

		db = await dbConnect();

		const [rows] = await db.execute(
			`SELECT u.id, u.username, u.email, u.full_name, u.role_id,
              u.employee_id, u.vendor_id, u.account_type, u.department,
              u.is_active, u.status, u.is_super_admin,
              u.permissions, u.field_permissions,
              u.created_at, u.last_login, u.last_password_change,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name, 
              e.employee_id as employee_code,
              e.department as employee_department,
              e.position as employee_position,
              r.display_name as role_name,
              r.role_key,
              r.permissions as role_permissions
       FROM users u
       LEFT JOIN employees e ON u.employee_id = e.id
       LEFT JOIN roles r ON u.role_id = r.id
       WHERE u.is_active = TRUE AND u.status = 'active' AND u.isDelete = 0
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
			[limit, offset]
		);

		// Get total count for pagination
		const [countResult] = await db.execute(
			"SELECT COUNT(*) as total FROM users WHERE is_active = TRUE AND status = 'active' AND isDelete = 0"
		);

		const response = NextResponse.json({
			success: true,
			data: rows,
			pagination: {
				page,
				limit,
				total: countResult[0].total,
				totalPages: Math.ceil(countResult[0].total / limit),
			},
		});
		response.headers.set('Cache-Control', 'no-store');
		return response;
	} catch (error) {
		console.error('Error fetching users:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch users' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// POST - create user with role-based system
export async function POST(request) {
	let db;
	let transactionStarted = false;
	let transactionCommitted = false;
	try {
		// RBAC: create users
		const auth = await ensurePermission(
			request,
			API_RESOURCES.USERS,
			API_PERMISSIONS.CREATE
		);
		if (auth instanceof Response) return auth;
		const data = await request.json();
		const {
			username,
			password,
			email,
			employee_id,
			vendor_id,
			account_type,
			role_id,
			permissions,
		} = data;

		if (!username || !password) {
			return NextResponse.json(
				{ success: false, error: 'username and password are required' },
				{ status: 400 }
			);
		}

		// Validate account type and account ownership compatibility.
		const userAccountType = account_type || 'employee';
		if (!['employee', 'vendor'].includes(userAccountType)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid account_type' },
				{ status: 400 }
			);
		}
		if (
			userAccountType === 'employee' &&
			(!Number.isSafeInteger(employee_id) || employee_id <= 0)
		) {
			return NextResponse.json(
				{ success: false, error: 'employee_id must be a valid Employee ID' },
				{ status: 400 }
			);
		}
		if (userAccountType === 'employee' && vendor_id != null) {
			return NextResponse.json(
				{
					success: false,
					error: 'vendor_id is not allowed for employee accounts',
				},
				{ status: 400 }
			);
		}
		if (userAccountType === 'vendor' && (!vendor_id || employee_id != null)) {
			return NextResponse.json(
				{
					success: false,
					error:
						'vendor_id is required and employee_id is not allowed for vendor accounts',
				},
				{ status: 400 }
			);
		}

		db = await dbConnect();

		// Validate grants (role_id, permissions, field_permissions, is_super_admin)
		const grantCheck = await validateUserGrants(auth.user, data, db, {
			targetIsSelf: false,
		});
		if (!grantCheck.allowed) {
			return NextResponse.json(
				{ success: false, error: grantCheck.reason },
				{ status: 403 }
			);
		}
		// check duplicates
		const [existing] = await db.execute(
			"SELECT id FROM users WHERE username = ? OR (email = ? AND email IS NOT NULL AND email != '') LIMIT 1",
			[username, email || null]
		);
		if (existing && existing.length > 0) {
			return NextResponse.json(
				{
					success: false,
					error: 'User with this username or email already exists',
				},
				{ status: 409 }
			);
		}

		let fullName = '';
		let userEmail = email;
		let department = null;

		// Handle employee or vendor account
		if (userAccountType === 'employee') {
			// Ensure employee exists and get employee details
			const [emp] = await db.execute(
				'SELECT id, first_name, last_name, email as emp_email, department FROM employees WHERE id = ? AND isDelete = 0 LIMIT 1',
				[employee_id]
			);
			if (!emp || emp.length === 0) {
				return NextResponse.json(
					{ success: false, error: 'Employee not found' },
					{ status: 400 }
				);
			}
			const employee = emp[0];
			fullName = `${employee.first_name} ${employee.last_name}`;
			userEmail = email || employee.emp_email;
			department = employee.department;
		} else if (userAccountType === 'vendor') {
			// Ensure vendor exists and get vendor details
			const [vnd] = await db.execute(
				'SELECT id, vendor_name, contact_person, email as vendor_email FROM vendors WHERE id = ? LIMIT 1',
				[vendor_id]
			);
			if (!vnd || vnd.length === 0) {
				return NextResponse.json(
					{ success: false, error: 'Vendor not found' },
					{ status: 400 }
				);
			}
			const vendor = vnd[0];
			fullName = vendor.contact_person || vendor.vendor_name;
			userEmail = email || vendor.vendor_email;
			department = 'Vendor';
		}

		// Validate role if provided
		let roleData = null;
		if (role_id) {
			const [role] = await db.execute(
				'SELECT * FROM roles_master WHERE id = ? AND status = "active" LIMIT 1',
				[role_id]
			);
			if (!role || role.length === 0) {
				return NextResponse.json(
					{ success: false, error: 'Invalid role selected' },
					{ status: 400 }
				);
			}
			roleData = role[0];
		}

		// Hash before locking the Employee row to minimize lock duration.
		const hashedPassword = await hashPassword(password);

		if (userAccountType === 'employee') {
			await db.beginTransaction();
			transactionStarted = true;
			const [lockedEmployees] = await db.execute(
				'SELECT id FROM employees WHERE id = ? AND isDelete = 0 FOR UPDATE',
				[employee_id]
			);
			if (!lockedEmployees || lockedEmployees.length === 0) {
				return NextResponse.json(
					{ success: false, error: 'Employee not found' },
					{ status: 400 }
				);
			}
			const [owners] = await db.execute(
				'SELECT id FROM users WHERE employee_id = ? AND isDelete = 0 LIMIT 1',
				[employee_id]
			);
			if (owners && owners.length > 0) {
				return NextResponse.json(
					{
						success: false,
						error:
							'An account already owns this Employee. Restore or manage the existing account.',
					},
					{ status: 409 }
				);
			}
		}

		const [result] = await db.execute(
			`INSERT INTO users (username, password_hash, email, employee_id, vendor_id, account_type, role_id, permissions, department, full_name, created_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				username,
				hashedPassword,
				userEmail || null,
				userAccountType === 'employee' ? employee_id : null,
				userAccountType === 'vendor' ? vendor_id : null,
				userAccountType,
				role_id || null,
				permissions ? JSON.stringify(permissions) : null,
				roleData ? roleData.department : department,
				fullName || null,
				auth.user?.id ?? null,
			]
		);

		const [rows] = await db.execute(
			`SELECT u.id, u.username, u.email, u.full_name, u.role_id,
              u.employee_id, u.vendor_id, u.account_type, u.department,
              u.is_active, u.status, u.is_super_admin,
              u.permissions, u.field_permissions,
              u.created_at, u.last_login, u.last_password_change,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              v.vendor_name,
              r.role_name, r.role_code
       FROM users u
       LEFT JOIN employees e ON u.employee_id = e.id
       LEFT JOIN vendors v ON u.vendor_id = v.id
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE u.id = ?`,
			[result.insertId]
		);
		if (userAccountType === 'employee') {
			await db.commit();
			transactionStarted = false;
			transactionCommitted = true;
		}

		return NextResponse.json(
			{
				success: true,
				data: rows[0],
				message: 'User created successfully',
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('Error creating user:', error);
		if (transactionStarted && !transactionCommitted) {
			try {
				await db.rollback();
				transactionStarted = false;
			} catch (rollbackError) {
				console.error('Error rolling back user creation:', rollbackError);
			}
		}
		if (isAccountLinkConflict(error)) {
			const isForeignKeyConflict =
				error.code === 'ER_NO_REFERENCED_ROW_2' || error.errno === 1452;
			return NextResponse.json(
				{
					success: false,
					error: isForeignKeyConflict
						? 'Employee or vendor not found'
						: 'An account already owns this Employee. Restore or manage the existing account.',
				},
				{ status: isForeignKeyConflict ? 400 : 409 }
			);
		}
		return NextResponse.json(
			{ success: false, error: 'Failed to create user' },
			{ status: 500 }
		);
	} finally {
		if (db && transactionStarted && !transactionCommitted) {
			try {
				await db.rollback();
			} catch (rollbackError) {
				console.error('Error rolling back user creation:', rollbackError);
			}
			transactionStarted = false;
		}
		if (db) db.release();
	}
}

// PUT - update user
export async function PUT(request) {
	let db;
	try {
		// RBAC: update users
		const auth = await ensurePermission(
			request,
			API_RESOURCES.USERS,
			API_PERMISSIONS.UPDATE
		);
		if (auth instanceof Response) return auth;
		const data = await request.json();
		if (!data.id)
			return NextResponse.json(
				{ success: false, error: 'User id is required' },
				{ status: 400 }
			);

		db = await dbConnect();

		const [existing] = await db.execute(
			`SELECT u.id, u.employee_id, u.vendor_id, u.account_type, u.is_super_admin, u.role_id, r.role_hierarchy
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE u.id = ? AND u.isDelete = 0 LIMIT 1`,
			[data.id]
		);
		if (!existing || existing.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'User not found' },
				{ status: 404 }
			);
		}
		if (ownershipChangeRequested(data, existing[0])) {
			return NextResponse.json(
				{
					success: false,
					error: 'Account ownership cannot be changed through this endpoint',
				},
				{ status: 409 }
			);
		}

		// Check target user access
		const targetCheck = canModifyTargetUser(auth.user, existing[0]);
		if (!targetCheck.allowed) {
			return NextResponse.json(
				{ success: false, error: targetCheck.reason },
				{ status: 403 }
			);
		}

		// Check grants (role_id, permissions, field_permissions, is_super_admin)
		const isSelfUpdate = Number(data.id) === Number(auth.user.id);
		const grantCheck = await validateUserGrants(auth.user, data, db, {
			targetIsSelf: isSelfUpdate,
		});
		if (!grantCheck.allowed) {
			return NextResponse.json(
				{ success: false, error: grantCheck.reason },
				{ status: 403 }
			);
		}

		// check duplicate username/email
		if (data.username || data.email) {
			const [dups] = await db.execute(
				'SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ? AND isDelete = 0',
				[data.username || '', data.email || '', data.id]
			);
			if (dups.length > 0) {
				return NextResponse.json(
					{ success: false, error: 'Username or email already in use' },
					{ status: 409 }
				);
			}
		}

		const fields = [];
		const vals = [];
		// Allow updating role_id (system role), permissions, field_permissions, and user details
		// NOTE: password_hash is explicitly excluded (SEC-04)
		const allowed = [
			'username',
			'email',
			'role',
			'role_id',
			'permissions',
			'field_permissions',
			'full_name',
			'status',
			'is_active',
			'department',
		];

		console.log('[PUT /api/users] Received data keys:', Object.keys(data));
		console.log('[PUT /api/users] Permissions in request:', data.permissions);

		const accessState = resolveAccessState(data);
		if (!accessState) {
			return NextResponse.json(
				{
					success: false,
					error: 'status and is_active conflict or status is invalid',
				},
				{ status: 400 }
			);
		}
		allowed
			.filter((key) => key !== 'status' && key !== 'is_active')
			.forEach((k) => {
				if (Object.prototype.hasOwnProperty.call(data, k)) {
					if (k === 'permissions' || k === 'field_permissions') {
						fields.push(`${k} = ?`);
						vals.push(
							Array.isArray(data[k]) || (data[k] && typeof data[k] === 'object')
								? JSON.stringify(data[k])
								: null
						);
					} else if (k === 'role_id') {
						fields.push(`${k} = ?`);
						vals.push(data[k] === '' || data[k] === null ? null : data[k]);
					} else {
						fields.push(`${k} = ?`);
						vals.push(data[k]);
					}
				}
			});
		if (data.status !== undefined || data.is_active !== undefined) {
			fields.push('status = ?', 'is_active = ?');
			vals.push(accessState.status, accessState.is_active);
		}

		if (fields.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'No fields to update' },
				{ status: 400 }
			);
		}

		vals.push(data.id);
		await db.execute(
			`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND isDelete = 0`,
			vals
		);
		// If user was deactivated, revoke all active sessions immediately (SEC-05)
		const isDeactivating =
			(data.is_active !== undefined || data.status !== undefined) &&
			accessState.status === 'inactive';
		if (isDeactivating) {
			await revokeAllUserSessions(db, data.id);
		}

		// Invalidate the in-memory user cache so permission changes reflect
		// immediately instead of after the 5-minute TTL expires.
		invalidateUserCache(data.id);

		const [rows] = await db.execute(
			`SELECT id, username, email, full_name, role_id,
              employee_id, vendor_id, account_type, department,
              is_active, status, is_super_admin,
              permissions, field_permissions,
              created_at, last_login, last_password_change
       FROM users WHERE id = ? AND isDelete = 0`,
			[data.id]
		);

		return NextResponse.json({
			success: true,
			data: rows[0],
			message: 'User updated',
		});
	} catch (error) {
		console.error('Error updating user:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to update user' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

// DELETE - delete user by id query param
export async function DELETE(request) {
	let db;
	try {
		// RBAC: delete users
		const auth = await ensurePermission(
			request,
			API_RESOURCES.USERS,
			API_PERMISSIONS.DELETE
		);
		if (auth instanceof Response) return auth;
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');
		if (!id)
			return NextResponse.json(
				{ success: false, error: 'User id is required' },
				{ status: 400 }
			);

		db = await dbConnect();

		const [existing] = await db.execute(
			`SELECT u.id, u.is_super_admin, u.role_id, r.role_hierarchy
       FROM users u
       LEFT JOIN roles_master r ON u.role_id = r.id
       WHERE u.id = ? AND u.isDelete = 0 LIMIT 1`,
			[id]
		);
		if (!existing || existing.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'User not found' },
				{ status: 404 }
			);
		}

		const targetCheck = canModifyTargetUser(auth.user, existing[0]);
		if (!targetCheck.allowed) {
			return NextResponse.json(
				{ success: false, error: targetCheck.reason },
				{ status: 403 }
			);
		}

		await db.execute(
			'UPDATE users SET isDelete = 1 WHERE id = ? AND isDelete = 0',
			[id]
		);
		// Revoke all sessions for deleted user (SEC-05)
		await revokeAllUserSessions(db, id);

		// Drop cached permissions so a deleted user's session stops being honored.
		invalidateUserCache(id);

		return NextResponse.json({ success: true, message: 'User deleted' });
	} catch (error) {
		console.error('Error deleting user:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete user' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
