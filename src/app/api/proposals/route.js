import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import {
	sanitizeJsonStrings,
	sanitizeOptionalRichText,
} from '@/lib/sanitize-fields';
import {
	assertSingleAuthoritativeLeadLink,
	refreshLeadProposalState,
} from '@/server/leads/legacy-review';
import { syncCanonicalProposalLink } from '@/server/leads/conversion';
import { LEAD_CONVERSION_MESSAGES } from '@/lib/lead-conversion';
import { LeadWorkflowError, toNullableId } from '@/server/leads/shared';

export async function GET(request) {
	let pool;
	try {
		// RBAC: read proposals
		const auth = await ensurePermission(
			request,
			RESOURCES.PROPOSALS,
			PERMISSIONS.READ
		);
		if (auth instanceof Response) return auth;

		pool = await dbConnect();

		const [rows] = await pool.execute(
			'SELECT * FROM proposals WHERE isDelete = 0 ORDER BY created_at DESC'
		);

		return NextResponse.json({
			success: true,
			proposals: rows,
		});
	} catch (error) {
		console.error('Error fetching proposals:', error);
		return NextResponse.json(
			{ success: false, error: 'Failed to fetch proposals' },
			{ status: 500 }
		);
	} finally {
		if (pool) pool.release();
	}
}

