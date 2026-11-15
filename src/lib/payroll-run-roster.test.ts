import { describe, expect, it } from 'vitest';
import {
	buildPayrollRunRoster,
	freezePayrollRunMembers,
	loadFrozenPayrollRunRoster,
	loadPayrollRunRoster,
	normalizePayrollRunMonth,
	savePayrollRunRoster,
	type PayrollRunAssignmentRow,
	type PayrollRunEmployeeRow,
	type PayrollRunProfileRow,
	type PayrollRunRoster,
	type PayrollRunRosterDb,
	type PayrollRunRosterInput,
} from './payroll-run-roster';

const MONTH = '2026-10';

function employee(
	overrides: Partial<PayrollRunEmployeeRow> = {}
): PayrollRunEmployeeRow {
	return {
		id: 1,
		employee_id: 'EMP-1',
		name: 'Asha Rao',
		employee_type: 'Payroll',
		status: 'active',
		joining_date: '2026-01-05',
		hire_date: null,
		exit_date: null,
		isDelete: 0,
		...overrides,
	};
}

function profile(
	overrides: Partial<PayrollRunProfileRow> = {}
): PayrollRunProfileRow {
	return {
		id: 10,
		employee_id: 1,
		effective_from: '2026-01-01',
		effective_to: null,
		is_active: 1,
		gross_salary: 30_000,
		salary_type: 'monthly',
		...overrides,
	};
}

function assignment(
	overrides: Partial<PayrollRunAssignmentRow> = {}
): PayrollRunAssignmentRow {
	return {
		employee_id: 1,
		user_employee_id: null,
		daily_entries: JSON.stringify([{ date: '2026-10-04', hours: 8 }]),
		...overrides,
	};
}

function build(
	overrides: Partial<PayrollRunRosterInput> = {}
): PayrollRunRoster {
	return buildPayrollRunRoster({
		month: MONTH,
		employees: [],
		canonical_profiles: [],
		legacy_profiles: [],
		slip_employee_ids: [],
		assignments: [],
		...overrides,
	});
}

function onlyMember(roster: PayrollRunRoster) {
	expect(roster.members).toHaveLength(1);
	return roster.members[0];
}

describe('normalizePayrollRunMonth', () => {
	it('accepts YYYY-MM and YYYY-MM-01 and always returns the first day', () => {
		expect(normalizePayrollRunMonth('2026-10')).toBe('2026-10-01');
		expect(normalizePayrollRunMonth(' 2026-10-01 ')).toBe('2026-10-01');
	});

	it('rejects a day that is not the first of the month', () => {
		expect(() => normalizePayrollRunMonth('2026-10-02')).toThrow();
		expect(() => normalizePayrollRunMonth('2026-13')).toThrow();
		expect(() => normalizePayrollRunMonth('October')).toThrow();
	});
});

