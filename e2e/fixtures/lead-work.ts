/**
 * Disposable fixtures for the two Lead-work browser journeys.
 *
 * Journey 1: an ordinary identity with exactly `leads:read` and
 * `leads:create` creates a Lead through the real `/leads/new` form. The
 * fixture contributes only the identity and the authored expected values; the
 * Lead exists because the browser saved it, and cleanup finds it by its
 * namespaced company name.
 *
 * Journey 2: an ordinary identity with exactly `leads:read` and
 * `leads:update` starts from a Lead already owned by that identity in the New
 * stage. The browser records one connected call and its dated next action in
 * the same form; cleanup removes the activity, stage-history, and ownership
 * rows the lead owns.
 *
 * Both identities are namespaced, never administrators, and share no role row
 * with another worker. Expected values are authored here, independent of the
 * workspace UI. Dates are calendar dates without a time zone.
 */
import type {
	Connection,
	ResultSetHeader,
	RowDataPacket,
} from 'mysql2/promise';
import { createJourneyUser } from './journey-user.ts';

export const LEAD_CREATION_PERMISSIONS = [
	'leads:read',
	'leads:create',
] as const;

export const LEAD_WORK_PERMISSIONS = ['leads:read', 'leads:update'] as const;

const MONTH_LABELS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
] as const;

export interface LeadCreationFixture {
	/** The creator and therefore the expected owner of the saved Lead. */
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	companyName: string;
	contactName: string;
	contactEmail: string;
	inquiryEmail: string;
	phone: string;
	designation: string;
	city: string;
	projectDescription: string;
	enquiryType: string;
	leadSource: string;
	priority: string;
	notes: string;
	enquiryDate: string;
	/** Remove the Lead the browser created, then the identity. */
	dispose(): Promise<void>;
}

export interface CreatedLeadState {
	id: number;
	leadId: string | null;
	companyName: string;
	contactName: string | null;
	contactEmail: string | null;
	inquiryEmail: string | null;
	phone: string | null;
	designation: string | null;
	city: string | null;
	projectDescription: string | null;
	enquiryType: string | null;
	enquiryStatus: string | null;
	leadSource: string | null;
	priority: string | null;
	notes: string | null;
	enquiryDate: string | null;
	followUpDate: string | null;
	ownerUserId: number | null;
	isDelete: number;
}

export interface LeadWorkFixture {
	/** The owner of the seeded Lead and the actor of the recorded call. */
	userId: number;
	username: string;
	/** Ephemeral per-run password. Never log or persist it. */
	password: string;
	leadId: number;
	companyName: string;
	callOutcome: 'Connected';
	notes: string;
	nextActionText: string;
	scheduledFor: string;
	/**
	 * The date as the Lead timeline writes a calendar date: no leading zero
	 * on the day, three-letter month. Independent of the browser locale.
	 */
	scheduledLabel: string;
	/** Remove the seeded Lead rows, then the identity. */
	dispose(): Promise<void>;
}

export interface LeadWorkLeadState {
	id: number;
	companyName: string;
	enquiryStatus: string | null;
	ownerUserId: number | null;
	followUpDate: string | null;
	isDelete: number;
}

export interface LeadWorkActivityState {
	id: number;
	activityType: string | null;
	status: string;
	callOutcome: string | null;
	replyConfirmed: boolean | null;
	scheduledFor: string | null;
	occurredAt: string | null;
	completedAt: string | null;
	nextAction: string | null;
	notes: string | null;
	createdBy: number | null;
	isDelete: number;
}

export interface LeadWorkStageHistoryState {
	id: number;
	fromStage: string | null;
	toStage: string;
	changeSource: string;
	reason: string | null;
	actorUserId: number | null;
}

export interface LeadWorkState {
	lead: LeadWorkLeadState | null;
	activities: LeadWorkActivityState[];
	stageHistory: LeadWorkStageHistoryState[];
}

interface LeadIdRow extends RowDataPacket {
	id: number | string;
}

interface CreatedLeadRow extends RowDataPacket {
	id: number | string;
	lead_id: string | null;
	company_name: string | null;
	contact_name: string | null;
	contact_email: string | null;
	inquiry_email: string | null;
	phone: string | null;
	designation: string | null;
	city: string | null;
	project_description: string | null;
	enquiry_type: string | null;
	enquiry_status: string | null;
	lead_source: string | null;
	priority: string | null;
	notes: string | null;
	enquiry_date: string | null;
	follow_up_date: string | null;
	owner_user_id: number | string | null;
	isDelete: number | string | null;
}

interface LeadWorkLeadRow extends RowDataPacket {
	id: number | string;
	company_name: string | null;
	enquiry_status: string | null;
	owner_user_id: number | string | null;
	follow_up_date: string | null;
	isDelete: number | string | null;
}

interface LeadWorkActivityRow extends RowDataPacket {
	id: number | string;
	activity_type: string | null;
	status: string | null;
	call_outcome: string | null;
	reply_confirmed: number | string | null;
	scheduled_for: string | null;
	occurred_at: string | null;
	completed_at: string | null;
	next_action: string | null;
	notes: string | null;
	created_by: number | string | null;
	isDelete: number | string | null;
}

