import type { ReactNode } from 'react';
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
	SalaryDirectoryCounts,
	SalaryDirectoryRow,
	SalaryProfileDirectoryResult,
} from '@/lib/salary-profile-directory';
import type {
	SalaryTimelineAgreementDto,
	SalaryTimelineDto,
} from '@/lib/salary-profile-commands';

import { SalaryProfileEditor } from './SalaryProfileEditor';
import { SalaryProfileList } from './SalaryProfileList';

const { routerPush, routerReplace } = vi.hoisted(() => ({
	routerPush: vi.fn(),
	routerReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
	useRouter: () => ({
		push: routerPush,
		replace: routerReplace,
		back: vi.fn(),
		refresh: vi.fn(),
		prefetch: vi.fn(),
	}),
}));

/* ------------------------------------------------------------------ fixtures */

function ctc(
	amount: number | null,
	source: 'employer_cost' | 'gross_salary' | 'gross' | 'none' = 'employer_cost'
) {
	return {
		status: amount === null ? ('missing' as const) : ('resolved' as const),
		amount,
		source,
		legacy_fallback: source === 'gross_salary' || source === 'gross',
		invalid_reason: null,
	};
}

function directoryAgreement(
	overrides: Partial<SalaryDirectoryRow['agreement']> = {}
): NonNullable<SalaryDirectoryRow['agreement']> {
	return {
		agreement_id: 11,
		source: 'employee_salary_profile',
		salary_type: 'monthly',
		pay_stream: 'payroll',
		effective_from: '2026-04-01',
		effective_to: null,
		classification: 'current',
		used: false,
		ctc: ctc(50000),
		...overrides,
	};
}

function directoryRow(
	overrides: Partial<SalaryDirectoryRow> = {}
): SalaryDirectoryRow {
	return {
		id: 7,
		employee_id: 'EMP-007',
		full_name: 'Asha Rao',
		department: 'Engineering',
		employee_type: 'Deputation',
		status: 'active',
		joining_date: '2025-04-01',
		hire_date: null,
		exit_date: null,
		has_agreement: true,
		state: 'selected',
		anchor: '2026-11-15',
		agreement: directoryAgreement(),
		conflict_ids: [],
		conflict_source: null,
		timeline_version: 4,
		use_ambiguous: false,
		use_unknown_history: false,
		use_months: [],
		...overrides,
	};
}

function directoryResponse(
	overrides: Partial<SalaryProfileDirectoryResult> = {}
): SalaryProfileDirectoryResult {
	return {
		period: {
			kind: 'date',
			date: '2026-11-15',
			month: null,
			start: '2026-11-15',
			end: '2026-11-15',
		},
		as_of: '2026-11-15',
		page: 1,
		limit: 25,
		total: 1,
		counts: {
			total: 1,
			payroll: 1,
			contract: 0,
			missing: 0,
			ambiguous: 0,
		} satisfies SalaryDirectoryCounts,
		data: [directoryRow()],
		...overrides,
	};
}

function agreement(
	overrides: Partial<SalaryTimelineAgreementDto> = {}
): SalaryTimelineAgreementDto {
	return {
		agreement_id: 11,
		agreement_source: 'employee_salary_profile',
		read_only: false,
		salary_type: 'monthly',
		pay_stream: 'payroll',
		effective_from: '2026-04-01',
		effective_to: null,
		classification: 'current',
		is_active: true,
		cancelled_at: null,
		cancelled_by: null,
		cancelled_reason: null,
		used: false,
		use_months: [],
		use_ambiguous: false,
		editable: true,
		actions: ['correct', 'revise'],
		action_blockers: [],
		ctc: {
			status: 'resolved',
			amount: 50000,
			source: 'employer_cost',
			legacy_fallback: false,
			reason: null,
		},
		settings: {
			employer_cost: 50000,
			std_hours_per_day: 8,
			salary_type: 'monthly',
			std_in_time: '09:00',
			std_out_time: '17:30',
			ot_multiplier: 1.5,
			std_working_days: 26,
			pl_total: 21,
			pf_applicable: true,
			is_manual_override: false,
		},
		legacy_amounts: {
			gross_salary: null,
			gross: null,
			contract_amount: null,
			contract_duration: null,
			contract_end_date: null,
		},
		...overrides,
	};
}

