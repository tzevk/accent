import { redirect } from 'next/navigation';
import { getServerAuth } from '@/utils/server-auth';
import { hasPermission, RESOURCES, PERMISSIONS } from '@/utils/rbac';

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
	if (auth.user.is_super_admin || auth.user.role?.code === 'admin') {
		return children;
	}
	// The other-expense register is permission-gated, not role-gated: a
	// read-only reader (`other_expenses:read` + `other_expenses:update`, no
	// create/approve) lists and reviews through the same APIs the page calls,
	// so the shell must render for that identity. The APIs stay the real
	// boundary (create/approve/review/delete still 403); the shell itself
	// carries no data.
	if (
		auth.user &&
		hasPermission(auth.user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ)
	) {
		return children;
	}
	redirect('/user/dashboard');
}
