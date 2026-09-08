import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

	it('labels overtime as gate-filtered Payable OT with threshold visible', async () => {
		render(<AttendancePage />);

		const header = await screen.findByText('Payable OT (>2h)');
		expect(header).toBeInTheDocument();
		expect(header.closest('th')).toHaveAttribute(
			'title',
			expect.stringMatching(/past 2h/i)
		);
		expect(
			await screen.findByText(/gate-filtered.*past 2h/i)
		).toBeInTheDocument();
		expect(screen.queryByText(/OT Amount/i)).not.toBeInTheDocument();
	});

	it('folds approval-introduced EL/UL/OT codes into summary counts', async () => {
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
						summary: [
							{
								employee_id: 1,
								days: {
									'2026-08-01': { status: 'P' },
									'2026-08-02': { status: 'EL' },
									'2026-08-03': { status: 'UL' },
									'2026-08-04': { status: 'OT', overtime_hours: 3 },
								},
							},
						],
						activityDays: {},
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
		render(<AttendancePage />);

		// EL/UL/OT cells render with their own labels, not Present fallback
		expect(await screen.findByTitle(/ 2: Earned Leave$/)).toBeInTheDocument();
		expect(await screen.findByTitle(/ 3: Unpaid Leave$/)).toBeInTheDocument();
		expect(
			await screen.findByTitle(/ 4: Overtime Present$/)
		).toBeInTheDocument();
		// Payable = P + EL + OT-as-present = 3.0; hours = P 8 + OT 8 = 16.0;
		// payable OT = 3.0 (gated). UL groups with LWP so no separate column.
		await waitFor(() => {
			expect(screen.getAllByText('3.0')).toHaveLength(2);
			expect(screen.getByText('16.0')).toBeInTheDocument();
		});
	});
});

describe('attendance page Saturday bulk-mark', () => {
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
					json: async () => ({ success: true, summary: [], activityDays: {} }),
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

	it('marks only 2nd and 4th Saturdays as Weekly Off', async () => {
		render(<AttendancePage />);
		// August 2026: Saturdays are 1, 8, 15, 22, 29.
		expect(await screen.findByTitle(/ 1: Click to mark$/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /2nd.*4th/i }));
		// 2nd (8th) and 4th (22nd) become Weekly Off; 1st/3rd/5th stay empty.
		expect(await screen.findByTitle(/ 8: Weekly Off$/)).toBeInTheDocument();
		expect(screen.getByTitle(/ 22: Weekly Off$/)).toBeInTheDocument();
		expect(screen.getByTitle(/ 1: Click to mark$/)).toBeInTheDocument();
		expect(screen.getByTitle(/ 15: Click to mark$/)).toBeInTheDocument();
		expect(screen.getByTitle(/ 29: Click to mark$/)).toBeInTheDocument();
	});

	it('fills empty cells only and lets Holidays win on collision', async () => {
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
						summary: [
							{ employee_id: 1, days: { '2026-08-08': { status: 'P' } } },
						],
						activityDays: {},
					}),
				});
			}
			if (url.startsWith('/api/masters/holidays')) {
				return Promise.resolve({
					json: async () => ({
						holidays: [{ name: 'Test Holiday', date: '2026-08-22' }],
					}),
				});
			}
			if (url.startsWith('/api/payroll/salary-profile/batch')) {
				return Promise.resolve({
					json: async () => ({ success: true, data: {} }),
				});
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});
		render(<AttendancePage />);
		expect(await screen.findByTitle(/ 8: Present$/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /2nd.*4th/i }));
		// Recorded Present survives; holiday Saturday stays empty (never WO).
		expect(screen.getByTitle(/ 8: Present$/)).toBeInTheDocument();
		expect(screen.getByTitle(/ 22: Click to mark$/)).toBeInTheDocument();
		expect(screen.queryByTitle(/ 22: Weekly Off$/)).not.toBeInTheDocument();
	});
});
