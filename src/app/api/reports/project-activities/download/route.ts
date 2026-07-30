/**
 * GET /api/reports/project-activities/download
 *
 * Renders the project-activities report as a PDF using puppeteer
 * (matching the pattern in /api/admin/invoices/download). Server-side
 * data is fetched, filtered, and passed through the same Project →
 * Discipline → Task → Member tree used by the on-screen report.
 *
 * Query params:
 *   start_date  – YYYY-MM-DD (optional, filters daily_entries per member)
 *   end_date    – YYYY-MM-DD (optional)
 *   discipline  – exact discipline name to scope the PDF (optional)
 *
 * Access: same RBAC as the JSON endpoint (super-admin, reports:read, or
 * the report_access.project_activities field permission).
 */

import { NextResponse } from 'next/server';
import puppeteer, { type Browser } from 'puppeteer';
import chromium from '@sparticuz/chromium';
import { getCurrentUser } from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { RESOURCES, PERMISSIONS } from '@/utils/permissions';
import { fetchProjectActivitiesData } from '@/app/reports/project-activities/data-source';
import {
	buildTree,
	computeKpis,
	filterTree,
} from '@/app/reports/project-activities/report-utils';
import {
	generateReportHTML,
	fileBaseFromOptions,
} from '@/app/reports/project-activities/pdf-template';

export const runtime = 'nodejs';
// Puppeteer + chromium add >10MB; force Node runtime and skip edge caching.
export const dynamic = 'force-dynamic';

interface FieldPermissions {
	modules?: {
		reports?: {
			sections?: {
				report_access?: {
					enabled?: boolean;
					fields?: {
						project_activities?: { permission?: string };
						project_reports?: { permission?: string };
					};
				};
			};
		};
	};
}

interface SessionUser {
	id: string | number;
	is_super_admin?: boolean | number;
	field_permissions?: string | FieldPermissions | null;
}

interface PermissionContext {
	isSuperAdmin: boolean;
	hasReportsPermission: boolean;
	hasFieldPermission: boolean;
}

function parseFieldPermissions(
	raw: SessionUser['field_permissions']
): FieldPermissions | null {
	if (raw == null) return null;
	if (typeof raw === 'string') {
		try {
			const parsed = JSON.parse(raw) as unknown;
			return isFieldPermissions(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return isFieldPermissions(raw) ? raw : null;
}

function isFieldPermissions(v: unknown): v is FieldPermissions {
	if (!v || typeof v !== 'object') return false;
	const modules = (v as FieldPermissions).modules;
	return (
		modules === undefined || modules === null || typeof modules === 'object'
	);
}

function evaluatePermissions(user: SessionUser | null): PermissionContext {
	if (!user) {
		return {
			isSuperAdmin: false,
			hasReportsPermission: false,
			hasFieldPermission: false,
		};
	}
	const isSuperAdmin =
		user.is_super_admin === true || user.is_super_admin === 1;
	const hasReportsPermission = hasPermission(
		user,
		RESOURCES.REPORTS,
		PERMISSIONS.READ
	);

	const fieldPerms = parseFieldPermissions(user.field_permissions);
	const section = fieldPerms?.modules?.reports?.sections?.report_access;
	let hasFieldPermission = false;
	if (section?.enabled) {
		const f = section.fields?.project_activities?.permission;
		const legacy = section.fields?.project_reports?.permission;
		hasFieldPermission =
			f === 'view' || f === 'edit' || legacy === 'view' || legacy === 'edit';
	}

	return { isSuperAdmin, hasReportsPermission, hasFieldPermission };
}

export async function GET(request: Request) {
	const rawUser = await getCurrentUser(request);
	const user: SessionUser | null =
		rawUser && typeof rawUser === 'object' ? (rawUser as SessionUser) : null;

	if (!user) {
		return NextResponse.json(
			{ success: false, error: 'Unauthorized' },
			{ status: 401 }
		);
	}

	const perms = evaluatePermissions(user);
	if (
		!perms.isSuperAdmin &&
		!perms.hasReportsPermission &&
		!perms.hasFieldPermission
	) {
		return NextResponse.json(
			{
				success: false,
				error: 'You do not have permission to view project activities report',
			},
			{ status: 403 }
		);
	}

	const { searchParams } = new URL(request.url);
	const startDate = searchParams.get('start_date') || '';
	const endDate = searchParams.get('end_date') || '';
	const discipline = searchParams.get('discipline') || 'all';

	let browser: Browser | undefined;
	try {
		const raw = await fetchProjectActivitiesData({ startDate, endDate });
		const built = buildTree(raw, { startDate, endDate });
		const tree =
			discipline !== 'all' ? filterTree(built, { discipline }) : built;
		const kpis = computeKpis(tree);
		const html = generateReportHTML(tree, kpis, { startDate, endDate });
		const filename = `${fileBaseFromOptions({ startDate, endDate })}.pdf`;

		// Puppeteer launch: Vercel uses @sparticuz/chromium; local dev uses the
		// system Chromium.  Same pattern as /api/admin/invoices/download.
		const isVercel = process.env.VERCEL === '1';
		const viewport = {
			deviceScaleFactor: 1,
			hasTouch: false,
			height: 1754,
			isLandscape: false,
			isMobile: false,
			width: 1240,
		};
		if (isVercel) {
			browser = await puppeteer.launch({
				args: chromium.args,
				defaultViewport: viewport,
				executablePath: await chromium.executablePath(),
				headless: true,
			});
		} else {
			browser = await puppeteer.launch({
				headless: true,
				defaultViewport: viewport,
			});
		}

		const page = await browser.newPage();
		await page.emulateMediaType('print');
		await page.setContent(html, { waitUntil: 'load' });

		const pdf = await page.pdf({
			width: '794px', // A4 width in CSS pixels
			height: '1123px',
			printBackground: true,
			margin: {
				top: '1.2cm',
				bottom: '1.2cm',
				left: '1cm',
				right: '1cm',
			},
		});

		return new Response(Buffer.from(pdf), {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${filename}"`,
			},
		});
	} catch (error) {
		console.error('Project activities PDF error:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to generate PDF',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 }
		);
	} finally {
		if (browser) {
			try {
				await browser.close();
			} catch (closeError) {
				console.error('Error closing browser:', closeError);
			}
		}
	}
}
