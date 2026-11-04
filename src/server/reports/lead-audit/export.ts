/**
 * The complete Lead Audit Excel workbook (#405).
 *
 * One server module reads the export snapshot on the caller's single
 * connection and one observation clock, then builds the workbook from the
 * section readers the report already uses. Nothing here writes, and no
 * summary is re-aggregated independently: every figure comes from its section
 * reader, so a one-to-many join can never inflate a distinct-Lead total.
 *
 * Narrative is opt-in. The default workbook carries structured evidence
 * only; free text is projected through `evidence-privacy.ts`, which is also
 * the only module allowed to turn a narrative read into export cells.
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */
import ExcelJS from 'exceljs';
import type { DbConnection } from '@/server/leads/shared';
import {
	readLeadAuditDeletedEvidenceDetail,
	readLeadAuditEvidenceDetail,
	readLeadAuditEvidenceNarrative,
	readLeadAuditEvidenceSection,
} from './audit';
import type {
	LeadAuditCoverageSection,
	LeadAuditEvidenceSection,
	LeadAuditEvidenceType,
} from './audit-types';
import { readLeadAuditClock } from './clock';
import { withLeadAuditConnection } from './connection';
import {
	CURRENT_STATE_RISK_DEFINITIONS,
	CURRENT_STATE_WORKLOAD_DEFINITION,
	type LeadAuditCurrentStateExportSection,
} from './current-state-types';
import {
	buildCurrentStateIgnoredFilters,
	readLeadAuditCurrentStateExportRows,
} from './current-state';
import {
	readLeadAuditConversionRows,
	readLeadAuditConversionSection,
} from './conversion';
import type {
	LeadAuditConversionReadOptions,
	LeadAuditConversionRow,
	LeadAuditConversionSection,
} from './conversion-types';
import { readLeadAuditCoverageSection } from './coverage';
import { parseLeadAuditEvidenceFilters } from './evidence-filters';
import {
	projectDeletedEvidenceForExport,
	projectEvidenceForExport,
	withExportNarrative,
	type LeadAuditDeletedEvidenceExportRow,
	type LeadAuditEvidenceExportRow,
	type LeadAuditExportOptions,
} from './evidence-privacy';
import { parseLeadAuditFilters } from './filters';
import { readLeadAuditIntakeSection } from './intake';
import { readLeadAuditRegisterResult } from './register';
import {
	LEAD_AUDIT_WORK_METRICS,
	readLeadAuditWorkEvidenceRows,
	readLeadAuditWorkSection,
} from './work';
import type {
	LeadAuditWorkEvidenceRow,
	LeadAuditWorkSection,
} from './work-types';
import {
	readLeadAuditTimingDetail,
	readLeadAuditTimingIncomingFilters,
	readLeadAuditTimingSection,
} from './timing';
import type {
	LeadAuditTimingRow,
	LeadAuditTimingSection,
} from './timing-types';
import type {
	LeadAuditClock,
	LeadAuditIntakeSection,
	LeadAuditRegisterResult,
} from './types';

type QuerySource =
	| URLSearchParams
	| Record<string, string | null | undefined>;

export const LEAD_AUDIT_EXPORT_CONTENT_TYPE =
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Everything one workbook needs, read under one observation. */
export interface LeadAuditExportSnapshot {
	clock: LeadAuditClock;
	options: LeadAuditExportOptions;
	downstream: LeadAuditConversionReadOptions;
	intake: LeadAuditIntakeSection;
	register: {
		recorded: LeadAuditRegisterResult;
		enquired: LeadAuditRegisterResult;
		missingEnquiryDate: LeadAuditRegisterResult;
	};
	work: LeadAuditWorkSection;
	workRows: LeadAuditWorkEvidenceRow[];
	currentState: LeadAuditCurrentStateExportSection;
	conversion: LeadAuditConversionSection;
	conversionRows: LeadAuditConversionRow[];
	timing: LeadAuditTimingSection;
	timingRows: LeadAuditTimingRow[];
	audit: LeadAuditEvidenceSection;
	auditRows: LeadAuditEvidenceExportRow[];
	deletedRows: LeadAuditDeletedEvidenceExportRow[];
	coverage: LeadAuditCoverageSection;
}

/**
 * Read the complete applied export on one connection and one database clock.
 * Section summaries and their detail rows therefore share one observation,
 * and the export never invents a page size for its detail populations.
 */
export async function readLeadAuditExportSnapshot(
	source: QuerySource,
	downstream: LeadAuditConversionReadOptions,
	options: LeadAuditExportOptions
): Promise<LeadAuditExportSnapshot> {
	return withLeadAuditConnection(async (db) => {
		const clock = await readLeadAuditClock(db);
		const filters = parseLeadAuditFilters(source, clock.today);
		const evidenceFilters = parseLeadAuditEvidenceFilters(source);
		const timingFilters = {
			...filters,
			...readLeadAuditTimingIncomingFilters(source),
		};
		const [
			intake,
			recorded,
			enquired,
			missingEnquiryDate,
			work,
			workRows,
			currentState,
			conversion,
			conversionRows,
			timing,
			timingRows,
			audit,
			auditRaw,
			deletedRaw,
			coverage,
		] = await Promise.all([
			readLeadAuditIntakeSection(db, filters, clock),
			readLeadAuditRegisterResult(db, filters, 'recorded', clock),
			readLeadAuditRegisterResult(db, filters, 'enquired', clock),
			readLeadAuditRegisterResult(db, filters, 'missing_enquiry_date', clock),
			readLeadAuditWorkSection(db, filters, clock, evidenceFilters),
			readLeadAuditWorkEvidenceRows(
				db,
				filters,
				evidenceFilters,
				'completed'
			),
			readLeadAuditCurrentStateExportRows(db, filters, clock, {
				ignoredFilters: buildCurrentStateIgnoredFilters(filters, source),
			}),
			readLeadAuditConversionSection(db, filters, clock, downstream),
			readLeadAuditConversionRows(db, filters, downstream),
			readLeadAuditTimingSection(db, timingFilters, clock),
			readLeadAuditTimingDetail(db, timingFilters),
			readLeadAuditEvidenceSection(db, filters, clock, {
				evidenceFilters,
				undated: evidenceFilters.undated,
				...downstream,
			}),
			readLeadAuditEvidenceDetail(db, filters, clock, {
				evidenceFilters,
				undated: evidenceFilters.undated,
				...downstream,
			}),
			readLeadAuditDeletedEvidenceDetail(db, filters, clock, {
				evidenceFilters,
				undated: evidenceFilters.undated,
				...downstream,
			}),
			readLeadAuditCoverageSection(db, filters, clock),
		]);

		coverage.exclusions.push({
			metric: 'time_to_first_outreach',
			label: 'Time to first outreach',
			excluded: timing.exclusions.total,
			reason: `${timing.exclusions.missing_timestamp} missing timestamps; ${timing.exclusions.incomplete_earlier} incomplete earlier evidence; ${timing.exclusions.negative} negative intervals. ${timing.without_outreach} cohort Leads have no evidenced outreach.`,
		});

		const auditRows = await attachNarrative(
			db,
			auditRaw.map((row) => projectEvidenceForExport(row, options)),
			options,
			downstream
		);
		const deletedRows = await attachNarrative(
			db,
			deletedRaw.map((row) => projectDeletedEvidenceForExport(row, options)),
			options,
			downstream
		);

		return {
			clock,
			options,
			downstream,
			intake,
			register: { recorded, enquired, missingEnquiryDate },
			work,
			workRows,
			currentState,
			conversion,
			conversionRows,
			timing,
			timingRows,
			audit,
			auditRows,
			deletedRows,
			coverage,
		};
	});
}

/**
 * Merge narrative only after the explicit choice. Rows without free text are
 * never read, and the projection keeps the deleted-record shape.
 */
async function attachNarrative<T extends LeadAuditEvidenceExportRow>(
	db: DbConnection,
	rows: T[],
	options: LeadAuditExportOptions,
	downstream: LeadAuditConversionReadOptions
): Promise<T[]> {
	if (!options.includeNarrative) return rows;
	return Promise.all(
		rows.map(async (row) => {
			if (!row.has_narrative) return row;
			const narrative = await readLeadAuditEvidenceNarrative(
				db,
				{
					evidenceType: row.evidence_type as LeadAuditEvidenceType,
					evidenceId: row.evidence_id,
				},
				{
					includeProposals: downstream.includeProposals,
					includeProjects: downstream.includeProjects,
				}
			);
			if (!narrative) return row;
			return {
				...row,
				...withExportNarrative(row, narrative, options),
			} as T;
		})
	);
}

