/**
 * Disposable database rows for two read-only reports:
 *
 * - Employee Utilization: one Payroll Employee with a canonical salary
 *   agreement and Logged Hours in two reserved months. The months are fixed
 *   and unusual (2033-05 / 2033-06) so parallel fixtures cannot move this
 *   report's capacity, basis hours or month list. Expected money and hours are
 *   authored literals from those rows, not values read back from the report.
 * - Sales Register: two owned customers, three invoices and one receipt for
 *   the chosen customer. Amounts are authored so the register totals, net
 *   receivable and receipt drill-down can be asserted as fixed text.
 *
 * Every row is tracked by primary key. Cleanup removes only this fixture's
 * rows; a failed seed cleans up what it created before rethrowing. The fixture
 * never seeds a super-admin, shared session or production record.
 */
import { createHash, randomUUID } from 'node:crypto';
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';

/* ── Employee Utilization fixture ───────────────────────────────────── */

export interface UtilizationActivityExpectation {
	name: string;
	discipline: string | null;
	hours: number;
}

export interface UtilizationProjectExpectation {
	projectId: number;
	code: string;
	name: string;
	clientName: string;
	hours: number;
	activities: UtilizationActivityExpectation[];
}

export interface UtilizationMonthExpectation {
	slug: string;
	label: string;
	capacityHours: number;
	loggedHours: number;
	utilizationPercent: number;
	monthlyCost: number;
	fractionalCost: number;
	benchCost: number;
	/** The page renders `bandText`, e.g. `Under` / `Over`. */
	flag: string;
}

export interface UtilizationFixture {
	namespace: string;
	employee: {
		id: number;
		code: string;
		fullName: string;
		department: string;
	};
	months: {
		may: UtilizationMonthExpectation;
		june: UtilizationMonthExpectation;
	};
	projects: {
		alpha: UtilizationProjectExpectation;
		beta: UtilizationProjectExpectation;
	};
	noProject: {
		hours: number;
		activity: UtilizationActivityExpectation;
	};
}

interface UtilizationOwned {
	employeeId: number | null;
	projectIds: number[];
}

/* ── Sales Register fixture ─────────────────────────────────────────── */

export interface SalesRegisterInvoiceExpectation {
	id: number;
	number: string;
	gross: number;
	cgst: number;
	sgst: number;
	total: number;
	received: number;
	netReceivable: number;
	receiptNumber: string | null;
}

export interface SalesRegisterFixture {
	namespace: string;
	customerName: string;
	otherCustomerName: string;
	companyIds: {
		customer: number;
		other: number;
	};
	invoices: {
		chosen: SalesRegisterInvoiceExpectation;
		second: SalesRegisterInvoiceExpectation;
		other: SalesRegisterInvoiceExpectation;
	};
	receipt: {
		id: string;
		number: string;
		amount: number;
		date: string;
	};
}

interface SalesOwned {
	companyIds: number[];
	invoiceIds: number[];
	paymentEntryIds: string[];
}

/** A namespaced key short enough for an employee code and stable across rows. */
function fixtureKey(namespace: string): string {
	return createHash('sha256').update(namespace).digest('hex').slice(0, 8);
}

function requireNamespace(namespace: string): string {
	const value = namespace.trim();
	if (!value) throw new Error('[report-data] namespace must not be empty.');
	return value;
}

function dateIn(month: string, day: number): string {
	return `${month}-${String(day).padStart(2, '0')}`;
}

function dailyEntries(
	month: string,
	days: readonly number[],
	hours: number
): string {
	return JSON.stringify(
		days.map((day) => ({ date: dateIn(month, day), hours }))
	);
}

/* ── seed: Employee Utilization ─────────────────────────────────────── */

/**
 * Seed the workforce fixture. `actorUserId` is the ordinary signed-in
 * identity the Logged Hours assignments are attributed to; the Employee is an
 * explicit `employee_id` on each assignment, so the account needs no employee
 * link of its own.
 */