describe('month employment eligibility', () => {
	it('excludes a November joiner from October even with a backdated profile', () => {
		const roster = build({
			employees: [employee({ joining_date: '2026-11-03' })],
			canonical_profiles: [profile({ effective_from: '2026-08-01' })],
		});

		expect(roster.month).toBe('2026-10-01');
		expect(roster.members).toEqual([]);
		expect(roster.excluded).toHaveLength(1);
		expect(roster.excluded[0]).toMatchObject({
			employee_id: 1,
			employee_code: 'EMP-1',
			name: 'Asha Rao',
		});
		expect(roster.excluded[0].reason).toContain('2026-11-03');
	});

	it('includes a late-entered October hire at their joining date', () => {
		const member = onlyMember(
			build({
				employees: [employee({ joining_date: '2026-10-20' })],
				canonical_profiles: [profile({ effective_from: '2026-10-01' })],
			})
		);

		expect(member).toMatchObject({
			employment_start: '2026-10-20',
			employment_end: null,
			profile_date: '2026-10-20',
			profile_id: 10,
			issue: null,
		});
	});

	it('falls back to hire_date only when joining_date is missing', () => {
		const fromHire = onlyMember(
			build({
				employees: [
					employee({ joining_date: null, hire_date: '2026-10-12' }),
				],
				canonical_profiles: [profile()],
			})
		);
		expect(fromHire.employment_start).toBe('2026-10-12');
		expect(fromHire.profile_date).toBe('2026-10-12');

		const joiningWins = onlyMember(
			build({
				employees: [
					employee({
						joining_date: '2026-10-05',
						hire_date: '2026-01-01',
					}),
				],
				canonical_profiles: [profile()],
			})
		);
		expect(joiningWins.employment_start).toBe('2026-10-05');
	});

	it('retains an inactive dated leaver employed for part of the month', () => {
		const roster = build({
			employees: [
				employee({
					status: 'inactive',
					joining_date: '2020-01-01',
					exit_date: '2026-10-18',
				}),
			],
			canonical_profiles: [profile()],
		});

		const member = onlyMember(roster);
		expect(roster.excluded).toEqual([]);
		expect(member).toMatchObject({
			employment_start: '2020-01-01',
			employment_end: '2026-10-18',
			issue: null,
		});
	});

	it('excludes a known future hire even when inactive with no exit', () => {
		const roster = build({
			employees: [
				employee({
					status: 'inactive',
					joining_date: '2026-11-03',
					exit_date: null,
				}),
			],
			canonical_profiles: [profile({ effective_from: '2026-08-01' })],
		});

		expect(roster.members).toEqual([]);
		expect(roster.excluded).toHaveLength(1);
		expect(roster.excluded[0].reason).toContain('2026-11-03');
	});

	it('excludes a missing-start leaver whose known exit is before the month', () => {
		const roster = build({
			employees: [
				employee({
					status: 'inactive',
					joining_date: null,
					hire_date: null,
					exit_date: '2026-09-30',
				}),
			],
		});

		expect(roster.members).toEqual([]);
		expect(roster.excluded[0].reason).toContain('2026-09-30');
	});

	it('keeps a missing-start leaver visible when month work contradicts the exit', () => {
		const roster = build({
			employees: [
				employee({
					status: 'inactive',
					joining_date: null,
					hire_date: null,
					exit_date: '2026-09-30',
				}),
			],
			assignments: [assignment()],
		});

		expect(roster.excluded).toEqual([]);
		const member = onlyMember(roster);
		expect(member.issue).toBe('employment_dates_missing');
		expect(member.employment_end).toBe('2026-09-30');
	});

	it('excludes a leaver whose exit is before the month', () => {
		const roster = build({
			employees: [
				employee({
					status: 'inactive',
					joining_date: '2020-01-01',
					exit_date: '2026-09-30',
				}),
			],
			canonical_profiles: [profile()],
		});

		expect(roster.members).toEqual([]);
		expect(roster.excluded[0].reason).toContain('2026-09-30');
	});
});

describe('employment date issues', () => {
	it('names missing employment dates on a plausible payroll candidate', () => {
		const member = onlyMember(
			build({
				employees: [
					employee({ joining_date: null, hire_date: null }),
				],
			})
		);

		expect(member.issue).toBe('employment_dates_missing');
		expect(member.employment_start).toBeNull();
		expect(member.profile_date).toBe('2026-10-01');
	});

	it('names an inverted employment window instead of guessing', () => {
		const member = onlyMember(
			build({
				employees: [
					employee({
						joining_date: '2026-10-20',
						exit_date: '2026-10-01',
					}),
				],
			})
		);

		expect(member.issue).toBe('employment_dates_invalid');
		expect(member.employment_start).toBe('2026-10-20');
		expect(member.employment_end).toBe('2026-10-01');
	});

	it('names an unparseable date rather than treating the person as absent', () => {
		const member = onlyMember(
			build({
				employees: [employee({ joining_date: 'not-a-date' })],
			})
		);

		expect(member.issue).toBe('employment_dates_invalid');
		expect(member.employment_start).toBeNull();
	});

	it('requires review for an inactive employee with no known end', () => {
		const member = onlyMember(
			build({
				employees: [
					employee({
						status: 'inactive',
						joining_date: '2020-01-01',
						exit_date: null,
					}),
				],
				canonical_profiles: [profile()],
			})
		);

		expect(member.issue).toBe('employment_dates_missing');
		expect(member.employment_start).toBe('2020-01-01');
		expect(member.employment_end).toBeNull();
	});
});

