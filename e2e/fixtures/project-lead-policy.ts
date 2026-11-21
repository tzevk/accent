/**
 * Disposable Project Lead policy fixture for the browser journey.
 *
 * The application stores one global policy row (`project_lead_policy.id = 1`)
 * that applies to every project. This spec therefore owns no policy row: it
 * snapshots the original row before the browser changes one section and must
 * restore that exact row afterwards. It also has to run in a dedicated
 * full-suite group, with no other spec sharing its owned database or app
 * server, because a policy write is immediately visible to every project in
 * the same database.
 *
 * The fixture creates:
 *
 * - a namespaced, non-super-admin actor whose role grants exactly
 *   `projects:update`, with `field_permissions.projectScopes.projects.update`
 *   set to `all`. That stored scope is what allows the actor to read and save
 *   the shared policy; a `led` or `assigned` grant is rejected by the route.
 * - a separate namespaced Project Lead with no permission grants at all. The
 *   lead reaches the project only through membership of the fixture project's
 *   `project_team` JSON, exactly as an ordinary lead does.
 * - one namespaced project whose stored team names that lead. Its default
 *   section policy is read before the browser opens, and that stored row is
 *   restored by ownership (`updated_by`) during cleanup.
 *
 * Every owned user and the project are tracked by their real primary keys.
 * A partially created fixture cleans after itself before rethrowing.
 */
import type {
	Connection,
	RowDataPacket,
	ResultSetHeader,
} from 'mysql2/promise';
import { createJourneyUser, type JourneyUser } from './journey-user.ts';

/** The one section this journey changes for every Project Lead. */
export const POLICY_SECTION_ID = 'project_schedule' as const;
export const POLICY_SECTION_LABEL = 'Schedule';
export const HIDDEN_POLICY_SETTING = 'hidden' as const;

/** Exactly the grant the policy page and route require. */
export const PROJECT_POLICY_ACTOR_PERMISSIONS = ['projects:update'] as const;

/** Valid saved field permissions; no `modules` tree is needed. */
export const PROJECT_POLICY_FIELD_PERMISSIONS = {
	projectScopes: {
		projects: {
			update: 'all',
		},
	},
} as const;

export type LeadPolicySetting = 'hidden' | 'view' | 'edit';
export type StoredLeadPolicySections = Record<string, LeadPolicySetting>;

export interface StoredProjectLeadPolicy {
	sections: StoredLeadPolicySections;
	updatedAt: string | null;
	updatedBy: number | null;
}

export interface ProjectLeadPolicyFixture {
	actor: JourneyUser;
	lead: JourneyUser;
	projectId: number;
	projectTitle: string;
	sectionId: typeof POLICY_SECTION_ID;
	sectionLabel: typeof POLICY_SECTION_LABEL;
	/** The exact row that existed before the browser opened the policy page. */
	originalPolicy: StoredProjectLeadPolicy;
	/** Independent read of the single shared row; null when it is absent. */
	readPolicy(): Promise<StoredProjectLeadPolicy | null>;
	/**
	 * Put the original row back only when this fixture's actor owns the latest
	 * write. Safe to call more than once.
	 */
	restorePolicy(): Promise<void>;
	/** Restore the shared row, then delete only the fixture's own rows. */
	dispose(): Promise<void>;
}

interface PolicyRow extends RowDataPacket {
	sections: unknown;
	updated_at: unknown;
	updated_by: unknown;
}

interface ProjectRow extends RowDataPacket {
	project_id: number | string;
}

/**
 * Seed both identities and the project, then snapshot the shared policy.
 * The caller owns the result and must call `dispose()` in a `finally` block.
 */
