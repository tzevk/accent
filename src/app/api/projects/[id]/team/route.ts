/**
 * POST /api/projects/[id]/team
 *
 * A team change is one named operation over the stored `projects.project_team`
 * list. The route never accepts project content: only `project_team` is read
 * under a row lock and only `project_team` is written.
 */

import { logActivity } from '@/utils/activity-logger';
import { parseProjectTeam } from '@/utils/project-access';
import {
	PROJECT_ACCESS_DENIED,
	addProjectTeamMember,
	loadLeadPolicy,
	removeProjectTeamMember,
	requireProjectAccess,
	resolveProjectRights,
	updateProjectTeamMemberRole,
	type ProjectAccessOk,
	type TeamOperationFailure,
	type TeamOperationResult,
} from '@/lib/project-rights';

type TeamDbConnection = ProjectAccessOk['db'] & {
	beginTransaction?: () => Promise<void>;
	commit?: () => Promise<void>;
	rollback?: () => Promise<void>;
};

const OPERATIONS = ['add_member', 'remove_member', 'update_role'] as const;
type TeamOperation = (typeof OPERATIONS)[number];

const ALLOWED_FIELDS: Record<string, true> = {
	operation: true,
	member: true,
	memberId: true,
	role: true,
	replacementLeadId: true,
};

function badRequest(error: string): Response {
	return Response.json({ success: false, error }, { status: 400 });
}

function conflict(result: TeamOperationFailure): Response {
	return Response.json(
		{ success: false, error: result.error, code: result.code },
		{ status: 409 }
	);
}

function memberLabel(
	member: Record<string, unknown> | null | undefined
): string {
	if (!member) return 'team member';
	const name = member.name ?? member.full_name ?? member.email ?? member.id;
	return typeof name === 'string' && name.trim() ? name.trim() : 'team member';
}

function applyOperation(
	operation: TeamOperation,
	storedTeam: unknown,
	body: Record<string, unknown>,
	rights: { canChangeLeadDesignation: boolean; canClearFinalLead: boolean }
): TeamOperationResult {
	const options = {
		canChangeLeadDesignation: rights.canChangeLeadDesignation,
		canClearFinalLead: rights.canClearFinalLead,
		replacementLeadId: body.replacementLeadId,
	};
	if (operation === 'add_member') {
		return addProjectTeamMember(storedTeam, body.member, options);
	}
	if (operation === 'remove_member') {
		return removeProjectTeamMember(storedTeam, body.memberId, options);
	}
	return updateProjectTeamMemberRole(
		storedTeam,
		body.memberId,
		body.role,
		options
	);
}

