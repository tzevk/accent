/**
 * Print-only CSS for the Lead Audit management summary (#406).
 *
 * The report page mounts exactly one printable summary inside an element with
 * the class `lead-audit-print-root`. Every other element on the page — the
 * navigation, the report header, the filter toolbar, the views, the evidence
 * panels, and the Print action itself — is removed from the printed layout,
 * so no navigation, control, or evidence table can reach paper or a browser
 * PDF. The screen never sees these rules.
 *
 * The summary uses semantic markup (headings, tables with `thead`, definition
 * lists) rather than fixed widths, so it reflows at 320 pixels and at 200 %
 * zoom, and the head of every table repeats when the table spans pages.
 */
export const leadAuditPrintStyles = `
@media print {
	@page {
		size: A4 portrait;
		margin: 12mm 10mm 14mm;
	}
	html,
	body {
		height: auto !important;
		min-height: 0 !important;
		margin: 0 !important;
		padding: 0 !important;
		background: #ffffff !important;
		color: #000000 !important;
	}

	/* Only the summary prints. Its ancestors stay in the layout so the
	   summary is not removed with its own container, but every other branch
	   is display:none, which also stops hidden chrome from producing blank
	   pages. */
	body
		*:not(.lead-audit-print-root):not(:has(.lead-audit-print-root)):not(
			.lead-audit-print-root *
		) {
		display: none !important;
	}
	body *:has(.lead-audit-print-root) {
		margin: 0 !important;
		padding: 0 !important;
		border: 0 !important;
		box-shadow: none !important;
		background: #ffffff !important;
		overflow: visible !important;
		max-width: none !important;
		float: none !important;
	}

	.lead-audit-print-root {
		display: block !important;
		width: 100% !important;
		max-width: none !important;
		margin: 0 !important;
		padding: 0 !important;
		background: #ffffff !important;
		color: #000000 !important;
		font-size: 9.5pt;
		line-height: 1.35;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.lead-audit-print-root * {
		color: #000000 !important;
		background-image: none !important;
	}
	.lead-audit-print-root h1 {
		margin: 0 0 1.5mm;
		font-size: 16pt;
		line-height: 1.2;
	}
	.lead-audit-print-root h2 {
		margin: 5mm 0 1.5mm;
		font-size: 11.5pt;
		line-height: 1.25;
		break-after: avoid;
		page-break-after: avoid;
	}
	.lead-audit-print-root h3 {
		margin: 3mm 0 1mm;
		font-size: 9.5pt;
		break-after: avoid;
		page-break-after: avoid;
	}
	.lead-audit-print-root p,
	.lead-audit-print-root li,
	.lead-audit-print-root dt,
	.lead-audit-print-root dd {
		margin: 0 0 1mm;
		orphans: 3;
		widows: 3;
	}
	.lead-audit-print-root ul {
		margin: 0 0 1.5mm;
		padding-left: 5mm;
	}
	.lead-audit-print-root li {
		break-inside: avoid;
	}
	.lead-audit-print-root dl {
		margin: 0;
	}
	.lead-audit-print-root dt {
		font-weight: 600;
		break-after: avoid;
	}
	.lead-audit-print-root dd {
		margin-left: 0;
		margin-bottom: 1.5mm;
	}

	.lead-audit-print-root table {
		width: 100% !important;
		max-width: 100% !important;
		margin: 1.5mm 0 2mm;
		border-collapse: collapse;
		table-layout: auto;
		font-size: 8.5pt;
	}
	.lead-audit-print-root caption {
		margin-bottom: 1mm;
		font-size: 8pt;
		text-align: left;
	}
	.lead-audit-print-root thead {
		display: table-header-group;
	}
	.lead-audit-print-root tfoot {
		display: table-footer-group;
	}
	.lead-audit-print-root tr {
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.lead-audit-print-root th,
	.lead-audit-print-root td {
		padding: 1.1mm 1.5mm;
		border: 0.4pt solid #9ca3af;
		text-align: left;
		vertical-align: top;
		overflow-wrap: anywhere;
	}
	.lead-audit-print-root th {
		background: #f3f4f6 !important;
		font-weight: 600;
	}
	.lead-audit-print-root caption,
	.lead-audit-print-root th,
	.lead-audit-print-root td {
		white-space: normal;
	}

	/* Figures stay whole and never clip; long owner or label text wraps. */
	.lead-audit-print-figures,
	.lead-audit-print-note,
	.lead-audit-print-meta {
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.lead-audit-print-numeric {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.lead-audit-print-meta {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.8mm 3mm;
		font-size: 8.5pt;
	}
	.lead-audit-print-meta dt {
		font-weight: 600;
	}
	.lead-audit-print-meta dd {
		margin: 0;
	}

	/* Screen scroll regions and controls never reach paper. */
	.lead-audit-print-scroll {
		overflow: visible !important;
		max-height: none !important;
	}
	.lead-audit-print-root button,
	.lead-audit-print-root [role='button'],
	.lead-audit-print-root input,
	.lead-audit-print-root select,
	.lead-audit-print-root textarea {
		display: none !important;
	}
	.lead-audit-print-root a::after {
		content: '';
	}
}
`;