export async function POST(request) {
	let pool;
	let linkedTransaction = false;
	try {
		// RBAC: create proposals
		const auth = await ensurePermission(
			request,
			RESOURCES.PROPOSALS,
			PERMISSIONS.CREATE
		);
		if (auth instanceof Response) return auth;

		const data = await request.json();

		// The canonical Lead link is not a client field: one enquiry has one
		// canonical Proposal, and the Lead-to-Proposal handoff owns that
		// link. A request that carries it is refused before anything is
		// written.
		if (Object.prototype.hasOwnProperty.call(data, 'canonical_lead_id')) {
			throw new LeadWorkflowError(
				'proposal_link_conflict',
				LEAD_CONVERSION_MESSAGES.proposal_link_conflict,
				409
			);
		}

		// Extract fields matching new database schema
		const {
			// From lead conversion (basic fields)
			title,
			client,
			contact_name,
			contact_email,
			phone,
			project_description,
			city,
			priority,
			value,
			status,
			due_date,
			notes,
			lead_id,

			// New comprehensive fields
			proposal_title,
			description,
			company_id,
			client_name,
			industry,
			contract_type,
			proposal_value,
			currency,
			payment_terms,

			// Schedule fields
			planned_start_date,
			planned_end_date,
			project_duration_planned,
			target_date,
			project_schedule,

			// Scope fields
			input_document,
			list_of_deliverables,
			disciplines,
			activities,
			discipline_descriptions,
			planning_activities_list,
			documents_list,

			// Meetings fields
			kickoff_meeting,
			in_house_meeting,
			kickoff_meeting_date,
			internal_meeting_date,
			next_internal_meeting,

			// (frontend scope fields already declared above)

			// Financial & Risk fields
			software,
			duration,
			site_visit,
			quotation_validity,
			mode_of_delivery,
			revision,
			exclusions,
			billing_payment_terms,
			other_terms,
			additional_fields,
			general_terms,
			budget,
			project_location_country,
			cost_to_company,
			profitability_estimate,
			major_risks,
			mitigation_plans,

			// Hours tracking fields
			planned_hours_total,
			actual_hours_total,
			planned_hours_by_discipline,
			actual_hours_by_discipline,
			planned_hours_per_activity,
			actual_hours_per_activity,
			hours_variance_total,
			hours_variance_percentage,
			productivity_index,

			// Client & Location fields
			client_contact_details,
			// project_schedule,
			project_location_city,
			project_location_site,

			// Status fields
			progress,
			project_id,

			// Custom proposal_id (used when converting from lead)
			proposal_id: custom_proposal_id,
		} = data;

		// Get database connection
		pool = await dbConnect();

		// Proposal ID is manual entry — use whatever was provided, or leave null
		const proposal_id = custom_proposal_id || null;

		// One enquiry has one canonical Proposal. A new link is refused when
		// the enquiry already carries a linked Proposal, so a generic create
		// cannot become a second authoritative link. The check and the insert
		// share one transaction, and the enquiry row is locked for it, so two
		// concurrent creates cannot both link the same enquiry.
		const linkedLeadId = toNullableId(lead_id);

		// Build columns and values explicitly to avoid column/value count mismatches
		const columns = [
			'proposal_id',
			'proposal_title',
			'description',
			'company_id',
			'client_name',
			'industry',
			'contract_type',
			'proposal_value',
			'currency',
			'payment_terms',
			'planned_start_date',
			'planned_end_date',
			'project_duration_planned',
			'target_date',
			'project_schedule',
			'input_document',
			'list_of_deliverables',
			'disciplines',
			'activities',
			'discipline_descriptions',
			'planning_activities_list',
			'documents_list',
			'kickoff_meeting',
			'in_house_meeting',
			'kickoff_meeting_date',
			'internal_meeting_date',
			'next_internal_meeting',
			'software',
			'duration',
			'site_visit',
			'quotation_validity',
			'mode_of_delivery',
			'revision',
			'exclusions',
			'billing_payment_terms',
			'other_terms',
			'additional_fields',
			'general_terms',
			'budget',
			'cost_to_company',
			'profitability_estimate',
			'major_risks',
			'mitigation_plans',
			'planned_hours_total',
			'actual_hours_total',
			'planned_hours_by_discipline',
			'actual_hours_by_discipline',
			'planned_hours_per_activity',
			'actual_hours_per_activity',
			'hours_variance_total',
			'hours_variance_percentage',
			'productivity_index',
			'client_contact_details',
			'project_location_country',
			'project_location_city',
			'project_location_site',
			'status',
			'priority',
			'progress',
			'notes',
			'lead_id',
			'enquiry_no',
			'project_id',
		];

		const values = [
			proposal_id,
			proposal_title || title || 'Untitled Proposal',
			sanitizeOptionalRichText(description || project_description || null),
			company_id || null,
			client_name || client || null,
			industry || null,
			contract_type || null,
			proposal_value || value || null,
			currency || 'INR',
			payment_terms || null,
			planned_start_date || null,
			planned_end_date || null,
			project_duration_planned || null,
			target_date || due_date || null,
			project_schedule || null,
			input_document || null,
			list_of_deliverables || null,
			disciplines ? JSON.stringify(disciplines) : null,
			activities ? JSON.stringify(activities) : null,
			discipline_descriptions
				? JSON.stringify(sanitizeJsonStrings(discipline_descriptions))
				: null,
			planning_activities_list
				? JSON.stringify(planning_activities_list)
				: null,
			documents_list ? JSON.stringify(documents_list) : null,
			kickoff_meeting || null,
			in_house_meeting || null,
			kickoff_meeting_date || null,
			internal_meeting_date || null,
			next_internal_meeting || null,
			software || null,
			duration || null,
			site_visit || null,
			quotation_validity || null,
			mode_of_delivery || null,
			revision || null,
			exclusions || null,
			billing_payment_terms ||
				`Payment shall be released by the client within 7 days from the date of the invoice.
Payment shall be by way of RTGS transfer to ATSPL bank account.
The late payment charges will be 2% per month on the total bill amount if bills are not settled within the credit period of 30 days.
In case of project delays beyond two-month, software cost of ₹10,000/- per month will be charged.
Upon completion of the above scope of work, if a project is cancelled or held by the client for any reason then Accent Techno Solutions Private Limited is entitled to 100% invoice against the completed work.`,
			other_terms ||
				`Input, output & any excerpts in between is intellectual properties of client. ATS shall not voluntarily disclose any of such documents to third parties & will undertake all the commonly accepted practices and tools to avoid the loss or spillover of such information.
ATS shall take utmost care to maintain confidentiality of any information or intellectual property of client that it may come across.
ATS is allowed to use the contract as a customer reference. However, no data or intellectual property of the client can be disclosed to third parties without the written consent of client.`,
			additional_fields || null,
			general_terms ||
				`General Terms and conditions
• Any additional work will be charged extra
• GST 18% extra as applicable on total project cost.
• The proposal is based on client's enquiry and provided input data
• Work will start within 15 days after receipt of confirmed LOI/PO.
• Mode of Payments: - Through Wire transfer to ‘Accent Techno Solutions Pvt Ltd.’ payable at Mumbai A/c No. 917020044935714, IFS Code: UTIB0001244`,
			budget || null,
			cost_to_company || null,
			profitability_estimate || null,
			major_risks || null,
			mitigation_plans || null,
			planned_hours_total || null,
			actual_hours_total || null,
			planned_hours_by_discipline
				? JSON.stringify(planned_hours_by_discipline)
				: null,
			actual_hours_by_discipline
				? JSON.stringify(actual_hours_by_discipline)
				: null,
			planned_hours_per_activity
				? JSON.stringify(planned_hours_per_activity)
				: null,
			actual_hours_per_activity
				? JSON.stringify(actual_hours_per_activity)
				: null,
			hours_variance_total || null,
			hours_variance_percentage || null,
			productivity_index || null,
			client_contact_details || null,
			project_location_country || null,
			project_location_city || city || null,
			project_location_site || null,
			status === 'pending' ? 'DRAFT' : (status || 'DRAFT').toUpperCase(),
			(priority || 'MEDIUM').toUpperCase(),
			progress || 0,
			notes || null,
			linkedLeadId,
			linkedLeadId, // enquiry_no will mirror lead_id on create
			project_id || null,
		];

		// Sanity check: ensure columns length matches values length
		if (columns.length !== values.length) {
			console.error(
				'Proposals INSERT mismatch: columns.length=',
				columns.length,
				'values.length=',
				values.length
			);
			console.error('Columns:', columns);
			console.error(
				'Values length and sample:',
				values.length,
				values.slice(0, 10)
			);
			throw new Error(
				`Column/value count mismatch: ${columns.length} columns, ${values.length} values`
			);
		}

		const placeholders = columns.map(() => '?').join(', ');
		const sql = `INSERT INTO proposals (${columns.join(', ')}) VALUES (${placeholders})`;

		if (linkedLeadId !== null) {
			linkedTransaction = true;
			await pool.beginTransaction();
			try {
				await assertSingleAuthoritativeLeadLink(pool, linkedLeadId, null);
			} catch (error) {
				await pool.rollback();
				throw error;
			}
		}

		const [result] = await pool.execute(sql, values);

		// The enquiry records the canonical Proposal its live links allow.
		if (linkedLeadId !== null) {
			await refreshLeadProposalState(pool, linkedLeadId);
			await syncCanonicalProposalLink(pool, linkedLeadId);
			await pool.commit();
			linkedTransaction = false;
		}

		const newProposal = {
			id: result.insertId,
			proposal_id,
			proposal_title: proposal_title || title,
			client_name: client_name || client,
			contact_name,
			contact_email,
			phone,
			description: sanitizeOptionalRichText(description || project_description),
			city,
			priority: priority || 'MEDIUM',
			proposal_value: proposal_value || value,
			status: status || 'DRAFT',
			target_date: target_date || due_date,
			notes,
			lead_id: linkedLeadId,
			created_at: new Date().toISOString(),
		};

		return NextResponse.json({
			success: true,
			data: newProposal,
			proposal: newProposal,
			message: 'Proposal created successfully',
		});
	} catch (error) {
		if (linkedTransaction) {
			try {
				await pool.rollback();
			} catch {
				// the connection is released either way
			}
		}
		if (error instanceof LeadWorkflowError) {
			return NextResponse.json(
				{
					success: false,
					error: error.message,
					code: error.code,
				},
				{ status: error.status }
			);
		}
		console.error('Error creating proposal:', error);
		return NextResponse.json(
			{
				success: false,
				error: 'Failed to create proposal',
				details: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (pool) pool.release();
	}
}
