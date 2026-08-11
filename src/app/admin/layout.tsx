import { redirect } from 'next/navigation';
import { getServerAuth } from '@/utils/server-auth';

// This layout reads cookies on every request, so every /admin/* route must be
// server-rendered on demand — never statically prerendered (which would throw
// DYNAMIC_SERVER_USAGE and bake a wrong redirect into the pages).
export const dynamic = 'force-dynamic';

export default async function AdminLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const auth = await getServerAuth();
	if (!auth.authenticated) redirect('/signin');
	if (!(auth.user.is_super_admin || auth.user.role?.code === 'admin')) {
		redirect('/user/dashboard');
	}
	return children;
}
