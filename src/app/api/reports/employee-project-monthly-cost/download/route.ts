/**
 * GET /api/reports/employee-project-monthly-cost/download
 *
 * Server-side Excel export for the Employee Project Monthly Cost report.
 * Same RBAC gate and query contract as the JSON route. Uses exceljs (in
 * next.config.ts serverExternalPackages, server-only). Supports:
 * - legacy: ?employee_id=&fy=YYYY
 * - monthly: ?view=monthly&month=YYYY-MM
 * - fy: ?view=fy&fy=YYYY (or fy_year)
 */

import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import {
	fetchEmployeeProjectCost,
	fetchFYCompanyCost,
	fetchMonthlyCompanyCost,
	getFinancialYear,
} from '@/app/reports/employee-project-monthly-cost/data-source';
import {
	buildWorkbookBuffer as buildLegacyWorkbookBuffer,
	fileBaseForExcel as fileBaseForLegacyExcel,
	buildFYWorkbookBuffer,
	buildMonthlyWorkbookBuffer,
	fileBaseForFYExcel,
	fileBaseForMonthlyExcel,
	buildExpenditureWorkbookBuffer,
	fileBaseForExpenditureExcel,
} from '@/app/reports/employee-project-monthly-cost/excel-template';
import { canReadFinancialSources } from '../financial-read-gate';
import {
	dayOfDate,
	buildClosePayload,
	buildRevisionPayload,
	fetchCompanyReconciliation,
	fetchOrders,
	isCurrencyCode,
	loadCloseSnapshot,
	loadRevisionCandidates,
	loadRevisionHistory,
	reviewReconciliation,
} from '@/lib/company-expenditure';
import type { ClosePayload, RevisionPayload } from '@/lib/company-expenditure';
import { dbConnect } from '@/utils/database';

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

		// Financial access: a reporting privilege, never Project Activity access
		// alone (same rule as the JSON route).
		if (!isSuperAdmin && !hasReportsPermission) {
			return NextResponse.json(
				{
					success: false,
					error: 'You do not have permission to export this report',
				},
				{ status: 403 }
			);
		}

		const url = new URL(request.url);
		const employeeIdParam = url.searchParams.get('employee_id');
		const fyParam =
			url.searchParams.get('fy') || url.searchParams.get('fy_year');
		const monthParam = url.searchParams.get('month');
		const viewParam = (url.searchParams.get('view') || '').toLowerCase();

		// Company expenditure export (ticket #324)
		if (viewParam === 'expenditure') {
			if (!canReadFinancialSources(user)) {
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
						error: 'Valid month (YYYY-MM) is required for the expenditure view',
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
			const asOfParam = url.searchParams.get('as_of');
			let asOf: string | null = null;
			if (asOfParam !== null) {
				if (dayOfDate(asOfParam) === null) {
					return NextResponse.json(
						{
							success: false,
							error: 'Valid as_of date (YYYY-MM-DD) is required',
							code: 'invalid_as_of',
						},
						{ status: 400 }
					);
				}
				if (asOfParam.slice(0, 7) !== monthParam) {
					return NextResponse.json(
						{
							success: false,
							error: 'as_of must fall inside the reported month',
							code: 'as_of_outside_month',
						},
						{ status: 400 }
					);
				}
				asOf = asOfParam;
			}
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
				asOf,
				reportingCurrency,
			});

			let close: ClosePayload | null = null;
			let revisions: RevisionPayload | null = null;
			const closeDb = await dbConnect();
			try {
				const snapshot = await loadCloseSnapshot(closeDb, monthParam);
				close = buildClosePayload(
					monthParam,
					snapshot,
					reviewReconciliation(data)
				);
				const [revisionHistory, revisionCandidates] = await Promise.all([
					loadRevisionHistory(closeDb, monthParam),
					loadRevisionCandidates(closeDb, monthParam),
				]);
				revisions = buildRevisionPayload({
					month: monthParam,
					snapshot,
					reconciliation: data,
					candidates: revisionCandidates,
					revisions: revisionHistory,
				});
			} finally {
				await closeDb.release();
			}

			const clientOrders = await fetchOrders({
				direction: 'client',
				...(projectId ? { projectId } : {}),
			});

			const buffer = await buildExpenditureWorkbookBuffer({
				reconciliation: data,
				close,
				revisions,
				asOf,
				clientOrders: clientOrders.orders.map((o) => ({
					orderNumber: o.orderNumber,
					counterpartyName: o.counterpartyName,
					projectCode: o.projectCode,
					projectName: o.projectName,
					orderDate: o.orderDate,
					currency: o.currency,
					grossAmount: o.grossAmount,
					netAmount: o.netAmount,
					clientInvoicedValue: o.clientInvoicedValue,
					clientRemainingValue: o.clientRemainingValue,
					status: o.status,
				})),
			});

			return new Response(new Uint8Array(buffer), {
				status: 200,
				headers: {
					'Content-Type':
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': `attachment; filename="${fileBaseForExpenditureExcel(data, projectId)}"`,
					'Cache-Control': 'no-store',
				},
			});
		}

		// Legacy per-employee export
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
			const buffer = await buildLegacyWorkbookBuffer(data);
			return new Response(new Uint8Array(buffer), {
				status: 200,
				headers: {
					'Content-Type':
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': `attachment; filename="${fileBaseForLegacyExcel(data)}"`,
					'Cache-Control': 'no-store',
				},
			});
		}

		// Monthly company export
		if (viewParam === 'monthly' || (!viewParam && monthParam)) {
			const month = monthParam || '';
			if (!month || !/^\d{4}-\d{2}$/.test(month)) {
				return NextResponse.json(
					{ success: false, error: 'Valid month (YYYY-MM) is required' },
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
			const buffer = await buildMonthlyWorkbookBuffer(data);
			return new Response(new Uint8Array(buffer), {
				status: 200,
				headers: {
					'Content-Type':
						'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
					'Content-Disposition': `attachment; filename="${fileBaseForMonthlyExcel(data)}"`,
					'Cache-Control': 'no-store',
				},
			});
		}

		// FY company export (default for fy param or view=fy/annual)
		const fyYear = fyParam ? Number(fyParam) : getFinancialYear();
		if (!Number.isInteger(fyYear) || fyYear < 2000 || fyYear > 2100) {
			return NextResponse.json(
				{ success: false, error: 'Invalid financial year (expected YYYY)' },
				{ status: 400 }
			);
		}
		const data = await fetchFYCompanyCost(fyYear);
		const buffer = await buildFYWorkbookBuffer(data);
		return new Response(new Uint8Array(buffer), {
			status: 200,
			headers: {
				'Content-Type':
					'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				'Content-Disposition': `attachment; filename="${fileBaseForFYExcel(data)}"`,
				'Cache-Control': 'no-store',
			},
		});
	} catch (error: unknown) {
		console.error('Employee project monthly cost export error:', error);
		return NextResponse.json(
			{
				success: false,
				error:
					error instanceof Error ? error.message : 'Failed to export report',
			},
			{ status: 500 }
		);
	}
}
