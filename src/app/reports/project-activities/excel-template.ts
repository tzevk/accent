/**
 * Server-side Excel workbook builder for the Project Activities report.
 *
 * Mirrors the visual conventions of the PDF: brand purple headers,
 * semantic status fills, hairline borders.  Returns a Buffer ready
 * for a Response body.
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module
 * must only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';
import type { Project, Kpis } from './report-utils';
import { fmtNum } from './report-utils';

export interface ExcelTemplateOptions {
	startDate?: string;
	endDate?: string;
}

const BRAND_PURPLE = 'FF7F2487';
const BRAND_PURPLE_LIGHT = 'FFF3E5F5';
const GRAY_BORDER = 'FFD1D5DB';
const STATUS_FILL: Record<string, string> = {
	Completed: 'FF16A34A',
	'In Progress': 'FF2563EB',
	'Not Started': 'FF6B7280',
	'On Hold': 'FFEA580C',
	Pending: 'FFCA8A04',
	Rejected: 'FFDC2626',
};

function todayStamp(): string {
	return new Date().toISOString().split('T')[0];
}

function fileBaseFromOptions(options: ExcelTemplateOptions): string {
	const { startDate, endDate } = options;
	const range =
		startDate || endDate
			? `_${startDate || 'start'}_to_${endDate || 'today'}`
			: '';
	return `Project_Activities${range}_${todayStamp()}`;
}

function statusFill(s: string): string {
	return STATUS_FILL[s] || STATUS_FILL['Not Started'];
}

export async function buildWorkbook(
	tree: Project[],
	kpis: Kpis,
	options: ExcelTemplateOptions = {}
): Promise<ExcelJS.Workbook> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Accent CRM';
	wb.created = new Date();

	// ── Sheet 1: Summary ─────────────────────────────────────────────
	const summary = wb.addWorksheet('Summary', {
		properties: { tabColor: { argb: BRAND_PURPLE } },
	});
	summary.columns = [
		{ width: 32 },
		{ width: 18 },
		{ width: 18 },
		{ width: 18 },
		{ width: 14 },
	];
	summary.mergeCells('A1:E1');
	const titleCell = summary.getCell('A1');
	titleCell.value = 'Project Activities — Executive Summary';
	titleCell.font = { size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
	titleCell.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: BRAND_PURPLE },
	};
	titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
	titleCell.border = {
		top: { style: 'thin', color: { argb: BRAND_PURPLE } },
		left: { style: 'thin', color: { argb: BRAND_PURPLE } },
		bottom: { style: 'thin', color: { argb: BRAND_PURPLE } },
		right: { style: 'thin', color: { argb: BRAND_PURPLE } },
	};
	summary.getRow(1).height = 28;

	summary.addRow([]);
	const filterRow = summary.addRow([
		'Date range',
		options.startDate || '—',
		'to',
		options.endDate || '—',
		'',
	]);
	filterRow.font = { italic: true, color: { argb: 'FF6B7280' } };

	summary.addRow([]);
	const kpiHeader = summary.addRow(['KPI', 'Value', '', '', '']);
	kpiHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
	kpiHeader.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: BRAND_PURPLE },
	};

	const kpiRows: Array<[string, string | number]> = [
		['Total projects', kpis.projects],
		['Total tasks', kpis.tasks],
		['Total assignments (members)', kpis.members],
		['Total scope (qty target)', fmtNum(kpis.total_assigned)],
		['Total executed (qty done)', fmtNum(kpis.total_done)],
		['Pending scope (qty target)', fmtNum(kpis.pending_assigned)],
		['Completed tasks', kpis.completed_tasks],
		['Completion rate', `${kpis.completion_rate}%`],
	];
	for (const [label, value] of kpiRows) {
		const r = summary.addRow([label, value]);
		r.getCell(1).font = { bold: true };
		r.getCell(2).alignment = { horizontal: 'right' };
	}

	// ── Sheet 2: Activities (one row per member) ────────────────────
	const detail = wb.addWorksheet('Activities', {
		views: [{ state: 'frozen', ySplit: 1 }],
	});
	detail.columns = [
		{ header: 'Project Code', key: 'code', width: 18 },
		{ header: 'Project Name', key: 'name', width: 28 },
		{ header: 'Client', key: 'client', width: 20 },
		{ header: 'Discipline', key: 'discipline', width: 22 },
		{ header: 'Task', key: 'task', width: 30 },
		{ header: 'Member', key: 'member', width: 22 },
		{ header: 'Status', key: 'status', width: 14 },
		{ header: 'Qty Target', key: 'target', width: 12 },
		{ header: 'Qty Done', key: 'done', width: 12 },
		{ header: 'Progress %', key: 'progress', width: 12 },
		{ header: 'Planned Hours', key: 'planH', width: 14 },
		{ header: 'Actual Hours', key: 'actH', width: 14 },
	];
	const headerRow = detail.getRow(1);
	headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
	headerRow.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: BRAND_PURPLE },
	};
	headerRow.alignment = { horizontal: 'left', vertical: 'middle' };
	headerRow.height = 22;

	for (const p of tree) {
		for (const d of p.disciplines) {
			for (const t of d.tasks) {
				if (t.members.length === 0) continue;
				for (const m of t.members) {
					const qa = Number(m.qty_assigned) || 0;
					const qd = Number(m.qty_completed) || 0;
					detail.addRow({
						code: p.project_code || '',
						name: p.project_name,
						client: p.client_name,
						discipline: d.name,
						task: t.name,
						member: m.user_name || `User ${m.user_id}`,
						status: m.status || t.status,
						target: qa,
						done: qd,
						progress: qa > 0 ? Math.min(100, Math.round((qd / qa) * 100)) : 0,
						planH: Number(m.planned_hours) || 0,
						actH: Number(m.actual_hours) || 0,
					});
				}
			}
		}
	}

	detail.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		if (rowNumber === 1) return;
		const cell = row.getCell('status');
		const v = String(cell.value || '');
		cell.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: statusFill(v) },
		};
		cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		cell.alignment = { horizontal: 'center' };
		row.eachCell((c) => {
			c.border = {
				top: { style: 'hair', color: { argb: GRAY_BORDER } },
				left: { style: 'hair', color: { argb: GRAY_BORDER } },
				bottom: { style: 'hair', color: { argb: GRAY_BORDER } },
				right: { style: 'hair', color: { argb: GRAY_BORDER } },
			};
		});
		for (const k of ['target', 'done', 'progress', 'planH', 'actH']) {
			row.getCell(k).alignment = { horizontal: 'right' };
		}
	});

	// ── Sheet 3: Project Rollup ──────────────────────────────────────
	const rollup = wb.addWorksheet('Project Rollup', {
		views: [{ state: 'frozen', ySplit: 1 }],
	});
	rollup.columns = [
		{ header: 'Project Code', key: 'code', width: 18 },
		{ header: 'Project Name', key: 'name', width: 28 },
		{ header: 'Discipline', key: 'discipline', width: 22 },
		{ header: 'Tasks', key: 'tasks', width: 8 },
		{ header: 'Members', key: 'members', width: 10 },
		{ header: 'Qty Target', key: 'target', width: 12 },
		{ header: 'Qty Done', key: 'done', width: 12 },
		{ header: 'Progress %', key: 'progress', width: 12 },
		{ header: 'Status', key: 'status', width: 14 },
	];
	const rHeader = rollup.getRow(1);
	rHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
	rHeader.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb: BRAND_PURPLE },
	};
	rHeader.height = 22;

	for (const p of tree) {
		rollup.addRow({
			code: p.project_code || '',
			name: p.project_name,
			discipline: '— All disciplines —',
			tasks: p.task_count,
			members: p.member_count,
			target: p.total_assigned,
			done: p.total_done,
			progress: p.progress,
			status: p.status,
		});
		for (const d of p.disciplines) {
			rollup.addRow({
				code: '',
				name: '',
				discipline: d.name,
				tasks: d.tasks.length,
				members: d.tasks.reduce((c, t) => c + t.members.length, 0),
				target: d.total_assigned,
				done: d.total_done,
				progress: d.progress,
				status: d.status,
			});
		}
	}

	rollup.eachRow({ includeEmpty: false }, (row, rowNumber) => {
		if (rowNumber === 1) return;
		row.eachCell((c) => {
			c.border = {
				top: { style: 'hair', color: { argb: GRAY_BORDER } },
				left: { style: 'hair', color: { argb: GRAY_BORDER } },
				bottom: { style: 'hair', color: { argb: GRAY_BORDER } },
				right: { style: 'hair', color: { argb: GRAY_BORDER } },
			};
		});
		const sCell = row.getCell('status');
		const sVal = String(sCell.value || '');
		sCell.fill = {
			type: 'pattern',
			pattern: 'solid',
			fgColor: { argb: statusFill(sVal) },
		};
		sCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		sCell.alignment = { horizontal: 'center' };
		if (row.getCell('discipline').value === '— All disciplines —') {
			row.eachCell((c) => {
				c.fill = {
					type: 'pattern',
					pattern: 'solid',
					fgColor: { argb: BRAND_PURPLE_LIGHT },
				};
				c.font = { bold: true };
			});
			sCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
		}
		for (const k of ['target', 'done', 'progress', 'tasks', 'members']) {
			row.getCell(k).alignment = { horizontal: 'right' };
		}
	});

	return wb;
}

export async function buildWorkbookBuffer(
	tree: Project[],
	kpis: Kpis,
	options: ExcelTemplateOptions = {}
): Promise<Buffer> {
	const wb = await buildWorkbook(tree, kpis, options);
	const buf = await wb.xlsx.writeBuffer();
	return Buffer.from(buf);
}

export function fileBaseForExcel(options: ExcelTemplateOptions): string {
	return `${fileBaseFromOptions(options)}.xlsx`;
}