export async function seedUtilizationFixture(
	connection: Connection,
	namespace: string,
	actorUserId: number
): Promise<UtilizationFixture> {
	const fixtureNamespace = requireNamespace(namespace);
	if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
		throw new Error('[report-data] actorUserId must be a positive integer.');
	}
	const key = fixtureKey(fixtureNamespace);
	const employeeCode = fitIdentifier(`E2E-UTIL-${key}`, 20);
	const firstName = 'E2E';
	const lastName = `Util ${key.slice(0, 4)}`;
	const fullName = `${firstName} ${lastName}`;
	const department = fitIdentifier(`E2E Workforce ${key}`, 50);
	const email = `${fitIdentifier(`${fixtureNamespace}-employee`, 80).toLowerCase()}@e2e.invalid`;
	const alphaCode = fitIdentifier(`E2E-UA-${key}`, 100);
	const betaCode = fitIdentifier(`E2E-UB-${key}`, 100);
	const alphaName = fitIdentifier(`E2E Utilization Alpha ${key}`, 255);
	const betaName = fitIdentifier(`E2E Utilization Beta ${key}`, 255);
	const alphaClient = fitIdentifier(`E2E Alpha Client ${key}`, 255);
	const betaClient = fitIdentifier(`E2E Beta Client ${key}`, 255);

	const may = '2033-05';
	const june = '2033-06';
	const owned: UtilizationOwned = { employeeId: null, projectIds: [] };

	try {
		const employeeId = await insertRow(
			connection,
			`INSERT INTO employees (
          employee_id, first_name, last_name, email, position, department,
          hire_date, joining_date, exit_date, status, employee_type, grade,
          designation, company_name, isDelete
        ) VALUES (?, ?, ?, ?, 'Workforce Analyst', ?, ?, ?, '2033-12-31',
                  'active', 'Payroll', 'E2E', 'Workforce Analyst',
                  'Accent Techno Solutions Pvt Ltd', 0)`,
			[
				employeeCode,
				firstName,
				lastName,
				email,
				department,
				`${may}-01`,
				`${may}-01`,
			]
		);
		owned.employeeId = employeeId;

		await insertRow(
			connection,
			`INSERT INTO employee_salary_profile (
          employee_id, gross, gross_salary, effective_from, effective_to,
          is_active, salary_type, employer_cost, std_hours_per_day,
          std_working_days, da_year
        ) VALUES (?, 48000, 48000, ?, NULL, 1, 'monthly', 48000, 8.0, 26, 2033)`,
			[employeeId, `${may}-01`]
		);

		const alphaId = await insertProject(
			connection,
			alphaCode,
			alphaName,
			alphaClient
		);
		owned.projectIds.push(alphaId);
		const betaId = await insertProject(
			connection,
			betaCode,
			betaName,
			betaClient
		);
		owned.projectIds.push(betaId);

		// May: 200 Logged Hours across two projects and the explicit
		// No-project bucket. Alpha's two activities are separate assignments
		// so the expanded panel must group them under one project.
		await insertAssignment(connection, {
			userId: actorUserId,
			employeeId,
			projectId: alphaId,
			activityName: 'Technical Design',
			disciplineName: 'Structural',
			dailyEntries: dailyEntries(
				may,
				[3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 17, 18, 19, 20, 21],
				8
			),
			startDate: dateIn(may, 3),
		});
		await insertAssignment(connection, {
			userId: actorUserId,
			employeeId,
			projectId: alphaId,
			activityName: 'Site Review',
			disciplineName: 'Civil',
			dailyEntries: dailyEntries(may, [24, 25, 26], 8),
			startDate: dateIn(may, 24),
		});
		await insertAssignment(connection, {
			userId: actorUserId,
			employeeId,
			projectId: betaId,
			activityName: 'Drafting',
			disciplineName: 'Architectural',
			dailyEntries: dailyEntries(may, [27, 28, 29, 31], 8),
			startDate: dateIn(may, 27),
		});
		await insertAssignment(connection, {
			userId: actorUserId,
			employeeId,
			projectId: null,
			activityName: 'Team Sync',
			disciplineName: null,
			dailyEntries: dailyEntries(may, [1, 8, 15], 8),
			startDate: dateIn(may, 1),
		});

		// June: 96 Logged Hours, so switching months changes the visible
		// capacity-weighted reading (50.00%) from May's 104.17%.
		await insertAssignment(connection, {
			userId: actorUserId,
			employeeId,
			projectId: betaId,
			activityName: 'June Delivery',
			disciplineName: 'Architectural',
			dailyEntries: dailyEntries(
				june,
				[1, 2, 3, 4, 7, 8, 9, 10, 11, 14, 15, 16],
				8
			),
			startDate: dateIn(june, 1),
		});

		return {
			namespace: fixtureNamespace,
			employee: {
				id: employeeId,
				code: employeeCode,
				fullName,
				department,
			},
			months: {
				// 24 working days × 8h; 48000 ÷ (26 basis days × 8h) is the
				// payroll-aligned rate, so 200h rounds to 46153.85 utilized.
				may: {
					slug: may,
					label: 'May 2033',
					capacityHours: 192,
					loggedHours: 200,
					utilizationPercent: 104.17,
					monthlyCost: 48000,
					fractionalCost: 46153.85,
					benchCost: 1846.15,
					flag: 'Over',
				},
				june: {
					slug: june,
					label: 'June 2033',
					capacityHours: 192,
					loggedHours: 96,
					utilizationPercent: 50,
					monthlyCost: 48000,
					fractionalCost: 22153.85,
					benchCost: 25846.15,
					flag: 'Under',
				},
			},
			projects: {
				alpha: {
					projectId: alphaId,
					code: alphaCode,
					name: alphaName,
					clientName: alphaClient,
					hours: 144,
					activities: [
						{ name: 'Technical Design', discipline: 'Structural', hours: 120 },
						{ name: 'Site Review', discipline: 'Civil', hours: 24 },
					],
				},
				beta: {
					projectId: betaId,
					code: betaCode,
					name: betaName,
					clientName: betaClient,
					hours: 32,
					activities: [
						{ name: 'Drafting', discipline: 'Architectural', hours: 32 },
					],
				},
			},
			noProject: {
				hours: 24,
				activity: { name: 'Team Sync', discipline: null, hours: 24 },
			},
		};
	} catch (error) {
		await cleanupUtilizationOwned(connection, owned).catch(() => undefined);
		throw error;
	}
}

