'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import { Button } from '@/components/ui/button';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { apiGet, apiPut } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import {
	SECTION_LABELS,
	WORK_SECTION_IDS,
	type LeadSectionSetting,
	type SectionId,
} from '@/lib/project-rights/sections';
import { isLeadSectionSetting } from '@/lib/project-rights/lead-policy';

type SectionSettings = Record<SectionId, LeadSectionSetting>;

type LeadPolicyPayload = {
	sections: SectionSettings;
	updated_at: string | null;
	updated_by: number | null;
};

type LeadPolicyResponse = {
	success: boolean;
	data: LeadPolicyPayload;
};

const SETTINGS: { value: LeadSectionSetting; label: string }[] = [
	{ value: 'hidden', label: 'Hidden' },
	{ value: 'view', label: 'Read-only' },
	{ value: 'edit', label: 'Editable' },
];

const QUERY_KEY = ['admin', 'project-lead-policy'];

export default function ProjectLeadPolicyPage() {
	const queryClient = useQueryClient();
	const policyQuery = useQuery<LeadPolicyResponse>({
		queryKey: QUERY_KEY,
		queryFn: () => apiGet('/api/admin/project-lead-policy'),
	});
	const loaded = policyQuery.data?.data;

	const [draft, setDraft] = useState<SectionSettings | null>(null);
	const [saved, setSaved] = useState(false);

	// The saved policy is the source of truth; `draft` holds only unsaved
	// edits, so a refetch or save needs no state-sync effect.
	const sections = draft ?? loaded?.sections ?? null;

	const saveMutation = useMutation<
		LeadPolicyResponse,
		Error,
		SectionSettings
	>({
		mutationFn: (values) =>
			apiPut('/api/admin/project-lead-policy', {
				sections: values,
			}),
		onSuccess: (response) => {
			queryClient.setQueryData(QUERY_KEY, response);
			setDraft(null);
			setSaved(true);
		},
	});

	const dirty = Boolean(
		draft &&
			loaded &&
			WORK_SECTION_IDS.some(
				(section) => draft[section] !== loaded.sections[section]
			)
	);

	const setSection = (section: SectionId, value: LeadSectionSetting) => {
		if (!sections) return;
		setSaved(false);
		setDraft({ ...sections, [section]: value });
	};

	const reset = () => {
		setSaved(false);
		setDraft(null);
	};

	const updatedLabel = loaded?.updated_at
		? formatDateTime(loaded.updated_at)
		: 'Never saved';

	return (
		<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col sm:px-4 overflow-hidden">
				<div className="max-w-4xl mx-auto w-full flex-1 min-h-0 flex flex-col space-y-5 overflow-y-auto py-4">
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">
								Project Lead Policy
							</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								One policy applies to every project. Choose what each section
								allows a Project Lead.
							</p>
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={reset}
								disabled={!dirty || saveMutation.isPending}
							>
								Reset
							</Button>
							<Button
								size="sm"
								onClick={() => sections && saveMutation.mutate(sections)}
								disabled={!dirty || saveMutation.isPending}
							>
								{saveMutation.isPending ? 'Saving…' : 'Save'}
							</Button>
						</div>
					</header>

					<div
						role="status"
						aria-live="polite"
						className="text-sm min-h-5"
					>
						{policyQuery.isLoading && (
							<span className="text-gray-500">Loading policy…</span>
						)}
						{policyQuery.isError && (
							<span className="text-red-700">
								Failed to load the policy. Refresh to try again.
							</span>
						)}
						{saveMutation.isError && (
							<span className="text-red-700">
								{saveMutation.error instanceof Error
									? saveMutation.error.message
									: 'Failed to save the policy.'}
							</span>
						)}
						{saved && !dirty && (
							<span className="text-green-700">
								Policy saved. Changes apply immediately.
							</span>
						)}
					</div>

					<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Section</TableHead>
									<TableHead>Project Lead access</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{WORK_SECTION_IDS.map((section) => {
									const selectId = `lead-policy-${section}`;
									const value = sections?.[section] ?? 'edit';
									return (
										<TableRow key={section}>
											<TableCell>
												<label
													htmlFor={selectId}
													className="text-sm font-medium text-gray-900"
												>
													{SECTION_LABELS[section]}
												</label>
											</TableCell>
											<TableCell>
												<select
													id={selectId}
													value={value}
													disabled={!sections || policyQuery.isLoading}
													onChange={(event) => {
														const next = event.target.value;
														if (isLeadSectionSetting(next)) {
															setSection(section, next);
														}
													}}
													className="h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900"
												>
													{SETTINGS.map((option) => (
														<option
															key={option.value}
															value={option.value}
														>
															{option.label}
														</option>
													))}
												</select>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</div>

					<p className="text-xs text-gray-500">
						Last saved: {updatedLabel}
					</p>
				</div>
			</div>
		</div>
	);
}
