import { describe, expect, it } from 'vitest';
import { stripDisabledModules } from './api-permissions';

describe('stripDisabledModules', () => {
	it('preserves projectScopes when every module is disabled', () => {
		const fieldPermissions = {
			modules: {
				projects: { enabled: false, crud: {} },
			},
			projectScopes: { projects: { read: 'all' } },
		};

		expect(stripDisabledModules(fieldPermissions)).toEqual({
			modules: {},
			projectScopes: { projects: { read: 'all' } },
		});
	});

	it('keeps enabled modules and sibling keys together', () => {
		const fieldPermissions = {
			modules: {
				projects: { enabled: true, crud: { read: true } },
				leads: { enabled: false },
			},
			projectScopes: { projects: { update: 'led' } },
			extra: 'kept',
		};

		const stripped = stripDisabledModules(fieldPermissions);

		expect(stripped.modules).toEqual({
			projects: { enabled: true, crud: { read: true } },
		});
		expect(stripped.projectScopes).toEqual({
			projects: { update: 'led' },
		});
		expect(stripped.extra).toBe('kept');
	});

	it('returns the value unchanged when there is no modules tree', () => {
		expect(stripDisabledModules({ projectScopes: {} })).toEqual({
			projectScopes: {},
		});
	});
});
