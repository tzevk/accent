import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { verifyPassword } from '@/utils/password';

export async function POST(request) {
	let db;
	try {
		const { username, password } = await request.json();

		if (!username || !password) {
			return NextResponse.json(
				{ error: 'Username and password are required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();

		const [rows] = await db.execute(
			'SELECT id, username, password_hash FROM users WHERE username = ? AND isDelete = 0 LIMIT 1',
			[username]
		);

		if (rows.length === 0) {
			return NextResponse.json(
				{ error: 'Invalid credentials' },
				{ status: 401 }
			);
		}

		const valid = await verifyPassword(password, rows[0].password_hash);
		if (!valid) {
			return NextResponse.json(
				{ error: 'Invalid credentials' },
				{ status: 401 }
			);
		}

		return NextResponse.json(
			{ success: true, message: 'Login successful' },
			{ status: 200 }
		);
	} catch (error) {
		console.error('Login error:', error);
		return NextResponse.json(
			{ error: 'Internal server error' },
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
