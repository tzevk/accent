import { redirect } from 'next/navigation';

/** See `/admin/purchase-order`: legacy entry redirects to canonical orders. */
export default function Page() {
	redirect('/admin/orders');
}
