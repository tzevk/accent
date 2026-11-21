/**
 * Disposable Project workspace fixtures for the browser journeys.
 *
 * Every fixture owns its company, project, proposal and identities by real
 * primary key. Identity rows come from the shared `createJourneyUser` helper;
 * project rows carry ordinary `project_team` JSON exactly as the workspace
 * writes it. Cleanup removes the owned project rows, then the company, then
 * the identities, and is safe to call more than once.
 *
 * Project authority is never inferred from an account role: an editor or lead
 * is the stored team member with role `Project Lead`, and the creation and
 * proposal journeys use an explicit `projects:read` scope of `all` because
 * neither flow seeds team membership on the new project.
 */
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { fitIdentifier } from '../../scripts/e2e/contracts.ts';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

/** The exact grant the create form and company picker need. */
export const PROJECT_CREATE_PERMISSIONS = [
	'projects:create',
	'projects:read',
	'companies:read',
] as const;

/**
 * The proposal list's Convert control is gated on `proposals:convert`; the
 * conversion route itself enforces `proposals:approve`. The destination
 * project has no team yet, so the actor also needs an explicit read scope.
 */
export const PROPOSAL_CONVERSION_PERMISSIONS = [
	'proposals:read',
	'proposals:convert',
	'proposals:approve',
	'projects:read',
] as const;

/** Stored scope for the actions above; the role carries the action grant. */
const ALL_PROJECT_READ_SCOPE = {
	projectScopes: { projects: { read: 'all' } },
} as const;

const PROJECT_LEAD_ROLE = 'Project Lead';

export interface ProjectTeamRecord extends Record<string, unknown> {
	id?: number | string;
	user_id?: number | string;
	name?: string;
	email?: string;
	role?: string;
}

export interface StoredProject {
	projectId: number;
	projectCode: string | null;
	name: string | null;
	clientName: string | null;
	companyId: number | null;
	description: string | null;
	proposalId: number | null;
	projectTeam: ProjectTeamRecord[];
	isDelete: number;
}

export interface ProjectCreationFixture {
	userId: number;
	username: string;
	password: string;
	companyId: number;
	companyName: string;
	projectName: string;
	dispose(): Promise<void>;
}

export interface ProjectEditorFixture {
	userId: number;
	username: string;
	password: string;
	companyId: number;
	companyName: string;
	projectId: number;
	projectName: string;
	projectCode: string;
	clientName: string;
	dispose(): Promise<void>;
}

export interface ProjectTeamFixture extends ProjectEditorFixture {
	memberUserId: number;
	memberUsername: string;
	memberPassword: string;
	dispose(): Promise<void>;
}

export interface ProposalProjectFixture {
	userId: number;
	username: string;
	password: string;
	companyId: number;
	companyName: string;
	proposalId: number;
	proposalTitle: string;
	clientName: string;
	dispose(): Promise<void>;
}

export interface StoredProposal {
	id: number;
	proposalTitle: string;
	clientName: string | null;
	companyId: number | null;
	status: string | null;
	projectId: number | null;
	convertedAt: string | null;
	isDelete: number;
}

export interface ProposalProjectState {
	proposal: StoredProposal | null;
	project: StoredProject | null;
}

interface ProjectRow extends RowDataPacket {
	project_id: number | string;
	project_code: string | null;
	name: string | null;
	client_name: string | null;
	company_id: number | string | null;
	description: string | null;
	proposal_id: number | string | null;
	project_team: unknown;
	isDelete: number | string | null;
}

interface ProposalRow extends RowDataPacket {
	id: number | string;
	proposal_title: string | null;
	client: string | null;
	client_name: string | null;
	company_id: number | string | null;
	status: string | null;
	project_id: number | string | null;
	converted_at: string | Date | null;
	isDelete: number | string | null;
}

interface ProjectIdRow extends RowDataPacket {
	project_id: number | string;
}

interface CompanyInsert {
	companyId: number;
	companyName: string;
}

