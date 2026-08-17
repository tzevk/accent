import { NextResponse } from 'next/server';
import { handleDocumentDownload } from '../route';

/**
 * GET /api/document-upload/download/[id]
 */
export async function GET(request, { params }) {
	try {
		const { id } = await params;
		return await handleDocumentDownload(request, id);
	} catch (error) {
		console.error('[Document Download] GET [id] Error:', error);
		return NextResponse.json(
			{ success: false, error: 'Download failed' },
			{ status: 500 }
		);
	}
}
