import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import EmployeeReportCard from '@/components/reports/EmployeeReportCard';
import type { EmployeeReportItem } from '@/components/reports/EmployeeReportCard';

function makeEmployee(
	overrides: Partial<EmployeeReportItem> = {}
): EmployeeReportItem {
	return {
		user_id: '1',
		user_name: 'Alice Sharma',
		email: 'alice@ac.com',
		rows: [],
		...overrides,
	};
}

describe('EmployeeReportCard', () => {
	it('renders employee name and email in header', () => {
		const employee = makeEmployee();
		render(<EmployeeReportCard employee={employee} />);

		expect(screen.getByText('Alice Sharma')).toBeInTheDocument();
		expect(screen.getByText('alice@ac.com')).toBeInTheDocument();
	});

	it('shows first letter initial in avatar', () => {
		const employee = makeEmployee({ user_name: 'Zara Khan' });
		render(<EmployeeReportCard employee={employee} />);

		expect(screen.getByText('Z')).toBeInTheDocument();
	});

	it('shows "No activities recorded" when rows are empty', () => {
		const employee = makeEmployee({ rows: [] });
		render(<EmployeeReportCard employee={employee} />);

		expect(screen.getByText('No activities recorded')).toBeInTheDocument();
	});

	it('does not render table when rows are empty', () => {
		const employee = makeEmployee({ rows: [] });
		const { container } = render(<EmployeeReportCard employee={employee} />);

		expect(container.querySelector('table')).toBeNull();
	});

	it('renders table with correct column headers', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-15',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Foundation Work',
					sub_activity_name: 'Excavation',
					assignment_id: '10-act-1-1',
					planned_hours: 12,
					hours: 4,
					qty_done: 2,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		expect(screen.getByText('Sr. No')).toBeInTheDocument();
		expect(screen.getByText('Date')).toBeInTheDocument();
		expect(screen.getByText('Project No.')).toBeInTheDocument();
		expect(screen.getByText('Sub-Activity')).toBeInTheDocument();
		// "Assign Manhours" appears in both summary stats AND table header
		expect(
			screen.getAllByText('Assign Manhours').length
		).toBeGreaterThanOrEqual(2);
		expect(
			screen.getAllByText('Actual Manhours').length
		).toBeGreaterThanOrEqual(2);
		expect(screen.getByText('Unit/Qty')).toBeInTheDocument();
	});

	it('renders table rows with correct data', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-15',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Foundation Work',
					sub_activity_name: 'Excavation',
					assignment_id: '10-act-1-1',
					planned_hours: 12,
					hours: 4,
					qty_done: 2,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		expect(screen.getByText('P-010')).toBeInTheDocument();
		expect(screen.getByText('Excavation')).toBeInTheDocument();
		// Values appear in both summary stats and table cells
		expect(screen.getAllByText('12').length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1);
	});

	it('formats date correctly', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-15',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Test',
					sub_activity_name: '',
					assignment_id: '10-1-1',
					planned_hours: 5,
					hours: 3,
					qty_done: 1,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		// en-GB format: 15 Mar 2026
		expect(screen.getByText('15 Mar 2026')).toBeInTheDocument();
	});

	it('shows footer totals correctly for single assignment', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-01',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Work A',
					sub_activity_name: '',
					assignment_id: '10-act-1-1',
					planned_hours: 10,
					hours: 4,
					qty_done: 2,
				},
				{
					date: '2026-03-02',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Work A',
					sub_activity_name: '',
					assignment_id: '10-act-1-1',
					planned_hours: 10,
					hours: 6,
					qty_done: 3,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		const footerCells = document.querySelectorAll('tfoot td');
		// Total | 10 | 10 | 5
		expect(footerCells[1]).toHaveTextContent('10'); // Assign Manhours (distinct)
		expect(footerCells[2]).toHaveTextContent('10'); // Actual Manhours (4+6)
		expect(footerCells[3]).toHaveTextContent('5'); // Qty (2+3)
	});

	it('counts planned_hours only once per distinct assignment in totals', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-01',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Work A',
					sub_activity_name: '',
					assignment_id: '10-act-1-1',
					planned_hours: 10,
					hours: 4,
					qty_done: 2,
				},
				{
					date: '2026-03-01',
					project_id: 20,
					project_code: 'P-020',
					activity_name: 'Work B',
					sub_activity_name: '',
					assignment_id: '20-act-2-1',
					planned_hours: 8,
					hours: 3,
					qty_done: 1,
				},
				{
					date: '2026-03-02',
					project_id: 20,
					project_code: 'P-020',
					activity_name: 'Work B',
					sub_activity_name: '',
					assignment_id: '20-act-2-1',
					planned_hours: 8,
					hours: 5,
					qty_done: 2,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		const footerCells = document.querySelectorAll('tfoot td');
		// Assign: 10 + 8 = 18 (each assignment counted once)
		// Actual: 4 + 3 + 5 = 12
		// Qty: 2 + 1 + 2 = 5
		expect(footerCells[1]).toHaveTextContent('18');
		expect(footerCells[2]).toHaveTextContent('12');
		expect(footerCells[3]).toHaveTextContent('5');
	});

	it('shows summary stats in header', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-01',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Work',
					sub_activity_name: '',
					assignment_id: '10-1-1',
					planned_hours: 10,
					hours: 5,
					qty_done: 3,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		expect(screen.getByText('Rows')).toBeInTheDocument();
		expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1); // rows count + Sr. No
		expect(
			screen.getAllByText('Assign Manhours').length
		).toBeGreaterThanOrEqual(1);
		expect(
			screen.getAllByText('Actual Manhours').length
		).toBeGreaterThanOrEqual(1);
		expect(screen.getAllByText('Total Qty').length).toBe(1);
	});

	it('shows sub_activity_name when present, falls back to activity_name', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-01',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Foundation Work',
					sub_activity_name: 'Excavation',
					assignment_id: '10-1-1',
					planned_hours: 10,
					hours: 5,
					qty_done: 3,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		// Sub-activity is the primary display
		expect(screen.getByText('Excavation')).toBeInTheDocument();
		// Activity name appears as secondary text below
		expect(screen.getByText('Foundation Work')).toBeInTheDocument();
	});

	it('falls back to activity_name when sub_activity_name is empty', () => {
		const employee = makeEmployee({
			rows: [
				{
					date: '2026-03-01',
					project_id: 10,
					project_code: 'P-010',
					activity_name: 'Steel Erection',
					sub_activity_name: '',
					assignment_id: '10-1-1',
					planned_hours: 10,
					hours: 5,
					qty_done: 3,
				},
			],
		});
		render(<EmployeeReportCard employee={employee} />);

		expect(screen.getByText('Steel Erection')).toBeInTheDocument();
	});
});
