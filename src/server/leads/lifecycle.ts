import { dbConnect } from '@/utils/database';
import {
	isLeadActivityType,
	type LeadActivityType,
} from '@/lib/lead-activities';
import {
	LEAD_LIFECYCLE_ACTIVE_ACTIONS,
	LEAD_LIFECYCLE_MESSAGES,
	LEAD_LIFECYCLE_OWNER_ACTIONS,
	LEAD_LIFECYCLE_QUALIFICATION_ACTIONS,
	LEAD_LIFECYCLE_REASON_ACTIONS,
	LEAD_LIFECYCLE_TARGET_STAGE,
	canApplyLeadLifecycleAction,
	isLeadLifecycleAction,
	type LeadLifecycleAction,
} from '@/lib/lead-lifecycle';
import type { LeadStage } from '@/lib/lead-stages';
import {
	LeadWorkflowError,
	assertOwnerAssignable,
	normalizeDate,
	normalizeEmail,
	parseExplicitOwner,
	recordOwnershipChange,
	recordStageChange,
	requireDbTransaction,
	resolveCanonicalStage,
	toNullableId,
	trimOrNull,
	type DbConnection,
} from '@/server/leads/shared';
import {
	earliestNextAction,
	insertActivityRow,
	syncFollowUpDateMirror,
} from '@/server/leads/activity-rows';

/**
 * The explicit Lead lifecycle decisions (ticket #373).
 *
 * Four accountable decisions: Qualify, Nurture, Disqualify, Reopen. A person
 * makes them, the server checks what each one needs, and the stage history
 * keeps them. Nothing here is inferred from an activity, and an automatic
 * activity update never overwrites one of these decisions.
 *
 * The rules:
 * - A qualified Lead has a named contact, a usable phone number or email
 *   address, and a clear project need. Budget and timing are not Lead
 *   fields, so they never block a qualification.
 * - Qualify, Nurture, and Reopen need a resolved owner and a dated next
 *   action: they put the Lead back into active work.
 * - Disqualify needs a reason. It closes the Lead, cancels the outstanding
 *   scheduled work explicitly, and keeps every activity and every piece of
 *   evidence.
 * - Reopen applies to a disqualified Lead only. It needs a reason, an owner,
 *   and a dated next action. The earlier disqualification stays visible.
 * - A converted Lead never takes a lifecycle decision. Its routine sales
 *   work belongs to the linked Proposal.
 *
 * Every decision is one transaction: the stage, the ownership change, the
 * next action, the cancelled work, and the stage history commit together or
 * not at all. A refused decision leaves no trace.
 */

export type { LeadLifecycleAction } from '@/lib/lead-lifecycle';

export interface LeadLifecycleInput {
	action: unknown;
	reason?: unknown;
	owner_user_id?: unknown;
	next_action?: unknown;
}

/** A reason is evidence: long evidence is refused, never truncated. */
const MAX_REASON_LENGTH = 2000;

interface LeadLifecycleState {
	id: number;
	ownerUserId: number | null;
	stage: LeadStage | null;
	contactName: string | null;
	contactEmail: string | null;
	inquiryEmail: string | null;
	ccEmails: string | null;
	phone: string | null;
	projectDescription: string | null;
}

interface NextActionInput {
	activityType: LeadActivityType;
	scheduledFor: string;
	nextAction: string | null;
	notes: string | null;
}

function parseAction(value: unknown): LeadLifecycleAction {
	if (!isLeadLifecycleAction(value)) {
		throw new LeadWorkflowError(
			'lifecycle_not_allowed',
			LEAD_LIFECYCLE_MESSAGES.action_invalid,
			422
		);
	}
	return value;
}

function parseReason(value: unknown): string | null {
	const reason = trimOrNull(value);
	if (reason !== null && reason.length > MAX_REASON_LENGTH) {
		throw new LeadWorkflowError(
			'reason_required',
			LEAD_LIFECYCLE_MESSAGES.reason_too_long,
			422
		);
	}
	return reason;
}

/**
 * The dated next action a decision may schedule with it. It is the same
 * shape the activity log uses, and it becomes a real scheduled work row.
 */
