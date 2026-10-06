import { redirect } from 'next/navigation';

/**
 * Editing a pre-canonical purchase-order row directly was a competing write
 * path to order truth (ticket #310). The row now lives in the review queue of
 * the canonical screen until a document-backed decision resolves it.
 */
export default function Page() {
	redirect('/admin/orders');
}
