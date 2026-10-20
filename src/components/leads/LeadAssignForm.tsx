'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPut } from '@/lib/api-client';
import OwnerSelect from '@/components/leads/OwnerSelect';
import { leadKeys } from '@/components/leads/queries';
import type { LeadDetail } from '@/components/leads/types';

interface LeadAssignFormProps {
	lead: Pick<LeadDetail, 'id' | 'owner_user_id' | 'owner_name'>;
	canAssign: boolean;
}

interface AssignResponse {
	success: boolean;
	data: { owner_user_id: number | null; owner_name: string | null };
}

/**
 * Pure assignment action: sends only owner_user_id so users with
 * leads:assign (but not leads:update) can still assign from the detail page.
 */
export default function LeadAssignForm({
	lead,
	canAssign,
}: LeadAssignFormProps) {
	const queryClient = useQueryClient();
	// The owner shown in the control follows the server value until the user
	// picks a different one. A pending pick is kept only while the stored
	// owner is still the one the pick was made against, so a saved change
	// replaces it without remounting the form.
	const [selection, setSelection] = useState<{
		value: number | null;
		baseOwner: number | null;
	} | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const serverOwner = lead.owner_user_id ?? null;
	const ownerUserId =
		selection && selection.baseOwner === serverOwner
			? selection.value
			: serverOwner;
	const assignMutation = useMutation<
		AssignResponse,
		Error,
		{ owner_user_id: number | null }
	>({
		mutationFn: (body) => apiPut<AssignResponse>(`/api/leads/${lead.id}`, body),
		onSuccess: (response) => {
			const nextOwnerId = response.data.owner_user_id ?? ownerUserId;
			setNotice(
				nextOwnerId === null
					? 'Lead moved to unassigned intake.'
					: 'Lead owner updated.'
			);
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
		},
	});

	if (!canAssign) {
		return (
			<p className="text-sm text-gray-600">
				You do not have permission to assign this lead.
			</p>
		);
	}

	const unchanged = (ownerUserId ?? null) === (lead.owner_user_id ?? null);
	const saving = assignMutation.isPending;
	const error = assignMutation.error?.message ?? null;

	const handleSubmit = (event: React.FormEvent): void => {
		event.preventDefault();
		assignMutation.reset();
		setNotice(null);
		if (unchanged) {
			setNotice('Owner is unchanged.');
			return;
		}
		assignMutation.mutate({ owner_user_id: ownerUserId });
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			<div>
				{/* The card that holds this form already names it "Lead
				    Owner"; a second visible label would repeat the heading
				    word for word. The control carries the name as an
				    attribute instead: a visually hidden label is positioned
				    absolutely and would leave the page at the bottom of the
				    document. */}
				<OwnerSelect
					id={`lead-owner-${lead.id}`}
					label="Lead Owner"
					value={ownerUserId}
					onChange={(next) =>
						setSelection({ value: next, baseOwner: serverOwner })
					}
					disabled={saving}
					describedBy={`lead-owner-help-${lead.id}`}
				/>
				<p
					id={`lead-owner-help-${lead.id}`}
					className="mt-1 text-xs text-gray-500"
				>
					Current owner: {lead.owner_name ?? 'Unassigned intake'}. Empty means
					unassigned intake.
				</p>
			</div>
			<div aria-live="polite">
				{error ? (
					<p className="text-sm text-red-600" role="alert">
						{error}
					</p>
				) : null}
				{notice && !error ? (
					<p className="text-sm text-green-700">{notice}</p>
				) : null}
			</div>
			<button
				type="submit"
				disabled={saving || unchanged}
				className="px-4 py-2 bg-[#64126D] text-white text-sm rounded-md hover:bg-[#52105a] disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{saving ? 'Saving…' : 'Save owner'}
			</button>
		</form>
	);
}
