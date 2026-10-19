import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';
import { hasPermission } from '@/utils/rbac';
import { logActivity } from '@/utils/activity-logger';
import { importLeads, type ImportLeadRow } from '@/server/leads/workflow';
import { parseExplicitOwner } from '@/server/leads/shared';
import { leadWorkflowFailure } from '@/app/api/leads/_lib/route-helpers';

/**
 * Minimal quoted-CSV row parser (commas inside quotes stay in the field).
 * Returns RAW cell values verbatim — whitespace included. Only the header
 * row is trimmed by the caller for name matching; all field interpretation
 * lives in the workflow module.
 */
function parseCsvRow(line: string): string[] {
	const fields: string[] = [];
	let current = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i];
		if (quoted) {
			if (char === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					quoted = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ',') {
			fields.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	fields.push(current);
	return fields;
}

/**
 * Header-name mapping only: assigns raw cells to raw row fields. Performs NO
 * normalization, validation, or truncation — the workflow interprets every
 * field with the same helpers as manual create.
 */
function mapRow(
	headers: string[],
	values: string[],
	rowNumber: number
): { row: ImportLeadRow } {
	const cell = (index: number): string | null => {
		const value = values[index];
		return value === undefined || value === '' ? null : value;
	};
	const lead: ImportLeadRow = {
		rowNumber,
		company_name: null,
		contact_name: null,
		contact_email: null,
		phone: null,
		city: null,
		project_description: null,
		enquiry_type: null,
		enquiry_status: null,
		enquiry_date: null,
		follow_up_date: null,
		lead_source: null,
		priority: null,
		designation: null,
		notes: null,
		owner_evidence: null,
	};
	headers.forEach((header, index) => {
		const value = cell(index);
		const lower = header.toLowerCase();
		if (lower.includes('company')) {
			lead.company_name = value;
		} else if (lower.includes('contact') && lower.includes('name')) {
			lead.contact_name = value;
		} else if (lower.includes('designation')) {
			lead.designation = value;
		} else if (lower.includes('email')) {
			lead.contact_email = value;
		} else if (lower.includes('phone')) {
			lead.phone = value;
		} else if (lower.includes('city')) {
			lead.city = value;
		} else if (lower.includes('project') || lower.includes('description')) {
			lead.project_description = value;
		} else if (lower.includes('enquiry') && lower.includes('type')) {
			lead.enquiry_type = value;
		} else if (
			lower.includes('stage') ||
			lower === 'status' ||
			lower.includes('status')
		) {
			lead.enquiry_status = value;
		} else if (
			lower.includes('follow') ||
			lower.includes('next action') ||
			lower.includes('next_action')
		) {
			// Dated next action: matched BEFORE the generic date branch so a
			// 'Next follow-up date' header does not land in enquiry_date.
			lead.follow_up_date = value;
		} else if (lower.includes('date')) {
			lead.enquiry_date = value;
		} else if (lower.includes('source')) {
			lead.lead_source = value;
		} else if (lower.includes('priority')) {
			lead.priority = value;
		} else if (lower.includes('notes')) {
			lead.notes = value;
		} else if (
			lower.includes('owner') ||
			lower.includes('assigned') ||
			lower.includes('assignee')
		) {
			// Import-time owner evidence only — never resolved to a user here.
			lead.owner_evidence = value;
		}
	});
	return { row: lead };
}

export async function POST(request: Request): Promise<Response> {
	const importAuth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.IMPORT
	);
	if (importAuth instanceof Response) return importAuth;
	const createAuth = await ensurePermission(
		request,
		RESOURCES.LEADS,
		PERMISSIONS.CREATE
	);
	if (createAuth instanceof Response) return createAuth;
	const user = createAuth.user;

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return Response.json(
			{ success: false, error: 'Invalid multipart body' },
			{ status: 400 }
		);
	}
	const file = formData.get('file');
	if (!(file instanceof File)) {
		return Response.json(
			{ success: false, error: 'No file provided' },
			{ status: 400 }
		);
	}
	if (!file.name.toLowerCase().endsWith('.csv')) {
		return Response.json(
			{ success: false, error: 'Invalid file type. Please upload a CSV file.' },
			{ status: 400 }
		);
	}

	// Optional owner authority: the form field, never a name column. Parsed by
	// the shared strict parser — '88garbage' is rejected, never coerced.
	let ownerUserId: number | null = null;
	const ownerField = formData.get('owner_user_id');
	if (ownerField !== null && String(ownerField).trim() !== '') {
		try {
			ownerUserId = parseExplicitOwner(String(ownerField));
		} catch {
			return Response.json(
				{ success: false, error: 'Invalid owner_user_id' },
				{ status: 400 }
			);
		}
		if (
			!user.is_super_admin &&
			!hasPermission(user, RESOURCES.LEADS, PERMISSIONS.ASSIGN)
		) {
			return Response.json(
				{ success: false, error: 'Forbidden: missing permission' },
				{ status: 403 }
			);
		}
	}

	const text = await file.text();
	const lines = text.split(/\r?\n/);
	if (lines.length < 2 || lines.slice(1).every((line) => line.trim() === '')) {
		return Response.json(
			{
				success: false,
				error: 'CSV must have headers and at least one data row',
			},
			{ status: 400 }
		);
	}
	const headers = parseCsvRow(lines[0]).map((header) => header.trim());
	if (!headers.some((header) => header.toLowerCase().includes('company'))) {
		return Response.json(
			{
				success: false,
				error: 'CSV must include a Company / company_name header',
			},
			{ status: 400 }
		);
	}

	const rows: ImportLeadRow[] = [];
	const parseErrors: string[] = [];
	for (let i = 1; i < lines.length; i++) {
		if (lines[i].trim() === '') continue;
		const values = parseCsvRow(lines[i]);
		if (values.length !== headers.length) {
			parseErrors.push(
				`Row ${i + 1}: column count mismatch (expected ${headers.length} columns, got ${values.length})`
			);
			continue;
		}
		rows.push(mapRow(headers, values, i + 1).row);
	}

	try {
		const result = await importLeads(rows, ownerUserId, Number(user.id));
		const errors = [...parseErrors, ...(result.errors ?? [])];
		if (result.imported === 0) {
			return Response.json(
				{
					success: false,
					error: 'No valid leads imported. Please check CSV formatting.',
					errors,
				},
				{ status: 400 }
			);
		}
		void logActivity({
			userId: Number(user.id),
			actionType: 'upload',
			resourceType: 'lead',
			description: `Imported ${result.imported} leads`,
			details: {
				imported: result.imported,
				needs_review: result.needs_review,
				owner_user_id: ownerUserId,
			},
			request,
		}).catch((err) => console.error('Failed to log activity:', err));
		return Response.json({
			success: true,
			imported: result.imported,
			needs_review: result.needs_review,
			errors: errors.length > 0 ? errors : null,
			message: `Successfully imported ${result.imported} leads${
				result.needs_review > 0 ? ` (${result.needs_review} need review)` : ''
			}${errors.length > 0 ? ` with ${errors.length} errors` : ''}`,
		});
	} catch (error) {
		return leadWorkflowFailure(error, 'Failed to import leads');
	}
}
