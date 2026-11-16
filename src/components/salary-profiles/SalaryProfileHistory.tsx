'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatCurrency } from '@/lib/format';
import type {
	SalaryTimelineAgreementDto,
	SalaryTimelineDto,
} from '@/lib/salary-profile-commands';
import {
	agreementKey,
	blockerExplanations,
	displayDate,
	formatPeriod,
	salaryTypeLabel,
} from '@/components/salary-profiles/salary-profile-form';

const GROUPS = [
	{ key: 'current', heading: 'Current' },
	{ key: 'scheduled', heading: 'Scheduled' },
	{ key: 'previous', heading: 'Previous' },
	{ key: 'cancelled', heading: 'Cancelled' },
] as const;

const TONES: Record<string, string> = {
	current: 'bg-purple-100 text-purple-800',
	scheduled: 'bg-blue-100 text-blue-800',
	previous: 'bg-gray-100 text-gray-700',
	cancelled: 'bg-amber-100 text-amber-800',
};

function Badge({
	children,
	tone = 'bg-gray-100 text-gray-700',
}: {
	children: ReactNode;
	tone?: string;
}) {
	return (
		<span
			className={cn(
				'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
				tone
			)}
		>
			{children}
		</span>
	);
}

function CtcValue({ agreement }: { agreement: SalaryTimelineAgreementDto }) {
	const { ctc } = agreement;
	if (ctc.status !== 'resolved' || ctc.amount === null) {
		return (
			<span className="text-sm text-gray-500">
				{ctc.status === 'invalid' ? 'Invalid CTC' : 'CTC not recorded'}
			</span>
		);
	}
	return (
		<span className="text-sm text-gray-900">
			<span className="font-semibold">{formatCurrency(ctc.amount)}</span>{' '}
			<span className="text-xs text-gray-500">monthly CTC</span>
			{ctc.legacy_fallback && (
				<span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
					legacy {ctc.source === 'gross' ? 'gross' : 'gross salary'}
				</span>
			)}
		</span>
	);
}

export interface SalaryProfileHistoryProps {
	timeline: SalaryTimelineDto;
	selectedKey: string | null;
	busy: boolean;
	onView: (agreement: SalaryTimelineAgreementDto) => void;
	onCorrect: (agreement: SalaryTimelineAgreementDto) => void;
	onRevise: (agreement: SalaryTimelineAgreementDto) => void;
	onCancel: (agreement: SalaryTimelineAgreementDto) => void;
}

/**
 * Current / Scheduled / Previous / Cancelled agreement history. Action
 * availability comes from the server's already-filtered `actions`, and the
 * component additionally refuses to render a write control the session
 * cannot use.
 */
