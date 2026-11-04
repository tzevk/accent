'use client';

import { useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { HelpTip } from './help-tip';

interface LeadAuditExportActionProps {
	/** The applied report query, exactly as the page sent it. */
	query: Record<string, string | undefined>;
	/** True when the reader holds the Reports export grant. */
	canExport: boolean;
}

const EXPORT_PATH = '/api/reports/lead-audit/download';

function downloadUrl(
	query: Record<string, string | undefined>,
	includeNarrative: boolean
): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (typeof value === 'string' && value !== '') params.set(key, value);
	}
	if (includeNarrative) params.set('include_narrative', '1');
	const search = params.toString();
	return search === '' ? EXPORT_PATH : `${EXPORT_PATH}?${search}`;
}

async function responseMessage(response: Response): Promise<string> {
	try {
		const parsed = (await response.json()) as { error?: unknown };
		if (typeof parsed.error === 'string' && parsed.error !== '') {
			return parsed.error;
		}
	} catch {
		// A non-JSON error body still gets a status-based message below.
	}
	return `The workbook download failed (${response.status}). Select Export Excel to try again.`;
}

/**
 * Export Excel with an explicit detailed-evidence choice.
 *
 * The button downloads the complete applied workbook for the report's
 * current query. Detailed evidence is off by default, so routine sharing
 * carries structured evidence only; notes and reasons appear only after the
 * reader selects the choice, and the server re-checks both the read and
 * export grants before including them.
 */
export function LeadAuditExportAction({
	query,
	canExport,
}: LeadAuditExportActionProps) {
	const [includeNarrative, setIncludeNarrative] = useState(false);
	const [pending, setPending] = useState(false);
	const [message, setMessage] = useState('');

	async function handleExport(): Promise<void> {
		if (!canExport || pending) return;
		setPending(true);
		setMessage('');
		try {
			const response = await fetch(downloadUrl(query, includeNarrative), {
				credentials: 'include',
			});
			if (!response.ok) {
				setMessage(await responseMessage(response));
				return;
			}
			const blob = await response.blob();
			const objectUrl = URL.createObjectURL(blob);
			const disposition = response.headers.get('Content-Disposition') || '';
			const match = disposition.match(/filename="?([^";]+)"?/i);
			const filename = match?.[1] || `lead-audit-export-${Date.now()}.xlsx`;
			const anchor = document.createElement('a');
			anchor.href = objectUrl;
			anchor.download = filename;
			anchor.style.display = 'none';
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
			setMessage('Workbook downloaded.');
		} catch {
			setMessage(
				'The workbook download failed. Check your connection and select Export Excel to try again.'
			);
		} finally {
			setPending(false);
		}
	}

	const checkboxId = 'lead-audit-include-detailed-evidence';
	const statusId = 'lead-audit-export-status';

	return (
		<div className="flex flex-wrap items-center gap-2">
			<button
				type="button"
				onClick={handleExport}
				aria-disabled={!canExport || pending}
				aria-describedby={statusId}
				className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D] focus-visible:ring-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
			>
				<ArrowDownTrayIcon className="h-3.5 w-3.5" aria-hidden="true" />
				{pending ? 'Preparing workbook…' : 'Export Excel'}
			</button>
			<span className="inline-flex items-center gap-1.5 text-sm text-gray-800">
				<input
					id={checkboxId}
					type="checkbox"
					checked={includeNarrative}
					onChange={(event) => setIncludeNarrative(event.target.checked)}
					disabled={!canExport || pending}
					className="h-4 w-4 rounded border-gray-400 bg-white accent-[#64126D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]"
				/>
				<label htmlFor={checkboxId}>Include detailed evidence</label>
				<HelpTip label="About detailed evidence">
					Off by default. Notes and reasons appear only when selected.
				</HelpTip>
			</span>
			<span
				id={statusId}
				role="status"
				aria-live="polite"
				className={
					message !== '' || !canExport ? 'text-xs text-gray-700' : 'sr-only'
				}
			>
				{message !== ''
					? message
					: canExport
						? ''
						: 'The workbook download requires the Reports export grant (reports:export).'}
			</span>
		</div>
	);
}
