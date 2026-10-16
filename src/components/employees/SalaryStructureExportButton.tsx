'use client';

import { useState } from 'react';
import { DocumentArrowDownIcon } from '@heroicons/react/24/outline';

interface ExportMessage {
	type: '' | 'success' | 'error';
	text: string;
}

/**
 * "Salary Structure (All Users)" master-data export: downloads the workbook
 * for every user and keeps the success/failure feedback next to the button.
 * Extracted from the old salary-profiles page so the employee hub can offer
 * the same action beside the master data list.
 */
export default function SalaryStructureExportButton() {
	const [exportingAllStructures, setExportingAllStructures] = useState(false);
	const [message, setMessage] = useState<ExportMessage>({
		type: '',
		text: '',
	});

	const exportAllSalaryStructures = async () => {
		setExportingAllStructures(true);
		setMessage({ type: '', text: '' });
		try {
			const res = await fetch('/api/employees/salary-structure/export');
			if (!res.ok) {
				const data: unknown = await res.json().catch(() => ({}));
				const error =
					typeof data === 'object' && data !== null && 'error' in data
						? data.error
						: null;
				throw new Error(String(error ?? '') || 'Export failed');
			}
			const blob = await res.blob();
			const objectUrl = window.URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = objectUrl;
			link.download = 'Salary_Structure_All_Users.xlsx';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			window.URL.revokeObjectURL(objectUrl);
			setMessage({
				type: 'success',
				text: 'All-users salary structure Excel downloaded',
			});
		} catch (error) {
			setMessage({
				type: 'error',
				text: (error as Error).message || 'Failed to export salary structures',
			});
		}
		setExportingAllStructures(false);
		setTimeout(() => setMessage({ type: '', text: '' }), 5000);
	};

	return (
		<div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
			<div className="flex flex-wrap items-center gap-3">
				<button
					type="button"
					onClick={() => void exportAllSalaryStructures()}
					disabled={exportingAllStructures}
					className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
				>
					<DocumentArrowDownIcon
						className={`h-4 w-4 ${exportingAllStructures ? 'animate-pulse' : ''}`}
					/>
					{exportingAllStructures
						? 'Exporting...'
						: 'Salary Structure (All Users)'}
				</button>
			</div>
			{message.text && (
				<p
					role={message.type === 'error' ? 'alert' : 'status'}
					className={`mt-3 text-sm ${
						message.type === 'error' ? 'text-red-700' : 'text-green-700'
					}`}
				>
					{message.text}
				</p>
			)}
		</div>
	);
}
