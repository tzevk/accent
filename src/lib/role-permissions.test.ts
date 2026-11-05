import { describe, expect, it } from 'vitest';
import {
	getRolePermissionGroups,
	parseRolePermissions,
	rolePermissionKey,
	serializeRolePermissions,
	toggleRolePermission,
} from './role-permissions';

describe('parseRolePermissions', () => {
	it('parses arrays, JSON strings, and legacy comma lists', () => {
		expect(parseRolePermissions(['projects:read', 'leads:read'])).toEqual([
			'leads:read',
			'projects:read',
		]);
		expect(parseRolePermissions('["projects:read","leads:read"]')).toEqual([
			'leads:read',
			'projects:read',
		]);
		expect(parseRolePermissions('projects:read, leads:read')).toEqual([
			'leads:read',
			'projects:read',
		]);
	});

	it('deduplicates and ignores malformed entries', () => {
		expect(
			parseRolePermissions(['leads:read', null, 42, 'leads:read', ' '])
		).toEqual(['leads:read']);
		expect(parseRolePermissions(null)).toEqual([]);
		expect(parseRolePermissions('{bad json')).toEqual([]);
	});
});

describe('getRolePermissionGroups', () => {
	it('shows granted role permissions on the right resource and action', () => {
		const groups = getRolePermissionGroups([
			'leads:read',
			'leads:convert',
			'projects:reopen',
		]);
		const leads = groups.find((group) => group.resource === 'leads');
		const projects = groups.find((group) => group.resource === 'projects');

		expect(
			leads?.actions.find((action) => action.key === 'leads:read')
		).toMatchObject({
			granted: true,
			label: 'View',
		});
		expect(
			leads?.actions.find((action) => action.key === 'leads:convert')
		).toMatchObject({ granted: true, label: 'Convert' });
		expect(
			projects?.actions.find((action) => action.key === 'projects:reopen')
		).toMatchObject({ granted: true, label: 'Reopen' });
		expect(
			projects?.actions.find((action) => action.key === 'projects:read')
		).toMatchObject({ granted: false });
	});

	it('keeps an unknown stored resource/action visible and removable', () => {
		const groups = getRolePermissionGroups(['legacy_module:special']);
		const legacy = groups.find((group) => group.resource === 'legacy_module');

		expect(legacy?.actions).toEqual([
			{
				key: 'legacy_module:special',
				label: 'Special',
				description: 'Special Legacy Module',
				granted: true,
			},
		]);
	});
});

describe('toggleRolePermission', () => {
	it('adds and removes one key without touching the rest', () => {
		expect(
			toggleRolePermission(
				['projects:read'],
				rolePermissionKey('leads', 'read')
			)
		).toEqual(['leads:read', 'projects:read']);
		expect(
			toggleRolePermission(
				['leads:read', 'projects:read'],
				rolePermissionKey('leads', 'read')
			)
		).toEqual(['projects:read']);
	});

	it('serializes sorted unique keys', () => {
		expect(
			serializeRolePermissions(['projects:read', 'leads:read', 'projects:read'])
		).toEqual(['leads:read', 'projects:read']);
	});
});
