'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * The Project's canonical orders (ticket #310), shown on the Project tabs.
 *
 * Client order value is commercial context; supplier order values are
 * commitments. The two are never combined, currencies are never summed, and an
 * order whose value is unknown stays unknown rather than becoming zero.
 */
export default function ProjectOrdersPanel({ projectId, canManageOrders }) {
	const [data, setData] = useState(null);
	const [error, setError] = useState(null);

	const load = useCallback(async () => {
		if (!projectId) return;
		try {
			const res = await fetch(
				`/api/admin/orders?project_id=${encodeURIComponent(projectId)}&include_cancelled=1&limit=200`
			);
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				setError(
					res.status === 403
						? 'You do not have permission to view this Project’s orders.'
						: body?.message || 'Could not load the Project’s orders.'
				);
				return;
			}
			setError(null);
			setData(body.data);
		} catch (err) {
			setError(err.message || 'Could not load the Project’s orders.');
		}
	}, [projectId]);

	useEffect(() => {
		load();
	}, [load]);

	if (error) {
		return (
			<section
				data-testid="project-orders-panel"
				className="bg-white border border-gray-200 rounded-lg shadow-sm px-6 py-5"
			>
				<p className="text-sm text-red-600" role="alert">
					{error}
				</p>
			</section>
		);
	}

	if (!data) {
		return (
			<section
				data-testid="project-orders-panel"
				className="bg-white border border-gray-200 rounded-lg shadow-sm px-6 py-5"
			>
				<p className="text-sm text-gray-500">Loading orders…</p>
			</section>
		);
	}

	const clientTotals = data.totals.filter((row) => row.direction === 'client');
	const supplierTotals = data.totals.filter(
		(row) => row.direction === 'supplier'
	);
	const unknown = data.orders.filter(
		(order) => order.amountBasis === 'unknown'
	).length;
	const singleClientTotal = clientTotals.length === 1 ? clientTotals[0] : null;

	const money = (value) =>
		value === null || value === undefined
			? '—'
			: Number(value).toLocaleString('en-IN', {
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				});

	return (
		<section
			data-testid="project-orders-panel"
			className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden"
		>
			<div className="border-b border-gray-200 bg-gray-50/80 px-6 py-4 flex items-center justify-between">
				<div>
					<h2 className="text-base font-semibold text-gray-900">
						Project Orders
					</h2>
					<p className="text-xs text-gray-500">
						Client order value is commercial context; supplier order value is a
						commitment, not incurred cost.
					</p>
				</div>
				{canManageOrders && (
					<Link
						href={`/admin/orders?project_id=${encodeURIComponent(projectId)}`}
						className="text-xs font-medium text-purple-700 underline"
					>
						Manage orders →
					</Link>
				)}
			</div>

			<div className="grid gap-4 px-6 py-5 md:grid-cols-2">
				<div className="rounded-lg border border-gray-200 p-3">
					<h3 className="text-sm font-semibold text-gray-900">
						Client orders (commercial context)
					</h3>
					{singleClientTotal && (
						<p
							data-testid="project-client-order-total"
							data-amount={singleClientTotal.orderValue}
							data-currency={singleClientTotal.currency}
							data-basis={singleClientTotal.basis}
							className="mt-1 text-sm text-gray-800"
						>
							{singleClientTotal.currency} {money(singleClientTotal.orderValue)}{' '}
							(
							{singleClientTotal.basis === 'gross'
								? 'including tax'
								: 'net of tax'}
							)
						</p>
					)}
					{clientTotals.map((row) => (
						<div
							key={`${row.currency}-${row.basis}`}
							data-testid="project-client-order-total-row"
							data-currency={row.currency}
							data-basis={row.basis}
							data-amount={row.orderValue}
							className="mt-1 flex justify-between text-sm text-gray-800"
						>
							<span>
								{row.currency} · {row.basis} · {row.orderCount} order
								{row.orderCount === 1 ? '' : 's'}
							</span>
							<span className="font-semibold">{money(row.orderValue)}</span>
						</div>
					))}
					{clientTotals.length === 0 && (
						<p className="mt-1 text-sm text-gray-500">
							No supported client order value.
						</p>
					)}
				</div>

				<div className="rounded-lg border border-gray-200 p-3">
					<h3 className="text-sm font-semibold text-gray-900">
						Supplier orders
					</h3>
					<p
						data-testid="project-supplier-commitment-note"
						className="text-xs text-gray-500"
					>
						Ordered value only, never incurred cost. Open a supplier order to see
						its recognized consumption and remaining commitment.
					</p>
					{supplierTotals
						.filter((row) => row.currency === 'INR')
						.map((row) => (
							<div
								key={`${row.currency}-${row.basis}`}
								data-testid={`project-supplier-order-total-${row.basis}`}
								data-currency={row.currency}
								data-basis={row.basis}
								data-amount={row.orderValue}
								className="mt-1 flex justify-between text-sm text-gray-800"
							>
								<span>
									{row.currency} · {row.basis} · {row.orderCount} order
									{row.orderCount === 1 ? '' : 's'}
								</span>
								<span className="font-semibold">{money(row.orderValue)}</span>
							</div>
						))}
					{supplierTotals
						.filter((row) => row.currency !== 'INR')
						.map((row) => (
							<div
								key={`${row.currency}-${row.basis}`}
								data-testid="project-supplier-order-total-row"
								data-currency={row.currency}
								data-basis={row.basis}
								data-amount={row.orderValue}
								className="mt-1 flex justify-between text-sm text-gray-800"
							>
								<span>
									{row.currency} · {row.basis} · {row.orderCount} order
									{row.orderCount === 1 ? '' : 's'}
								</span>
								<span className="font-semibold">{money(row.orderValue)}</span>
							</div>
						))}
					{supplierTotals.length === 0 && (
						<p className="mt-1 text-sm text-gray-500">
							No supported supplier order value.
						</p>
					)}
					<p
						data-testid="project-supplier-order-unknown"
						data-count={unknown}
						className="mt-1 text-xs text-amber-700"
					>
						{unknown} order(s) without a supported value
					</p>
				</div>
			</div>

			<div className="overflow-x-auto px-6 pb-5">
				<table className="min-w-full text-sm">
					<thead>
						<tr className="text-left text-xs uppercase text-gray-500">
							<th className="px-2 py-2">Number</th>
							<th className="px-2 py-2">Direction</th>
							<th className="px-2 py-2">Counterparty</th>
							<th className="px-2 py-2">Value</th>
							<th className="px-2 py-2">Status</th>
						</tr>
					</thead>
					<tbody>
						{data.orders.map((order) => (
							<tr
								key={order.orderUid}
								data-testid="project-order-row"
								data-direction={order.direction}
								className="border-t border-gray-100"
							>
								<td className="px-2 py-2">{order.orderNumber}</td>
								<td className="px-2 py-2">{order.direction}</td>
								<td className="px-2 py-2">{order.counterpartyName}</td>
								<td className="px-2 py-2">
									{order.amountBasis === 'unknown'
										? `Unknown (${order.currency})`
										: `${order.currency} ${money(
												order.amountBasis === 'gross'
													? order.grossAmount
													: order.netAmount
											)}`}
								</td>
								<td className="px-2 py-2">{order.status}</td>
							</tr>
						))}
						{data.orders.length === 0 && (
							<tr>
								<td className="px-2 py-3 text-gray-500" colSpan={5}>
									No orders recorded for this Project.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</section>
	);
}