export async function POST(
	request: Request,
	context: { params: Promise<{ id: string }> }
) {
	const { id } = await context.params;
	const access = await requireProjectAccess(request, id, {
		getLeadPolicy: loadLeadPolicy,
	});
	if ('response' in access) return access.response;

	const { user, project, rights, leadPolicy, db, ownsDb } = access;
	const teamDb = db as TeamDbConnection;

	try {
		// Team management is its own authority; an update grant alone cannot
		// change the team.
		if (!rights.canManageTeam) {
			return Response.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		let body: Record<string, unknown>;
		try {
			const parsed = await request.json();
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return badRequest('A team operation is required');
			}
			body = parsed as Record<string, unknown>;
		} catch {
			return badRequest('A team operation is required');
		}

		const unknownField = Object.keys(body).find(
			(key) => ALLOWED_FIELDS[key] !== true
		);
		if (unknownField) {
			return badRequest(
				`Field "${unknownField}" is not part of a team operation`
			);
		}

		const operation = body.operation;
		if (
			typeof operation !== 'string' ||
			!(OPERATIONS as readonly string[]).includes(operation)
		) {
			return badRequest('A valid team operation is required');
		}
		const namedOperation = operation as TeamOperation;

		if (namedOperation === 'add_member' && body.member === undefined) {
			return badRequest('member is required to add a team member');
		}
		if (
			(namedOperation === 'remove_member' ||
				namedOperation === 'update_role') &&
			body.memberId === undefined
		) {
			return badRequest('memberId is required for this team operation');
		}
		if (namedOperation === 'update_role' && body.role === undefined) {
			return badRequest('role is required to update a team member role');
		}

		// The stored row is the source of truth. Resolve its real key exactly
		// as the section PUT does, then lock just that row.
		const keyColumn =
			project.id !== undefined && project.id !== null ? 'id' : 'project_id';
		const keyValue = project[keyColumn];
		if (keyValue === undefined || keyValue === null) {
			return Response.json(
				{ success: false, error: PROJECT_ACCESS_DENIED },
				{ status: 403 }
			);
		}

		if (
			!teamDb.beginTransaction ||
			!teamDb.commit ||
			!teamDb.rollback
		) {
			throw new Error('The project connection cannot start a transaction');
		}

		await teamDb.beginTransaction();

		let committed = false;
		try {
			const [rows] = await teamDb.execute(
				`SELECT project_team FROM projects WHERE ${keyColumn} = ? AND isDelete = 0 FOR UPDATE`,
				[keyValue]
			);
			const storedRow = Array.isArray(rows) ? rows[0] : null;
			if (!storedRow) {
				await teamDb.rollback();
				return Response.json(
					{ success: false, error: PROJECT_ACCESS_DENIED },
					{ status: 403 }
				);
			}

			const storedTeam = storedRow.project_team;
			// The pre-lock decision is stale by definition. Recompute against
			// the locked team so a manager who lost authority between the
			// initial read and the lock cannot save through the old rights.
			const lockedRights = resolveProjectRights({
				user,
				project: { ...project, project_team: storedTeam },
				leadPolicy,
				financialPermissions: rights.financialAreas,
			});
			if (!lockedRights.canManageTeam) {
				await teamDb.rollback();
				return Response.json(
					{ success: false, error: PROJECT_ACCESS_DENIED },
					{ status: 403 }
				);
			}

			const result = applyOperation(
				namedOperation,
				storedTeam,
				body,
				lockedRights
			);
			if (!result.ok) {
				await teamDb.rollback();
				return conflict(result);
			}

			const [updateResult] = await teamDb.execute(
				`UPDATE projects SET project_team = ? WHERE ${keyColumn} = ? AND isDelete = 0`,
				[JSON.stringify(result.team), keyValue]
			);
			const affectedRows =
				(updateResult as { affectedRows?: number } | undefined)
					?.affectedRows ?? 0;
			if (affectedRows === 0) {
				await teamDb.rollback();
				return Response.json(
					{ success: false, error: PROJECT_ACCESS_DENIED },
					{ status: 403 }
				);
			}

			await teamDb.commit();
			committed = true;

			const before = parseProjectTeam(storedTeam);
			await logActivity({
				userId: user.id ?? '',
				actionType: 'update',
				resourceType: 'project',
				resourceId: String(keyValue),
				description:
					namedOperation === 'add_member'
						? `Added ${memberLabel(result.member)} to the project team`
						: namedOperation === 'remove_member'
							? `Removed ${memberLabel(result.member)} from the project team`
							: `Changed the project role of ${memberLabel(result.member)}`,
				details: {
					operation: namedOperation,
					before,
					after: result.team,
					member: result.member,
				},
				request,
			});

			const nextRights = resolveProjectRights({
				user,
				project: { ...project, project_team: JSON.stringify(result.team) },
				leadPolicy,
				financialPermissions: rights.financialAreas,
			});

			return Response.json({
				success: true,
				data: { project_team: result.team, rights: nextRights },
			});
		} catch (error) {
			if (!committed) {
				try {
					await teamDb.rollback();
				} catch (rollbackError) {
					console.error('Team update rollback failed:', rollbackError);
				}
			}
			throw error;
		}
	} catch (error) {
		console.error('Project team update error:', error);
		return Response.json(
			{ success: false, error: 'Failed to update the project team' },
			{ status: 500 }
		);
	} finally {
		if (ownsDb) {
			try {
				db.release?.();
			} catch (error) {
				console.warn('Error releasing DB connection in team route:', error);
			}
		}
	}
}
