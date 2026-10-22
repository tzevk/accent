'use client';

/**
 * The petty cash, tax, evidence and coverage blocks of the company expenditure
 * report.
 *
 * Petty cash funding and spending stay separate from incurred cost; the tax
 * block states what is recognized, what is recoverable, and what is still
 * unresolved; the evidence block states where every record stands; and the
 * coverage notices say what the headline total does and does not include.
 *
 * A multi-currency month states its tax figures per currency, from the same
 * slices the report already publishes; they are never combined.
 */

import {
	ExclamationTriangleIcon,
	InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { formatCurrencyIn } from '@/lib/format';
import type { ReconciliationPayload } from './types';

export interface BalancesPanelProps {
	data: ReconciliationPayload;
}

export function BalancesPanel({ data }: BalancesPanelProps) {
	// A multi-currency month states tax figures per currency, from the same
	// slices the report already publishes; they are never combined.
	const currencyBreakdown = (
		key: 'gross_liability' | 'recoverable_tax' | 'unresolved_tax_gross'
	) =>
		data.company.currency_totals
			.map((row) => formatCurrencyIn(row[key], row.currency))
			.join(' · ');

	return (
		<>
			{/* Petty cash: funding, spending, remaining funding, recognized cost */}
			<div
				data-testid="petty-cash-section"
				className="mt-3 rounded-xl border border-purple-200 bg-purple-50/40 p-3"
			>
				<p className="text-xs font-semibold text-purple-900">
					Petty cash — funding and spending stay separate from incurred cost
				</p>
				<div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
					{(
						[
							[
								'petty-funding-amount',
								'Funding',
								data.petty_cash.funding,
								'Vouchers and their mirrored credits; cash into the float, never expense',
							],
							[
								'petty-spend-amount',
								'Spend',
								data.petty_cash.spend,
								'Actual petty-cash spending recorded this month',
							],
							[
								'petty-remaining-amount',
								'Remaining funded',
								data.petty_cash.remaining_funding,
								'Funding less the spending drawn from vouchers',
							],
							[
								'petty-recognized-amount',
								'Recognized cost',
								data.petty_cash.recognized_cost,
								'Approved spending, already counted once above',
							],
						] as const
					).map(([testId, label, value, hint]) => (
						<div
							key={testId}
							className="rounded-lg border border-purple-100 bg-white p-2"
						>
							<p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
								{label}
							</p>
							<p
								data-testid={testId}
								data-amount={value === null ? '' : String(value)}
								className="text-base font-bold text-purple-900"
							>
								{value === null
									? '—'
									: formatCurrencyIn(value, data.petty_cash.currency ?? 'INR')}
							</p>
							<p className="text-[10px] text-gray-500">{hint}</p>
						</div>
					))}
				</div>
				{data.petty_cash.by_currency.length > 1 && (
					<ul className="mt-2 space-y-0.5 text-[11px] text-purple-900">
						{data.petty_cash.by_currency.map((row) => (
							<li key={row.currency} data-testid="petty-currency-row">
								{row.currency}: funding{' '}
								{formatCurrencyIn(row.funding, row.currency)} · spend{' '}
								{formatCurrencyIn(row.spend, row.currency)} · remaining{' '}
								{formatCurrencyIn(row.remaining_funding, row.currency)} ·
								recognized {formatCurrencyIn(row.recognized_cost, row.currency)}
							</li>
						))}
					</ul>
				)}
				<ul className="mt-2 space-y-0.5 text-[11px] text-purple-900/90">
					<li data-testid="petty-unlinked-spend">
						Spending without voucher linkage:{' '}
						{data.petty_cash.unlinked_spend.count}
						{data.petty_cash.unlinked_spend.amount === null
							? ''
							: ` (${formatCurrencyIn(
									data.petty_cash.unlinked_spend.amount,
									data.petty_cash.currency ?? 'INR'
								)})`}
					</li>
					<li data-testid="petty-unresolved-settlements">
						Receipts settling an unrecognized cost:{' '}
						{data.petty_cash.unresolved_settlements.count}
						{data.petty_cash.unresolved_settlements.amount === null
							? ''
							: ` (${formatCurrencyIn(
									data.petty_cash.unresolved_settlements.amount,
									data.petty_cash.currency ?? 'INR'
								)})`}
					</li>
					{data.petty_cash.unknown_currency &&
						data.petty_cash.unknown_currency.count > 0 && (
							<li data-testid="petty-unknown-currency">
								Records whose original currency is unknown:{' '}
								{data.petty_cash.unknown_currency.count} — stated in no currency
								subtotal
							</li>
						)}
				</ul>
			</div>

			{/* Tax and evidence */}
			<div className="mt-3 grid gap-2 md:grid-cols-2">
				<div className="rounded-xl border border-gray-200 bg-white p-3">
					<p className="text-xs font-semibold text-gray-700">
						Tax on recognized cost
					</p>
					<ul className="mt-1 space-y-0.5 text-xs text-gray-600">
						<li data-testid="tax-gross">
							Gross liability:{' '}
							{data.company.gross_liability !== null
								? formatCurrencyIn(
										data.company.gross_liability,
										data.company.currency
									)
								: currencyBreakdown('gross_liability')}
						</li>
						<li data-testid="tax-recoverable">
							Confirmed recoverable tax excluded:{' '}
							{data.company.recoverable_tax !== null
								? formatCurrencyIn(
										data.company.recoverable_tax,
										data.company.currency
									)
								: currencyBreakdown('recoverable_tax')}
						</li>
						<li data-testid="tax-unresolved">
							Unresolved tax kept at gross: {data.company.unresolved_tax.count}{' '}
							record(s),{' '}
							{data.company.unresolved_tax.gross_amount !== null
								? formatCurrencyIn(
										data.company.unresolved_tax.gross_amount,
										data.company.currency
									)
								: currencyBreakdown('unresolved_tax_gross')}
						</li>
					</ul>
				</div>
				<div className="rounded-xl border border-gray-200 bg-white p-3">
					<p className="text-xs font-semibold text-gray-700">
						Evidence state (this month)
					</p>
					<ul className="mt-1 grid grid-cols-2 gap-x-3 text-xs text-gray-600">
						{(
							[
								['recognized', 'Recognized'],
								['pending_evidence', 'Pending evidence'],
								['draft', 'Draft'],
								['rejected', 'Rejected'],
								['cancelled', 'Cancelled'],
							] as const
						).map(([key, label]) => (
							<li key={key} data-testid="evidence-row" data-state={key}>
								{label}: {data.evidence[key].count}
							</li>
						))}
						<li data-testid="evidence-row" data-state="unresolved">
							Unclassified: {data.evidence.unresolved_classification.count}
						</li>
						<li data-testid="evidence-row" data-state="missing_amount">
							Missing amount: {data.evidence.missing_amount.count}
						</li>
						<li data-testid="evidence-row" data-state="missing_currency">
							Missing original currency: {data.evidence.missing_currency.count}
						</li>
						<li data-testid="evidence-row" data-state="known_zero">
							Known zero: {data.evidence.known_zero.count}
						</li>
					</ul>
				</div>
			</div>

			{/* Coverage */}
			<div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
				<p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
					<ExclamationTriangleIcon className="h-4 w-4" />
					Coverage: what this total does and does not include
				</p>
				<ul className="mt-1 space-y-1 text-xs text-amber-900/90">
					{data.coverage.map((notice) => (
						<li
							key={notice.code}
							data-testid="coverage-notice"
							data-code={notice.code}
							data-severity={notice.severity}
							className="flex items-start gap-1.5"
						>
							<InformationCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>
								<span className="font-medium">{notice.label}.</span>{' '}
								{notice.detail}
							</span>
						</li>
					))}
				</ul>
			</div>
		</>
	);
}
