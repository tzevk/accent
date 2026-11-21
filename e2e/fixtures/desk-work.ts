/**
 * Disposable fixtures for the dashboard TodoList and accounts-ledger journeys.
 *
 * Each fixture owns an ordinary active identity and every row it inserts,
 * tracked by primary key. Nothing here bypasses authentication: the journeys
 * sign in through the real form with the generated password.
 *
 * The accounts identity reuses the hook-owned `admin` role only for the
 * `/admin/*` shell, which the server layout admits by role code. The ledger
 * list route requires `proposals:read` and the receipt download route requires
 * `accounts:read`; those two grants are added directly to this user, so the
 * actor can reach the workspace without inheriting a broad admin role.
 */
import { createHash } from 'node:crypto';
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUserOptions } from './journey-user.ts';

/** The only API grants the accounts journey requests. */
export const ACCOUNTS_LEDGER_PERMISSIONS = [
	'accounts:read',
	'proposals:read',
] as const;

export type DeskTaskPriority = 'low' | 'medium' | 'high';

export interface DeskWorker {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it outside the test. */
	password: string;
	/** Delete this worker's tasks, sessions, user and role. */
	dispose(): Promise<void>;
}

export interface PersistedDeskTask {
	id: number;
	userId: number;
	title: string;
	description: string | null;
	priority: string;
	status: string;
	dueDate: string | null;
	completedAt: string | null;
}

export interface DeskTaskFixture {
	id: number;
	title: string;
}

export interface DeskReceiptAttachment {
	name: string;
	url: string;
}

export interface DeskLedgerTransaction {
	id: number;
	transactionId: string;
	description: string;
	category: string;
	type: 'income' | 'expense';
	amount: string;
	reference: string;
	transactionDate: string;
	status: string;
	attachments: DeskReceiptAttachment[];
}

export interface DeskWorkLedgerFixture {
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it outside the test. */
	password: string;
	income: DeskLedgerTransaction;
	expense: DeskLedgerTransaction;
	/** Delete this fixture's ledger rows, sessions, user and role. */
	dispose(): Promise<void>;
}

interface TodoRow extends RowDataPacket {
	id: number | string;
	user_id: number | string;
	title: string;
	description: unknown;
	priority: string | null;
	status: string | null;
	due_date: unknown;
	completed_at: unknown;
}

interface TransactionRow extends RowDataPacket {
	id: number | string;
	transaction_id: string;
	description: string | null;
	category: string | null;
	type: 'income' | 'expense' | null;
	amount: string | number | null;
	reference: string | null;
	transaction_date: unknown;
	status: string | null;
	attachments: unknown;
}

/**
 * Create the identity and return it only after every row exists. The caller
 * owns it and must `dispose()` in a `finally` block.
 */
export async function createDeskWorker(
	db: Connection,
	namespace: string,
	permissions: readonly string[],
	options: JourneyUserOptions = {}
): Promise<DeskWorker> {
	const identity = await createJourneyUser(db, namespace, permissions, options);
	let disposed = false;
	return {
		userId: identity.userId,
		username: identity.username,
		password: identity.password,
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			try {
				await deleteDeskTasksByOwner(db, identity.userId);
			} finally {
				await identity.dispose();
			}
		},
	};
}

/** Insert one pending task owned by `userId` and return its primary key. */
export async function seedDeskTask(
	db: Connection,
	userId: number,
	title: string,
	options: {
		priority?: DeskTaskPriority;
		description?: string | null;
		dueDate?: string | null;
	} = {}
): Promise<DeskTaskFixture> {
	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO todos (user_id, title, description, priority, status, due_date)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
		[
			userId,
			title,
			options.description ?? null,
			options.priority ?? 'medium',
			options.dueDate ?? null,
		]
	);
	const id = Number(result.insertId);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error('[desk-work] the seeded task was not inserted.');
	}
	return { id, title };
}

/**
 * Read every task this owner has under the exact title. A unique namespace
 * title makes the browser-created row findable without trusting a response.
 */
export async function findDeskTasksByOwnerAndTitle(
	db: Connection,
	userId: number,
	title: string
): Promise<PersistedDeskTask[]> {
	const [rows] = await db.execute<TodoRow[]>(
		`SELECT id, user_id, title, description, priority, status, due_date,
        completed_at
       FROM todos
      WHERE user_id = ?
        AND title = ?
      ORDER BY id ASC`,
		[userId, title]
	);
	return rows.map(mapTodoRow);
}

/** Read one task row by primary key, independent of the application. */
export async function readDeskTask(
	db: Connection,
	id: number
): Promise<PersistedDeskTask | null> {
	const [rows] = await db.execute<TodoRow[]>(
		`SELECT id, user_id, title, description, priority, status, due_date,
        completed_at
       FROM todos
      WHERE id = ?`,
		[id]
	);
	return rows[0] ? mapTodoRow(rows[0]) : null;
}

/**
 * Seed the accounts operator and two ledger rows: one income transaction with
 * a receipt attachment and one expense transaction. Both carry namespace
 * tokens so the journey can filter and identify its own rows. The caller owns
 * the fixture and must `dispose()` in a `finally` block.
 */
