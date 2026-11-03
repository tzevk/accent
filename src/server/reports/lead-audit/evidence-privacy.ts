/**
 * The one narrative-privacy projection for audit evidence exports.
 *
 * The interactive audit view can read narrative on demand. The workbook is a
 * different disclosure: by default it carries structured evidence only, with
 * no notes, reasons, or original/corrected free text - including text nested
 * inside a correction's previous and corrected values.
 *
 * Both the audit section (#404) and the workbook export (#405) project rows
 * through this module, so a later export cannot accidentally serialize a raw
 * nested history object or bypass the redaction. The projection is an
 * explicit whitelist: every exported key is named here, and the source rows
 * are never spread.
 */
import type {
	LeadAuditDeletedEvidenceRow,
	LeadAuditEvidenceNarrative,
	LeadAuditEvidenceRow,
	LeadAuditNarrativeChange,
	LeadAuditNarrativeField,
} from './audit-types';

/** The explicit workbook choice. Narrative is off unless stated. */
export interface LeadAuditExportOptions {
	includeNarrative: boolean;
}

export interface LeadAuditNarrativeExportField {
	key: string;
	label: string;
	value: string | null;
}

export interface LeadAuditNarrativeExportChange {
	field: string;
	label: string;
	from: string | null;
	to: string | null;
}

/** The structured, narrative-redacted shape of one audit evidence row. */
export interface LeadAuditEvidenceExportRow {
	evidence_type: string;
	evidence_id: number;
	reference: string;
	source_table: string;
	lead_id: number;
	lead_code: string | null;
	company_name: string;
	actor_id: number | null;
	actor_name: string | null;
	actor_unknown: boolean;
	occurred_at: string | null;
	occurrence_known: boolean;
	recorded_at: string | null;
	activity_type: string | null;
	call_outcome: string | null;
	reply_confirmed: boolean | null;
	status: string | null;
	summary: string;
	legacy: boolean;
	change_fields: string;
	has_narrative: boolean;
	/** True when free text exists but was deliberately withheld. */
	narrative_withheld: boolean;
	/** Present only when the exporter included detailed evidence. */
	narrative_fields: LeadAuditNarrativeExportField[] | null;
	narrative_changes: LeadAuditNarrativeExportChange[] | null;
	proposal_state: string;
	proposal_id: number | null;
	proposal_title: string | null;
	proposal_status: string | null;
	proposal_progress: number | null;
	project_state: string;
	project_id: number | null;
	project_title: string | null;
	project_status: string | null;
	project_progress: number | null;
}

export interface LeadAuditDeletedEvidenceExportRow
	extends LeadAuditEvidenceExportRow {
	deleted_record: 'lead' | 'evidence';
	deletion_known: false;
	deletion_actor: null;
	deletion_at: null;
	deletion_note: string;
}

type QuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

