import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FyView } from './fy-view';
import type { FYCompanyCostData, FYCompanyRow } from '../types';

function fyRow(
	overrides: Partial<FYCompanyRow> & Pick<FYCompanyRow, 'employee_id'>
): FYCompanyRow {
	return {
		sr_no: overrides.employee_id,
		employee_id: overrides.employee_id,
		employee_code: `EMP-${overrides.employee_id}`,
		employee_name: `Employee ${overrides.employee_id}`,
		department: null,
		designation: null,
		project_id: 10,
		project_code: 'PRJ-10',
		project_name: 'Project Ten',
		client_name: 'Client',
		hourly_rate: 100,
		monthly_cost_known: { apr: true },
		monthly_hours: { apr: 8 },
		monthly_cost: { apr: 0 },
		total_hours: 8,
		total_cost: 0,
		cost_known: true,
		worked_outside_finalized_run: false,
		in_saved_roster: true,
		employment_issue: null,
		...overrides,
	};
}

const knownZero = fyRow({
	employee_id: 1,
	employee_name: 'Known Zero',
	total_cost: 0,
	monthly_cost: { apr: 0 },
	total_hours: 8,
});

const unknownZero = fyRow({
	employee_id: 2,
	employee_name: 'Unknown Zero',
	monthly_cost_known: { apr: false },
	monthly_cost: { apr: 0 },
	total_cost: 0,
	cost_known: false,
});

const unknownPriced = fyRow({
	employee_id: 3,
	employee_name: 'Unknown Part',
	monthly_cost_known: { apr: false },
	monthly_cost: { apr: 250 },
	total_cost: 250,
	cost_known: false,
});

const data: FYCompanyCostData = {
	fy_label: 'FY 2026–27',
	fy_year: 2026,
	months: ['Apr'],
	month_keys: ['apr'],
	rows: [knownZero, unknownZero, unknownPriced],
	employee_rows: [],
	project_rows: [],
	totals: {
		monthly_cost_known: { apr: false },
		monthly_hours: { apr: 24 },
		monthly_cost: { apr: 250 },
		total_hours: 24,
		total_cost: 250,
		cost_known: false,
		blended_rate: 10.42,
	},
	summary: {
		total_hours: 24,
		total_cost: 250,
		cost_known: false,
		blended_rate: 10.42,
		employee_count: 3,
		project_count: 1,
	},
};

describe('FyView unknown and known cost', () => {
	it('shows a known company zero as a confirmed zero while keeping unknown money as an em dash', () => {
		render(
			<FyView
				data={data}
				totals={data.totals}
				breakdown="detailed"
				metric="cost"
				rows={data.rows}
				employeeRows={[]}
				projectRows={[]}
			/>
		);

		const zeroRow = screen.getByText('Known Zero').closest('tr');
		expect(zeroRow).not.toBeNull();
		expect(zeroRow as HTMLElement).toHaveTextContent('₹0.00');

		const unknownZeroRow = screen.getByText('Unknown Zero').closest('tr');
		expect(unknownZeroRow).not.toBeNull();
		expect(unknownZeroRow as HTMLElement).toHaveTextContent('—');
		expect(
			within(unknownZeroRow as HTMLElement).getByText(
				'Cost unavailable for this month — unknown, not zero'
			)
		).toBeInTheDocument();
		expect(unknownZeroRow as HTMLElement).not.toHaveTextContent(
			/finalized run/
		);

		const unknownPartRow = screen.getByText('Unknown Part').closest('tr');
		expect(unknownPartRow).not.toBeNull();
		expect(unknownPartRow as HTMLElement).toHaveTextContent('₹250.00 *');

		expect(
			screen.getByText(/partial, unknown cost excluded/)
		).toBeInTheDocument();
	});
});
