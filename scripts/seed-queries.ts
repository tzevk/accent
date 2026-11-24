import { SQL, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';

export type SeedDatabase = Pick<
	MySql2Database<Record<string, never>>,
	'execute'
>;

type SeedTable =
	| 'roles_master'
	| 'users'
	| 'employees'
	| 'companies'
	| 'deliverable_categories'
	| 'projects'
	| 'leads'
	| 'proposals';

export type SeedValue =
	| string
	| number
	| boolean
	| null
	| Date
	| SQL
	| Readonly<Record<string, unknown>>
	| readonly unknown[];
export type SeedRow = Readonly<Record<string, SeedValue | undefined>>;

export interface SeedCompany {
	id: number;
	company_name: string;
	city: string | null;
	email: string | null;
	phone: string | null;
}

export interface SeedUserReference {
	id: number;
	employee_id: number | null;
}

async function readRows<T>(db: SeedDatabase, statement: SQL): Promise<T[]> {
	const [rows] = (await db.execute(statement)) as unknown as [T[], unknown];
	return rows;
}

async function readCount(db: SeedDatabase, statement: SQL): Promise<number> {
	const [row] = await readRows<{ cnt: number | string | bigint }>(
		db,
		statement
	);
	return Number(row?.cnt ?? 0);
}

export function countSeedUsers(db: SeedDatabase): Promise<number> {
	return readCount(db, sql`SELECT COUNT(*) AS cnt FROM users`);
}

export function countSeedRoles(db: SeedDatabase): Promise<number> {
	return readCount(db, sql`SELECT COUNT(*) AS cnt FROM roles_master`);
}

export function countSeedCompanies(db: SeedDatabase): Promise<number> {
	return readCount(db, sql`SELECT COUNT(*) AS cnt FROM companies`);
}

export function countSeedDeliverableCategories(
	db: SeedDatabase
): Promise<number> {
	return readCount(
		db,
		sql`SELECT COUNT(*) AS cnt FROM deliverable_categories WHERE isDelete = 0`
	);
}

export function countSeedProjects(db: SeedDatabase): Promise<number> {
	return readCount(
		db,
		sql`SELECT COUNT(*) AS cnt FROM projects WHERE isDelete = 0`
	);
}

export function countSeedLeads(db: SeedDatabase): Promise<number> {
	return readCount(
		db,
		sql`SELECT COUNT(*) AS cnt FROM leads WHERE isDelete = 0`
	);
}

export function countSeedProposals(db: SeedDatabase): Promise<number> {
	return readCount(
		db,
		sql`SELECT COUNT(*) AS cnt FROM proposals WHERE isDelete = 0`
	);
}

export async function findSeedEmployeeId(
	db: SeedDatabase,
	employeeId: string
): Promise<number | null> {
	const [row] = await readRows<{ id: number }>(
		db,
		sql`SELECT id FROM employees WHERE employee_id = ${employeeId} LIMIT 1`
	);
	return row?.id ?? null;
}

export async function findSeedRoleId(
	db: SeedDatabase,
	roleCode: string
): Promise<number | null> {
	const [row] = await readRows<{ id: number }>(
		db,
		sql`SELECT id FROM roles_master WHERE role_code = ${roleCode} LIMIT 1`
	);
	return row?.id ?? null;
}

export async function findSeedAdminUser(
	db: SeedDatabase
): Promise<SeedUserReference | null> {
	const [row] = await readRows<SeedUserReference>(
		db,
		sql`SELECT id, employee_id FROM users WHERE is_super_admin = 1 LIMIT 1`
	);
	return row ?? null;
}

export async function findSeedRegularUser(
	db: SeedDatabase
): Promise<SeedUserReference | null> {
	const [row] = await readRows<SeedUserReference>(
		db,
		sql`SELECT id, employee_id FROM users WHERE is_super_admin = 0 LIMIT 1`
	);
	return row ?? null;
}

export function listSeedCompanyIds(
	db: SeedDatabase
): Promise<{ id: number }[]> {
	return readRows(db, sql`SELECT id FROM companies WHERE isDelete = 0`);
}

export function listSeedLeadCompanies(
	db: SeedDatabase
): Promise<SeedCompany[]> {
	return readRows(
		db,
		sql`SELECT id, company_name, city, email, phone
		    FROM companies
		    WHERE isDelete = 0`
	);
}

export function listSeedProposalCompanies(
	db: SeedDatabase
): Promise<{ id: number; company_name: string }[]> {
	return readRows(
		db,
		sql`SELECT id, company_name FROM companies WHERE isDelete = 0`
	);
}

export function listSeedProposalLeads(
	db: SeedDatabase
): Promise<{ id: number; company_name: string }[]> {
	return readRows(
		db,
		sql`SELECT id, company_name FROM leads WHERE isDelete = 0 LIMIT 10`
	);
}

export async function findSeedProposalId(
	db: SeedDatabase,
	proposalId: string
): Promise<number | null> {
	const [row] = await readRows<{ id: number }>(
		db,
		sql`SELECT id FROM proposals WHERE proposal_id = ${proposalId} LIMIT 1`
	);
	return row?.id ?? null;
}

function insertValue(value: SeedValue | undefined, column: string): SQL {
	if (value === undefined) {
		return sql`DEFAULT`;
	}
	if (
		value instanceof SQL ||
		value instanceof Date ||
		value === null ||
		typeof value !== 'object'
	) {
		return sql`${value}`;
	}
	const json = JSON.stringify(value);
	if (json === undefined) {
		throw new Error(
			`Seed insert value for column ${column} is not JSON serializable.`
		);
	}
	return sql`${json}`;
}

/**
 * Insert one fixture row or a batch with the same column set in every row.
 * This is the only write primitive the development seeds need; all reads remain
 * explicit SQL above. Identifiers are escaped by Drizzle and data values are bound.
 */
export async function insertSeedRows(
	db: SeedDatabase,
	table: SeedTable,
	rows: SeedRow | readonly SeedRow[]
): Promise<number> {
	const batch: readonly SeedRow[] = Array.isArray(rows)
		? rows
		: [rows as SeedRow];
	const first = batch[0];
	if (!first) {
		throw new Error(`Seed insert for ${table} received no rows.`);
	}
	const columns = Object.keys(first);
	if (columns.length === 0) {
		throw new Error(`Seed insert for ${table} received no columns.`);
	}
	for (const row of batch) {
		const rowColumns = Object.keys(row);
		if (
			rowColumns.length !== columns.length ||
			rowColumns.some((column) => !columns.includes(column))
		) {
			throw new Error(`Seed insert for ${table} has inconsistent columns.`);
		}
	}

	const columnSql = sql.join(
		columns.map((column) => sql.identifier(column)),
		sql`, `
	);
	const valuesSql = sql.join(
		batch.map(
			(row) =>
				sql`(${sql.join(
					columns.map((column) => insertValue(row[column], column)),
					sql`, `
				)})`
		),
		sql`, `
	);
	const [result] = (await db.execute(
		sql`INSERT INTO ${sql.identifier(table)} (${columnSql}) VALUES ${valuesSql}`
	)) as unknown as [{ insertId: number }, unknown];
	return result.insertId;
}