/** Delete only the rows this fixture owns. Safe after a partial seed. */
export async function cleanupUtilizationFixture(
	connection: Connection,
	fixture: UtilizationFixture
): Promise<void> {
	await cleanupUtilizationOwned(connection, {
		employeeId: fixture.employee.id,
		projectIds: [
			fixture.projects.alpha.projectId,
			fixture.projects.beta.projectId,
		],
	});
}

async function cleanupUtilizationOwned(
	connection: Connection,
	owned: UtilizationOwned
): Promise<void> {
	await connection.beginTransaction();
	try {
		if (owned.employeeId !== null) {
			await connection.execute(
				'DELETE FROM user_activity_assignments WHERE employee_id = ?',
				[owned.employeeId]
			);
			await connection.execute(
				'DELETE FROM employee_salary_profile WHERE employee_id = ?',
				[owned.employeeId]
			);
		}
		await deleteByIds(connection, 'projects', 'project_id', owned.projectIds);
		if (owned.employeeId !== null) {
			await connection.execute('DELETE FROM employees WHERE id = ?', [
				owned.employeeId,
			]);
		}
		await connection.commit();
	} catch (error) {
		try {
			await connection.rollback();
		} catch {
			// Preserve the original cleanup failure.
		}
		throw error;
	}
}

async function insertProject(
	connection: Connection,
	code: string,
	name: string,
	clientName: string
): Promise<number> {
	return insertRow(
		connection,
		`INSERT INTO projects (
        project_code, project_title, name, client_name, status, isDelete
      ) VALUES (?, ?, ?, ?, 'ONGOING', 0)`,
		[code, name, name, clientName]
	);
}

async function insertAssignment(
	connection: Connection,
	input: {
		userId: number;
		employeeId: number;
		projectId: number | null;
		activityName: string;
		disciplineName: string | null;
		dailyEntries: string;
		startDate: string;
	}
): Promise<void> {
	await connection.execute(
		`INSERT INTO user_activity_assignments (
        id, user_id, employee_id, project_id, activity_name, discipline_name,
        status, daily_entries, start_date
      ) VALUES (?, ?, ?, ?, ?, ?, 'In Progress', ?, ?)`,
		[
			randomUUID(),
			input.userId,
			input.employeeId,
			input.projectId,
			input.activityName,
			input.disciplineName,
			input.dailyEntries,
			input.startDate,
		]
	);
}