async function insertCompany(
	db: Connection,
	namespace: string
): Promise<CompanyInsert> {
	const companyName = `${namespace} Client`;
	const companyCode = fitIdentifier(`${namespace}-CO`, 50);
	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO companies (company_id, company_name, email, isDelete)
     VALUES (?, ?, ?, 0)`,
		[companyCode, companyName, `${companyCode.toLowerCase()}@e2e.invalid`]
	);
	const companyId = Number(result.insertId);
	if (!Number.isInteger(companyId) || companyId <= 0) {
		throw new Error('[e2e] the company fixture was not inserted');
	}
	return { companyId, companyName };
}

async function insertProject(
	db: Connection,
	options: {
		projectName: string;
		projectCode: string;
		clientName: string;
		companyId: number;
		team: ProjectTeamRecord[];
	}
): Promise<number> {
	const [result] = await db.execute<ResultSetHeader>(
		`INSERT INTO projects (
        project_code, project_title, name, client_name, company_id,
        status, priority, type, progress, project_team, isDelete,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'NEW', 'MEDIUM', 'ONGOING', 0, ?, 0, NOW(), NOW())`,
		[
			options.projectCode,
			options.projectName,
			options.projectName,
			options.clientName,
			options.companyId,
			JSON.stringify(options.team),
		]
	);
	const projectId = Number(result.insertId);
	if (!Number.isInteger(projectId) || projectId <= 0) {
		throw new Error('[e2e] the project fixture was not inserted');
	}
	return projectId;
}

async function grantAllProjectReadScope(
	db: Connection,
	userId: number
): Promise<void> {
	await db.execute('UPDATE users SET field_permissions = ? WHERE id = ?', [
		JSON.stringify(ALL_PROJECT_READ_SCOPE),
		userId,
	]);
}

/** Mirror the email `createJourneyUser` derives from its namespace. */
function journeyEmail(namespace: string): string {
	return `${fitIdentifier(namespace.trim(), 80).toLowerCase()}@e2e.invalid`;
}

function parseProjectTeam(value: unknown): ProjectTeamRecord[] {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.filter(
		(record): record is ProjectTeamRecord =>
			Boolean(record) && typeof record === 'object' && !Array.isArray(record)
	);
}

function projectFromRow(row: ProjectRow | undefined): StoredProject | null {
	if (!row) return null;
	return {
		projectId: Number(row.project_id),
		projectCode: row.project_code === null ? null : String(row.project_code),
		name: row.name === null ? null : String(row.name),
		clientName: row.client_name === null ? null : String(row.client_name),
		companyId: nullableNumber(row.company_id),
		description: row.description === null ? null : String(row.description),
		proposalId: nullableNumber(row.proposal_id),
		projectTeam: parseProjectTeam(row.project_team),
		isDelete: Number(row.isDelete ?? 0),
	};
}

/** Read one owned project through the independent mysql2 connection. */
export async function readProjectById(
	db: Connection,
	projectId: number
): Promise<StoredProject | null> {
	const [rows] = await db.execute<ProjectRow[]>(
		`SELECT project_id, project_code, name, client_name, company_id,
        description, proposal_id, project_team, isDelete
       FROM projects
      WHERE project_id = ?
      LIMIT 1`,
		[projectId]
	);
	return projectFromRow(rows[0]);
}

/** Read the project the create form authored, keyed by its unique name. */
export async function readProjectByName(
	db: Connection,
	projectName: string
): Promise<StoredProject | null> {
	const [rows] = await db.execute<ProjectRow[]>(
		`SELECT project_id, project_code, name, client_name, company_id,
        description, proposal_id, project_team, isDelete
       FROM projects
      WHERE name = ?
      ORDER BY project_id DESC
      LIMIT 1`,
		[projectName]
	);
	return projectFromRow(rows[0]);
}

/**
 * Read the proposal and the project that records it as its origin. The join is
 * by stored primary keys, not by the values the browser supplied.
 */
export async function readProposalProjectState(
	db: Connection,
	proposalId: number
): Promise<ProposalProjectState> {
	const [proposalRows] = await db.execute<ProposalRow[]>(
		`SELECT id, proposal_title, client, client_name, company_id, status,
        project_id, converted_at, isDelete
       FROM proposals
      WHERE id = ?
      LIMIT 1`,
		[proposalId]
	);
	const [projectRows] = await db.execute<ProjectRow[]>(
		`SELECT project_id, project_code, name, client_name, company_id,
        description, proposal_id, project_team, isDelete
       FROM projects
      WHERE proposal_id = ?
      ORDER BY project_id DESC
      LIMIT 1`,
		[proposalId]
	);

	const row = proposalRows[0];
	return {
		proposal: row
			? {
					id: Number(row.id),
					proposalTitle: String(row.proposal_title ?? ''),
					clientName: row.client_name ?? row.client ?? null,
					companyId: nullableNumber(row.company_id),
					status: row.status,
					projectId: nullableNumber(row.project_id),
					convertedAt: dateTimeText(row.converted_at),
					isDelete: Number(row.isDelete ?? 0),
				}
			: null,
		project: projectFromRow(projectRows[0]),
	};
}

/**
 * Seed a company and the ordinary identity that creates a new Project. No
 * project exists yet; the browser action owns that row.
 */
export async function seedProjectCreationFixture(
	db: Connection,
	namespace: string
): Promise<ProjectCreationFixture> {
	const user = await createJourneyUser(
		db,
		`${namespace}-project-creator`,
		PROJECT_CREATE_PERMISSIONS
	);
	let companyId: number | null = null;
	const projectName = `${namespace} Created Project`;

	try {
		await grantAllProjectReadScope(db, user.userId);
		const company = await insertCompany(db, `${namespace}-create`);
		companyId = company.companyId;

		let disposed = false;
		return {
			userId: user.userId,
			username: user.username,
			password: user.password,
			companyId: company.companyId,
			companyName: company.companyName,
			projectName,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await deleteProjectsByName(db, projectName);
				} finally {
					try {
						await deleteCompany(db, company.companyId);
					} finally {
						await user.dispose();
					}
				}
			},
		};
	} catch (error) {
		if (companyId !== null) {
			try {
				await deleteCompany(db, companyId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		await user.dispose();
		throw error;
	}
}

/**
 * Seed a company, a project whose stored team names the actor as Project Lead,
 * and that ordinary identity. No explicit project permission is granted, so
 * the journey proves lead-derived workspace access.
 */
export async function seedProjectEditorFixture(
	db: Connection,
	namespace: string
): Promise<ProjectEditorFixture> {
	const editorNamespace = `${namespace}-project-editor`;
	const user = await createJourneyUser(db, editorNamespace, []);
	let companyId: number | null = null;
	let projectId: number | null = null;
	const projectName = `${namespace} Seeded Project`;
	const projectCode = fitIdentifier(`${namespace}-PROJ`, 100);

	try {
		const company = await insertCompany(db, `${namespace}-edit`);
		companyId = company.companyId;
		projectId = await insertProject(db, {
			projectName,
			projectCode,
			clientName: company.companyName,
			companyId: company.companyId,
			team: [
				{
					id: user.userId,
					user_id: user.userId,
					employee_id: user.userId,
					employee_pk: null,
					employee_code: null,
					account_type: 'employee',
					vendor_id: null,
					name: user.username,
					email: journeyEmail(editorNamespace),
					department: '',
					position: '',
					role: PROJECT_LEAD_ROLE,
				},
			],
		});

		const ownedProjectId = projectId;
		const ownedCompanyId = company.companyId;
		let disposed = false;
		return {
			userId: user.userId,
			username: user.username,
			password: user.password,
			companyId: company.companyId,
			companyName: company.companyName,
			projectId: projectId,
			projectName,
			projectCode,
			clientName: company.companyName,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await deleteProjectRows(db, ownedProjectId);
				} finally {
					try {
						await deleteCompany(db, ownedCompanyId);
					} finally {
						await user.dispose();
					}
				}
			},
		};
	} catch (error) {
		if (projectId !== null) {
			try {
				await deleteProjectRows(db, projectId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		if (companyId !== null) {
			try {
				await deleteCompany(db, companyId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		await user.dispose();
		throw error;
	}
}

/**
 * Seed the same lead-owned project plus a second ordinary identity who is not
 * yet on the team. The lead adds that identity through the workspace.
 */
export async function seedProjectTeamFixture(
	db: Connection,
	namespace: string
): Promise<ProjectTeamFixture> {
	const leadNamespace = `${namespace}-project-lead`;
	const lead = await createJourneyUser(db, leadNamespace, []);
	let member: JourneyUser | null = null;
	let companyId: number | null = null;
	let projectId: number | null = null;
	const projectName = `${namespace} Team Project`;
	const projectCode = fitIdentifier(`${namespace}-TEAM`, 100);

	try {
		const company = await insertCompany(db, `${namespace}-team`);
		companyId = company.companyId;
		member = await createJourneyUser(db, `${namespace}-project-member`, []);
		projectId = await insertProject(db, {
			projectName,
			projectCode,
			clientName: company.companyName,
			companyId: company.companyId,
			team: [
				{
					id: lead.userId,
					user_id: lead.userId,
					employee_id: lead.userId,
					employee_pk: null,
					employee_code: null,
					account_type: 'employee',
					vendor_id: null,
					name: lead.username,
					email: journeyEmail(leadNamespace),
					department: '',
					position: '',
					role: PROJECT_LEAD_ROLE,
				},
			],
		});

		const ownedMember = member;
		const ownedProjectId = projectId;
		const ownedCompanyId = company.companyId;
		let disposed = false;
		return {
			userId: lead.userId,
			username: lead.username,
			password: lead.password,
			companyId: company.companyId,
			companyName: company.companyName,
			projectId: projectId,
			projectName,
			projectCode,
			clientName: company.companyName,
			memberUserId: ownedMember.userId,
			memberUsername: ownedMember.username,
			memberPassword: ownedMember.password,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await deleteProjectRows(db, ownedProjectId);
				} finally {
					try {
						await deleteCompany(db, ownedCompanyId);
					} finally {
						try {
							await ownedMember.dispose();
						} finally {
							await lead.dispose();
						}
					}
				}
			},
		};
	} catch (error) {
		if (projectId !== null) {
			try {
				await deleteProjectRows(db, projectId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		if (companyId !== null) {
			try {
				await deleteCompany(db, companyId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		if (member !== null) await member.dispose();
		await lead.dispose();
		throw error;
	}
}

/**
 * Seed a company, an unconverted proposal owned by no lead, and the identity
 * the proposal list uses to convert it. The proposal has no child documents.
 */
export async function seedProposalProjectFixture(
	db: Connection,
	namespace: string
): Promise<ProposalProjectFixture> {
	const user = await createJourneyUser(
		db,
		`${namespace}-proposal-converter`,
		PROPOSAL_CONVERSION_PERMISSIONS
	);
	let companyId: number | null = null;
	let proposalId: number | null = null;
	const proposalTitle = `${namespace} Convertible Proposal`;
	const proposalCode = fitIdentifier(`${namespace}-PROP`, 50);

	try {
		await grantAllProjectReadScope(db, user.userId);
		const company = await insertCompany(db, `${namespace}-proposal`);
		companyId = company.companyId;

		const [result] = await db.execute<ResultSetHeader>(
			`INSERT INTO proposals (
          proposal_id, proposal_title, client, client_name, company_id,
          status, priority, progress, budget, proposal_value, value, isDelete,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'DRAFT', 'MEDIUM', 0, 125000.00, 125000.00,
                  125000.00, 0, NOW(), NOW())`,
			[
				proposalCode,
				proposalTitle,
				company.companyName,
				company.companyName,
				company.companyId,
			]
		);
		const insertedProposalId = Number(result.insertId);
		if (!Number.isInteger(insertedProposalId) || insertedProposalId <= 0) {
			throw new Error('[e2e] the proposal fixture was not inserted');
		}
		proposalId = insertedProposalId;

		const ownedProposalId = insertedProposalId;
		const ownedCompanyId = company.companyId;
		let disposed = false;
		return {
			userId: user.userId,
			username: user.username,
			password: user.password,
			companyId: company.companyId,
			companyName: company.companyName,
			proposalId: insertedProposalId,
			proposalTitle,
			clientName: company.companyName,
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;
				try {
					await deleteProjectsByProposal(db, ownedProposalId);
				} finally {
					try {
						await deleteProposalRows(db, ownedProposalId);
					} finally {
						try {
							await deleteCompany(db, ownedCompanyId);
						} finally {
							await user.dispose();
						}
					}
				}
			},
		};
	} catch (error) {
		if (proposalId !== null) {
			try {
				await deleteProjectsByProposal(db, proposalId);
				await deleteProposalRows(db, proposalId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		if (companyId !== null) {
			try {
				await deleteCompany(db, companyId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		await user.dispose();
		throw error;
	}
}

async function deleteProjectsByName(
	db: Connection,
	projectName: string
): Promise<void> {
	const [rows] = await db.execute<ProjectIdRow[]>(
		'SELECT project_id FROM projects WHERE name = ?',
		[projectName]
	);
	for (const row of rows) {
		await deleteProjectRows(db, Number(row.project_id));
	}
}

async function deleteProjectsByProposal(
	db: Connection,
	proposalId: number
): Promise<void> {
	const [rows] = await db.execute<ProjectIdRow[]>(
		'SELECT project_id FROM projects WHERE proposal_id = ?',
		[proposalId]
	);
	for (const row of rows) {
		await deleteProjectRows(db, Number(row.project_id));
	}
}

async function deleteProjectRows(
	db: Connection,
	projectId: number
): Promise<void> {
	await db.execute('DELETE FROM project_activities WHERE project_id = ?', [
		projectId,
	]);
	await db.execute(
		'DELETE FROM user_activity_assignments WHERE project_id = ?',
		[projectId]
	);
	await db.execute('DELETE FROM projects WHERE project_id = ?', [projectId]);
}

async function deleteProposalRows(
	db: Connection,
	proposalId: number
): Promise<void> {
	await db.execute('DELETE FROM proposal_annexures WHERE proposal_id = ?', [
		proposalId,
	]);
	await db.execute('DELETE FROM proposal_followups WHERE proposal_id = ?', [
		proposalId,
	]);
	await db.execute('DELETE FROM proposal_versions WHERE proposal_id = ?', [
		proposalId,
	]);
	await db.execute('DELETE FROM approvals WHERE proposal_id = ?', [proposalId]);
	await db.execute('DELETE FROM proposals WHERE id = ?', [proposalId]);
}

async function deleteCompany(db: Connection, companyId: number): Promise<void> {
	await db.execute('DELETE FROM companies WHERE id = ?', [companyId]);
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : null;
}

function dateTimeText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return value.toISOString();
	const text = String(value).trim();
	return text === '' ? null : text;
}
