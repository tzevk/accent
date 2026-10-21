export const cmcPrintStyles = `
@media print {
	@page {
		size: A4 landscape;
		margin: 10mm 9mm 14mm 9mm;
		@bottom-center {
			content: "Accent CRM — Company Monthly Cost — Page " counter(page) " of " counter(pages);
			font-size: 7pt;
			color: #6b7280;
		}
	}
	.cmc-print-page {
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.cmc-print-page nav,
	.cmc-print-page .print\\:hidden {
		display: none !important;
	}
	body > aside {
		display: none !important;
	}
	.content-with-sidebar {
		padding-left: 0 !important;
		padding-top: 0 !important;
	}
	.cmc-print-page main {
		padding: 0 !important;
	}
	.cmc-sheet {
		overflow: visible !important;
		border: 0 !important;
		border-radius: 0 !important;
		box-shadow: none !important;
	}
	.cmc-sheet table {
		font-size: 7.5pt;
	}
	.cmc-sheet th,
	.cmc-sheet td {
		padding: 1.5px 3px !important;
	}
	.cmc-sheet thead {
		display: table-header-group;
	}
	.cmc-sheet tbody tr {
		break-inside: avoid;
	}
	.cmc-project-wise-sheet {
		min-width: 0 !important;
		font-size: 9pt;
	}
	.cmc-project-wise-sheet table {
		min-width: 0 !important;
		font-size: 8.5pt;
	}
	.cmc-project-section {
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.cmc-project-meta {
		break-inside: avoid;
		page-break-inside: avoid;
	}
	.cmc-project-wise-sheet th,
	.cmc-project-wise-sheet td {
		padding: 2mm 2.5mm !important;
	}
}`;