/** The download filename: applied period plus this export's generation time. */
export function leadAuditExportFilename(snapshot: LeadAuditExportSnapshot): string {
	const stamp = snapshot.clock.generatedAt
		.replace(/[^0-9]/g, '')
		.slice(0, 14);
	return `Lead_Audit_and_Performance_${snapshot.intake.scope.from_date}_to_${snapshot.intake.scope.to_date}_${stamp}.xlsx`;
}

/* ------------------------------------------------------------------ */
/* Cell vocabulary                                                     */
/* ------------------------------------------------------------------ */

const BRAND_PURPLE = 'FF7F2487';
const GRAY_BORDER = 'FFD1D5DB';

const UNKNOWN = 'Unknown';
const UNASSIGNED = 'Unassigned';
const NOT_APPLICABLE = 'Not applicable';
const RESTRICTED = 'Restricted';
const WITHHELD = 'Withheld';

const DOWNSTREAM_STATE_LABELS: Record<string, string> = {
	available: 'Available',
	restricted: RESTRICTED,
	unresolved: 'Unresolved',
	none: 'None',
};

type CellValue = string | number | boolean | null;

function textOr(value: string | null | undefined, fallback = UNKNOWN): string {
	return value === null || value === undefined || value === ''
		? fallback
		: value;
}

function yesNo(value: boolean): string {
	return value ? 'Yes' : 'No';
}

function stateLabel(state: string): string {
	return DOWNSTREAM_STATE_LABELS[state] ?? textOr(state);
}

function percent(rate: number | null): string {
	return rate === null ? NOT_APPLICABLE : `${rate}%`;
}

function durationText(seconds: number | null): string {
	if (seconds === null) return NOT_APPLICABLE;
	const negative = seconds < 0;
	const total = Math.abs(seconds);
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const minutes = Math.floor((total % 3600) / 60);
	const parts = [
		days > 0 ? `${days}d` : '',
		hours > 0 ? `${hours}h` : '',
		`${minutes}m`,
	].filter((part) => part !== '');
	return `${negative ? '-' : ''}${parts.join(' ')}`;
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

interface ColumnSpec {
	header: string;
	width: number;
}

interface DataSheetOptions {
	name: string;
	title: string;
	notes: string[];
	columns: ColumnSpec[];
}

function headerFill(cell: ExcelJS.Cell): void {
	cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
	cell.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: BRAND_PURPLE },
	};
	cell.alignment = { vertical: 'middle', horizontal: 'left' };
}

function borderRow(row: ExcelJS.Row): void {
	const border: Partial<ExcelJS.Borders> = {
		top: { style: 'hair', color: { argb: GRAY_BORDER } },
		left: { style: 'hair', color: { argb: GRAY_BORDER } },
		bottom: { style: 'hair', color: { argb: GRAY_BORDER } },
		right: { style: 'hair', color: { argb: GRAY_BORDER } },
	};
	row.eachCell({ includeEmpty: true }, (cell) => {
		cell.border = border;
	});
}

/** The Lead-level applied scope every detail sheet repeats. */
function leadFilterNotes(snapshot: LeadAuditExportSnapshot): string[] {
	const filters = snapshot.intake.scope.effective_filters;
	return [
		`Lead filters: owner ${filters.owner.label}; source ${filters.source.label}; stage ${filters.stage.label}; priority ${filters.priority ?? 'All priorities'}; search ${filters.search || 'None'}. Work and audit evidence filters are listed with their states in the Summary sheet.`,
	];
}

/** A data sheet whose method notes start with the shared applied scope. */
function dataSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot,
	options: DataSheetOptions
): ExcelJS.Worksheet {
	return createDataSheet(wb, {
		...options,
		notes: [...leadFilterNotes(snapshot), ...options.notes],
	});
}

/** A data sheet: title, method notes, then one stable header row. */
function createDataSheet(
	wb: ExcelJS.Workbook,
	options: DataSheetOptions
): ExcelJS.Worksheet {
	const sheet = wb.addWorksheet(options.name);
	const width = Math.max(1, options.columns.length);
	sheet.columns = options.columns.map((column) => ({ width: column.width }));
	sheet.mergeCells(1, 1, 1, width);
	const title = sheet.getCell(1, 1);
	title.value = options.title;
	title.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
	title.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: BRAND_PURPLE },
	};
	title.alignment = { vertical: 'middle' };
	sheet.getRow(1).height = 24;
	let rowNumber = 2;
	for (const note of options.notes) {
		sheet.mergeCells(rowNumber, 1, rowNumber, width);
		const cell = sheet.getCell(rowNumber, 1);
		cell.value = note;
		cell.font = { italic: true, size: 10, color: { argb: 'FF4B5563' } };
		cell.alignment = { vertical: 'top' };
		rowNumber += 1;
	}
	rowNumber += 1;
	const header = sheet.getRow(rowNumber);
	header.values = options.columns.map((column) => column.header);
	for (let index = 1; index <= width; index += 1) {
		headerFill(header.getCell(index));
	}
	header.height = 20;
	sheet.views = [{ state: 'frozen', ySplit: rowNumber }];
	return sheet;
}

function addRow(sheet: ExcelJS.Worksheet, values: CellValue[]): void {
	const raw = values.map((value) =>
		value === null || value === undefined ? '' : value
	);
	const row = sheet.addRow(raw);
	borderRow(row);
}

/* ------------------------------------------------------------------ */
/* Workbook                                                            */
/* ------------------------------------------------------------------ */

export async function buildLeadAuditWorkbook(
	snapshot: LeadAuditExportSnapshot
): Promise<Buffer> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.lastModifiedBy = 'Accent CRM';
	wb.created = new Date();
	wb.modified = new Date();

	buildSummarySheet(wb, snapshot);
	buildRegisterSheet(
		wb,
		'Lead intake register',
		'Lead intake register — Leads recorded',
		snapshot.register.recorded
	);
	buildRegisterSheet(
		wb,
		'Enquiries dated',
		'Lead intake register — Enquiries dated in period',
		snapshot.register.enquired
	);
	buildRegisterSheet(
		wb,
		'Missing Enquiry Dates',
		'Lead intake register — Missing Enquiry Dates',
		snapshot.register.missingEnquiryDate
	);
	buildSourcesSheet(wb, snapshot);
	buildCompletedWorkSheet(wb, snapshot);
	buildAuthorsSheet(wb, snapshot);
	buildWorkloadSheet(wb, snapshot);
	buildWorkloadLeadSheet(wb, snapshot);
	buildExceptionsSheet(wb, snapshot);
	buildCohortSheet(wb, snapshot);
	buildPeriodHandoffsSheet(wb, snapshot);
	buildDownstreamSheet(wb, snapshot);
	buildTimingSheet(wb, snapshot);
	buildAuditSheet(wb, snapshot);
	buildCorrectionsSheet(wb, snapshot);
	buildDeletedSheet(wb, snapshot);
	buildCoverageSheet(wb, snapshot);

	const buffer = await wb.xlsx.writeBuffer();
	return Buffer.from(buffer);
}

/* ---------------------------- Summary ----------------------------- */

type FigureRow = [string, CellValue];

function addFigureRows(
	sheet: ExcelJS.Worksheet,
	title: string,
	rows: FigureRow[]
): void {
	const heading = sheet.addRow([title]);
	heading.getCell(1).font = { bold: true, size: 11, color: { argb: BRAND_PURPLE } };
	const header = sheet.addRow(['Figure', 'Value']);
	headerFill(header.getCell(1));
	headerFill(header.getCell(2));
	for (const [label, value] of rows) {
		addRow(sheet, [label, value]);
	}
	sheet.addRow([]);
}

function buildSummarySheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = wb.addWorksheet('Summary and methodology');
	sheet.columns = [
		{ width: 40 },
		{ width: 28 },
		{ width: 16 },
		{ width: 16 },
		{ width: 14 },
		{ width: 60 },
	];
	sheet.mergeCells(1, 1, 1, 6);
	const title = sheet.getCell(1, 1);
	title.value = 'Lead Audit and Performance — complete evidence export';
	title.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
	title.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: BRAND_PURPLE },
	};
	title.alignment = { vertical: 'middle' };
	sheet.getRow(1).height = 26;

	const scope = snapshot.intake.scope;
	const meta = snapshot.intake.meta;
	const statement = sheet.addRow([
		'Evidence copy, not an immutable issued report',
		`Generated at ${meta.generated_at} in ${meta.time_zone.label}. This workbook is a live evidence copy of corrected facts at that observation. It need not equal an earlier screen observation, and a later download can legitimately differ.`,
	]);
	statement.getCell(1).font = { bold: true };
	statement.getCell(2).alignment = { wrapText: true, vertical: 'top' };
	sheet.getRow(statement.number).height = 44;
	sheet.addRow([]);

	addFigureRows(sheet, 'Observation and applied scope', [
		['Generation time', meta.generated_at],
		['Reporting time zone', meta.time_zone.label],
		['Reporting time zone (session / system)', `${meta.time_zone.session} / ${meta.time_zone.system}`],
		['Reporting time zone UTC offset', meta.time_zone.utc_offset],
		['Database calendar day', meta.today],
		['Period preset', scope.preset],
		['Period from (inclusive)', scope.from_date],
		['Period to (inclusive)', scope.to_date],
		['Lead scope date basis', scope.date_basis],
		['Work date basis', snapshot.work.work_date_basis],
		['Audit date basis', snapshot.audit.evidence_filters.date_basis],
		['Detailed evidence (narrative)', snapshot.options.includeNarrative ? 'Included' : 'Excluded (default)'],
		['Proposal context grant', snapshot.downstream.includeProposals ? 'Included' : RESTRICTED],
		['Project context grant', snapshot.downstream.includeProjects ? 'Included' : RESTRICTED],
		['Live data warning', meta.live_data_warning],
	]);

	addFigureRows(sheet, 'Applied filters', [
		['Current owner', scope.effective_filters.owner.label],
		['Source label', scope.effective_filters.source.label],
		['Current stage', scope.effective_filters.stage.label],
		['Priority', scope.effective_filters.priority ?? 'All priorities'],
		['Search', scope.effective_filters.search || 'None'],
		...snapshot.work.work_filters.applied.map(
			(filter): FigureRow => [
				`Work/audit filter: ${filter.label}`,
				`${filter.display} (${filter.state})`,
			]
		),
	]);

	addFigureRows(sheet, 'Metric definitions', [
		[
			snapshot.register.recorded.metric.label,
			snapshot.register.recorded.metric.definition,
		],
		[
			snapshot.register.enquired.metric.label,
			snapshot.register.enquired.metric.definition,
		],
		[
			snapshot.register.missingEnquiryDate.metric.label,
			snapshot.register.missingEnquiryDate.metric.definition,
		],
		...(
			[
				'completed',
				'outreach',
				'successful_contact',
				'note',
				'undated',
				'cancelled',
			] as const
		).map((key): FigureRow => [
			LEAD_AUDIT_WORK_METRICS[key].label,
			LEAD_AUDIT_WORK_METRICS[key].definition,
		]),
		[
			'Distinct Leads worked',
			'Distinct non-deleted Leads with at least one completed activity whose occurrence time falls inside the selected period. One-to-many activity and Proposal joins never multiply this count.',
		],
		[
			'Distinct Leads with outreach',
			'Distinct non-deleted Leads with at least one completed Call, Email, or Meeting in the period. Notes and scheduled work are not outreach.',
		],
		[
			'Lead Cohort Conversion Rate',
			'Distinct Leads of the Lead Intake Cohort with evidenced handoffs divided by all distinct Leads in that cohort, evaluated at the observation time. An empty cohort is Not applicable, never zero percent.',
		],
		[
			snapshot.timing.metric.label,
			`${snapshot.timing.metric.definition} Clock: ${snapshot.timing.metric.clock} Observation: ${snapshot.timing.metric.observation}`,
		],
		[
			'Current operational exceptions',
			'Live queue state at the observation time, not the backlog at the end of the selected period. Every counter counts distinct Leads; Overdue and Due today evidence identifies individual scheduled work items.',
		],
	]);

	const summary = snapshot.intake.summary;
	const workSummary = snapshot.work.summary;
	const cohort = snapshot.conversion.cohort;
	const period = snapshot.conversion.period;
	const risks = snapshot.currentState.risks;
	const deleted = snapshot.audit.deleted.summary;

	addFigureRows(sheet, 'Figures at this observation', [
		['Leads recorded', summary.leads_recorded],
		['Enquiries dated in period', summary.enquiries_dated],
		['Missing Enquiry Dates', summary.missing_enquiry_date],
		['Distinct stored source labels', summary.distinct_sources],
		['Completed work', workSummary.completed_total],
		['Completed calls', workSummary.by_type.call],
		['Completed emails', workSummary.by_type.email],
		['Completed meetings', workSummary.by_type.meeting],
		['Completed notes', workSummary.by_type.note],
		['Unknown activity types', workSummary.by_type.unknown],
		['Lead Outreach', workSummary.outreach_total],
		['Distinct Leads worked', workSummary.distinct_leads_worked],
		['Distinct Leads with outreach', workSummary.distinct_leads_with_outreach],
		['Successful contact', workSummary.successful_contact],
		['Distinct Leads with successful contact', workSummary.distinct_leads_with_successful_contact],
		['Current-owner workload (distinct Leads)', snapshot.currentState.workload.total],
		...risks.map(
			(risk): FigureRow => [`Current exception: ${risk.label}`, risk.count]
		),
		['Lead Intake Cohort', cohort.cohort_size],
		['Handoffs evidenced', cohort.handoffs_evidenced],
		['Lead Cohort Conversion Rate', percent(cohort.conversion_rate)],
		['Period handoffs (dated)', period.handoffs],
		['Undated canonical links (period)', period.undated_canonical_links],
		['Median duration (readable)', snapshot.timing.available ? durationText(snapshot.timing.median_seconds) : NOT_APPLICABLE],
		['Median seconds', snapshot.timing.median_seconds ?? NOT_APPLICABLE],
		['90th percentile seconds', snapshot.timing.p90_seconds ?? NOT_APPLICABLE],
		['Valid timing samples', snapshot.timing.valid_samples],
		['Cohort Leads without evidenced outreach', snapshot.timing.without_outreach],
		['Audit evidence in period', snapshot.audit.summary.evidence_in_period],
		['Retained deleted evidence in view', deleted.evidence_in_view],
	]);

	buildReconciliation(sheet, snapshot);

	addFigureRows(
		sheet,
		'Coverage and exclusions',
		snapshot.coverage.exclusions.map((exclusion): FigureRow => [
			`${exclusion.label} excluded from ${exclusion.metric}`,
			`${exclusion.excluded ?? NOT_APPLICABLE} — ${exclusion.reason}`,
		])
	);

	addFigureRows(sheet, 'Sheet guide', [
		['Summary and methodology', 'Observation, applied scope, definitions, figures, reconciliation, coverage.'],
		['Lead intake register', 'Complete Leads recorded in period.'],
		['Enquiries dated', 'Complete Leads whose stated Enquiry Date is in period.'],
		['Missing Enquiry Dates', 'Complete recorded Leads with no stated Enquiry Date.'],
		['Sources', 'Recorded Leads by exact stored source label; missing labels are Unknown source.'],
		['Completed work', 'Complete completed-activity population for the period.'],
		['Work by recorded author', 'Completed work grouped by recorded author, including Unknown author.'],
		['Current-owner workload', 'Present owner groups at the observation time.'],
		['Workload Leads', 'One row per Lead in the current-owner workload.'],
		['Current operational exceptions', 'Live queue rows, labelled as current state at observation time.'],
		['Cohort conversion', 'Cohort and period figures, stage distribution, and source cohorts.'],
		['Period handoffs', 'Dated handoff detail rows behind the period handoff count.'],
		['Downstream context', 'Permitted Proposal and Project fields; denied facts are Restricted, never blank.'],
		['Time to first outreach', 'Timing summary and one row per cohort Lead with coverage status.'],
		['Audit evidence', 'Structured audit evidence selected by recording time.'],
		['Corrections', 'Correction references and changed fields; values only with detailed evidence.'],
		['Deleted evidence', 'Retained deleted-record evidence, separate from every operational total.'],
		['Coverage and exclusions', 'Unknown facts, metric exclusions, history limits, and disclosures.'],
	]);
}

