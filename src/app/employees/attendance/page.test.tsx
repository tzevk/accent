import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
let linkedMonth = '2026-07';
let capturedBlob: Blob | null = null;

const sessionRbac = {
	user: { is_super_admin: true },
	can: () => true,
	RESOURCES: { PAYROLL: 'payroll' },
	PERMISSIONS: { READ: 'read' },
	loading: false,
};

vi.mock('@/utils/client-rbac', () => ({
	useSessionRBAC: () => sessionRbac,
}));
vi.mock('@/components/AccessGuard', () => ({
	default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/Navbar', () => ({
	default: () => <nav>Navbar</nav>,
}));
vi.mock('next/navigation', () => ({
	useSearchParams: () => new URLSearchParams(`month=${linkedMonth}`),
}));

// Imported after mock hoisting so the page captures the mocked navigation and
// fetch boundaries; a static import would load the real modules first.
const { default: AttendancePage } =
	await import('@/app/employees/attendance/page.jsx');

const employees = [
	{
		id: 1,
		employee_id: 'ATS001',
		first_name: 'Alice',
		last_name: 'Worker',
		department: 'Projects',
	},
	{
		id: 2,
		employee_id: 'ATS002',
		first_name: 'Bob',
		last_name: 'Unpriced',
		department: 'Projects',
	},
];

function attendanceResponse(month: string) {
	return {
		success: true,
		summary: [
			{
				employee_id: 1,
				days: { [`${month}-10`]: { status: 'P', overtime_hours: 3 } },
			},
			{
				employee_id: 2,
				days: { [`${month}-10`]: { status: 'P', overtime_hours: 3 } },
			},
		],
		punchDays: {},
	};
}

function selectedEntry(employeeId: number, basicPlusDa: number) {
	return {
		employee_id: employeeId,
		state: 'selected',
		anchor: '2026-07-01',
		source: 'employee_salary_profile',
		agreement_id: employeeId + 10,
		conflict_ids: [],
		conflict_source: null,
		salary_type: 'monthly',
		pay_stream: 'payroll',
		effective_from: '2026-04-01',
		effective_to: null,
		classification: 'current',
		ctc: {
			status: 'resolved',
			amount: basicPlusDa * 12,
			source: 'employer_cost',
			legacy_fallback: false,
			invalid_reason: null,
		},
		timeline_version: 1,
		used: false,
		use_ambiguous: false,
		use_unknown_history: false,
		use_months: [],
		profile: {
			salary_type: 'monthly',
			basic_plus_da: basicPlusDa,
			basic: null,
			da: null,
		},
	};
}

function unavailableEntry(employeeId: number) {
	return {
		employee_id: employeeId,
		state: 'unavailable',
		anchor: '2026-07-01',
		source: null,
		agreement_id: null,
		conflict_ids: [],
		conflict_source: null,
		salary_type: null,
		pay_stream: null,
		effective_from: null,
		effective_to: null,
		classification: null,
		ctc: {
			status: 'missing',
			amount: null,
			source: 'none',
			legacy_fallback: false,
			invalid_reason: null,
		},
		timeline_version: 0,
		used: false,
		use_ambiguous: false,
		use_unknown_history: false,
		use_months: [],
		profile: null,
		// Deliberately carries the retired flat shape: an unavailable entry must
		// never be priced from these fields.
		basic_plus_da: 800,
	};
}

function salaryBatchFor(month: string) {
	const selected = month === '2026-07' ? 400 : 800;
	return {
		success: true,
		data: {
			'1': selectedEntry(1, selected),
			'2': unavailableEntry(2),
		},
	};
}

function json(body: unknown) {
	return Promise.resolve({ json: async () => body });
}

function readBlobText(blob: Blob): Promise<string> {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	const reader = new FileReader();
	reader.onload = () => resolve(String(reader.result ?? ''));
	reader.onerror = () => reject(reader.error);
	reader.readAsText(blob);
	return promise;
}

async function exportCsv(): Promise<string> {
	capturedBlob = null;
	fireEvent.click(screen.getByRole('button', { name: /csv/i }));
	const blob = capturedBlob;
	if (!blob) throw new Error('Attendance CSV export created no blob');
	capturedBlob = null;
	return readBlobText(blob);
}

function expectAmount(csv: string, amount: string) {
	const occurrences =
		csv.match(new RegExp(`"${amount.replace('.', '\\.')}"`, 'g')) ?? [];
	expect(occurrences).toHaveLength(1);
}

function otAmountCell(csv: string, employeeName: string): string {
	const line = csv
		.split('\n')
		.find((row) => row.includes(employeeName))
		?.replace(/\r$/, '');
	if (!line) throw new Error(`CSV row missing for ${employeeName}`);
	const cells = line.split(',');
	return cells[cells.length - 1];
}

describe('attendance page OT payout salary source', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.setSystemTime(new Date('2026-08-15T12:00:00'));
		vi.stubGlobal('fetch', fetchMock);
		linkedMonth = '2026-07';
		capturedBlob = null;

		// jsdom has no Blob URL implementation; the page only needs the handle.
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			writable: true,
			value: (value: Blob | MediaSource) => {
				capturedBlob = value as Blob;
				return 'blob:attendance-csv';
			},
		});
		Object.defineProperty(URL, 'revokeObjectURL', {
			configurable: true,
			writable: true,
			value: () => {},
		});
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

		fetchMock.mockImplementation((input: string | URL | Request) => {
			const url = String(input);
			if (url.startsWith('/api/employees/list')) {
				return json({ success: true, employees });
			}
			if (url.startsWith('/api/attendance?month=2026-07')) {
				return json(attendanceResponse('2026-07'));
			}
			if (url.startsWith('/api/attendance?month=2026-08')) {
				return json(attendanceResponse('2026-08'));
			}
			if (url.startsWith('/api/masters/holidays')) {
				return json({ holidays: [] });
			}
			if (url.startsWith('/api/payroll/salary-profile/batch')) {
				const month =
					new URL(url, 'http://localhost').searchParams.get('month') ??
					'2026-08';
				return json(salaryBatchFor(month));
			}
			return Promise.reject(new Error(`Unexpected request: ${url}`));
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('prices CSV overtime from the nested profile of the selected month only', async () => {
		const july = render(<AttendancePage />);
		expect(await screen.findByText('July 2026')).toBeInTheDocument();

		// The linked month is July even though the server's current month is
		// August: July's nested profile (400 basic+DA) must price the export.
		await waitFor(async () => {
			expect(await exportCsv()).toContain('"150.00"');
		});
		const julyCsv = await exportCsv();
		expectAmount(julyCsv, '150.00');
		expect(otAmountCell(julyCsv, 'Bob Unpriced')).toBe('""');
		expect(julyCsv).not.toContain('"300.00"');

		july.unmount();
		linkedMonth = '2026-08';

		render(<AttendancePage />);
		expect(await screen.findByText('August 2026')).toBeInTheDocument();

		await waitFor(async () => {
			expect(await exportCsv()).toContain('"300.00"');
		});
		const augustCsv = await exportCsv();
		expectAmount(augustCsv, '300.00');
		expect(otAmountCell(augustCsv, 'Bob Unpriced')).toBe('""');
		expect(augustCsv).not.toContain('"150.00"');
	});
});
