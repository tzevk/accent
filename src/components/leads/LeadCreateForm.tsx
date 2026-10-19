'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiPost } from '@/lib/api-client';
import OwnerSelect from '@/components/leads/OwnerSelect';
import { leadKeys } from '@/components/leads/queries';
import { cn } from '@/lib/cn';

interface LeadCreateFormFields {
	lead_id: string;
	company_name: string;
	contact_name: string;
	contact_email: string;
	inquiry_email: string;
	cc_emails: string;
	phone: string;
	designation: string;
	city: string;
	project_description: string;
	enquiry_type: string;
	enquiry_date: string;
	lead_source: string;
	priority: string;
	notes: string;
	follow_up_date: string;
}

const INITIAL_FIELDS: LeadCreateFormFields = {
	lead_id: '',
	company_name: '',
	contact_name: '',
	contact_email: '',
	inquiry_email: '',
	cc_emails: '',
	phone: '',
	designation: '',
	city: '',
	project_description: '',
	enquiry_type: 'Email',
	enquiry_date: '',
	lead_source: '',
	priority: 'Medium',
	notes: '',
	follow_up_date: '',
};

interface LeadCreateFormProps {
	companies: Array<{ id: number; company_name: string }>;
	creatorLabel: string | null;
	canAssign: boolean;
	onCreated: () => void;
	onCancel: () => void;
}

const inputClass =
	'w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-accent-purple focus:border-transparent text-sm';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';

/**
 * Manual lead creation. The server always starts the lead at New and defaults
 * the owner to the authenticated creator; the payload therefore omits the
 * stage and omits the owner unless an assign-permitted override is chosen.
 */
