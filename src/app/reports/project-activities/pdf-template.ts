/**
 * HTML template for the Project Activities PDF report.
 *
 * Returns a self-contained HTML string (inline styles, no external assets)
 * suitable for puppeteer's setContent() → page.pdf() pipeline.
 *
 * Matches the AGENTS.md color scheme: brand purple #7F2487, semantic status
 * colors, gray neutrals. Uses inline styles only — this HTML must render
 * identically in a fresh headless Chromium with no CSS loaded.
 */

import type { Project, Kpis } from './report-utils';
import { fmtNum } from './report-utils';

export interface PdfTemplateOptions {
	startDate?: string;
	endDate?: string;
}

const STATUS_HEX: Record<string, { bg: string; fg: string }> = {
	Completed: { bg: 'DCFCE7', fg: '166534' },
	'In Progress': { bg: 'DBEAFE', fg: '1E40AF' },
	'Not Started': { bg: 'F3F4F6', fg: '374151' },
	'On Hold': { bg: 'FFEDD5', fg: '9A3412' },
	Pending: { bg: 'FEF9C3', fg: '854D0E' },
	Rejected: { bg: 'FEE2E2', fg: '991B1B' },
};

function statusStyle(s: string): string {
	const v = STATUS_HEX[s] || STATUS_HEX['Not Started'];
	return `background:${v.bg};color:${v.fg};`;
}

