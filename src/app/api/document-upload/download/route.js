import { NextResponse } from 'next/server';
import { handleDocumentDownload } from '@/utils/document-helpers';

/**
 * GET /api/document-upload/download?id=<doc_uuid>
 */
export async function GET(request) {
	try {
		const { searchParams } = new URL(request.url);
		const docId = searchParams.get('id');
		return await handleDocumentDownload(request, docId);
	} catch (error) {
		console.error('[Document Download] GET Error:', error);
		return NextResponse.json(
			{ success: false, error: 'Download failed' },
			{ status: 500 }
		);
	}
}
