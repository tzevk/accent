import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { randomUUID } from 'crypto';

/**
 * GET /api/masters/banks
 * List all banks
 */
export async function GET(request) {
	let db;

	try {
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			return NextResponse.json(
				{ success: false, error: 'Authentication failed' },
				{ status: 500 }
			);
		}

		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		db = await dbConnect();

		// Create table if not exists (in case schema-init wasn't run)
		await db.execute(`
      CREATE TABLE IF NOT EXISTS bank_master (
        BankID VARCHAR(36) PRIMARY KEY,
        BankCode VARCHAR(10) UNIQUE,
        BankName VARCHAR(255) NOT NULL,
        IFSC_Prefix CHAR(4),
        SWIFT_Code VARCHAR(11),
        LEI_Code VARCHAR(20),
        HeadOfficeAddress TEXT,
        IsActive BOOLEAN DEFAULT TRUE,
        CreatedDate DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

		const { searchParams } = new URL(request.url);
		const activeOnly = searchParams.get('active') === 'true';

		let query = 'SELECT * FROM bank_master';
		if (activeOnly) {
			query += ' WHERE IsActive = TRUE';
		}
		query += ' ORDER BY BankName ASC';

		const [banks] = await db.execute(query);

		return NextResponse.json({
			success: true,
			data: banks,
		});
	} catch (error) {
		console.error('Get banks error:', error?.message);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch banks' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}

/**
 * POST /api/masters/banks
 * Create a new bank
 */
export async function POST(request) {
	let db;

	try {
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			return NextResponse.json(
				{ success: false, error: 'Authentication failed' },
				{ status: 500 }
			);
		}

		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const data = await request.json();
		const {
			BankCode,
			BankName,
			IFSC_Prefix,
			SWIFT_Code,
			LEI_Code,
			HeadOfficeAddress,
			IsActive,
		} = data;

		if (!BankCode || !BankName) {
			return NextResponse.json(
				{ success: false, error: 'Bank Code and Bank Name are required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const bankId = randomUUID();

		const [result] = await db.execute(
			`INSERT INTO bank_master (BankID, BankCode, BankName, IFSC_Prefix, SWIFT_Code, LEI_Code, HeadOfficeAddress, IsActive)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				bankId,
				BankCode,
				BankName,
				IFSC_Prefix || '',
				SWIFT_Code || '',
				LEI_Code || '',
				HeadOfficeAddress || '',
				IsActive !== false,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'Bank created successfully',
			id: bankId,
		});
	} catch (error) {
		console.error('Create bank error:', error?.message);
		if (error.code === 'ER_DUP_ENTRY') {
			return NextResponse.json(
				{ success: false, error: 'Bank Code already exists' },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ success: false, error: 'Failed to create bank' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}

/**
 * PUT /api/masters/banks?id=X
 * Update a bank
 */
export async function PUT(request) {
	let db;

	try {
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			return NextResponse.json(
				{ success: false, error: 'Authentication failed' },
				{ status: 500 }
			);
		}

		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Bank ID is required' },
				{ status: 400 }
			);
		}

		const data = await request.json();
		const {
			BankCode,
			BankName,
			IFSC_Prefix,
			SWIFT_Code,
			LEI_Code,
			HeadOfficeAddress,
			IsActive,
		} = data;

		if (!BankCode || !BankName) {
			return NextResponse.json(
				{ success: false, error: 'Bank Code and Bank Name are required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		await db.execute(
			`UPDATE bank_master 
       SET BankCode = ?, BankName = ?, IFSC_Prefix = ?, SWIFT_Code = ?, LEI_Code = ?, HeadOfficeAddress = ?, IsActive = ?
       WHERE BankID = ?`,
			[
				BankCode,
				BankName,
				IFSC_Prefix || '',
				SWIFT_Code || '',
				LEI_Code || '',
				HeadOfficeAddress || '',
				IsActive !== false,
				id,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'Bank updated successfully',
		});
	} catch (error) {
		console.error('Update bank error:', error?.message);
		if (error.code === 'ER_DUP_ENTRY') {
			return NextResponse.json(
				{ success: false, error: 'Bank Code already exists' },
				{ status: 400 }
			);
		}
		return NextResponse.json(
			{ success: false, error: 'Failed to update bank' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}

/**
 * DELETE /api/masters/banks?id=X
 * Delete a bank
 */
export async function DELETE(request) {
	let db;

	try {
		let user;
		try {
			user = await getCurrentUser(request);
		} catch (authErr) {
			return NextResponse.json(
				{ success: false, error: 'Authentication failed' },
				{ status: 500 }
			);
		}

		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Bank ID is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		await db.execute('DELETE FROM bank_master WHERE BankID = ?', [id]);

		return NextResponse.json({
			success: true,
			message: 'Bank deleted successfully',
		});
	} catch (error) {
		console.error('Delete bank error:', error?.message);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete bank' },
			{ status: 500 }
		);
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}