export async function seedDeskWorkLedger(
	db: Connection,
	namespace: string
): Promise<DeskWorkLedgerFixture> {
	const worker = await createDeskWorker(
		db,
		`${namespace}-ledger`,
		ACCOUNTS_LEDGER_PERMISSIONS,
		{ admin: true }
	);
	const drafts = buildLedgerDrafts(namespace);
	const insertedIds: number[] = [];

	try {
		const incomeId = await insertLedgerTransaction(
			db,
			worker.userId,
			drafts.income
		);
		insertedIds.push(incomeId);
		const expenseId = await insertLedgerTransaction(
			db,
			worker.userId,
			drafts.expense
		);
		insertedIds.push(expenseId);

		const income = await readLedgerTransaction(db, incomeId);
		const expense = await readLedgerTransaction(db, expenseId);
		if (!income || !expense) {
			throw new Error('[desk-work] the seeded ledger rows were not readable.');
		}

		let disposed = false;
		return {
			userId: worker.userId,
			username: worker.username,
			password: worker.password,
			income,
			expense,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await deleteLedgerTransactions(db, insertedIds);
				} finally {
					await worker.dispose();
				}
			},
		};
	} catch (error) {
		try {
			await deleteLedgerTransactions(db, insertedIds);
		} finally {
			await worker.dispose();
		}
		throw error;
	}
}

type LedgerDraft = Omit<DeskLedgerTransaction, 'id'>;

function buildLedgerDrafts(namespace: string): {
	income: LedgerDraft;
	expense: LedgerDraft;
} {
	const token = createHash('sha256')
		.update(namespace)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase();
	const attachment: DeskReceiptAttachment = {
		name: `receipt-${token}.pdf`,
		url: `/uploads/e2e/${token}.pdf`,
	};

	return {
		income: {
			transactionId: fitIdentifier(`E2E-DW-INC-${token}`, 50),
			description: `${namespace} ledger income`,
			category: 'E2E Desk Work',
			type: 'income',
			amount: '4321.87',
			reference: `DW-INC-${token}`,
			// Future dates keep the two fixture rows on the first page ahead of
			// any other data an owned group database might accumulate.
			transactionDate: '2035-12-31',
			status: 'completed',
			attachments: [attachment],
		},
		expense: {
			transactionId: fitIdentifier(`E2E-DW-EXP-${token}`, 50),
			description: `${namespace} ledger expense`,
			category: 'E2E Desk Work',
			type: 'expense',
			amount: '987.65',
			reference: `DW-EXP-${token}`,
			transactionDate: '2035-12-30',
			status: 'completed',
			attachments: [],
		},
	};
}

async function insertLedgerTransaction(
	db: Connection,
	userId: number,
	draft: LedgerDraft
): Promise<number> {
	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO account_transactions (
        transaction_id, description, category, type, amount, reference,
        transaction_date, attachments, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			draft.transactionId,
			draft.description,
			draft.category,
			draft.type,
			draft.amount,
			draft.reference,
			draft.transactionDate,
			JSON.stringify(draft.attachments),
			draft.status,
			userId,
		]
	);
	const id = Number(result.insertId);
	if (!Number.isInteger(id) || id <= 0) {
		throw new Error('[desk-work] the ledger transaction was not inserted.');
	}
	return id;
}

async function readLedgerTransaction(
	db: Connection,
	id: number
): Promise<DeskLedgerTransaction | null> {
	const [rows] = await db.execute<TransactionRow[]>(
		`SELECT id, transaction_id, description, category, type, amount,
        reference, transaction_date, status, attachments
       FROM account_transactions
      WHERE id = ?`,
		[id]
	);
	const row = rows[0];
	if (!row) return null;
	const type = row.type;
	if (type !== 'income' && type !== 'expense') {
		throw new Error(`[desk-work] unexpected ledger type ${String(type)}.`);
	}
	return {
		id: Number(row.id),
		transactionId: row.transaction_id,
		description: row.description ?? '',
		category: row.category ?? '',
		type,
		amount: decimalText(row.amount),
		reference: row.reference ?? '',
		transactionDate: textOrNull(row.transaction_date) ?? '',
		status: row.status ?? '',
		attachments: parseAttachments(row.attachments),
	};
}

function mapTodoRow(row: TodoRow): PersistedDeskTask {
	return {
		id: Number(row.id),
		userId: Number(row.user_id),
		title: row.title,
		description: textOrNull(row.description),
		priority: row.priority ?? '',
		status: row.status ?? '',
		dueDate: textOrNull(row.due_date),
		completedAt: textOrNull(row.completed_at),
	};
}

/**
 * The driver may hand back a JSON-shaped column already parsed or still as
 * text. Accept both, then assert the actual array shape instead of coercing
 * an object through `String(...)`.
 */
function parseAttachments(value: unknown): DeskReceiptAttachment[] {
	const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
	if (!Array.isArray(parsed)) return [];
	const attachments: DeskReceiptAttachment[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== 'object') continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.name === 'string' && typeof record.url === 'string') {
			attachments.push({ name: record.name, url: record.url });
		}
	}
	return attachments;
}

async function deleteDeskTasksByOwner(
	db: Connection,
	userId: number
): Promise<void> {
	await db.execute('DELETE FROM todos WHERE user_id = ?', [userId]);
}

async function deleteLedgerTransactions(
	db: Connection,
	ids: readonly number[]
): Promise<void> {
	if (ids.length === 0) return;
	const placeholders = ids.map(() => '?').join(', ');
	await db.execute(
		`DELETE FROM account_transactions WHERE id IN (${placeholders})`,
		[...ids]
	);
}

function textOrNull(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return String(value);
}

function decimalText(value: unknown): string {
	if (value === null || value === undefined) return '';
	return String(value);
}
