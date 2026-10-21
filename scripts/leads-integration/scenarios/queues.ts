import { strict as assert } from 'node:assert';
import { z } from 'zod';
import type { ScenarioContext } from '../client.ts';

/**
 * The legacy Lead records the queue scenarios work on: a Lead in an active
 * stage without a dated next action, a Lead whose owner name could not be
 * resolved, a Lead with a preserved dated next action, and a Lead whose
 * stage could not be resolved.
 */
export interface QueueSeeds {
	activeStageWithoutNextActionLeadId: number;
	unresolvedOwnerLeadId: number;
	unresolvedStageLeadId: number;
	scheduledLegacyLeadId: number;
}

const EnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

const ErrorEnvelopeSchema = z.object({
	success: z.literal(false),
	error: z.string(),
	code: z.string().optional(),
});

const ListRowSchema = z
	.object({
		id: z.number(),
		company_name: z.string(),
		owner_user_id: z.number().nullable(),
		owner_name: z.string().nullable(),
		enquiry_status: z.string().nullable(),
		legacy_review_required: z.boolean(),
		next_action_date: z.string().nullable().optional(),
		canonical_proposal_id: z.number().nullable().optional(),
	})
	.passthrough();

const ListEnvelopeSchema = z.object({
	success: z.literal(true),
	data: z.object({
		leads: z.array(ListRowSchema),
		stats: z
			.object({
				total_leads: z.number(),
				unassigned_leads: z.number(),
				needs_review_leads: z.number(),
				queue_all: z.number(),
				queue_my_leads: z.number(),
				queue_unassigned: z.number(),
				queue_due_today: z.number(),
				queue_overdue: z.number(),
				queue_untouched: z.number(),
				queue_no_next_action: z.number(),
			})
			.passthrough(),
		pagination: z.object({
			page: z.number(),
			limit: z.number(),
			total: z.number(),
			totalPages: z.number(),
		}),
	}),
});

type ListResult = z.infer<typeof ListEnvelopeSchema>['data'];

/**
 * The fixture users the scenarios act as. The application rate-limits every
 * API call per session token, so the scenarios spread their calls over the
 * fixture users instead of spending one user's budget. The `creator` session
 * is only used where the authenticated identity is the point of the check.
 */
type Actor = 'creator' | 'assignee' | 'editor' | 'reader' | 'proposer';

function actorSession(context: ScenarioContext, actor: Actor): string {
	if (actor === 'creator') return context.creator.sessionToken;
	if (actor === 'assignee') return context.assignee.sessionToken;
	if (actor === 'editor') return context.noAssign.sessionToken;
	if (actor === 'proposer') return context.proposer.sessionToken;
	return context.readOnly.sessionToken;
}

interface LeadOptions {
	actor?: Actor;
	owner?: 'none' | number;
}

