import { describe, expect, it } from 'vitest';
import {
	DEFAULT_PROJECT_TEAM_ROLE,
	PROJECT_LEAD_ROLE,
	PROJECT_TEAM_ROLES,
	normalizeProjectTeamRole,
} from './team-roles';

describe('project team role normalization', () => {
	it('maps legacy values to ordinary membership', () => {
		expect(normalizeProjectTeamRole('Project Manager')).toBe(
			DEFAULT_PROJECT_TEAM_ROLE
		);
		expect(normalizeProjectTeamRole('Lead')).toBe(DEFAULT_PROJECT_TEAM_ROLE);
		expect(normalizeProjectTeamRole('Lead Engineer')).toBe(
			DEFAULT_PROJECT_TEAM_ROLE
		);
		expect(normalizeProjectTeamRole('manager')).toBe(DEFAULT_PROJECT_TEAM_ROLE);
	});

	it('round-trips every canonical role', () => {
		for (const role of PROJECT_TEAM_ROLES) {
			expect(normalizeProjectTeamRole(role)).toBe(role);
			expect(normalizeProjectTeamRole(normalizeProjectTeamRole(role))).toBe(
				role
			);
		}
	});

	it('matches canonical roles case-insensitively without gaining lead', () => {
		expect(normalizeProjectTeamRole(' project lead ')).toBe(PROJECT_LEAD_ROLE);
		expect(normalizeProjectTeamRole('PROJECT LEAD')).toBe(PROJECT_LEAD_ROLE);
		expect(normalizeProjectTeamRole('qa/qc')).toBe('QA/QC');
		expect(normalizeProjectTeamRole('site supervisor')).toBe('Site Supervisor');

		for (const legacy of ['Project Manager', 'Team Lead', 'Owner', '']) {
			expect(normalizeProjectTeamRole(legacy)).not.toBe(PROJECT_LEAD_ROLE);
		}
		expect(normalizeProjectTeamRole(undefined)).toBe(DEFAULT_PROJECT_TEAM_ROLE);
		expect(normalizeProjectTeamRole(null)).toBe(DEFAULT_PROJECT_TEAM_ROLE);
		expect(normalizeProjectTeamRole(42)).toBe(DEFAULT_PROJECT_TEAM_ROLE);
	});

	it('is idempotent', () => {
		for (const value of [
			'Project Manager',
			'project lead',
			'Engineer',
			'unknown value',
		]) {
			const once = normalizeProjectTeamRole(value);
			expect(normalizeProjectTeamRole(once)).toBe(once);
		}
	});
});