interface LeadWorkStageHistoryRow extends RowDataPacket {
	id: number | string;
	from_stage: string | null;
	to_stage: string | null;
	change_source: string | null;
	reason: string | null;
	actor_user_id: number | string | null;
}

/** A local calendar date, `YYYY-MM-DD`. */
function toCalendarDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${month}-${day}`;
}

function calendarDateFromToday(daysAhead: number): string {
	const date = new Date();
	date.setDate(date.getDate() + daysAhead);
	return toCalendarDate(date);
}

/** Mirror of the timeline's calendar-date wording, authored by the test. */
function timelineCalendarLabel(value: string): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) {
		throw new Error(`[lead-work] expected a calendar date, got ${value}`);
	}
	const month = MONTH_LABELS[Number(match[2]) - 1] ?? match[2];
	return `${Number(match[3])} ${month} ${match[1]}`;
}

function nullableText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	const text = String(value).trim();
	return text === '' ? null : text;
}

function nullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

/**
 * Seed the creating identity. Nothing is written to `leads`: the creator's
 * browser action is the only thing that inserts the row under test.
 */
export async function seedLeadCreationFixture(
	db: Connection,
	namespace: string
): Promise<LeadCreationFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-lead-create`,
		LEAD_CREATION_PERMISSIONS
	);

	const companyName = `${namespace} Created Lead Co`;
	return {
		userId: identity.userId,
		username: identity.username,
		password: identity.password,
		companyName,
		contactName: 'Meera Kapoor',
		contactEmail: `${namespace}-meera@example.com`,
		inquiryEmail: `${namespace}-inquiry@example.com`,
		phone: '+91 90000 12345',
		designation: 'Procurement Head',
		city: 'Pune',
		projectDescription: `${namespace} needs a control-panel retrofit`,
		enquiryType: 'Website',
		leadSource: 'Website',
		priority: 'High',
		notes: `${namespace} prefers a site visit before the quotation`,
		enquiryDate: calendarDateFromToday(-2),
		dispose: async () => {
			try {
				const [rows] = await db.execute<LeadIdRow[]>(
					'SELECT id FROM leads WHERE company_name = ?',
					[companyName]
				);
				for (const row of rows) {
					await deleteLeadRows(db, Number(row.id));
				}
			} finally {
				await identity.dispose();
			}
		},
	};
}

/**
 * Read the Lead the browser created, by the namespaced company name it saved.
 * Returns the soft-delete flag instead of filtering it, so the caller proves
 * the row is live.
 */
export async function readCreatedLead(
	db: Connection,
	companyName: string
): Promise<CreatedLeadState | null> {
	const [rows] = await db.execute<CreatedLeadRow[]>(
		`SELECT id, lead_id, company_name, contact_name, contact_email,
        inquiry_email, phone, designation, city, project_description,
        enquiry_type, enquiry_status, lead_source, priority, notes,
        enquiry_date, follow_up_date, owner_user_id, isDelete
       FROM leads
      WHERE company_name = ?
      ORDER BY id DESC
      LIMIT 1`,
		[companyName]
	);
	const row = rows[0];
	if (!row) return null;
	return {
		id: Number(row.id),
		leadId: nullableText(row.lead_id),
		companyName: nullableText(row.company_name) ?? '',
		contactName: nullableText(row.contact_name),
		contactEmail: nullableText(row.contact_email),
		inquiryEmail: nullableText(row.inquiry_email),
		phone: nullableText(row.phone),
		designation: nullableText(row.designation),
		city: nullableText(row.city),
		projectDescription: nullableText(row.project_description),
		enquiryType: nullableText(row.enquiry_type),
		enquiryStatus: nullableText(row.enquiry_status),
		leadSource: nullableText(row.lead_source),
		priority: nullableText(row.priority),
		notes: nullableText(row.notes),
		enquiryDate: nullableText(row.enquiry_date),
		followUpDate: nullableText(row.follow_up_date),
		ownerUserId: nullableNumber(row.owner_user_id),
		isDelete: Number(row.isDelete ?? 0),
	};
}

/**
 * Seed one New-stage Lead owned by a fresh identity that may read and update
 * it. No activity exists yet: the connected call and its next action come from
 * the browser form.
 */