/** A calendar day shifted from the database day, without a time zone. */
function shiftDate(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	const stamp = Date.UTC(year, month - 1, day) + days * 86_400_000;
	const shifted = new Date(stamp);
	const pad = (value: number): string => String(value).padStart(2, '0');
	return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
		shifted.getUTCDate()
	)}`;
}

async function createLead(
	context: ScenarioContext,
	companyName: string,
	options: LeadOptions = {}
): Promise<number> {
	const actor = options.actor ?? 'editor';
	const body: Record<string, unknown> = {
		company_name: companyName,
		contact_name: 'Queue Contact',
		contact_email: `${companyName.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.com`,
		project_description: `${companyName} need`,
	};
	if (options.owner === 'none') body.owner_user_id = null;
	else if (typeof options.owner === 'number')
		body.owner_user_id = options.owner;
	const response = await context.http.post(
		'/api/leads',
		body,
		actorSession(context, actor)
	);
	assert.equal(response.status, 200, `create status (body: ${response.text})`);
	const id = z
		.object({ id: z.number() })
		.parse(EnvelopeSchema.parse(response.json()).data).id;
	context.trackLead(id);
	return id;
}

async function scheduleTask(
	context: ScenarioContext,
	leadId: number,
	scheduledFor: string,
	activityType: 'Note' | 'Email' = 'Note',
	actor: Actor = 'editor'
): Promise<number> {
	const response = await context.http.post(
		`/api/leads/${leadId}/tasks`,
		{
			activity_type: activityType,
			scheduled_for: scheduledFor,
			next_action: 'Queued follow-up',
		},
		actorSession(context, actor)
	);
	assert.equal(response.status, 200, `task status (body: ${response.text})`);
	return z
		.object({ task_id: z.number() })
		.parse(EnvelopeSchema.parse(response.json()).data).task_id;
}

async function closeTask(
	context: ScenarioContext,
	leadId: number,
	taskId: number,
	status: 'Completed' | 'Cancelled',
	replacementDate?: string,
	actor: Actor = 'editor'
): Promise<void> {
	const body: Record<string, unknown> = { status };
	if (replacementDate) {
		// Closing the last outstanding work of an active Lead needs its
		// replacement in the same request.
		body.next_action = {
			scheduled_for: replacementDate,
			next_action: 'Send the quotation',
		};
	}
	const response = await context.http.patch(
		`/api/leads/${leadId}/tasks/${taskId}`,
		body,
		actorSession(context, actor)
	);
	assert.equal(response.status, 200, `close status (body: ${response.text})`);
}

/** A completed note: work that happened, but no outreach. */
async function logNote(
	context: ScenarioContext,
	leadId: number
): Promise<void> {
	const response = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{ activity_type: 'Note', notes: 'Left a message with the contact.' },
		actorSession(context, 'editor')
	);
	assert.equal(response.status, 200, `note status (body: ${response.text})`);
}

/** A connected call: outreach, with the dated next action it needs. */
async function logConnectedCall(
	context: ScenarioContext,
	leadId: number,
	scheduledFor: string
): Promise<void> {
	const response = await context.http.post(
		`/api/leads/${leadId}/activities`,
		{
			activity_type: 'Call',
			call_outcome: 'Connected',
			notes: 'Spoke to the contact.',
			next_action: {
				scheduled_for: scheduledFor,
				next_action: 'Send the proposal',
			},
		},
		actorSession(context, 'editor')
	);
	assert.equal(response.status, 200, `call status (body: ${response.text})`);
}

async function listLeads(
	context: ScenarioContext,
	query: string,
	actor: Actor = 'reader'
): Promise<ListResult> {
	const response = await context.http.get(
		`/api/leads/list?${query}`,
		actorSession(context, actor)
	);
	assert.equal(response.status, 200, `list status (body: ${response.text})`);
	return ListEnvelopeSchema.parse(response.json()).data;
}

function ids(rows: ListResult['leads']): number[] {
	return rows.map((row) => row.id).sort((left, right) => left - right);
}

/**
 * My Leads belongs to the authenticated user: the queue of one person never
 * shows the Leads of another, and a client-supplied owner id never selects
 * another person's queue.
 */
export async function myLeadsQueueScenario(
	context: ScenarioContext
): Promise<void> {
	const marker = `${context.runTag} queue-my-leads`;
	// The Leads of the creator are created by a permitted colleague, so the
	// session budget of the creator stays free for the queue reads.
	const creatorLead = await createLead(context, `${marker} One Co`, {
		actor: 'assignee',
		owner: context.creator.id,
	});
	const secondCreatorLead = await createLead(context, `${marker} Two Co`, {
		actor: 'assignee',
		owner: context.creator.id,
	});
	const assigneeLead = await createLead(context, `${marker} Assignee Co`, {
		actor: 'assignee',
	});
	const search = `search=${encodeURIComponent(marker)}&limit=100`;

	const asCreator = await listLeads(
		context,
		`view=my_leads&${search}`,
		'creator'
	);
	assert.deepEqual(
		ids(asCreator.leads),
		[creatorLead, secondCreatorLead].sort((left, right) => left - right),
		'My Leads shows the Leads the authenticated user owns'
	);
	assert.ok(
		asCreator.leads.every((row) => row.owner_user_id === context.creator.id)
	);

	const asAssignee = await listLeads(
		context,
		`view=my_leads&${search}`,
		'assignee'
	);
	assert.deepEqual(
		ids(asAssignee.leads),
		[assigneeLead],
		'My Leads shows the other owner their own Leads'
	);

	const borrowedQueue = await listLeads(
		context,
		`view=my_leads&owner=${context.assignee.id}&${search}`,
		'creator'
	);
	assert.equal(
		borrowedQueue.leads.length,
		0,
		'a client-supplied owner id never selects another person’s queue'
	);
	assert.equal(borrowedQueue.pagination.total, 0);

	const counts = await context.reader.queueCounts(marker, context.creator.id);
	assert.equal(counts.total, 3, 'the database holds the three fixture Leads');
	assert.equal(counts.my_leads, 2, 'the database counts My Leads');
	assert.equal(
		asCreator.stats.queue_my_leads,
		counts.my_leads,
		'the counter matches the database'
	);
}

/**
 * Unassigned holds the Leads without a resolved owner, including the legacy
 * records whose owner name could not be resolved. Nothing is attributed to
 * a guessed user.
 */
export async function unassignedQueueScenario(
	context: ScenarioContext,
	seeds: QueueSeeds
): Promise<void> {
	const marker = `${context.runTag} queue-unassigned`;
	const unassigned = await createLead(context, `${marker} Intake Co`, {
		actor: 'assignee',
		owner: 'none',
	});
	const owned = await createLead(context, `${marker} Owned Co`);
	const search = `search=${encodeURIComponent(marker)}&limit=100`;

	const queue = await listLeads(context, `view=unassigned&${search}`);
	assert.deepEqual(
		ids(queue.leads),
		[unassigned],
		'the unassigned queue holds the Lead without an owner'
	);
	assert.equal(queue.leads[0].owner_user_id, null);

	const whole = await listLeads(context, 'view=unassigned&limit=200');
	assert.ok(
		whole.leads.some((row) => row.id === seeds.unresolvedOwnerLeadId),
		'the legacy Lead whose owner name could not be resolved is unassigned'
	);
	assert.ok(
		!whole.leads.some((row) => row.id === owned),
		'an owned Lead never appears in the unassigned queue'
	);
	assert.ok(
		whole.leads.every((row) => row.owner_user_id === null),
		'no Lead of the unassigned queue has an owner'
	);
}

/**
 * Due Today and Overdue read the outstanding scheduled work of the Lead.
 * Completed and cancelled work is not outstanding, and the date boundaries
 * are the calendar days around today.
 */
export async function dueQueueScenario(
	context: ScenarioContext
): Promise<void> {
	const marker = `${context.runTag} queue-due`;
	const today = await context.reader.databaseToday();
	assert.ok(today, 'the database reports its calendar day');
	const yesterday = shiftDate(today, -1);
	const tomorrow = shiftDate(today, 1);

	const dueTodayLead = await createLead(context, `${marker} Today Co`);
	await scheduleTask(context, dueTodayLead, today);
	const overdueLead = await createLead(context, `${marker} Overdue Co`);
	await scheduleTask(context, overdueLead, yesterday);
	const tomorrowLead = await createLead(context, `${marker} Tomorrow Co`);
	await scheduleTask(context, tomorrowLead, tomorrow);
	const completedLead = await createLead(context, `${marker} Completed Co`);
	// An email task: the only kind a task can be completed with, because a
	// stored reply answer of "no" belongs to an email and to nothing else.
	const completedTask = await scheduleTask(
		context,
		completedLead,
		today,
		'Email'
	);
	await closeTask(
		context,
		completedLead,
		completedTask,
		'Completed',
		shiftDate(today, 10)
	);
	const cancelledLead = await createLead(context, `${marker} Cancelled Co`);
	const cancelledTask = await scheduleTask(context, cancelledLead, today);
	await closeTask(context, cancelledLead, cancelledTask, 'Cancelled');
	const search = `search=${encodeURIComponent(marker)}&limit=100`;

	const dueToday = await listLeads(context, `view=due_today&${search}`);
	assert.deepEqual(
		ids(dueToday.leads),
		[dueTodayLead],
		'Due Today holds the Lead with outstanding work dated today'
	);
	const overdue = await listLeads(context, `view=overdue&${search}`);
	assert.deepEqual(
		ids(overdue.leads),
		[overdueLead],
		'Overdue holds the Lead with outstanding work dated before today'
	);
	const every = await listLeads(context, `view=all&${search}`);
	assert.equal(every.leads.length, 5, 'every fixture Lead is in the list');
	assert.deepEqual(
		ids(every.leads),
		[
			dueTodayLead,
			overdueLead,
			tomorrowLead,
			completedLead,
			cancelledLead,
		].sort((left, right) => left - right),
		'the Lead with the completed work and the Lead with the cancelled work stay in the Lead list'
	);

	const week = await listLeads(context, `due=next_seven_days&${search}`);
	assert.deepEqual(
		ids(week.leads),
		[dueTodayLead, tomorrowLead].sort((left, right) => left - right),
		'the next seven days hold today and tomorrow'
	);

	const counts = await context.reader.queueCounts(marker, context.noAssign.id);
	assert.equal(counts.due_today, 1, 'the database counts one Lead due today');
	assert.equal(counts.overdue, 1, 'the database counts one overdue Lead');
	assert.equal(
		dueToday.stats.queue_due_today,
		counts.due_today,
		'the Due Today counter matches the database'
	);
	assert.equal(
		overdue.stats.queue_overdue,
		counts.overdue,
		'the Overdue counter matches the database'
	);
}

/**
 * Untouched means no completed outreach: a note is not outreach, a
 * connected call is.
 */
export async function untouchedQueueScenario(
	context: ScenarioContext
): Promise<void> {
	const marker = `${context.runTag} queue-untouched`;
	const today = await context.reader.databaseToday();
	const noteLead = await createLead(context, `${marker} Note Co`);
	await logNote(context, noteLead);
	const callLead = await createLead(context, `${marker} Call Co`);
	await logConnectedCall(context, callLead, shiftDate(today, 5));
	const search = `search=${encodeURIComponent(marker)}&limit=100`;

	const queue = await listLeads(context, `view=untouched&${search}`);
	assert.deepEqual(
		ids(queue.leads),
		[noteLead],
		'a Lead with only a note is untouched'
	);

	const counts = await context.reader.queueCounts(marker, context.noAssign.id);
	assert.equal(counts.untouched, 1, 'the database counts one untouched Lead');
	assert.equal(
		queue.stats.queue_untouched,
		counts.untouched,
		'the Untouched counter matches the database'
	);
}

/**
 * No Next Action holds the Leads in an active stage without a dated next
 * action, including the preserved legacy exceptions. A new Lead needs no
 * next action.
 */
export async function noNextActionQueueScenario(
	context: ScenarioContext,
	seeds: QueueSeeds
): Promise<void> {
	const marker = `${context.runTag} queue-no-next-action`;
	const newLead = await createLead(context, `${marker} New Co`);

	const queue = await listLeads(context, 'view=no_next_action&limit=200');
	assert.ok(
		queue.leads.some(
			(row) => row.id === seeds.activeStageWithoutNextActionLeadId
		),
		'the legacy Lead in an active stage without a dated next action is in the queue'
	);
	assert.ok(
		!queue.leads.some((row) => row.id === seeds.scheduledLegacyLeadId),
		'the legacy Lead with a preserved dated next action is not in the queue'
	);
	assert.ok(
		!queue.leads.some((row) => row.id === newLead),
		'a new Lead needs no dated next action'
	);

	const counts = await context.reader.queueCounts('', context.noAssign.id);
	assert.equal(
		queue.stats.queue_no_next_action,
		counts.no_next_action,
		'the No Next Action counter matches the database'
	);
}

/**
 * The counters cover the whole filtered dataset, not the visible page.
 */
export async function queueCountersScenario(
	context: ScenarioContext
): Promise<void> {
	const marker = `${context.runTag} queue-counters`;
	const first = await createLead(context, `${marker} One Co`);
	const second = await createLead(context, `${marker} Two Co`);
	const third = await createLead(context, `${marker} Three Co`);
	const search = `search=${encodeURIComponent(marker)}`;

	const pageOne = await listLeads(
		context,
		`${search}&limit=1&page=1`,
		'proposer'
	);
	assert.equal(pageOne.leads.length, 1, 'the page holds one row');
	assert.equal(pageOne.pagination.total, 3, 'the total counts every row');
	assert.equal(
		pageOne.stats.total_leads,
		3,
		'the counter covers the whole dataset, not the page'
	);

	const pageTwo = await listLeads(
		context,
		`${search}&limit=1&page=2`,
		'proposer'
	);
	assert.equal(pageTwo.leads.length, 1, 'the second page holds one row');
	assert.notEqual(
		pageTwo.leads[0].id,
		pageOne.leads[0].id,
		'the second page shows another row'
	);
	assert.equal(
		pageTwo.stats.total_leads,
		3,
		'the counter is the same on every page'
	);
	assert.equal(pageTwo.pagination.total, 3);

	const pageThree = await listLeads(
		context,
		`${search}&limit=1&page=3`,
		'proposer'
	);
	assert.equal(pageThree.leads.length, 1, 'the third page holds one row');
	assert.deepEqual(
		[pageOne.leads[0].id, pageTwo.leads[0].id, pageThree.leads[0].id].sort(
			(left, right) => left - right
		),
		[first, second, third].sort((left, right) => left - right),
		'every page holds another Lead of the dataset'
	);

	const counts = await context.reader.queueCounts(marker, context.readOnly.id);
	assert.equal(pageOne.stats.queue_all, counts.total);
	assert.equal(pageOne.stats.queue_my_leads, counts.my_leads);
	assert.equal(pageOne.stats.queue_unassigned, counts.unassigned);
	assert.equal(pageOne.stats.queue_due_today, counts.due_today);
	assert.equal(pageOne.stats.queue_overdue, counts.overdue);
	assert.equal(pageOne.stats.queue_untouched, counts.untouched);
	assert.equal(pageOne.stats.queue_no_next_action, counts.no_next_action);

	// A read-only user sees the same rows and the same counters: the totals
	// never reach further than the rows.
	const asReader = await listLeads(context, `${search}&limit=1&page=1`);
	assert.deepEqual(
		ids(asReader.leads),
		ids(pageOne.leads),
		'the read-only user sees the same rows'
	);
	assert.equal(
		asReader.stats.queue_all,
		pageOne.stats.queue_all,
		'the read-only user sees the same counters'
	);
}

/**
 * An empty queue is an empty list, not an error.
 */
export async function emptyQueueScenario(
	context: ScenarioContext
): Promise<void> {
	const marker = `${context.runTag} queue-empty`;
	await createLead(context, `${marker} Co`);
	const search = `search=${encodeURIComponent(marker)}&limit=100`;

	const queue = await listLeads(context, `view=due_today&${search}`);
	assert.equal(queue.leads.length, 0, 'the queue is empty');
	assert.equal(queue.pagination.total, 0, 'the total is zero');
	assert.equal(queue.stats.total_leads, 0, 'the counter of the queue is zero');
	assert.equal(
		queue.stats.queue_all,
		1,
		'the dataset behind the filter is not empty'
	);
}

/**
 * The owner, stage, and due-date filters, and the one parser both list
 * routes read.
 */
export async function queueFiltersScenario(
	context: ScenarioContext
): Promise<void> {
	const marker = `${context.runTag} queue-filters`;
	const newLead = await createLead(context, `${marker} New Co`);
	const connectedLead = await createLead(context, `${marker} Connected Co`);
	await logConnectedCall(
		context,
		connectedLead,
		shiftDate(await context.reader.databaseToday(), 3)
	);
	const unassignedLead = await createLead(context, `${marker} Unassigned Co`, {
		actor: 'assignee',
		owner: 'none',
	});
	const search = `search=${encodeURIComponent(marker)}&limit=100`;

	const connected = await listLeads(
		context,
		`stage=Connected&${search}`,
		'proposer'
	);
	assert.deepEqual(
		ids(connected.leads),
		[connectedLead],
		'the stage filter selects the connected Lead'
	);
	const fresh = await listLeads(context, `stage=New&${search}`, 'proposer');
	assert.deepEqual(
		ids(fresh.leads),
		[newLead, unassignedLead].sort((left, right) => left - right),
		'the stage filter selects the new Leads'
	);
	const unresolved = await listLeads(
		context,
		`stage=Unresolved&${search}`,
		'proposer'
	);
	assert.equal(
		unresolved.leads.length,
		0,
		'no fixture Lead has an unresolved stage'
	);
	const unassigned = await listLeads(
		context,
		`owner=unassigned&${search}`,
		'proposer'
	);
	assert.deepEqual(
		ids(unassigned.leads),
		[unassignedLead],
		'the owner filter selects the unassigned Lead'
	);

	const routeRows: number[][] = [];
	const routeCounters: number[] = [];
	for (const path of ['/api/leads', '/api/leads/list']) {
		const response = await context.http.get(
			`${path}?view=untouched&${search}`,
			actorSession(context, 'proposer')
		);
		assert.equal(
			response.status,
			200,
			`${path} status (body: ${response.text})`
		);
		const body = ListEnvelopeSchema.parse(response.json()).data;
		routeRows.push(ids(body.leads));
		routeCounters.push(body.stats.queue_untouched);
	}
	assert.deepEqual(
		routeRows[0],
		routeRows[1],
		'both list routes read the same query'
	);
	assert.equal(
		routeCounters[0],
		routeCounters[1],
		'both list routes count the same queue'
	);

	const refused = await context.http.get(
		'/api/leads/list?view=mine',
		actorSession(context, 'proposer')
	);
	assert.equal(refused.status, 422, 'an unknown view is refused');
	assert.equal(
		ErrorEnvelopeSchema.parse(refused.json()).code,
		'view_invalid',
		'the refusal carries the view code'
	);
}

/**
 * A deleted Lead leaves the rows and the totals: a deleted record never
 * leaks through the counters.
 */
export async function deletedLeadsLeaveTheQueueScenario(
	context: ScenarioContext
): Promise<void> {
	const marker = `${context.runTag} queue-deleted`;
	const leadId = await createLead(context, `${marker} Co`);
	const search = `search=${encodeURIComponent(marker)}&limit=100`;

	const before = await listLeads(context, search);
	assert.equal(before.pagination.total, 1, 'the Lead is in the list');
	assert.equal(before.stats.queue_all, 1, 'the Lead is in the counters');

	const deleted = await context.http.delete(
		`/api/leads/${leadId}`,
		actorSession(context, 'assignee')
	);
	assert.equal(deleted.status, 200, `delete status (body: ${deleted.text})`);
	assert.equal((await context.reader.leadRow(leadId))?.isDelete, 1);

	const after = await listLeads(context, search);
	assert.equal(after.leads.length, 0, 'the deleted Lead is gone');
	assert.equal(after.pagination.total, 0, 'the total dropped the deleted Lead');
	assert.equal(after.stats.total_leads, 0, 'the counter dropped it too');
	assert.equal(after.stats.queue_all, 0, 'the queue counter dropped it too');
	assert.equal(
		await context.reader.countActiveLeads(marker),
		0,
		'the database holds no active Lead for the search'
	);
}
