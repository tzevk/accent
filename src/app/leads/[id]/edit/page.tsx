'use client';

import Navbar from '@/components/Navbar';
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionRBAC } from '@/utils/client-rbac';
import {
	RESOURCES as RBAC_RESOURCES,
	PERMISSIONS as RBAC_PERMISSIONS,
} from '@/utils/rbac';
import { apiDelete, apiPost, apiPut } from '@/lib/api-client';
import { formatDate, formatDateInput } from '@/lib/format';
import { cn } from '@/lib/cn';
import { isActiveLeadStage, LEAD_STAGES } from '@/lib/lead-stages';
import LegacyReviewPanel from '@/components/leads/LegacyReviewPanel';
import OwnerSelect from '@/components/leads/OwnerSelect';
import {
	leadKeys,
	useCompanyDirectory,
	useFollowUpDetail,
	useLeadDetail,
	useLeadFollowUps,
	useLeadOwners,
	type FollowUpRow,
} from '@/components/leads/queries';
import type { LeadDetail } from '@/components/leads/types';
import {
	ArrowLeftIcon,
	UserIcon,
	PhoneIcon,
	PencilIcon,
	TrashIcon,
	PlusIcon,
} from '@heroicons/react/24/outline';

interface EditLeadProps {
	params: Promise<{ id: string }>;
}

interface EditFormFields {
	lead_id: string;
	company_name: string;
	contact_name: string;
	contact_email: string;
	inquiry_email: string;
	cc_emails: string;
	phone: string;
	city: string;
	project_description: string;
	enquiry_type: string;
	enquiry_date: string;
	lead_source: string;
	priority: string;
	designation: string;
	notes: string;
	follow_up_date: string;
}

const EMPTY_FIELDS: EditFormFields = {
	lead_id: '',
	company_name: '',
	contact_name: '',
	contact_email: '',
	inquiry_email: '',
	cc_emails: '',
	phone: '',
	city: '',
	project_description: '',
	enquiry_type: '',
	enquiry_date: '',
	lead_source: '',
	priority: '',
	designation: '',
	notes: '',
	follow_up_date: '',
};

interface FollowUpFormFields {
	follow_up_date: string;
	follow_up_type: string;
	description: string;
	status: string;
	next_action: string;
	next_follow_up_date: string;
	notes: string;
}

const EMPTY_FOLLOW_UP: FollowUpFormFields = {
	follow_up_date: '',
	follow_up_type: 'Call',
	description: '',
	status: 'Scheduled',
	next_action: '',
	next_follow_up_date: '',
	notes: '',
};

const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

const FOLLOW_UP_TYPE_TONES: Record<string, string> = {
	Call: 'bg-blue-100 text-blue-800',
	Email: 'bg-green-100 text-green-800',
	Meeting: 'bg-purple-100 text-purple-800',
	WhatsApp: 'bg-yellow-100 text-yellow-800',
};

const FOLLOW_UP_STATUS_TONES: Record<string, string> = {
	Completed: 'bg-green-100 text-green-800',
	Pending: 'bg-yellow-100 text-yellow-800',
};

function leadToForm(lead: LeadDetail): EditFormFields {
	return {
		lead_id: lead.lead_id || '',
		company_name: lead.company_name || '',
		contact_name: lead.contact_name || '',
		contact_email: lead.contact_email || '',
		inquiry_email: lead.inquiry_email || '',
		cc_emails: lead.cc_emails || '',
		phone: lead.phone || '',
		city: lead.city || '',
		project_description: lead.project_description || '',
		enquiry_type: lead.enquiry_type || '',
		enquiry_date: formatDateInput(lead.enquiry_date),
		lead_source: lead.lead_source || '',
		priority: lead.priority || '',
		designation: lead.designation || '',
		notes: lead.notes || '',
		follow_up_date: formatDateInput(lead.follow_up_date),
	};
}

function followUpToForm(row: FollowUpRow): FollowUpFormFields {
	return {
		follow_up_date:
			formatDateInput(row.follow_up_date) || formatDateInput(new Date()),
		follow_up_type: row.follow_up_type || 'Call',
		description: row.description || '',
		status: row.status || 'Scheduled',
		next_action: row.next_action || '',
		next_follow_up_date: formatDateInput(row.next_follow_up_date),
		notes: row.notes || '',
	};
}

