'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { fetchJSON } from '@/utils/http';

export type MemberWritableSection =
	| 'assumption'
	| 'discussion'
	| 'query_log'
	| 'lessons_learnt';

export type ProjectMemberDetailsProps = {
	projectId: string | number;
	activeSection: MemberWritableSection | null;
	projectTeamMembers: Array<Record<string, unknown>>;
	currentUser: {
		id: number | string;
		full_name?: string;
		username?: string;
	} | null;
};

type MemberEntry = Record<string, unknown>;

type MemberDetailsData = {
	assumptions: MemberEntry[];
	discussions: MemberEntry[];
	queryLog: MemberEntry[];
	lessonsLearnt: MemberEntry[];
};

const EMPTY_DATA: MemberDetailsData = {
	assumptions: [],
	discussions: [],
	queryLog: [],
	lessonsLearnt: [],
};

const SECTION_LABELS: Record<MemberWritableSection, string> = {
	assumption: 'Assumption',
	discussion: 'Discussion',
	query_log: 'Query Log',
	lessons_learnt: 'Lessons Learnt',
};

const EMPTY_MESSAGES: Record<MemberWritableSection, string> = {
	assumption: 'No assumptions recorded yet.',
	discussion: 'No discussions recorded yet.',
	query_log: 'No queries logged yet.',
	lessons_learnt: 'No lessons recorded yet.',
};

const FORM_KEYS: Record<MemberWritableSection, string> = {
	assumption: 'assumptions',
	discussion: 'discussions',
	query_log: 'queryLog',
	lessons_learnt: 'lessonsLearnt',
};

const INITIAL_FORMS: Record<MemberWritableSection, Record<string, string>> = {
	assumption: {
		assumption_description: '',
		reason: '',
		remark: '',
	},
	discussion: {
		follow_up_date: '',
		description: '',
		responsible_person: '',
	},
	query_log: {
		query_description: '',
		query_issued_date: '',
		reply_from_client: '',
		reply_received_date: '',
		query_resolved: '',
		remark: '',
	},
	lessons_learnt: {
		what_was_new: '',
		difficulty_faced: '',
		what_you_learn: '',
		areas_of_improvement: '',
		remark: '',
	},
};

function text(value: unknown): string {
	return value === null || value === undefined ? '' : String(value);
}

function memberLabel(member: Record<string, unknown>): string {
	return text(
		member.name ||
			member.employee_name ||
			member.full_name ||
			member.username ||
			member.email ||
			member.id
	);
}

function FieldError({ id, message }: { id: string; message?: string }) {
	if (!message) return null;
	return (
		<p id={id} className="mt-1 text-xs text-red-600">
			{message}
		</p>
	);
}

