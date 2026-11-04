import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { dbConnect } from '@/utils/database';
import {
	loadLeadPolicy,
	projectAccessDeniedResponse,
	requireProjectAccess,
} from '@/lib/project-rights';

// project-docs API: manages concrete documents attached to individual projects
// Table schema (created lazily): project_documents
// Fields: id (uuid), project_id (int fk projects.id), name, doc_master_id (nullable, references documents_master.id), file_url, thumb_url, description, status, metadata (JSON), created_at, updated_at
//
// Every operation is scoped to one project and to its `upload_documents`
// section right. There is no all-project document listing.

function denied() {
	return projectAccessDeniedResponse();
}

async function requireDocumentSection(request, projectId, right, db) {
	const access = await requireProjectAccess(request, projectId, {
		db,
		getLeadPolicy: loadLeadPolicy,
	});
	if ('response' in access) return access;
	const section = access.rights.sections.upload_documents;
	if (!section[right]) {
		return { response: denied() };
	}
	return access;
}

/** The stored document's project id, or null when it does not exist. */
async function storedProjectId(db, documentId) {
	const [rows] = await db.execute(
		'SELECT project_id FROM project_documents WHERE id = ? LIMIT 1',
		[documentId]
	);
	const row = Array.isArray(rows) ? rows[0] : null;
	return row?.project_id ?? null;
}

export async function GET(request) {
	const { searchParams } = new URL(request.url);
	const projectId = searchParams.get('project_id');
	if (!projectId) {
		return NextResponse.json(
			{ success: false, error: 'project_id is required' },
			{ status: 400 }
		);
	}

	const access = await requireDocumentSection(request, projectId, 'read');
	if ('response' in access) return access.response;
	const { project, db, ownsDb } = access;

	try {
		const [rows] = await db.execute(
			`SELECT pd.*, dm.name as master_name, dm.doc_key FROM project_documents pd
         LEFT JOIN documents_master dm ON pd.doc_master_id = dm.id
         WHERE pd.project_id = ? ORDER BY pd.created_at DESC`,
			[project.project_id ?? project.id]
		);

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
		if (ownsDb) db.release?.();
	}
}

export async function POST(request) {
	let body;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json(
			{ success: false, error: 'Malformed request body' },
			{ status: 400 }
		);
	}

	const {
		project_id,
		name,
		file_url = null,
		thumb_url = null,
		description = '',
		status = 'active',
		doc_master_id = null,
		metadata = null,
	} = body || {};
	if (!project_id || !name) {
		return NextResponse.json(
			{ success: false, error: 'project_id and name are required' },
			{ status: 400 }
		);
	}

	const access = await requireDocumentSection(request, project_id, 'edit');
	if ('response' in access) return access.response;
	const { project, db, ownsDb } = access;

	try {
		const id = randomUUID();
		await db.execute(
			`INSERT INTO project_documents (id, project_id, doc_master_id, name, file_url, thumb_url, description, status, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				project.project_id ?? project.id,
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
		if (ownsDb) db.release?.();
	}
}

export async function PUT(request) {
	let db;
	try {
		const body = await request.json();
		const { id, name, description, status, metadata } = body || {};
		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'id is required' },
				{ status: 400 }
			);
		}

		db = await dbConnect();
		const projectId = await storedProjectId(db, id);
		if (!projectId) {
			return NextResponse.json(
				{ success: false, error: 'Document not found' },
				{ status: 404 }
			);
		}

		const access = await requireDocumentSection(
			request,
			projectId,
			'edit',
			db
		);
		if ('response' in access) return access.response;

		await db.execute(
			`UPDATE project_documents SET
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         status = COALESCE(?, status),
         metadata = COALESCE(?, metadata)
       WHERE id = ? AND project_id = ?`,
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
				access.project.project_id ?? access.project.id,
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
		if (db) db.release?.();
	}
}

export async function DELETE(request) {
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
		const projectId = await storedProjectId(db, id);
		if (!projectId) {
			return NextResponse.json(
				{ success: false, error: 'Document not found' },
				{ status: 404 }
			);
		}

		const access = await requireDocumentSection(
			request,
			projectId,
			'edit',
			db
		);
		if ('response' in access) return access.response;

		await db.execute(
			'DELETE FROM project_documents WHERE id = ? AND project_id = ?',
			[id, access.project.project_id ?? access.project.id]
		);

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
		if (db) db.release?.();
	}
}
