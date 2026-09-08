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

describe('attendance page Sandwich save auto-convert (#234)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.setSystemTime(new Date('2026-08-15T12:00:00'));
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('converts a bracketed Weekly Off to leave on save and persists it', async () => {
		let savedBody = null;
		fetchMock.mockImplementation((url, options) => {
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
									'2026-08-08': { status: 'CL' },
									'2026-08-09': { status: 'WO' },
									'2026-08-10': { status: 'CL' },
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
			if (url === '/api/attendance' && options?.method === 'POST') {
				savedBody = JSON.parse(options.body);
				return Promise.resolve({
					json: async () => ({
						success: true,
						successCount: savedBody.attendance_records.length,
						sandwichConverted: [
							{
								employee_id: 1,
								attendance_date: '2026-08-09',
								from: 'WO',
								to: 'CL',
							},
						],
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});
		render(<AttendancePage />);
		// Sandwich pattern loads: Sat CL, Sun WO, Mon CL.
		expect(await screen.findByTitle(/ 9: Weekly Off$/)).toBeInTheDocument();
		// Touch the grid so the save bar appears (fill-empty never clobbers CL).
		fireEvent.click(screen.getByRole('button', { name: /2nd.*4th/i }));
		fireEvent.click(screen.getByRole('button', { name: /Save Attendance/i }));
		await waitFor(() => expect(savedBody).not.toBeNull());
		const saved = new Map(
			savedBody.attendance_records.map((r) => [r.attendance_date, r.status])
		);
		// Persisted payload carries the converted leave code, not WO.
		expect(saved.get('2026-08-09')).toBe('CL');
		expect(saved.get('2026-08-08')).toBe('CL');
		expect(saved.get('2026-08-10')).toBe('CL');
		// Grid matches the persisted record after save.
		expect(await screen.findByTitle(/ 9: Casual Leave$/)).toBeInTheDocument();
	});

	it('leaves an unsandwiched Weekly Off alone on save', async () => {
		let savedBody = null;
		fetchMock.mockImplementation((url, options) => {
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
									'2026-08-07': { status: 'CL' },
									'2026-08-08': { status: 'WO' },
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
			if (url === '/api/attendance' && options?.method === 'POST') {
				savedBody = JSON.parse(options.body);
				return Promise.resolve({
					json: async () => ({
						success: true,
						successCount: savedBody.attendance_records.length,
						sandwichConverted: [],
					}),
				});
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});
		render(<AttendancePage />);
		expect(await screen.findByTitle(/ 8: Weekly Off$/)).toBeInTheDocument();
		fireEvent.click(screen.getByRole('button', { name: /2nd.*4th/i }));
		fireEvent.click(screen.getByRole('button', { name: /Save Attendance/i }));
		await waitFor(() => expect(savedBody).not.toBeNull());
		const saved = new Map(
			savedBody.attendance_records.map((r) => [r.attendance_date, r.status])
		);
		expect(saved.get('2026-08-08')).toBe('WO');
		expect(screen.getByTitle(/ 8: Weekly Off$/)).toBeInTheDocument();
	});
});
