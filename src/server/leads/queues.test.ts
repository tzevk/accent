import { describe, expect, it } from 'vitest';
import {
	buildBaseFilterClause,
	buildDueCondition,
	buildQueueCondition,
	buildQueueCounterSelect,
	parseLeadListQuery,
} from '@/server/leads/queues';
import { LeadWorkflowError } from '@/server/leads/shared';

/**
 * The queue rules of ticket #374.
 *
 * The seam is the shared filter parser and the SQL conditions it produces:
 * both list routes read the query through them, so the rules are proved
 * once here and exercised over real HTTP by the integration harness.
 */
function query(params: Record<string, string>) {
	return parseLeadListQuery(new URLSearchParams(params));
}

describe('parseLeadListQuery', () => {
	it('reads the whole Lead list when no filter is given', () => {
		const parsed = query({});
		expect(parsed.view).toBe('all');
		expect(parsed.due).toBe('any');
		expect(parsed.page).toBe(1);
		expect(parsed.limit).toBe(20);
		expect(parsed.search).toBe('');
		expect(parsed.stage).toBe('');
		expect(parsed.owner).toBe('');
		expect(parsed.city).toBe('');
		expect(parsed.review).toBe('');
	});

	it('reads the queue selection and every filter', () => {
		const parsed = query({
			view: 'my_leads',
			due: 'next_seven_days',
			stage: 'Connected',
			owner: '42',
			search: 'acme',
			city: 'Pune',
			review: '1',
			page: '3',
			limit: '50',
		});
		expect(parsed.view).toBe('my_leads');
		expect(parsed.due).toBe('next_seven_days');
		expect(parsed.stage).toBe('Connected');
		expect(parsed.owner).toBe('42');
		expect(parsed.search).toBe('acme');
		expect(parsed.city).toBe('Pune');
		expect(parsed.review).toBe('1');
		expect(parsed.page).toBe(3);
		expect(parsed.limit).toBe(50);
	});

	it('refuses a queue that is not one of the known views', () => {
		try {
			query({ view: 'mine' });
			throw new Error('the unknown view was accepted');
		} catch (error) {
			expect(error).toBeInstanceOf(LeadWorkflowError);
			expect((error as LeadWorkflowError).code).toBe('view_invalid');
			expect((error as LeadWorkflowError).status).toBe(422);
		}
	});

	it('refuses a due-date filter that is not one of the known windows', () => {
		try {
			query({ due: 'sometime' });
			throw new Error('the unknown due filter was accepted');
		} catch (error) {
			expect(error).toBeInstanceOf(LeadWorkflowError);
			expect((error as LeadWorkflowError).code).toBe('view_invalid');
		}
	});

	it('reads the same query from a plain parameter record', () => {
		const parsed = parseLeadListQuery({ view: 'overdue', due: 'today' });
		expect(parsed.view).toBe('overdue');
		expect(parsed.due).toBe('today');
	});

	it('keeps the page size inside its bounds', () => {
		expect(query({ limit: '0' }).limit).toBe(20);
		expect(query({ limit: '5000' }).limit).toBe(200);
		expect(query({ limit: 'abc' }).limit).toBe(20);
		expect(query({ page: '0' }).page).toBe(1);
		expect(query({ page: '-4' }).page).toBe(1);
	});

	it('reads the owner value all as no owner filter', () => {
		expect(query({ owner: 'all' }).owner).toBe('');
		expect(query({ owner: 'unassigned' }).owner).toBe('unassigned');
	});
});