export function SalaryProfileHistory({
	timeline,
	selectedKey,
	busy,
	onView,
	onCorrect,
	onRevise,
	onCancel,
}: SalaryProfileHistoryProps) {
	const canUpdate = timeline.permissions.can_update;
	const canDelete = timeline.permissions.can_delete;

	return (
		<section
			aria-labelledby="salary-history-heading"
			className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
		>
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<h2
					id="salary-history-heading"
					className="text-lg font-semibold text-gray-900"
				>
					Salary history
				</h2>
				<p className="text-xs text-gray-500">
					Agreement status as of {displayDate(timeline.as_of)}. Effective ranges
					are maintained automatically; operators never edit end dates.
				</p>
			</div>

			{timeline.agreements.length === 0 ? (
				<p className="text-sm text-gray-600">
					No agreements recorded for this Employee.
				</p>
			) : (
				<div className="space-y-5">
					{GROUPS.map((group) => {
						const items = timeline.agreements.filter(
							(agreement) => agreement.classification === group.key
						);
						if (items.length === 0) return null;
						return (
							<div key={group.key}>
								<h3 className="mb-2 text-sm font-semibold text-gray-800">
									{group.heading}
								</h3>
								<ul className="space-y-3">
									{items.map((agreement) => {
										const selected = selectedKey === agreementKey(agreement);
										const blockers = blockerExplanations(
											agreement.action_blockers
										);
										const canCorrect =
											canUpdate && agreement.actions.includes('correct');
										const canRevise =
											canUpdate && agreement.actions.includes('revise');
										const canCancel =
											canDelete && agreement.actions.includes('cancel');
										return (
											<li
												key={agreementKey(agreement)}
												className={cn(
													'rounded-xl border p-4',
													selected
														? 'border-[#64126D] ring-2 ring-purple-100'
														: 'border-gray-200'
												)}
											>
												<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
													<div className="min-w-0 space-y-1.5">
														<div className="flex flex-wrap items-center gap-2">
															<h4 className="text-sm font-semibold text-gray-900">
																{salaryTypeLabel(agreement.salary_type)}{' '}
																agreement
															</h4>
															<Badge
																tone={
																	TONES[agreement.classification] ??
																	'bg-gray-100 text-gray-700'
																}
															>
																{group.heading}
															</Badge>
															<Badge
																tone={
																	agreement.pay_stream === 'contract'
																		? 'bg-indigo-100 text-indigo-800'
																		: 'bg-purple-100 text-purple-800'
																}
															>
																{agreement.pay_stream === 'contract'
																	? 'Contract'
																	: 'Payroll'}
															</Badge>
															<Badge
																tone={
																	agreement.agreement_source ===
																	'salary_structures'
																		? 'bg-amber-100 text-amber-800'
																		: 'bg-gray-100 text-gray-700'
																}
															>
																{agreement.agreement_source ===
																'salary_structures'
																	? 'Legacy structure'
																	: `Agreement #${agreement.agreement_id}`}
															</Badge>
															{agreement.used && (
																<Badge tone="bg-emerald-100 text-emerald-800">
																	Used by payroll
																</Badge>
															)}
															{agreement.read_only && (
																<Badge tone="bg-gray-100 text-gray-700">
																	Read-only
																</Badge>
															)}
														</div>

														<p className="text-sm text-gray-700">
															{formatPeriod(
																agreement.effective_from,
																agreement.effective_to
															)}
														</p>
														<div className="flex flex-wrap items-center gap-3">
															<CtcValue agreement={agreement} />
															{agreement.use_months.length > 0 && (
																<span className="text-xs text-gray-600">
																	Used months:{' '}
																	{agreement.use_months
																		.map((month) => displayDate(month))
																		.join(', ')}
																</span>
															)}
														</div>

														{blockers.map((explanation) => (
															<p
																key={explanation}
																className="text-xs text-amber-800"
															>
																{explanation}
															</p>
														))}

														{agreement.cancelled_reason && (
															<p className="text-xs text-gray-600">
																Reason:{' '}
																<span>{agreement.cancelled_reason}</span>
															</p>
														)}
													</div>

													<div className="flex flex-wrap items-start gap-2">
														<button
															type="button"
															onClick={() => onView(agreement)}
															className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
														>
															View terms
														</button>
														{canCorrect && (
															<button
																type="button"
																disabled={busy}
																onClick={() => onCorrect(agreement)}
																className="rounded-lg border border-[#64126D] bg-white px-3 py-1.5 text-xs font-medium text-[#64126D] hover:bg-purple-50 disabled:opacity-50"
															>
																Edit agreement
															</button>
														)}
														{canRevise && (
															<button
																type="button"
																disabled={busy}
																onClick={() => onRevise(agreement)}
																className="rounded-lg bg-[#64126D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
															>
																New Salary Revision
															</button>
														)}
														{canCancel && (
															<button
																type="button"
																disabled={busy}
																onClick={() => onCancel(agreement)}
																className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
															>
																Cancel scheduled agreement
															</button>
														)}
													</div>
												</div>
											</li>
										);
									})}
								</ul>
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