function readRaw(source: QuerySource, key: string): string {
	const value =
		source instanceof URLSearchParams ? source.get(key) : (source[key] ?? null);
	return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * The workbook's explicit Include detailed evidence choice. Accepts the
 * documented `include_narrative` and the longer `include_detailed_evidence`
 * spelling; anything else means the default, narrative-free export.
 */
export function parseIncludeDetailedEvidence(source: QuerySource): boolean {
	const value = readRaw(source, 'include_narrative');
	if (value === '1' || value === 'true') return true;
	const longer = readRaw(source, 'include_detailed_evidence');
	return longer === '1' || longer === 'true';
}

function downstreamFields(row: LeadAuditEvidenceRow) {
	const proposal = row.downstream?.proposal ?? null;
	const project = row.downstream?.project ?? null;
	return {
		proposal_state: row.downstream?.proposal_state ?? '',
		proposal_id: proposal?.id ?? null,
		proposal_title: proposal?.title ?? null,
		proposal_status: proposal?.status ?? null,
		proposal_progress: proposal?.progress ?? null,
		project_state: row.downstream?.project_state ?? '',
		project_id: project?.id ?? null,
		project_title: project?.title ?? null,
		project_status: project?.status ?? null,
		project_progress: project?.progress ?? null,
	};
}

/**
 * Project one evidence row into its explicit export shape. Free text is
 * never copied unless the caller has separately chosen and read it through
 * `projectAuditNarrativeForExport`.
 */
export function projectEvidenceForExport(
	row: LeadAuditEvidenceRow,
	options: LeadAuditExportOptions
): LeadAuditEvidenceExportRow {
	return {
		evidence_type: row.evidence_type,
		evidence_id: row.evidence_id,
		reference: row.reference,
		source_table: row.source_reference.table,
		lead_id: row.lead.id,
		lead_code: row.lead.lead_id,
		company_name: row.lead.company_name,
		actor_id: row.actor.id,
		actor_name: row.actor.name,
		actor_unknown: row.actor.is_unknown,
		occurred_at: row.occurred_at,
		occurrence_known: row.occurrence_known,
		recorded_at: row.recorded_at,
		activity_type: row.activity_type,
		call_outcome: row.call_outcome,
		reply_confirmed: row.reply_confirmed,
		status: row.status,
		summary: row.summary,
		legacy: row.legacy,
		change_fields: row.change_fields.map((field) => field.label).join('; '),
		has_narrative: row.has_narrative,
		narrative_withheld: !options.includeNarrative && row.has_narrative,
		// Narrative values are never inferred from the structured row; the
		// exporter must merge a separately read narrative through
		// withExportNarrative.
		narrative_fields: null,
		narrative_changes: null,
		...downstreamFields(row),
	};
}

/** The deleted projection adds the explicit unknown deletion facts. */
export function projectDeletedEvidenceForExport(
	row: LeadAuditDeletedEvidenceRow,
	options: LeadAuditExportOptions
): LeadAuditDeletedEvidenceExportRow {
	return {
		...projectEvidenceForExport(row, options),
		deleted_record: row.deleted_record,
		deletion_known: row.deletion.known,
		deletion_actor: row.deletion.actor,
		deletion_at: row.deletion.at,
		deletion_note: row.deletion.note,
	};
}

/**
 * The only place that turns a narrative read into export fields. Both the
 * previous and the corrected correction values stay redacted by the same
 * choice: a detailed export gets the explicit from/to strings, the default
 * export never sees the narrative object at all.
 */
export function projectAuditNarrativeForExport(
	narrative: LeadAuditEvidenceNarrative,
	options: LeadAuditExportOptions
): {
	fields: LeadAuditNarrativeExportField[];
	changes: LeadAuditNarrativeExportChange[];
} {
	if (!options.includeNarrative) {
		return { fields: [], changes: [] };
	}
	const fields: LeadAuditNarrativeExportField[] = narrative.fields.map(
		(field: LeadAuditNarrativeField) => ({
			key: field.key,
			label: field.label,
			value: field.value,
		})
	);
	const changes: LeadAuditNarrativeExportChange[] = narrative.changes.map(
		(change: LeadAuditNarrativeChange) => ({
			field: change.field,
			label: change.label,
			from: change.from,
			to: change.to,
		})
	);
	return { fields, changes };
}

/**
 * Merge a separately read narrative into an already projected row. Used by
 * the workbook after it has chosen detailed evidence; it never mutates the
 * source row.
 */
export function withExportNarrative(
	row: LeadAuditEvidenceExportRow,
	narrative: LeadAuditEvidenceNarrative,
	options: LeadAuditExportOptions
): LeadAuditEvidenceExportRow {
	if (!options.includeNarrative) return row;
	const projected = projectAuditNarrativeForExport(narrative, options);
	return {
		...row,
		narrative_withheld: false,
		narrative_fields: projected.fields,
		narrative_changes: projected.changes,
	};
}