export async function seedProjectLeadPolicyFixture(
	db: Connection,
	namespace: string
): Promise<ProjectLeadPolicyFixture> {
	const actor = await createJourneyUser(
		db,
		`${namespace}-policy-admin`,
		PROJECT_POLICY_ACTOR_PERMISSIONS
	);

	let lead: JourneyUser | null = null;
	let projectId: number | null = null;
	const projectTitle = `${namespace} Lead Policy Project`;

	try {
		// Stored project scopes are required by the shared-policy route. The
		// role carries the action grant; the user row carries its `all` scope.
		await db.execute('UPDATE users SET field_permissions = ? WHERE id = ?', [
			JSON.stringify(PROJECT_POLICY_FIELD_PERMISSIONS),
			actor.userId,
		]);

		lead = await createJourneyUser(db, `${namespace}-policy-lead`, []);

		const projectTeam = JSON.stringify([
			{
				user_id: lead.userId,
				role: 'Project Lead',
			},
		]);
		const [result] = await db.execute<ResultSetHeader>(
			`INSERT INTO projects (
        project_title, name, status, progress, project_team, isDelete,
        created_at, updated_at
      ) VALUES (?, ?, 'NEW', 0, ?, 0, NOW(), NOW())`,
			[projectTitle, projectTitle, projectTeam]
		);
		const insertedProjectId = Number(result.insertId);
		if (!Number.isInteger(insertedProjectId) || insertedProjectId <= 0) {
			throw new Error('[e2e] the Project Lead policy project was not inserted');
		}
		projectId = insertedProjectId;

		const originalPolicy = await readProjectLeadPolicy(db);
		if (!originalPolicy) {
			throw new Error(
				'[e2e] project_lead_policy row 1 is missing; the migration must seed it'
			);
		}

		const ownedLead = lead;
		let disposed = false;
		return {
			actor,
			lead: ownedLead,
			projectId: insertedProjectId,
			projectTitle,
			sectionId: POLICY_SECTION_ID,
			sectionLabel: POLICY_SECTION_LABEL,
			originalPolicy,
			readPolicy: () => readProjectLeadPolicy(db),
			restorePolicy: () =>
				restoreProjectLeadPolicy(db, originalPolicy, actor.userId),
			async dispose(): Promise<void> {
				if (disposed) return;
				disposed = true;

				const failures: unknown[] = [];
				const attempt = async (work: () => Promise<void>) => {
					try {
						await work();
					} catch (error) {
						failures.push(error);
					}
				};

				// The policy row is not owned by this fixture; restore it before
				// removing the actor whose id proves this test made the change.
				await attempt(() =>
					restoreProjectLeadPolicy(db, originalPolicy, actor.userId)
				);
				await attempt(() => deleteOwnedProject(db, insertedProjectId));
				await attempt(() => ownedLead.dispose());
				await attempt(() => actor.dispose());

				if (failures.length > 0) {
					throw new AggregateError(
						failures,
						'[e2e] project lead policy fixture cleanup failed'
					);
				}
			},
		};
	} catch (error) {
		if (projectId !== null) {
			try {
				await deleteOwnedProject(db, projectId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		if (lead) {
			try {
				await lead.dispose();
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		try {
			await actor.dispose();
		} catch {
			// Preserve the seed failure; the disposable database is dropped.
		}
		throw error;
	}
}

/**
 * Read the shared row through the independent fixture connection. MariaDB may
 * return the JSON column already parsed or as text, so accept exactly those
 * two shapes and validate the section map rather than stringifying an object.
 */
export async function readProjectLeadPolicy(
	db: Connection
): Promise<StoredProjectLeadPolicy | null> {
	const [rows] = await db.execute<PolicyRow[]>(
		`SELECT sections, updated_at, updated_by
       FROM project_lead_policy
      WHERE id = 1
      LIMIT 1`
	);
	const row = rows[0];
	if (!row) return null;

	return {
		sections: parseStoredSections(row.sections),
		updatedAt: storedTimestamp(row.updated_at),
		updatedBy: nullableNumber(row.updated_by),
	};
}

/**
 * Restore the exact snapshot only when the latest write was made by this
 * fixture's actor. If the row is already original, or another writer owns it,
 * leave it alone rather than clobbering an unrelated save.
 */
async function restoreProjectLeadPolicy(
	db: Connection,
	original: StoredProjectLeadPolicy,
	actorId: number
): Promise<void> {
	const current = await readProjectLeadPolicy(db);

	if (current === null) {
		await db.execute(
			`INSERT INTO project_lead_policy (id, sections, updated_at, updated_by)
       VALUES (1, ?, ?, ?)`,
			[
				JSON.stringify(original.sections),
				original.updatedAt,
				original.updatedBy,
			]
		);
	} else if (current.updatedBy !== actorId) {
		// This fixture never wrote, or someone else wrote after it. The owned
		// runtime plus the dedicated group guarantee that only this actor can
		// own this journey's write.
		return;
	} else {
		await db.execute(
			`UPDATE project_lead_policy
          SET sections = ?, updated_at = ?, updated_by = ?
        WHERE id = 1 AND updated_by = ?`,
			[
				JSON.stringify(original.sections),
				original.updatedAt,
				original.updatedBy,
				actorId,
			]
		);
	}

	const restored = await readProjectLeadPolicy(db);
	const expectedSections = Object.entries(original.sections);
	const restoredSections = Object.entries(restored?.sections ?? {});
	if (
		!restored ||
		restored.updatedBy !== original.updatedBy ||
		restored.updatedAt !== original.updatedAt ||
		restoredSections.length !== expectedSections.length ||
		expectedSections.some(
			([section, setting]) => restored.sections[section] !== setting
		)
	) {
		throw new Error(
			'[e2e] the original project_lead_policy row was not restored'
		);
	}
}

async function deleteOwnedProject(
	db: Connection,
	projectId: number
): Promise<void> {
	await db.execute(
		'DELETE FROM projects WHERE project_id = ? AND isDelete = 0',
		[projectId]
	);
	const [rows] = await db.execute<ProjectRow[]>(
		'SELECT project_id FROM projects WHERE project_id = ? LIMIT 1',
		[projectId]
	);
	if (rows.length > 0) {
		throw new Error(`[e2e] project ${projectId} was not deleted`);
	}
}

function parseStoredSections(value: unknown): StoredLeadPolicySections {
	let parsed: unknown = value;
	if (typeof parsed === 'string') {
		try {
			parsed = JSON.parse(parsed);
		} catch {
			throw new Error('[e2e] project_lead_policy.sections is not valid JSON');
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('[e2e] project_lead_policy.sections must be an object');
	}

	const sections: StoredLeadPolicySections = {};
	for (const [section, setting] of Object.entries(parsed)) {
		if (setting !== 'hidden' && setting !== 'view' && setting !== 'edit') {
			throw new Error(
				`[e2e] project_lead_policy.sections.${section} is not hidden, view, or edit`
			);
		}
		sections[section] = setting;
	}
	return sections;
}

function storedTimestamp(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed === '' ? null : trimmed;
	}
	if (value instanceof Date) {
		const pad = (part: number) => String(part).padStart(2, '0');
		return (
			`${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ` +
			`${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
		);
	}
	throw new Error('[e2e] project_lead_policy.updated_at is not a timestamp');
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}