function timeline(
	overrides: Partial<SalaryTimelineDto> = {}
): SalaryTimelineDto {
	return {
		employee: {
			id: 7,
			employee_code: 'EMP-007',
			full_name: 'Asha Rao',
			department: 'Engineering',
			position: 'Developer',
			employee_type: 'Deputation',
			status: 'active',
			joining_date: '2025-04-01',
			hire_date: null,
			employment_start: '2025-04-01',
		},
		server_date: '2026-11-16',
		as_of: '2026-11-16',
		month: '2026-11-01',
		timeline_version: 4,
		permissions: { can_read: true, can_update: true, can_delete: true },
		use: {
			used: false,
			ambiguous: false,
			unknown_history: false,
			months: [],
			ambiguous_months: [],
			agreements: [],
		},
		basis: {
			month: '2026-11-01',
			working_days: 22,
			std_hours_per_day: 8,
			basis_hours: 176,
			std_hours_source: 'agreement',
		},
		leave_usage: {
			as_of: '2026-11-16',
			year: 2026,
			month: '2026-11-01',
			pl_total: 21,
			used: 6,
			month_used: 1,
			balance: 15,
			months_recorded: 10,
			source: 'employee_attendance_summary',
		},
		agreements: [agreement()],
		current: {
			state: 'selected',
			agreement_source: 'employee_salary_profile',
			agreement_id: 11,
			agreement_ids: [11],
		},
		legacy_current: {
			state: 'unavailable',
			agreement_source: null,
			agreement_id: null,
			agreement_ids: [],
		},
		...overrides,
	};
}

/* ------------------------------------------------------------------- harness */

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status < 400,
		status,
		json: async () => body,
	} as Response;
}

interface ApiState {
	directory: SalaryProfileDirectoryResult;
	directoryStatus: number;
	timeline: SalaryTimelineDto;
	directoryRequests: string[];
	timelineCalls: number;
	postCalls: Record<string, unknown>[];
	post: ((body: Record<string, unknown>) => Promise<Response>) | null;
}

const api: ApiState = {
	directory: directoryResponse(),
	directoryStatus: 200,
	timeline: timeline(),
	directoryRequests: [],
	timelineCalls: 0,
	postCalls: [],
	post: null,
};

const fetchMock = vi.fn(
	async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = (init?.method || 'GET').toUpperCase();

		if (url.startsWith('/api/payroll/employees-with-profiles')) {
			api.directoryRequests.push(url);
			return api.directoryStatus >= 400
				? jsonResponse(
						{ success: false, error: 'Salary directory unavailable' },
						api.directoryStatus
					)
				: jsonResponse({ success: true, ...api.directory });
		}

		if (url.startsWith('/api/payroll/schedules/current')) {
			return jsonResponse({
				success: true,
				data: { date: '2026-11-16', gross_salary: 0, components: {} },
			});
		}

		if (method === 'GET' && url.startsWith('/api/payroll/salary-profile')) {
			api.timelineCalls += 1;
			return jsonResponse({ success: true, data: api.timeline });
		}

		if (method === 'POST' && url === '/api/payroll/salary-profile') {
			const body = JSON.parse(String(init?.body ?? '{}')) as Record<
				string,
				unknown
			>;
			api.postCalls.push(body);
			if (api.post) return api.post(body);
			return jsonResponse({
				success: true,
				data: {
					operation: body.operation,
					agreement_id: (body.agreement_id as number | undefined) ?? 12,
					timeline_version: api.timeline.timeline_version + 1,
					classification: 'current',
					effective_from: '2026-11-01',
					effective_to: null,
				},
			});
		}

		throw new Error(`Unexpected request: ${method} ${url}`);
	}
);

