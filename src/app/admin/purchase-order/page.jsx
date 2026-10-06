import { redirect } from 'next/navigation';

/**
 * The incoming purchase-order entry screen was one of the four pre-canonical
 * order stores (ticket #310). Order entry now happens once, on the canonical
 * screen with an explicit direction; the legacy rows stay readable through the
 * document-backed review queue there. This URL keeps working for bookmarks.
 */
export default function Page() {
	redirect('/admin/orders');
}