describe('buildQueueCondition', () => {
	it('selects the Leads of the authenticated owner', () => {
		const { clause, params } = buildQueueCondition('my_leads', 42);
		expect(clause).toContain('l.owner_user_id = ?');
		expect(params).toEqual([42]);
	});

	it('selects the Leads without a resolved owner', () => {
		const { clause, params } = buildQueueCondition('unassigned', 42);
		expect(clause).toContain('l.owner_user_id IS NULL');
		expect(params).toEqual([]);
	});

	it('uses the outstanding scheduled work for Due Today', () => {
		const { clause, params } = buildQueueCondition('due_today', 42);
		expect(clause).toContain("a.status = 'Scheduled'");
		expect(clause).toContain('a.transferred_followup_id IS NULL');
		expect(clause).toContain('a.scheduled_for IS NOT NULL');
		expect(clause).toContain('a.scheduled_for = CURDATE()');
		expect(params).toEqual([]);
	});

	it('reads work dated before today as overdue', () => {
		const { clause } = buildQueueCondition('overdue', 42);
		expect(clause).toContain('a.scheduled_for < CURDATE()');
	});

	it('reads a Lead with no completed outreach as untouched', () => {
		const { clause, params } = buildQueueCondition('untouched', 42);
		expect(clause).toContain('NOT EXISTS');
		expect(clause).toContain("a.status = 'Completed'");
		expect(clause).toContain('a.activity_type IN (?, ?, ?)');
		expect(params).toEqual(['Call', 'Email', 'Meeting']);
	});

	it('reads the active stages without a dated next action', () => {
		const { clause, params } = buildQueueCondition('no_next_action', 42);
		expect(clause).toContain('l.enquiry_status IN (?, ?, ?, ?)');
		expect(params).toEqual([
			'Attempting Contact',
			'Connected',
			'Qualified',
			'Nurture',
		]);
		expect(clause).toContain('a.scheduled_for IS NOT NULL');
	});

	it('matches every Lead for the all view', () => {
		const { clause, params } = buildQueueCondition('all', 42);
		expect(clause).toBe('1 = 1');
		expect(params).toEqual([]);
	});

	it('never attributes My Leads to a guessed user', () => {
		const { clause, params } = buildQueueCondition('my_leads', null);
		expect(clause).toBe('1 = 0');
		expect(params).toEqual([]);
	});
});

describe('buildDueCondition', () => {
	it('does not restrict the list for any due date', () => {
		const { clause, params } = buildDueCondition('any');
		expect(clause).toBe('1 = 1');
		expect(params).toEqual([]);
	});

	it('uses the database calendar day for today', () => {
		const { clause } = buildDueCondition('today');
		expect(clause).toContain('a.scheduled_for = CURDATE()');
	});

	it('reads the work dated before today as overdue', () => {
		const { clause } = buildDueCondition('overdue');
		expect(clause).toContain('a.scheduled_for < CURDATE()');
	});

	it('spans today and the next seven days', () => {
		const { clause } = buildDueCondition('next_seven_days');
		expect(clause).toContain(
			'a.scheduled_for BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)'
		);
	});
});

describe('buildBaseFilterClause', () => {
	it('keeps a Lead with an unknown stage out of the result', () => {
		const { clause } = buildBaseFilterClause(query({ stage: 'Whatever' }));
		expect(clause).toContain('1 = 0');
	});

	it('selects the unresolved stage', () => {
		const { clause, params } = buildBaseFilterClause(
			query({ stage: 'Unresolved' })
		);
		expect(clause).toContain('l.enquiry_status IS NULL');
		expect(params).toEqual([]);
	});

	it('selects one owner and the unassigned intake', () => {
		const one = buildBaseFilterClause(query({ owner: '7' }));
		expect(one.clause).toContain('l.owner_user_id = ?');
		expect(one.params).toEqual([7]);
		const none = buildBaseFilterClause(query({ owner: 'unassigned' }));
		expect(none.clause).toContain('l.owner_user_id IS NULL');
	});

	it('keeps an owner that is not a user out of the result', () => {
		const { clause } = buildBaseFilterClause(query({ owner: 'nobody' }));
		expect(clause).toContain('1 = 0');
	});

	it('applies the due-date window to the same filter', () => {
		const { clause } = buildBaseFilterClause(query({ due: 'today' }));
		expect(clause).toContain('a.scheduled_for = CURDATE()');
	});
});

describe('buildQueueCounterSelect', () => {
	it('counts every queue over the whole dataset', () => {
		const { select, params } = buildQueueCounterSelect(42);
		for (const alias of [
			'queue_all',
			'queue_my_leads',
			'queue_unassigned',
			'queue_due_today',
			'queue_overdue',
			'queue_untouched',
			'queue_no_next_action',
		]) {
			expect(select).toContain(alias);
		}
		expect(params).toEqual([
			42,
			'Call',
			'Email',
			'Meeting',
			'Attempting Contact',
			'Connected',
			'Qualified',
			'Nurture',
		]);
	});

	it('never counts My Leads for a guessed user', () => {
		const { select, params } = buildQueueCounterSelect(null);
		expect(params).toEqual([
			'Call',
			'Email',
			'Meeting',
			'Attempting Contact',
			'Connected',
			'Qualified',
			'Nurture',
		]);
		expect(select).toContain('1 = 0');
	});
});