function renderWithClient(ui: ReactNode) {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: 0 },
			mutations: { retry: false },
		},
	});
	return render(
		<QueryClientProvider client={client}>{ui}</QueryClientProvider>
	);
}

async function openEditor() {
	renderWithClient(<SalaryProfileEditor employeeId={7} />);
	await screen.findByRole('heading', { name: 'Asha Rao' });
}

async function beginCorrection() {
	await openEditor();
	await userEvent.click(screen.getByRole('button', { name: 'Edit agreement' }));
}

function reviewRegion() {
	return screen.getByRole('region', { name: /review salary/i });
}

function fieldValue(label: string): string {
	return (screen.getByLabelText(label) as HTMLInputElement).value;
}

beforeEach(() => {
	fetchMock.mockClear();
	global.fetch = fetchMock as unknown as typeof fetch;
	api.directory = directoryResponse();
	api.directoryStatus = 200;
	api.timeline = timeline();
	api.directoryRequests = [];
	api.timelineCalls = 0;
	api.postCalls = [];
	api.post = null;
	routerPush.mockReset();
	routerReplace.mockReset();
});

/* --------------------------------------------------------------------- tests */

describe('SalaryProfileList', () => {
	it('lists Employee identity, pay stream, CTC provenance and missing profiles', async () => {
		api.directory = directoryResponse({
			total: 3,
			counts: {
				total: 3,
				payroll: 1,
				contract: 1,
				missing: 1,
				ambiguous: 0,
			},
			data: [
				directoryRow({
					agreement: directoryAgreement({ used: true }),
					use_months: ['2026-11-01'],
				}),
				directoryRow({
					id: 8,
					employee_id: 'EMP-008',
					full_name: 'Bilal Khan',
					employee_type: 'Payroll',
					agreement: directoryAgreement({
						agreement_id: 21,
						agreement_source: 'salary_structures',
						salary_type: 'contract',
						pay_stream: 'contract',
						classification: 'scheduled',
						effective_from: '2026-12-01',
						ctc: ctc(90000, 'gross_salary'),
					}),
				}),
				directoryRow({
					id: 9,
					employee_id: 'EMP-009',
					full_name: 'Chitra Sen',
					employee_type: 'Intern',
					status: 'inactive',
					exit_date: '2026-10-31',
					state: 'unavailable',
					has_agreement: false,
					agreement: null,
				}),
			],
		});

		renderWithClient(<SalaryProfileList initialDate="2026-11-15" />);

		const asha = await screen.findByRole('link', {
			name: 'Open salary profile for Asha Rao (EMP-007)',
		});
		const ashaRow = asha.closest('li') as HTMLElement;
		expect(within(ashaRow).getByText('Used by payroll')).toBeInTheDocument();
		expect(within(ashaRow).getByText('Payroll')).toBeInTheDocument();
		expect(within(ashaRow).getByText('Current')).toBeInTheDocument();

		const bilal = screen.getByRole('link', {
			name: 'Open salary profile for Bilal Khan (EMP-008)',
		});
		const bilalRow = bilal.closest('li') as HTMLElement;
		expect(within(bilalRow).getByText('Contract')).toBeInTheDocument();
		expect(within(bilalRow).getByText('Scheduled')).toBeInTheDocument();
		expect(within(bilalRow).getByText(/legacy gross/)).toBeInTheDocument();

		const chitra = screen.getByRole('link', {
			name: 'Open salary profile for Chitra Sen (EMP-009)',
		});
		const chitraRow = chitra.closest('li') as HTMLElement;
		expect(
			within(chitraRow).getByText('No salary profile')
		).toBeInTheDocument();
		expect(within(chitraRow).getByText('Inactive')).toBeInTheDocument();
		expect(within(chitraRow).getByText('Intern')).toBeInTheDocument();
	});

	it('requests the selected date and stream and shows the tab counts', async () => {
		api.directory = directoryResponse({
			total: 3,
			counts: {
				total: 3,
				payroll: 1,
				contract: 1,
				missing: 1,
				ambiguous: 0,
			},
		});

		renderWithClient(<SalaryProfileList initialDate="2026-11-15" />);
		await screen.findByRole('link', {
			name: 'Open salary profile for Asha Rao (EMP-007)',
		});

		expect(api.directoryRequests[0]).toContain('date=2026-11-15');
		expect(
			screen.getByRole('button', { name: 'Missing Profile' })
		).toHaveTextContent('1');

		await userEvent.click(screen.getByRole('button', { name: 'Contract' }));

		await waitFor(() =>
			expect(api.directoryRequests.at(-1)).toContain('stream=contract')
		);
		expect(api.directoryRequests.at(-1)).toContain('date=2026-11-15');
	});

	it('shows an empty state when no Employee matches', async () => {
		api.directory = directoryResponse({
			total: 0,
			counts: {
				total: 0,
				payroll: 0,
				contract: 0,
				missing: 0,
				ambiguous: 0,
			},
			data: [],
		});

		renderWithClient(<SalaryProfileList initialDate="2026-11-15" />);

		expect(await screen.findByText(/No Employees match/i)).toBeInTheDocument();
	});

	it('surfaces a read failure and retries the same date', async () => {
		api.directoryStatus = 500;

		renderWithClient(<SalaryProfileList initialDate="2026-11-15" />);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			/Salary directory unavailable/
		);
		const requests = api.directoryRequests.length;
		await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
		await waitFor(() =>
			expect(api.directoryRequests.length).toBeGreaterThan(requests)
		);
		expect(api.directoryRequests.at(-1)).toContain('date=2026-11-15');
	});
});

