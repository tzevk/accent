'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
	ArrowPathIcon,
	ExclamationCircleIcon,
	UserCircleIcon,
} from '@heroicons/react/24/outline';
import { formatCurrency } from '@/lib/format';
import { mul, toNumber } from '@/lib/money';
import type { SalaryTimelineAgreementDto } from '@/lib/salary-profile-commands';
import {
	SalaryProfileRequestError,
	useSalaryCommand,
	useSalaryProfileTimeline,
} from '@/hooks/useSalaryProfiles';
import { SalaryProfileEstimate } from '@/components/salary-profiles/SalaryProfileEstimate';
import { SalaryProfileFields } from '@/components/salary-profiles/SalaryProfileFields';
import { SalaryProfileHistory } from '@/components/salary-profiles/SalaryProfileHistory';
import { useUnsavedNavigationGuard } from '@/components/salary-profiles/useUnsavedNavigationGuard';
import {
	UNSAVED_SALARY_MESSAGE,
	agreementKey,
	buildCancelCommandInput,
	buildSalaryCommandInput,
	canCreateInitial,
	createEmptyDraft,
	createStartFor,
	defaultViewedKey,
	draftFromAgreement,
	draftIsDirty,
	durationLabel,
	findAgreement,
	displayDate,
	displayMonth,
	formatPeriod,
	hasDraftOverrides,
	monthStartOf,
	previewProfileFromAgreement,
	previewProfileFromDraft,
	revisionStartFor,
	reviewRows,
	salaryTypeLabel,
	statusLabel,
	todayInput,
	validateSalaryDraft,
	type ApplicabilityKey,
	type SalaryDraft,
	type SalaryOperation,
} from '@/components/salary-profiles/salary-profile-form';

interface EditingState {
	operation: SalaryOperation;
	agreementId: number | null;
	expectedVersion: number;
	baseDraft: SalaryDraft;
}

const OPERATION_LABELS: Record<SalaryOperation, string> = {
	'create-initial': 'new agreement',
	correct: 'correction',
	revise: 'revision',
};

function operationCopy(operation: SalaryOperation, agreementId: number | null) {
	switch (operation) {
		case 'create-initial':
			return 'This creates the first dated salary agreement. It does not convert recorded legacy terms.';
		case 'revise':
			return 'This revision keeps the previous agreement and creates a dated successor. The previous terms remain readable.';
		default:
			return `This correction keeps agreement #${agreementId ?? ''} and records the before and after terms in the audit log.`;
	}
}

function useUnsavedSalaryGuard(
	dirty: boolean,
	message: string,
	confirmedLeave: (href: string) => void
) {
	useEffect(() => {
		if (!dirty) return;

		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			event.returnValue = message;
			return message;
		};

		// App leave controls live outside this component (Navbar, Sidebar and
		// ordinary Links). A capture-phase click listener covers them without
		// editing those owners' files. Browser reload/close/address-bar
		// navigation is covered by beforeunload; the SPA Back gesture is covered
		// by the unsaved-navigation guard's sentinel.
		const handleDocumentClick = (event: MouseEvent) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Element)) return;
			const anchor = target.closest('a[href]');
			if (!(anchor instanceof HTMLAnchorElement)) return;
			if (anchor.target && anchor.target !== '_self') return;
			if (anchor.hasAttribute('download')) return;
			const url = new URL(anchor.href, window.location.href);
			if (url.origin !== window.location.origin) return;
			if (
				url.pathname === window.location.pathname &&
				url.search === window.location.search
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			if (window.confirm(message)) {
				confirmedLeave(`${url.pathname}${url.search}${url.hash}`);
			}
		};

		window.addEventListener('beforeunload', handleBeforeUnload);
		document.addEventListener('click', handleDocumentClick, true);
		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			document.removeEventListener('click', handleDocumentClick, true);
		};
	}, [dirty, message, confirmedLeave]);
}

export interface SalaryProfileEditorProps {
	employeeId: number;
	initialDate?: string;
}

/**
 * Full-page Salary Profile editor (#444).
 *
 * The draft is separate from Timestamp query data: a background timeline read
 * never resets edited values, and a failed save keeps every entered value. The
 * expected timeline version is captured when an edit starts, so a conflict is
 * reported instead of silently overwriting another operator's change.
 */