function parseNextAction(value: unknown): NextActionInput | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new LeadWorkflowError(
			'activity_invalid',
			LEAD_LIFECYCLE_MESSAGES.next_action_invalid,
			422
		);
	}
	const raw = value as Record<string, unknown>;
	let activityType: LeadActivityType = 'Note';
	if (raw.activity_type !== undefined && raw.activity_type !== null) {
		if (!isLeadActivityType(raw.activity_type)) {
			throw new LeadWorkflowError(
				'activity_invalid',
				LEAD_LIFECYCLE_MESSAGES.next_action_type_invalid,
				422
			);
		}
		activityType = raw.activity_type;
	}
	const scheduledFor = normalizeDate(raw.scheduled_for);
	if (!scheduledFor) {
		throw new LeadWorkflowError(
			'activity_invalid',
			LEAD_LIFECYCLE_MESSAGES.next_action_invalid,
			422
		);
	}
	return {
		activityType,
		scheduledFor,
		nextAction: trimOrNull(raw.next_action),
		notes: trimOrNull(raw.notes),
	};
}

async function loadLead(
	db: DbConnection,
	leadId: number
): Promise<LeadLifecycleState> {
	const [rows] = (await db.execute(
		`SELECT id, owner_user_id, enquiry_status, contact_name, contact_email,
        inquiry_email, cc_emails, phone, project_description
      FROM leads
      WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)
      FOR UPDATE`,
		[leadId]
	)) as unknown as [
		{
			id: number;
			owner_user_id: number | null;
			enquiry_status: string | null;
			contact_name: string | null;
			contact_email: string | null;
			inquiry_email: string | null;
			cc_emails: string | null;
			phone: string | null;
			project_description: string | null;
		}[],
		unknown,
	];
	const row = rows[0];
	if (!row) {
		throw new LeadWorkflowError('not_found', 'Lead not found', 404);
	}
	return {
		id: row.id,
		ownerUserId: toNullableId(row.owner_user_id),
		stage: resolveCanonicalStage(row.enquiry_status),
		contactName: trimOrNull(row.contact_name),
		contactEmail: trimOrNull(row.contact_email),
		inquiryEmail: trimOrNull(row.inquiry_email),
		ccEmails: trimOrNull(row.cc_emails),
		phone: trimOrNull(row.phone),
		projectDescription: trimOrNull(row.project_description),
	};
}

/**
 * The decision has to be available for the stage the Lead is in now. A
 * converted Lead takes no lifecycle decision, and an unresolved stage is
 * resolved before anything is decided about it.
 */
function assertDecisionAvailable(
	action: LeadLifecycleAction,
	stage: LeadStage | null
): void {
	if (stage === 'Converted') {
		throw new LeadWorkflowError(
			'lead_converted',
			LEAD_LIFECYCLE_MESSAGES.lead_converted,
			409
		);
	}
	if (stage === null) {
		throw new LeadWorkflowError(
			'lifecycle_not_allowed',
			LEAD_LIFECYCLE_MESSAGES.action_stage_unresolved,
			409
		);
	}
	if (!canApplyLeadLifecycleAction(action, stage)) {
		throw new LeadWorkflowError(
			'lifecycle_not_allowed',
			LEAD_LIFECYCLE_MESSAGES.action_not_allowed,
			409
		);
	}
}

/** A usable phone number or email address: any one of them is enough. */
function hasUsableContactDetails(lead: LeadLifecycleState): boolean {
	if (lead.phone !== null) return true;
	if (normalizeEmail(lead.contactEmail) !== null) return true;
	if (normalizeEmail(lead.inquiryEmail) !== null) return true;
	if (lead.ccEmails !== null) {
		for (const part of lead.ccEmails.split(',')) {
			if (normalizeEmail(part) !== null) return true;
		}
	}
	return false;
}

/**
 * The qualification facts of the Lead: a named contact, a usable phone
 * number or email address, and a clear project need. Budget and timing are
 * not Lead fields, so they never block a qualification.
 */
function assertQualificationFacts(lead: LeadLifecycleState): void {
	if (lead.contactName === null) {
		throw new LeadWorkflowError(
			'contact_name_required',
			LEAD_LIFECYCLE_MESSAGES.contact_name_required,
			422
		);
	}
	if (!hasUsableContactDetails(lead)) {
		throw new LeadWorkflowError(
			'contact_details_required',
			LEAD_LIFECYCLE_MESSAGES.contact_details_required,
			422
		);
	}
	if (lead.projectDescription === null) {
		throw new LeadWorkflowError(
			'project_need_required',
			LEAD_LIFECYCLE_MESSAGES.project_need_required,
			422
		);
	}
}

/**
 * Apply one explicit lifecycle decision to a Lead.
 *
 * The actor comes from the authenticated session, never from the body. The
 * decision, the ownership change, the next action, the cancelled work, and
 * the stage history commit in one transaction.
 */
