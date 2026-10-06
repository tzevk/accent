/**
 * GET /api/reports/employee-project-monthly-cost
 *
 * Company expenditure report. Leads with the direct-cost reconciliation and
 * keeps the employee-cost views beside it.
 *
 * Without params                       → meta (months, expenditure months, FYs, employees)
 * ?view=expenditure&month=YYYY-MM[&project_id=]
 *                                      → Company Incurred Cost, its Project/Overhead/
 *                                        Unallocated reconciliation, evidence states,
 *                                        and coverage (src/lib/company-expenditure)
 * ?view=monthly&month=YYYY-MM          → employee-cost estimate for one month
 * ?view=fy&fy=YYYY                     → employee-cost FY matrix (Apr–Mar)
 * ?employee_id=&fy=YYYY                → legacy per-employee FY matrix (backward compat)
 *
 * Access: super admins, or `reports:read` **and** `other_expenses:read` —
 * the expenditure reconciliation reads the direct-expense ledger, so report
 * access alone must not expose its rows or aggregates (existing source
 * authorization, parent spec §149). The `project_activities` field grant no
 * longer opens this report (ticket #306): Project Activity access alone must
 * not reveal company expenditure. Entry, recognition, and drilldown follow the
 * same rule; the expenditure routes are gated in the same way. The
 * employee-cost views keep their `reports:read` gate.
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import {
	fetchCompanyCostMeta,
	fetchEmployeeCostMeta,
	fetchEmployeeProjectCost,
	fetchFYCompanyCost,
	fetchMonthlyCompanyCost,
	getFinancialYear,
} from '@/app/reports/employee-project-monthly-cost/data-source';
import {
	fetchCompanyReconciliation,
	fetchExpenditureMonths,
	isCurrencyCode,
} from '@/lib/company-expenditure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	try {
		const user = await getCurrentUser(request);
		if (!user) {
			return NextResponse.json(
				{ success: false, error: 'Unauthorized' },
				{ status: 401 }
			);
		}

		const isSuperAdmin =
			user.is_super_admin === true || user.is_super_admin === 1;
		const hasReportsPermission = hasPermission(
			user,
			RESOURCES.REPORTS,
			PERMISSIONS.READ
		);
		// The direct-expense ledger is the source of the expenditure
		// reconciliation, so its read privilege is required as well: a report
		// reader without source access gets neither rows nor aggregates.
		const hasExpenseSourceRead =
			isSuperAdmin ||
			hasPermission(user, RESOURCES.OTHER_EXPENSES, PERMISSIONS.READ);

		// Financial access: a reporting privilege, never Project Activity access
		// alone. The expenditure reconciliation names suppliers, amounts, and
		// evidence, so the old `project_activities` field grant is not enough.
		if (!isSuperAdmin && !hasReportsPermission) {
			return NextResponse.json(
				{
					success: false,
					error:
						'You do not have permission to view the employee project cost report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const employeeIdParam = url.searchParams.get('employee_id');
		const fyParam =
			url.searchParams.get('fy') || url.searchParams.get('fy_year');
		const monthParam = url.searchParams.get('month');
		const viewParam = url.searchParams.get('view');

		// Company expenditure reconciliation (direct cost), leading view.
		if ((viewParam || '').toLowerCase() === 'expenditure') {
			if (!hasExpenseSourceRead) {
				return NextResponse.json(
					{
						success: false,
						error: 'You do not have permission to view company expenditure',
					},
					{ status: 403 }
				);
			}
			if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
				return NextResponse.json(
					{
						success: false,
						error:
							'Valid month (YYYY-MM) is required for the expenditure view',
					},
					{ status: 400 }
				);
			}
			const projectIdParam = url.searchParams.get('project_id');
			let projectId: number | null = null;
			if (projectIdParam) {
				projectId = Number(projectIdParam);
				if (!Number.isInteger(projectId) || projectId <= 0) {
					return NextResponse.json(
						{ success: false, error: 'Valid project_id is required' },
						{ status: 400 }
					);
				}
			}
			// The reporting basis is part of the request; absent means the
			// company reporting currency. Only costs with matching stored
			// conversion evidence are stated in it. The shared validator owns
			// the three-letter rule, so route and module cannot drift.
			const reportingCurrencyParam = url.searchParams.get('reporting_currency');
			const reportingCurrency = reportingCurrencyParam
				? reportingCurrencyParam.trim().toUpperCase()
				: null;
			if (reportingCurrency !== null && !isCurrencyCode(reportingCurrency)) {
				return NextResponse.json(
					{
						success: false,
						error: 'Valid reporting_currency (three-letter code) is required',
						code: 'invalid_reporting_currency',
					},
					{ status: 400 }
				);
			}
			const data = await fetchCompanyReconciliation({
				month: monthParam,
				projectId,
				reportingCurrency,
			});
			return NextResponse.json({ success: true, data, view: 'expenditure' });
		}

		// Meta-only request for the filter bar.
		if (!employeeIdParam && !fyParam && !monthParam && !viewParam) {
			const [companyMeta, legacyMeta, expenditureMonths] = await Promise.all([
				fetchCompanyCostMeta(),
				fetchEmployeeCostMeta(),
				// The months that carry direct cost are themselves source data:
				// only a caller with the ledger's read privilege sees them.
				hasExpenseSourceRead
					? fetchExpenditureMonths()
					: Promise.resolve<string[]>([]),
			]);
			// Merge so old and new clients both work; new UI reads months/fy, old reads employees
			const meta = {
				...companyMeta,
				employees: legacyMeta.employees,
				financial_years: companyMeta.financial_years,
				current_fy: companyMeta.current_fy,
				expenditure_months: expenditureMonths,
			};
			return NextResponse.json({ success: true, meta });
		}

		// Legacy per-employee view (backward compat): employee_id wins if present
		if (employeeIdParam) {
			const employeeId = Number(employeeIdParam);
			if (!Number.isInteger(employeeId) || employeeId <= 0) {
				return NextResponse.json(
					{ success: false, error: 'Valid employee_id is required' },
					{ status: 400 }
				);
			}
			const fyYear = fyParam ? Number(fyParam) : getFinancialYear();
			if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
				return NextResponse.json(
					{ success: false, error: 'Invalid financial year (expected YYYY)' },
					{ status: 400 }
				);
			}
			const data = await fetchEmployeeProjectCost(employeeId, fyYear);
			if (!data) {
				return NextResponse.json(
					{ success: false, error: 'Employee not found' },
					{ status: 404 }
				);
			}
			return NextResponse.json({ success: true, data, view: 'legacy' });
		}

		// Explicit view param handling
		const view = (viewParam || '').toLowerCase();
		if (view === 'monthly' || monthParam) {
			const month = monthParam || url.searchParams.get('month');
			if (!month || !/^\d{4}-\d{2}$/.test(month)) {
				return NextResponse.json(
					{
						success: false,
						error: 'Valid month (YYYY-MM) is required for monthly view',
					},
					{ status: 400 }
				);
			}
			const data = await fetchMonthlyCompanyCost(month);
			if (!data) {
				return NextResponse.json(
					{ success: false, error: 'Invalid month' },
					{ status: 400 }
				);
			}
			return NextResponse.json({ success: true, data, view: 'monthly' });
		}

		if (
			view === 'fy' ||
			view === 'annual' ||
			view === 'financial_year' ||
			fyParam
		) {
			const fyYear = fyParam ? Number(fyParam) : getFinancialYear();
			if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
				return NextResponse.json(
					{ success: false, error: 'Invalid financial year (expected YYYY)' },
					{ status: 400 }
				);
			}
			const data = await fetchFYCompanyCost(fyYear);
			return NextResponse.json({ success: true, data, view: 'fy' });
		}

		// Fallback: no recognized params -> meta
		const [companyMeta, legacyMeta] = await Promise.all([
			fetchCompanyCostMeta(),
			fetchEmployeeCostMeta(),
		]);
		const meta = {
			...companyMeta,
			employees: legacyMeta.employees,
		};
		return NextResponse.json({ success: true, meta });
	} catch (error: unknown) {
		console.error('Employee project monthly cost report error:', error);
		return NextResponse.json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Failed to load report',
			},
			{ status: 500 }
		);
	}
}
