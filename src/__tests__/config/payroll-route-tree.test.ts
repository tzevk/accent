import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';

const APP_DIR = path.resolve(process.cwd(), 'src/app');

async function redirectsBySource() {
	const redirects = (await nextConfig.redirects?.()) ?? [];
	return new Map(redirects.map((redirect) => [redirect.source, redirect]));
}

/**
 * Issue #240: the payroll module moved under /admin/payroll/*. These pin the
 * route-tree contract — the pages that must resolve and the old paths that
 * must not come back (they are covered by permanent redirects).
 */
describe('payroll route tree (issue #240)', () => {
	it('serves the payroll pages plus the slip detail route under /admin/payroll', () => {
		const routes = [
			'admin/payroll/page.jsx',
			'admin/payroll/slips/[id]/page.jsx',
			'admin/payroll/rates/page.jsx',
			'admin/payroll/rates/da/page.jsx',
		];

		for (const route of routes) {
			expect(existsSync(path.join(APP_DIR, route)), route).toBe(true);
		}
	});

	it('no longer serves the old payroll pages', () => {
		const oldRoutes = [
			'admin/salary-sheet',
			'admin/salary-slip',
			'admin/payroll-schedules',
			'admin/da-schedule',
		];

		for (const route of oldRoutes) {
			expect(existsSync(path.join(APP_DIR, route)), route).toBe(false);
		}
	});

	it('sends every old payroll URL to its /admin/payroll/* home permanently', async () => {
		const bySource = await redirectsBySource();

		expect(bySource.get('/admin/salary-sheet')).toMatchObject({
			destination: '/admin/payroll',
			permanent: true,
		});
		// Issue #241: the slips list dissolved into the run dashboard.
		expect(bySource.get('/admin/salary-slip')).toMatchObject({
			destination: '/admin/payroll',
			permanent: true,
		});
		expect(bySource.get('/admin/payroll-schedules')).toMatchObject({
			destination: '/admin/payroll/rates',
			permanent: true,
		});
		expect(bySource.get('/admin/da-schedule')).toMatchObject({
			destination: '/admin/payroll/rates/da',
			permanent: true,
		});
	});
});

/**
 * Issue #241: the former Payroll Slips list is no longer a page of its own —
 * /admin/payroll is the one list of the month's Payroll Slips, and one person's
 * slip still opens on the detail route.
 */
describe('run dashboard merge (issue #241)', () => {
	it('dissolves the Payroll Slips list into the dashboard, keeping one slip detail route', async () => {
		expect(existsSync(path.join(APP_DIR, 'admin/payroll/slips/page.jsx'))).toBe(
			false
		);
		expect(
			existsSync(path.join(APP_DIR, 'admin/payroll/slips/[id]/page.jsx'))
		).toBe(true);

		const bySource = await redirectsBySource();

		expect(bySource.get('/admin/payroll/slips')).toMatchObject({
			destination: '/admin/payroll',
			permanent: true,
		});
	});
});