export async function seedLeadWorkFixture(
	db: Connection,
	namespace: string
): Promise<LeadWorkFixture> {
	const identity = await createJourneyUser(
		db,
		`${namespace}-lead-work`,
		LEAD_WORK_PERMISSIONS
	);

	const companyName = `${namespace} Work Lead Co`;
	const scheduledFor = calendarDateFromToday(7);
	let leadId: number | null = null;
	try {
		const [result] = await db.execute<ResultSetHeader>(
			`INSERT INTO leads (
        company_name, contact_name, contact_email, phone, city,
        project_description, enquiry_status, priority, owner_user_id,
        isDelete, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'New', 'Medium', ?, 0, NOW(), NOW())`,
			[
				companyName,
				'Rohan Mehta',
				`${namespace}-rohan@example.com`,
				'+91 98111 22334',
				'Mumbai',
				`${namespace} needs an annual maintenance visit`,
				identity.userId,
			]
		);
		const insertedId = Number(result.insertId);
		if (!Number.isInteger(insertedId) || insertedId <= 0) {
			throw new Error('[lead-work] the seeded Lead was not inserted');
		}
		leadId = insertedId;

		return {
			userId: identity.userId,
			username: identity.username,
			password: identity.password,
			leadId: insertedId,
			companyName,
			callOutcome: 'Connected',
			notes: 'Spoke with the plant manager about the maintenance window.',
			nextActionText: 'Confirm the maintenance window',
			scheduledFor,
			scheduledLabel: timelineCalendarLabel(scheduledFor),
			dispose: async () => {
				try {
					await deleteLeadRows(db, insertedId);
				} finally {
					await identity.dispose();
				}
			},
		};
	} catch (error) {
		if (leadId !== null) {
			try {
				await deleteLeadRows(db, leadId);
			} catch {
				// Preserve the seed failure; the disposable database is dropped.
			}
		}
		await identity.dispose();
		throw error;
	}
}

/**
 * Read the Lead, its activities, and its stage history through an independent
 * mysql2 connection. Rows are selected by the owned Lead id, not by values the
 * browser was told.
 */
export async function readLeadWorkState(
	db: Connection,
	leadId: number
): Promise<LeadWorkState> {
	const [leadRows] = await db.execute<LeadWorkLeadRow[]>(
		`SELECT id, company_name, enquiry_status, owner_user_id,
        follow_up_date, isDelete
       FROM leads
      WHERE id = ?
      LIMIT 1`,
		[leadId]
	);
	const [activityRows] = await db.execute<LeadWorkActivityRow[]>(
		`SELECT id, activity_type, status, call_outcome, reply_confirmed,
        scheduled_for, occurred_at, completed_at, next_action, notes,
        created_by, isDelete
       FROM lead_activities
      WHERE lead_id = ?
      ORDER BY id ASC`,
		[leadId]
	);
	const [stageRows] = await db.execute<LeadWorkStageHistoryRow[]>(
		`SELECT id, from_stage, to_stage, change_source, reason, actor_user_id
       FROM lead_stage_history
      WHERE lead_id = ?
      ORDER BY id ASC`,
		[leadId]
	);

	const leadRow = leadRows[0];
	return {
		lead: leadRow
			? {
					id: Number(leadRow.id),
					companyName: nullableText(leadRow.company_name) ?? '',
					enquiryStatus: nullableText(leadRow.enquiry_status),
					ownerUserId: nullableNumber(leadRow.owner_user_id),
					followUpDate: nullableText(leadRow.follow_up_date),
					isDelete: Number(leadRow.isDelete ?? 0),
				}
			: null,
		activities: activityRows.map((row) => ({
			id: Number(row.id),
			activityType: nullableText(row.activity_type),
			status: nullableText(row.status) ?? '',
			callOutcome: nullableText(row.call_outcome),
			replyConfirmed:
				row.reply_confirmed === null ||
				row.reply_confirmed === undefined ||
				row.reply_confirmed === ''
					? null
					: Number(row.reply_confirmed) === 1,
			scheduledFor: nullableText(row.scheduled_for),
			occurredAt: nullableText(row.occurred_at),
			completedAt: nullableText(row.completed_at),
			nextAction: nullableText(row.next_action),
			notes: nullableText(row.notes),
			createdBy: nullableNumber(row.created_by),
			isDelete: Number(row.isDelete ?? 0),
		})),
		stageHistory: stageRows.map((row) => ({
			id: Number(row.id),
			fromStage: nullableText(row.from_stage),
			toStage: nullableText(row.to_stage) ?? '',
			changeSource: nullableText(row.change_source) ?? '',
			reason: nullableText(row.reason),
			actorUserId: nullableNumber(row.actor_user_id),
		})),
	};
}

/**
 * Remove only the rows this Lead owns. Corrections and conversion evidence
 * reference the Lead and its activities with RESTRICT foreign keys, so they go
 * first; older follow-up rows cascade with the Lead.
 */
async function deleteLeadRows(db: Connection, leadId: number): Promise<void> {
	await db.execute('DELETE FROM lead_activity_corrections WHERE lead_id = ?', [
		leadId,
	]);
	await db.execute('DELETE FROM lead_activities WHERE lead_id = ?', [leadId]);
	await db.execute('DELETE FROM lead_stage_history WHERE lead_id = ?', [
		leadId,
	]);
	await db.execute('DELETE FROM lead_ownership_history WHERE lead_id = ?', [
		leadId,
	]);
	await db.execute('DELETE FROM lead_legacy_reviews WHERE lead_id = ?', [
		leadId,
	]);
	await db.execute('DELETE FROM lead_conversions WHERE lead_id = ?', [leadId]);
	await db.execute('DELETE FROM leads WHERE id = ?', [leadId]);
}
