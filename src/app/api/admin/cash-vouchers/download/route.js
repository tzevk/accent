import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { renderCashVoucherPrintDocument } from '@/lib/cash-voucher-print';

/**
 * GET /api/admin/cash-vouchers/download?id=X[&print=true]
 * Standalone print document: full-page A4 invoice with the Accent logo,
 * natural pagination, and a manual Print / Save as PDF toolbar.
 * `print=true` auto-prints once images/fonts finish loading; a plain open
 * stays a preview. Deleted vouchers (isDelete = 1) return 404.
 */
export async function GET(request) {
	let db;

	try {
		// RBAC check
		const authResult = await ensurePermission(
			request,
			RESOURCES.CASH_VOUCHER,
			PERMISSIONS.READ
		);
		if (authResult instanceof Response) return authResult;
		if (!authResult.authorized) return authResult.response;

		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return new Response('Voucher ID is required', { status: 400 });
		}

		db = await dbConnect();

		const [vouchers] = await db.execute(
			'SELECT * FROM cash_vouchers WHERE id = ? AND (isDelete IS NULL OR isDelete = 0)',
			[id]
		);

		if (vouchers.length === 0) {
			return new Response('Voucher not found', { status: 404 });
		}

		const voucher = vouchers[0];
		const lineItems =
			typeof voucher.line_items === 'string'
				? JSON.parse(voucher.line_items || '[]')
				: voucher.line_items || [];

		// Inline the logo as a data URI so the document is self-contained.
		// Null when the file is missing so the renderer shows a text mark
		// instead of a broken image.
		let logoSrc = null;
		try {
			const logoBuffer = await readFile(
				join(process.cwd(), 'public', 'accent-logo.png')
			);
			logoSrc = `data:image/png;base64,${logoBuffer.toString('base64')}`;
		} catch {
			logoSrc = null;
		}

		const html = renderCashVoucherPrintDocument({
			voucher,
			lineItems,
			logoSrc,
		});

		return new Response(html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
			},
		});
	} catch (error) {
		console.error('Download cash voucher error:', error?.message);
		return new Response('Failed to generate voucher', { status: 500 });
	} finally {
		if (db && typeof db.release === 'function') {
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}