export function ProjectMemberDetails({
	projectId,
	activeSection,
	projectTeamMembers,
	currentUser,
}: ProjectMemberDetailsProps) {
	const [details, setDetails] = useState<MemberDetailsData>(EMPTY_DATA);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState(false);
	const [forms, setForms] =
		useState<Record<MemberWritableSection, Record<string, string>>>(
			INITIAL_FORMS
		);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [statusMessage, setStatusMessage] = useState('');
	const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

	useEffect(() => {
		let mounted = true;
		setLoading(true);
		setLoadError(false);
		fetchJSON(`/api/projects/${projectId}/member-details`)
			.then((response) => {
				if (!mounted) return;
				const next = response?.data || {};
				setDetails({
					assumptions: Array.isArray(next.assumptions) ? next.assumptions : [],
					discussions: Array.isArray(next.discussions) ? next.discussions : [],
					queryLog: Array.isArray(next.queryLog) ? next.queryLog : [],
					lessonsLearnt: Array.isArray(next.lessonsLearnt)
						? next.lessonsLearnt
						: [],
				});
			})
			.catch(() => {
				if (mounted) setLoadError(true);
			})
			.finally(() => {
				if (mounted) setLoading(false);
			});

		return () => {
			mounted = false;
		};
	}, [projectId]);

	const teamOptions = useMemo(
		() =>
			projectTeamMembers
				.map((member) => memberLabel(member))
				.filter(Boolean)
				.filter((value, index, values) => values.indexOf(value) === index),
		[projectTeamMembers]
	);
	const contributorName =
		currentUser?.full_name || currentUser?.username || 'you';

	if (!activeSection) return null;

	const form = forms[activeSection];
	const sectionLabel = SECTION_LABELS[activeSection];
	const listKey = FORM_KEYS[activeSection] as keyof MemberDetailsData;
	const entries = details[listKey];
	const requiredField =
		activeSection === 'assumption'
			? 'assumption_description'
			: activeSection === 'discussion'
				? 'description'
				: activeSection === 'query_log'
					? 'query_description'
					: 'what_was_new';

	const fieldId = (field: string) =>
		`member-${activeSection}-${field.replaceAll('_', '-')}`;
	const errorId = (field: string) => `${fieldId(field)}-error`;

	const setFormField = (field: string, value: string) => {
		setForms((previous) => ({
			...previous,
			[activeSection]: { ...previous[activeSection], [field]: value },
		}));
		if (errors[field]) {
			setErrors((previous) => {
				const next = { ...previous };
				delete next[field];
				return next;
			});
		}
	};

	const renderFieldError = (field: string) => (
		<FieldError id={errorId(field)} message={errors[field]} />
	);

	const controlProps = (field: string) => ({
		id: fieldId(field),
		name: field,
		value: form[field] || '',
		onChange: (
			event: ChangeEvent<
				HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
			>
		) => setFormField(field, event.target.value),
		'aria-invalid': Boolean(errors[field]),
		'aria-describedby': errors[field] ? errorId(field) : undefined,
		'aria-required': field === requiredField,
		ref: (element: HTMLElement | null) => {
			fieldRefs.current[field] = element;
		},
	});

	const renderTextField = (
		field: string,
		label: string,
		options: { multiline?: boolean; type?: string; required?: boolean } = {}
	) => {
		const props = controlProps(field);
		return (
			<div className={options.multiline ? 'sm:col-span-2' : ''}>
				<label
					htmlFor={props.id}
					className="mb-1 block text-sm font-medium text-gray-800"
				>
					{label}
					{options.required ? ' *' : ''}
				</label>
				{options.multiline ? (
					<textarea
						{...props}
						rows={4}
						className="min-h-24 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500"
					/>
				) : (
					<input
						{...props}
						type={options.type || 'text'}
						className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500"
					/>
				)}
				{renderFieldError(field)}
			</div>
		);
	};

	const renderEntries = () => {
		if (loading) {
			return (
				<p className="text-sm text-gray-500">
					Loading {sectionLabel.toLowerCase()} details…
				</p>
			);
		}
		if (loadError) {
			return (
				<p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
					Unable to load {sectionLabel.toLowerCase()} details. Check your
					connection and try again.
				</p>
			);
		}
		if (entries.length === 0) {
			return (
				<p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
					{EMPTY_MESSAGES[activeSection]}
				</p>
			);
		}

		return (
			<div className="space-y-3">
				{entries.map((entry, index) => {
					const entryId = text(entry.id) || `${activeSection}-${index}`;
					if (activeSection === 'discussion') {
						return (
							<article
								key={entryId}
								className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
							>
								<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
									<h3 className="text-sm font-semibold text-gray-900">
										{text(entry.description) || `Discussion ${index + 1}`}
									</h3>
									<span className="w-fit rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
										{text(entry.status) || 'Scheduled'}
									</span>
								</div>
								<div className="mt-2 grid grid-cols-1 gap-1 text-xs text-gray-600 sm:grid-cols-3">
									<span>Date: {text(entry.follow_up_date) || '—'}</span>
									<span>
										Responsible: {text(entry.responsible_person) || '—'}
									</span>
									<span>
										Logged by:{' '}
										{text(entry.logged_by || entry.created_by) || '—'}
									</span>
								</div>
							</article>
						);
					}

					return (
						<article
							key={entryId}
							className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
						>
							<h3 className="text-sm font-semibold text-gray-900">
								{text(
									entry[requiredField] ||
										(activeSection === 'query_log'
											? `Query ${index + 1}`
											: activeSection === 'assumption'
												? `Assumption ${index + 1}`
												: `Lesson ${index + 1}`)
								)}
							</h3>
							<div className="mt-2 space-y-1 text-sm text-gray-600">
								{activeSection === 'assumption' && (
									<>
										{entry.reason ? <p>Reason: {text(entry.reason)}</p> : null}
										{entry.assumption_taken_by ? (
											<p>Taken by: {text(entry.assumption_taken_by)}</p>
										) : null}
									</>
								)}
								{activeSection === 'query_log' && (
									<>
										<p>Issued: {text(entry.query_issued_date) || '—'}</p>
										<p>Resolution: {text(entry.query_resolved) || 'Pending'}</p>
										{entry.reply_from_client ? (
											<p>Reply: {text(entry.reply_from_client)}</p>
										) : null}
									</>
								)}
								{activeSection === 'lessons_learnt' && (
									<>
										{entry.difficulty_faced ? (
											<p>Difficulty: {text(entry.difficulty_faced)}</p>
										) : null}
										{entry.what_you_learn ? (
											<p>Learned: {text(entry.what_you_learn)}</p>
										) : null}
									</>
								)}
								{entry.remark ? <p>Remark: {text(entry.remark)}</p> : null}
							</div>
						</article>
					);
				})}
			</div>
		);
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (saving) return;

		const requiredValue = form[requiredField]?.trim() || '';
		if (!requiredValue) {
			setErrors({ [requiredField]: 'This field is required.' });
			setStatusMessage('');
			fieldRefs.current[requiredField]?.focus();
			return;
		}

		setSaving(true);
		setErrors({});
		setStatusMessage('');
		try {
			const response = await fetchJSON(
				`/api/projects/${projectId}/member-details`,
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ section: activeSection, entry: form }),
				}
			);
			const entry = response?.data?.entry;
			if (!entry || typeof entry !== 'object')
				throw new Error('Missing saved entry');
			setDetails((previous) => ({
				...previous,
				[listKey]: [entry as MemberEntry, ...previous[listKey]],
			}));
			setForms((previous) => ({
				...previous,
				[activeSection]: { ...INITIAL_FORMS[activeSection] },
			}));
			setStatusMessage(`Saved ${activeSection}`);
		} catch {
			setStatusMessage(
				`Unable to save ${activeSection}. Check your connection and try again.`
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			id={`panel-${activeSection}`}
			role="tabpanel"
			aria-labelledby={`tab-${activeSection}`}
			tabIndex={0}
			className="rounded-xl border border-gray-200/60 bg-white p-4 shadow-sm sm:p-6"
		>
			<div className="mb-5 border-b border-gray-100 pb-4">
				<p className="mt-1 text-sm text-gray-600">
					Add a contribution for this project. Existing records are read-only.
					Contributions are recorded as {contributorName}.
				</p>
			</div>

			{renderEntries()}

			<form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					{activeSection === 'assumption' && (
						<>
							{renderTextField('assumption_description', 'Assumption', {
								multiline: true,
								required: true,
							})}
							{renderTextField('reason', 'Reason', { multiline: true })}
							{renderTextField('remark', 'Remark', { multiline: true })}
						</>
					)}

					{activeSection === 'discussion' && (
						<>
							{renderTextField('follow_up_date', 'Follow-up date', {
								type: 'date',
							})}
							{renderTextField('description', 'Discussion', {
								multiline: true,
								required: true,
							})}
							<div>
								<label
									htmlFor={fieldId('responsible_person')}
									className="mb-1 block text-sm font-medium text-gray-800"
								>
									Responsible person
								</label>
								<select
									{...controlProps('responsible_person')}
									className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500"
								>
									<option value="">Select a team member</option>
									{teamOptions.map((option) => (
										<option key={option} value={option}>
											{option}
										</option>
									))}
								</select>
								{renderFieldError('responsible_person')}
							</div>
						</>
					)}

					{activeSection === 'query_log' && (
						<>
							{renderTextField('query_description', 'Query', {
								multiline: true,
								required: true,
							})}
							{renderTextField('query_issued_date', 'Issued date', {
								type: 'date',
							})}
							{renderTextField('reply_from_client', 'Reply from client', {
								multiline: true,
							})}
							{renderTextField('reply_received_date', 'Reply received date', {
								type: 'date',
							})}
							<div>
								<label
									htmlFor={fieldId('query_resolved')}
									className="mb-1 block text-sm font-medium text-gray-800"
								>
									Resolution
								</label>
								<select
									{...controlProps('query_resolved')}
									className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:border-transparent focus:outline-none focus:ring-2 focus:ring-purple-500"
								>
									<option value="">Pending</option>
									<option value="Resolved">Resolved</option>
								</select>
							</div>
							{renderTextField('remark', 'Remark', { multiline: true })}
						</>
					)}

					{activeSection === 'lessons_learnt' && (
						<>
							{renderTextField('what_was_new', 'What was new', {
								multiline: true,
								required: true,
							})}
							{renderTextField('difficulty_faced', 'Difficulty faced', {
								multiline: true,
							})}
							{renderTextField('what_you_learn', 'What you learned', {
								multiline: true,
							})}
							{renderTextField('areas_of_improvement', 'Areas of improvement', {
								multiline: true,
							})}
							{renderTextField('remark', 'Remark', { multiline: true })}
						</>
					)}
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p
						role="status"
						aria-live="polite"
						className="min-h-5 text-sm text-gray-600"
					>
						{statusMessage}
					</p>
					<button
						type="submit"
						disabled={saving}
						className="rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
					>
						{activeSection === 'assumption'
							? 'Add assumption'
							: activeSection === 'discussion'
								? 'Add discussion'
								: activeSection === 'query_log'
									? 'Add query'
									: 'Add lesson'}
					</button>
				</div>
			</form>
		</section>
	);
}

export default ProjectMemberDetails;
