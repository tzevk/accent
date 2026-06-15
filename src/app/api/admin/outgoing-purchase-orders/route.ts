/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export async function GET(request: Request) {
	// RBAC check
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

	let connection: any;
	try {
		connection = await dbConnect();

		// Create table if not exists
		await connection.execute(`
			CREATE TABLE IF NOT EXISTS outgoing_purchase_orders (
				id INT AUTO_INCREMENT PRIMARY KEY,
				sr_no INT,
				company_name VARCHAR(255) NOT NULL,
				city VARCHAR(255),
				po_number VARCHAR(100) UNIQUE NOT NULL,
				po_date DATE,
				po_amount DECIMAL(15, 2) NOT NULL,
				project_number VARCHAR(100),
				remarks TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		const [rows] = await connection.execute(
			'SELECT * FROM outgoing_purchase_orders ORDER BY created_at DESC'
		);
		return NextResponse.json({ success: true, data: rows });
	} catch (error: any) {
		console.error('Error fetching outgoing purchase orders:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to fetch outgoing purchase orders',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) {
			try {
				await connection.release();
			} catch {
				try {
					await connection.end();
				} catch {}
			}
		}
	}
}

export async function POST(request: Request) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.CREATE
	);
	if (authResult.authorized === false) return authResult.response;

	let connection: any;
	try {
		const body = await request.json();
		const {
			company_name,
			city,
			po_number,
			po_date,
			po_amount,
			project_number,
			remarks,
		} = body;

		if (!company_name || !po_number || !po_date || !po_amount) {
			return NextResponse.json(
				{ success: false, message: 'Missing required fields' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		// Ensure table exists
		await connection.execute(`
			CREATE TABLE IF NOT EXISTS outgoing_purchase_orders (
				id INT AUTO_INCREMENT PRIMARY KEY,
				sr_no INT,
				company_name VARCHAR(255) NOT NULL,
				city VARCHAR(255),
				po_number VARCHAR(100) UNIQUE NOT NULL,
				po_date DATE,
				po_amount DECIMAL(15, 2) NOT NULL,
				project_number VARCHAR(100),
				remarks TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
			)
		`);

		// Get next serial number
		const [countResult]: any = await connection.execute(
			'SELECT COUNT(*) as total FROM outgoing_purchase_orders'
		);
		const total = countResult[0]?.total || 0;
		const nextSrNo = total + 1;

		const [result]: any = await connection.execute(
			`INSERT INTO outgoing_purchase_orders 
			 (sr_no, company_name, city, po_number, po_date, po_amount, project_number, remarks)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				nextSrNo,
				company_name,
				city || null,
				po_number,
				po_date,
				parseFloat(po_amount),
				project_number || null,
				remarks || null,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'Outgoing purchase order created successfully',
			data: { id: result.insertId, sr_no: nextSrNo },
		});
	} catch (error: any) {
		console.error('Error creating outgoing purchase order:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to create outgoing purchase order',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) {
			try {
				await connection.release();
			} catch {
				try {
					await connection.end();
				} catch {}
			}
		}
	}
}

export async function DELETE(request: Request) {
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.DELETE
	);
	if (authResult.authorized === false) return authResult.response;

	let connection: any;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, message: 'ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();
		await connection.execute(
			'DELETE FROM outgoing_purchase_orders WHERE id = ?',
			[id]
		);

		return NextResponse.json({
			success: true,
			message: 'Outgoing purchase order deleted successfully',
		});
	} catch (error: any) {
		console.error('Error deleting outgoing purchase order:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to delete outgoing purchase order',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (connection) {
			try {
				await connection.release();
			} catch {
				try {
					await connection.end();
				} catch {}
			}
		}
	}
}
