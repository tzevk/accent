/**
 * Server-side Excel workbook builder for the Company Monthly Cost report.
 *
 * Shared theme for the workbook builders: colour tints, cell helpers and
 * the metric type.
 *
 * exceljs is in next.config.ts serverExternalPackages, so this module must
 * only be imported from server code (API routes, server components).
 */

import ExcelJS from 'exceljs';

export const TINT_YELLOW = 'FFFFE598'; // Sr. No. | Project
export const TINT_BLUE = 'FFDCE2F2'; // Rate/Hr | Client
export const TINT_AMBER_LIGHT = 'FFFFF2CC'; // Monthly cells Apr–Mar
export const TINT_PURPLE_LIGHT = 'FFE1D5E7'; // Total hours column
export const TINT_GREEN = 'FFC6DFB4'; // Cost totals
export const TINT_EMP = 'FFFEF3C7'; // Employee columns
export const TINT_PROJ = 'FFE0E7FF'; // Project columns

export const GRAY_BORDER = 'FFD1D5DB';

export function setFill(cell: ExcelJS.Cell, argb: string): void {
	cell.fill = {
		type: 'pattern',
		pattern: 'solid',
		fgColor: { argb },
	};
}

export function setFont(
	cell: ExcelJS.Cell,
	{
		bold = false,
		size = 10,
		color = 'FF111827',
	}: { bold?: boolean; size?: number; color?: string } = {}
): void {
	cell.font = { name: 'Calibri', bold, size, color: { argb: color } };
}

export function box(cell: ExcelJS.Cell): void {
	const b: ExcelJS.Border = { style: 'thin', color: { argb: GRAY_BORDER } };
	cell.border = { top: b, left: b, bottom: b, right: b };
}

export function sanitizeName(name: string): string {
	return name.replace(/[^A-Za-z0-9_-]/g, '_').replace(/_+/g, '_');
}

export type Metric = 'hours' | 'cost';

export const TINT_PURPLE_HDR = 'FF4D025B';
export const TINT_PURPLE_SUB = 'FFE9D5FF';
export const TINT_GRAY_LIGHT = 'FFF3F4F6';
export const TINT_WARN_LIGHT = 'FFFEF3C7';
export const TINT_ERROR_LIGHT = 'FFFEE2E2';
export const TINT_GREEN_LIGHT = 'FFD1FAE5';
