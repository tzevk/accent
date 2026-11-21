/**
 * Disposable fixture for the approved Project cost budget journey (#321).
 *
 * The browser test owns the workflow: an authorized budget operator records,
 * submits, and approves a Project cost budget, then reads the comparison back
 * from a freshly loaded report. This fixture only supplies the starting state
 * and an independent reader for the saved result:
 *
 * - one namespaced Project with no commercial fields read as a budget;
 * - one recognized operating Project cost in the fixture month, so the report
 *   has confirmed Incurred Project Cost to compare against;
 * - one ordinary operator whose custom role grants exactly the permissions the
 *   controls require: `other_expenses:read/update/approve` for the budget page
 *   and `reports:read` plus `payroll:read` for the expenditure report's gate.
 *
 * Every row is tracked by its real primary key. Cleanup removes the budget and
 * its append-only journal, the cost and its journal, the Project, and the
 * operator. A partially seeded fixture cleans up before rethrowing, so a failed
 * seed cannot leak a Project or identity into the next test.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type {
	Connection,
	ExecuteValues,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

/** Fixed past month: no browser navigation depends on "today". */
export const PROJECT_BUDGET_MONTH = '2019-08';
export const PROJECT_BUDGET_MONTH_START = '2019-08-01';
export const PROJECT_BUDGET_MONTH_END = '2019-08-31';

/** One recognized operating Project cost. */
export const RECOGNIZED_COST_AMOUNT = 25_000;
/** An approved budget above that cost; the report must state the remainder. */
export const BUDGET_AMOUNT = 40_000;

/**
 * The smallest grant set that renders the budget controls and the expenditure
 * report's financial gate. Roles carry no inherited hierarchy permissions.
 */
export const PROJECT_BUDGET_OPERATOR_PERMISSIONS = [
	'other_expenses:read',
	'other_expenses:update',
	'other_expenses:approve',
	'reports:read',
	'payroll:read',
] as const;

export interface ProjectBudgetProject {
	id: number;
	code: string;
}

export interface ProjectBudgetCost {
	id: number;
	expenseNumber: string;
}

export interface ProjectBudgetFixture {
	month: string;
	monthStart: string;
	monthEnd: string;
	project: ProjectBudgetProject;
	cost: ProjectBudgetCost;
	operator: JourneyUser;
	/** Evidence the operator will enter when approving the budget. */
	approvalEvidence: string;
	/** Basis note entered while recording the budget. */
	basisNote: string;
	expectedBudgetAmount: number;
	/** Delete every owned row. Safe to call more than once. */
	dispose(): Promise<void>;
}

interface BudgetUidRow extends RowDataPacket {
	budget_uid: string;
}

interface OwnedRows {
	projectId: number | null;
	expenseId: number | null;
}

/**
 * Seed the Project, its one recognized cost, and the ordinary budget operator.
 * The caller owns the returned fixture and must `dispose()` it in `finally`.
 */
