import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
	COMPANY_SHEET_COLUMNS,
	type CompanySheetAttendanceBuckets,
	type CompanySheetCell,
	type CompanySheetColumnId,
	type CompanySheetRow,
} from '@/lib/payroll-company-sheet';
import {
	PayrollCompanySheetGrid,
	type PayrollCompanySheetGridRow,
} from './PayrollCompanySheetGrid';

const BUCKETS: CompanySheetAttendanceBuckets = {
	total_days: 31,
	present: 18,
	absent: 1,
	half_days: 2,
	paid_leave: 3,
	paid_leave_by_code: { PL: 2, CL: 1, SL: 0, EL: 0 },
	unpaid_leave: 1,
	unpaid_leave_by_code: { LWP: 1, UL: 0 },
	holidays: 2,
	weekly_off: 4,
	unrecorded: 2,
	upcoming_unrecorded: 1,
	outside_employment: 0,
	invalid_status: 0,
	recorded_days: 27,
	days_paid: 27,
	lwp_days: 2,
	ot_hours: 4.5,
	reconciliation: { calendar_balanced: true, paid_balanced: true },
};

function companyRow(): CompanySheetRow {
	const cells = {} as Record<CompanySheetColumnId, CompanySheetCell>;
	for (const column of COMPANY_SHEET_COLUMNS) {
		if (column.kind === 'unsupported') {
			cells[column.id] = {
				state: 'not_available',
				reason: 'unsupported_mapping',
			};
		} else if (column.kind === 'text') {
			cells[column.id] = {
				state: 'text',
				value:
					column.id === 'full_name'
						? 'Asha Rao'
						: column.id === 'employee_code'
							? 'EMP-042'
							: '—',
			};
		} else {
			cells[column.id] = { state: 'number', value: 0 };
		}
	}
	cells.total_days = { state: 'number', value: 31 };
	cells.days_present = { state: 'number', value: 18 };
	cells.days_paid = { state: 'number', value: 27 };
	cells.basic = { state: 'number', value: 1000 };
	cells.da = { state: 'number', value: 400 };
	cells.hra = { state: 'number', value: 600 };
	cells.conveyance_allowance = { state: 'number', value: 250 };
	cells.call_allowance = { state: 'number', value: 150 };
	cells.other_allowance = { state: 'number', value: 100 };
	cells.bonus = { state: 'number', value: 200 };
	cells.incentive = { state: 'number', value: 0 };
	cells.provident_fund = { state: 'number', value: 1800 };
	cells.esic = { state: 'number', value: 0 };
	cells.professional_tax = { state: 'number', value: 200 };
	cells.tax_deducted_at_source = { state: 'number', value: 100 };
	cells.retention_amount = { state: 'number', value: 50 };
	cells.gross = { state: 'number', value: 12500 };
	cells.total_ded = { state: 'number', value: 2500 };
	cells.net_sal = { state: 'number', value: 10000 };
	cells.loan = {
		state: 'not_available',
		reason: 'unsupported_mapping',
	};

	return {
		slip_id: 901,
		employee_id: 42,
		cells,
		attendance: { state: 'available', buckets: BUCKETS },
		deduction_details: [
			{
				id: 'provident_fund',
				label: 'Provident fund (employee)',
				amount: 1800,
				state: 'recorded',
				in_company_columns: true,
			},
			{
				id: 'other_deductions',
				label: 'Other deductions',
				amount: 500,
				state: 'recorded',
				in_company_columns: false,
				note: 'The recorded amount is combined; the Loan and Advance split is unavailable.',
			},
			{
				id: 'mlwf',
				label: 'MLWF',
				amount: null,
				state: 'not_recorded',
				in_company_columns: false,
			},
		],
		issues: [
			{
				code: 'loan_advance_split_unavailable',
				severity: 'info',
				scope: 'financial',
				message:
					'Only the combined other deduction is recorded, so LOAN and ADVANCE stay unavailable.',
			},
		],
	};
}

function gridRow(
	overrides: Partial<PayrollCompanySheetGridRow> = {}
): PayrollCompanySheetGridRow {
	return {
		sheet: companyRow(),
		payment_status: 'pending',
		payment_date: '2026-11-07',
		...overrides,
	};
}

