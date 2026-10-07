'use client';

/**
 * The isolated outward-cash section of the company expenditure report (#318).
 *
 * It renders the dated outward cash the module computes — recorded
 * settlements, native payroll payouts, and dated petty-cash spending — with
 * bank-into-float funding as its own movement set outside paid, per-target
 * partial/final/unsettled cover, and the legacy gaps disclosed, never
 * counted. Recording a settlement changes no incurred cost, no commitment,
 * and no project row; the server owns that invariant, this file only presents
 * it and calls the settlement routes.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
	BanknotesIcon,
	ChevronDownIcon,
	ChevronRightIcon,
} from '@heroicons/react/24/outline';
import { apiGet, apiPost } from '@/lib/api-client';
import { formatCurrencyIn, formatDate } from '@/lib/format';

interface CashMovementRow {
	source: string;
	movement_kind: string;
	movement_uid: string;
	settlement_uid: string | null;
	settlement_id: number | null;
	target_kind: string;
	target_key: string;
	target_label: string | null;
	target_nature: string | null;
	amount: number;
	currency: string | null;
	settled_on: string;
	reference: string | null;
	destination: string | null;
	evidence_reference: string | null;
	actor_user_id: number | null;
	financial_version: number | null;
}

interface CashTargetRow {
	target_kind: string;
	target_key: string;
	label: string | null;
	nature: string | null;
	currency: string | null;
	liability: number | null;
	settled: number;
	settled_this_month: number;
	remaining: number | null;
	state: string;
	movements: CashMovementRow[];
}

export interface CashSectionPayload {
	month: string;
	currency: string | null;
	paid: number | null;
	by_currency: Array<{
		currency: string;
		paid: number;
		movement_count: number;
		settlement: number;
		payroll: number;
		petty_spend: number;
	}>;
	funding: {
		by_currency: Array<{
			currency: string | null;
			amount: number;
			movement_count: number;
		}>;
		movements: CashMovementRow[];
		unlinked_vouchers: { count: number };
	};
	targets: CashTargetRow[];
	coverage: {
		settled_targets: number;
		partial_targets: number;
		unsettled_targets: number;
		outstanding: number | null;
	};
	unresolved_targets: { count: number; amount: number | null };
	legacy: {
		outward_unlinked: { count: number; amount: number | null };
		undated_balances: { count: number; amount: number | null };
		client_receipts: { count: number; amount: number | null };
		internal_transfers: { count: number; amount: number | null };
	};
}

interface SettlementCandidate {
	cost_uid: string;
	label: string | null;
	currency: string | null;
	recognized_amount: number | null;
	recognition_period: string | null;
	nature: string | null;
	remaining: number | null;
}

interface SlipCandidate {
	slip_id: number;
	employee_name: string | null;
	employer_cost: number | null;
	net_pay: number | null;
	payment_status: string;
	remaining: number | null;
}

export interface CashSectionProps {
	month: string;
	section: CashSectionPayload;
	/** Financial read gate + `other_expenses:update` — may record settlements. */
	canRecord: boolean;
}

function stateLabel(state: string): string {
	if (state === 'settled') return 'Settled';
	if (state === 'partial') return 'Partial';
	if (state === 'over_settled') return 'Over-settled';
	return 'Unsettled';
}

function kindLabel(kind: string): string {
	if (kind === 'payroll_payout') return 'Payroll payout';
	if (kind === 'petty_spend') return 'Petty-cash spend';
	if (kind === 'withholding') return 'Withholding';
	if (kind === 'deduction') return 'Deduction';
	return 'Payment';
}