export async function seedProjectBudgetFixture(
	connection: Connection,
	namespace: string
): Promise<ProjectBudgetFixture> {
	const fixtureNamespace = namespace.trim();
	if (!fixtureNamespace) {
		throw new Error('[project-budget] namespace must not be empty.');
	}

	const token = fitIdentifier(fixtureNamespace, 42);
	const runToken = randomBytes(3).toString('hex').toUpperCase();
	const projectCode = fitIdentifier(`E2E-PB-${token}-${runToken}`, 100);
	const projectName = `E2E Project budget ${fixtureNamespace}`;
	const expenseNumber = fitIdentifier(`E2E-PB-${token}-${runToken}-COST`, 50);
	const sourceReference = fitIdentifier(`E2E-PB-${token}-SRC`, 191);
	const costEvidenceReference = fitIdentifier(
		`E2E-PB-${token}-COST-EVIDENCE`,
		500
	);
	const approvalEvidence = fitIdentifier(
		`E2E-PB-${token}-SIGNED-APPROVAL`,
		500
	);
	const basisNote = `Approved ${PROJECT_BUDGET_MONTH} project cost plan`;
	const costUid = `cost-${randomUUID()}`;
	const amount = RECOGNIZED_COST_AMOUNT.toFixed(2);

	const operator = await createJourneyUser(
		connection,
		fitIdentifier(`${fixtureNamespace}-pb`, 50),
		PROJECT_BUDGET_OPERATOR_PERMISSIONS
	);

	const owned: OwnedRows = { projectId: null, expenseId: null };
	const dispose = async () => cleanupOwned(connection, owned, operator);

	try {
		const projectId = await insertRow(
			connection,
			`INSERT INTO projects (
          project_code, project_title, name, client_name, status, type, currency,
          start_date, end_date, isDelete
        ) VALUES (?, ?, ?, ?, 'ONGOING', 'ONGOING', 'INR', ?, ?, 0)`,
			[
				projectCode,
				projectName,
				projectName,
				`E2E Client ${runToken}`,
				PROJECT_BUDGET_MONTH_START,
				PROJECT_BUDGET_MONTH_END,
			]
		);
		owned.projectId = projectId;

		const expenseId = await insertRow(
			connection,
			`INSERT INTO expenses (
          expense_number, expense_date, category, sub_category, description,
          amount, tax_amount, total_amount, currency, payment_mode, paid_to, paid_by,
          project_id, status, created_by, isDelete,
          cost_uid, cost_classification, cost_nature, recognition_state,
          recognition_period, period_basis, service_period_start, service_period_end,
          tax_treatment, recognized_amount, source_reference, evidence_reference,
          financial_version, recognized_by, recognized_at, reporting_currency
        ) VALUES (?, ?, 'Project Cost', 'Recognized cost', ?, ?, 0.00, ?, 'INR',
                  'bank', ?, ?, ?, 'approved', ?, 0,
                  ?, 'project', 'operating', 'recognized',
                  ?, 'service_period', ?, ?,
                  'none', ?, ?, ?, 1, ?, ?, 'INR')`,
			[
				expenseNumber,
				`${PROJECT_BUDGET_MONTH}-10`,
				`One recognized cost for ${projectCode}`,
				amount,
				amount,
				operator.userId,
				operator.userId,
				projectId,
				operator.userId,
				costUid,
				PROJECT_BUDGET_MONTH_START,
				PROJECT_BUDGET_MONTH_START,
				PROJECT_BUDGET_MONTH_END,
				amount,
				sourceReference,
				costEvidenceReference,
				operator.userId,
				`${PROJECT_BUDGET_MONTH_START} 12:00:00`,
			]
		);
		owned.expenseId = expenseId;

		let disposed = false;
		return {
			month: PROJECT_BUDGET_MONTH,
			monthStart: PROJECT_BUDGET_MONTH_START,
			monthEnd: PROJECT_BUDGET_MONTH_END,
			project: {
				id: projectId,
				code: projectCode,
			},
			cost: {
				id: expenseId,
				expenseNumber,
			},
			operator,
			approvalEvidence,
			basisNote,
			expectedBudgetAmount: BUDGET_AMOUNT,
			async dispose(): Promise<void> {
				if (disposed) return;
				await dispose();
				disposed = true;
			},
		};
	} catch (error) {
		try {
			await dispose();
		} catch (cleanupError) {
			const original = error instanceof Error ? error.message : String(error);
			const cleanup =
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError);
			throw new Error(
				`${original}; project-budget fixture cleanup also failed: ${cleanup}`
			);
		}
		throw error;
	}
}

/**
 * Read the fixture Project's budgets independently of the route under test.
 * The caller asserts the real saved values against fixed expectations.
 */
export async function readProjectBudgets(
	connection: Connection,
	projectId: number
): Promise<
	Array<{
		id: number;
		budgetUid: string;
		currency: string;
		amount: string;
		scope: string;
		periodStart: string;
		periodEnd: string;
		basisNote: string | null;
		state: string;
		approvalEvidenceReference: string | null;
		approvedBy: number | null;
		approvedAt: string | null;
		financialVersion: number;
		createdBy: number | null;
		isDelete: number;
	}>
> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT id, budget_uid, currency, amount, scope, period_start, period_end,
            basis_note, state, approval_evidence_reference, approved_by, approved_at,
            financial_version, created_by, isDelete
       FROM project_cost_budgets
      WHERE project_id = ?
      ORDER BY id ASC`,
		[projectId]
	);
	return rows.map((row) => ({
		id: Number(row.id),
		budgetUid: String(row.budget_uid),
		currency: String(row.currency),
		amount: String(row.amount),
		scope: String(row.scope),
		periodStart: String(row.period_start),
		periodEnd: String(row.period_end),
		basisNote: row.basis_note === null ? null : String(row.basis_note),
		state: String(row.state),
		approvalEvidenceReference:
			row.approval_evidence_reference === null
				? null
				: String(row.approval_evidence_reference),
		approvedBy: row.approved_by === null ? null : Number(row.approved_by),
		approvedAt: row.approved_at === null ? null : String(row.approved_at),
		financialVersion: Number(row.financial_version),
		createdBy: row.created_by === null ? null : Number(row.created_by),
		isDelete: Number(row.isDelete),
	}));
}

/** The append-only budget journal, oldest first. */
export async function readProjectBudgetJournal(
	connection: Connection,
	budgetUid: string
): Promise<
	Array<{
		version: number;
		command: string;
		actorUserId: number | null;
		reason: string | null;
		evidenceReference: string | null;
		createdAt: string;
	}>
> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT version, command, actor_user_id, reason, evidence_reference, created_at
       FROM project_cost_budget_events
      WHERE budget_uid = ?
      ORDER BY version ASC`,
		[budgetUid]
	);
	return rows.map((row) => ({
		version: Number(row.version),
		command: String(row.command),
		actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
		reason: row.reason === null ? null : String(row.reason),
		evidenceReference:
			row.evidence_reference === null ? null : String(row.evidence_reference),
		createdAt: String(row.created_at),
	}));
}

/** The fixture's recognized cost row, read independently of the report. */
export async function readRecognizedProjectCost(
	connection: Connection,
	expenseId: number
): Promise<{
	expenseNumber: string;
	projectId: number | null;
	projectCode: string | null;
	classification: string | null;
	nature: string;
	state: string;
	currency: string | null;
	recognitionPeriod: string | null;
	recognizedAmount: string | null;
	totalAmount: string | null;
	financialVersion: number;
	isDelete: number;
}> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		`SELECT e.expense_number, e.project_id, p.project_code,
            e.cost_classification, e.cost_nature, e.recognition_state, e.currency,
            e.recognition_period, e.recognized_amount, e.total_amount,
            e.financial_version, e.isDelete
       FROM expenses e
       LEFT JOIN projects p ON p.project_id = e.project_id
      WHERE e.id = ?
      LIMIT 1`,
		[expenseId]
	);
	const row = rows[0];
	if (!row) throw new Error(`[project-budget] cost ${expenseId} disappeared.`);
	return {
		expenseNumber: String(row.expense_number),
		projectId: row.project_id === null ? null : Number(row.project_id),
		projectCode: row.project_code === null ? null : String(row.project_code),
		classification:
			row.cost_classification === null ? null : String(row.cost_classification),
		nature: String(row.cost_nature),
		state: String(row.recognition_state),
		currency: row.currency === null ? null : String(row.currency),
		recognitionPeriod:
			row.recognition_period === null ? null : String(row.recognition_period),
		recognizedAmount:
			row.recognized_amount === null ? null : String(row.recognized_amount),
		totalAmount: row.total_amount === null ? null : String(row.total_amount),
		financialVersion: Number(row.financial_version),
		isDelete: Number(row.isDelete),
	};
}

async function cleanupOwned(
	connection: Connection,
	owned: OwnedRows,
	operator: JourneyUser
): Promise<void> {
	try {
		if (owned.projectId !== null) {
			const [budgets] = await connection.execute<BudgetUidRow[]>(
				`SELECT budget_uid
           FROM project_cost_budgets
          WHERE project_id = ?`,
				[owned.projectId]
			);
			for (const budget of budgets) {
				await connection.execute(
					'DELETE FROM project_cost_budget_events WHERE budget_uid = ?',
					[String(budget.budget_uid)]
				);
			}
			await connection.execute(
				'DELETE FROM project_cost_budgets WHERE project_id = ?',
				[owned.projectId]
			);
		}
		if (owned.expenseId !== null) {
			await connection.execute(
				`DELETE FROM financial_cost_events
          WHERE source_table = 'expenses' AND source_id = ?`,
				[owned.expenseId]
			);
			await connection.execute('DELETE FROM expenses WHERE id = ?', [
				owned.expenseId,
			]);
		}
		if (owned.projectId !== null) {
			await connection.execute('DELETE FROM projects WHERE project_id = ?', [
				owned.projectId,
			]);
		}
	} finally {
		await operator.dispose();
	}
}

async function insertRow(
	connection: Connection,
	sql: string,
	params: ExecuteValues[]
): Promise<number> {
	const [result] = await connection.execute<ResultSetHeader>(sql, params);
	return Number(result.insertId);
}
