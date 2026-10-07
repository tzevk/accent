import {
	cleanupAttendanceFixtures,
	seedAttendanceFixtures,
} from './lib/attendance-fixtures';
import { deleteArtifact } from './lib/artifacts';
import { closeDb, exec, rows } from './lib/db';
import {
	cleanupExpenditureCurrencyFixtures,
	seedExpenditureCurrencyFixtures,
} from './lib/expenditure-currency-fixtures';
import {
	cleanupCostAccrualFixtures,
	seedCostAccrualFixtures,
} from './lib/cost-accrual-fixtures';
import {
	cleanupExpenditureFixtures,
	seedExpenditureFixtures,
} from './lib/expenditure-fixtures';
import {
	ALLOCATION_ESTIMATE_MONTH,
	ALLOCATION_MONTH,
	cleanupExpenditureAllocationFixtures,
	seedExpenditureAllocationFixtures,
} from './lib/expenditure-allocation-fixtures';
import {
	RECONSTRUCTION_MONTH,
	RECONSTRUCTION_PENDING_MONTH,
	cleanupExpenditureReconstructionFixtures,
	seedExpenditureReconstructionFixtures,
} from './lib/expenditure-reconstruction-fixtures';
import {
	REVISION_MONTH,
	REVISION_PAID_MONTH,
	cleanupExpenditureAllocationRevisionFixtures,
	seedExpenditureAllocationRevisionFixtures,
} from './lib/expenditure-allocation-revision-fixtures';
import {
	cleanupOtherExpenseFixtures,
	seedOtherExpenseFixtures,
} from './lib/other-expense-fixtures';
import { cleanupFixtures, E2E_MONTH, seedFixtures } from './lib/fixtures';
import {
	cleanupPettyCashFixtures,
	seedPettyCashFixtures,
} from './lib/petty-cash-fixtures';
import {
	ORDER_PROJECT,
	cleanupOrderFixtures,
	seedOrderFixtures,
} from './lib/order-fixtures';
import {
	cleanupOrderConsumptionFixtures,
	seedOrderConsumptionFixtures,
} from './lib/order-consumption-fixtures';
import {
	cleanupSupplierInvoiceFixtures,
	seedSupplierInvoiceFixtures,
} from './lib/supplier-invoice-fixtures';
import {
	cleanupUtilizationFixtures,
	seedUtilizationFixtures,
} from './lib/utilization-fixtures';

/**
 * Global setup: purge leftovers from the previous run, refuse to touch a month
 * that is already locked by real data, then seed the fixture namespace.
 */