export async function applyLeadLifecycle(
	leadId: number,
	input: LeadLifecycleInput,
	actorUserId: number
): Promise<{
	stage: LeadStage;
	next_action_date: string | null;
	owner_user_id: number | null;
}> {
	const action = parseAction(input.action);
	const reason = parseReason(input.reason);
	const nextAction = parseNextAction(input.next_action);
	const ownerProvided = Object.hasOwn(input, 'owner_user_id');

	const db = (await dbConnect()) as unknown as DbConnection;
	const tx = requireDbTransaction(db);
	try {
		await tx.begin();
		try {
			const lead = await loadLead(db, leadId);
			assertDecisionAvailable(action, lead.stage);

			if (ownerProvided && !LEAD_LIFECYCLE_OWNER_ACTIONS.includes(action)) {
				throw new LeadWorkflowError(
					'lifecycle_not_allowed',
					LEAD_LIFECYCLE_MESSAGES.action_owner_not_allowed,
					422
				);
			}
			let nextOwner = lead.ownerUserId;
			if (ownerProvided) {
				const parsedOwner = parseExplicitOwner(input.owner_user_id);
				if (parsedOwner !== null) {
					await assertOwnerAssignable(db, parsedOwner);
				}
				nextOwner = parsedOwner;
			}

			if (LEAD_LIFECYCLE_QUALIFICATION_ACTIONS.includes(action)) {
				assertQualificationFacts(lead);
			}
			if (LEAD_LIFECYCLE_REASON_ACTIONS.includes(action) && reason === null) {
				throw new LeadWorkflowError(
					'reason_required',
					LEAD_LIFECYCLE_MESSAGES.reason_required,
					422
				);
			}

			const outstandingNextAction = await earliestNextAction(db, leadId);
			if (LEAD_LIFECYCLE_ACTIVE_ACTIONS.includes(action)) {
				if (nextOwner === null) {
					throw new LeadWorkflowError(
						'owner_required',
						LEAD_LIFECYCLE_MESSAGES.owner_required,
						409
					);
				}
				if (!outstandingNextAction && !nextAction) {
					throw new LeadWorkflowError(
						'next_action_required',
						LEAD_LIFECYCLE_MESSAGES.next_action_required,
						409
					);
				}
			}

			const targetStage = LEAD_LIFECYCLE_TARGET_STAGE[action];

			// The next action of an active Lead is real work: a scheduled
			// activity row, not only a column value.
			if (nextAction && !outstandingNextAction) {
				await insertActivityRow(db, {
					leadId,
					activityType: nextAction.activityType,
					status: 'Scheduled',
					scheduledFor: nextAction.scheduledFor,
					nextAction: nextAction.nextAction,
					notes: nextAction.notes,
					createdBy: actorUserId,
				});
			}

			const sets: string[] = ['enquiry_status = ?'];
			const params: unknown[] = [targetStage];
			if (ownerProvided && nextOwner !== lead.ownerUserId) {
				sets.push('owner_user_id = ?');
				params.push(nextOwner);
			}
			sets.push('updated_at = NOW()');
			params.push(leadId);
			await db.execute(
				`UPDATE leads SET ${sets.join(', ')}
          WHERE id = ? AND (isDelete = 0 OR isDelete IS NULL)`,
				params
			);
			if (ownerProvided && nextOwner !== lead.ownerUserId) {
				await recordOwnershipChange(
					db,
					leadId,
					lead.ownerUserId,
					nextOwner,
					actorUserId
				);
			}

			if (action === 'Disqualify') {
				// The outstanding work is cancelled explicitly: the rows keep
				// their identity and their evidence, the reason of the
				// decision stays in the stage history.
				await db.execute(
					`UPDATE lead_activities
            SET status = 'Cancelled', completed_at = NOW(), updated_at = NOW()
            WHERE lead_id = ?
              AND status = 'Scheduled'
              AND transferred_followup_id IS NULL
              AND (isDelete = 0 OR isDelete IS NULL)`,
					[leadId]
				);
			}

			await recordStageChange(db, {
				leadId,
				fromStage: lead.stage,
				toStage: targetStage,
				changeSource: 'explicit',
				reason,
				actorUserId,
			});

			const nextActionDate = await syncFollowUpDateMirror(db, leadId);
			await tx.commit();
			return {
				stage: targetStage,
				next_action_date: nextActionDate,
				owner_user_id: nextOwner,
			};
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	} finally {
		db.release?.();
	}
}
