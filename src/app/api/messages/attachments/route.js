import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import {
	hasMarkupSignature,
	MARKUP_REJECTION_ERROR,
} from '@/lib/upload-validation';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Allowed file types
const ALLOWED_TYPES = {
	'application/pdf': '.pdf',
	'application/msword': '.doc',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
		'.docx',
	'application/vnd.ms-excel': '.xls',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/gif': '.gif',
	'text/plain': '.txt',
	'text/csv': '.csv',
	// CAD and Navisworks files
	'application/acad': '.dwg',
	'application/x-acad': '.dwg',
	'application/autocad_dwg': '.dwg',
	'image/vnd.dwg': '.dwg',
	'application/dwg': '.dwg',
	'application/x-dwg': '.dwg',
	'application/octet-stream': '.nwd', // Generic binary; the extension allowlist still applies
	// Archive files
	'application/zip': '.zip',
	'application/x-zip-compressed': '.zip',
	'application/x-rar-compressed': '.rar',
	'application/vnd.rar': '.rar',
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * POST /api/messages/attachments
 * Upload a file attachment for a message
 */
export async function POST(request) {
	try {
		const currentUser = await getCurrentUser(request);
		if (!currentUser) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const formData = await request.formData();
		const file = formData.get('file');

		if (!file) {
			return NextResponse.json(
				{ success: false, error: 'No file uploaded' },
				{ status: 400 }
			);
		}

		// Check file type — C1: AND-logic. Both the declared MIME type and the
		// extension must be allowed, so neither alone can smuggle a file in
		// (`payload.html` declaring text/plain, or `payload.txt` declaring
		// text/html, are both rejected).
		const fileName = file.name || '';
		const fileExt = fileName.toLowerCase().split('.').pop();
		const allowedExtensions = [
			'pdf',
			'doc',
			'docx',
			'xls',
			'xlsx',
			'jpg',
			'jpeg',
			'png',
			'gif',
			'txt',
			'csv',
			'nwd',
			'dwg',
			'rar',
			'zip',
		];

		if (
			!Object.hasOwn(ALLOWED_TYPES, file.type) ||
			!allowedExtensions.includes(fileExt)
		) {
			return NextResponse.json(
				{
					success: false,
					error: `File type not allowed. Allowed types: PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, GIF, TXT, CSV, NWD, DWG, RAR, ZIP`,
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

		// C1: validate the payload itself — a renamed HTML/SVG/script file must
		// never reach private/message-attachments, whatever MIME it declares.
		const bytes = await file.arrayBuffer();
		const buffer = Buffer.from(bytes);
		if (hasMarkupSignature(buffer)) {
			return NextResponse.json(
				{ success: false, error: MARKUP_REJECTION_ERROR },
				{ status: 400 }
			);
		}

		// Generate unique filename — the stored extension comes from the
		// allowlist entry for the declared MIME, never from the original name
		const extension = ALLOWED_TYPES[file.type];
		const uniqueFilename = `${uuidv4()}${extension}`;

		// Create upload directory if it doesn't exist
		const uploadDir = path.join(
			process.cwd(),
			'private',
			'message-attachments'
		);
		if (!existsSync(uploadDir)) {
			await mkdir(uploadDir, { recursive: true });
		}

		// Save file
		const filePath = path.join(uploadDir, uniqueFilename);
		await writeFile(filePath, buffer);

		return NextResponse.json({
			success: true,
			data: {
				file_name: uniqueFilename,
				original_name: file.name,
				file_path: `/private/message-attachments/${uniqueFilename}`,
				file_type: file.type,
				file_size: file.size,
			},
		});
	} catch (error) {
		console.error('Error uploading attachment:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to upload attachment',
				details: error.message,
			},
			{ status: 500 }
		);
	}
}