export default async function globalSetup(): Promise<void> {
	try {
		// Payroll generation includes other fixture rosters. Remove its guarded
		// month-owned slips before any roster cleanup deletes their employees.
		await cleanupExpenditureAllocationFixtures();
		await cleanupExpenditureReconstructionFixtures();
		await cleanupExpenditureAllocationRevisionFixtures();
		await cleanupFixtures();
		await cleanupAttendanceFixtures();
		await cleanupUtilizationFixtures();
		await cleanupOrderFixtures();
		await cleanupOrderConsumptionFixtures();
		await cleanupExpenditureFixtures();
		await cleanupOtherExpenseFixtures();
		await cleanupPettyCashFixtures();
		await cleanupSupplierInvoiceFixtures();
		await cleanupExpenditureCurrencyFixtures();
		await cleanupCostAccrualFixtures();

		// The proxy counts `auth` requests in MySQL fixed windows keyed by the
		// trusted IP header; browser sign-ins carry no such header, so they land
		// under the shared `unknown:anon:auth` bucket. Clear it so repeated runs
		// inside the same 15-minute window start from zero (the harness makes
		// fewer than 10 unauthenticated logins per run; specs that need their own
		// budget set the header and purge their own rows).
		await exec(`DELETE FROM rate_limit_buckets WHERE bucket_key LIKE ?`, [
			'%:anon:auth',
		]);

		// The stored-xss spec persists its coverage into its own artifact as it
		// runs (Playwright restarts the worker after a failure, which wipes
		// module state) and reads it back to assert every write path was
		// covered. The file must start empty each run, or a previous run's
		// coverage would mask a path this run never exercised.
		deleteArtifact('security-stored-xss');

		const existingRun = await rows<{ status: string }>(
			`SELECT status FROM payroll_runs
        WHERE month = 1 AND year = 2019 AND run_number = 1`
		);
		if (existingRun.length > 0) {
			throw new Error(
				`E2E month ${E2E_MONTH} already has a payroll run (status: ${existingRun[0].status}). ` +
					'Point the harness at another month instead of touching real payroll data.'
			);
		}

		const seeded = await seedFixtures();
		console.log(
			`[e2e] fixtures seeded for ${E2E_MONTH} (admin #${seeded.adminUserId}, ` +
				`worker employee #${seeded.workerEmployeeId}, zero-hours employee #${seeded.zeroHoursEmployeeId}, ` +
				`bonus employees #${seeded.bonusEmployeeId}/#${seeded.zeroBonusEmployeeId}/#${seeded.contractBonusEmployeeId}/#${seeded.lateBonusEmployeeId}, ` +
				`preview employee #${seeded.previewBonusEmployeeId})`
		);

		const attendance = await seedAttendanceFixtures();
		console.log(
			`[e2e] attendance fixtures seeded for ${attendance.month} ` +
				`(${attendance.employees} employees, ${attendance.punches} punches, ` +
				`${attendance.attendance} attendance rows, ` +
				`${attendance.assignments} assignments, ` +
				`${attendance.profiles} salary profiles)`
		);

		const utilization = await seedUtilizationFixtures();
		console.log(
			`[e2e] utilization fixtures seeded for ${utilization.month} ` +
				`(${utilization.employees} employees, ${utilization.attendance} attendance rows, ` +
				`${utilization.assignments} assignments, ` +
				`${utilization.loggedDays} logged days, ` +
				`${utilization.linkedUsers} linked user accounts, ` +
				`${utilization.activityLogs} activity logs, ` +
				`${utilization.screenTimeDays} screen-time days, ` +
				`${utilization.holidays} optional holiday, ` +
				`${utilization.profiles} salary profiles)`
		);

		const expenditure = await seedExpenditureFixtures();
		console.log(
			`[e2e] expenditure fixtures seeded for ${expenditure.month}, ${expenditure.nextMonth}, ` +
				`and ${expenditure.budgetMonth} (${expenditure.costs} direct costs, ` +
				`${expenditure.budgets} cost budgets, ` +
				`${Object.keys(expenditure.projects).length} projects)`
		);

		const otherExpenses = await seedOtherExpenseFixtures();
		console.log(
			`[e2e] other-expense fixtures seeded for ${otherExpenses.month} ` +
				`(project ${otherExpenses.projectId}, target ${otherExpenses.targetCostUid})`
		);
		const pettyCash = await seedPettyCashFixtures();
		console.log(
			`[e2e] petty-cash fixtures seeded for ${pettyCash.month} and ${pettyCash.laterMonth} ` +
				`(${Object.keys(pettyCash.projects).length} projects, target cost ${pettyCash.targetCostUid})`
		);
		const supplier = await seedSupplierInvoiceFixtures();
		console.log(
			`[e2e] supplier invoice fixtures seeded for ${supplier.month}, ` +
				`${supplier.invoiceMonth} and ${supplier.laterMonth} ` +
				`(${supplier.invoices} invoices, ` +
				`${Object.keys(supplier.projects).length} projects, ` +
				`${Object.keys(supplier.payableIds).length} payables)`
		);
		const allocation = await seedExpenditureAllocationFixtures();
		console.log(
			`[e2e] allocation fixtures seeded for ${ALLOCATION_MONTH} and ${ALLOCATION_ESTIMATE_MONTH} ` +
				`(${Object.keys(allocation.employeeIds).length} employees, ` +
				`${Object.keys(allocation.projectIds).length} projects)`
		);
		const reconstruction = await seedExpenditureReconstructionFixtures();
		console.log(
			`[e2e] reconstruction fixtures seeded for ${RECONSTRUCTION_MONTH} and ${RECONSTRUCTION_PENDING_MONTH} ` +
				`(${Object.keys(reconstruction.employeeIds).length} employees, ` +
				`${Object.keys(reconstruction.projectIds).length} projects)`
		);
		const revision = await seedExpenditureAllocationRevisionFixtures();
		console.log(
			`[e2e] allocation revision fixtures seeded for ${REVISION_MONTH} and ${REVISION_PAID_MONTH} ` +
				`(${Object.keys(revision.employeeIds).length} employees, ` +
				`${Object.keys(revision.projectIds).length} projects)`
		);
		const currency = await seedExpenditureCurrencyFixtures();
		console.log(
			`[e2e] expenditure currency fixtures seeded for ${currency.months.join(', ')} ` +
				`(${currency.costs} direct costs, ` +
				`${Object.keys(currency.projects).length} projects)`
		);

		const accruals = await seedCostAccrualFixtures();
		console.log(
			`[e2e] cost accrual fixtures seeded for ${accruals.month}, ` +
				`${accruals.partialMonth} and ${accruals.finalMonth} ` +
				`(${accruals.accruals} accruals, ${accruals.invoices} replacement invoices)`
		);

		const orders = await seedOrderFixtures();
		console.log(
			`[e2e] order fixtures seeded for ${orders.month} ` +
				`(project ${ORDER_PROJECT.code} #${orders.projectId}, ` +
				`${Object.keys(orders.legacy).length} legacy copies)`
		);

		const consumption = await seedOrderConsumptionFixtures();
		console.log(
			`[e2e] order-consumption fixtures seeded for ${consumption.month}, ` +
				`${consumption.nextMonth} and ${consumption.laterMonth} ` +
				`(${Object.keys(consumption.orderUids).length} orders, ` +
				`${Object.keys(consumption.invoiceIds).length} recognized invoices)`
		);
	} finally {
		await closeDb();
	}
}