describe('Salary Profile selection', () => {
	it('selects the profile in force at a mid-month joining date', () => {
		const member = onlyMember(
			build({
				employees: [employee({ joining_date: '2026-10-15' })],
				canonical_profiles: [
					profile({
						id: 10,
						gross_salary: 20_000,
						effective_from: '2026-09-01',
					}),
					profile({
						id: 11,
						gross_salary: 24_000,
						effective_from: '2026-10-15',
					}),
				],
			})
		);

		expect(member.profile_date).toBe('2026-10-15');
		expect(member.profile_id).toBe(11);
		expect(member.salary_profile?.gross_salary).toBe(24_000);
	});

	it('does not reprice an established employee for a mid-month rate edit', () => {
		const member = onlyMember(
			build({
				employees: [employee({ joining_date: '2025-01-01' })],
				canonical_profiles: [
					profile({
						id: 10,
						gross_salary: 20_000,
						effective_from: '2026-09-01',
						effective_to: '2026-10-14',
					}),
					profile({
						id: 11,
						gross_salary: 24_000,
						effective_from: '2026-10-15',
					}),
				],
			})
		);

		expect(member.profile_date).toBe('2026-10-01');
		expect(member.profile_id).toBe(10);
		expect(member.salary_profile?.gross_salary).toBe(20_000);
	});

	it('selects the canonical profile over a newer legacy row', () => {
		const member = onlyMember(
			build({
				employees: [employee()],
				canonical_profiles: [
					profile({
						id: 10,
						gross_salary: 20_000,
						effective_from: '2026-01-01',
					}),
				],
				legacy_profiles: [
					profile({
						id: 99,
						gross_salary: 90_000,
						effective_from: '2026-09-01',
					}),
				],
			})
		);

		expect(member.profile_source).toBe('employee_salary_profile');
		expect(member.profile_id).toBe(10);
		expect(member.salary_profile?.gross_salary).toBe(20_000);
	});
});

describe('candidate membership', () => {
	it('includes a non-Payroll employee paid through a legacy agreement', () => {
		const member = onlyMember(
			build({
				employees: [
					employee({
						employee_type: 'Permanent',
						joining_date: '2025-04-01',
					}),
				],
				legacy_profiles: [
					profile({
						id: 20,
						gross_salary: 50_000,
						pay_type: 'contract',
						salary_type: null,
						effective_from: '2025-04-01',
					}),
				],
			})
		);

		expect(member.employee_type).toBe('Permanent');
		expect(member.profile_source).toBe('salary_structures');
		expect(member.profile_id).toBe(20);
		expect(member.salary_type).toBe('contract');
		expect(member.salary_profile?.gross_salary).toBe(50_000);
	});

	it('includes a Contract employee with no agreement through the missing-profile gate', () => {
		const member = onlyMember(
			build({
				employees: [
					employee({
						employee_type: 'Contract',
						joining_date: '2026-10-02',
					}),
				],
			})
		);

		expect(member.salary_profile).toBeNull();
		expect(member.profile_source).toBeNull();
		expect(member.profile_id).toBeNull();
		expect(member.issue).toBeNull();
	});

	it('does not invent payroll for a directory record with no claim on the month', () => {
		const roster = build({
			employees: [
				employee({
					employee_type: 'Permanent',
					joining_date: '2025-01-01',
				}),
			],
		});

		expect(roster.members).toEqual([]);
		expect(roster.excluded).toEqual([]);
	});

	it('ignores a soft-deleted employee even when a profile and slip exist', () => {
		const roster = build({
			employees: [employee({ isDelete: 1 })],
			canonical_profiles: [profile()],
			slip_employee_ids: [1],
		});

		expect(roster.members).toEqual([]);
		expect(roster.excluded).toEqual([]);
	});
});

describe('work and slip evidence', () => {
	it('includes a non-Payroll employee with real logged hours', () => {
		const member = onlyMember(
			build({
				employees: [
					employee({
						employee_type: 'Intern',
						joining_date: '2025-01-01',
					}),
				],
				assignments: [assignment()],
			})
		);

		expect(member.issue).toBeNull();
		expect(member.salary_profile).toBeNull();
		expect(member.employment_start).toBe('2025-01-01');
	});

	it('uses the linked account employee id when the assignment has none', () => {
		const member = onlyMember(
			build({
				employees: [
					employee({
						id: 7,
						employee_id: 'EMP-7',
						employee_type: 'Intern',
						joining_date: '2025-01-01',
					}),
				],
				assignments: [
					assignment({ employee_id: null, user_employee_id: 7 }),
				],
			})
		);

		expect(member.employee_id).toBe(7);
	});

	it('names work before the employment start instead of dropping it', () => {
		const member = onlyMember(
			build({
				employees: [employee({ joining_date: '2026-10-20' })],
				canonical_profiles: [profile()],
				assignments: [
					assignment({
						daily_entries: JSON.stringify([
							{ date: '2026-10-03', hours: 8 },
						]),
					}),
				],
			})
		);

		expect(member.issue).toBe('work_outside_employment');
	});

	it('names a slip outside the employment window instead of excluding silently', () => {
		const roster = build({
			employees: [employee({ joining_date: '2026-11-03' })],
			slip_employee_ids: [1],
		});

		expect(roster.excluded).toEqual([]);
		const member = onlyMember(roster);
		expect(member.issue).toBe('work_outside_employment');
	});
});

