import { beforeEach, describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { grantFor } from '../../../payroll/test-perms';

const mocks = vi.hoisted(() => ({
	mockDbConnect: vi.fn(),
	mockEnsurePermission: vi.fn(),
}));

vi.mock('@/utils/database', () => ({ dbConnect: mocks.mockDbConnect }));
vi.mock('@/utils/api-permissions', () => ({
	ensurePermission: mocks.mockEnsurePermission,
	RESOURCES: { PAYROLL: 'payroll', EMPLOYEES: 'employees' },
	PERMISSIONS: { READ: 'read' },
}));

type ExportRoute = {
	GET: (
		request: Request,
		context?: { params: Promise<{ id: string }> }
	) => Promise<Response>;
};

type RouteCase = {
	name: string;
	url: string;
	load: () => Promise<ExportRoute>;
	context?: { params: Promise<{ id: string }> };
	/** DB results in the order the handler asks for them. */
	queries: unknown[][];
};

const EMPLOYEE_ROW = {
	id: 7,
	employee_id: 'EMP-7',
	first_name: 'Asha',
	last_name: 'Rao',
	email: 'asha@example.test',
	department: 'Engineering',
	position: 'Engineer',
	status: 'active',
	employment_status: 'Permanent',
	hire_date: '2024-04-01',
	joining_date: '2024-04-01',
};

const PROFILE_ROW = {
	id: 41,
	employee_id: 7,
	employer_cost: 26000,
	gross_salary: null,
	effective_from: '2026-04-01',
	effective_to: null,
};

const routes: RouteCase[] = [
	{
		name: 'all employees',
		url: 'http://localhost/api/employees/salary-structure/export',
		load: () =>
			import('@/app/api/employees/salary-structure/export/route') as Promise<ExportRoute>,
		// employees, Salary Profile rows, legacy structures, legacy components
		queries: [[EMPLOYEE_ROW], [PROFILE_ROW], [], []],
	},
	{
		name: 'one employee',
		url: 'http://localhost/api/employees/7/salary-structure/export',
		load: () =>
			import('@/app/api/employees/[id]/salary-structure/export/route') as Promise<ExportRoute>,
		context: { params: Promise.resolve({ id: '7' }) },
		// the Employee, legacy structures, Salary Profile rows
		queries: [[EMPLOYEE_ROW], [], [PROFILE_ROW]],
	},
];

const connection = {
	execute: vi.fn(),
	release: vi.fn(),
};

const grant = grantFor(mocks.mockEnsurePermission);

const call = (route: RouteCase) =>
	route.load().then(({ GET }) => GET(new Request(route.url), route.context));

/** Every value written into the named worksheet, flattening rows. */
const sheetValues = (workbook: ExcelJS.Workbook, name: string) => {
	const sheet = workbook.getWorksheet(name);
	expect(sheet).toBeDefined();
	const values: unknown[] = [];
	sheet?.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
	return values;
};

describe('employee salary-structure export — payroll authorization (#451)', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.mockDbConnect.mockResolvedValue(connection);
		connection.execute.mockResolvedValue([[], undefined]);
	});

	it.each(routes)(
		'$name export denies an employees-only caller',
		async (route) => {
			grant('employees:read');

			const res = await call(route);

			// Employee-directory access does not entitle anyone to salary data.
			expect(res.status).toBe(403);
			expect(res.headers.get('content-disposition')).toBeNull();
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		}
	);

	it.each(routes)(
		'$name export denies a caller with no salary grant',
		async (route) => {
			grant();

			const res = await call(route);

			expect(res.status).toBe(403);
			expect(res.headers.get('content-disposition')).toBeNull();
			expect(mocks.mockDbConnect).not.toHaveBeenCalled();
		}
	);

	it.each(routes)(
		'$name export lets a payroll-only caller download the agreed salary',
		async (route) => {
			grant('payroll:read');
			for (const rows of route.queries) {
				connection.execute.mockResolvedValueOnce([rows, undefined]);
			}

			const res = await call(route);

			expect(res.status).toBe(200);
			expect(res.headers.get('content-type')).toBe(
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
			);
			expect(res.headers.get('content-disposition')).toMatch(
				/^attachment; filename="Salary_Structure/
			);
			expect(mocks.mockDbConnect).toHaveBeenCalledTimes(1);

			// The download carries the stored salary, not a placeholder.
			const workbook = new ExcelJS.Workbook();
			await workbook.xlsx.load(await res.arrayBuffer());
			expect(sheetValues(workbook, 'SalaryProfiles')).toContain(26000);
		}
	);
});
