import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import {
	loadLeadPolicy,
	projectAccessDeniedResponse,
	requireProjectAccess,
} from '@/lib/project-rights';

// Allowed file types for MOM (Minutes of Meeting) documents
const ALLOWED_TYPES = {
	'application/pdf': '.pdf',
	'application/msword': '.doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
		'.docx',
	'application/vnd.ms-excel': '.xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
	'application/vnd.ms-powerpoint': '.ppt',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation':
		'.pptx',
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'text/plain': '.txt',
};

const ALLOWED_EXTENSIONS = [
	'pdf',
	'doc',
	'docx',
	'xls',
	'xlsx',
	'ppt',
	'pptx',
	'jpg',
	'jpeg',
	'png',
	'txt',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function requireMomAccess(request, projectId, right) {
	const access = await requireProjectAccess(request, projectId, {
		getLeadPolicy: loadLeadPolicy,
	});
	if ('response' in access) return access;
	if (!access.rights.sections.minutes_internal_meet[right]) {
		return { response: projectAccessDeniedResponse() };
	}
	return access;
}

function releaseAccess(access) {
	if (access?.ownsDb) access.db.release?.();
}

function projectKey(project) {
	return project.project_id ?? project.id;
}

/**
 * POST /api/projects/mom-upload
 * Upload a MOM (Minutes of Meeting) document attachment.
 * Fields: file, project_id.
 */
export async function POST(request) {
	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const projectId = formData.get('project_id');

		if (!file) {
			return NextResponse.json(
				{ success: false, error: 'No file uploaded' },
				{ status: 400 }
			);
		}
		if (!projectId) {
			return NextResponse.json(
				{ success: false, error: 'project_id is required' },
				{ status: 400 }
			);
		}

		// Check file type by extension
		const fileName = file.name || '';
		const fileExt = fileName.toLowerCase().split('.').pop();

		if (!ALLOWED_TYPES[file.type] && !ALLOWED_EXTENSIONS.includes(fileExt)) {
			return NextResponse.json(
				{
					success: false,
					error: `File type not allowed. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, PNG, TXT`,
				},
				{ status: 400 }
			);
		}

		// Check file size
		if (file.size > MAX_FILE_SIZE) {
			return NextResponse.json(
				{
					success: false,
					error: 'File size exceeds 10MB limit',
				},
				{ status: 400 }
			);
		}

		const access = await requireMomAccess(request, projectId, 'edit');
		if ('response' in access) return access.response;
		const { project, user, db } = access;

		try {
			const docId = uuidv4();
			const bytes = await file.arrayBuffer();
			const buffer = Buffer.from(bytes);
			await db.execute(
				`INSERT INTO project_mom_documents (id, project_id, original_name, file_type, file_size, file_data, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					docId,
					projectKey(project),
					file.name,
					file.type || 'application/octet-stream',
					file.size,
					buffer,
					user.id || null,
				]
			);

			return NextResponse.json({
				success: true,
				data: {
					id: docId,
					file_name: fileName,
					original_name: file.name,
					file_url: `/api/projects/mom-upload?id=${docId}&project_id=${projectKey(project)}`,
					file_type: file.type,
					file_size: file.size,
				},
			});
		} finally {
			releaseAccess(access);
		}
	} catch (error) {
		console.error('[MOM Upload] Error:', error);
		return NextResponse.json(
			{ success: false, error: 'Upload failed' },
			{ status: 500 }
		);
	}
}

/**
 * GET /api/projects/mom-upload?id=<docId>&project_id=<project>
 * Fetch MOM document content by id within its project.
 */
export async function GET(request) {
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');
		const projectId = searchParams.get('project_id');
		if (!id) {
			return NextResponse.json(
				{ success: false, error: 'Document id is required' },
				{ status: 400 }
			);
		}
		if (!projectId) {
			return NextResponse.json(
				{ success: false, error: 'project_id is required' },
				{ status: 400 }
			);
		}

		const access = await requireMomAccess(request, projectId, 'read');
		if ('response' in access) return access.response;
		const { project, db } = access;

		try {
			const [rows] = await db.execute(
				`SELECT id, original_name, file_type, file_data FROM project_mom_documents WHERE id = ? AND project_id = ? LIMIT 1`,
				[id, projectKey(project)]
			);

			if (!rows || rows.length === 0) {
				return NextResponse.json(
					{ success: false, error: 'Document not found' },
					{ status: 404 }
				);
			}

			const doc = rows[0];
			const contentType = doc.file_type || 'application/octet-stream';
			const fileBuffer = doc.file_data;
			const safeName = String(doc.original_name || 'mom-document').replace(
				/[\r\n"]/g,
				''
			);

			return new NextResponse(fileBuffer, {
				status: 200,
				headers: {
					'Content-Type': contentType,
					'Content-Disposition': `inline; filename="${safeName}"`,
					'Cache-Control': 'private, max-age=3600',
				},
			});
		} finally {
			releaseAccess(access);
		}
	} catch (error) {
		console.error('[MOM Download] Error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch document' },
			{ status: 500 }
		);
	}
}
