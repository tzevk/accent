import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LEAD_POLICY,
	resolveProjectRights,
	type ProjectRightsUser,
} from './policy';
import {
	PROJECT_PERMISSION_SECTIONS,
	buildProjectScopesPayload,
	buildSectionPayload,
	type FieldPermissionLevel,
} from './permission-config';
import {
	PROJECT_ACTIONS,
	type ProjectAction,
	type ProjectScope,
} from './grants';
import { WORK_SECTION_IDS } from './sections';

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

/**
 * Build the exact `field_permissions` tree the permission editor saves.
 * Sections and fields come from the shared config, not from a hand-written
 * fixture, so the round-trip follows the editor's shape.
 */
function editorFieldPermissions(
	grantedActions: ProjectAction[],
	scopes: Partial<Record<ProjectAction, ProjectScope>>,
	sectionPermission: FieldPermissionLevel = 'hidden'
) {
	const fieldState: Record<
		string,
		Record<string, FieldPermissionLevel>
	> = {};
	const enabledState: Record<string, boolean> = {};
	for (const [sectionKey, section] of Object.entries(
		PROJECT_PERMISSION_SECTIONS
	)) {
		fieldState[sectionKey] = {};
		enabledState[sectionKey] = true;
		for (const fieldKey of Object.keys(section.fields)) {
			fieldState[sectionKey][fieldKey] = sectionPermission;
		}
	}

	return {
		modules: {
			projects: {
				enabled: true,
				name: 'Projects',
				category: 'module',
				crud: Object.fromEntries(
					PROJECT_ACTIONS.map((action) => [
						action,
						grantedActions.includes(action),
					])
				),
				sections: buildSectionPayload(
					PROJECT_PERMISSION_SECTIONS,
					fieldState,
					enabledState
				),
			},
		},
		projectScopes: {
			projects: buildProjectScopesPayload(scopes, grantedActions),
		},
	};
}