export default function CashSection({ month, section, canRecord }: CashSectionProps) {
	const queryClient = useQueryClient();
	const [expanded, setExpanded] = useState(false);
	const [formOpen, setFormOpen] = useState(false);
	const [targetValue, setTargetValue] = useState('');
	const [kindValue, setKindValue] = useState('payment');
	const [amountValue, setAmountValue] = useState('');
	const [dateValue, setDateValue] = useState(month ? `${month}-01` : '');
	const [referenceValue, setReferenceValue] = useState('');
	const [destinationValue, setDestinationValue] = useState('');
	const [formError, setFormError] = useState<string | null>(null);

	const candidatesQuery = useQuery({
		queryKey: ['cash-settlements', month],
		queryFn: async () => {
			const body = (await apiGet(
				`/api/admin/expenditure-settlements?month=${month}`
			)) as {
				data: {
					candidates: { costs: SettlementCandidate[]; slips: SlipCandidate[] };
				};
			};
			return body.data.candidates;
		},
		enabled: canRecord,
	});

	const candidates = candidatesQuery.data;
	const selectedCost = candidates?.costs.find(
		(cost) => `cost:${cost.cost_uid}` === targetValue
	);
	const selectedSlip = candidates?.slips.find(
		(slip) => `payroll:${slip.slip_id}` === targetValue
	);
	const remainingHint = selectedCost?.remaining ?? selectedSlip?.remaining ?? null;

	const refresh = (): void => {
		void queryClient.invalidateQueries({ queryKey: ['expenditure'] });
		void queryClient.invalidateQueries({ queryKey: ['cash-settlements'] });
	};

	const recordMutation = useMutation({
		mutationFn: async () => {
			const [kind, key] = targetValue.split(/:(.+)/);
			const payload: Record<string, unknown> = {
				movement_kind: kindValue,
				amount: Number(amountValue),
				settled_on: dateValue,
				reference: referenceValue || null,
				destination: destinationValue || null,
			};
			if (kind === 'payroll') {
				payload.target_kind = 'payroll';
				payload.payroll_slip_id = Number(key);
			} else {
				payload.target_kind = 'cost';
				payload.target_cost_uid = key;
			}
			return (await apiPost('/api/admin/expenditure-settlements', payload)) as unknown;
		},
		onSuccess: () => {
			setFormOpen(false);
			setTargetValue('');
			setAmountValue('');
			setReferenceValue('');
			setDestinationValue('');
			setFormError(null);
			refresh();
		},
		onError: (error: unknown) => {
			setFormError(
				error instanceof Error ? error.message : 'Failed to record settlement'
			);
		},
	});

	const cancelMutation = useMutation({
		mutationFn: async (input: { id: number; version: number }) =>
			(await apiPost(`/api/admin/expenditure-settlements/${input.id}/commands`, {
				command: 'cancel',
				expected_version: input.version,
				reason: 'Cancelled from the report cash section',
			})) as unknown,
		onSuccess: refresh,
	});

	const paidDisplay =
		section.paid === null
			? '—'
			: formatCurrencyIn(section.paid, section.currency ?? 'INR');

	return (
		<section
			data-testid="cash-section"
			className="mt-6 rounded-lg border border-gray-200 bg-white p-4"
		>
			<button
				type="button"
				data-testid="cash-section-toggle"
				onClick={() => setExpanded((value) => !value)}
				className="flex w-full items-center gap-2 text-left"
			>
				{expanded ? (
					<ChevronDownIcon className="h-4 w-4" />
				) : (
					<ChevronRightIcon className="h-4 w-4" />
				)}
				<BanknotesIcon className="h-4 w-4" />
				<h3 className="text-sm font-semibold">Outward cash paid</h3>
				<span data-testid="cash-paid-amount" className="ml-auto text-sm font-semibold">
					{paidDisplay}
				</span>
			</button>
			<p className="mt-1 text-[11px] text-gray-500">
				Dated third-party movements only: recorded settlements, payroll
				payouts, and petty-cash spending. A payment never creates cost.
			</p>

			{expanded && (
				<div className="mt-3 space-y-4">
					{section.by_currency.map((row) => (
						<div key={row.currency} data-testid="cash-currency-row" className="text-xs">
							<span className="font-medium">{row.currency}</span>
							<span className="ml-2">
								paid {formatCurrencyIn(row.paid, row.currency)}
							</span>
							<span className="ml-2 text-gray-500">
								settlements {formatCurrencyIn(row.settlement, row.currency)} ·
								payroll {formatCurrencyIn(row.payroll, row.currency)} ·
								petty spending {formatCurrencyIn(row.petty_spend, row.currency)} ·
								{row.movement_count} movement(s)
							</span>
						</div>
					))}

					<div>
						<h4 className="text-xs font-semibold">
							Funding — internal transfer, outside paid
						</h4>
						<p data-testid="cash-funding-amount" className="text-xs text-gray-600">
							{section.funding.by_currency.length === 0
								? 'No funding dated in this month.'
								: section.funding.by_currency
										.map(
											(row) =>
												`${row.currency ?? 'unknown currency'} ${row.amount.toFixed(2)} in ${row.movement_count} movement(s)`
										)
										.join('; ')}
						</p>
						{section.funding.unlinked_vouchers.count > 0 && (
							<p className="text-xs text-amber-700">
								{section.funding.unlinked_vouchers.count} funding movement(s)
								name no resolvable voucher document.
							</p>
						)}
					</div>

					<div>
						<h4 className="text-xs font-semibold">Targets</h4>
						{section.targets.length === 0 && (
							<p className="text-xs text-gray-500">No cash targets this month.</p>
						)}
						<ul className="space-y-2">
							{section.targets.map((target) => (
								<li
									key={`${target.target_kind}:${target.target_key}`}
									data-testid="cash-target-row"
									className="rounded border border-gray-100 p-2 text-xs"
								>
									<div className="flex items-center gap-2">
										<span className="font-medium">
											{target.label ?? target.target_key}
										</span>
										{target.nature && target.nature !== 'operating' && (
											<span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] text-orange-800">
												{target.nature}
											</span>
										)}
										<span className="ml-auto text-gray-600">
											{stateLabel(target.state)}
											{target.liability !== null &&
												target.currency &&
												` · ${formatCurrencyIn(target.settled, target.currency)} of ${formatCurrencyIn(target.liability, target.currency)}`}
										</span>
									</div>
									{target.movements.length > 0 && (
										<ul className="mt-1 space-y-1 pl-3">
											{target.movements.map((movement) => (
												<li key={movement.movement_uid} data-testid="cash-movement-row" className="flex items-center gap-2 text-gray-600">
													<span>
														{kindLabel(movement.movement_kind)} ·{' '}
														{movement.currency
															? formatCurrencyIn(movement.amount, movement.currency)
															: movement.amount.toFixed(2)}{' '}
														· {formatDate(movement.settled_on)}
													</span>
													{movement.reference && <span>· {movement.reference}</span>}
													{movement.destination && (
														<span>· to {movement.destination}</span>
													)}
													{movement.source === 'settlement' &&
														movement.settlement_id !== null &&
														movement.financial_version !== null &&
														canRecord && (
															<button
																type="button"
																data-testid="cash-cancel-button"
																className="ml-auto rounded border border-gray-200 px-1.5 py-0.5 text-[10px]"
																onClick={() =>
																	cancelMutation.mutate({
																		id: movement.settlement_id as number,
																		version: movement.financial_version ?? 1,
																	})
																}
															>
																Cancel
															</button>
														)}
												</li>
											))}
										</ul>
									)}
								</li>
							))}
						</ul>
					</div>

					<div>
						<h4 className="text-xs font-semibold">Legacy gaps — disclosed, never counted</h4>
						<ul className="mt-1 space-y-1 text-xs text-gray-600">
							<li data-testid="cash-legacy-unlinked">
								{section.legacy.outward_unlinked.count} unlinked outward
								payment(s)
								{section.legacy.outward_unlinked.amount !== null &&
									` · ${section.legacy.outward_unlinked.amount.toFixed(2)} as stated`}
							</li>
							<li data-testid="cash-legacy-undated">
								{section.legacy.undated_balances.count} paid balance(s) with
								no usable date
								{section.legacy.undated_balances.amount !== null &&
									` · ${section.legacy.undated_balances.amount.toFixed(2)} as stated`}
							</li>
							<li data-testid="cash-legacy-receipts">
								{section.legacy.client_receipts.count} client receipt(s) and{' '}
								{section.legacy.internal_transfers.count} internal
								transfer(s) excluded from paid
							</li>
						</ul>
						{section.unresolved_targets.count > 0 && (
							<p className="mt-1 text-xs text-amber-700">
								{section.unresolved_targets.count} movement(s) name a target
								that no longer resolves.
							</p>
						)}
					</div>

					{canRecord && (
						<div>
							{!formOpen ? (
								<button
									type="button"
									data-testid="cash-record-open"
									className="rounded bg-[#64126D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#52105a]"
									onClick={() => setFormOpen(true)}
								>
									Record settlement
								</button>
							) : (
								<form
									className="space-y-2 rounded border border-gray-200 p-3"
									onSubmit={(event) => {
										event.preventDefault();
										setFormError(null);
										if (!targetValue) {
											setFormError('Choose the cost or slip this money settles.');
											return;
										}
										recordMutation.mutate();
									}}
								>
									<label className="block text-xs">
										Target
										<select
											data-testid="cash-target-select"
											className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
											value={targetValue}
											onChange={(event) => setTargetValue(event.target.value)}
										>
											<option value="">Choose a cost or slip…</option>
											<optgroup label="Costs">
												{(candidates?.costs ?? []).map((cost) => (
													<option key={cost.cost_uid} value={`cost:${cost.cost_uid}`}>
														{cost.label ?? cost.cost_uid} ·{' '}
														{cost.currency ?? '?'} · recognized{' '}
														{cost.recognized_amount ?? '—'}
													</option>
												))}
											</optgroup>
											<optgroup label="Payroll slips">
												{(candidates?.slips ?? []).map((slip) => (
													<option key={slip.slip_id} value={`payroll:${slip.slip_id}`}>
														Slip #{slip.slip_id} ·{' '}
														{slip.employee_name ?? 'unknown employee'} ·{' '}
														{slip.payment_status}
													</option>
												))}
											</optgroup>
										</select>
									</label>
									{remainingHint !== null && (
										<p data-testid="cash-remaining-hint" className="text-xs text-gray-600">
											Remaining on this target: {remainingHint.toFixed(2)}.
											The server never infers it — confirm the amount.
										</p>
									)}
									<div className="grid grid-cols-2 gap-2">
										<label className="block text-xs">
											Movement
											<select
												data-testid="cash-kind-select"
												className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
												value={kindValue}
												onChange={(event) => setKindValue(event.target.value)}
											>
												<option value="payment">Payment</option>
												<option value="withholding">Withholding</option>
												<option value="deduction">Deduction</option>
											</select>
										</label>
										<label className="block text-xs">
											Amount
											<input
												data-testid="cash-amount-input"
												className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
												value={amountValue}
												onChange={(event) => setAmountValue(event.target.value)}
												inputMode="decimal"
											/>
										</label>
										<label className="block text-xs">
											Cash date
											<input
												data-testid="cash-date-input"
												type="date"
												className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
												value={dateValue}
												onChange={(event) => setDateValue(event.target.value)}
											/>
										</label>
										<label className="block text-xs">
											Reference
											<input
												data-testid="cash-reference-input"
												className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
												value={referenceValue}
												onChange={(event) => setReferenceValue(event.target.value)}
											/>
										</label>
									</div>
									<label className="block text-xs">
										Destination (payee or authority)
										<input
											data-testid="cash-destination-input"
											className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
											value={destinationValue}
											onChange={(event) => setDestinationValue(event.target.value)}
										/>
									</label>
									{formError && (
										<p className="text-xs text-red-600">{formError}</p>
									)}
									<div className="flex gap-2">
										<button
											type="submit"
											data-testid="cash-record-button"
											disabled={recordMutation.isPending}
											className="rounded bg-[#64126D] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#52105a] disabled:opacity-50"
										>
											{recordMutation.isPending ? 'Recording…' : 'Record'}
										</button>
										<button
											type="button"
											className="rounded border border-gray-300 px-3 py-1.5 text-xs"
											onClick={() => {
												setFormOpen(false);
												setFormError(null);
												recordMutation.reset();
											}}
										>
											Cancel
										</button>
									</div>
								</form>
							)}
						</div>
					)}
				</div>
			)}
		</section>
	);
}