export function SalaryProfileEditor({
	employeeId,
	initialDate,
}: SalaryProfileEditorProps) {
	const validEmployeeId = Number.isInteger(employeeId) && employeeId > 0;
	const [asOf, setAsOf] = useState(initialDate || todayInput());
	const [basisMonth, setBasisMonth] = useState(
		monthStartOf(initialDate || todayInput())
	);
	const [viewedKey, setViewedKey] = useState<string | null>(null);
	const [editing, setEditing] = useState<EditingState | null>(null);
	const [draft, setDraft] = useState<SalaryDraft | null>(null);
	const [overrides, setOverrides] = useState<Record<string, string>>({});
	const [overrideMode, setOverrideMode] = useState(false);
	const [reviewing, setReviewing] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [submitError, setSubmitError] =
		useState<SalaryProfileRequestError | null>(null);
	const [status, setStatus] = useState('');
	const [cancelTarget, setCancelTarget] =
		useState<SalaryTimelineAgreementDto | null>(null);
	const [cancelReason, setCancelReason] = useState('');
	const [cancelValidation, setCancelValidation] = useState('');
	const [cancelError, setCancelError] = useState('');
	const formRef = useRef<HTMLDivElement>(null);
	const reviewRef = useRef<HTMLElement>(null);

	const timelineQuery = useSalaryProfileTimeline(
		employeeId,
		{ date: asOf, month: basisMonth },
		validEmployeeId && Boolean(asOf)
	);
	const timeline = timelineQuery.data?.data ?? null;
	const command = useSalaryCommand();

	const defaultKey = timeline ? defaultViewedKey(timeline) : null;
	const viewedAgreement = timeline
		? (findAgreement(timeline, viewedKey) ??
			findAgreement(timeline, defaultKey))
		: null;
	const viewDraft = useMemo(
		() =>
			timeline
				? viewedAgreement
					? draftFromAgreement(viewedAgreement)
					: createEmptyDraft(createStartFor(timeline))
				: null,
		[timeline, viewedAgreement]
	);
	const activeDraft = editing ? draft : viewDraft;
	const canUpdate = timeline?.permissions.can_update ?? false;
	const canCreate = Boolean(
		timeline && canUpdate && canCreateInitial(timeline)
	);
	const isDirty = Boolean(
		editing && draft && draftIsDirty(draft, editing.baseDraft)
	);
	const busy = command.isPending;
	const leaveGuard = useUnsavedNavigationGuard(
		isDirty,
		'/admin/payroll/salary-profiles'
	);
	const leaveStayRef = useRef<HTMLButtonElement>(null);
	const leaveReturnFocusRef = useRef<HTMLElement | null>(null);

	useUnsavedSalaryGuard(isDirty, UNSAVED_SALARY_MESSAGE, leaveGuard.leaveFor);

	useEffect(() => {
		if (reviewing) reviewRef.current?.focus();
	}, [reviewing]);

	useEffect(() => {
		if (leaveGuard.promptOpen) {
			leaveReturnFocusRef.current =
				document.activeElement instanceof HTMLElement
					? document.activeElement
					: null;
			leaveStayRef.current?.focus();
			return;
		}
		const previous = leaveReturnFocusRef.current;
		leaveReturnFocusRef.current = null;
		previous?.focus();
	}, [leaveGuard.promptOpen]);

	const previewProfile = useMemo(() => {
		if (editing && draft) return previewProfileFromDraft(draft);
		if (viewedAgreement) return previewProfileFromAgreement(viewedAgreement);
		return {};
	}, [editing, draft, viewedAgreement]);

	const scheduleDate =
		editing && draft
			? draft.effective_from
			: (viewedAgreement?.effective_from ?? timeline?.as_of ?? '');

	const updateDraft = useCallback((patch: Partial<SalaryDraft>) => {
		setDraft((previous) => {
			if (!previous) return previous;
			const next = { ...previous, ...patch };
			if ('loan_amount_per_month' in patch || 'loan_no_of_months' in patch) {
				const emi = next.loan_amount_per_month.trim();
				const months = next.loan_no_of_months.trim();
				next.loan_total_amount =
					/^\d+(\.\d{1,4})?$/.test(emi) && /^\d+$/.test(months)
						? String(toNumber(mul(emi, months)))
						: '';
			}
			return next;
		});
		setErrors((previous) => {
			if (Object.keys(previous).length === 0) return previous;
			const next = { ...previous };
			for (const key of Object.keys(patch)) delete next[key];
			return next;
		});
	}, []);

	const resetEditing = useCallback(() => {
		setEditing(null);
		setDraft(null);
		setOverrides({});
		setOverrideMode(false);
		setReviewing(false);
		setErrors({});
		setSubmitError(null);
	}, []);

	const attemptLeave = useCallback(
		(href: string) => {
			if (isDirty && !window.confirm(UNSAVED_SALARY_MESSAGE)) return;
			leaveGuard.leaveFor(href);
		},
		[isDirty, leaveGuard]
	);

	const begin = useCallback(
		(operation: SalaryOperation, agreement?: SalaryTimelineAgreementDto) => {
			if (!timeline) return;
			const base = agreement
				? draftFromAgreement(agreement)
				: createEmptyDraft(createStartFor(timeline));
			const startDate =
				operation === 'revise' && agreement
					? revisionStartFor(agreement, timeline.server_date)
					: base.effective_from;
			setEditing({
				operation,
				agreementId: agreement?.agreement_id ?? null,
				expectedVersion: timeline.timeline_version,
				baseDraft: base,
			});
			setDraft({ ...base, effective_from: startDate });
			setOverrides({ ...base.overrides });
			setOverrideMode(hasDraftOverrides(base.overrides));
			setReviewing(false);
			setErrors({});
			setSubmitError(null);
			setStatus('');
			setCancelTarget(null);
			setCancelError('');
			setCancelValidation('');
			if (agreement) setViewedKey(agreementKey(agreement));
		},
		[timeline]
	);

	const requestBegin = useCallback(
		(operation: SalaryOperation, agreement?: SalaryTimelineAgreementDto) => {
			if (editing && isDirty && !window.confirm(UNSAVED_SALARY_MESSAGE)) {
				return;
			}
			begin(operation, agreement);
		},
		[begin, editing, isDirty]
	);

	const requestView = useCallback(
		(agreement: SalaryTimelineAgreementDto) => {
			if (editing) {
				if (isDirty && !window.confirm(UNSAVED_SALARY_MESSAGE)) return;
				resetEditing();
			}
			setViewedKey(agreementKey(agreement));
		},
		[editing, isDirty, resetEditing]
	);

	const requestCancel = useCallback(
		(agreement: SalaryTimelineAgreementDto) => {
			if (editing) {
				if (isDirty && !window.confirm(UNSAVED_SALARY_MESSAGE)) return;
				resetEditing();
			}
			setCancelTarget(agreement);
			setCancelReason('');
			setCancelValidation('');
			setCancelError('');
			setStatus('');
		},
		[editing, isDirty, resetEditing]
	);

	const requestReview = useCallback(() => {
		if (!editing || !draft) return;
		const validation = validateSalaryDraft(draft, editing.operation);
		setErrors(validation.errors);
		setSubmitError(null);
		if (!validation.ok) {
			setReviewing(false);
			window.setTimeout(() => {
				formRef.current
					?.querySelector<HTMLElement>('[aria-invalid="true"]')
					?.focus();
			}, 0);
			return;
		}
		setReviewing(true);
	}, [draft, editing]);

	const successMessage = useCallback((operation: SalaryOperation) => {
		switch (operation) {
			case 'create-initial':
				return 'Salary Profile created. The first dated agreement now covers the selected period.';
			case 'revise':
				return 'Salary revision saved. The previous agreement is retained and remains readable.';
			default:
				return 'Agreement corrected. The same agreement identity now holds the corrected terms.';
		}
	}, []);

	const save = useCallback(async () => {
		if (!editing || !draft || command.isPending) return;
		const validation = validateSalaryDraft(draft, editing.operation);
		if (!validation.ok) {
			setErrors(validation.errors);
			setReviewing(false);
			return;
		}
		setErrors({});
		setSubmitError(null);
		setStatus('');
		const input = buildSalaryCommandInput({
			operation: editing.operation,
			employeeId,
			agreementId: editing.agreementId,
			expectedVersion: editing.expectedVersion,
			draft,
			baseDraft: editing.baseDraft,
		});
		try {
			const result = await command.mutateAsync(input);
			setStatus(successMessage(input.operation));
			setViewedKey(`employee_salary_profile:${result.agreement_id}`);
			resetEditing();
		} catch (error) {
			setSubmitError(
				error instanceof SalaryProfileRequestError
					? error
					: new SalaryProfileRequestError(
							error instanceof Error ? error.message : 'Salary save failed',
							0,
							null,
							null
						)
			);
		}
	}, [command, draft, editing, employeeId, resetEditing, successMessage]);

	const reloadLatest = useCallback(async () => {
		const result = await timelineQuery.refetch();
		const fresh = result.data?.data;
		if (!fresh || !editing) return;
		const latest =
			editing.agreementId !== null
				? (fresh.agreements.find(
						(agreement) =>
							agreement.agreement_source === 'employee_salary_profile' &&
							agreement.agreement_id === editing.agreementId
					) ?? null)
				: null;
		const latestDraft = latest ? draftFromAgreement(latest) : null;
		setEditing((previous) =>
			previous
				? {
						...previous,
						expectedVersion: fresh.timeline_version,
						baseDraft: latestDraft ?? previous.baseDraft,
					}
				: previous
		);
		setSubmitError(null);
		setStatus(
			'Latest terms loaded. Your entries are kept; review the changes before saving.'
		);
	}, [editing, timelineQuery]);

	const confirmCancellation = useCallback(async () => {
		if (!cancelTarget || !timeline || command.isPending) return;
		if (cancelReason.trim() === '') {
			setCancelValidation('Enter a cancellation reason');
			return;
		}
		setCancelValidation('');
		setCancelError('');
		try {
			const result = await command.mutateAsync(
				buildCancelCommandInput({
					employeeId,
					agreementId: cancelTarget.agreement_id,
					expectedVersion: timeline.timeline_version,
					reason: cancelReason,
				})
			);
			setStatus(
				`Scheduled agreement #${result.agreement_id} cancelled. The predecessor coverage is restored and the cancelled row is retained.`
			);
			setCancelTarget(null);
			setCancelReason('');
			setViewedKey(null);
			await timelineQuery.refetch();
		} catch (error) {
			setCancelError(
				error instanceof Error ? error.message : 'Cancellation failed'
			);
		}
	}, [
		cancelReason,
		cancelTarget,
		command,
		employeeId,
		timeline,
		timelineQuery,
	]);

	if (!validEmployeeId) {
		return (
			<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
				<section
					role="alert"
					className="max-w-xl rounded-xl border border-red-200 bg-white p-6"
				>
					<h1 className="text-lg font-semibold text-gray-900">
						This salary profile link is invalid
					</h1>
					<p className="mt-2 text-sm text-gray-600">
						The Employee identifier in the address is not a valid Employee id.
					</p>
					<Link
						href="/admin/payroll/salary-profiles"
						className="mt-4 inline-block text-sm font-medium text-[#64126D] underline"
					>
						Back to Salary Profiles
					</Link>
				</section>
			</div>
		);
	}

	if (!asOf) {
		return (
			<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
				<section className="max-w-xl rounded-xl border border-gray-200 bg-white p-6">
					<h1 className="text-lg font-semibold text-gray-900">
						Choose an as-of date
					</h1>
					<p className="mt-2 text-sm text-gray-600">
						Salary agreements are resolved for a date. Select the date whose
						covering terms you want to review or change.
					</p>
					<input
						type="date"
						aria-label="Agreements as of"
						value={asOf}
						onChange={(event) => {
							setAsOf(event.target.value);
							const month = monthStartOf(event.target.value);
							if (month) setBasisMonth(month);
						}}
						className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D]"
					/>
				</section>
			</div>
		);
	}

	if (timelineQuery.isPending) {
		return (
			<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
				<p role="status" className="text-sm text-gray-600">
					Loading salary profile…
				</p>
			</div>
		);
	}

	if (timelineQuery.isError || !timeline) {
		return (
			<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
				<section
					role="alert"
					className="max-w-xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
				>
					<div className="flex items-start gap-2">
						<ExclamationCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0" />
						<div>
							<p>Unable to load this salary profile.</p>
							{timelineQuery.isError && (
								<p className="mt-1">{timelineQuery.error?.message}</p>
							)}
						</div>
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => void timelineQuery.refetch()}
							className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700"
						>
							<ArrowPathIcon className="h-4 w-4" />
							Retry
						</button>
						<Link
							href="/admin/payroll/salary-profiles"
							className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700"
						>
							Back to Salary Profiles
						</Link>
					</div>
				</section>
			</div>
		);
	}

	const employee = timeline.employee;
	const basis = timeline.basis;
	const leave = timeline.leave_usage;
	const reviewLabel =
		editing?.operation === 'create-initial'
			? 'Review new salary agreement'
			: editing?.operation === 'revise'
				? 'Review salary revision'
				: 'Review salary correction';
	const rows = editing && draft ? reviewRows(editing.baseDraft, draft) : [];
	const hasChanges =
		!editing || editing.operation !== 'correct' || isDirty || rows.length > 0;

	const referenceRows: Array<{ label: string; value: string }> = [];
	if (viewedAgreement) {
		const amounts = viewedAgreement.legacy_amounts;
		const settings = viewedAgreement.settings;
		if (amounts.gross_salary !== null) {
			referenceRows.push({
				label: 'Recorded gross salary',
				value: formatCurrency(amounts.gross_salary),
			});
		}
		if (amounts.gross !== null) {
			referenceRows.push({
				label: 'Recorded gross',
				value: formatCurrency(amounts.gross),
			});
		}
		if (amounts.contract_amount !== null) {
			referenceRows.push({
				label: 'Recorded Contract amount',
				value: formatCurrency(amounts.contract_amount),
			});
		}
		if (amounts.contract_duration) {
			referenceRows.push({
				label: 'Recorded Contract duration',
				value: durationLabel(amounts.contract_duration),
			});
		}
		if (amounts.contract_end_date) {
			referenceRows.push({
				label: 'Recorded Contract end date',
				value: displayDate(amounts.contract_end_date),
			});
		}
		for (const [key, label] of [
			['hourly_rate', 'Stored hourly rate (reference only)'],
			['daily_rate', 'Stored daily rate (reference only)'],
			['basic_plus_da', 'Stored Basic + DA (legacy combined)'],
			['lumpsum_amount', 'Stored Lumpsum amount (reference only)'],
		] as const) {
			if (settings[key] !== undefined && settings[key] !== null) {
				referenceRows.push({
					label,
					value: formatCurrency(settings[key]),
				});
			}
		}
		if (
			typeof settings.lumpsum_description === 'string' &&
			settings.lumpsum_description
		) {
			referenceRows.push({
				label: 'Stored Lumpsum description',
				value: settings.lumpsum_description,
			});
		}
	}

	return (
		<div className="w-full px-4 py-6 sm:px-6 lg:px-8">
			<button
				type="button"
				onClick={() => attemptLeave('/admin/payroll/salary-profiles')}
				className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#64126D] hover:underline"
			>
				<span aria-hidden="true">←</span> Back to Salary Profiles
			</button>

			<header className="mb-5">
				<div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
					<div>
						<h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
							<UserCircleIcon className="h-7 w-7 text-[#64126D]" />
							{employee.full_name}
						</h1>
						<p className="mt-1 text-sm text-gray-600">
							{employee.employee_code}
							{employee.department ? ` · ${employee.department}` : ''}
							{employee.position ? ` · ${employee.position}` : ''}
						</p>
						<p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
							<span>
								Employee Type (directory category):{' '}
								<span>{employee.employee_type || 'Not set'}</span>
							</span>
							<span>
								Status: <span>{statusLabel(employee.status)}</span>
							</span>
							<span>
								Employment start:{' '}
								{displayDate(
									employee.employment_start ??
										employee.joining_date ??
										employee.hire_date
								)}
							</span>
						</p>
						<p className="mt-1 text-xs text-gray-500">
							Salary Type decides the pay stream. Employee Type never selects
							Payroll or Contract.
						</p>
					</div>

					<div className="flex flex-col gap-3 sm:flex-row xl:items-end">
						<div>
							<label
								htmlFor="salary-timeline-date"
								className="mb-1 block text-sm font-medium text-gray-700"
							>
								Agreements as of
							</label>
							<input
								id="salary-timeline-date"
								type="date"
								required
								value={asOf}
								onChange={(event) => {
									const value = event.target.value;
									setAsOf(value);
									const month = monthStartOf(value);
									if (month) setBasisMonth(month);
								}}
								className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D]"
							/>
						</div>
						<div>
							<label
								htmlFor="salary-basis-month"
								className="mb-1 block text-sm font-medium text-gray-700"
							>
								Basis and leave month
							</label>
							<input
								id="salary-basis-month"
								type="month"
								required
								value={basisMonth.slice(0, 7)}
								onChange={(event) => {
									const value = event.target.value;
									setBasisMonth(value ? `${value}-01` : '');
								}}
								className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D]"
							/>
						</div>
					</div>
				</div>

				{timelineQuery.isFetching && (
					<p role="status" className="mt-2 text-xs text-gray-500">
						Refreshing latest terms…
					</p>
				)}
				{!canUpdate && (
					<p className="mt-2 text-sm text-gray-600">
						Your role can read salary profiles but cannot change them.
					</p>
				)}
				{timeline.use.unknown_history && (
					<p
						role="alert"
						className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
					>
						Known prior payroll use has no provable month or agreement. Timeline
						writes are blocked until that history is reviewed; recorded terms
						are shown read-only.
					</p>
				)}
				{timeline.use.ambiguous && !timeline.use.unknown_history && (
					<p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
						Some prior payroll use is ambiguous. Writes that would change the
						protected month are rejected; review the agreement history below.
					</p>
				)}
			</header>

			{status && (
				<p
					role="status"
					className="mb-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-800"
				>
					{status}
				</p>
			)}

			{leaveGuard.promptOpen && (
				<section
					role="dialog"
					aria-labelledby="salary-leave-heading"
					aria-describedby="salary-leave-description"
					onKeyDown={(event) => {
						if (event.key === 'Escape') {
							event.preventDefault();
							leaveGuard.stay();
						}
					}}
					className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4"
				>
					<h2
						id="salary-leave-heading"
						className="text-lg font-semibold text-gray-900"
					>
						Unsaved salary changes
					</h2>
					<p
						id="salary-leave-description"
						className="mt-1 text-sm text-gray-700"
					>
						The browser Back button would discard this draft. Stay to keep
						editing, or discard the draft and return to the previous page.
					</p>
					<div className="mt-3 flex flex-wrap gap-2">
						<button
							ref={leaveStayRef}
							type="button"
							onClick={leaveGuard.stay}
							className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a]"
						>
							Stay
						</button>
						<button
							type="button"
							onClick={leaveGuard.discard}
							className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
						>
							Discard
						</button>
					</div>
				</section>
			)}

			{cancelTarget && (
				<section
					aria-labelledby="salary-cancel-heading"
					className="mb-4 rounded-xl border border-red-200 bg-white p-4"
				>
					<h2
						id="salary-cancel-heading"
						className="text-lg font-semibold text-gray-900"
					>
						Cancel scheduled agreement
					</h2>
					<p className="mt-1 text-sm text-gray-600">
						This retains the scheduled agreement as Cancelled, records the
						reason in the audit log, and reconnects the predecessor&apos;s
						coverage. It is not a hard delete.
					</p>
					<div className="mt-3 max-w-xl">
						<label
							htmlFor="salary-cancel-reason"
							className="mb-1 block text-sm font-medium text-gray-700"
						>
							Cancellation reason
						</label>
						<textarea
							id="salary-cancel-reason"
							rows={3}
							maxLength={255}
							value={cancelReason}
							onChange={(event) => setCancelReason(event.target.value)}
							aria-invalid={Boolean(cancelValidation)}
							aria-describedby={
								cancelValidation ? 'salary-cancel-error' : undefined
							}
							className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#64126D] focus:outline-none focus:ring-2 focus:ring-[#64126D]"
						/>
						{cancelValidation && (
							<p
								id="salary-cancel-error"
								className="mt-1 text-xs font-medium text-red-700"
							>
								{cancelValidation}
							</p>
						)}
						{cancelError && (
							<p role="alert" className="mt-1 text-xs text-red-800">
								{cancelError}
							</p>
						)}
					</div>
					<div className="mt-3 flex flex-wrap gap-2">
						<button
							type="button"
							disabled={busy}
							onClick={() => void confirmCancellation()}
							className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
						>
							{busy ? 'Cancelling…' : 'Confirm cancellation'}
						</button>
						<button
							type="button"
							onClick={() => {
								setCancelTarget(null);
								setCancelReason('');
								setCancelValidation('');
								setCancelError('');
							}}
							className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
						>
							Keep agreement
						</button>
					</div>
				</section>
			)}

			<div className="mb-4 flex flex-wrap items-center gap-2">
				{canCreate && (
					<button
						type="button"
						disabled={busy}
						onClick={() => requestBegin('create-initial')}
						className="rounded-lg bg-[#64126D] px-3 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
					>
						Create Salary Profile
					</button>
				)}
				{canCreate &&
					timeline.agreements.some(
						(agreement) => agreement.agreement_source === 'salary_structures'
					) && (
						<p className="text-xs text-amber-800">
							Legacy terms stay read-only. A new Salary Profile starts at the
							selected monthly boundary; earlier periods keep the recorded
							legacy terms. The joining-date exception does not apply once
							legacy or payroll history exists.
						</p>
					)}
				{viewedAgreement && (
					<p className="text-xs text-gray-500">
						Viewing{' '}
						{formatPeriod(
							viewedAgreement.effective_from,
							viewedAgreement.effective_to
						)}{' '}
						· {salaryTypeLabel(viewedAgreement.salary_type)} · agreement #
						{viewedAgreement.agreement_id}
					</p>
				)}
			</div>

			<div className="space-y-4">
				<SalaryProfileHistory
					timeline={timeline}
					selectedKey={viewedAgreement ? agreementKey(viewedAgreement) : null}
					busy={busy}
					onView={requestView}
					onCorrect={(agreement) => requestBegin('correct', agreement)}
					onRevise={(agreement) => requestBegin('revise', agreement)}
					onCancel={requestCancel}
				/>

				{timeline.agreements.length === 0 && (
					<section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
						<h2 className="text-lg font-semibold text-gray-900">
							No salary agreement
						</h2>
						<p className="mt-1 text-sm text-gray-700">
							No agreement covers {displayDate(timeline.as_of)}. Payroll cannot
							price this month until a Salary Profile exists. A first agreement
							may start on the verified joining date.
						</p>
					</section>
				)}
			</div>

			<div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
				<div ref={formRef} className="min-w-0">
					<section
						aria-labelledby="salary-terms-heading"
						className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
					>
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<h2
								id="salary-terms-heading"
								className="text-lg font-semibold text-gray-900"
							>
								Agreement terms
							</h2>
							<p className="text-xs text-gray-500">
								{editing
									? `Editing: ${OPERATION_LABELS[editing.operation]}`
									: 'Read-only. Use Edit agreement or New Salary Revision to change these terms.'}
							</p>
						</div>

						{activeDraft && (
							<SalaryProfileFields
								draft={activeDraft}
								errors={editing ? errors : {}}
								disabled={!editing}
								effectiveKind={
									editing?.operation === 'revise' ? 'month' : 'date'
								}
								effectiveLabel={
									editing?.operation === 'revise'
										? 'Revisions start month'
										: 'Effective from'
								}
								onChange={updateDraft}
							/>
						)}

						{submitError && (
							<div
								role="alert"
								className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
							>
								<p className="font-semibold">
									{submitError.code === 'stale_version'
										? 'This salary timeline changed since you opened it.'
										: submitError.code === 'used' ||
											  submitError.code === 'protected'
											? 'Payroll use protects these terms.'
											: submitError.code === 'ambiguous_history'
												? 'Prior payroll use is ambiguous.'
												: 'The salary change was not saved.'}
								</p>
								<p className="mt-1">{submitError.message}</p>
								{submitError.details?.actual_version !== undefined && (
									<p className="mt-1 text-xs">
										Expected version{' '}
										{String(submitError.details?.expected_version ?? '')},
										latest version {String(submitError.details?.actual_version)}
										.
									</p>
								)}
								<p className="mt-1 text-xs">
									Your entered values are kept. Nothing was overwritten.
								</p>
								<button
									type="button"
									onClick={() => void reloadLatest()}
									className="mt-2 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
								>
									<ArrowPathIcon className="h-4 w-4" />
									Reload latest terms
								</button>
							</div>
						)}

						{editing && (
							<div className="mt-4 border-t border-gray-200 pt-4">
								{reviewing ? (
									<section
										ref={reviewRef}
										tabIndex={-1}
										role="region"
										aria-label={reviewLabel}
										className="rounded-xl border border-purple-200 bg-purple-50/50 p-4 focus:outline-none focus:ring-2 focus:ring-[#64126D]"
									>
										<h3 className="text-base font-semibold text-gray-900">
											{reviewLabel}
										</h3>
										<p className="mt-1 text-sm text-gray-700">
											{operationCopy(editing.operation, editing.agreementId)}
										</p>
										{editing.operation === 'revise' && activeDraft && (
											<p className="mt-1 text-sm font-medium text-purple-900">
												The previous agreement ends the day before{' '}
												{displayMonth(activeDraft.effective_from)} and the new
												terms start on{' '}
												{displayMonth(activeDraft.effective_from)}.
											</p>
										)}
										{rows.length === 0 ? (
											<p className="mt-2 text-sm text-gray-600">
												No terms changed. Update a value before saving.
											</p>
										) : (
											<dl className="mt-3 space-y-2">
												{rows.map((row) => (
													<div
														key={row.label}
														className="grid grid-cols-1 gap-1 border-b border-purple-100 pb-2 sm:grid-cols-3"
													>
														<dt className="text-sm font-medium text-gray-700">
															{row.label}
														</dt>
														<dd className="text-sm text-gray-600">
															<span className="font-semibold text-gray-500">
																Before:
															</span>{' '}
															{row.before}
														</dd>
														<dd className="text-sm text-gray-900">
															<span className="font-semibold text-gray-500">
																After:
															</span>{' '}
															{row.after}
														</dd>
													</div>
												))}
											</dl>
										)}
										<div className="mt-4 flex flex-wrap gap-2">
											<button
												type="button"
												disabled={busy || !hasChanges}
												onClick={() => void save()}
												className="rounded-lg bg-[#64126D] px-4 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
											>
												{busy
													? 'Saving…'
													: editing.operation === 'create-initial'
														? 'Save new agreement'
														: editing.operation === 'revise'
															? 'Save revision'
															: 'Save correction'}
											</button>
											<button
												type="button"
												disabled={busy}
												onClick={() => {
													setReviewing(false);
													setSubmitError(null);
												}}
												className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
											>
												Back to terms
											</button>
										</div>
									</section>
								) : (
									<div className="flex flex-wrap items-center justify-end gap-2">
										<button
											type="button"
											disabled={busy}
											onClick={() => {
												if (!isDirty) {
													resetEditing();
													return;
												}
												if (window.confirm(UNSAVED_SALARY_MESSAGE)) {
													resetEditing();
												}
											}}
											className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
										>
											Discard changes
										</button>
										<button
											type="button"
											disabled={busy}
											onClick={requestReview}
											className="rounded-lg bg-[#64126D] px-4 py-2 text-sm font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
										>
											{editing.operation === 'create-initial'
												? 'Review new agreement'
												: editing.operation === 'revise'
													? 'Review revision'
													: 'Review correction'}
										</button>
									</div>
								)}
							</div>
						)}
					</section>
				</div>

				<aside className="min-w-0 space-y-4">
					<SalaryProfileEstimate
						employeeId={employeeId}
						month={basis.month}
						basis={basis}
						stdHoursPerDay={activeDraft?.std_hours_per_day ?? ''}
						scheduleDate={scheduleDate}
						profile={previewProfile}
						editing={Boolean(editing)}
						canOverride={canUpdate && Boolean(editing)}
						overrideMode={overrideMode}
						overrides={
							overrideMode ? overrides : (activeDraft?.overrides ?? {})
						}
						onOverrideModeChange={(next) => {
							setOverrideMode(next);
							if (!next) setOverrides({});
						}}
						onOverrideChange={(key, value) =>
							setOverrides((previous) => ({ ...previous, [key]: value }))
						}
						onOverrideReset={(key) =>
							setOverrides((previous) => {
								const next = { ...previous };
								delete next[key];
								return next;
							})
						}
						onResetOverrides={() => setOverrides({})}
						onApplicabilityChange={(key: ApplicabilityKey, value: boolean) =>
							updateDraft({ [key]: value } as Partial<SalaryDraft>)
						}
					/>

					<section
						aria-labelledby="salary-leave-heading"
						className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
					>
						<h2
							id="salary-leave-heading"
							className="text-base font-semibold text-gray-900"
						>
							Leave usage (read-only)
						</h2>
						<dl className="mt-2 space-y-1 text-sm">
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">PL entitlement stored</dt>
								<dd className="font-medium text-gray-900">
									{leave.pl_total === null ? 'Not recorded' : leave.pl_total}
								</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">PL used this year</dt>
								<dd className="font-medium text-gray-900">{leave.used}</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">
									PL used in {displayMonth(leave.month)}
								</dt>
								<dd className="font-medium text-gray-900">
									{leave.month_used}
								</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">Balance</dt>
								<dd className="font-medium text-gray-900">
									{leave.balance === null ? 'Not recorded' : leave.balance}
								</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">Months recorded</dt>
								<dd className="font-medium text-gray-900">
									{leave.months_recorded}
								</dd>
							</div>
						</dl>
						<p className="mt-2 text-xs text-gray-500">
							Source: attendance summary. Read-only — saving salary terms never
							writes today&apos;s calculated usage into a dated agreement.
						</p>
					</section>

					<section
						aria-labelledby="salary-basis-heading"
						className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
					>
						<h2
							id="salary-basis-heading"
							className="text-base font-semibold text-gray-900"
						>
							Basis month
						</h2>
						<dl className="mt-2 space-y-1 text-sm">
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">Month</dt>
								<dd className="font-medium text-gray-900">
									{displayMonth(basis.month)}
								</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">Working days</dt>
								<dd className="font-medium text-gray-900">
									{basis.working_days}
								</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">Agreement standard hours</dt>
								<dd className="font-medium text-gray-900">
									{basis.std_hours_per_day ?? 'Not recorded'}
								</dd>
							</div>
							<div className="flex justify-between gap-3">
								<dt className="text-gray-600">Basis Hours</dt>
								<dd className="font-medium text-gray-900">
									{basis.basis_hours ?? '—'}
								</dd>
							</div>
						</dl>
						<p className="mt-2 text-xs text-gray-500">
							{basis.std_hours_source === 'agreement'
								? 'Standard hours come from the selected agreement.'
								: 'No usable standard daily hours are recorded on the selected agreement.'}
						</p>
					</section>

					<section
						aria-labelledby="salary-references-heading"
						className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
					>
						<h2
							id="salary-references-heading"
							className="text-base font-semibold text-gray-900"
						>
							Recorded references
						</h2>
						<p className="mt-1 text-xs text-gray-500">
							These stored amounts are references only, not operative payroll
							rates. Payroll prices the agreement from the monthly CTC ÷ Basis
							Hours × Logged Hours.
						</p>
						{referenceRows.length ? (
							<dl className="mt-2 space-y-1 text-sm">
								{referenceRows.map((row) => (
									<div key={row.label} className="flex justify-between gap-3">
										<dt className="text-gray-600">{row.label}</dt>
										<dd className="font-medium text-gray-900">{row.value}</dd>
									</div>
								))}
							</dl>
						) : (
							<p className="mt-2 text-sm text-gray-600">
								No legacy amounts are stored on this agreement.
							</p>
						)}
					</section>
				</aside>
			</div>
		</div>
	);
}