function editorSectionPermissions(
	overrides: Record<string, Record<string, FieldPermissionLevel>>
) {
	const fieldState: Record<
		string,
		Record<string, FieldPermissionLevel>
	> = {};
	const enabledState: Record<string, boolean> = {};
	for (const [sectionKey, section] of Object.entries(
		PROJECT_PERMISSION_SECTIONS
	)) {
		fieldState[sectionKey] = {};
		enabledState[sectionKey] = true;
		for (const fieldKey of Object.keys(section.fields)) {
			fieldState[sectionKey][fieldKey] =
				overrides[sectionKey]?.[fieldKey] ?? 'hidden';
		}
	}
	return buildSectionPayload(
		PROJECT_PERMISSION_SECTIONS,
		fieldState,
		enabledState
	);
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

	it('assign scope manages the team and may change the lead designation', () => {
		const rights = resolveProjectRights({
			user: user({
				merged_permissions: ['projects:assign'],
				field_permissions: withScopes({ assign: 'assigned' }),
			}),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.canManageTeam).toBe(true);
		expect(rights.canChangeLeadDesignation).toBe(true);
		expect(rights.readableSections).toContain('project_team');
		// Team authority is not a general update grant.
		expect(rights.editableSections).toEqual([]);
	});

	it('gives an assign-only manager the team section and nothing else', () => {
		const rights = resolveProjectRights({
			user: user({
				id: 99,
				email: 'assigner@example.com',
				merged_permissions: ['projects:assign'],
				field_permissions: withScopes({ assign: 'all' }),
			}),
			project: { project_team: TEAM },
		});

		expect(rights.canOpen).toBe(true);
		expect(rights.isMember).toBe(false);
		expect(rights.canManageTeam).toBe(true);
		expect(rights.canChangeLeadDesignation).toBe(true);
		expect(rights.readableSections).toEqual(['project_team']);
		expect(rights.editableSections).toEqual([]);
	});

	it('keeps an update-only user out of team management', () => {
		const rights = resolveProjectRights({
			user: user({
				merged_permissions: ['projects:update'],
				field_permissions: withScopes({ update: 'assigned' }),
			}),
			project: { project_team: TEAM },
		});

		expect(rights.editableSections).toHaveLength(16);
		expect(rights.canManageTeam).toBe(false);
		expect(rights.canChangeLeadDesignation).toBe(false);
	});

	it('keeps the team section readable for a manager who hides it', () => {
		const rights = resolveProjectRights({
			user: user({
				merged_permissions: ['projects:assign'],
				field_permissions: withScopes({ assign: 'all' }),
			}),
			project: { project_team: TEAM },
			leadPolicy: { sections: { project_team: 'hidden' } },
		});

		expect(rights.canManageTeam).toBe(true);
		expect(rights.sections.project_team.read).toBe(true);
		expect(rights.sections.project_team.edit).toBe(false);
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

describe('editor payload round-trip', () => {
	const lead = { id: 43, email: 'lead@example.com' };
	const member = { id: 42, email: 'member@example.com' };
	const stranger = { id: 99, email: 'stranger@example.com' };

	function rightsFor(
		actor: { id: number; email: string },
		granted: ProjectAction[],
		scopes: Partial<Record<ProjectAction, ProjectScope>>
	) {
		return resolveProjectRights({
			user: user({
				...actor,
				merged_permissions: granted.map((action) => `projects:${action}`),
				// Round-trip through JSON, as the database column stores it.
				field_permissions: JSON.parse(
					JSON.stringify(editorFieldPermissions(granted, scopes))
				),
			}),
			project: { project_team: TEAM },
		});
	}

	it('honours read scope led for a lead and refuses a non-lead member', () => {
		const inside = rightsFor(lead, ['read'], { read: 'led' });
		const outside = rightsFor(member, ['read'], { read: 'led' });

		expect(inside.canOpen).toBe(true);
		expect(inside.readableSections).toHaveLength(16);
		// The member keeps the baseline membership view, not the grant.
		expect(outside.readableSections).toHaveLength(10);
	});

	it('honours read scope assigned inside the team and refuses a stranger', () => {
		const inside = rightsFor(member, ['read'], { read: 'assigned' });
		const outside = rightsFor(stranger, ['read'], { read: 'assigned' });

		expect(inside.readableSections).toHaveLength(16);
		expect(outside.canOpen).toBe(false);
		expect(outside.readableSections).toEqual([]);
	});

	it('honours read scope all for a user with no relationship', () => {
		const rights = rightsFor(stranger, ['read'], { read: 'all' });

		expect(rights.canOpen).toBe(true);
		expect(rights.readableSections).toHaveLength(16);
	});

	it('honours update scope assigned inside the team and refuses a stranger', () => {
		const inside = rightsFor(member, ['update'], { update: 'assigned' });
		const outside = rightsFor(stranger, ['update'], { update: 'assigned' });

		expect(inside.editableSections).toHaveLength(16);
		expect(outside.canOpen).toBe(false);
		expect(outside.editableSections).toEqual([]);
	});

	it('honours update scope led for a lead and refuses a non-lead member', () => {
		const inside = rightsFor(lead, ['update'], { update: 'led' });
		const outside = rightsFor(member, ['update'], { update: 'led' });

		expect(inside.editableSections).toHaveLength(16);
		expect(outside.editableSections).toEqual([]);
	});

	it('honours update scope all for a user with no relationship', () => {
		const rights = rightsFor(stranger, ['update'], { update: 'all' });

		expect(rights.canOpen).toBe(true);
		expect(rights.editableSections).toHaveLength(16);
	});

	it('honours assign scope assigned inside the team and refuses a stranger', () => {
		const inside = rightsFor(member, ['assign'], { assign: 'assigned' });
		const outside = rightsFor(stranger, ['assign'], { assign: 'assigned' });

		expect(inside.canManageTeam).toBe(true);
		expect(outside.canManageTeam).toBe(false);
		expect(outside.canOpen).toBe(false);
	});

	it('honours assign scope led for a lead and refuses a non-lead member', () => {
		const inside = rightsFor(lead, ['assign'], { assign: 'led' });
		const outside = rightsFor(member, ['assign'], { assign: 'led' });

		expect(inside.canManageTeam).toBe(true);
		expect(outside.canManageTeam).toBe(false);
	});

	it('honours assign scope all for a user with no relationship', () => {
		const rights = rightsFor(stranger, ['assign'], { assign: 'all' });

		expect(rights.canManageTeam).toBe(true);
	});

	it.each(['close', 'reopen', 'delete'] as const)(
		'honours %s scope assigned inside the team and refuses a stranger',
		(action) => {
			const inside = rightsFor(member, [action], { [action]: 'assigned' });
			const outside = rightsFor(stranger, [action], { [action]: 'assigned' });

			expect(inside.canPerform[action]).toBe(true);
			expect(outside.canPerform[action]).toBe(false);
		}
	);

	it.each(['close', 'reopen', 'delete'] as const)(
		'honours %s scope led for a lead and refuses a non-lead member',
		(action) => {
			const inside = rightsFor(lead, [action], { [action]: 'led' });
			const outside = rightsFor(member, [action], { [action]: 'led' });

			expect(inside.canPerform[action]).toBe(true);
			expect(outside.canPerform[action]).toBe(false);
			// The member's own membership still opens the workspace.
			expect(outside.isMember).toBe(true);
		}
	);

	it.each(['close', 'reopen', 'delete'] as const)(
		'honours %s scope all for a user with no relationship',
		(action) => {
			const inside = rightsFor(stranger, [action], { [action]: 'all' });
			const outside = rightsFor(stranger, [action], { [action]: 'led' });

			expect(inside.canPerform[action]).toBe(true);
			expect(outside.canPerform[action]).toBe(false);
		}
	);

	it('treats a granted action without a saved scope as led, not all', () => {
		const memberRights = resolveProjectRights({
			user: user({
				...member,
				merged_permissions: ['projects:update'],
				field_permissions: editorFieldPermissions(['update'], {}),
			}),
			project: { project_team: TEAM },
		});
		const leadRights = resolveProjectRights({
			user: user({
				...lead,
				merged_permissions: ['projects:update'],
				field_permissions: editorFieldPermissions(['update'], {}),
			}),
			project: { project_team: TEAM },
		});

		expect(memberRights.directScopes.update).toBe('led');
		expect(memberRights.editableSections).toEqual([]);
		expect(leadRights.directScopes.update).toBe('led');
		expect(leadRights.editableSections).toHaveLength(16);
	});
});

describe('editor payload section enforcement', () => {
	it('adds a read-only section that the shared lead policy hides', () => {
		const rights = resolveProjectRights({
			user: user({
				id: 43,
				email: 'lead@example.com',
				field_permissions: {
					modules: {
						projects: {
							enabled: true,
							sections: editorSectionPermissions({
								project_details: { project_name: 'view' },
							}),
						},
					},
				},
			}),
			project: { project_team: TEAM },
			leadPolicy: { sections: { project_details: 'hidden' } },
		});

		expect(rights.sections.project_details).toEqual({
			read: true,
			edit: false,
		});
	});

	it('adds an editable section that the shared lead policy hides when update is in scope', () => {
		const rights = resolveProjectRights({
			user: user({
				id: 43,
				email: 'lead@example.com',
				merged_permissions: ['projects:update'],
				field_permissions: {
					modules: {
						projects: {
							enabled: true,
							sections: editorSectionPermissions({
								scope: { original_scope: 'edit' },
							}),
						},
					},
					projectScopes: { projects: { update: 'led' } },
				},
			}),
			project: { project_team: TEAM },
			leadPolicy: { sections: { scope: 'hidden' } },
		});

		expect(rights.sections.scope).toEqual({ read: true, edit: true });
	});

	it('grants nothing for a hidden section field permission', () => {
		const rights = resolveProjectRights({
			user: user({
				id: 43,
				email: 'lead@example.com',
				field_permissions: {
					modules: {
						projects: {
							enabled: true,
							sections: editorSectionPermissions({
								project_details: { project_name: 'hidden' },
							}),
						},
					},
				},
			}),
			project: { project_team: TEAM },
			leadPolicy: { sections: { project_details: 'hidden' } },
		});

		expect(rights.sections.project_details).toEqual({
			read: false,
			edit: false,
		});
		expect(rights.readableSections).not.toContain('project_details');
	});
});

describe('every configurable work section is enforced', () => {
	it.each(WORK_SECTION_IDS)(
		'grants read for the %s section through its saved field permission',
		(sectionId) => {
			const section = PROJECT_PERMISSION_SECTIONS[sectionId];
			expect(section).toBeDefined();
			const [firstField] = Object.keys(section.fields);
			expect(firstField).toBeDefined();

			const rights = resolveProjectRights({
				user: user({
					id: 99,
					email: 'outside@example.com',
					field_permissions: {
						modules: {
							projects: {
								enabled: true,
								sections: editorSectionPermissions({
									[sectionId]: { [firstField]: 'view' },
								}),
							},
						},
					},
				}),
				project: { project_team: TEAM },
				leadPolicy: { sections: { [sectionId]: 'hidden' } },
			});

			expect(rights.sections[sectionId]).toEqual({
				read: true,
				edit: false,
			});
		}
	);
});
