'use client';

/**
 * The client order block of the company expenditure report.
 *
 * Client order values are commercial contract context: they are not
 * recognized revenue, not profit and not company expenditure, so this block
 * presents them apart from the cost figures and says so in the reader's words.
 */

import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { formatCurrencyIn, formatDate } from '@/lib/format';
import type { ClientOrderRow, ClientOrderTotalRow } from './types';

export interface ClientOrdersPanelProps {
	clientOrders: ClientOrderRow[];
	clientOrderTotals: ClientOrderTotalRow[];
}

export function ClientOrdersPanel({
	clientOrders,
	clientOrderTotals,
}: ClientOrdersPanelProps) {
	return (
		<>
			{/* Client order value shown separately as commercial context */}
			<div
				data-testid="client-order-commercial-summary"
				className="mt-3 rounded-xl border border-purple-200 bg-purple-50/40 p-3"
			>
				<div className="flex flex-wrap items-baseline justify-between gap-2">
					<div className="flex items-center gap-1.5">
						<InformationCircleIcon className="h-4 w-4 text-[#64126D]" />
						<h3 className="text-xs font-semibold text-gray-900">
							Client order value — commercial context
						</h3>
					</div>
					<span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-900">
						Commercial context only · Not cost, revenue, or profit
					</span>
				</div>
				<p className="mt-1 text-[11px] leading-relaxed text-gray-600">
					Client order values represent commercial contract context. They are
					not recognized revenue, not profit, and not company expenditure. Do
					not subtract project costs from client orders to calculate profit.
				</p>
				{clientOrderTotals.length > 0 ? (
					<div className="mt-2 flex flex-wrap gap-2.5">
						{clientOrderTotals.map((tot) => (
							<div
								key={`${tot.currency}-${tot.basis}`}
								data-testid="client-order-total"
								data-currency={tot.currency}
								data-basis={tot.basis}
								data-amount={tot.orderValue}
								className="rounded-lg border border-purple-100 bg-white px-3 py-1.5 text-xs text-gray-800 shadow-xs"
							>
								<span className="text-gray-500">
									{tot.currency} · {tot.basis === 'gross' ? 'gross' : 'net'}:
								</span>{' '}
								<span className="font-semibold text-gray-900">
									{formatCurrencyIn(tot.orderValue, tot.currency)}
								</span>
								<span className="ml-1 text-[10px] text-gray-500">
									({tot.orderCount} order{tot.orderCount === 1 ? '' : 's'})
								</span>
							</div>
						))}
					</div>
				) : (
					<p className="mt-2 text-xs text-gray-500">
						No client orders recorded for the current selection.
					</p>
				)}
				{clientOrders.length > 0 && (
					<div className="mt-2.5 overflow-x-auto">
						<table className="w-full text-left text-xs">
							<thead>
								<tr className="border-b border-purple-100 text-[11px] font-medium uppercase tracking-wide text-gray-500">
									<th className="py-1 pr-2">Order #</th>
									<th className="py-1 pr-2">Client</th>
									<th className="py-1 pr-2">Project</th>
									<th className="py-1 pr-2">Order Date</th>
									<th className="py-1 pr-2 text-right">Order Value</th>
									<th className="py-1 pr-2 text-right">Invoiced</th>
									<th className="py-1 pr-2 text-right">Remaining</th>
									<th className="py-1 pl-2">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100">
								{clientOrders.map((order) => {
									const orderValue =
										order.amountBasis === 'gross'
											? order.grossAmount
											: order.netAmount;
									return (
										<tr
											key={order.orderUid}
											data-testid="client-order-row"
											data-order-number={order.orderNumber}
											data-project-code={order.projectCode ?? ''}
											data-currency={order.currency}
											data-order-value={orderValue ?? ''}
											className="hover:bg-purple-50/20"
										>
											<td className="py-1 pr-2 font-medium text-gray-900">
												{order.orderNumber}
											</td>
											<td className="py-1 pr-2 text-gray-700">
												{order.counterpartyName}
											</td>
											<td className="py-1 pr-2 text-gray-700">
												{order.projectCode
													? `${order.projectCode}${order.projectName ? ` — ${order.projectName}` : ''}`
													: '—'}
											</td>
											<td className="py-1 pr-2 text-gray-500">
												{order.orderDate ? formatDate(order.orderDate) : '—'}
											</td>
											<td className="py-1 pr-2 text-right font-medium text-gray-900">
												{orderValue !== null
													? formatCurrencyIn(orderValue, order.currency)
													: '—'}{' '}
												<span className="text-[10px] text-gray-500">
													({order.amountBasis})
												</span>
											</td>
											<td className="py-1 pr-2 text-right text-gray-600">
												{order.clientInvoicedValue !== null &&
												order.clientInvoicedValue !== undefined
													? formatCurrencyIn(
															order.clientInvoicedValue,
															order.currency
														)
													: '—'}
											</td>
											<td className="py-1 pr-2 text-right text-gray-600">
												{order.clientRemainingValue !== null &&
												order.clientRemainingValue !== undefined
													? formatCurrencyIn(
															order.clientRemainingValue,
															order.currency
														)
													: '—'}
											</td>
											<td className="py-1 pl-2">
												<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] capitalize text-gray-700">
													{order.status}
												</span>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</>
	);
}