describe('PayrollCompanySheetGrid', () => {
	it('renders the company columns, the slip link and a keyboard expansion', async () => {
		const user = userEvent.setup();
		render(<PayrollCompanySheetGrid rows={[gridRow()]} />);

		const headers = screen.getAllByRole('columnheader');
		expect(headers).toHaveLength(51);
		expect(headers[0]).toHaveTextContent('Employee Code');
		expect(headers[50]).toHaveTextContent('NET SAL');

		const slipLink = screen.getByRole('link', { name: 'Asha Rao' });
		expect(slipLink).toHaveAttribute('href', '/admin/payroll/slips/901');
		expect(screen.getAllByText('₹12,500.00').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Not available').length).toBeGreaterThan(0);
		expect(screen.getAllByText('₹0.00').length).toBeGreaterThan(0);

		const expand = screen.getByRole('button', {
			name: /expand attendance and deduction details for asha rao/i,
		});
		expect(expand).toHaveAttribute('aria-expanded', 'false');

		expand.focus();
		await user.keyboard('{Enter}');

		expect(expand).toHaveAttribute('aria-expanded', 'true');
		expect(
			screen.getByText(
				'Current attendance — generated payroll amounts are unchanged'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(/Company Days Paid = Days Present/)
		).toBeInTheDocument();
		expect(screen.getByText(/not Logged Hours/)).toBeInTheDocument();
		expect(screen.getByText('Other deductions')).toBeInTheDocument();
		expect(screen.getByText('₹500.00')).toBeInTheDocument();
		expect(
			screen.getByText(
				'Only the combined other deduction is recorded, so LOAN and ADVANCE stay unavailable.'
			)
		).toBeInTheDocument();
		expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
		expect(screen.getByText(/Nov 2026/)).toBeInTheDocument();
	});

	it('keeps stored money visible when attendance evidence is unavailable', async () => {
		const user = userEvent.setup();
		const row = gridRow({
			sheet: {
				...companyRow(),
				attendance: {
					state: 'unavailable',
					reason: 'attendance_source_error',
				},
			},
		});
		render(<PayrollCompanySheetGrid rows={[row]} />);

		expect(screen.getAllByText('₹12,500.00').length).toBeGreaterThan(0);

		await user.click(
			screen.getByRole('button', {
				name: /expand attendance and deduction details for asha rao/i,
			})
		);

		expect(
			screen.getByText(/Attendance data could not be read/)
		).toBeInTheDocument();
		expect(screen.getAllByText('₹12,500.00').length).toBeGreaterThan(0);
		expect(screen.getAllByText('₹2,500.00').length).toBeGreaterThan(0);
		expect(screen.getAllByText('₹10,000.00').length).toBeGreaterThan(0);
	});

	const footerCell = (totals: HTMLElement, id: CompanySheetColumnId) =>
		within(totals).getAllByRole('cell')[
			COMPANY_SHEET_COLUMNS.findIndex((column) => column.id === id)
		];

	it('totals every supported monetary column and leaves unsupported ones blank', () => {
		render(
			<PayrollCompanySheetGrid
				rows={[
					gridRow(),
					gridRow({
						sheet: {
							...companyRow(),
							slip_id: 902,
							cells: {
								...companyRow().cells,
								gross: { state: 'number', value: 500 },
								total_ded: { state: 'number', value: 0 },
								net_sal: { state: 'number', value: 500 },
							},
						},
					}),
				]}
			/>
		);

		const totals = screen.getByRole('row', { name: /TOTALS/ });
		expect(footerCell(totals, 'basic')).toHaveTextContent('₹2,000.00');
		expect(footerCell(totals, 'da')).toHaveTextContent('₹800.00');
		expect(footerCell(totals, 'hra')).toHaveTextContent('₹1,200.00');
		expect(footerCell(totals, 'conveyance_allowance')).toHaveTextContent(
			'₹500.00'
		);
		expect(footerCell(totals, 'call_allowance')).toHaveTextContent('₹300.00');
		expect(footerCell(totals, 'other_allowance')).toHaveTextContent('₹200.00');
		expect(footerCell(totals, 'bonus')).toHaveTextContent('₹400.00');
		// Genuine recorded zeros stay zero, rather than going blank.
		expect(footerCell(totals, 'incentive')).toHaveTextContent('₹0.00');
		expect(footerCell(totals, 'provident_fund')).toHaveTextContent('₹3,600.00');
		expect(footerCell(totals, 'esic')).toHaveTextContent('₹0.00');
		expect(footerCell(totals, 'professional_tax')).toHaveTextContent('₹400.00');
		expect(footerCell(totals, 'tax_deducted_at_source')).toHaveTextContent(
			'₹200.00'
		);
		expect(footerCell(totals, 'retention_amount')).toHaveTextContent('₹100.00');
		expect(footerCell(totals, 'gross')).toHaveTextContent('₹13,000.00');
		expect(footerCell(totals, 'total_ded')).toHaveTextContent('₹2,500.00');
		expect(footerCell(totals, 'net_sal')).toHaveTextContent('₹10,500.00');

		expect(footerCell(totals, 'employee_code')).toHaveTextContent('TOTALS');
		// Unsupported, rate, identity and attendance columns acquire no total.
		for (const id of [
			'uan',
			'total_days',
			'days_present',
			'ot_hours',
			'ot_rate',
			'paid_holiday_amount',
			'basic_arrears',
			'loan',
			'advance',
		] as const) {
			expect(footerCell(totals, id).textContent).toBe('');
		}
	});

	it('keeps a supported footer total unavailable when a row value is missing', () => {
		const incomplete = companyRow();
		incomplete.cells.basic = {
			state: 'not_available',
			reason: 'not_recorded',
		};

		render(<PayrollCompanySheetGrid rows={[gridRow({ sheet: incomplete })]} />);

		const totals = screen.getByRole('row', { name: /TOTALS/ });
		expect(footerCell(totals, 'basic')).toHaveTextContent('Not available');
		// One missing component does not hide the totals that are fully known.
		expect(footerCell(totals, 'gross')).toHaveTextContent('₹12,500.00');
		expect(footerCell(totals, 'net_sal')).toHaveTextContent('₹10,000.00');
	});
});
