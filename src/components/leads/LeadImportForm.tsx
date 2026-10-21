'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api-client';
import OwnerSelect from '@/components/leads/OwnerSelect';
import { leadKeys } from '@/components/leads/queries';
import type { ImportResponse } from '@/components/leads/types';

interface LeadImportFormProps {
	canImport: boolean;
	canAssign: boolean;
	onImported: () => void;
}

/**
 * CSV import with an optional owner. Without a selected owner the imported
 * leads enter unassigned intake; names in the file are never resolved to
 * users by the client.
 */
export default function LeadImportForm({
	canImport,
	canAssign,
	onImported,
}: LeadImportFormProps) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [result, setResult] = useState<ImportResponse | null>(null);
	const queryClient = useQueryClient();
	const importMutation = useMutation<ImportResponse, Error, FormData>({
		mutationFn: (formData) =>
			apiPost<ImportResponse>('/api/leads/import', formData),
		onSuccess: (response) => {
			setResult(response);
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
			onImported();
		},
		onSettled: () => {
			if (fileInputRef.current) fileInputRef.current.value = '';
		},
	});
	const uploading = importMutation.isPending;
	const error = formError ?? importMutation.error?.message ?? null;

	if (!canImport) return null;

	const downloadTemplate = (): void => {
		const csvContent = `Company Name,Contact Name,Designation,Contact Email,Phone,City,Project Description,Enquiry Type,Lead Stage,Enquiry Date,Lead Source,Priority,Notes
Example Corp,John Smith,Sales Manager,john@example.com,+91 9876543210,Mumbai,Website Development,Email,New,2025-09-19,Website,High,Sample lead data`;
		const blob = new Blob([csvContent], { type: 'text/csv' });
		const url = window.URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = 'leads_template.csv';
		anchor.click();
		window.URL.revokeObjectURL(url);
	};

	const handleFile = (event: React.ChangeEvent<HTMLInputElement>): void => {
		const file = event.target.files?.[0];
		if (!file) return;
		importMutation.reset();
		setFormError(null);
		setResult(null);
		if (!file.name.toLowerCase().endsWith('.csv')) {
			setFormError('Please upload a valid CSV file (.csv).');
			event.target.value = '';
			return;
		}
		const formData = new FormData();
		formData.append('file', file);
		if (canAssign && ownerUserId !== null) {
			formData.append('owner_user_id', String(ownerUserId));
		}
		importMutation.mutate(formData);
	};

	return (
		<div className="space-y-3">
			{canAssign ? (
				<div className="max-w-sm">
					<label
						htmlFor="lead-import-owner"
						className="block text-sm font-medium text-gray-700 mb-1"
					>
						Owner for imported leads
					</label>
					<OwnerSelect
						id="lead-import-owner"
						value={ownerUserId}
						onChange={setOwnerUserId}
						disabled={uploading}
						describedBy="lead-import-owner-help"
						intakeLabel="Unassigned intake"
					/>
					<p id="lead-import-owner-help" className="mt-1 text-xs text-gray-500">
						Leave empty for unassigned intake. File owner names are kept as
						evidence, never auto-matched.
					</p>
				</div>
			) : (
				<p className="text-sm text-gray-600">
					Imported leads enter unassigned intake. You do not have assignment
					permission.
				</p>
			)}
			<div className="flex flex-col sm:flex-row gap-3">
				<button
					type="button"
					onClick={downloadTemplate}
					className="inline-flex items-center justify-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
				>
					Download Template
				</button>
				<label className="inline-flex items-center justify-center px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 transition-colors cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#64126D]">
					{uploading ? 'Uploading…' : 'Import CSV'}
					<input
						ref={fileInputRef}
						type="file"
						accept=".csv"
						onChange={handleFile}
						className="sr-only"
						disabled={uploading}
						aria-label="Import CSV leads file"
					/>
				</label>
			</div>
			<div aria-live="polite" className="space-y-2">
				{error ? (
					<p className="text-sm text-red-600" role="alert">
						{error}
					</p>
				) : null}
				{result ? (
					<div className="text-sm text-gray-700 rounded-md border border-gray-200 p-3">
						<p className="font-medium">{result.message}</p>
						<p className="mt-1">
							Imported {result.imported} lead
							{result.imported === 1 ? '' : 's'} · {result.needs_review} need
							review.
						</p>
						{result.errors && result.errors.length > 0 ? (
							<ul className="mt-2 list-disc pl-5 text-xs text-gray-600">
								{result.errors.map((rowError, index) => (
									<li key={`${index}-${rowError}`}>{rowError}</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