describe('freezePayrollRunMembers', () => {
	it('freezes identity and provenance but no mutable profile money', () => {
		const roster = build({
			employees: [employee({ joining_date: '2026-10-20' })],
			canonical_profiles: [
				profile({
					id: 11,
					gross_salary: 24_000,
					effective_from: '2026-10-01',
				}),
			],
		});
		const [frozen] = freezePayrollRunMembers(roster);

		expect(Object.keys(frozen).sort()).toEqual(
			[
				'employee_code',
				'employee_id',
				'employment_end',
				'employment_start',
				'name',
				'profile_date',
				'profile_id',
				'profile_source',
				'salary_type',
			].sort()
		);
		expect(frozen).toEqual({
			employee_id: 1,
			employee_code: 'EMP-1',
			name: 'Asha Rao',
			employment_start: '2026-10-20',
			employment_end: null,
			profile_date: '2026-10-20',
			profile_source: 'employee_salary_profile',
			profile_id: 11,
			salary_type: 'monthly',
		});
		expect(JSON.stringify(frozen)).not.toContain('gross');
	});

	it('refuses an unresolved employment issue, naming the person', () => {
		const roster = build({
			employees: [employee({ joining_date: null, hire_date: null })],
		});

		expect(() => freezePayrollRunMembers(roster)).toThrow(
			/Asha Rao \(EMP-1\).*employment issue/s
		);
	});

	it('refuses a candidate with no Salary Profile', () => {
		const roster = build({ employees: [employee()] });

		expect(() => freezePayrollRunMembers(roster)).toThrow(
			/Asha Rao \(EMP-1\).*no Salary Profile/s
		);
	});
});

interface StoredSnapshot {
	runId: number;
	month: string;
	version: number;
	members: string;
	frozenBy: number | null;
	frozenAt: string;
}

function saveDb() {
	const stored: StoredSnapshot[] = [];
	const db: PayrollRunRosterDb = {
		execute: async (sql, params = []) => {
			if (sql.includes('FROM payroll_runs')) {
				return [[{ id: 5, month: 10, year: 2026 }], undefined];
			}
			if (sql.includes('MAX(version)')) {
				const runId = Number(params[0]);
				const versions = stored
					.filter((row) => row.runId === runId)
					.map((row) => row.version);
				return [
					[{ version: versions.length > 0 ? Math.max(...versions) : 0 }],
					undefined,
				];
			}
			if (sql.includes('INSERT INTO payroll_run_rosters')) {
				const [runId, month, version, members, frozenBy] = params;
				stored.push({
					runId: Number(runId),
					month: String(month),
					version: Number(version),
					members: String(members),
					frozenBy:
						frozenBy === null || frozenBy === undefined
							? null
							: Number(frozenBy),
					frozenAt: `2026-11-0${Number(version)} 10:00:00`,
				});
				return [{ affectedRows: 1 }, undefined];
			}
			if (sql.includes('SELECT month, version, frozen_at')) {
				const found = stored.find(
					(row) =>
						row.runId === Number(params[0]) &&
						row.version === Number(params[1])
				);
				return [
					found
						? [
								{
									month: found.month,
									version: found.version,
									frozen_at: found.frozenAt,
								},
							]
						: [],
					undefined,
				];
			}
			throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
		},
	};
	return { db, stored };
}

describe('savePayrollRunRoster', () => {
	it('appends a new immutable version on re-finalization', async () => {
		const { db, stored } = saveDb();
		const roster = build({
			employees: [employee()],
			canonical_profiles: [profile()],
		});

		const first = await savePayrollRunRoster(db, 5, roster, 42);
		const second = await savePayrollRunRoster(db, 5, roster, 43);

		expect(first.version).toBe(1);
		expect(second.version).toBe(2);
		expect(stored).toHaveLength(2);
		expect(stored.map((row) => row.frozenBy)).toEqual([42, 43]);
		expect(JSON.parse(stored[0].members)).toEqual(
			JSON.parse(stored[1].members)
		);
		const frozen = JSON.parse(stored[0].members) as Array<
			Record<string, unknown>
		>;
		expect(frozen[0]).not.toHaveProperty('salary_profile');
		expect(frozen[0]).not.toHaveProperty('gross_salary');
	});

	it('refuses to snapshot a roster with a missing profile before writing', async () => {
		const { db, stored } = saveDb();
		const roster = build({ employees: [employee()] });

		await expect(savePayrollRunRoster(db, 5, roster, 42)).rejects.toThrow(
			/no Salary Profile/
		);
		expect(stored).toEqual([]);
	});
});

interface FrozenDbOptions {
	locked: boolean;
	snapshot?: Record<string, unknown>;
}