export default function LeadCreateForm({
	companies,
	creatorLabel,
	canAssign,
	onCreated,
	onCancel,
}: LeadCreateFormProps) {
	const [fields, setFields] = useState<LeadCreateFormFields>(INITIAL_FIELDS);
	const [companyId, setCompanyId] = useState<string>('');
	const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const errorId = 'lead-create-error';
	const queryClient = useQueryClient();
	const createMutation = useMutation<
		{ success: boolean },
		Error,
		Record<string, string | number | null>
	>({
		mutationFn: (payload) => apiPost('/api/leads', payload),
		onSuccess: () => {
			setFields(INITIAL_FIELDS);
			setCompanyId('');
			setOwnerUserId(null);
			void queryClient.invalidateQueries({ queryKey: leadKeys.all });
			onCreated();
		},
	});
	const saving = createMutation.isPending;
	const error = formError ?? createMutation.error?.message ?? null;

	const setField = (name: keyof LeadCreateFormFields, value: string): void => {
		setFields((previous) => ({ ...previous, [name]: value }));
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		createMutation.reset();
		setFormError(null);
		if (!fields.company_name.trim()) {
			setFormError('Company name is required.');
			return;
		}
		const payload: Record<string, string | number | null> = {
			lead_id: fields.lead_id.trim() === '' ? '' : fields.lead_id.trim(),
			company_id: companyId === '' ? '' : companyId,
			company_name: fields.company_name.trim(),
			contact_name: fields.contact_name,
			contact_email: fields.contact_email,
			inquiry_email: fields.inquiry_email,
			cc_emails: fields.cc_emails,
			phone: fields.phone,
			designation: fields.designation,
			city: fields.city,
			project_description: fields.project_description,
			enquiry_type: fields.enquiry_type,
			enquiry_date: fields.enquiry_date,
			lead_source: fields.lead_source,
			priority: fields.priority,
			notes: fields.notes,
			follow_up_date: fields.follow_up_date,
		};
		if (canAssign && ownerUserId !== null) {
			payload.owner_user_id = ownerUserId;
		}
		createMutation.mutate(payload);
	};

	return (
		<form
			onSubmit={handleSubmit}
			aria-describedby={error ? errorId : undefined}
		>
			<div className="space-y-6">
				<section aria-label="Lead information">
					<h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-blue-100">
						Lead Information
					</h3>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						<div>
							<label htmlFor="lead-create-lead-id" className={labelClass}>
								Lead ID
							</label>
							<input
								id="lead-create-lead-id"
								type="text"
								name="lead_id"
								value={fields.lead_id}
								onChange={(event) => setField('lead_id', event.target.value)}
								placeholder="Auto-generated if empty"
								className={inputClass}
							/>
						</div>
						<div>
							<div className="space-y-2">
								<div>
									<label
										htmlFor="lead-create-company-select"
										className={labelClass}
									>
										Existing company
									</label>
									<select
										id="lead-create-company-select"
										name="company_id"
										value={companyId}
										onChange={(event) => {
											const selectedId = event.target.value;
											setCompanyId(selectedId);
											const selected = companies.find(
												(company) => String(company.id) === selectedId
											);
											if (selected)
												setField('company_name', selected.company_name);
										}}
										className={inputClass}
									>
										<option value="">Select a company</option>
										{companies.map((company) => (
											<option key={company.id} value={company.id}>
												{company.company_name}
											</option>
										))}
									</select>
								</div>
								<div>
									<label htmlFor="lead-create-company" className={labelClass}>
										Company *
									</label>
									<input
										id="lead-create-company"
										type="text"
										name="company_name"
										value={fields.company_name}
										onChange={(event) => {
											setField('company_name', event.target.value);
											setCompanyId('');
										}}
										placeholder="Or enter new company name"
										required
										className={inputClass}
									/>
								</div>
							</div>
						</div>
						<div>
							<label htmlFor="lead-create-contact" className={labelClass}>
								Contact Name
							</label>
							<input
								id="lead-create-contact"
								type="text"
								name="contact_name"
								value={fields.contact_name}
								onChange={(event) =>
									setField('contact_name', event.target.value)
								}
								autoComplete="name"
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="lead-create-designation" className={labelClass}>
								Designation
							</label>
							<input
								id="lead-create-designation"
								type="text"
								name="designation"
								value={fields.designation}
								onChange={(event) =>
									setField('designation', event.target.value)
								}
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="lead-create-city" className={labelClass}>
								City
							</label>
							<input
								id="lead-create-city"
								type="text"
								name="city"
								value={fields.city}
								onChange={(event) => setField('city', event.target.value)}
								autoComplete="address-level2"
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="lead-create-phone" className={labelClass}>
								Phone Number
							</label>
							<input
								id="lead-create-phone"
								type="tel"
								name="phone"
								value={fields.phone}
								onChange={(event) => setField('phone', event.target.value)}
								autoComplete="tel"
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="lead-create-source" className={labelClass}>
								Lead Source
							</label>
							<input
								id="lead-create-source"
								type="text"
								name="lead_source"
								value={fields.lead_source}
								onChange={(event) =>
									setField('lead_source', event.target.value)
								}
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="lead-create-owner" className={labelClass}>
								Lead Owner
							</label>
							{canAssign ? (
								<>
									<OwnerSelect
										id="lead-create-owner"
										value={ownerUserId}
										onChange={setOwnerUserId}
										disabled={saving}
										describedBy="lead-create-owner-help"
										intakeLabel={
											creatorLabel
												? `Creator default: ${creatorLabel}`
												: 'Creator default'
										}
									/>
									<p
										id="lead-create-owner-help"
										className="mt-1 text-xs text-gray-500"
									>
										Leave empty to keep the creator as owner.
									</p>
								</>
							) : (
								<p className="text-sm text-gray-600">
									Owner defaults to {creatorLabel ?? 'the creator'}. You do not
									have assignment permission.
								</p>
							)}
						</div>
						<div>
							<label htmlFor="lead-create-date" className={labelClass}>
								Enquiry Date
							</label>
							<input
								id="lead-create-date"
								type="date"
								name="enquiry_date"
								value={fields.enquiry_date}
								onChange={(event) =>
									setField('enquiry_date', event.target.value)
								}
								className={inputClass}
							/>
						</div>
					</div>
				</section>

				<section aria-label="Email information">
					<h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-green-100">
						Email Information
					</h3>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label htmlFor="lead-create-inquiry-email" className={labelClass}>
								Inquiry Email
							</label>
							<input
								id="lead-create-inquiry-email"
								type="email"
								name="inquiry_email"
								value={fields.inquiry_email}
								onChange={(event) =>
									setField('inquiry_email', event.target.value)
								}
								autoComplete="email"
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="lead-create-contact-email" className={labelClass}>
								Contact Email
							</label>
							<input
								id="lead-create-contact-email"
								type="email"
								name="contact_email"
								value={fields.contact_email}
								onChange={(event) =>
									setField('contact_email', event.target.value)
								}
								autoComplete="email"
								className={inputClass}
							/>
						</div>
						<div className="md:col-span-2">
							<label htmlFor="lead-create-cc" className={labelClass}>
								CC Emails
							</label>
							<input
								id="lead-create-cc"
								type="text"
								name="cc_emails"
								value={fields.cc_emails}
								onChange={(event) => setField('cc_emails', event.target.value)}
								placeholder="email1@example.com, email2@example.com"
								className={inputClass}
							/>
						</div>
					</div>
				</section>

				<section aria-label="Project and lead details">
					<h3 className="text-lg font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-purple-100">
						Project &amp; Lead Details
					</h3>
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
						<div>
							<label htmlFor="lead-create-priority" className={labelClass}>
								Priority
							</label>
							<select
								id="lead-create-priority"
								name="priority"
								value={fields.priority}
								onChange={(event) => setField('priority', event.target.value)}
								className={inputClass}
							>
								<option value="Low">Low</option>
								<option value="Medium">Medium</option>
								<option value="High">High</option>
							</select>
						</div>
						<div>
							<label htmlFor="lead-create-type" className={labelClass}>
								Enquiry Type
							</label>
							<select
								id="lead-create-type"
								name="enquiry_type"
								value={fields.enquiry_type}
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
							<label htmlFor="lead-create-stage" className={labelClass}>
								Lead Stage
							</label>
							<input
								id="lead-create-stage"
								type="text"
								value="New"
								readOnly
								disabled
								aria-describedby="lead-create-stage-help"
								className={cn(inputClass, 'bg-gray-50')}
							/>
							<p
								id="lead-create-stage-help"
								className="text-xs text-gray-500 mt-1"
							>
								New leads always start at New.
							</p>
						</div>
						<div>
							<label htmlFor="lead-create-followup" className={labelClass}>
								Next follow-up date
							</label>
							<input
								id="lead-create-followup"
								type="date"
								name="follow_up_date"
								value={fields.follow_up_date}
								onChange={(event) =>
									setField('follow_up_date', event.target.value)
								}
								className={inputClass}
							/>
							<p className="text-xs text-gray-500 mt-1">
								Optional for New. Later stages require a dated next action.
							</p>
						</div>
					</div>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<div>
							<label htmlFor="lead-create-project" className={labelClass}>
								Project Description
							</label>
							<textarea
								id="lead-create-project"
								name="project_description"
								value={fields.project_description}
								onChange={(event) =>
									setField('project_description', event.target.value)
								}
								rows={3}
								className={inputClass}
							/>
						</div>
						<div>
							<label htmlFor="lead-create-notes" className={labelClass}>
								Notes
							</label>
							<textarea
								id="lead-create-notes"
								name="notes"
								value={fields.notes}
								onChange={(event) => setField('notes', event.target.value)}
								rows={3}
								className={inputClass}
							/>
						</div>
					</div>
				</section>

				<div aria-live="polite">
					{error ? (
						<p id={errorId} className="text-sm text-red-600" role="alert">
							{error}
						</p>
					) : null}
				</div>

				<div className="flex justify-end items-center gap-3 pt-4 mt-4 border-t border-gray-300">
					<button
						type="button"
						onClick={onCancel}
						className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm"
					>
						Cancel
					</button>
					<button
						type="submit"
						disabled={saving}
						className="px-6 py-2 bg-[#64126D] text-white font-semibold rounded-md hover:bg-[#52105a] transition-colors disabled:opacity-50 text-sm shadow-md border-2 border-[#64126D]"
					>
						{saving ? 'Saving…' : 'Save Lead'}
					</button>
				</div>
			</div>
		</form>
	);
}
