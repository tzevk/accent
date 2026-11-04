import { describe, expect, it } from 'vitest';
import {
	hasAllProjectScope,
	hasProjectAction,
	parseCommercialFieldRights,
	parseExplicitSectionRights,
	parseProjectScopes,
	resolveProjectActionScope,
} from './grants';

describe('project action grants', () => {
	it('reads grants from merged, direct, role, and nested module sources', () => {
		expect(
			hasProjectAction({ merged_permissions: ['projects:read'] }, 'read')
		).toBe(true);
		expect(
			hasProjectAction({ permissions: ['projects:update'] }, 'update')
		).toBe(true);
		expect(
			hasProjectAction({ role_permissions: ['projects:assign'] }, 'assign')
		).toBe(true);
		expect(
			hasProjectAction(
				{
					field_permissions: {
						modules: {
							projects: {
								enabled: true,
								crud: { close: true },
							},
						},
					},
				},
				'close'
			)
		).toBe(true);
		expect(hasProjectAction({}, 'delete')).toBe(false);
	});

	it('accepts JSON strings for permission columns', () => {
		expect(
			hasProjectAction({ permissions: JSON.stringify(['projects:reopen']) }, 'reopen')
		).toBe(true);
	});
});

describe('stored project scopes', () => {
	it('parses valid scopes and ignores unknown values', () => {
		const scopes = parseProjectScopes({
			projectScopes: {
				projects: {
					read: 'all',
					update: 'assigned',
					close: 'everywhere',
					delete: null,
				},
			},
		});

		expect(scopes).toEqual({ read: 'all', update: 'assigned' });
	});

	it('accepts a JSON string field_permissions payload', () => {
		const scopes = parseProjectScopes(
			JSON.stringify({ projectScopes: { projects: { read: 'led' } } })
		);

		expect(scopes).toEqual({ read: 'led' });
	});

	it('defaults a grant without a stored scope to led', () => {
		const user = {
			merged_permissions: ['projects:update'],
			field_permissions: { projectScopes: { projects: {} } },
		};

		expect(resolveProjectActionScope(user, 'update')).toBe('led');
	});

	it('resolves a role-derived grant to led when no scope was saved', () => {
		const user = {
			role_permissions: ['projects:read'],
			field_permissions: {},
		};

		expect(resolveProjectActionScope(user, 'read')).toBe('led');
	});

	it('returns no scope for an action the user does not hold', () => {
		const user = {
			merged_permissions: ['projects:read'],
			field_permissions: { projectScopes: { projects: { update: 'all' } } },
		};

		expect(resolveProjectActionScope(user, 'update')).toBeUndefined();
	});

	it('detects an all-projects scope only for a held action', () => {
		expect(
			hasAllProjectScope({
				merged_permissions: ['projects:read'],
				field_permissions: { projectScopes: { projects: { read: 'all' } } },
			})
		).toBe(true);
		expect(
			hasAllProjectScope({
				merged_permissions: ['projects:read'],
				field_permissions: { projectScopes: { projects: { update: 'all' } } },
			})
		).toBe(false);
	});
});

describe('commercial and explicit section field permissions', () => {
	it('maps aliases to protected commercial columns', () => {
		const rights = parseCommercialFieldRights({
			modules: {
				projects: {
					sections: {
						commercial: {
							fields: {
								profitability: { permission: 'view' },
								budget: { permission: 'edit' },
								invoice_amount: { permission: 'edit' },
							},
						},
					},
				},
			},
		});

		expect(rights.view).toEqual(['budget', 'profitability_estimate']);
		expect(rights.edit).toEqual(['budget']);
	});

	it('collects explicit readable and editable sections', () => {
		const rights = parseExplicitSectionRights({
			modules: {
				projects: {
					sections: {
						scope: {
							enabled: true,
							fields: {
								scope_of_work: { permission: 'view' },
								additional_scope: { permission: 'edit' },
							},
						},
						commercial: {
							enabled: true,
							fields: { budget: { permission: 'edit' } },
						},
						project_team: {
							enabled: false,
							fields: { project_team: { permission: 'edit' } },
						},
					},
				},
			},
		});

		expect(rights.read).toEqual(['scope']);
		expect(rights.edit).toEqual(['scope']);
	});
});