/**
 * Lead edit workspace. Field edits need leads:update; an owner change in the
 * same submit needs leads:assign too. The stage control never offers
 * Converted.
 */
export default function EditLead({ params }: EditLeadProps) {
	const { id } = use(params);
	const router = useRouter();
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<'details' | 'followups'>(
		'details'
	);
	const [editingFollowUp, setEditingFollowUp] = useState<number | null>(null);
	const [showAddFollowUp, setShowAddFollowUp] = useState<boolean>(false);
	const [showCompanySuggestions, setShowCompanySuggestions] =
		useState<boolean>(false);
	const [formData, setFormData] = useState<EditFormFields>(EMPTY_FIELDS);
	const [stage, setStage] = useState<string>('');
	const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
	const [followUpForm, setFollowUpForm] = useState<FollowUpFormFields>({
		...EMPTY_FOLLOW_UP,
		follow_up_date: formatDateInput(new Date()),
	});
	const [saveError, setSaveError] = useState<string | null>(null);
	const { loading: rbacLoading, can } = useSessionRBAC();
	const canView =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.READ);
	const canUpdate =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.UPDATE);
	const canAssign =
		!rbacLoading && can(RBAC_RESOURCES.LEADS, RBAC_PERMISSIONS.ASSIGN);
	// The canonical Proposal decision needs the Lead update right and the
	// right to read the Proposals the decision is made between.
	const canReviewProposal =
		canUpdate && can(RBAC_RESOURCES.PROPOSALS, RBAC_PERMISSIONS.READ);
	const detailQuery = useLeadDetail(id, canView);
	const ownersQuery = useLeadOwners(!rbacLoading && canAssign);
	const companiesQuery = useCompanyDirectory(canView);
	const lead = detailQuery.data?.data ?? null;
	const companies = companiesQuery.data?.data ?? [];
	const followUpsQuery = useLeadFollowUps(lead?.id ?? null, canView);
	const followUpDetailQuery = useFollowUpDetail(editingFollowUp);
	const followUps = followUpsQuery.data?.data ?? [];
	const updateMutation = useMutation<
		{ success: boolean },
		Error,
		Record<string, string | number | null>
	>({
		mutationFn: (payload) => apiPut(`/api/leads/${id}`, payload),
		onSuccess: () => {
			alert('Lead updated successfully!');
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
			router.push(`/leads/${id}`);
		},
		onError: (error) => {
			setSaveError(error.message);
		},
	});
	const followUpSaveMutation = useMutation<
		{ success: boolean; data: FollowUpRow },
		Error,
		{ followUpId: number | null; payload: Record<string, unknown> }
	>({
		mutationFn: ({ followUpId, payload }) =>
			followUpId === null
				? apiPost('/api/followups', payload)
				: apiPut(`/api/followups/${followUpId}`, payload),
		onSuccess: (response, variables) => {
			if (variables.followUpId === null) {
				setShowAddFollowUp(false);
				alert('Follow-up created successfully!');
			} else {
				setEditingFollowUp(null);
				alert('Follow-up updated successfully!');
			}
			setFollowUpForm({
				...EMPTY_FOLLOW_UP,
				follow_up_date: formatDateInput(new Date()),
			});
			if (lead) {
				void queryClient.invalidateQueries({
					queryKey: leadKeys.followUps(lead.id),
				});
			}
			if (variables.followUpId !== null) {
				void queryClient.invalidateQueries({
					queryKey: leadKeys.followUp(variables.followUpId),
				});
			}
			if (!response.success) {
				alert('Follow-up saved with warnings.');
			}
		},
		onError: (error) => {
			alert('Error saving follow-up: ' + error.message);
		},
	});
	const followUpDeleteMutation = useMutation<
		{ success: boolean },
		Error,
		{ followUpId: number }
	>({
		mutationFn: ({ followUpId }) => apiDelete(`/api/followups/${followUpId}`),
		onSuccess: (_, variables) => {
			if (editingFollowUp === variables.followUpId) setEditingFollowUp(null);
			if (lead) {
				void queryClient.invalidateQueries({
					queryKey: leadKeys.followUps(lead.id),
				});
			}
			alert('Follow-up deleted successfully!');
		},
		onError: (error) => {
			alert('Error deleting follow-up: ' + error.message);
		},
	});

	// Seed the form from the loaded Lead. Adjusting state during render keeps
	// the first paint free of an empty form and needs no effect.
	const [seededLeadId, setSeededLeadId] = useState<string | null>(null);
	if (lead && seededLeadId !== String(lead.id)) {
		setSeededLeadId(String(lead.id));
		setFormData(leadToForm(lead));
		setStage(lead.enquiry_status ?? '');
		setOwnerUserId(lead.owner_user_id ?? null);
	}

	// Same rule for the follow-up being edited.
	const [seededFollowUpId, setSeededFollowUpId] = useState<number | null>(null);
	const editedFollowUp = followUpDetailQuery.data?.data ?? null;
	if (
		editingFollowUp !== null &&
		editedFollowUp &&
		seededFollowUpId !== editingFollowUp
	) {
		setSeededFollowUpId(editingFollowUp);
		setFollowUpForm(followUpToForm(editedFollowUp));
	}

	useEffect(() => {
		if (followUpDetailQuery.error instanceof Error) {
			alert('Error loading follow-up: ' + followUpDetailQuery.error.message);
		}
	}, [followUpDetailQuery.error]);

	const loading = detailQuery.isPending;
	const loadError =
		detailQuery.error instanceof Error ? detailQuery.error.message : null;
	const saving = updateMutation.isPending;
	const addingFollowUp = followUpSaveMutation.isPending;

	const setField = (name: keyof EditFormFields, value: string): void => {
		setFormData((previous) => ({ ...previous, [name]: value }));
	};

	const handleSelectCompany = (company: (typeof companies)[number]): void => {
		setFormData((previous) => ({
			...previous,
			company_name: company.company_name || previous.company_name || '',
			city: company.city || previous.city || '',
			phone: company.phone || company.mobile_number || previous.phone || '',
			contact_email: company.email || previous.contact_email || '',
			contact_name: company.contact_person || previous.contact_name || '',
			designation: company.designation || previous.designation || '',
		}));
		setShowCompanySuggestions(false);
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (!lead) return;
		updateMutation.reset();
		setSaveError(null);
		if (!canUpdate) {
			setSaveError('You do not have permission to update leads.');
			return;
		}
		const ownerChanged = (ownerUserId ?? null) !== (lead.owner_user_id ?? null);
		if (ownerChanged && !canAssign) {
			setSaveError('You do not have permission to assign this lead.');
			return;
		}
		const currentStage: string = lead.enquiry_status ?? '';
		const locked =
			currentStage === 'Converted' || currentStage === 'Disqualified';
		if (locked && stage !== currentStage) {
			setSaveError(
				'This stage is read-only here. Ordinary contact and owner edits are still allowed.'
			);
			return;
		}
		if (stage === 'Converted') {
			setSaveError(
				'Converted is recorded by the Proposal handoff, not a manual stage edit.'
			);
			return;
		}
		if (stage === 'Disqualified') {
			setSaveError(
				'Disqualified needs a recorded reason. This slice keeps it read-only.'
			);
			return;
		}
		const payload: Record<string, string | number | null> = {
			lead_id: formData.lead_id,
			company_name: formData.company_name,
			contact_name: formData.contact_name,
			contact_email: formData.contact_email,
			inquiry_email: formData.inquiry_email,
			cc_emails: formData.cc_emails,
			phone: formData.phone,
			city: formData.city,
			project_description: formData.project_description,
			enquiry_type: formData.enquiry_type,
			enquiry_date: formData.enquiry_date,
			lead_source: formData.lead_source,
			priority: formData.priority,
			designation: formData.designation,
			notes: formData.notes,
		};
		if (ownerChanged) payload.owner_user_id = ownerUserId;
		if (!locked && stage !== currentStage) payload.enquiry_status = stage;
		if (formData.follow_up_date !== formatDateInput(lead.follow_up_date)) {
			payload.follow_up_date = formData.follow_up_date;
		}
		updateMutation.mutate(payload);
	};

	const handleFollowUpSubmit = (
		event: React.FormEvent<HTMLFormElement>
	): void => {
		event.preventDefault();
		if (!lead) return;
		if (!followUpForm.follow_up_date || !followUpForm.description) {
			alert('Please provide a date and description for the follow-up.');
			return;
		}
		if (editingFollowUp) {
			followUpSaveMutation.mutate({
				followUpId: editingFollowUp,
				payload: { ...followUpForm },
			});
		} else {
			followUpSaveMutation.mutate({
				followUpId: null,
				payload: { ...followUpForm, lead_id: lead.id },
			});
		}
	};

	const handleDeleteFollowUp = (followUpId: number): void => {
		if (!confirm('Are you sure you want to delete this follow-up?')) return;
		followUpDeleteMutation.mutate({ followUpId });
	};

	if (loading) {
		return (
			<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
				<Navbar />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center" role="status">
						<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto"></div>
						<p className="mt-4 text-gray-600">Loading lead details...</p>
					</div>
				</div>
			</div>
		);
	}

	if (!lead || loadError) {
		return (
			<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
				<Navbar />
				<div className="flex-1 flex items-center justify-center">
					<div className="text-center">
						<h2 className="text-xl font-semibold text-gray-900">
							Lead not found
						</h2>
						<p className="mt-2 text-gray-600" role="alert">
							{loadError ?? "The lead you're trying to edit doesn't exist."}
						</p>
						<button
							type="button"
							onClick={() => router.push('/leads')}
							className="mt-4 bg-[#64126D] text-white px-4 py-2 rounded-md hover:bg-[#52105a]"
						>
							Back to Leads
						</button>
					</div>
				</div>
			</div>
		);
	}

	const stageLocked =
		lead.enquiry_status === 'Converted' ||
		lead.enquiry_status === 'Disqualified';
	const activeStageSelected = isActiveLeadStage(stage);

	return (
		<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
			<Navbar />
			<div className="flex-shrink-0 pt-24 px-6 lg:px-8 xl:px-12 2xl:px-16 pb-4">
				<div className="mb-6">
					<div className="flex items-center space-x-4 mb-4">
						<button
							type="button"
							onClick={() => router.push('/leads')}
							aria-label="Back to leads"
							className="p-2 hover:bg-gray-100 rounded-full transition-colors"
						>
							<ArrowLeftIcon className="h-5 w-5 text-gray-600" />
						</button>
						<div>
							<h1 className="text-3xl font-bold text-black mb-2">Edit Lead</h1>
							<p className="text-gray-600">{lead.company_name}</p>
						</div>
					</div>
				</div>
				<div
					role="tablist"
					aria-label="Edit lead sections"
					className="flex border-b border-gray-200 bg-white rounded-t-lg px-6 pt-4"
				>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === 'details'}
						onClick={() => setActiveTab('details')}
						className={cn(
							'px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors',
							activeTab === 'details'
								? 'border-black text-black bg-gray-50'
								: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
						)}
					>
						<UserIcon className="h-5 w-5 inline mr-2" />
						Lead Details
					</button>
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === 'followups'}
						onClick={() => setActiveTab('followups')}
						className={cn(
							'px-6 py-3 text-sm font-medium border-b-2 rounded-t-md transition-colors',
							activeTab === 'followups'
								? 'border-black text-black bg-gray-50'
								: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
						)}
					>
						<PhoneIcon className="h-5 w-5 inline mr-2" />
						Follow-ups ({followUps.length})
					</button>
				</div>
			</div>

			<div className="flex-1 px-6 lg:px-8 xl:px-12 2xl:px-16 overflow-hidden">
				<div className="h-full overflow-y-auto bg-white rounded-b-lg">
					<div className="p-6 space-y-6">
						<LegacyReviewPanel
							lead={lead}
							owners={ownersQuery.data?.data ?? []}
							canReviewStage={canUpdate}
							canReviewOwner={canAssign}
							canReviewProposal={canReviewProposal}
						/>
						{activeTab === 'details' ? (
							<form onSubmit={handleSubmit}>
								<div className="space-y-6">
									<section aria-label="Lead information">
										<h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-blue-100">
											Lead Information
										</h3>
										<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
											<div>
												<label htmlFor="lead-edit-id" className={labelClass}>
													Lead ID
												</label>
												<input
													id="lead-edit-id"
													type="text"
													name="lead_id"
													value={formData.lead_id}
													onChange={(event) =>
														setField('lead_id', event.target.value)
													}
													className={inputClass}
												/>
											</div>
											<div>
												<label
													htmlFor="lead-edit-company"
													className={labelClass}
												>
													Company Name *
												</label>
												<div className="relative">
													<input
														id="lead-edit-company"
														type="text"
														name="company_name"
														value={formData.company_name}
														onChange={(event) => {
															setField('company_name', event.target.value);
															setShowCompanySuggestions(true);
														}}
														onFocus={() => setShowCompanySuggestions(true)}
														onBlur={() =>
															setTimeout(
																() => setShowCompanySuggestions(false),
																200
															)
														}
														autoComplete="off"
														required
														className={inputClass}
													/>
													{showCompanySuggestions ? (
														<div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
															{companies.filter((company) =>
																(company.company_name || '')
																	.toLowerCase()
																	.includes(
																		(formData.company_name || '').toLowerCase()
																	)
															).length > 0 ? (
																companies
																	.filter((company) =>
																		(company.company_name || '')
																			.toLowerCase()
																			.includes(
																				(
																					formData.company_name || ''
																				).toLowerCase()
																			)
																	)
																	.map((company) => (
																		<button
																			key={company.id}
																			type="button"
																			onClick={() =>
																				handleSelectCompany(company)
																			}
																			className="w-full text-left px-4 py-2 hover:bg-purple-50 text-sm text-gray-700 font-medium transition-colors"
																		>
																			<div className="font-semibold text-gray-900">
																				{company.company_name}
																			</div>
																			<div className="text-xs text-gray-500">
																				{company.city
																					? `${company.city}${
																							company.state
																								? `, ${company.state}`
																								: ''
																						}`
																					: company.state || ''}
																			</div>
																		</button>
																	))
															) : (
																<div className="px-4 py-2 text-sm text-gray-500 italic">
																	No matching company. Keep typing to enter
																	manually.
																</div>
															)}
														</div>
													) : null}
												</div>
											</div>
											<div>
												<label
													htmlFor="lead-edit-contact"
													className={labelClass}
												>
													Contact Name
												</label>
												<input
													id="lead-edit-contact"
													type="text"
													name="contact_name"
													value={formData.contact_name}
													onChange={(event) =>
														setField('contact_name', event.target.value)
													}
													autoComplete="name"
													className={inputClass}
												/>
											</div>
											<div>
												<label
													htmlFor="lead-edit-designation"
													className={labelClass}
												>
													Designation
												</label>
												<input
													id="lead-edit-designation"
													type="text"
													name="designation"
													value={formData.designation}
													onChange={(event) =>
														setField('designation', event.target.value)
													}
													className={inputClass}
												/>
											</div>
											<div>
												<label htmlFor="lead-edit-city" className={labelClass}>
													City
												</label>
												<input
													id="lead-edit-city"
													type="text"
													name="city"
													value={formData.city}
													onChange={(event) =>
														setField('city', event.target.value)
													}
													autoComplete="address-level2"
													className={inputClass}
												/>
											</div>
											<div>
												<label htmlFor="lead-edit-phone" className={labelClass}>
													Phone Number
												</label>
												<input
													id="lead-edit-phone"
													type="tel"
													name="phone"
													value={formData.phone}
													onChange={(event) =>
														setField('phone', event.target.value)
													}
													autoComplete="tel"
													className={inputClass}
												/>
											</div>
											<div>
												<label
													htmlFor="lead-edit-source"
													className={labelClass}
												>
													Lead Source
												</label>
												<input
													id="lead-edit-source"
													type="text"
													name="lead_source"
													value={formData.lead_source}
													onChange={(event) =>
														setField('lead_source', event.target.value)
													}
													className={inputClass}
												/>
											</div>
											<div>
												<label htmlFor="lead-edit-owner" className={labelClass}>
													Lead Owner
												</label>
												{canAssign ? (
													<>
														<OwnerSelect
															id="lead-edit-owner"
															value={ownerUserId}
															onChange={setOwnerUserId}
															disabled={saving}
															describedBy="lead-edit-owner-help"
														/>
														<p
															id="lead-edit-owner-help"
															className="mt-1 text-xs text-gray-500"
														>
															Empty means unassigned intake.
														</p>
													</>
												) : (
													<p className="text-sm text-gray-600">
														{lead.owner_name ?? 'Unassigned intake'}. You do not
														have assignment permission.
													</p>
												)}
											</div>
										</div>
									</section>

									<section aria-label="Email information">
										<h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-green-100">
											Email Information
										</h3>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
											<div>
												<label
													htmlFor="lead-edit-contact-email"
													className={labelClass}
												>
													Contact Email
												</label>
												<input
													id="lead-edit-contact-email"
													type="email"
													name="contact_email"
													value={formData.contact_email}
													onChange={(event) =>
														setField('contact_email', event.target.value)
													}
													autoComplete="email"
													className={inputClass}
												/>
											</div>
											<div>
												<label
													htmlFor="lead-edit-inquiry-email"
													className={labelClass}
												>
													Inquiry Email
												</label>
												<input
													id="lead-edit-inquiry-email"
													type="email"
													name="inquiry_email"
													value={formData.inquiry_email}
													onChange={(event) =>
														setField('inquiry_email', event.target.value)
													}
													autoComplete="email"
													className={inputClass}
												/>
											</div>
											<div className="md:col-span-2">
												<label htmlFor="lead-edit-cc" className={labelClass}>
													CC Emails
												</label>
												<input
													id="lead-edit-cc"
													type="text"
													name="cc_emails"
													value={formData.cc_emails}
													onChange={(event) =>
														setField('cc_emails', event.target.value)
													}
													className={inputClass}
												/>
											</div>
										</div>
									</section>

									<section aria-label="Project and lead details">
										<h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-purple-100">
											Project & Lead Details
										</h3>
										<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
											<div>
												<label
													htmlFor="lead-edit-priority"
													className={labelClass}
												>
													Priority
												</label>
												<select
													id="lead-edit-priority"
													name="priority"
													value={formData.priority}
													onChange={(event) =>
														setField('priority', event.target.value)
													}
													className={inputClass}
												>
													<option value="Low">Low</option>
													<option value="Medium">Medium</option>
													<option value="High">High</option>
												</select>
											</div>
											<div>
												<label htmlFor="lead-edit-type" className={labelClass}>
													Enquiry Type
												</label>
												<select
													id="lead-edit-type"
													name="enquiry_type"
													value={formData.enquiry_type}
													onChange={(event) =>
														setField('enquiry_type', event.target.value)
													}
													className={inputClass}
												>
													<option value="Email">Email</option>
													<option value="Call">Call</option>
													<option value="Website">Website</option>
													<option value="Justdial">Justdial</option>
													<option value="Referral">Referral</option>
													<option value="LinkedIn">LinkedIn</option>
													<option value="Other">Other</option>
												</select>
											</div>
											<div>
												<label htmlFor="lead-edit-stage" className={labelClass}>
													Lead Stage
												</label>
												{stageLocked ? (
													<>
														<input
															id="lead-edit-stage"
															type="text"
															value={lead.enquiry_status ?? ''}
															readOnly
															disabled
															aria-describedby="lead-edit-stage-help"
															className={cn(inputClass, 'bg-gray-50')}
														/>
														<p
															id="lead-edit-stage-help"
															className="text-xs text-gray-500 mt-1"
														>
															This stage is read-only here. Ordinary contact and
															owner edits are still allowed.
														</p>
													</>
												) : (
													<>
														<select
															id="lead-edit-stage"
															name="enquiry_status"
															value={stage}
															onChange={(event) => setStage(event.target.value)}
															aria-describedby="lead-edit-stage-help"
															className={inputClass}
														>
															{lead.enquiry_status === null ? (
																<option value="">
																	Unresolved — choose a stage
																</option>
															) : null}
															{LEAD_STAGES.map((option) => {
																const unsupported =
																	option === 'Converted' ||
																	option === 'Disqualified';
																return (
																	<option
																		key={option}
																		value={option}
																		disabled={unsupported}
																	>
																		{option}
																		{unsupported ? ' (unavailable)' : ''}
																	</option>
																);
															})}
														</select>
														<p
															id="lead-edit-stage-help"
															className="text-xs text-gray-500 mt-1"
														>
															{activeStageSelected
																? 'Active stage needs an owner and a next follow-up date.'
																: 'Converted is recorded by the Proposal handoff, not a manual stage edit. Disqualified needs a recorded reason.'}
														</p>
													</>
												)}
											</div>
											<div>
												<label htmlFor="lead-edit-date" className={labelClass}>
													Enquiry Date
												</label>
												<input
													id="lead-edit-date"
													type="date"
													name="enquiry_date"
													value={formData.enquiry_date}
													onChange={(event) =>
														setField('enquiry_date', event.target.value)
													}
													className={inputClass}
												/>
											</div>
											<div>
												<label
													htmlFor="lead-edit-followup"
													className={labelClass}
												>
													Next follow-up date
												</label>
												<input
													id="lead-edit-followup"
													type="date"
													name="follow_up_date"
													value={formData.follow_up_date}
													onChange={(event) =>
														setField('follow_up_date', event.target.value)
													}
													aria-describedby="lead-edit-followup-help"
													className={inputClass}
												/>
												<p
													id="lead-edit-followup-help"
													className="text-xs text-gray-500 mt-1"
												>
													Required for active stages. Unchanged values stay
													valid.
												</p>
											</div>
										</div>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
											<div>
												<label
													htmlFor="lead-edit-project"
													className={labelClass}
												>
													Project Description
												</label>
												<textarea
													id="lead-edit-project"
													name="project_description"
													value={formData.project_description}
													onChange={(event) =>
														setField('project_description', event.target.value)
													}
													rows={3}
													className={inputClass}
												/>
											</div>
											<div>
												<label htmlFor="lead-edit-notes" className={labelClass}>
													Notes
												</label>
												<textarea
													id="lead-edit-notes"
													name="notes"
													value={formData.notes}
													onChange={(event) =>
														setField('notes', event.target.value)
													}
													rows={3}
													className={inputClass}
												/>
											</div>
										</div>
									</section>

									<div aria-live="polite">
										{saveError ? (
											<p className="text-sm text-red-600" role="alert">
												{saveError}
											</p>
										) : null}
										{!canUpdate ? (
											<p className="text-sm text-gray-600">
												You do not have permission to update leads.
											</p>
										) : null}
									</div>

									<div className="flex justify-end items-center pt-4 mt-4 border-t border-gray-300">
										<div className="flex space-x-3">
											<button
												type="button"
												onClick={() => router.push('/leads')}
												className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
											>
												Cancel
											</button>
											<button
												type="submit"
												disabled={saving || !canUpdate}
												className="px-6 py-2 bg-[#64126D] text-white font-semibold rounded-md hover:bg-[#52105a] transition-colors disabled:opacity-50 text-sm shadow-md border-2 border-[#64126D]"
											>
												{saving ? 'Saving…' : 'Update Lead'}
											</button>
										</div>
									</div>
								</div>
							</form>
						) : (
							<div className="space-y-4">
								<div className="flex justify-between items-center">
									<h3 className="text-lg font-semibold text-gray-900">
										Follow-ups
									</h3>
									<button
										type="button"
										onClick={() => setShowAddFollowUp(true)}
										className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 flex items-center space-x-2"
									>
										<PlusIcon className="h-4 w-4" />
										<span>Add Follow-up</span>
									</button>
								</div>
								{followUps.length === 0 ? (
									<div className="text-center py-8">
										<PhoneIcon className="mx-auto h-12 w-12 text-gray-400" />
										<h3 className="mt-2 text-sm font-medium text-gray-900">
											No follow-ups yet
										</h3>
										<p className="mt-1 text-sm text-gray-500">
											Get started by creating your first follow-up.
										</p>
									</div>
								) : (
									<div className="space-y-4">
										{followUps.map((followUp) => (
											<div
												key={followUp.id}
												className="bg-white border border-gray-200 rounded-lg p-4"
											>
												<div className="flex items-start justify-between">
													<div className="flex-1">
														<div className="flex items-center space-x-2 mb-2">
															<span
																className={cn(
																	'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
																	FOLLOW_UP_TYPE_TONES[
																		followUp.follow_up_type ?? ''
																	] ?? 'bg-gray-100 text-gray-800'
																)}
															>
																{followUp.follow_up_type}
															</span>
															<span className="text-sm text-gray-500">
																{followUp.follow_up_date
																	? formatDate(followUp.follow_up_date)
																	: 'No date'}
															</span>
															<span
																className={cn(
																	'inline-flex px-2 py-1 text-xs font-semibold rounded-full',
																	FOLLOW_UP_STATUS_TONES[
																		followUp.status ?? ''
																	] ?? 'bg-red-100 text-red-800'
																)}
															>
																{followUp.status}
															</span>
														</div>
														<h4 className="text-sm font-medium text-gray-900 mb-1">
															{followUp.description}
														</h4>
														{followUp.notes ? (
															<p className="text-sm text-gray-600">
																{followUp.notes}
															</p>
														) : null}
													</div>
													<div className="flex space-x-2 ml-4">
														<button
															type="button"
															onClick={() => setEditingFollowUp(followUp.id)}
															aria-label={`Edit follow-up ${followUp.id}`}
															className="text-purple-600 hover:text-purple-800 p-1"
														>
															<PencilIcon className="h-4 w-4" />
														</button>
														<button
															type="button"
															onClick={() => handleDeleteFollowUp(followUp.id)}
															aria-label={`Delete follow-up ${followUp.id}`}
															className="text-red-600 hover:text-red-800 p-1"
														>
															<TrashIcon className="h-4 w-4" />
														</button>
													</div>
												</div>
											</div>
										))}
									</div>
								)}
								{showAddFollowUp || editingFollowUp ? (
									<div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
										<h4 className="text-lg font-medium text-gray-900 mb-4">
											{editingFollowUp ? 'Edit Follow-up' : 'Add New Follow-up'}
										</h4>
										<form onSubmit={handleFollowUpSubmit} className="space-y-4">
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<div>
													<label
														htmlFor="followup-date"
														className="block text-sm font-medium text-gray-700 mb-1"
													>
														Follow-up Date
													</label>
													<input
														id="followup-date"
														type="date"
														name="follow_up_date"
														value={followUpForm.follow_up_date}
														onChange={(event) =>
															setFollowUpForm((previous) => ({
																...previous,
																follow_up_date: event.target.value,
															}))
														}
														required
														className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
													/>
												</div>
												<div>
													<label
														htmlFor="followup-type"
														className="block text-sm font-medium text-gray-700 mb-1"
													>
														Follow-up Type
													</label>
													<select
														id="followup-type"
														name="follow_up_type"
														value={followUpForm.follow_up_type}
														onChange={(event) =>
															setFollowUpForm((previous) => ({
																...previous,
																follow_up_type: event.target.value,
															}))
														}
														required
														className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
													>
														<option value="Call">Call</option>
														<option value="Email">Email</option>
														<option value="Meeting">Meeting</option>
														<option value="WhatsApp">WhatsApp</option>
														<option value="Site Visit">Site Visit</option>
													</select>
												</div>
												<div>
													<label
														htmlFor="followup-status"
														className="block text-sm font-medium text-gray-700 mb-1"
													>
														Status
													</label>
													<select
														id="followup-status"
														name="status"
														value={followUpForm.status}
														onChange={(event) =>
															setFollowUpForm((previous) => ({
																...previous,
																status: event.target.value,
															}))
														}
														required
														className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
													>
														<option value="Pending">Pending</option>
														<option value="Completed">Completed</option>
														<option value="Cancelled">Cancelled</option>
													</select>
												</div>
												<div>
													<label
														htmlFor="followup-next-date"
														className="block text-sm font-medium text-gray-700 mb-1"
													>
														Next Follow-up Date
													</label>
													<input
														id="followup-next-date"
														type="date"
														name="next_follow_up_date"
														value={followUpForm.next_follow_up_date}
														onChange={(event) =>
															setFollowUpForm((previous) => ({
																...previous,
																next_follow_up_date: event.target.value,
															}))
														}
														className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
													/>
												</div>
											</div>
											<div>
												<label
													htmlFor="followup-description"
													className="block text-sm font-medium text-gray-700 mb-1"
												>
													Description
												</label>
												<textarea
													id="followup-description"
													name="description"
													value={followUpForm.description}
													onChange={(event) =>
														setFollowUpForm((previous) => ({
															...previous,
															description: event.target.value,
														}))
													}
													required
													rows={3}
													className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
												/>
											</div>
											<div>
												<label
													htmlFor="followup-notes"
													className="block text-sm font-medium text-gray-700 mb-1"
												>
													Notes
												</label>
												<textarea
													id="followup-notes"
													name="notes"
													value={followUpForm.notes}
													onChange={(event) =>
														setFollowUpForm((previous) => ({
															...previous,
															notes: event.target.value,
														}))
													}
													rows={2}
													className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
												/>
											</div>
											<div className="flex justify-end space-x-3">
												<button
													type="button"
													onClick={() => {
														setEditingFollowUp(null);
														setShowAddFollowUp(false);
													}}
													className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
												>
													Cancel
												</button>
												<button
													type="submit"
													disabled={addingFollowUp}
													className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50"
												>
													{addingFollowUp
														? 'Saving...'
														: editingFollowUp
															? 'Update'
															: 'Create'}{' '}
													Follow-up
												</button>
											</div>
										</form>
									</div>
								) : null}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
