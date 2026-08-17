import { NextResponse } from 'next/server';
import { ensurePermission, PERMISSIONS } from '@/utils/api-permissions';
import {
	ENTITY_RESOURCE_MAP,
	ALLOWED_TYPES,
	ALLOWED_EXTENSIONS,
	MAX_FILE_SIZE,
	verifyEntityExists,
} from '@/utils/document-helpers';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { query } from '@/utils/database';

/**
 * POST /api/document-upload
 * Upload a document for a project, purchase order, or invoice.
 * Expects multipart/form-data with fields: file, entity_type, entity_id
 */
export async function POST(request) {
	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const entityType = formData.get('entity_type'); // project | purchase_order | invoice
		const entityId = formData.get('entity_id');

		if (!file || typeof file !== 'object') {
			return NextResponse.json(
				{ success: false, error: 'No file uploaded' },
				{ status: 400 }
			);
		}
		if (!entityType || !entityId) {
			return NextResponse.json(
				{ success: false, error: 'entity_type and entity_id are required' },
				{ status: 400 }
			);
		}
		if (!['project', 'purchase_order', 'invoice'].includes(entityType)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid entity_type' },
				{ status: 400 }
			);
		}

		const numericEntityId = parseInt(entityId, 10);
		if (isNaN(numericEntityId) || numericEntityId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Invalid entity_id' },
				{ status: 400 }
			);
		}

		// RBAC authorization check (SEC-06)
		const resource = ENTITY_RESOURCE_MAP[entityType];
		const auth = await ensurePermission(request, resource, PERMISSIONS.UPDATE);
		if (auth instanceof Response) return auth;
		if (!auth.authorized) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		// Verify target entity exists and is active (SEC-06 IDOR check)
		const exists = await verifyEntityExists(entityType, numericEntityId);
		if (!exists) {
			return NextResponse.json(
				{ success: false, error: `${entityType} not found` },
				{ status: 404 }
			);
		}

		// Check file type & extension
		const fileName = file.name || '';
		const fileExt = fileName.toLowerCase().split('.').pop() || '';
		const isMimeAllowed = ALLOWED_TYPES[file.type];
		const isExtAllowed = ALLOWED_EXTENSIONS.includes(fileExt);
		if (!isMimeAllowed || !isExtAllowed) {
			return NextResponse.json(
				{
					success: false,
					error:
						'File type not allowed. Allowed: PDF, DOC, DOCX, PPTX, XLS, XLSX, JPG, PNG',
				},
				{ status: 400 }
			);
		}

		// Check file size
		if (file.size > MAX_FILE_SIZE) {
			return NextResponse.json(
				{
					success: false,
					error: 'File size exceeds 20MB limit',
				},
				{ status: 400 }
			);
		}

		// Generate secure unique filename with UUID only — never embed entityId (SEC-10 Path Traversal)
		const extension = ALLOWED_TYPES[file.type] || `.${fileExt}`;
		const docId = uuidv4();
		const uniqueFilename = `${docId}${extension}`;

		// Store in private directory (SEC-06)
		const uploadDir = path.join(process.cwd(), 'private', 'documents');
		if (!existsSync(uploadDir)) {
			await mkdir(uploadDir, { recursive: true });
		}

		// Save file to disk
		const filePath = path.join(uploadDir, uniqueFilename);
		const bytes = await file.arrayBuffer();
		const buffer = Buffer.from(bytes);
		await writeFile(filePath, buffer);

		const downloadUrl = `/api/document-upload/download?id=${docId}`;
		const safeOriginalName = path.basename(fileName);

		// Insert DB record
		await query(
			`INSERT INTO entity_documents (id, entity_type, entity_id, original_name, file_name, file_url, file_type, file_size, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				docId,
				entityType,
				numericEntityId,
				safeOriginalName,
				uniqueFilename,
				downloadUrl,
				file.type,
				file.size,
				auth.user.id,
			]
		);

		return NextResponse.json({
			success: true,
			data: {
				id: docId,
				original_name: safeOriginalName,
				file_name: uniqueFilename,
				file_url: downloadUrl,
				file_type: file.type,
				file_size: file.size,
			},
		});
	} catch (error) {
		console.error('[Document Upload] Error:', error);
		return NextResponse.json(
			{ success: false, error: 'Upload failed' },
			{ status: 500 }
		);
	}
}

/**
 * GET /api/document-upload?entity_type=project&entity_id=123
 * List all documents for a given entity with RBAC authorization
 */
export async function GET(request) {
	try {
		const { searchParams } = new URL(request.url);
		const entityType = searchParams.get('entity_type');
		const entityId = searchParams.get('entity_id');

		if (!entityType || !entityId) {
			return NextResponse.json(
				{ success: false, error: 'entity_type and entity_id are required' },
				{ status: 400 }
			);
		}

		if (!['project', 'purchase_order', 'invoice'].includes(entityType)) {
			return NextResponse.json(
				{ success: false, error: 'Invalid entity_type' },
				{ status: 400 }
			);
		}

		const numericEntityId = parseInt(entityId, 10);
		if (isNaN(numericEntityId) || numericEntityId <= 0) {
			return NextResponse.json(
				{ success: false, error: 'Invalid entity_id' },
				{ status: 400 }
			);
		}

		// RBAC authorization check (SEC-06)
		const resource = ENTITY_RESOURCE_MAP[entityType];
		const auth = await ensurePermission(request, resource, PERMISSIONS.READ);
		if (auth instanceof Response) return auth;
		if (!auth.authorized) {
			return NextResponse.json(
				{ success: false, error: 'Forbidden' },
				{ status: 403 }
			);
		}

		// Verify target entity exists and is active (SEC-06 IDOR check)
		const exists = await verifyEntityExists(entityType, numericEntityId);
		if (!exists) {
			return NextResponse.json(
				{ success: false, error: `${entityType} not found` },
				{ status: 404 }
			);
		}

		const [rows] = await query(
			`SELECT id, entity_type, entity_id, original_name, file_name, file_url, file_type, file_size, uploaded_by, created_at 
       FROM entity_documents 
       WHERE entity_type = ? AND entity_id = ? 
       ORDER BY created_at DESC`,
			[entityType, numericEntityId]
		);

		// Ensure all file_url entries point to the authenticated download endpoint
		const documents = (rows || []).map((doc) => ({
			...doc,
			file_url: `/api/document-upload/download?id=${doc.id}`,
		}));

		return NextResponse.json({ success: true, data: documents });
	} catch (error) {
		console.error('[Document Upload] GET Error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch documents' },
			{ status: 500 }
		);
	}
}

/**
 * DELETE /api/document-upload?id=<doc_uuid>
 * Delete a document with RBAC authorization and ownership verification
 */
export async function DELETE(request) {
	try {
		const { searchParams } = new URL(request.url);
		const docId = searchParams.get('id');

		if (!docId) {
			return NextResponse.json(
				{ success: false, error: 'Document id is required' },
				{ status: 400 }
			);
		}

		// Look up document
		const [docs] = await query(
			`SELECT id, entity_type, entity_id, original_name, file_name, file_url, uploaded_by 
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

		// Authorization check:
		// 1. Caller with resource:delete or super_admin can delete any doc for that entity.
		// 2. Caller with resource:update can delete documents they uploaded themselves.
		const authDelete = await ensurePermission(
			request,
			resource,
			PERMISSIONS.DELETE
		);
		const canDeleteDirectly =
			!(authDelete instanceof Response) &&
			(authDelete.user?.is_super_admin || authDelete.authorized);

		if (!canDeleteDirectly) {
			const authUpdate = await ensurePermission(
				request,
				resource,
				PERMISSIONS.UPDATE
			);
			if (authUpdate instanceof Response) return authUpdate;
			if (!authUpdate.authorized) {
				return NextResponse.json(
					{ success: false, error: 'Forbidden' },
					{ status: 403 }
				);
			}

			const isOwner =
				doc.uploaded_by &&
				Number(doc.uploaded_by) === Number(authUpdate.user?.id);
			if (!isOwner && !authUpdate.user?.is_super_admin) {
				return NextResponse.json(
					{
						success: false,
						error: 'Forbidden: you can only delete documents you uploaded',
					},
					{ status: 403 }
				);
			}
		}

		// Delete from DB
		await query(`DELETE FROM entity_documents WHERE id = ?`, [docId]);

		// Safely delete file from disk (SEC-10 Path Traversal prevention)
		try {
			const safeFileName = path.basename(doc.file_name || doc.file_url);
			const privateFilePath = path.join(
				process.cwd(),
				'private',
				'documents',
				safeFileName
			);
			if (existsSync(privateFilePath)) {
				await unlink(privateFilePath);
			} else {
				// Check legacy public path if it existed
				const publicFilePath = path.join(
					process.cwd(),
					'public',
					'uploads',
					'documents',
					safeFileName
				);
				if (existsSync(publicFilePath)) {
					await unlink(publicFilePath);
				}
			}
		} catch {
			// File may already be deleted on disk — ignore unlink errors
		}

		return NextResponse.json({
			success: true,
			message: 'Document deleted successfully',
		});
	} catch (error) {
		console.error('[Document Upload] DELETE Error:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to delete document' },
			{ status: 500 }
		);
	}
}
