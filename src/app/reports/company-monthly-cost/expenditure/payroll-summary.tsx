'use client';

/**
 * The recorded employee cost block of the company expenditure report.
 *
 * Employee cost is the month's Payroll Slip allocation: what was recorded,
 * what was estimated, and what stayed unallocated. A reconstruction proposal
 * (#308) is shown as a proposal, never as recorded cost, with the evidence it
 * rests on and the limits it carries.
 */

import { Fragment } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { formatCurrencyIn, formatNumber } from '@/lib/format';
import { AllocationRevisionPanel } from './allocation-revisions';
import { PAYROLL_STATUS_LABELS, errorMessage } from './shared';
import type { PayrollEmployeeRow, ReconciliationPayload } from './types';

export interface PayrollSummaryProps {
	/** The month's reconciliation, as the company states it. */
	data: ReconciliationPayload;
	/** The employee-cost drilldown's employees. */
	payrollEmployees: PayrollEmployeeRow[];
	/** The employee-cost drilldown is still loading. */
	payrollLoading: boolean;
	/** The employee-cost drilldown failed. */
	payrollFailed: boolean;
	/** Why the employee-cost drilldown failed. */
	payrollError: Error | null;
	/** A reconstruction proposal is in flight. */
	proposeSubmitting: boolean;
	/** A reconstruction review is in flight. */
	reviewSubmitting: boolean;
	/** Propose a historical allocation reconstruction for a Payroll Slip. */
	onProposeReconstruction: (slipId: number) => void;
	/** Approve or reject a reconstruction proposal. */
	onReviewReconstruction: (input: {
		proposalUid: string;
		command: 'approve' | 'reject';
		expectedVersion: number;
		reason?: string;
	}) => void;
	/** The failure of the last reconstruction command, if any. */
	reconstructionError: Error | null;
	/** The Employee whose Project shares are expanded, if any. */
	expandedEmployee: number | null;
	/** Expand or collapse one Employee's Project shares. */
	onEmployeeExpand: (employeeId: number | null) => void;
	/** The review reason typed for the pending proposal. */
	reconstructionReason: string;
	/** Record the review reason typed for the pending proposal. */
	onReconstructionReasonChange: (reason: string) => void;
	/** May propose a historical allocation reconstruction. */
	canProposeReconstruction: boolean;
	/** May approve or reject a reconstruction proposal. */
	canReviewReconstruction: boolean;
	/** May revise a finalized Payroll Slip's Project cost allocation. */
	canRevise: boolean;
}

