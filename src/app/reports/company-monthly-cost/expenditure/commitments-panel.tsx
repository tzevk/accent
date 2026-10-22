'use client';

/**
 * The outstanding commitment and non-operating balance blocks of the company
 * expenditure report.
 *
 * The commitment block states the supplier order value that recognized cost
 * has not yet consumed — never incurred cost — with the monthly roll-forward
 * behind it, the open orders, and the exceptions that stop a clean reading.
 * The non-operating block states advances, deposits, prepayments and capital
 * balances apart from operating cost, with the approved period consumption
 * drawn against them and what is left.
 */

import { formatCurrencyIn, formatDate } from '@/lib/format';
import type { PeriodChargeJson } from '@/lib/company-expenditure';
import type { NonOperatingItemRow, ReconciliationPayload } from './types';
import {
	CHARGE_BASIS_LABELS,
	CLASSIFICATION_LABELS,
	CONSUMABLE_NATURES,
	NATURE_LABELS,
	STATE_LABELS,
	money,
} from './shared';

export interface CommitmentsPanelProps {
	/** The reconciliation payload of the month under report. */
	data: ReconciliationPayload;
	/** `other_expenses:approve` — may record an approved period charge. */
	canRecognize: boolean;
	/** Opens the period-charge capture on a non-operating balance. */
	onChargeTargetChange: (target: NonOperatingItemRow | null) => void;
	/** Opens the cancellation of an approved period charge. */
	onCancelChargeTargetChange: (target: PeriodChargeJson | null) => void;
	/** Clears the capture mutation before its dialog opens. */
	onChargeReset: () => void;
	/** Clears the cancellation mutation before its dialog opens. */
	onCancelChargeReset: () => void;
}

