import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: vi.fn(),
}));
vi.mock('@/components/AccessGuard', () => ({
	default: ({ children }) => children,
}));
vi.mock('@/components/Navbar', () => ({
	default: () => <nav>Navbar</nav>,
}));

const { default: AttendancePage } =
	await import('@/app/employees/attendance/page.jsx');

describe('attendance page activity defaults', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.setSystemTime(new Date('2026-08-15T12:00:00'));
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockImplementation((url) => {
			if (url.startsWith('/api/employees/list')) {
				return Promise.resolve({
					json: async () => ({
						success: true,
						employees: [
							{
								id: 1,
								employee_id: 'ATS001',
								first_name: 'Alice',
								last_name: 'Worker',
								department: 'Projects',
							},
						],
					}),
				});
			}
			if (url.startsWith('/api/attendance?month=2026-08')) {
				return Promise.resolve({
					json: async () => ({
						success: true,
						summary: [],
						activityDays: { 1: { '2026-08-10': true } },
					}),
				});
			}
			if (url.startsWith('/api/masters/holidays')) {
				return Promise.resolve({ json: async () => ({ holidays: [] }) });
			}
			if (url.startsWith('/api/payroll/salary-profile/batch')) {
				return Promise.resolve({
					json: async () => ({ success: true, data: {} }),
				});
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('defaults present only on days with project activity', async () => {
		render(<AttendancePage />);

		expect(
			await screen.findByTitle(/Alice Worker - .* 10: Present$/)
		).toBeInTheDocument();
		await waitFor(() => {
			expect(
				screen.getByTitle(/Alice Worker - .* 11: Click to mark$/)
			).toBeInTheDocument();
		});
	});
});
