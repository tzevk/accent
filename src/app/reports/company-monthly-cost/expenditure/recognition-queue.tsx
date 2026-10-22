'use client';

/**
 * The unconfirmed cost queue of the company expenditure view.
 *
 * It states the cost that is recorded but not yet confirmed, and offers the
 * ways to correct it or to recognize, reject, or cancel it. Nothing here
 * computes a figure: every value arrives from the container as a plain value
 * and every action leaves as a callback.
 */

import { formatDate } from '@/lib/format';
import type { CostRecordJson } from '@/lib/company-expenditure';
import {
	CLASSIFICATION_LABELS,
	PERIOD_BASIS_LABELS,
	SOURCE_REGISTER_LABELS,
	SOURCE_REGISTER_LINKS,
	STATE_LABELS,
	formatSourceMoney,
} from './shared';
import type { ReconciliationPayload } from './types';

/** The cost a recognition command applies to, and the command itself. */
export interface CommandTarget {
	record: CostRecordJson;
	command: 'recognize' | 'reject' | 'cancel';
}

export interface RecognitionQueueProps {
	/** The month's reconciliation, for the month the queue names. */
	data: ReconciliationPayload;
	/** The cost that is recorded but not yet confirmed. */
	queue: CostRecordJson[];
	/** `other_expenses:update` — may correct an open cost through `update`. */
	canEditCost: boolean;
	/** `other_expenses:approve` — may recognize, reject, or cancel a cost. */
	canRecognize: boolean;
	/** Clears the command mutation's state before a new command opens. */
	onCommandReset: () => void;
	/** The cost to edit, or null to close the editor. */
	onEditTargetChange: (target: CostRecordJson | null) => void;
	/** The cost and command to confirm, or null to close the dialog. */
	onCommandTargetChange: (target: CommandTarget | null) => void;
}

export function RecognitionQueue({
	data,
	queue,
	canEditCost,
	canRecognize,
	onCommandReset,
	onEditTargetChange,
	onCommandTargetChange,
}: RecognitionQueueProps) {
	return (
		<>
			{/* Recognition queue */}
			<div
				data-testid="recognition-queue"
				className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-white"
			>
				<div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
					<p className="text-xs font-semibold text-gray-700">
						Not yet confirmed cost ({queue.length})
					</p>
					<p className="text-[11px] text-gray-500">
						Drafts and pending evidence are excluded from the totals above.
					</p>
				</div>
				{queue.length === 0 ? (
					<p className="px-3 py-4 text-center text-xs text-gray-500">
						Nothing awaiting recognition for {data.month_label}.
					</p>
				) : (
					<table className="w-full min-w-[720px] text-sm">
						<thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
							<tr>
								<th scope="col" className="px-3 py-2">
									Source
								</th>
								<th scope="col" className="px-3 py-2">
									Destination
								</th>
								<th scope="col" className="px-3 py-2 text-right">
									Gross
								</th>
								<th scope="col" className="px-3 py-2">
									Period
								</th>
								<th scope="col" className="px-3 py-2">
									State
								</th>
								<th scope="col" className="px-3 py-2">
									Actions
								</th>
							</tr>
						</thead>
						<tbody>
							{queue.map((record) => (
								<tr
									key={`${record.source}-${record.id}-${record.split?.id ?? 0}`}
									data-testid="queue-row"
									data-state={record.recognition_state}
									data-source-reference={record.source_reference ?? ''}
									className="border-t border-gray-100"
								>
									<td className="px-3 py-2">
										<div className="font-medium text-gray-900">
											{record.source_reference ?? record.expense_number}
										</div>
										<div className="text-xs text-gray-500">
											{record.vendor_name ?? '—'}
										</div>
									</td>
									<td className="px-3 py-2 text-xs text-gray-600">
										{record.cost_classification
											? CLASSIFICATION_LABELS[record.cost_classification]
											: 'Unresolved'}
										{record.project_code ? ` · ${record.project_code}` : ''}
									</td>
									<td className="px-3 py-2 text-right text-gray-900">
										{record.gross_amount === null
											? 'Amount unknown'
											: formatSourceMoney(record.gross_amount, record.currency)}
									</td>
									<td className="px-3 py-2 text-xs text-gray-600">
										{record.recognition_period
											? `${formatDate(record.recognition_period)} (${
													PERIOD_BASIS_LABELS[record.period_basis] ??
													record.period_basis
												})`
											: 'No recognition period'}
									</td>
									<td className="px-3 py-2 text-xs">
										<span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
											{STATE_LABELS[record.recognition_state] ??
												record.recognition_state}
										</span>
									</td>
									<td className="px-3 py-2">
										<div className="flex flex-wrap items-center gap-1.5">
											{record.source !== 'direct_expense' ? (
												// IDs come from different stores: another source's
												// row is never commanded through this register's
												// command path. Its recognition workflow lives in
												// its own register.
												<a
													href={SOURCE_REGISTER_LINKS[record.source]}
													data-testid="queue-source-link"
													className="text-xs font-medium text-[#64126D] underline"
												>
													{SOURCE_REGISTER_LABELS[record.source] ??
														`Source: ${record.source}`}
												</a>
											) : (
												<>
													{canEditCost && (
														<button
															type="button"
															data-testid="queue-edit"
															onClick={() => {
																onCommandReset();
																onEditTargetChange(record);
															}}
															className="rounded border border-[#64126D]/40 bg-[#64126D]/5 px-2 py-1 text-xs font-medium text-[#64126D] hover:bg-[#64126D]/10"
														>
															Edit
														</button>
													)}
													{canRecognize ? (
														<>
															<button
																type="button"
																onClick={() => {
																	onCommandReset();
																	onCommandTargetChange({
																		record,
																		command: 'recognize',
																	});
																}}
																className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
															>
																Recognize
															</button>
															<button
																type="button"
																onClick={() => {
																	onCommandReset();
																	onCommandTargetChange({
																		record,
																		command: 'reject',
																	});
																}}
																className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100"
															>
																Reject
															</button>
															<button
																type="button"
																onClick={() => {
																	onCommandReset();
																	onCommandTargetChange({
																		record,
																		command: 'cancel',
																	});
																}}
																className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
															>
																Cancel cost
															</button>
														</>
													) : (
														<span className="text-xs text-gray-600">
															Recognition needs approval access
														</span>
													)}
												</>
											)}
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</>
	);
}