export function PayrollSummary({
	data,
	payrollEmployees,
	payrollLoading,
	payrollFailed,
	payrollError,
	proposeSubmitting,
	reviewSubmitting,
	onProposeReconstruction,
	onReviewReconstruction,
	reconstructionError,
	expandedEmployee,
	onEmployeeExpand,
	reconstructionReason,
	onReconstructionReasonChange,
	canProposeReconstruction,
	canReviewReconstruction,
	canRevise,
}: PayrollSummaryProps) {
	return (
		<>
			{/* Recorded employee cost (#307, ADR-0016) */}
			<div
				data-testid="payroll-summary"
				data-recorded-total={String(data.payroll.recorded_total)}
				data-estimated-total={String(data.payroll.estimated_total)}
				data-unallocated-total={String(data.payroll.unallocated_total)}
				className="mt-3 rounded-xl border border-gray-200 bg-white"
			>
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-3 py-2">
					<p className="text-xs font-semibold text-gray-700">
						Employee cost — recorded Payroll Slip allocation
					</p>
					<p className="text-[11px] text-gray-500">
						Recorded{' '}
						{formatCurrencyIn(
							data.payroll.recorded_total,
							data.payroll.currency
						)}{' '}
						· Estimated{' '}
						{formatCurrencyIn(
							data.payroll.estimated_total,
							data.payroll.currency
						)}{' '}
						· Unallocated{' '}
						{formatCurrencyIn(
							data.payroll.unallocated_total,
							data.payroll.currency
						)}{' '}
						(No project + No logged hours)
					</p>
				</div>
				<div className="grid gap-x-4 gap-y-1 px-3 py-2 text-[11px] text-gray-600 sm:grid-cols-4">
					<span>
						Logged Hours: {formatNumber(data.payroll.total_logged_hours)}
					</span>
					<span>Project Hours: {formatNumber(data.payroll.project_hours)}</span>
					<span>
						No project Hours: {formatNumber(data.payroll.no_project_hours)}
					</span>
					<span>
						Rounding adjustment:{' '}
						{formatCurrencyIn(
							data.payroll.rounding_adjustment,
							data.payroll.currency
						)}
					</span>
				</div>
				<div className="overflow-x-auto border-t border-gray-100">
					<table className="w-full min-w-[900px] text-sm">
						<thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
							<tr>
								<th scope="col" className="px-3 py-2">
									Employee
								</th>
								<th scope="col" className="px-3 py-2">
									Stream
								</th>
								<th scope="col" className="px-3 py-2">
									Status
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Logged Hours
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Recorded
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Estimated
								</th>
								<th scope="col" className="px-3 py-2">
									Source Payroll Slip
								</th>
							</tr>
						</thead>
						<tbody>
							{payrollLoading && (
								<tr>
									<td
										colSpan={7}
										className="px-3 py-4 text-center text-xs text-gray-500"
									>
										Loading employee cost…
									</td>
								</tr>
							)}
							{payrollFailed && (
								<tr>
									<td
										colSpan={7}
										className="px-3 py-4 text-center text-xs text-rose-600"
									>
										{errorMessage(payrollError)}
									</td>
								</tr>
							)}
							{!payrollLoading &&
								!payrollFailed &&
								payrollEmployees.length === 0 && (
									<tr>
										<td
											colSpan={7}
											className="px-3 py-4 text-center text-xs text-gray-500"
										>
											No employee cost for {data.month_label}.
										</td>
									</tr>
								)}
							{payrollEmployees.map((employee) => {
								const expanded = expandedEmployee === employee.employee_id;
								const reconstruction = employee.reconstruction;
								return (
									<Fragment key={employee.employee_id}>
										<tr
											data-testid="payroll-employee-row"
											data-employee-code={employee.employee_code}
											data-status={employee.status}
											data-recorded={employee.recorded_amount ?? ''}
											data-estimated={employee.estimated_amount ?? ''}
											data-hours={String(employee.logged_hours)}
											className="border-t border-gray-100"
										>
											<td className="px-3 py-2">
												<div className="flex items-center gap-1.5">
													<button
														type="button"
														data-testid="payroll-employee-expand"
														aria-expanded={expanded}
														onClick={() =>
															onEmployeeExpand(
																expanded ? null : employee.employee_id
															)
														}
														className="rounded p-0.5 text-gray-500 hover:bg-gray-100"
														aria-label={`${expanded ? 'Hide' : 'Show'} Project shares for ${employee.employee_code}`}
													>
														{expanded ? (
															<ChevronDownIcon className="h-4 w-4" />
														) : (
															<ChevronRightIcon className="h-4 w-4" />
														)}
													</button>
													<div>
														<div className="font-medium text-gray-900">
															{employee.employee_name}
														</div>
														<div className="text-[10px] text-gray-500">
															{employee.employee_code}
															{employee.no_logged_hours && ' · No logged hours'}
															{employee.missing_slip && ' · Missing slip'}
															{employee.missing_pricing && ' · Missing pricing'}
															{employee.allocation_missing &&
																' · Allocation missing'}
														</div>
													</div>
												</div>
												{/* #308: reconstruction state and its review controls. Pending
												    and rejected proposals are shown as proposals, never as
												    recorded cost; the controls render only under the same
												    read-gate + operation-privilege conjunction the routes
												    enforce. */}
												{(reconstruction ||
													(employee.allocation_missing &&
														canProposeReconstruction)) && (
													<div className="mt-1 flex flex-wrap items-center gap-1.5">
														{reconstruction && (
															<span
																data-testid={
																	reconstruction.status === 'approved'
																		? 'payroll-reconstruction-badge'
																		: reconstruction.status === 'pending'
																			? 'payroll-reconstruction-pending'
																			: 'payroll-reconstruction-rejected'
																}
																data-status={reconstruction.status}
																data-financial-version={String(
																	reconstruction.financial_version
																)}
																className={
																	reconstruction.status === 'approved'
																		? 'rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-900'
																		: reconstruction.status === 'pending'
																			? 'rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900'
																			: 'rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-900'
																}
															>
																{reconstruction.status === 'approved'
																	? 'Reconstructed'
																	: reconstruction.status === 'pending'
																		? `Reconstruction v${reconstruction.financial_version} · Awaiting review`
																		: `Reconstruction v${reconstruction.financial_version} · Rejected`}
															</span>
														)}
														{reconstruction?.status === 'pending' &&
															canReviewReconstruction && (
																<>
																	<input
																		data-testid="payroll-reconstruction-reason"
																		value={reconstructionReason}
																		onChange={(event) =>
																			onReconstructionReasonChange(
																				event.target.value
																			)
																		}
																		placeholder="Review reason (optional)"
																		className="w-44 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-700"
																	/>
																	<button
																		type="button"
																		data-testid="payroll-reconstruction-approve"
																		disabled={reviewSubmitting}
																		onClick={() =>
																			onReviewReconstruction({
																				proposalUid:
																					reconstruction.proposal_uid,
																				command: 'approve',
																				expectedVersion:
																					reconstruction.financial_version,
																				reason: reconstructionReason,
																			})
																		}
																		className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
																	>
																		Approve
																	</button>
																	<button
																		type="button"
																		data-testid="payroll-reconstruction-reject"
																		disabled={reviewSubmitting}
																		onClick={() =>
																			onReviewReconstruction({
																				proposalUid:
																					reconstruction.proposal_uid,
																				command: 'reject',
																				expectedVersion:
																					reconstruction.financial_version,
																				reason: reconstructionReason,
																			})
																		}
																		className="rounded border border-rose-300 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
																	>
																		Reject
																	</button>
																</>
															)}
														{!reconstruction &&
															employee.allocation_missing &&
															canProposeReconstruction && (
																<button
																	type="button"
																	data-testid="payroll-reconstruction-propose"
																	disabled={
																		proposeSubmitting ||
																		employee.source.payroll_slip_id === null
																	}
																	onClick={() => {
																		if (
																			employee.source.payroll_slip_id !== null
																		) {
																			onProposeReconstruction(
																				employee.source.payroll_slip_id
																			);
																		}
																	}}
																	className="rounded border border-[#64126D] px-1.5 py-0.5 text-[10px] font-medium text-[#64126D] hover:bg-[#64126D]/5 disabled:opacity-60"
																>
																	Propose reconstruction
																</button>
															)}
													</div>
												)}
												{reconstructionError && (
													<div className="mt-0.5 text-[10px] text-rose-600">
														{errorMessage(reconstructionError)}
													</div>
												)}
											</td>
											<td className="px-3 py-2 text-xs capitalize text-gray-600">
												{employee.pay_stream}
											</td>
											<td className="px-3 py-2 text-xs">
												<span
													className={
														employee.status === 'recorded'
															? 'rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900'
															: employee.status === 'estimated'
																? 'rounded bg-amber-100 px-1.5 py-0.5 text-amber-900'
																: 'rounded bg-gray-100 px-1.5 py-0.5 text-gray-700'
													}
												>
													{PAYROLL_STATUS_LABELS[employee.status] ??
														employee.status}
												</span>
											</td>
											<td className="px-3 py-2 text-right tabular-nums text-gray-700">
												{formatNumber(employee.logged_hours)}
											</td>
											<td className="px-3 py-2 text-right font-semibold text-gray-900">
												{employee.recorded_amount === null
													? '—'
													: formatCurrencyIn(
															employee.recorded_amount,
															data.payroll.currency
														)}
											</td>
											<td className="px-3 py-2 text-right text-gray-600">
												{employee.estimated_amount === null
													? '—'
													: formatCurrencyIn(
															employee.estimated_amount,
															data.payroll.currency
														)}
											</td>
											<td className="px-3 py-2 text-xs text-gray-600">
												{employee.source.payroll_slip_id === null
													? 'No Payroll Slip'
													: `Slip #${employee.source.payroll_slip_id}${
															employee.source.allocation_version
																? ` · allocation v${employee.source.allocation_version}`
																: ''
														}${
															employee.source.allocation_kind ===
															'reconstruction'
																? ' · reconstructed'
																: employee.source.allocation_kind === 'revision'
																	? ' · revised'
																	: ''
														}`}
											</td>
										</tr>
										{expanded && (
											<tr key={`${employee.employee_id}-shares`}>
												<td colSpan={7} className="bg-gray-50/70 px-3 py-2">
													<p className="mb-1 text-xs font-semibold text-gray-700">
														Project shares for {employee.employee_code}
													</p>
													<table className="w-full text-xs">
														<thead>
															<tr className="text-left text-gray-500">
																<th className="py-1 pr-3 font-medium">
																	Destination
																</th>
																<th className="py-1 pr-3 text-right font-medium">
																	Hours
																</th>
																<th className="py-1 pr-3 text-right font-medium">
																	Amount
																</th>
																<th className="py-1 pr-3 text-right font-medium">
																	Rounding
																</th>
																<th className="py-1 font-medium">Basis</th>
															</tr>
														</thead>
														<tbody>
															{employee.shares.map((share, index) => (
																<tr
																	key={`${share.project_id ?? share.basis}-${index}`}
																	data-testid="payroll-share-row"
																	data-project-code={share.project_code ?? ''}
																	data-hours={String(share.hours)}
																	data-amount={String(share.amount)}
																	data-adjustment={String(
																		share.rounding_adjustment
																	)}
																	data-basis={share.basis}
																>
																	<td className="py-1 pr-3 text-gray-800">
																		{share.project_id === null
																			? share.basis === 'no_project'
																				? 'No project'
																				: 'No logged hours'
																			: `${share.project_code} — ${share.project_name ?? ''}`}
																	</td>
																	<td className="py-1 pr-3 text-right tabular-nums">
																		{formatNumber(share.hours)}
																	</td>
																	<td className="py-1 pr-3 text-right tabular-nums font-medium">
																		{formatCurrencyIn(
																			share.amount,
																			data.payroll.currency
																		)}
																	</td>
																	<td className="py-1 pr-3 text-right tabular-nums text-gray-500">
																		{share.rounding_adjustment === 0
																			? '—'
																			: formatCurrencyIn(
																					share.rounding_adjustment,
																					data.payroll.currency
																				)}
																	</td>
																	<td className="py-1 text-gray-500">
																		{share.basis === 'project'
																			? 'Logged Hours'
																			: share.basis === 'no_project'
																				? 'Unallocated · No project'
																				: 'Unallocated · No logged hours'}
																	</td>
																</tr>
															))}
														</tbody>
													</table>
													{/* #308: reconstruction evidence, distinct from an original
													    finalization-time snapshot: what was reconstructed,
													    from which evidence, when, by whom, and what stays
													    limited. A pending proposal states its proposed shares
													    and never claims they are recorded cost. */}
													{reconstruction && (
														<div
															data-testid="payroll-reconstruction-evidence"
															data-status={reconstruction.status}
															data-financial-version={String(
																reconstruction.financial_version
															)}
															data-reconstructed-at={
																reconstruction.proposed_at ?? ''
															}
															data-proposed-by={
																reconstruction.proposed_by_name ?? ''
															}
															data-reviewed-at={
																reconstruction.reviewed_at ?? ''
															}
															data-reviewed-by={
																reconstruction.reviewed_by_name ?? ''
															}
															data-missing-evidence={reconstruction.missing_evidence
																.map((entry) => entry.code)
																.join(',')}
															className="mt-2 rounded border border-amber-200 bg-amber-50/60 px-2 py-1.5"
														>
															<p className="text-[11px] font-semibold text-amber-900">
																Reconstruction evidence — reconstructed, not the
																original finalization-time attribution
															</p>
															<p className="text-[11px] text-amber-900/80">
																Proposed {reconstruction.proposed_at ?? '—'} by{' '}
																{reconstruction.proposed_by_name ?? 'unknown'} ·{' '}
																{reconstruction.status === 'pending'
																	? 'awaiting review'
																	: `${reconstruction.status} on ${
																			reconstruction.reviewed_at ?? '—'
																		} by ${
																			reconstruction.reviewed_by_name ??
																			'unknown'
																		}`}
																{reconstruction.review_reason
																	? ` · ${reconstruction.review_reason}`
																	: ''}
															</p>
															<p className="text-[11px] text-amber-900/80">
																Recorded employer cost{' '}
																{formatCurrencyIn(
																	reconstruction.recorded_employer_cost,
																	data.payroll.currency
																)}{' '}
																against{' '}
																{formatNumber(
																	reconstruction.total_logged_hours
																)}{' '}
																Logged Hours; this evidence was not stored at
																the slip&apos;s original finalization.
															</p>
															{reconstruction.missing_evidence.length > 0 && (
																<ul className="mt-1 list-disc pl-4 text-[11px] text-amber-900">
																	{reconstruction.missing_evidence.map(
																		(entry) => (
																			<li key={entry.code}>{entry.detail}</li>
																		)
																	)}
																</ul>
															)}
															{reconstruction.status === 'pending' &&
																reconstruction.shares.length > 0 && (
																	<div className="mt-1">
																		<p className="text-[11px] font-medium text-amber-900">
																			Proposed shares (not recorded until
																			approved)
																		</p>
																		<table className="w-full text-xs">
																			<tbody>
																				{reconstruction.shares.map(
																					(share, index) => (
																						<tr
																							key={`${share.project_id ?? share.basis}-${index}`}
																							data-testid="payroll-reconstruction-share-row"
																							data-project-code={
																								share.project_code ?? ''
																							}
																							data-hours={String(share.hours)}
																							data-amount={String(share.amount)}
																							data-adjustment={String(
																								share.rounding_adjustment
																							)}
																							data-basis={share.basis}
																							className="text-amber-900"
																						>
																							<td className="py-0.5 pr-3">
																								{share.project_id === null
																									? share.basis === 'no_project'
																										? 'No project'
																										: 'No logged hours'
																									: `${share.project_code} — ${
																											share.project_name ?? ''
																										}`}
																							</td>
																							<td className="py-0.5 pr-3 text-right tabular-nums">
																								{formatNumber(share.hours)} h
																							</td>
																							<td className="py-0.5 text-right tabular-nums font-medium">
																								{formatCurrencyIn(
																									share.amount,
																									data.payroll.currency
																								)}
																							</td>
																						</tr>
																					)
																				)}
																			</tbody>
																		</table>
																	</div>
																)}
														</div>
													)}
													{employee.source.allocation_id !== null &&
														employee.source.payroll_slip_id !== null && (
															<AllocationRevisionPanel
																slipId={employee.source.payroll_slip_id}
																employee={employee}
																projectOptions={data.project_options}
																currency={data.payroll.currency}
																canRevise={canRevise}
															/>
														)}
												</td>
											</tr>
										)}
									</Fragment>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>
		</>
	);
}