/* ── seed: Sales Register ───────────────────────────────────────────── */

/**
 * Seed two customers so the register's customer search has a visible
 * exclusion. The chosen customer owns two invoices and one receipt; the other
 * customer owns one unrelated invoice.
 */
export async function seedSalesRegisterFixture(
	connection: Connection,
	namespace: string
): Promise<SalesRegisterFixture> {
	const fixtureNamespace = requireNamespace(namespace);
	const key = fixtureKey(fixtureNamespace);
	const customerName = fitIdentifier(`E2E Sales Customer ${key}`, 255);
	const otherCustomerName = fitIdentifier(`E2E Other Customer ${key}`, 255);
	const chosenNumber = fitIdentifier(`E2E-SR-${key}-01`, 50);
	const secondNumber = fitIdentifier(`E2E-SR-${key}-02`, 50);
	const otherNumber = fitIdentifier(`E2E-SR-${key}-03`, 50);
	const receiptNumber = fitIdentifier(`E2E-RCPT-${key}`, 100);
	const owned: SalesOwned = {
		companyIds: [],
		invoiceIds: [],
		paymentEntryIds: [],
	};

	try {
		const customerId = await insertRow(
			connection,
			`INSERT INTO companies (company_id, company_name, isDelete)
       VALUES (?, ?, 0)`,
			[fitIdentifier(`E2E-SC-${key}`, 50), customerName]
		);
		owned.companyIds.push(customerId);
		const otherCustomerId = await insertRow(
			connection,
			`INSERT INTO companies (company_id, company_name, isDelete)
       VALUES (?, ?, 0)`,
			[fitIdentifier(`E2E-SO-${key}`, 50), otherCustomerName]
		);
		owned.companyIds.push(otherCustomerId);

		const chosenId = await insertInvoice(connection, {
			number: chosenNumber,
			clientName: customerName,
			gross: 10000,
			cgst: 900,
			sgst: 900,
			total: 11800,
			invoiceDate: '2033-04-10',
			dueDate: '2033-05-10',
			notes: `[report-data ${fixtureNamespace}] chosen invoice`,
		});
		owned.invoiceIds.push(chosenId);
		const secondId = await insertInvoice(connection, {
			number: secondNumber,
			clientName: customerName,
			gross: 5000,
			cgst: 450,
			sgst: 450,
			total: 5900,
			invoiceDate: '2033-04-12',
			dueDate: '2033-05-12',
			notes: `[report-data ${fixtureNamespace}] second invoice`,
		});
		owned.invoiceIds.push(secondId);
		const otherId = await insertInvoice(connection, {
			number: otherNumber,
			clientName: otherCustomerName,
			gross: 7000,
			cgst: 630,
			sgst: 630,
			total: 8260,
			invoiceDate: '2033-04-15',
			dueDate: '2033-05-15',
			notes: `[report-data ${fixtureNamespace}] excluded invoice`,
		});
		owned.invoiceIds.push(otherId);

		const paymentEntryId = randomUUID();
		await connection.execute(
			`INSERT INTO payment_entries (
        id, company_name, city, receipt_no, receipt_date, amount,
        payment_date, transaction_id, bank_name, remark, invoice_no,
        invoice_date, isDelete, payment_type, tds_amount, gst_amount,
        net_amount
      ) VALUES (?, ?, 'E2E City', ?, '2033-04-20', 4000, '2033-04-20',
                ?, 'E2E Bank', ?, ?, '2033-04-10', 0, 'partial', 0, 0, 4000)`,
			[
				paymentEntryId,
				customerName,
				receiptNumber,
				`TXN-${key}`,
				`[report-data ${fixtureNamespace}] receipt`,
				chosenNumber,
			]
		);
		owned.paymentEntryIds.push(paymentEntryId);

		return {
			namespace: fixtureNamespace,
			customerName,
			otherCustomerName,
			companyIds: { customer: customerId, other: otherCustomerId },
			invoices: {
				chosen: {
					id: chosenId,
					number: chosenNumber,
					gross: 10000,
					cgst: 900,
					sgst: 900,
					total: 11800,
					received: 4000,
					netReceivable: 7800,
					receiptNumber,
				},
				second: {
					id: secondId,
					number: secondNumber,
					gross: 5000,
					cgst: 450,
					sgst: 450,
					total: 5900,
					received: 0,
					netReceivable: 5900,
					receiptNumber: null,
				},
				other: {
					id: otherId,
					number: otherNumber,
					gross: 7000,
					cgst: 630,
					sgst: 630,
					total: 8260,
					received: 0,
					netReceivable: 8260,
					receiptNumber: null,
				},
			},
			receipt: {
				id: paymentEntryId,
				number: receiptNumber,
				amount: 4000,
				date: '2033-04-20',
			},
		};
	} catch (error) {
		await cleanupSalesOwned(connection, owned).catch(() => undefined);
		throw error;
	}
}

