import {
	RESOURCES,
	PERMISSIONS,
	getCurrentUser,
	ensurePermission,
} from '@/utils/api-permissions';
import { query } from '@/utils/database';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export const ENTITY_RESOURCE_MAP = {
	project: RESOURCES.PROJECTS,
	purchase_order: RESOURCES.PURCHASE_ORDERS,
	invoice: RESOURCES.INVOICES,
};

export const ALLOWED_TYPES = {
	'application/pdf': '.pdf',
	'application/msword': '.doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
		'.docx',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation':
		'.pptx',
	'application/vnd.ms-powerpoint': '.ppt',
	'application/vnd.ms-excel': '.xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
	'image/jpeg': '.jpg',
	'image/png': '.png',
};

export const ALLOWED_EXTENSIONS = [
	'pdf',
	'doc',
	'docx',
	'pptx',
	'ppt',
	'xls',
	'xlsx',
	'jpg',
	'jpeg',
	'png',
];

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

/**
 * Verify whether the referenced entity exists and is not soft-deleted
 */
export async function verifyEntityExists(entityType, entityId) {
	const id = parseInt(entityId, 10);
	if (isNaN(id) || id <= 0) return false;

	if (entityType === 'project') {
		const [rows] = await query(
			'SELECT id FROM projects WHERE id = ? AND isDelete = 0',
			[id]
		);
		return Array.isArray(rows) && rows.length > 0;
	} else if (entityType === 'purchase_order') {
		const [rows] = await query(
			'SELECT id FROM purchase_orders WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)',
			[id]
		);
		if (Array.isArray(rows) && rows.length > 0) return true;
		const [projectPoRows] = await query(
			'SELECT id FROM project_purchase_orders WHERE id = ?',
			[id]
		);
		return Array.isArray(projectPoRows) && projectPoRows.length > 0;
	} else if (entityType === 'invoice') {
		const [rows] = await query(
			'SELECT id FROM invoices WHERE id = ? AND isDelete = 0',
			[id]
		);
		return Array.isArray(rows) && rows.length > 0;
	}
	return false;
}

/**
 * Common handler for authenticated document downloads
 */
export async function handleDocumentDownload(request, docId) {
	const currentUser = await getCurrentUser(request);
	if (!currentUser) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	if (!docId) {
		return NextResponse.json(
			{ success: false, error: 'Document id is required' },
			{ status: 400 }
		);
	}

	// 1. Fetch document record
	const [docs] = await query(
		`SELECT id, entity_type, entity_id, original_name, file_name, file_url, file_type, file_size 
     FROM entity_documents WHERE id = ?`,
		[docId]
	);

	if (!docs || !docs.length) {
		return NextResponse.json(
			{ success: false, error: 'Document not found' },
			{ status: 404 }
		);
	}

	const doc = docs[0];
	const resource = ENTITY_RESOURCE_MAP[doc.entity_type];
	if (!resource) {
		return NextResponse.json(
			{ success: false, error: 'Invalid document entity type' },
			{ status: 400 }
		);
	}

	// 2. Enforce RBAC READ authorization on the target entity (SEC-06)
	const auth = await ensurePermission(request, resource, PERMISSIONS.READ);
	if (auth instanceof Response) return auth;
	if (!auth.authorized) {
		return NextResponse.json(
			{ success: false, error: 'Forbidden' },
			{ status: 403 }
		);
	}

	// 3. Verify target entity exists and is active (SEC-06 IDOR check)
	const exists = await verifyEntityExists(doc.entity_type, doc.entity_id);
	if (!exists) {
		return NextResponse.json(
			{ success: false, error: `${doc.entity_type} not found` },
			{ status: 404 }
		);
	}

	// 4. Safely locate file on disk (SEC-10 Path Traversal prevention)
	const safeFileName = path.basename(doc.file_name || doc.file_url);
	const privateFilePath = path.join(
		process.cwd(),
		'private',
		'documents',
		safeFileName
	);

	let targetFilePath = null;
	if (existsSync(privateFilePath)) {
		targetFilePath = privateFilePath;
	} else {
		// Fallback for legacy uploads in public directory
		const publicFilePath = path.join(
			process.cwd(),
			'public',
			'uploads',
			'documents',
			safeFileName
		);
		if (existsSync(publicFilePath)) {
			targetFilePath = publicFilePath;
		}
	}

	if (!targetFilePath) {
		return NextResponse.json(
			{ success: false, error: 'File not found on server' },
			{ status: 404 }
		);
	}

	// 5. Read file and serve with strict security headers (SEC-06 & SEC-24)
	try {
		const fileBuffer = await readFile(targetFilePath);
		const safeOriginalName = (doc.original_name || safeFileName).replace(
			/["\r\n]/g,
			'_'
		);
		const contentType = doc.file_type || 'application/octet-stream';

		return new NextResponse(fileBuffer, {
			status: 200,
			headers: {
				'Content-Type': contentType,
				'Content-Disposition': `attachment; filename="${encodeURIComponent(safeOriginalName)}"`,
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control': 'private, no-cache, no-store, must-revalidate',
				Pragma: 'no-cache',
			},
		});
	} catch (err) {
		console.error('[Document Download] Read Error:', err);
		return NextResponse.json(
			{ success: false, error: 'Failed to read document file' },
			{ status: 500 }
		);
	}
}