export function CommitmentsPanel({
	data,
	canRecognize,
	onChargeTargetChange,
	onCancelChargeTargetChange,
	onChargeReset,
	onCancelChargeReset,
}: CommitmentsPanelProps) {
	return (
		<>
			{/* Outstanding Supplier Commitment (#312) */}
			<div
				data-testid="commitment-section"
				className="mt-3 rounded-xl border border-sky-200 bg-sky-50/40 p-3"
			>
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<p className="text-xs font-semibold text-gray-800">
						Outstanding Supplier Commitment
					</p>
					<p className="text-[11px] text-gray-600">
						Supplier order value not yet consumed by recognized cost — never
						incurred cost. Reconstructed as of this month from the recorded
						eligibility, consumption, and cancellation acts.
					</p>
				</div>
				<div className="mt-2 space-y-2">
					{data.supplier_commitment.totals.map((total) => (
						<div
							key={`${total.currency}-${total.basis}`}
							data-testid="commitment-row"
							data-currency={total.currency}
							data-basis={total.basis}
							data-closing={total.closingCommitment}
							data-consumption={total.consumptionInMonth}
							className="rounded-lg border border-sky-100 bg-white/70 p-2"
						>
							<div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-gray-800">
								<span className="font-medium">
									{total.currency} ·{' '}
									{total.basis === 'gross' ? 'including tax' : 'net of tax'} ·{' '}
									{total.unconsumedOrderCount} order
									{total.unconsumedOrderCount === 1 ? '' : 's'} open
								</span>
								<span>
									Closing commitment:{' '}
									<strong>
										{money(total.closingCommitment, total.currency)}
									</strong>{' '}
									· consumed this month:{' '}
									{money(total.consumptionInMonth, total.currency)}
								</span>
							</div>
							<div className="overflow-x-auto">
								<table className="mt-1 w-full min-w-[400px] text-[11px] text-gray-700">
									<thead>
										<tr className="text-left text-gray-500">
											<th className="pr-2">Month</th>
											<th className="pr-2">Opening</th>
											<th className="pr-2">New</th>
											<th className="pr-2">Consumption</th>
											<th className="pr-2">Cancellation</th>
											<th>Closing</th>
										</tr>
									</thead>
									<tbody>
										{total.months.map((row) => (
											<tr key={row.month} data-testid="commitment-month">
												<td className="pr-2">{row.month}</td>
												<td className="pr-2">
													{money(row.opening, total.currency)}
												</td>
												<td className="pr-2">
													{money(row.newCommitment, total.currency)}
												</td>
												<td className="pr-2">
													{money(row.consumption, total.currency)}
												</td>
												<td className="pr-2">
													{money(row.cancellation, total.currency)}
												</td>
												<td>{money(row.closing, total.currency)}</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					))}
					{data.supplier_commitment.totals.length === 0 && (
						<p className="text-xs text-gray-500">
							No supported supplier commitment this month.
						</p>
					)}
					{data.supplier_commitment.orders.length > 0 && (
						<div className="overflow-x-auto">
							<table className="min-w-full text-[11px] text-gray-700">
								<thead>
									<tr className="text-left text-gray-500">
										<th className="pr-2">Order</th>
										<th className="pr-2">Counterparty</th>
										<th className="pr-2">Project</th>
										<th className="pr-2">Value</th>
										<th className="pr-2">Consumed</th>
										<th className="pr-2">Remaining</th>
										<th>Status</th>
									</tr>
								</thead>
								<tbody>
									{data.supplier_commitment.orders.map((order) => (
										<tr
											key={order.orderUid}
											data-testid="commitment-order"
											data-order-number={order.orderNumber}
											data-remaining={order.remaining}
										>
											<td className="pr-2">{order.orderNumber}</td>
											<td className="pr-2">{order.counterpartyName}</td>
											<td className="pr-2">{order.projectCode || '—'}</td>
											<td className="pr-2">
												{money(order.value, order.currency)}
											</td>
											<td className="pr-2">
												{money(order.consumption, order.currency)}
											</td>
											<td className="pr-2">
												{money(order.remaining, order.currency)}
											</td>
											<td>{order.status}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					{data.supplier_commitment.exceptions.length > 0 && (
						<ul className="space-y-1 text-[11px] text-amber-900">
							{data.supplier_commitment.exceptions.map((exception) => (
								<li
									key={`${exception.code}-${exception.currency ?? ''}-${exception.basis ?? ''}`}
									data-testid="commitment-exception"
									data-code={exception.code}
									data-count={exception.orderCount}
								>
									<span className="font-medium">{exception.code}</span>:{' '}
									{exception.detail} ({exception.orderCount}
									{exception.value === null
										? ', value unknown'
										: `, ${formatCurrencyIn(exception.value, exception.currency ?? 'INR')}`}
									)
								</li>
							))}
						</ul>
					)}
				</div>
			</div>

			{/* Non-operating balances and their approved consumption (#317) */}
			{(data.non_operating.items.length > 0 ||
				data.non_operating.charges_from_prior_items.length > 0) && (
				<div
					data-testid="non-operating-section"
					className="mt-3 rounded-xl border border-amber-200 bg-amber-50/40 p-3"
				>
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<p className="text-xs font-semibold text-gray-800">
							Non-operating items — advances, deposits, prepayments, capital
						</p>
						<p className="text-[11px] text-gray-600">
							Shown separately from operating cost: a payment or invoice here is
							a balance, and only approved period consumption is counted.
						</p>
					</div>
					<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-700">
						<span data-testid="non-operating-excluded">
							Excluded source amount{' '}
							{money(
								data.non_operating.excluded_source_amount,
								data.non_operating.currency
							)}
						</span>
						<span data-testid="non-operating-consumed">
							Consumed this month{' '}
							{money(
								data.non_operating.consumed_this_month,
								data.non_operating.currency
							)}
						</span>
						<span>
							Consumed to date{' '}
							{money(
								data.non_operating.consumed_to_date,
								data.non_operating.currency
							)}
						</span>
						<span data-testid="non-operating-remaining">
							Remaining{' '}
							{money(
								data.non_operating.remaining_amount,
								data.non_operating.currency
							)}
						</span>
						{data.non_operating.unapproved_count > 0 && (
							<span data-testid="non-operating-unapproved">
								{data.non_operating.unapproved_count} item(s) not approved yet —
								no supported balance to consume
							</span>
						)}
						{data.non_operating.unresolved_count > 0 && (
							<span data-testid="non-operating-unresolved">
								Treatment unresolved: {data.non_operating.unresolved_count}{' '}
								record(s),{' '}
								{money(
									data.non_operating.unresolved_source_amount,
									data.non_operating.currency
								)}{' '}
								excluded
							</span>
						)}
					</div>
					<ul className="mt-2 space-y-1.5">
						{data.non_operating.items.map((entry) => (
							<li
								key={entry.cost_uid}
								data-testid="non-operating-item"
								data-cost-uid={entry.cost_uid}
								data-nature={entry.nature}
								data-recognized={entry.recognized_amount ?? ''}
								data-remaining={entry.remaining_amount ?? ''}
								className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700"
							>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
									<span className="font-medium text-gray-900">
										{entry.source_reference ?? entry.expense_number}
									</span>
									<span
										data-testid="item-nature"
										className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
									>
										{NATURE_LABELS[entry.nature] ?? entry.nature}
									</span>
									<span>
										{entry.cost_classification
											? CLASSIFICATION_LABELS[entry.cost_classification]
											: 'Destination unresolved'}
										{entry.project_code ? ` · ${entry.project_code}` : ''}
									</span>
									<span>
										Supported balance{' '}
										{money(entry.recognized_amount, entry.currency)}
									</span>
									<span>
										Consumed to date{' '}
										{money(entry.consumed_to_date, entry.currency)}
									</span>
									<span className="font-semibold text-gray-900">
										Remaining {money(entry.remaining_amount, entry.currency)}
									</span>
									<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
										{STATE_LABELS[entry.source_state] ?? entry.source_state}
									</span>
									<span className="text-[10px] text-gray-500">
										{entry.evidence_reference ?? 'No evidence reference'}
									</span>
									{canRecognize &&
										entry.source_state === 'recognized' &&
										CONSUMABLE_NATURES.includes(entry.nature) && (
											<button
												type="button"
												data-testid="capture-charge"
												onClick={() => {
													onChargeReset();
													onChargeTargetChange(entry);
												}}
												className="rounded border border-[#64126D]/40 bg-[#64126D]/5 px-2 py-0.5 text-[11px] font-medium text-[#64126D] hover:bg-[#64126D]/10"
											>
												Capture period charge
											</button>
										)}
								</div>
								{entry.charges.length > 0 && (
									<ul className="mt-1 space-y-0.5 border-t border-gray-100 pt-1">
										{entry.charges.map((charge) => (
											<li
												key={charge.charge_uid}
												data-testid="period-charge"
												data-charge-uid={charge.charge_uid}
												data-state={charge.state}
												className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-600"
											>
												<span>
													{CHARGE_BASIS_LABELS[charge.basis] ?? charge.basis}
												</span>
												<span className="font-medium text-gray-800">
													{formatCurrencyIn(charge.amount, charge.currency)}
												</span>
												<span>{formatDate(charge.period)}</span>
												<span>{charge.evidence_reference}</span>
												<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px]">
													{charge.state === 'approved'
														? 'Approved'
														: 'Cancelled'}
												</span>
												{charge.state === 'approved' && canRecognize && (
													<button
														type="button"
														onClick={() => {
															onCancelChargeReset();
															onCancelChargeTargetChange(charge);
														}}
														className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
													>
														Cancel charge
													</button>
												)}
											</li>
										))}
									</ul>
								)}
							</li>
						))}
					</ul>
					{data.non_operating.charges_from_prior_items.length > 0 && (
						<div
							data-testid="prior-item-charges"
							className="mt-2 border-t border-amber-200/70 pt-1.5 text-[11px] text-gray-600"
						>
							<p className="font-medium text-gray-700">
								Charges on balances recognised in an earlier month
							</p>
							<ul className="mt-0.5 space-y-0.5">
								{data.non_operating.charges_from_prior_items.map((charge) => (
									<li key={charge.charge_uid}>
										{charge.source_expense_number} ·{' '}
										{CHARGE_BASIS_LABELS[charge.basis] ?? charge.basis} ·{' '}
										{formatCurrencyIn(charge.amount, charge.currency)} ·{' '}
										{formatDate(charge.period)} ·{' '}
										{charge.state === 'approved' ? 'Approved' : 'Cancelled'}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</>
	);
}
