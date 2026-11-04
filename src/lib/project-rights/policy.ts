/**
 * Pure project-rights policy.
 *
 * One module answers, for an actor and a target project, whether the
 * workspace may be opened, which sections may be read or edited, whether the
 * team may be managed, which lifecycle actions are available, and which
 * financial and commercial areas are visible.
 *
 * This module performs no database access. Team membership and lead identity
 * come from the existing identity layer in `src/utils/project-access.ts`.
 */

import { getProjectTeamMembership } from '@/utils/project-access';
import {
	MEMBER_READ_SECTIONS,
	PROTECTED_COMMERCIAL_COLUMNS,
	WORK_SECTION_IDS,
	type SectionId,
} from './sections';
import { DEFAULT_LEAD_POLICY, type LeadPolicy } from './lead-policy';
import {
	hasProjectAction,
	parseCommercialFieldRights,
	parseExplicitSectionRights,
	PROJECT_ACTIONS,
	resolveProjectActionScope,
	type PermissionCarrier,
	type ProjectAction,
	type ProjectScope,
} from './grants';

// The shared lead policy lives in `lead-policy.ts`; re-exported here so
// existing `./policy` imports keep working.
export * from './lead-policy';

export type SectionRight = { read: boolean; edit: boolean };

export type FinancialAreas = {
	quotation: boolean;
	purchase_order: boolean;
	invoice: boolean;
};

export type ProjectRights = {
	canOpen: boolean;
	isMember: boolean;
	isLead: boolean;
	sections: Record<SectionId, SectionRight>;
	readableSections: SectionId[];
	editableSections: SectionId[];
	canManageTeam: boolean;
	canChangeLeadDesignation: boolean;
	canPerform: {
		create: boolean;
		delete: boolean;
		close: boolean;
		reopen: boolean;
	};
	directScopes: Partial<Record<ProjectAction, ProjectScope>>;
	financialAreas: FinancialAreas;
	commercial: { view: string[]; edit: string[] };
};

export type ProjectRightsUser = PermissionCarrier & {
	id?: number | string | null;
	email?: string | null;
};

export type ProjectRightsProject = {
	project_team?: unknown;
};

export type ResolveProjectRightsInput = {
	user: ProjectRightsUser;
	project: ProjectRightsProject | null | undefined;
	leadPolicy?: LeadPolicy;
	financialPermissions?: Partial<FinancialAreas>;
};

function scopeCovers(
	scope: ProjectScope | undefined,
	relationships: { isMember: boolean; isLead: boolean }
): boolean {
	if (!scope) return false;
	if (scope === 'all') return true;
	if (scope === 'assigned') return relationships.isMember;
	return relationships.isLead;
}

function allSections(value: boolean): Record<SectionId, SectionRight> {
	return Object.fromEntries(
		WORK_SECTION_IDS.map((section) => [
			section,
			{ read: value, edit: value },
		])
	) as Record<SectionId, SectionRight>;
}

export function resolveProjectRights({
	user,
	project,
	leadPolicy = DEFAULT_LEAD_POLICY,
	financialPermissions,
}: ResolveProjectRightsInput): ProjectRights {
	const isSuperAdmin = Boolean(user?.is_super_admin);
	const membership = getProjectTeamMembership(
		project?.project_team,
		user?.id ?? '',
		user?.email ?? undefined
	);
	const { isMember, isLead } = membership;

	const directScopes: Partial<Record<ProjectAction, ProjectScope>> = {};
	for (const action of PROJECT_ACTIONS) {
		const scope = resolveProjectActionScope(user, action);
		if (scope) directScopes[action] = scope;
	}
	const readScope = resolveProjectActionScope(user, 'read');
	const updateScope = resolveProjectActionScope(user, 'update');
	const assignScope = resolveProjectActionScope(user, 'assign');
	const deleteScope = resolveProjectActionScope(user, 'delete');
	const closeScope = resolveProjectActionScope(user, 'close');
	const reopenScope = resolveProjectActionScope(user, 'reopen');

	const relationships = { isMember, isLead };
	const readCovers = scopeCovers(readScope, relationships);
	const updateCovers = scopeCovers(updateScope, relationships);
	const assignCovers = scopeCovers(assignScope, relationships);
	const deleteCovers = scopeCovers(deleteScope, relationships);
	const closeCovers = scopeCovers(closeScope, relationships);
	const reopenCovers = scopeCovers(reopenScope, relationships);

	const canOpen =
		isSuperAdmin ||
		isMember ||
		isLead ||
		[readScope, updateScope, assignScope, closeScope, reopenScope, deleteScope].some(
			(scope) => scopeCovers(scope, relationships)
		);

	const sections = allSections(false);

	if (isSuperAdmin) {
		for (const section of WORK_SECTION_IDS) {
			sections[section] = { read: true, edit: true };
		}
	} else {
		for (const section of WORK_SECTION_IDS) {
			const right = sections[section];

			if (isLead) {
				const setting = leadPolicy?.sections?.[section] ?? 'edit';
				if (setting === 'view') right.read = true;
				if (setting === 'edit') {
					right.read = true;
					right.edit = true;
				}
			}

			// The shared lead policy owns a lead's access. An ordinary member
			// keeps the baseline readable sections; a lead's policy may hide
			// them (hiding removes read as well as edit).
			if (isMember && !isLead && MEMBER_READ_SECTIONS.includes(section)) {
				right.read = true;
			}

			if (readCovers) right.read = true;
			if (updateCovers) {
				right.read = true;
				right.edit = true;
			}
		}

		const explicit = parseExplicitSectionRights(user?.field_permissions);
		for (const section of explicit.read) sections[section].read = true;
		for (const section of explicit.edit) {
			sections[section].read = true;
			// An explicit edit section still needs the update action in scope.
			if (updateCovers) sections[section].edit = true;
		}
	}

	const readableSections = WORK_SECTION_IDS.filter(
		(section) => sections[section].read
	);
	const editableSections = WORK_SECTION_IDS.filter(
		(section) => sections[section].edit
	);

	const commercial = isSuperAdmin
		? {
				view: [...PROTECTED_COMMERCIAL_COLUMNS],
				edit: [...PROTECTED_COMMERCIAL_COLUMNS],
			}
		: parseCommercialFieldRights(user?.field_permissions);

	const financialAreas: FinancialAreas = isSuperAdmin
		? { quotation: true, purchase_order: true, invoice: true }
		: {
				quotation: Boolean(financialPermissions?.quotation),
				purchase_order: Boolean(financialPermissions?.purchase_order),
				invoice: Boolean(financialPermissions?.invoice),
			};

	return {
		canOpen,
		isMember,
		isLead,
		sections,
		readableSections,
		editableSections,
		canManageTeam: isSuperAdmin || isLead || assignCovers,
		canChangeLeadDesignation: isSuperAdmin || isLead,
		canPerform: {
			create: isSuperAdmin || hasProjectAction(user, 'create'),
			delete: isSuperAdmin || deleteCovers,
			close: isSuperAdmin || closeCovers,
			reopen: isSuperAdmin || reopenCovers,
		},
		directScopes,
		financialAreas,
		commercial,
	};
}