function escapeHtml(v: string | number | null | undefined): string {
	if (v == null) return '';
	return String(v)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function progressBar(pct: number): string {
	const p = Math.min(100, Math.max(0, Math.round(pct)));
	return `
		<div style="background:#E5E7EB;border-radius:4px;height:8px;width:80px;overflow:hidden;">
			<div style="background:#7F2487;height:8px;width:${p}%;"></div>
		</div>
		<div style="font-size:9px;color:#6B7280;margin-top:2px;">${p}%</div>
	`;
}

function todayStamp(): string {
	return new Date().toISOString().split('T')[0];
}

function dateRangeLabel(opts: PdfTemplateOptions): string {
	const { startDate, endDate } = opts;
	if (!startDate && !endDate) return `Generated ${todayStamp()}`;
	return `Generated ${todayStamp()}  ·  Range: ${startDate || 'start'} → ${
		endDate || 'today'
	}`;
}

export function generateReportHTML(
	tree: Project[],
	kpis: Kpis,
	options: PdfTemplateOptions = {}
): string {
	const kpiCards: Array<[string, string]> = [
		['Projects', String(kpis.projects)],
		['Tasks', String(kpis.tasks)],
		['Members', String(kpis.members)],
		['Scope', fmtNum(kpis.total_assigned)],
		['Executed', fmtNum(kpis.total_done)],
		['Pending', fmtNum(kpis.pending_assigned)],
		['Completion', `${kpis.completion_rate}%`],
	];

	const projectSections = tree
		.map((p) => {
			const tasks = p.disciplines
				.map((d) => {
					const taskRows = d.tasks
						.map(
							(t) => `
							<tr>
								<td style="padding:6px 8px 6px 28px;border-bottom:1px solid #F3F4F6;font-size:11px;color:#4B5563;">
									· ${escapeHtml(t.name)}
								</td>
								<td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;text-align:right;font-size:11px;color:#374151;">
									${t.members.length}
								</td>
								<td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;text-align:right;font-size:11px;color:#374151;">
									${fmtNum(t.total_assigned)}
								</td>
								<td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;text-align:right;font-size:11px;color:#374151;">
									${fmtNum(t.total_done)}
								</td>
								<td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;">
									${progressBar(t.progress)}
								</td>
								<td style="padding:6px 8px;border-bottom:1px solid #F3F4F6;">
									<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;${statusStyle(t.status)}">
										${escapeHtml(t.status)}
									</span>
								</td>
							</tr>
						`
						)
						.join('');

					return `
						<tr>
							<td style="padding:8px;border-bottom:1px solid #E5E7EB;background:#FAF5FF;font-size:11px;color:#7F2487;font-weight:700;">
								${escapeHtml(d.name)}
							</td>
							<td style="padding:8px;border-bottom:1px solid #E5E7EB;background:#FAF5FF;text-align:right;font-size:11px;color:#374151;font-weight:600;">
								${d.tasks.reduce((c, t) => c + t.members.length, 0)}
							</td>
							<td style="padding:8px;border-bottom:1px solid #E5E7EB;background:#FAF5FF;text-align:right;font-size:11px;color:#374151;font-weight:600;">
								${fmtNum(d.total_assigned)}
							</td>
							<td style="padding:8px;border-bottom:1px solid #E5E7EB;background:#FAF5FF;text-align:right;font-size:11px;color:#374151;font-weight:600;">
								${fmtNum(d.total_done)}
							</td>
							<td style="padding:8px;border-bottom:1px solid #E5E7EB;background:#FAF5FF;">
								${progressBar(d.progress)}
							</td>
							<td style="padding:8px;border-bottom:1px solid #E5E7EB;background:#FAF5FF;">
								<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;${statusStyle(d.status)}">
									${escapeHtml(d.status)}
								</span>
							</td>
						</tr>
						${taskRows}
					`;
				})
				.join('');

			return `
				<div style="margin-top:18px;page-break-inside:avoid;">
					<div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid #7F2487;padding-bottom:6px;margin-bottom:8px;">
						<div>
							<div style="font-size:14px;font-weight:700;color:#7F2487;">
								${p.project_code ? '[' + escapeHtml(p.project_code) + '] ' : ''}${escapeHtml(p.project_name)}
							</div>
							${p.client_name ? `<div style="font-size:10px;color:#6B7280;margin-top:2px;">Client: ${escapeHtml(p.client_name)}</div>` : ''}
						</div>
						<div style="text-align:right;font-size:10px;color:#6B7280;">
							<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:10px;font-weight:600;${statusStyle(p.status)}">
								${escapeHtml(p.status)}
							</span>
							<div style="margin-top:4px;">
								Tasks: ${p.task_count} · Members: ${p.member_count} ·
								${fmtNum(p.total_done)} / ${fmtNum(p.total_assigned)} (${p.progress}%)
							</div>
						</div>
					</div>
					<table style="width:100%;border-collapse:collapse;">
						<thead>
							<tr style="background:#F9FAFB;">
								<th style="text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #E5E7EB;">Discipline / Task</th>
								<th style="text-align:right;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #E5E7EB;">Members</th>
								<th style="text-align:right;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #E5E7EB;">Target</th>
								<th style="text-align:right;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #E5E7EB;">Done</th>
								<th style="text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #E5E7EB;">Progress</th>
								<th style="text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#6B7280;border-bottom:1px solid #E5E7EB;">Status</th>
							</tr>
						</thead>
						<tbody>
							${tasks}
						</tbody>
					</table>
				</div>
			`;
		})
		.join('');

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<title>Project Activities Report</title>
	<style>
		@page { size: A4; margin: 16mm 14mm; }
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			color: #1F2937;
			font-size: 12px;
			line-height: 1.4;
			margin: 0;
		}
		.kpi-grid {
			display: grid;
			grid-template-columns: repeat(7, 1fr);
			gap: 6px;
			margin: 12px 0 6px;
		}
		.kpi {
			border: 1px solid #E5E7EB;
			border-radius: 6px;
			padding: 8px 10px;
			background: #FFFFFF;
		}
		.kpi-label {
			font-size: 8px;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			color: #6B7280;
			font-weight: 600;
		}
		.kpi-value {
			font-size: 18px;
			font-weight: 700;
			color: #1F2937;
			margin-top: 2px;
		}
		.section-title {
			font-size: 12px;
			font-weight: 700;
			color: #7F2487;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin: 18px 0 4px;
			padding-bottom: 4px;
			border-bottom: 1px solid #7F2487;
		}
		.footer {
			margin-top: 20px;
			padding-top: 8px;
			border-top: 1px solid #E5E7EB;
			text-align: center;
			font-size: 9px;
			color: #9CA3AF;
		}
	</style>
</head>
<body>
	<div style="background:#7F2487;color:#FFFFFF;padding:14px 18px;border-radius:6px;">
		<div style="font-size:18px;font-weight:700;">Project Activities Report</div>
		<div style="font-size:10px;margin-top:4px;opacity:0.9;">${escapeHtml(dateRangeLabel(options))}</div>
	</div>

	<div class="section-title">Executive Summary</div>
	<div class="kpi-grid">
		${kpiCards
			.map(
				([label, value]) => `
				<div class="kpi">
					<div class="kpi-label">${escapeHtml(label)}</div>
					<div class="kpi-value">${escapeHtml(value)}</div>
				</div>
			`
			)
			.join('')}
	</div>

	${projectSections || '<p style="color:#6B7280;font-style:italic;margin-top:20px;">No projects in the selected range.</p>'}

	<div class="footer">Accent CRM · Project Activities Report</div>
</body>
</html>`;
}

export function fileBaseFromOptions(options: PdfTemplateOptions): string {
	const { startDate, endDate } = options;
	const range =
		startDate || endDate
			? `_${startDate || 'start'}_to_${endDate || 'today'}`
			: '';
	return `Project_Activities${range}_${todayStamp()}`;
}
