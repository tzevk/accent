import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LEAD_POLICY,
	resolveProjectRights,
	type ProjectRightsUser,
} from './policy';

const TEAM = [
	{ id: 42, name: 'Member', email: 'member@example.com', role: 'Team Member' },
	{ id: 43, name: 'Lead', email: 'lead@example.com', role: 'Project Lead' },
];

function user(overrides: Partial<ProjectRightsUser> = {}): ProjectRightsUser {
	return {
		id: 42,
		email: 'member@example.com',
		is_super_admin: false,
		permissions: [],
		role_permissions: [],
		merged_permissions: [],
		field_permissions: {},
		...overrides,
	};
}

function withScopes(scopes: Record<string, string>) {
	return { projectScopes: { projects: scopes } };
}

describe('resolveProjectRights workspace entry', () => {
	it('opens for an ordinary team member without any project grant', () => {
		const rights = resolveProjectRights({
			user: user(),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.isMember).toBe(true);
		expect(rights.isLead).toBe(false);
		expect(rights.readableSections).toEqual([
			'scope',
			'project_schedule',
			'project_team',
			'documents_received',
			'documents_issued',
			'query_log',
			'assumption',
			'lessons_learnt',
			'discussion',
			'upload_documents',
		]);
		expect(rights.editableSections).toEqual([]);
		expect(rights.canManageTeam).toBe(false);
	});

	it('opens for a project lead without any project permission grant', () => {
		const rights = resolveProjectRights({
			user: user({ id: 43, email: 'lead@example.com' }),
			project: { project_team: JSON.stringify(TEAM) },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.isLead).toBe(true);
		expect(rights.readableSections).toHaveLength(16);
		expect(rights.editableSections).toHaveLength(16);
		expect(rights.canManageTeam).toBe(true);
		expect(rights.canChangeLeadDesignation).toBe(true);
		expect(rights.canPerform).toEqual({
			create: false,
			delete: false,
			close: false,
			reopen: false,
		});
	});

	it('denies an authenticated user with no relationship and no grant', () => {
		const rights = resolveProjectRights({
			user: user({ id: 99, email: 'stranger@example.com' }),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(false);
		expect(rights.readableSections).toEqual([]);
	});

	it('does not treat an activity assignment as membership', () => {
		// The policy has no assignment input; relationships come from the team list.
		const rights = resolveProjectRights({
			user: user({ id: 77, email: 'assignee@example.com' }),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(false);
	});

	it('gives a super admin the workspace without membership', () => {
		const rights = resolveProjectRights({
			user: user({ id: 1, email: 'root@example.com', is_super_admin: true }),
			project: { project_team: [] },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.readableSections).toHaveLength(16);
		expect(rights.editableSections).toHaveLength(16);
		expect(rights.canPerform).toEqual({
			create: true,
			delete: true,
			close: true,
			reopen: true,
		});
		expect(rights.canManageTeam).toBe(true);
	});
});

describe('resolveProjectRights scopes', () => {
	it('read scope led opens a led project and reads every work section', () => {
		const rights = resolveProjectRights({
			user: user({
				id: 43,
				email: 'lead@example.com',
				merged_permissions: ['projects:read'],
				field_permissions: withScopes({ read: 'led' }),
			}),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.directScopes.read).toBe('led');
		expect(rights.readableSections).toHaveLength(16);
		// Lead policy still grants edit rights on led projects.
		expect(rights.editableSections).toHaveLength(16);
	});

	it('fails a missing grant scope closed to led', () => {
		const rights = resolveProjectRights({
			user: user({
				merged_permissions: ['projects:read'],
				field_permissions: {},
			}),
			project: { project_team: TEAM },
		});

		// Member keeps entry, but the grant's narrowest scope is led.
		expect(rights.canOpen).toBe(true);
		expect(rights.directScopes.read).toBe('led');
		expect(rights.readableSections).toEqual([
			'scope',
			'project_schedule',
			'project_team',
			'documents_received',
			'documents_issued',
			'query_log',
			'assumption',
			'lessons_learnt',
			'discussion',
			'upload_documents',
		]);
	});

	it('read scope assigned covers every member and reads all sections', () => {
		const rights = resolveProjectRights({
			user: user({
				merged_permissions: ['projects:read'],
				field_permissions: withScopes({ read: 'assigned' }),
			}),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.readableSections).toHaveLength(16);
		expect(rights.editableSections).toEqual([]);
	});

	it('read scope all covers a non-member', () => {
		const rights = resolveProjectRights({
			user: user({
				id: 99,
				email: 'viewer@example.com',
				merged_permissions: ['projects:read'],
				field_permissions: withScopes({ read: 'all' }),
			}),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.readableSections).toHaveLength(16);
		expect(rights.editableSections).toEqual([]);
	});

	it('update scope grants edit only inside its scope', () => {
		const scoped = resolveProjectRights({
			user: user({
				merged_permissions: ['projects:update'],
				field_permissions: withScopes({ update: 'assigned' }),
			}),
			project: { project_team: TEAM },
		});
		const outside = resolveProjectRights({
			user: user({
				id: 99,
				email: 'outside@example.com',
				merged_permissions: ['projects:update'],
				field_permissions: withScopes({ update: 'assigned' }),
			}),
			project: { project_team: TEAM },
		});

		expect(scoped.editableSections).toHaveLength(16);
		expect(outside.canOpen).toBe(false);
		expect(outside.editableSections).toEqual([]);
	});

	it('assign scope manages the team but is not a general update grant', () => {
		const rights = resolveProjectRights({
			user: user({
				merged_permissions: ['projects:assign'],
				field_permissions: withScopes({ assign: 'assigned' }),
			}),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.canManageTeam).toBe(true);
		expect(rights.editableSections).toEqual([]);
		expect(rights.canChangeLeadDesignation).toBe(false);
	});

	it.each([
		['close', 'canPerform.close'],
		['reopen', 'canPerform.reopen'],
		['delete', 'canPerform.delete'],
	] as const)('%s scope all enables only that lifecycle action', (action, path) => {
		const rights = resolveProjectRights({
			user: user({
				merged_permissions: [`projects:${action}`],
				field_permissions: withScopes({ [action]: 'all' }),
			}),
			project: { project_team: TEAM },
		});

		const value = path
			.split('.')
			.reduce<Record<string, unknown> | undefined>(
				(current, key) => current?.[key] as Record<string, unknown> | undefined,
				rights as unknown as Record<string, unknown>
			);
		expect(value).toBe(true);
		expect(rights.canPerform.create).toBe(false);
	});
});

describe('resolveProjectRights sections', () => {
	it('applies a hidden lead policy section and a view-only section', () => {
		const rights = resolveProjectRights({
			user: user({ id: 43, email: 'lead@example.com' }),
			project: { project_team: TEAM },
			leadPolicy: {
				sections: { project_details: 'hidden', scope: 'view' },
			},
		});

		expect(rights.sections.project_details).toEqual({ read: false, edit: false });
		expect(rights.sections.scope).toEqual({ read: true, edit: false });
		expect(rights.readableSections).not.toContain('project_details');
		expect(rights.editableSections).not.toContain('scope');
		expect(rights.editableSections).toContain('documents_issued');
	});

	it('adds an explicit section that the lead policy hides', () => {
		const rights = resolveProjectRights({
			user: user({
				id: 43,
				email: 'lead@example.com',
				field_permissions: {
					modules: {
						projects: {
							enabled: true,
							sections: {
								project_details: {
									enabled: true,
									fields: {
										name: { permission: 'edit' },
									},
								},
							},
						},
					},
				},
			}),
			project: { project_team: TEAM },
			leadPolicy: { sections: { project_details: 'hidden' } },
		});

		expect(rights.sections.project_details.read).toBe(true);
		// The explicit edit still needs the update action in scope.
		expect(rights.sections.project_details.edit).toBe(false);
	});

	it('does not let explicit edit sections bypass the update action', () => {
		const rights = resolveProjectRights({
			user: user({
				field_permissions: {
					modules: {
						projects: {
							enabled: true,
							sections: {
								scope: {
									enabled: true,
									fields: { scope_of_work: { permission: 'edit' } },
								},
							},
						},
					},
				},
			}),
			project: { project_team: TEAM },
		});

		expect(rights.sections.scope.read).toBe(true);
		expect(rights.sections.scope.edit).toBe(false);
	});
});

describe('resolveProjectRights commercial and financial rights', () => {
	const fieldPermissions = {
		modules: {
			projects: {
				enabled: true,
				sections: {
					commercial: {
						enabled: true,
						fields: {
							budget: { permission: 'view' },
							profitability: { permission: 'edit' },
							project_value: { permission: 'hidden' },
						},
					},
				},
			},
		},
	};

	it('maps commercial field permissions to protected columns', () => {
		const rights = resolveProjectRights({
			user: user({ field_permissions: fieldPermissions }),
			project: { project_team: TEAM },
		});

		expect(rights.commercial.view).toEqual([
			'budget',
			'profitability_estimate',
		]);
		expect(rights.commercial.edit).toEqual(['profitability_estimate']);
	});

	it('shows every commercial column to a super admin', () => {
		const rights = resolveProjectRights({
			user: user({ is_super_admin: true }),
			project: { project_team: [] },
		});

		expect(rights.commercial.view).toEqual(
			expect.arrayContaining([
				'budget',
				'project_value',
				'cost_to_company',
				'profitability_estimate',
				'actual_profit_loss',
			])
		);
	});

	it('carries financial areas without granting workspace entry', () => {
		const rights = resolveProjectRights({
			user: user({ id: 99, email: 'finance@example.com' }),
			project: { project_team: TEAM },
			financialPermissions: { quotation: true },
		});

		expect(rights.financialAreas).toEqual({
			quotation: true,
			purchase_order: false,
			invoice: false,
		});
		expect(rights.canOpen).toBe(false);
	});
});

describe('DEFAULT_LEAD_POLICY', () => {
	it('starts with every work section editable', () => {
		expect(Object.values(DEFAULT_LEAD_POLICY.sections)).toEqual(
			Array.from({ length: 16 }, () => 'edit')
		);
	});
});
