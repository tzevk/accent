import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { getServerAuth } from '@/utils/server-auth';
import { hasPermission, RESOURCES, PERMISSIONS } from '@/utils/rbac';
import { query } from '@/utils/database';
import ProjectCostBudgets from './project-cost-budgets';

export const metadata = { title: 'Project cost budgets | Accent' };

export default async function ProjectCostBudgetsPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ month?: string; currency?: string }>;
}) {
	const auth = await getServerAuth();
	if (!auth.authenticated || !auth.user) redirect('/signin');
	if (!hasPermission(auth.user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ)) {
		return (
			<>
				<Navbar />
				<main className="mx-auto max-w-5xl px-4 py-8">
					<h1 className="text-xl font-semibold text-gray-900">
						Cost budget access required
					</h1>
					<p className="mt-3 text-sm text-gray-600">
						Ask an administrator for permission to read project cost budgets.
					</p>
					<Link
						href="/projects"
						className="mt-4 inline-block font-medium text-[#64126D] underline underline-offset-2"
					>
						Return to projects
					</Link>
				</main>
			</>
		);
	}
	const { id } = await params;
	const projectId = Number(id);
	if (!Number.isSafeInteger(projectId) || projectId <= 0) notFound();
	const [rows] = await query(
		'SELECT project_id, project_code, COALESCE(project_title, name) AS project_name FROM projects WHERE project_id = ? AND isDelete = 0 LIMIT 1',
		[projectId]
	);
	const project = (
		rows as Array<{
			project_id: number;
			project_code: string;
			project_name: string;
		}>
	)[0];
	if (!project) notFound();
	const context = await searchParams;
	const month =
		context.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(context.month)
			? context.month
			: new Date().toISOString().slice(0, 7);
	const currency =
		context.currency && /^[A-Z]{3}$/.test(context.currency)
			? context.currency
			: 'INR';
	return (
		<>
			<Navbar />
			<main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
				<nav
					aria-label="Budget navigation"
					className="flex flex-wrap gap-4 text-sm"
				>
					<Link
						href={`/projects/${projectId}`}
						className="font-medium text-[#64126D] underline underline-offset-2"
					>
						Return to project
					</Link>
					<Link
						href={`/reports/company-monthly-cost?month=${month}#decision-budget`}
						className="font-medium text-[#64126D] underline underline-offset-2"
					>
						Return to Company Monthly Cost
					</Link>
				</nav>
				<header>
					<p className="text-sm font-medium text-gray-600">
						Project administration
					</p>
					<h1 className="mt-1 break-words text-2xl font-semibold text-gray-900">
						Cost budgets — {project.project_code}
					</h1>
					<p className="mt-2 break-words text-sm text-gray-600">
						{project.project_name}
					</p>
					<p className="mt-2 text-sm text-gray-600">
						Report context: {month} · {currency}. New budgets start with this
						month and currency.
					</p>
				</header>
				<ProjectCostBudgets
					key={projectId}
					projectId={projectId}
					projectCode={project.project_code}
					projectName={project.project_name}
					month={month}
					currency={currency}
					canManage={hasPermission(
						auth.user,
						RESOURCES.OTHER_EXPENSES,
						PERMISSIONS.UPDATE
					)}
					canApprove={hasPermission(
						auth.user,
						RESOURCES.OTHER_EXPENSES,
						PERMISSIONS.APPROVE
					)}
				/>
			</main>
		</>
	);
}