/** Delete only the rows this fixture owns. Safe after a partial seed. */
export async function cleanupSalesRegisterFixture(
	connection: Connection,
	fixture: SalesRegisterFixture
): Promise<void> {
	await cleanupSalesOwned(connection, {
		companyIds: [fixture.companyIds.customer, fixture.companyIds.other],
		invoiceIds: [
			fixture.invoices.chosen.id,
			fixture.invoices.second.id,
			fixture.invoices.other.id,
		],
		paymentEntryIds: [fixture.receipt.id],
	});
}

async function cleanupSalesOwned(
	connection: Connection,
	owned: SalesOwned
): Promise<void> {
	await connection.beginTransaction();
	try {
		await deleteByTextIds(
			connection,
			'payment_entries',
			'id',
			owned.paymentEntryIds
		);
		await deleteByIds(connection, 'invoices', 'id', owned.invoiceIds);
		await deleteByIds(connection, 'companies', 'id', owned.companyIds);
		await connection.commit();
	} catch (error) {
		try {
			await connection.rollback();
		} catch {
			// Preserve the original cleanup failure.
		}
		throw error;
	}
}

async function insertInvoice(
	connection: Connection,
	input: {
		number: string;
		clientName: string;
		gross: number;
		cgst: number;
		sgst: number;
		total: number;
		invoiceDate: string;
		dueDate: string;
		notes: string;
	}
): Promise<number> {
	return insertRow(
		connection,
		`INSERT INTO invoices (
        invoice_number, client_name, gross_amount, subtotal, tax_amount,
        gst_type, cgst_rate, sgst_rate, igst_rate, total, status,
        invoice_date, due_date, notes, items, line_items, isDelete
      ) VALUES (?, ?, ?, ?, ?, 'cgst_sgst', 9, 9, 18, ?, 'sent', ?, ?, ?,
                '[]', '[]', 0)`,
		[
			input.number,
			input.clientName,
			input.gross,
			input.gross,
			input.cgst + input.sgst,
			input.total,
			input.invoiceDate,
			input.dueDate,
			input.notes,
		]
	);
}

/* ── small DB helpers ──────────────────────────────────────────────── */

async function insertRow(
	connection: Connection,
	sql: string,
	params: ExecuteValues[]
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(sql, params);
	return Number(result.insertId);
}

async function deleteByIds(
	connection: Connection,
	table: string,
	column: string,
	ids: readonly number[]
): Promise<void> {
	const owned = ids.filter((id) => Number.isInteger(id) && id > 0);
	if (owned.length === 0) return;
	await connection.execute(
		`DELETE FROM ${table} WHERE ${column} IN (${owned.map(() => '?').join(', ')})`,
		owned
	);
}

async function deleteByTextIds(
	connection: Connection,
	table: string,
	column: string,
	ids: readonly string[]
): Promise<void> {
	const owned = ids.filter((id) => typeof id === 'string' && id !== '');
	if (owned.length === 0) return;
	await connection.execute(
		`DELETE FROM ${table} WHERE ${column} IN (${owned.map(() => '?').join(', ')})`,
		owned
	);
}
