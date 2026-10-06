import { redirect } from 'next/navigation';

/** See the edit route: legacy rows are reviewed on the canonical screen. */
export default function Page() {
	redirect('/admin/orders');
}