function frozenDb(options: FrozenDbOptions) {
	const db: PayrollRunRosterDb = {
		execute: async (sql) => {
			if (sql.includes('FROM payroll_runs')) {
				return [
					options.locked ? [{ id: 5, month: 10, year: 2026 }] : [],
					undefined,
				];
			}
			if (sql.includes('FROM payroll_run_rosters')) {
				return [options.snapshot ? [options.snapshot] : [], undefined];
			}
			throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
		},
	};
	return db;
}

describe('loadFrozenPayrollRunRoster', () => {
	it('returns the latest snapshot of a locked run', async () => {
		const members = freezePayrollRunMembers(
			build({
				employees: [employee()],
				canonical_profiles: [profile()],
			})
		);
		const db = frozenDb({
			locked: true,
			snapshot: {
				month: '2026-10-01',
				version: 2,
				frozen_at: '2026-11-02 10:00:00',
				members: JSON.stringify(members),
			},
		});

		const loaded = await loadFrozenPayrollRunRoster(db, '2026-10');

		expect(loaded).toEqual({
			run_id: 5,
			month: '2026-10-01',
			version: 2,
			frozen_at: '2026-11-02 10:00:00',
			members,
		});
	});

	it('returns null for a draft run even when an older snapshot row exists', async () => {
		const db = frozenDb({
			locked: false,
			snapshot: {
				month: '2026-10-01',
				version: 1,
				frozen_at: null,
				members: '[]',
			},
		});

		await expect(loadFrozenPayrollRunRoster(db, '2026-10')).resolves.toBeNull();
	});

	it('returns null for a locked run that predates snapshots', async () => {
		const db = frozenDb({ locked: true });

		await expect(
			loadFrozenPayrollRunRoster(db, '2026-10')
		).resolves.toBeNull();
	});

	it('rejects a malformed stored roster instead of inventing members', async () => {
		const db = frozenDb({
			locked: true,
			snapshot: {
				month: '2026-10-01',
				version: 1,
				frozen_at: null,
				members: JSON.stringify([{ employee_id: 1 }]),
			},
		});

		await expect(loadFrozenPayrollRunRoster(db, '2026-10')).rejects.toThrow(
			/malformed member/
		);
	});

	it('rejects a snapshot member whose employment dates are inverted', async () => {
		const [frozen] = freezePayrollRunMembers(
			build({
				employees: [
					employee({
						joining_date: '2026-10-05',
						exit_date: '2026-10-20',
					}),
				],
				canonical_profiles: [profile()],
			})
		);
		const db = frozenDb({
			locked: true,
			snapshot: {
				month: '2026-10-01',
				version: 1,
				frozen_at: null,
				members: JSON.stringify([
					{
						...frozen,
						employment_start: '2026-10-20',
						employment_end: '2026-10-05',
					},
				]),
			},
		});

		await expect(loadFrozenPayrollRunRoster(db, '2026-10')).rejects.toThrow(
			/malformed member/
		);
	});

	it('rejects a snapshot that repeats an employee', async () => {
		const [frozen] = freezePayrollRunMembers(
			build({
				employees: [employee()],
				canonical_profiles: [profile()],
			})
		);
		const db = frozenDb({
			locked: true,
			snapshot: {
				month: '2026-10-01',
				version: 1,
				frozen_at: null,
				members: JSON.stringify([frozen, frozen]),
			},
		});

		await expect(loadFrozenPayrollRunRoster(db, '2026-10')).rejects.toThrow(
			/repeats employee/
		);
	});
});

describe('loadPayrollRunRoster', () => {
	it('loads only non-deleted employees and normalises the month', async () => {
		const db: PayrollRunRosterDb = {
			execute: async (sql) => {
				if (sql.includes('FROM employee_salary_profile')) {
					return [[profile({ employee_id: 1 })], undefined];
				}
				if (sql.includes('FROM salary_structures')) return [[], undefined];
				if (sql.includes('FROM payroll_slips')) return [[], undefined];
				if (sql.includes('FROM user_activity_assignments'))
					return [[], undefined];
				if (sql.includes('FROM employees')) {
					return [
						[
							employee({ joining_date: '2026-10-20' }),
							employee({
								id: 2,
								employee_id: 'EMP-2',
								name: 'Deleted Person',
								isDelete: 1,
								joining_date: '2026-10-01',
							}),
						],
						undefined,
					];
				}
				throw new Error(`unexpected SQL: ${sql.slice(0, 80)}`);
			},
		};

		const roster = await loadPayrollRunRoster(db, '2026-10');

		expect(roster.month).toBe('2026-10-01');
		expect(roster.members.map((member) => member.employee_id)).toEqual([1]);
	});
});