describe('SalaryProfileEditor', () => {
	it('renders Current, Scheduled, Previous and Cancelled history with permitted actions', async () => {
		api.timeline = timeline({
			agreements: [
				agreement(),
				agreement({
					agreement_id: 12,
					classification: 'scheduled',
					effective_from: '2026-12-01',
					actions: ['correct', 'cancel'],
				}),
				agreement({
					agreement_id: 13,
					classification: 'previous',
					effective_to: '2026-03-31',
					read_only: true,
					editable: false,
					actions: [],
					action_blockers: ['previous'],
				}),
				agreement({
					agreement_id: 14,
					classification: 'cancelled',
					effective_from: '2027-01-01',
					is_active: false,
					cancelled_at: '2026-11-10',
					cancelled_reason: 'Hike withdrawn',
					read_only: true,
					editable: false,
					actions: [],
					action_blockers: ['cancelled'],
				}),
			],
		});

		await openEditor();

		expect(
			screen.getByRole('heading', { name: 'Current' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Scheduled' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Previous' })
		).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Cancelled' })
		).toBeInTheDocument();

		const cards = screen.getAllByRole('listitem');
		const current = cards[0] as HTMLElement;
		const scheduled = cards[1] as HTMLElement;
		const previous = cards[2] as HTMLElement;
		const cancelled = cards[3] as HTMLElement;

		expect(
			within(current).getByRole('button', { name: 'Edit agreement' })
		).toBeInTheDocument();
		expect(
			within(current).getByRole('button', { name: 'New Salary Revision' })
		).toBeInTheDocument();
		expect(
			within(scheduled).getByRole('button', {
				name: 'Cancel scheduled agreement',
			})
		).toBeInTheDocument();
		expect(within(previous).getAllByText(/read-only/i).length).toBeGreaterThan(
			0
		);
		expect(within(cancelled).getByText('Hike withdrawn')).toBeInTheDocument();
		expect(
			within(previous).queryByRole('button', { name: 'Edit agreement' })
		).not.toBeInTheDocument();
		expect(
			within(previous).queryByRole('button', {
				name: 'New Salary Revision',
			})
		).not.toBeInTheDocument();
	});

	it('blocks correction of a used agreement while retaining the revision action', async () => {
		api.timeline = timeline({
			use: {
				used: true,
				ambiguous: false,
				unknown_history: false,
				months: ['2026-04-01'],
				ambiguous_months: [],
				agreements: [
					{
						agreement_id: 11,
						agreement_source: 'employee_salary_profile',
					},
				],
			},
			agreements: [
				agreement({
					used: true,
					use_months: ['2026-04-01'],
					actions: ['revise'],
					editable: false,
					action_blockers: ['used'],
				}),
			],
		});

		await openEditor();

		const card = screen.getAllByRole('listitem')[0] as HTMLElement;
		expect(
			within(card).queryByRole('button', { name: 'Edit agreement' })
		).not.toBeInTheDocument();
		expect(
			within(card).getByRole('button', { name: 'New Salary Revision' })
		).toBeInTheDocument();
	});

	it('presents no write controls to a read-only payroll identity', async () => {
		api.timeline = timeline({
			permissions: { can_read: true, can_update: false, can_delete: false },
			agreements: [
				agreement({
					editable: false,
					read_only: true,
					actions: [],
					action_blockers: ['permission'],
				}),
			],
		});

		await openEditor();

		expect(screen.getByText(/cannot change/i)).toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Edit agreement' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'New Salary Revision' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Cancel scheduled agreement' })
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', { name: 'Create Salary Profile' })
		).not.toBeInTheDocument();
	});

	it('reviews and saves a correction against the same agreement identity', async () => {
		await beginCorrection();

		const ctcInput = screen.getByLabelText('Monthly CTC');
		expect(fieldValue('Monthly CTC')).toBe('50000');
		fireEvent.change(ctcInput, { target: { value: '55000' } });
		await userEvent.click(
			screen.getByRole('button', { name: 'Review correction' })
		);

		const review = reviewRegion();
		expect(within(review).getByText('Monthly CTC')).toBeInTheDocument();
		expect(within(review).getByText(/₹50,000\.00/)).toBeInTheDocument();
		expect(within(review).getByText(/₹55,000\.00/)).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole('button', { name: 'Save correction' })
		);

		await waitFor(() => expect(api.postCalls).toHaveLength(1));
		const body = api.postCalls[0];
		expect(body.operation).toBe('correct');
		expect(body.agreement_id).toBe(11);
		expect(body.expected_timeline_version).toBe(4);
		expect(body.employer_cost).toBe('55000');
		expect(body).not.toHaveProperty('gross_salary');
		expect(body).not.toHaveProperty('gross');
		expect(body).not.toHaveProperty('contract_amount');

		expect(await screen.findByText(/Agreement corrected/)).toBeInTheDocument();
	});

	it('treats a blank CTC as missing and an explicit zero as a real CTC', async () => {
		await beginCorrection();

		const ctcInput = screen.getByLabelText('Monthly CTC');
		fireEvent.change(ctcInput, { target: { value: '' } });
		await userEvent.click(
			screen.getByRole('button', { name: 'Review correction' })
		);

		expect(
			await screen.findByText('Enter the monthly CTC')
		).toBeInTheDocument();
		expect(api.postCalls).toHaveLength(0);

		fireEvent.change(ctcInput, { target: { value: '0' } });
		await userEvent.click(
			screen.getByRole('button', { name: 'Review correction' })
		);
		expect(within(reviewRegion()).getByText(/₹0\.00/)).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole('button', { name: 'Save correction' })
		);
		await waitFor(() => expect(api.postCalls).toHaveLength(1));
		expect(api.postCalls[0].employer_cost).toBe('0');
		expect(api.postCalls[0]).not.toHaveProperty('gross_salary');
		expect(api.postCalls[0]).not.toHaveProperty('gross');
	});

	it('keeps the draft through a stale-version conflict and reloads the latest timeline', async () => {
		api.post = async () =>
			jsonResponse(
				{
					success: false,
					error: 'This salary timeline changed since it was read',
					code: 'stale_version',
					details: { expected_version: 4, actual_version: 5 },
				},
				409
			);

		await beginCorrection();
		const ctcInput = screen.getByLabelText('Monthly CTC');
		fireEvent.change(ctcInput, { target: { value: '55000' } });
		await userEvent.click(
			screen.getByRole('button', { name: 'Review correction' })
		);
		await userEvent.click(
			screen.getByRole('button', { name: 'Save correction' })
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			/changed since it was read/i
		);
		expect(fieldValue('Monthly CTC')).toBe('55000');

		api.timeline = { ...timeline(), timeline_version: 5 };
		const reads = api.timelineCalls;
		await userEvent.click(
			screen.getByRole('button', { name: 'Reload latest terms' })
		);
		await waitFor(() => expect(api.timelineCalls).toBeGreaterThan(reads));
		expect(fieldValue('Monthly CTC')).toBe('55000');

		api.post = null;
		await userEvent.click(
			screen.getByRole('button', { name: 'Save correction' })
		);
		await waitFor(() => expect(api.postCalls).toHaveLength(2));
		expect(api.postCalls[1].expected_timeline_version).toBe(5);
	});

	it('prevents duplicate submissions while a save is pending', async () => {
		const deferred = Promise.withResolvers<Response>();
		api.post = () => deferred.promise;

		await beginCorrection();
		const ctcInput = screen.getByLabelText('Monthly CTC');
		fireEvent.change(ctcInput, { target: { value: '55000' } });
		await userEvent.click(
			screen.getByRole('button', { name: 'Review correction' })
		);
		await userEvent.click(
			screen.getByRole('button', { name: 'Save correction' })
		);

		const saving = await screen.findByRole('button', { name: 'Saving…' });
		expect(saving).toBeDisabled();
		await userEvent.click(saving);

		deferred.resolve(
			jsonResponse({
				success: true,
				data: {
					operation: 'correct',
					agreement_id: 11,
					timeline_version: 5,
					classification: 'current',
					effective_from: '2026-11-01',
					effective_to: null,
				},
			})
		);

		await screen.findByText(/Agreement corrected/);
		expect(api.postCalls).toHaveLength(1);
	});

	it('prefills and saves a dated New Salary Revision as a distinct operation', async () => {
		await openEditor();
		await userEvent.click(
			screen.getByRole('button', { name: 'New Salary Revision' })
		);

		const start = screen.getByLabelText('Revisions start month');
		expect(fieldValue('Revisions start month')).toBe('2026-12');
		const ctcInput = screen.getByLabelText('Monthly CTC');
		expect(fieldValue('Monthly CTC')).toBe('50000');
		fireEvent.change(ctcInput, { target: { value: '60000' } });
		fireEvent.change(start, { target: { value: '2027-01' } });
		await userEvent.click(
			screen.getByRole('button', { name: 'Review revision' })
		);

		expect(
			within(reviewRegion()).getByText(/January 2027/)
		).toBeInTheDocument();
		await userEvent.click(
			screen.getByRole('button', { name: 'Save revision' })
		);

		await waitFor(() => expect(api.postCalls).toHaveLength(1));
		const body = api.postCalls[0];
		expect(body.operation).toBe('revise');
		expect(body.agreement_id).toBe(11);
		expect(body.effective_from).toBe('2027-01-01');
		expect(body.employer_cost).toBe('60000');
		expect(body).not.toHaveProperty('gross_salary');
	});

	it('requires a reason and records an explicit scheduled cancellation', async () => {
		api.timeline = timeline({
			agreements: [
				agreement(),
				agreement({
					agreement_id: 12,
					classification: 'scheduled',
					effective_from: '2026-12-01',
					actions: ['correct', 'cancel'],
				}),
			],
		});

		await openEditor();
		const scheduled = screen.getAllByRole('listitem')[1] as HTMLElement;
		await userEvent.click(
			within(scheduled).getByRole('button', {
				name: 'Cancel scheduled agreement',
			})
		);

		await userEvent.click(
			screen.getByRole('button', { name: 'Confirm cancellation' })
		);
		expect(
			await screen.findByText('Enter a cancellation reason')
		).toBeInTheDocument();
		expect(api.postCalls).toHaveLength(0);

		await userEvent.type(
			screen.getByLabelText('Cancellation reason'),
			'Hike withdrawn'
		);
		await userEvent.click(
			screen.getByRole('button', { name: 'Confirm cancellation' })
		);

		await waitFor(() => expect(api.postCalls).toHaveLength(1));
		const body = api.postCalls[0];
		expect(body.operation).toBe('cancel');
		expect(body.agreement_id).toBe(12);
		expect(body.expected_timeline_version).toBe(4);
		expect(body.cancellation_reason).toBe('Hike withdrawn');
	});

	it('explains CTC, Basis Hours, Logged Hours and the legacy fallback', async () => {
		api.timeline = timeline({
			agreements: [
				agreement({
					ctc: ctc(48000, 'gross_salary'),
					settings: {
						std_hours_per_day: 8,
						salary_type: 'monthly',
						is_manual_override: false,
					},
					legacy_amounts: {
						gross_salary: 48000,
						gross: null,
						contract_amount: null,
						contract_duration: null,
						contract_end_date: null,
					},
				}),
			],
		});

		await openEditor();

		expect(
			await screen.findByText(
				'Basis Hours = 22 working days × 8 hours per day = 176 hours for November 2026.'
			)
		).toBeInTheDocument();
		expect(
			screen.getAllByText(/not a generated Payroll Slip/i).length
		).toBeGreaterThan(0);
		expect(screen.getAllByText(/legacy gross salary/i).length).toBeGreaterThan(
			0
		);
		expect(screen.getAllByText(/Logged Hours/).length).toBeGreaterThan(0);
		expect(screen.getByText(/Recorded references/i)).toBeInTheDocument();
		expect(screen.getAllByText(/₹48,000\.00/).length).toBeGreaterThan(0);
	});

	it('starts a first agreement from the verified joining date without inventing CTC', async () => {
		api.timeline = timeline({
			agreements: [],
			current: {
				state: 'unavailable',
				agreement_source: null,
				agreement_id: null,
				agreement_ids: [],
			},
			employee: {
				...timeline().employee,
				employment_start: '2026-11-03',
			},
		});

		await openEditor();

		expect(screen.getByText(/No salary agreement/i)).toBeInTheDocument();
		expect(fieldValue('Monthly CTC')).toBe('');

		await userEvent.click(
			screen.getByRole('button', { name: 'Create Salary Profile' })
		);
		expect(fieldValue('Effective from')).toBe('2026-11-03');

		fireEvent.change(screen.getByLabelText('Monthly CTC'), {
			target: { value: '45000' },
		});
		await userEvent.click(
			screen.getByRole('button', { name: 'Review new agreement' })
		);
		await userEvent.click(
			screen.getByRole('button', { name: 'Save new agreement' })
		);

		await waitFor(() => expect(api.postCalls).toHaveLength(1));
		const body = api.postCalls[0];
		expect(body.operation).toBe('create-initial');
		expect(body.employee_id).toBe(7);
		expect(body.effective_from).toBe('2026-11-03');
		expect(body.employer_cost).toBe('45000');
		expect(body).not.toHaveProperty('gross_salary');
	});

	it('warns before leaving with unsaved changes and then honours the confirmation', async () => {
		const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
		await beginCorrection();
		const ctcInput = screen.getByLabelText('Monthly CTC');
		fireEvent.change(ctcInput, { target: { value: '56000' } });

		await userEvent.click(
			screen.getByRole('button', { name: 'Back to Salary Profiles' })
		);
		expect(confirm).toHaveBeenCalledWith(
			'You have unsaved salary changes. Leave this page and discard them?'
		);
		expect(routerPush).not.toHaveBeenCalled();
		expect(fieldValue('Monthly CTC')).toBe('56000');

		confirm.mockReturnValue(true);
		await userEvent.click(
			screen.getByRole('button', { name: 'Back to Salary Profiles' })
		);
		expect(routerPush).toHaveBeenCalledWith('/admin/payroll/salary-profiles');
		confirm.mockRestore();
	});
});