function buildReconciliation(
	sheet: ExcelJS.Worksheet,
	snapshot: LeadAuditExportSnapshot
): void {
	const cohortIds = new Set(
		snapshot.register.recorded.leads.map((lead) => lead.id)
	);
	const cohortRows = snapshot.conversionRows.filter((row) =>
		cohortIds.has(row.id)
	);
	const risks = snapshot.currentState.risks;
	const checks: Array<[string, string, CellValue, CellValue]> = [
		[
			'Intake',
			'Leads recorded vs register rows',
			snapshot.intake.summary.leads_recorded,
			snapshot.register.recorded.leads.length,
		],
		[
			'Intake',
			'Enquiries dated vs detail rows',
			snapshot.intake.summary.enquiries_dated,
			snapshot.register.enquired.leads.length,
		],
		[
			'Intake',
			'Missing Enquiry Dates vs detail rows',
			snapshot.intake.summary.missing_enquiry_date,
			snapshot.register.missingEnquiryDate.leads.length,
		],
		[
			'Sources',
			'Recorded Leads vs source group counts',
			snapshot.intake.summary.leads_recorded,
			snapshot.intake.sources.reduce((total, group) => total + group.count, 0),
		],
		[
			'Sources',
			'Distinct source labels vs source rows',
			snapshot.intake.summary.distinct_sources,
			snapshot.intake.sources.length,
		],
		[
			'Work',
			'Completed work vs completed activity rows',
			snapshot.work.summary.completed_total,
			snapshot.workRows.length,
		],
		[
			'Work',
			'Completed work vs author totals',
			snapshot.work.summary.completed_total,
			snapshot.work.authors.reduce(
				(total, author) => total + author.completed_total,
				0
			),
		],
		[
			'Current state',
			'Workload total vs workload Lead rows',
			snapshot.currentState.workload.total,
			snapshot.currentState.workload_rows.length,
		],
		[
			'Current state',
			'Workload total vs owner groups',
			snapshot.currentState.workload.total,
			snapshot.currentState.workload.owners.reduce(
				(total, group) => total + group.count,
				0
			),
		],
		...risks.map((risk): [string, string, CellValue, CellValue] => [
			'Current state',
			`${risk.label} vs distinct detail Leads`,
			risk.count,
			new Set(
				snapshot.currentState.risk_rows[risk.key].map((row) => row.lead.id)
			).size,
		]),
		[
			'Conversion',
			'Cohort size vs recorded Lead rows',
			snapshot.conversion.cohort.cohort_size,
			cohortRows.length,
		],
		[
			'Conversion',
			'Handoffs evidenced vs cohort detail rows',
			snapshot.conversion.cohort.handoffs_evidenced,
			cohortRows.filter((row) => row.handoff_evidenced).length,
		],
		[
			'Conversion',
			'Period handoffs vs dated handoff rows',
			snapshot.conversion.period.handoffs,
			snapshot.conversionRows.filter((row) => row.in_period_handoff)
				.length,
		],
		[
			'Timing',
			'Valid samples vs sampled cohort rows',
			snapshot.timing.valid_samples,
			snapshot.timingRows.filter((row) => row.status === 'sampled').length,
		],
		[
			'Timing',
			'Without outreach vs untouched cohort rows',
			snapshot.timing.without_outreach,
			snapshot.timingRows.filter((row) => row.status === 'no_outreach')
				.length,
		],
		[
			'Audit',
			'Evidence in period vs audit rows',
			snapshot.audit.summary.evidence_in_period,
			snapshot.auditRows.length,
		],
		[
			'Audit',
			'Deleted evidence in view vs deleted rows',
			snapshot.audit.deleted.summary.evidence_in_view,
			snapshot.deletedRows.length,
		],
	];

	const heading = sheet.addRow(['Reconciliation with detail rows']);
	heading.getCell(1).font = {
		bold: true,
		size: 11,
		color: { argb: BRAND_PURPLE },
	};
	const header = sheet.addRow([
		'Section',
		'Summary figure',
		'Reported value',
		'Detail rows',
		'Reconciles',
	]);
	for (let index = 1; index <= 5; index += 1) {
		headerFill(header.getCell(index));
	}
	for (const [section, figure, reported, detail] of checks) {
		addRow(sheet, [section, figure, reported, detail, yesNo(reported === detail)]);
	}
	sheet.addRow([]);
}

/* --------------------------- Registers ---------------------------- */

function buildRegisterSheet(
	wb: ExcelJS.Workbook,
	sheetName: string,
	title: string,
	register: LeadAuditRegisterResult
): void {
	const sheet = createDataSheet(wb, {
		name: sheetName,
		title,
		notes: [
			`Metric: ${register.metric.label}. ${register.metric.definition}`,
			`Complete applied result (${register.total} rows), not a page. Applied scope: ${register.scope.effective_filters.owner.label}, ${register.scope.effective_filters.source.label}, ${register.scope.effective_filters.stage.label}, priority ${register.scope.effective_filters.priority ?? 'all'}, search ${register.scope.effective_filters.search || 'none'}.`,
		],
		columns: [
			{ header: 'Lead reference', width: 18 },
			{ header: 'Lead id', width: 10 },
			{ header: 'Company', width: 32 },
			{ header: 'Contact', width: 24 },
			{ header: 'Source', width: 22 },
			{ header: 'Priority', width: 12 },
			{ header: 'Current stage', width: 20 },
			{ header: 'Current owner', width: 24 },
			{ header: 'Enquiry Date', width: 16 },
			{ header: 'Recorded at', width: 20 },
		],
	});
	for (const lead of register.leads) {
		addRow(sheet, [
			textOr(lead.lead_id, 'Not assigned'),
			lead.id,
			lead.company_name,
			textOr(lead.contact_name),
			lead.source.is_unknown ? 'Unknown source' : textOr(lead.source.label),
			textOr(lead.priority),
			textOr(lead.stage.label),
			lead.owner
				? textOr(lead.owner.name, `Unknown user #${lead.owner.id}`)
				: UNASSIGNED,
			textOr(lead.enquiry_date),
			textOr(lead.recorded_at),
		]);
	}
}

/* ---------------------------- Sources ----------------------------- */

function buildSourcesSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = dataSheet(wb, snapshot, {
		name: 'Sources',
		title: 'Sources — recorded Lead volume by stored label',
		notes: [
			'Each row is one exact stored source label, grouped without normalization or merging. Missing labels are grouped as Unknown source. Counts are distinct Leads recorded in the period and sum to Leads recorded.',
			'Source volume is not advertising efficiency, and no label is rewritten.',
		],
		columns: [
			{ header: 'Source label', width: 32 },
			{ header: 'Is unknown', width: 12 },
			{ header: 'Leads recorded', width: 16 },
		],
	});
	for (const group of snapshot.intake.sources) {
		addRow(sheet, [
			group.is_unknown ? 'Unknown source' : textOr(group.label),
			yesNo(group.is_unknown),
			group.count,
		]);
	}
}

/* ------------------------- Completed work ------------------------- */

function buildCompletedWorkSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = dataSheet(wb, snapshot, {
		name: 'Completed work',
		title: 'Completed work — every completed activity in the period',
		notes: [
			snapshot.work.work_date_basis,
			LEAD_AUDIT_WORK_METRICS.completed.definition,
			'Scheduled, cancelled, and Proposal-transferred work is not completed work. Activity authorship is the recorded author, never the current Lead owner.',
		],
		columns: [
			{ header: 'Activity', width: 12 },
			{ header: 'Lead reference', width: 18 },
			{ header: 'Company', width: 30 },
			{ header: 'Current owner', width: 22 },
			{ header: 'Activity type', width: 16 },
			{ header: 'Status', width: 12 },
			{ header: 'Call outcome', width: 16 },
			{ header: 'Reply confirmed', width: 14 },
			{ header: 'Occurred at', width: 20 },
			{ header: 'Recorded at', width: 20 },
			{ header: 'Recorded author', width: 24 },
			{ header: 'Author state', width: 16 },
			{ header: 'Outreach', width: 10 },
			{ header: 'Successful contact', width: 16 },
			{ header: 'Corrected', width: 10 },
		],
	});
	for (const activity of snapshot.workRows) {
		addRow(sheet, [
			activity.id,
			textOr(activity.lead.lead_id, 'Not assigned'),
			activity.lead.company_name,
			activity.lead.current_owner
				? textOr(
						activity.lead.current_owner.name,
						`Unknown user #${activity.lead.current_owner.id}`
					)
				: UNASSIGNED,
			activity.activity_type.is_unknown
				? 'Unknown activity type'
				: activity.activity_type.label,
			textOr(activity.status),
			textOr(activity.call_outcome),
			activity.reply_confirmed === null
				? UNKNOWN
				: yesNo(activity.reply_confirmed),
			textOr(activity.occurred_at),
			textOr(activity.recorded_at),
			textOr(activity.author.name, 'Unknown author'),
			activity.author.is_unknown
				? 'Unknown author'
				: activity.author.is_inactive
					? 'Inactive account'
					: 'Recorded account',
			yesNo(activity.is_outreach),
			yesNo(activity.is_successful_contact),
			yesNo(activity.corrected),
		]);
	}
}

function buildAuthorsSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = dataSheet(wb, snapshot, {
		name: 'Work by recorded author',
		title: 'Work by recorded author — completed activities grouped by author',
		notes: [
			'Authorship is the recorded activity author. Reassigning a Lead owner never reattributes historical work. Unknown authors and retained inactive accounts stay represented.',
			'Rows sum to the completed work total; each distinct-Lead count is per author and is never summed across authors.',
		],
		columns: [
			{ header: 'Recorded author', width: 28 },
			{ header: 'Author state', width: 18 },
			{ header: 'Completed', width: 12 },
			{ header: 'Calls', width: 10 },
			{ header: 'Emails', width: 10 },
			{ header: 'Meetings', width: 10 },
			{ header: 'Notes', width: 10 },
			{ header: 'Unknown type', width: 14 },
			{ header: 'Outreach', width: 12 },
			{ header: 'Successful contact', width: 18 },
			{ header: 'Distinct Leads', width: 14 },
		],
	});
	for (const author of snapshot.work.authors) {
		addRow(sheet, [
			author.author.is_unknown
				? 'Unknown author'
				: textOr(author.author.name, 'Unknown author'),
			author.author.is_unknown
				? 'Unknown author'
				: author.author.is_inactive
					? 'Inactive account'
					: 'Recorded account',
			author.completed_total,
			author.by_type.call,
			author.by_type.email,
			author.by_type.meeting,
			author.by_type.note,
			author.by_type.unknown,
			author.outreach_total,
			author.successful_contact,
			author.distinct_leads,
		]);
	}
}

/* ------------------------- Current state -------------------------- */

function buildWorkloadSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const workload = snapshot.currentState.workload;
	const sheet = dataSheet(wb, snapshot, {
		name: 'Current-owner workload',
		title: 'Current-owner workload — live state at observation time',
		notes: [
			`${CURRENT_STATE_WORKLOAD_DEFINITION} Observed at ${snapshot.currentState.as_of.generated_at} on ${snapshot.currentState.as_of.today} (${snapshot.currentState.as_of.time_zone.label}).`,
			'This is not the selected period end. Reassignment changes these groups without changing recorded activity authorship.',
		],
		columns: [
			{ header: 'Current owner', width: 30 },
			{ header: 'Account state', width: 18 },
			{ header: 'Distinct Leads', width: 16 },
		],
	});
	for (const group of workload.owners) {
		addRow(sheet, [
			group.owner.is_unknown
				? 'Unknown user reference'
				: group.owner.name,
			group.owner.is_unknown
				? 'Unknown user reference'
				: group.owner.is_inactive
					? 'Inactive account'
					: group.owner.id === null
						? UNASSIGNED
						: 'Recorded account',
			group.count,
		]);
	}
	addRow(sheet, ['Total', 'Distinct Leads', workload.total]);
}

function buildWorkloadLeadSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = dataSheet(wb, snapshot, {
		name: 'Workload Leads',
		title: 'Current-owner workload — complete Lead detail',
		notes: [
			CURRENT_STATE_WORKLOAD_DEFINITION,
			'Each row is one distinct Lead at the observation time; deleted Leads are excluded.',
		],
		columns: [
			{ header: 'Lead reference', width: 18 },
			{ header: 'Company', width: 30 },
			{ header: 'Contact', width: 22 },
			{ header: 'Source', width: 20 },
			{ header: 'Priority', width: 12 },
			{ header: 'Current stage', width: 20 },
			{ header: 'Current owner', width: 24 },
			{ header: 'Enquiry Date', width: 16 },
			{ header: 'Recorded at', width: 20 },
		],
	});
	for (const row of snapshot.currentState.workload_rows) {
		addRow(sheet, [
			textOr(row.lead.lead_id, 'Not assigned'),
			row.lead.company_name,
			textOr(row.lead.contact_name),
			row.source.is_unknown ? 'Unknown source' : textOr(row.source.label),
			textOr(row.priority),
			textOr(row.stage.label),
			row.owner.is_unknown
				? 'Unknown user reference'
				: row.owner.id === null
					? UNASSIGNED
					: textOr(row.owner.name),
			textOr(row.enquiry_date),
			textOr(row.recorded_at),
		]);
	}
}

function buildExceptionsSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = dataSheet(wb, snapshot, {
		name: 'Current operational exceptions',
		title: 'Current operational exceptions — live state at observation time',
		notes: [
			`Observed at ${snapshot.currentState.as_of.generated_at} on ${snapshot.currentState.as_of.today} (${snapshot.currentState.as_of.time_zone.label}). These are current risks, not the backlog at the end of the selected period.`,
			'Every counter counts distinct Leads. Overdue and Due today evidence identifies individual scheduled work items, so their rows can exceed their distinct-Lead counts.',
			...CURRENT_STATE_RISK_DEFINITIONS.map(
				(risk) => `${risk.label}: ${risk.definition}`
			),
		],
		columns: [
			{ header: 'Risk', width: 20 },
			{ header: 'Evidence unit', width: 20 },
			{ header: 'Lead reference', width: 18 },
			{ header: 'Company', width: 30 },
			{ header: 'Current owner', width: 24 },
			{ header: 'Source', width: 20 },
			{ header: 'Priority', width: 12 },
			{ header: 'Current stage', width: 20 },
			{ header: 'Enquiry Date', width: 16 },
			{ header: 'Recorded at', width: 20 },
			{ header: 'Scheduled work item', width: 18 },
			{ header: 'Work item type', width: 16 },
			{ header: 'Scheduled for', width: 20 },
		],
	});
	for (const risk of snapshot.currentState.risks) {
		const rows = snapshot.currentState.risk_rows[risk.key];
		for (const row of rows) {
			addRow(sheet, [
				risk.label,
				risk.evidence_unit === 'scheduled_work_item'
					? 'Scheduled work item'
					: 'Lead',
				textOr(row.lead.lead_id, 'Not assigned'),
				row.lead.company_name,
				row.owner.is_unknown
					? 'Unknown user reference'
					: row.owner.id === null
						? UNASSIGNED
						: textOr(row.owner.name),
				row.source.is_unknown ? 'Unknown source' : textOr(row.source.label),
				textOr(row.priority),
				textOr(row.stage.label),
				textOr(row.enquiry_date),
				textOr(row.recorded_at),
				row.work_item ? row.work_item.id : NOT_APPLICABLE,
				row.work_item
					? textOr(row.work_item.activity_type, 'Unknown activity type')
					: NOT_APPLICABLE,
				row.work_item ? textOr(row.work_item.scheduled_for) : NOT_APPLICABLE,
			]);
		}
	}
}

/* --------------------------- Conversion --------------------------- */

function buildCohortSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const cohort = snapshot.conversion.cohort;
	const period = snapshot.conversion.period;
	const downstream = snapshot.conversion.downstream;
	const sheet = dataSheet(wb, snapshot, {
		name: 'Cohort conversion',
		title: 'Cohort conversion and downstream context',
		notes: [
			`The Lead Intake Cohort is the distinct non-deleted Leads recorded in the selected period. Progress is observed at ${cohort.observed_through}.`,
			'Handoff evidence is a recorded conversion event or an evidence-backed resolved canonical Proposal link. A Converted stage label alone is not handoff evidence.',
			'Period handoffs use authoritative conversion dates inside the period and are never divided by period intake to describe a conversion rate.',
			'Recent cohorts have had less time to progress. Downstream Proposal fields need proposals:read and Project fields need projects:read; denied facts are Restricted, not absent.',
			'Current stage distribution is present state at observation time, not a sequential funnel.',
		],
		columns: [
			{ header: 'Metric', width: 34 },
			{ header: 'Value', width: 20 },
			{ header: 'Definition', width: 70 },
		],
	});
	sheet.getColumn(4).width = 22;
	sheet.getColumn(5).width = 18;
	sheet.getColumn(6).width = 18;
	const cohortRows: Array<[string, CellValue, string]> = [
		['Cohort Leads', cohort.cohort_size, 'Distinct non-deleted Leads recorded in the selected period.'],
		['Handoffs evidenced', cohort.handoffs_evidenced, 'Cohort Leads with a recorded conversion event or an evidenced resolved canonical Proposal link.'],
		['Lead Cohort Conversion Rate', percent(cohort.conversion_rate), 'Handoffs evidenced divided by cohort Leads. Not applicable for an empty cohort; never zero percent.'],
		['Conversion events', cohort.conversion_events, 'Cohort Leads with a recorded conversion event.'],
		['Undated canonical links', cohort.undated_links, 'Cohort Leads supported by a resolved canonical link with no authoritative conversion date.'],
		['Unresolved evidence', cohort.unresolved_evidence, 'Cohort Leads with unresolved legacy links: an evidence gap, not a confirmed failure.'],
		['Stage-only claims', cohort.stage_only_claims, 'Cohort Leads with a Converted stage label and no further handoff evidence.'],
		['No handoff evidence', cohort.no_handoff_evidence, 'Cohort Leads with no handoff and no unresolved or stage-only evidence.'],
		['Period handoffs (dated)', period.handoffs, 'Distinct Leads with an authoritative conversion date inside the selected period.'],
		['Undated canonical links (period view)', period.undated_canonical_links, 'Resolved canonical links without a conversion date. They cannot become a dated period conversion.'],
		['Proposal context: available', downstream.proposal_states.available, 'Handoff Leads whose Proposal fields the reader may see.'],
		['Proposal context: restricted', downstream.proposal_states.restricted, 'Handoff Leads whose Proposal fields are withheld.'],
		['Proposal context: unresolved', downstream.proposal_states.unresolved, 'Handoff Leads with no resolved canonical Proposal.'],
		['Proposal context: none', downstream.proposal_states.none, 'Handoff Leads with no linked Proposal record.'],
		['Project context: available', downstream.project_states.available, 'Linked Projects the reader may see.'],
		['Project context: restricted', downstream.project_states.restricted, 'Linked Projects withheld by the Project read grant.'],
		['Project context: none', downstream.project_states.none, 'Handoff Leads with no linked Project.'],
		['Period date basis', period.date_basis, 'The authoritative conversion time, never Proposal creation or Lead editing time.'],
	];
	for (const [label, value, definition] of cohortRows) {
		addRow(sheet, [label, value, definition]);
	}
	sheet.addRow([]);
	const stageHeading = sheet.addRow(['Current stage distribution (present state)']);
	stageHeading.getCell(1).font = {
		bold: true,
		color: { argb: BRAND_PURPLE },
	};
	const stageHeader = sheet.addRow(['Current stage', 'Cohort Leads', 'Note']);
	for (let index = 1; index <= 3; index += 1) {
		headerFill(stageHeader.getCell(index));
	}
	for (const entry of snapshot.conversion.stage_distribution) {
		addRow(sheet, [
			textOr(entry.stage.label),
			entry.count,
			'Present state at observation time, not a funnel step count.',
		]);
	}
	sheet.addRow([]);
	const sourceHeading = sheet.addRow(['Source cohorts']);
	sourceHeading.getCell(1).font = {
		bold: true,
		color: { argb: BRAND_PURPLE },
	};
	const sourceHeader = sheet.addRow([
		'Source label',
		'Cohort Leads',
		'Handoffs evidenced',
		'Conversion rate',
		'Unresolved evidence',
		'Stage-only claims',
	]);
	for (let index = 1; index <= 6; index += 1) {
		headerFill(sourceHeader.getCell(index));
	}
	for (const source of snapshot.conversion.source_conversion) {
		addRow(sheet, [
			source.is_unknown ? 'Unknown source' : textOr(source.label),
			source.cohort_size,
			source.handoffs_evidenced,
			percent(source.conversion_rate),
			source.unresolved_evidence,
			source.stage_only_claims,
		]);
	}
}

function buildPeriodHandoffsSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = dataSheet(wb, snapshot, {
		name: 'Period handoffs',
		title: 'Period handoffs — authoritative conversion dates in period',
		notes: [
			snapshot.conversion.period.date_basis,
			'An undated canonical link supports cohort evidence but is not a dated period conversion. A Converted label, Proposal creation, or Lead update time is never substituted.',
		],
		columns: [
			{ header: 'Lead reference', width: 18 },
			{ header: 'Company', width: 30 },
			{ header: 'Conversion at', width: 20 },
			{ header: 'Evidence', width: 22 },
			{ header: 'Source', width: 20 },
			{ header: 'Current stage', width: 20 },
		],
	});
	for (const row of snapshot.conversionRows) {
		if (!row.in_period_handoff) continue;
		addRow(sheet, [
			textOr(row.lead_id, 'Not assigned'),
			row.company_name,
			textOr(row.conversion_at),
			row.evidence === 'conversion_event'
				? 'Recorded conversion event'
				: 'Resolved canonical link',
			row.source.is_unknown ? 'Unknown source' : textOr(row.source.label),
			textOr(row.stage.label),
		]);
	}
}

function buildDownstreamSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const sheet = dataSheet(wb, snapshot, {
		name: 'Downstream context',
		title: 'Downstream context — permitted Proposal and Project fields',
		notes: [
			'Lead Conversion is a Proposal handoff, not a sale. Proposal status and progress need proposals:read; Project details need projects:read.',
			'Denied fields are removed from this workbook. The state cell reads Restricted, which is not the same as no downstream record.',
			'Only the fields this export may disclose are present; restricted identifiers and titles are absent, never blank placeholders for known data.',
		],
		columns: [
			{ header: 'Lead reference', width: 18 },
			{ header: 'Company', width: 30 },
			{ header: 'Handoff evidence', width: 20 },
			{ header: 'Conversion at', width: 20 },
			{ header: 'Proposal state', width: 16 },
			{ header: 'Proposal id', width: 12 },
			{ header: 'Proposal title', width: 32 },
			{ header: 'Proposal status', width: 18 },
			{ header: 'Proposal progress %', width: 18 },
			{ header: 'Project state', width: 16 },
			{ header: 'Project id', width: 12 },
			{ header: 'Project title', width: 32 },
			{ header: 'Project status', width: 18 },
			{ header: 'Project progress %', width: 18 },
		],
	});
	for (const row of snapshot.conversionRows) {
		const proposal = row.downstream.proposal;
		const project = proposal?.project ?? null;
		const projectState = proposal
			? (proposal.project_state ?? 'none')
			: row.downstream.proposal_state === 'restricted'
				? 'restricted'
				: 'none';
		const proposalRestricted =
			row.downstream.proposal_state === 'restricted';
		const projectRestricted = projectState === 'restricted';
		addRow(sheet, [
			textOr(row.lead_id, 'Not assigned'),
			row.company_name,
			row.handoff_evidenced
				? row.evidence === 'conversion_event'
					? 'Recorded conversion event'
					: 'Resolved canonical link'
				: 'No evidenced handoff',
			textOr(row.conversion_at),
			stateLabel(row.downstream.proposal_state),
			proposal
				? proposal.id
				: proposalRestricted
					? ''
					: NOT_APPLICABLE,
			proposal
				? textOr(proposal.title)
				: proposalRestricted
					? ''
					: NOT_APPLICABLE,
			proposal
				? textOr(proposal.status)
				: proposalRestricted
					? ''
					: NOT_APPLICABLE,
			proposal
				? proposal.progress === null
					? UNKNOWN
					: proposal.progress
				: proposalRestricted
					? ''
					: NOT_APPLICABLE,
			stateLabel(projectState),
			project
				? project.id
				: projectRestricted
					? ''
					: NOT_APPLICABLE,
			project
				? textOr(project.title)
				: projectRestricted
					? ''
					: NOT_APPLICABLE,
			project
				? textOr(project.status)
				: projectRestricted
					? ''
					: NOT_APPLICABLE,
			project
				? project.progress === null
					? UNKNOWN
					: project.progress
				: projectRestricted
					? ''
					: NOT_APPLICABLE,
		]);
	}
}

/* ----------------------------- Timing ----------------------------- */

function buildTimingSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const timing = snapshot.timing;
	const sheet = dataSheet(wb, snapshot, {
		name: 'Time to first outreach',
		title: 'Time to first outreach — cohort timing and coverage',
		notes: [
			`${timing.metric.definition} Clock: ${timing.metric.clock} Observation: ${timing.metric.observation}`,
			'This is elapsed calendar time from system entry to the earliest evidenced completed outreach occurrence. It is not Client response time, and there is no service target or business-hours rule.',
			'Missing timestamps are excluded, incomplete earlier evidence is excluded rather than overstated, and negative intervals are shown as measured rather than clamped.',
			`Coverage: ${timing.cohort_leads} cohort Leads, ${timing.valid_samples} valid samples, ${timing.without_outreach} without evidenced outreach, ${timing.exclusions.missing_timestamp} missing timestamps, ${timing.exclusions.incomplete_earlier} incomplete earlier evidence, ${timing.exclusions.negative} negative intervals.`,
		],
		columns: [
			{ header: 'Figure', width: 34 },
			{ header: 'Value', width: 24 },
			{ header: 'Meaning', width: 70 },
		],
	});
	const summaryRows: Array<[string, CellValue, string]> = [
		['Available', yesNo(timing.available), 'False when no cohort Lead has a valid measured interval.'],
		['Median seconds', timing.median_seconds ?? NOT_APPLICABLE, 'For an even sample, the mean of the two middle observed durations.'],
		['Median (readable)', timing.available ? durationText(timing.median_seconds) : NOT_APPLICABLE, 'Display only; the measured value is in seconds.'],
		['90th percentile seconds', timing.p90_seconds ?? NOT_APPLICABLE, 'Nearest-rank percentile at the rounded-up rank.'],
		['90th percentile (readable)', timing.available ? durationText(timing.p90_seconds) : NOT_APPLICABLE, 'Display only.'],
		['Valid samples', timing.valid_samples, 'Cohort Leads with a valid measured interval.'],
		['Cohort Leads', timing.cohort_leads, 'The Lead Intake Cohort under the applied filters.'],
		['Leads without evidenced outreach', timing.without_outreach, 'Cohort Leads with no evidenced completed outreach.'],
		['Share without evidenced outreach', timing.without_outreach_share === null ? NOT_APPLICABLE : `${Math.round(timing.without_outreach_share * 10000) / 100}%`, 'Null for an empty cohort, never zero percent.'],
		['Excluded: missing timestamps', timing.exclusions.missing_timestamp, 'Completed outreach exists but no occurrence time is recorded.'],
		['Excluded: incomplete earlier evidence', timing.exclusions.incomplete_earlier, 'A known outreach time is accompanied by unknown earlier evidence.'],
		['Excluded: negative intervals', timing.exclusions.negative, 'The earliest evidenced outreach precedes system entry; shown as measured.'],
	];
	for (const [label, value, meaning] of summaryRows) {
		addRow(sheet, [label, value, meaning]);
	}
	sheet.addRow([]);
	const heading = sheet.addRow(['Lead timing detail']);
	heading.getCell(1).font = { bold: true, color: { argb: BRAND_PURPLE } };
	const header = sheet.addRow([
		'Lead reference',
		'Company',
		'Contact',
		'Recorded at',
		'Status',
		'Duration seconds',
		'Duration (readable)',
		'First outreach at',
		'First outreach type',
		'First outreach activity',
		'Completed outreach count',
		'Unknown occurrence count',
		'Exclusion reason',
	]);
	for (let index = 1; index <= 13; index += 1) {
		headerFill(header.getCell(index));
	}
	for (const row of snapshot.timingRows) {
		addRow(sheet, [
			textOr(row.lead_reference, 'Not assigned'),
			row.company_name,
			textOr(row.contact_name),
			textOr(row.recorded_at),
			row.status,
			row.duration_seconds === null ? UNKNOWN : row.duration_seconds,
			durationText(row.duration_seconds),
			textOr(row.first_outreach_at),
			textOr(row.first_outreach_type),
			row.first_outreach_id === null ? NOT_APPLICABLE : row.first_outreach_id,
			row.completed_outreach_count,
			row.unknown_occurrence_count,
			textOr(row.exclusion_reason, 'None'),
		]);
	}
}

/* ------------------------------ Audit ----------------------------- */

function entityFields(row: LeadAuditEvidenceExportRow): CellValue[] {
	return [
		row.evidence_type,
		row.reference,
		row.source_table,
		textOr(row.lead_code, 'Not assigned'),
		row.company_name,
		row.actor_unknown ? 'Unknown actor' : textOr(row.actor_name, 'Unknown actor'),
		yesNo(row.actor_unknown),
		textOr(row.occurred_at),
		yesNo(row.occurrence_known),
		textOr(row.recorded_at),
		textOr(row.activity_type),
		textOr(row.call_outcome),
		row.reply_confirmed === null ? UNKNOWN : yesNo(row.reply_confirmed),
		textOr(row.status),
		row.summary,
		yesNo(row.legacy),
		row.change_fields === '' ? 'None' : row.change_fields,
		yesNo(row.has_narrative),
		row.narrative_withheld ? WITHHELD : 'No',
		stateLabel(row.proposal_state),
		row.proposal_id !== null
			? row.proposal_id
			: row.proposal_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
		row.proposal_title !== null
			? row.proposal_title
			: row.proposal_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
		row.proposal_status !== null
			? row.proposal_status
			: row.proposal_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
		row.proposal_progress !== null
			? row.proposal_progress
			: row.proposal_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
		stateLabel(row.project_state),
		row.project_id !== null
			? row.project_id
			: row.project_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
		row.project_title !== null
			? row.project_title
			: row.project_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
		row.project_status !== null
			? row.project_status
			: row.project_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
		row.project_progress !== null
			? row.project_progress
			: row.project_state === 'restricted'
				? ''
				: NOT_APPLICABLE,
	];
}

function entityColumns(includeNarrative: boolean): ColumnSpec[] {
	const columns: ColumnSpec[] = [
		{ header: 'Evidence type', width: 18 },
		{ header: 'Reference', width: 18 },
		{ header: 'Source table', width: 24 },
		{ header: 'Lead reference', width: 18 },
		{ header: 'Company', width: 30 },
		{ header: 'Actor', width: 24 },
		{ header: 'Actor unknown', width: 14 },
		{ header: 'Occurred at', width: 20 },
		{ header: 'Occurrence known', width: 16 },
		{ header: 'Recorded at', width: 20 },
		{ header: 'Activity type', width: 16 },
		{ header: 'Call outcome', width: 16 },
		{ header: 'Reply confirmed', width: 14 },
		{ header: 'Status', width: 14 },
		{ header: 'Summary', width: 44 },
		{ header: 'Legacy', width: 10 },
		{ header: 'Changed fields', width: 24 },
		{ header: 'Narrative available', width: 18 },
		{ header: 'Narrative withheld', width: 18 },
		{ header: 'Proposal state', width: 16 },
		{ header: 'Proposal id', width: 12 },
		{ header: 'Proposal title', width: 30 },
		{ header: 'Proposal status', width: 18 },
		{ header: 'Proposal progress %', width: 18 },
		{ header: 'Project state', width: 16 },
		{ header: 'Project id', width: 12 },
		{ header: 'Project title', width: 30 },
		{ header: 'Project status', width: 18 },
		{ header: 'Project progress %', width: 18 },
	];
	if (includeNarrative) {
		columns.push(
			{ header: 'Narrative fields', width: 50 },
			{ header: 'Original and corrected values', width: 50 }
		);
	}
	return columns;
}

function narrativeCells(row: LeadAuditEvidenceExportRow): CellValue[] {
	const fields = (row.narrative_fields ?? [])
		.map((field) => `${field.label}: ${field.value ?? UNKNOWN}`)
		.join('\n');
	const changes = (row.narrative_changes ?? [])
		.map(
			(change) =>
				`${change.label}: ${change.from ?? UNKNOWN} -> ${change.to ?? UNKNOWN}`
		)
		.join('\n');
	return [fields, changes];
}

function buildAuditSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const includeNarrative = snapshot.options.includeNarrative;
	const sheet = dataSheet(wb, snapshot, {
		name: 'Audit evidence',
		title: 'Audit evidence — structured evidence selected by recording time',
		notes: [
			snapshot.audit.evidence_filters.date_basis,
			`Evidence recorded in the selected period: ${snapshot.audit.summary.evidence_in_period} rows. Occurrence time is shown separately and never selects these rows.`,
			'Unknown historical actors, outcomes, and occurrence times stay Unknown. The current owner and latest editor are never substituted.',
			includeNarrative
				? 'Detailed evidence was explicitly included: notes, reasons, and original/corrected values appear as plain text cells.'
				: 'Detailed evidence is excluded: notes, lifecycle reasons, and original or corrected free text are absent from every sheet, including nested correction values. Each row still states whether narrative exists and was withheld.',
			'This report exposes available evidence. It is not a complete compliance-grade change log.',
		],
		columns: entityColumns(includeNarrative),
	});
	for (const row of snapshot.auditRows) {
		const cells = entityFields(row);
		if (includeNarrative) cells.push(...narrativeCells(row));
		addRow(sheet, cells);
	}
}

function buildCorrectionsSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const includeNarrative = snapshot.options.includeNarrative;
	const columns: ColumnSpec[] = [
		{ header: 'Reference', width: 18 },
		{ header: 'Lead reference', width: 18 },
		{ header: 'Company', width: 30 },
		{ header: 'Changed fields', width: 28 },
		{ header: 'Corrected activity', width: 20 },
		{ header: 'Correcting actor', width: 24 },
		{ header: 'Recorded at', width: 20 },
		{ header: 'Occurred at', width: 20 },
	];
	if (includeNarrative) {
		columns.push(
			{ header: 'Correction reason', width: 40 },
			{ header: 'Previous and corrected values', width: 60 }
		);
	}
	const sheet = dataSheet(wb, snapshot, {
		name: 'Corrections',
		title: 'Corrections — references, actors, and changed fields',
		notes: [
			'A correction is its own audit event and never a second completed activity. Corrected values are the current facts, so earlier-period figures can change on a later observation.',
			includeNarrative
				? 'Detailed evidence was explicitly included: correction reasons and both previous and corrected values appear as plain text.'
				: 'Detailed evidence is excluded: correction reasons and previous or corrected values are absent. The changed fields and the evidence reference remain.',
		],
		columns,
	});
	for (const row of snapshot.auditRows) {
		if (row.evidence_type !== 'correction') continue;
		const cells: CellValue[] = [
			row.reference,
			textOr(row.lead_code, 'Not assigned'),
			row.company_name,
			row.change_fields === '' ? 'None' : row.change_fields,
			NOT_APPLICABLE,
			row.actor_unknown ? 'Unknown actor' : textOr(row.actor_name, 'Unknown actor'),
			textOr(row.recorded_at),
			textOr(row.occurred_at),
		];
		if (includeNarrative) {
			const reason =
				(row.narrative_fields ?? []).find((field) => field.key === 'reason')
					?.value ?? UNKNOWN;
			const changes = (row.narrative_changes ?? [])
				.map(
					(change) =>
						`${change.label}: ${change.from ?? UNKNOWN} -> ${change.to ?? UNKNOWN}`
				)
				.join('\n');
			cells.push(reason, changes === '' ? NOT_APPLICABLE : changes);
		}
		addRow(sheet, cells);
	}
}

function buildDeletedSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const includeNarrative = snapshot.options.includeNarrative;
	const columns: ColumnSpec[] = [
		{ header: 'Deleted record', width: 16 },
		...entityColumns(includeNarrative),
		{ header: 'Deletion actor', width: 16 },
		{ header: 'Deletion time', width: 16 },
		{ header: 'Deletion note', width: 60 },
	];
	const sheet = dataSheet(wb, snapshot, {
		name: 'Deleted evidence',
		title: 'Retained deleted-record evidence — separate from operational totals',
		notes: [
			`Retained deleted Leads: ${snapshot.audit.deleted.summary.deleted_leads}. Retained deleted activity rows: ${snapshot.audit.deleted.summary.deleted_activities}.`,
			snapshot.audit.deleted.deletion_facts.note,
			'This population never enters intake, work, owner, cohort, risk, or timing totals. Evidence stays readable here because an operational page may no longer exist.',
			includeNarrative
				? 'Detailed evidence was explicitly included for this retained population as well.'
				: 'Detailed evidence is excluded here too: no notes, reasons, original values, or corrected values appear.',
		],
		columns,
	});
	for (const row of snapshot.deletedRows) {
		const cells: CellValue[] = [
			row.deleted_record === 'lead' ? 'Deleted Lead' : 'Deleted activity row',
			...entityFields(row),
		];
		if (includeNarrative) cells.push(...narrativeCells(row));
		cells.push('Unknown', 'Unknown', row.deletion_note);
		addRow(sheet, cells);
	}
}

/* ---------------------------- Coverage ---------------------------- */

function buildCoverageSheet(
	wb: ExcelJS.Workbook,
	snapshot: LeadAuditExportSnapshot
): void {
	const coverage = snapshot.coverage;
	const sheet = dataSheet(wb, snapshot, {
		name: 'Coverage and exclusions',
		title: 'Coverage and exclusions — what the evidence can and cannot establish',
		notes: [
			'Unknown, unresolved, restricted, and not applicable stay distinct. A missing fact is never reported as a measured zero.',
			'This report exposes available evidence; it is not a complete compliance-grade change log.',
		],
		columns: [
			{ header: 'Code', width: 28 },
			{ header: 'Label', width: 40 },
			{ header: 'Count', width: 14 },
			{ header: 'Population', width: 44 },
			{ header: 'Detail', width: 60 },
			{ header: 'Is exclusion', width: 14 },
		],
	});
	const statsHeading = sheet.addRow(['Coverage statistics']);
	statsHeading.getCell(1).font = { bold: true, color: { argb: BRAND_PURPLE } };
	for (const stat of coverage.stats) {
		addRow(sheet, [
			stat.code,
			stat.label,
			stat.count === null ? NOT_APPLICABLE : stat.count,
			stat.population,
			stat.detail,
			yesNo(stat.is_exclusion),
		]);
	}
	sheet.addRow([]);
	const exclusionHeading = sheet.addRow(['Metric exclusions']);
	exclusionHeading.getCell(1).font = {
		bold: true,
		color: { argb: BRAND_PURPLE },
	};
	const exclusionHeader = sheet.addRow([
		'Metric',
		'Label',
		'Excluded',
		'Reason',
		'',
		'',
	]);
	for (let index = 1; index <= 4; index += 1) {
		headerFill(exclusionHeader.getCell(index));
	}
	for (const exclusion of coverage.exclusions) {
		addRow(sheet, [
			exclusion.metric,
			exclusion.label,
			exclusion.excluded === null ? NOT_APPLICABLE : exclusion.excluded,
			exclusion.reason,
			'',
			'',
		]);
	}
	sheet.addRow([]);
	const typeHeading = sheet.addRow(['Audit evidence by type']);
	typeHeading.getCell(1).font = { bold: true, color: { argb: BRAND_PURPLE } };
	const typeHeader = sheet.addRow(['Evidence type', 'Label', 'Count', '', '', '']);
	for (let index = 1; index <= 3; index += 1) {
		headerFill(typeHeader.getCell(index));
	}
	for (const entry of coverage.evidence_by_type) {
		addRow(sheet, [entry.value, entry.label, entry.count, '', '', '']);
	}
	sheet.addRow([]);
	const limitsHeading = sheet.addRow(['History limits']);
	limitsHeading.getCell(1).font = { bold: true, color: { argb: BRAND_PURPLE } };
	const limitsHeader = sheet.addRow(['Code', 'Label', 'Detail', '', '', '']);
	for (let index = 1; index <= 3; index += 1) {
		headerFill(limitsHeader.getCell(index));
	}
	for (const limit of coverage.history_limits) {
		addRow(sheet, [limit.code, limit.label, limit.detail, '', '', '']);
	}
	sheet.addRow([]);
	const disclosureHeading = sheet.addRow(['Disclosures']);
	disclosureHeading.getCell(1).font = {
		bold: true,
		color: { argb: BRAND_PURPLE },
	};
	const disclosureHeader = sheet.addRow(['Code', 'Text', '', '', '', '']);
	headerFill(disclosureHeader.getCell(1));
	headerFill(disclosureHeader.getCell(2));
	for (const disclosure of [
		...coverage.disclosures,
		...snapshot.intake.disclosures,
	]) {
		addRow(sheet, [disclosure.code, disclosure.text, '', '', '', '']);
	}
}
