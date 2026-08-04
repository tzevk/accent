import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// project-docs API: manages concrete documents attached to individual projects
// Table schema (created lazily): project_documents
// Fields: id (uuid), project_id (int fk projects.id), name, doc_master_id (nullable, references documents_master.id), file_url, thumb_url, description, status, metadata (JSON), created_at, updated_at

export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const projectId = searchParams.get('project_id');
		db = await dbConnect();

		let rows;
		if (projectId) {
			const [r] = await db.execute(
				`SELECT pd.*, dm.name as master_name, dm.doc_key FROM project_documents pd
         LEFT JOIN documents_master dm ON pd.doc_master_id = dm.id
         WHERE pd.project_id = ? ORDER BY pd.created_at DESC`,
				[projectId]
			);
			rows = r;
		} else {
			const [r] = await db.execute(
				`SELECT pd.*, dm.name as master_name, dm.doc_key FROM project_documents pd
         LEFT JOIN documents_master dm ON pd.doc_master_id = dm.id
         ORDER BY pd.created_at DESC`
			);
			rows = r;
		}

		return NextResponse.json({ success: true, data: rows });
	} catch (error) {
		console.error('project-docs GET error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to load project documents',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function POST(request) {
	// RBAC check
	const authResultPost = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.UPDATE
	);
	if (authResultPost instanceof Response) return authResultPost;
	if (!authResultPost.authorized) return authResultPost.response;

	let db;
	try {
		const body = await request.json();
		const {
			project_id,
			name,
			file_url = null,
			thumb_url = null,
			description = '',
			status = 'active',
			doc_master_id = null,
			metadata = null,
		} = body;
		if (!project_id || !name) {
			return NextResponse.json(
				{ success: false, error: 'project_id and name are required' },
				{ status: 400 }
			);
		}
		db = await dbConnect();

		// Ensure project exists
		const [proj] = await db.execute('SELECT id FROM projects WHERE id = ?', [
			project_id,
		]);
		if (proj.length === 0) {
			return NextResponse.json(
				{ success: false, error: 'Project not found' },
				{ status: 404 }
			);
		}

		const id = randomUUID();
		await db.execute(
			`INSERT INTO project_documents (id, project_id, doc_master_id, name, file_url, thumb_url, description, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				project_id,
				doc_master_id || null,
				name,
				file_url,
				thumb_url,
				description,
				status,
				metadata
					? typeof metadata === 'string'
						? metadata
						: JSON.stringify(metadata)
					: null,
			]
		);

		return NextResponse.json(
			{ success: true, data: { id }, message: 'Document linked to project' },
			{ status: 201 }
		);
	} catch (error) {
		console.error('project-docs POST error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to add project document',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function PUT(request) {
	// RBAC check
	const authResultPut = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.UPDATE
	);
	if (authResultPut instanceof Response) return authResultPut;
	if (!authResultPut.authorized) return authResultPut.response;

	let db;
	try {
		const body = await request.json();
		const { id, name, description, status, metadata } = body;
		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'id is required' },
				{ status: 400 }
			);
		}
		db = await dbConnect();
		await db.execute(
			`UPDATE project_documents SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         status = COALESCE(?, status),
         metadata = COALESCE(?, metadata)
       WHERE id = ?`,
			[
				name ?? null,
				description ?? null,
				status ?? null,
				metadata
					? typeof metadata === 'string'
						? metadata
						: JSON.stringify(metadata)
					: null,
				id,
			]
		);

		return NextResponse.json({
			success: true,
			message: 'Project document updated',
		});
	} catch (error) {
		console.error('project-docs PUT error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to update project document',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}

export async function DELETE(request) {
	// RBAC check
	const authResultDel = await ensurePermission(
		request,
		RESOURCES.PROJECTS,
		PERMISSIONS.DELETE
	);
	if (authResultDel instanceof Response) return authResultDel;
	if (!authResultDel.authorized) return authResultDel.response;

	let db;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');
		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'id is required' },
				{ status: 400 }
			);
		}
		db = await dbConnect();
		await db.execute('DELETE FROM project_documents WHERE id = ?', [id]);

		return NextResponse.json({
			success: true,
			message: 'Project document removed',
		});
	} catch (error) {
		console.error('project-docs DELETE error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to delete project document',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (db) db.release();
	}
}
