'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DocumentUpload from '@/components/DocumentUpload';

/**
 * Canonical order entry and legacy review (ticket #310).
 *
 * One screen captures explicit client/supplier orders with their counterparty,
 * Project, currency, tax/amount basis, order date, source document, status,
 * and firm/cancellable evidence; shows client order value as commercial
 * context apart from supplier order values (with unknown values kept unknown);
 * and resolves the pre-canonical copies through document-backed, versioned
 * review decisions.
 */

const DIRECTIONS = [
	{ value: 'client', label: 'Client order' },
	{ value: 'supplier', label: 'Supplier order' },
];
const BASES = [
	{ value: 'net', label: 'Net of tax' },
	{ value: 'gross', label: 'Including tax' },
	{ value: 'unknown', label: 'Unknown' },
];
const STATUSES = ['draft', 'pending', 'approved', 'completed', 'cancelled'];
const FIRMNESS = [
	{ value: 'firm', label: 'Firm' },
	{ value: 'cancellable', label: 'Cancellable' },
	{ value: 'unknown', label: 'Unknown' },
];
const STORE_LABELS = {
	purchase_orders: 'Incoming purchase orders',
	outgoing_purchase_orders: 'Outgoing purchase orders',
	project_purchase_orders: 'Project purchase orders',
	project_invoices: 'Project invoice/PO tab',
};

const EMPTY_FORM = {
	direction: 'supplier',
	order_number: '',
	counterparty_name: '',
	project_id: '',
	currency: 'INR',
	amount_basis: 'net',
	gross_amount: '',
	tax_amount: '',
	net_amount: '',
	order_date: '',
	status: 'draft',
	firmness: 'unknown',
	firmness_evidence_reference: '',
	source_document_reference: '',
	remarks: '',
};

function money(value) {
	if (value === null || value === undefined) return '—';
	return Number(value).toLocaleString('en-IN', {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
}

async function readJson(response) {
	let body = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	return { ok: response.ok, status: response.status, body };
}

export default function OrdersPage() {
	const [projectFilter, setProjectFilter] = useState('');
	const [projects, setProjects] = useState([]);
	const [list, setList] = useState(null);
	const [queue, setQueue] = useState(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [formError, setFormError] = useState(null);
	const [formSuccess, setFormSuccess] = useState(null);
	const [submitting, setSubmitting] = useState(false);
	const [directionFilter, setDirectionFilter] = useState('all');
	const [selectedUid, setSelectedUid] = useState(null);
	const [detail, setDetail] = useState(null);
	const [loadError, setLoadError] = useState(null);

	// The Project tab links here with ?project_id=…; read it from the URL
	// without a Suspense boundary (client-only page).
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const projectId = params.get('project_id');
		if (projectId) {
			setProjectFilter(projectId);
			setForm((prev) => ({ ...prev, project_id: projectId }));
		}
	}, []);

	const loadOrders = useCallback(async () => {
		const params = new URLSearchParams({ include_cancelled: '1' });
		if (projectFilter) params.set('project_id', projectFilter);
		const { ok, status, body } = await readJson(
			await fetch(`/api/admin/orders?${params.toString()}`)
		);
		if (!ok) {
			setLoadError(
				status === 403
					? 'You do not have permission to view orders.'
					: body?.message || 'Failed to load orders.'
			);
			return;
		}
		setLoadError(null);
		setList(body.data);
	}, [projectFilter]);

	const loadQueue = useCallback(async () => {
		const { ok, status, body } = await readJson(
			await fetch('/api/admin/orders/review')
		);
		if (!ok) {
			setLoadError(
				status === 403
					? 'You do not have permission to review orders.'
					: body?.message || 'Failed to load the review queue.'
			);
			return;
		}
		setQueue(body.data);
	}, []);

	const loadProjects = useCallback(async () => {
		const { ok, body } = await readJson(await fetch('/api/projects'));
		if (ok && Array.isArray(body.data)) setProjects(body.data);
	}, []);

	const refresh = useCallback(async () => {
		await Promise.all([loadOrders(), loadQueue()]);
	}, [loadOrders, loadQueue]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useEffect(() => {
		loadProjects();
	}, [loadProjects]);

	useEffect(() => {
		if (!selectedUid) {
			setDetail(null);
			return;
		}
		let cancelled = false;
		(async () => {
			const { ok, body } = await readJson(
				await fetch(`/api/admin/orders/${encodeURIComponent(selectedUid)}`)
			);
			if (!cancelled) setDetail(ok ? body.data : null);
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedUid]);

	const visibleOrders = useMemo(() => {
		const orders = list?.orders ?? [];
		if (directionFilter === 'all') return orders;
		return orders.filter((order) => order.direction === directionFilter);
	}, [list, directionFilter]);

	const totalsFor = (direction) =>
		(list?.totals ?? []).filter((row) => row.direction === direction);

	const change = (event) => {
		const { name, value } = event.target;
		setForm((prev) => ({ ...prev, [name]: value }));
	};

	const submit = async (event) => {
		event.preventDefault();
		setSubmitting(true);
		setFormError(null);
		setFormSuccess(null);
		try {
			const payload = {
				direction: form.direction,
				order_number: form.order_number,
				counterparty_name: form.counterparty_name,
				project_id: form.project_id || null,
				currency: form.currency,
				amount_basis: form.amount_basis,
				order_date: form.order_date || null,
				status: form.status,
				firmness: form.firmness,
				firmness_evidence_reference: form.firmness_evidence_reference || null,
				source_document_reference: form.source_document_reference || null,
				remarks: form.remarks || null,
			};
			if (form.amount_basis !== 'unknown') {
				payload.gross_amount =
					form.gross_amount === '' ? null : form.gross_amount;
				payload.tax_amount = form.tax_amount === '' ? null : form.tax_amount;
				payload.net_amount = form.net_amount === '' ? null : form.net_amount;
			}
			const { ok, body } = await readJson(
				await fetch('/api/admin/orders', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
			);
			if (!ok) {
				setFormError(body?.message || 'Failed to create the order.');
				return;
			}
			setFormSuccess(
				`${body.data.direction === 'client' ? 'Client' : 'Supplier'} order ${body.data.orderNumber} recorded.`
			);
			setForm((prev) => ({
				...EMPTY_FORM,
				project_id: prev.project_id,
				currency: prev.currency,
			}));
			await refresh();
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div
			className="mx-auto max-w-[1400px] space-y-6 px-4 py-6"
			data-testid="orders-page"
		>
			<header className="space-y-1">
				<h1 className="text-xl font-bold text-gray-900">Orders</h1>
				<p className="text-sm text-gray-600">
					Client and supplier orders with an explicit direction. Client order
					value is commercial context only; a supplier order value is a
					commitment, never incurred cost.
				</p>
				{projectFilter && (
					<p
						className="text-sm text-gray-500"
						data-testid="orders-project-filter"
					>
						Filtered to one Project.{' '}
						<a className="text-purple-700 underline" href="/admin/orders">
							Show all orders
						</a>
					</p>
				)}
				{loadError && (
					<p className="text-sm text-red-600" role="alert">
						{loadError}
					</p>
				)}
			</header>

			<section className="grid gap-4 lg:grid-cols-2">
				<div
					className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
					data-testid="client-order-total"
				>
					<h2 className="text-sm font-semibold text-gray-900">
						Client order value (commercial context)
					</h2>
					<p className="text-xs text-gray-500">
						Never incurred cost, supplier commitment, or recognized revenue.
					</p>
					<div className="mt-2 space-y-1">
						{totalsFor('client').map((row) => (
							<div
								key={`${row.currency}-${row.basis}`}
								data-testid="client-order-total-row"
								data-currency={row.currency}
								data-basis={row.basis}
								data-amount={row.orderValue}
								className="flex items-center justify-between text-sm text-gray-800"
							>
								<span>
									{row.currency} ·{' '}
									{row.basis === 'gross' ? 'including tax' : 'net of tax'} ·{' '}
									{row.orderCount} order{row.orderCount === 1 ? '' : 's'}
								</span>
								<span className="font-semibold">{money(row.orderValue)}</span>
							</div>
						))}
						{totalsFor('client').length === 0 && (
							<p className="text-sm text-gray-500">
								No supported client value yet.
							</p>
						)}
						<p
							data-testid="client-order-unknown"
							data-count={
								(list?.orders ?? []).filter(
									(order) =>
										order.direction === 'client' &&
										order.amountBasis === 'unknown'
								).length
							}
							className="text-xs text-amber-700"
						>
							{
								(list?.orders ?? []).filter(
									(order) =>
										order.direction === 'client' &&
										order.amountBasis === 'unknown'
								).length
							}{' '}
							client order(s) without a supported value
						</p>
					</div>
				</div>

				<div
					className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
					data-testid="supplier-order-total"
				>
					<h2 className="text-sm font-semibold text-gray-900">
						Supplier order value
					</h2>
					<p
						className="text-xs text-gray-500"
						data-testid="supplier-commitment-note"
					>
						Ordered value, not incurred cost; remaining commitment needs
						recognized consumption linked to the order.
					</p>
					<div className="mt-2 space-y-1">
						{totalsFor('supplier').map((row) => (
							<div
								key={`${row.currency}-${row.basis}`}
								data-testid="supplier-order-total-row"
								data-currency={row.currency}
								data-basis={row.basis}
								data-amount={row.orderValue}
								className="flex items-center justify-between text-sm text-gray-800"
							>
								<span>
									{row.currency} ·{' '}
									{row.basis === 'gross' ? 'including tax' : 'net of tax'} ·{' '}
									{row.orderCount} order{row.orderCount === 1 ? '' : 's'}
								</span>
								<span className="font-semibold">{money(row.orderValue)}</span>
							</div>
						))}
						{totalsFor('supplier').length === 0 && (
							<p className="text-sm text-gray-500">
								No supported supplier value yet.
							</p>
						)}
						<p
							data-testid="supplier-order-unknown"
							data-count={
								(list?.orders ?? []).filter(
									(order) =>
										order.direction === 'supplier' &&
										order.amountBasis === 'unknown'
								).length
							}
							className="text-xs text-amber-700"
						>
							{
								(list?.orders ?? []).filter(
									(order) =>
										order.direction === 'supplier' &&
										order.amountBasis === 'unknown'
								).length
							}{' '}
							supplier order(s) without a supported value
						</p>
					</div>
				</div>
			</section>

			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<h2 className="text-sm font-semibold text-gray-900">Record an order</h2>
				<form className="mt-3 grid gap-3 md:grid-cols-3" onSubmit={submit}>
					<label className="text-sm text-gray-700">
						Direction
						<select
							name="direction"
							data-testid="order-direction"
							value={form.direction}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						>
							{DIRECTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm text-gray-700">
						Order number
						<input
							name="order_number"
							data-testid="order-number"
							value={form.order_number}
							onChange={change}
							required
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						/>
					</label>
					<label className="text-sm text-gray-700">
						Counterparty
						<input
							name="counterparty_name"
							data-testid="order-counterparty"
							value={form.counterparty_name}
							onChange={change}
							required
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						/>
					</label>
					<label className="text-sm text-gray-700">
						Project
						<select
							name="project_id"
							data-testid="order-project"
							value={form.project_id}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						>
							<option value="">No Project</option>
							{projects.map((project) => (
								<option key={project.project_id} value={project.project_id}>
									{project.project_code} —{' '}
									{project.project_title || project.name || ''}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm text-gray-700">
						Currency
						<select
							name="currency"
							data-testid="order-currency"
							value={form.currency}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						>
							<option value="INR">INR</option>
							<option value="USD">USD</option>
							<option value="EUR">EUR</option>
						</select>
					</label>
					<label className="text-sm text-gray-700">
						Tax/amount basis
						<select
							name="amount_basis"
							data-testid="order-basis"
							value={form.amount_basis}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						>
							{BASES.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					{form.amount_basis !== 'unknown' && (
						<>
							<label className="text-sm text-gray-700">
								Gross amount (including tax)
								<input
									name="gross_amount"
									data-testid="order-gross"
									value={form.gross_amount}
									onChange={change}
									inputMode="decimal"
									className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
								/>
							</label>
							<label className="text-sm text-gray-700">
								Tax amount
								<input
									name="tax_amount"
									data-testid="order-tax"
									value={form.tax_amount}
									onChange={change}
									inputMode="decimal"
									className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
								/>
							</label>
							<label className="text-sm text-gray-700">
								Net amount (excluding tax)
								<input
									name="net_amount"
									data-testid="order-net"
									value={form.net_amount}
									onChange={change}
									inputMode="decimal"
									className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
								/>
							</label>
						</>
					)}
					<label className="text-sm text-gray-700">
						Order date
						<input
							type="date"
							name="order_date"
							data-testid="order-date"
							value={form.order_date}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						/>
					</label>
					<label className="text-sm text-gray-700">
						Status
						<select
							name="status"
							data-testid="order-status"
							value={form.status}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						>
							{STATUSES.map((status) => (
								<option key={status} value={status}>
									{status}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm text-gray-700">
						Firm or cancellable
						<select
							name="firmness"
							data-testid="order-firmness"
							value={form.firmness}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						>
							{FIRMNESS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<label className="text-sm text-gray-700">
						Firmness evidence reference
						<input
							name="firmness_evidence_reference"
							data-testid="order-firmness-evidence"
							value={form.firmness_evidence_reference}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						/>
					</label>
					<label className="text-sm text-gray-700">
						Source document reference
						<input
							name="source_document_reference"
							data-testid="order-source-document"
							value={form.source_document_reference}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						/>
					</label>
					<label className="text-sm text-gray-700 md:col-span-2">
						Remarks
						<input
							name="remarks"
							data-testid="order-remarks"
							value={form.remarks}
							onChange={change}
							className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2"
						/>
					</label>
					<div className="flex items-end gap-3">
						<button
							type="submit"
							data-testid="order-create-submit"
							disabled={submitting}
							className="rounded-lg bg-purple-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
						>
							Record order
						</button>
					</div>
				</form>
				{formError && (
					<p
						data-testid="order-form-error"
						role="alert"
						className="mt-2 text-sm text-red-600"
					>
						{formError}
					</p>
				)}
				{formSuccess && (
					<p
						data-testid="order-form-success"
						role="status"
						className="mt-2 text-sm text-green-700"
					>
						{formSuccess}
					</p>
				)}
			</section>

			<section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
				<div className="flex items-center justify-between">
					<h2 className="text-sm font-semibold text-gray-900">Orders</h2>
					<select
						data-testid="orders-direction-filter"
						value={directionFilter}
						onChange={(event) => setDirectionFilter(event.target.value)}
						className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
					>
						<option value="all">All directions</option>
						<option value="client">Client orders</option>
						<option value="supplier">Supplier orders</option>
					</select>
				</div>
				<div className="mt-3 overflow-x-auto">
					<table className="min-w-full text-sm">
						<thead>
							<tr className="text-left text-xs uppercase text-gray-500">
								<th className="px-2 py-2">Number</th>
								<th className="px-2 py-2">Direction</th>
								<th className="px-2 py-2">Counterparty</th>
								<th className="px-2 py-2">Project</th>
								<th className="px-2 py-2">Value</th>
								<th className="px-2 py-2">Status</th>
								<th className="px-2 py-2">Firmness</th>
								<th className="px-2 py-2" />
							</tr>
						</thead>
						<tbody>
							{visibleOrders.map((order) => (
								<tr
									key={order.orderUid}
									data-testid="order-row"
									data-order-uid={order.orderUid}
									data-order-number={order.orderNumber}
									data-direction={order.direction}
									className="border-t border-gray-100"
								>
									<td className="px-2 py-2" data-testid="order-row-number">
										{order.orderNumber}
									</td>
									<td className="px-2 py-2">{order.direction}</td>
									<td className="px-2 py-2">{order.counterpartyName}</td>
									<td className="px-2 py-2">{order.projectCode || '—'}</td>
									<td
										className="px-2 py-2"
										data-testid="order-row-value"
										data-amount={
											order.amountBasis === 'gross'
												? order.grossAmount
												: order.amountBasis === 'net'
													? order.netAmount
													: ''
										}
										data-currency={order.currency}
										data-basis={order.amountBasis}
									>
										{order.amountBasis === 'unknown'
											? `Unknown (${order.currency})`
											: `${order.currency} ${money(
													order.amountBasis === 'gross'
														? order.grossAmount
														: order.netAmount
												)}`}
									</td>
									<td className="px-2 py-2">{order.status}</td>
									<td className="px-2 py-2">
										{order.firmness}
										{order.firmnessEvidenceReference
											? ` (${order.firmnessEvidenceReference})`
											: ''}
									</td>
									<td className="px-2 py-2">
										<button
											type="button"
											data-testid="order-row-open"
											onClick={() => setSelectedUid(order.orderUid)}
											className="rounded border border-gray-300 px-2 py-1 text-xs"
										>
											Open
										</button>
									</td>
								</tr>
							))}
							{visibleOrders.length === 0 && (
								<tr>
									<td className="px-2 py-3 text-gray-500" colSpan={8}>
										No orders recorded.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>

				{selectedUid && (
					<div
						data-testid="order-detail"
						className="mt-4 rounded-lg border border-purple-100 bg-purple-25/20 p-4"
					>
						{detail ? (
							<div className="space-y-3">
								<div className="grid gap-2 text-sm md:grid-cols-3">
									<p>
										<span className="font-semibold">Number:</span>{' '}
										{detail.order.orderNumber}
									</p>
									<p>
										<span className="font-semibold">Direction:</span>{' '}
										{detail.order.direction}
									</p>
									<p>
										<span className="font-semibold">Counterparty:</span>{' '}
										{detail.order.counterpartyName}
									</p>
									<p>
										<span className="font-semibold">Currency:</span>{' '}
										{detail.order.currency} ({detail.order.amountBasis})
									</p>
									<p>
										<span className="font-semibold">Order date:</span>{' '}
										{detail.order.orderDate || '—'}
									</p>
									<p>
										<span className="font-semibold">Source document:</span>{' '}
										{detail.order.sourceDocumentReference || '—'}
									</p>
									{detail.order.direction === 'client' && (
										<>
											<p>
												<span className="font-semibold">Invoiced:</span>{' '}
												{money(detail.order.clientInvoicedValue)}
											</p>
											<p>
												<span className="font-semibold">Remaining:</span>{' '}
												{money(detail.order.clientRemainingValue)}
											</p>
										</>
									)}
								</div>
								<div>
									<h3 className="text-xs font-semibold uppercase text-gray-500">
										Journal
									</h3>
									<ul className="mt-1 space-y-1 text-xs text-gray-700">
										{(detail.events ?? []).map((event, index) => (
											<li key={index} data-testid="order-event">
												{event.event}
												{event.version ? ` v${event.version}` : ''}
												{event.amount !== null
													? ` · ${money(event.amount)}`
													: ''}
												{event.reference ? ` · ${event.reference}` : ''}
											</li>
										))}
									</ul>
								</div>
								<div data-testid="order-document-upload">
									<h3 className="text-xs font-semibold uppercase text-gray-500">
										Source documents
									</h3>
									<DocumentUpload
										entityType="order"
										entityId={detail.order.id}
									/>
								</div>
							</div>
						) : (
							<p className="text-sm text-gray-500">Loading order…</p>
						)}
					</div>
				)}
			</section>

			<section
				data-testid="review-queue"
				className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
			>
				<h2 className="text-sm font-semibold text-gray-900">
					Legacy order review
				</h2>
				<p className="text-xs text-gray-500">
					Pre-canonical copies stay unclassified until a document-backed
					decision. A shared document number is a collision candidate, not proof
					that two copies are the same order.
				</p>
				<div className="mt-3 space-y-4">
					{(queue?.items ?? []).map((item) => (
						<ReviewRow
							key={item.mappingId}
							item={item}
							canonicalOrders={queue?.canonicalOrders ?? []}
							resolvedMappings={queue?.resolvedMappings ?? []}
							onResolved={refresh}
						/>
					))}
					{(queue?.items ?? []).length === 0 && (
						<p className="text-sm text-gray-500">No legacy copies queued.</p>
					)}
				</div>
			</section>
		</div>
	);
}

function ReviewRow({ item, canonicalOrders, resolvedMappings, onResolved }) {
	const [decision, setDecision] = useState('classify');
	const [fields, setFields] = useState({
		direction: item.resolvedDirection || 'supplier',
		counterparty_name: item.counterpartyName || '',
		currency: 'INR',
		amount_basis: 'net',
		gross_amount: '',
		tax_amount: '',
		net_amount: '',
		reason: '',
		evidence_reference: '',
		link_target: '',
		duplicate_target: '',
	});
	const [error, setError] = useState(null);
	const [busy, setBusy] = useState(false);

	const change = (event) => {
		const { name, value } = event.target;
		setFields((prev) => ({ ...prev, [name]: value }));
	};

	const submit = async () => {
		setBusy(true);
		setError(null);
		try {
			const payload = {
				mapping_id: item.mappingId,
				decision,
				expected_version: item.version,
				reason: fields.reason,
				evidence_reference: fields.evidence_reference || null,
			};
			if (decision === 'classify') {
				Object.assign(payload, {
					direction: fields.direction,
					counterparty_name: fields.counterparty_name,
					currency: fields.currency,
					amount_basis: fields.amount_basis,
					gross_amount:
						fields.amount_basis === 'unknown' || fields.gross_amount === ''
							? null
							: fields.gross_amount,
					tax_amount:
						fields.amount_basis === 'unknown' || fields.tax_amount === ''
							? null
							: fields.tax_amount,
					net_amount:
						fields.amount_basis === 'unknown' || fields.net_amount === ''
							? null
							: fields.net_amount,
					project_id: item.projectId,
				});
			} else if (decision === 'link') {
				payload.canonical_order_uid = fields.link_target;
			} else if (decision === 'duplicate') {
				payload.duplicate_of_mapping_id = fields.duplicate_target
					? Number(fields.duplicate_target)
					: null;
			}
			const { ok, body } = await readJson(
				await fetch('/api/admin/orders/review', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload),
				})
			);
			if (!ok) {
				setError(body?.message || 'The decision was refused.');
				return;
			}
			await onResolved();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			data-testid="review-row"
			data-mapping-id={item.mappingId}
			className="rounded-lg border border-gray-200 p-3"
		>
			<div className="flex flex-wrap items-center gap-3 text-sm">
				<span className="font-semibold" data-testid="review-store">
					{STORE_LABELS[item.legacyStore] || item.legacyStore}
				</span>
				<span className="text-gray-600" data-testid="review-document">
					{item.documentNumber || '(no number)'}
				</span>
				<span className="text-gray-500">#{item.legacyId}</span>
				<span className="text-gray-700">{item.counterpartyName || '—'}</span>
				<span className="text-gray-700">{money(item.legacyAmount)}</span>
				<span
					data-testid="review-state"
					className={`rounded px-2 py-0.5 text-xs font-medium ${
						item.reviewState === 'pending'
							? 'bg-amber-100 text-amber-800'
							: 'bg-green-100 text-green-800'
					}`}
				>
					{item.reviewState}
				</span>
				<span className="text-xs text-gray-500" data-testid="review-collisions">
					{item.collisions.length} collision candidate
					{item.collisions.length === 1 ? '' : 's'}
					{item.collisions.length > 0
						? `: ${item.collisions
								.map(
									(collision) =>
										`${STORE_LABELS[collision.legacyStore] || collision.legacyStore}#${collision.legacyId}`
								)
								.join(', ')}`
						: ''}
				</span>
			</div>

			{item.reason && (
				<p className="mt-2 text-xs text-gray-600">
					Decision: {item.reviewState}
					{item.resolvedDirection ? ` · ${item.resolvedDirection}` : ''} ·{' '}
					{item.reason} ({item.evidenceReference || 'no evidence'})
				</p>
			)}

			{item.reviewState !== 'resolved' && item.reviewState !== 'duplicate' && (
				<div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
					<label className="text-xs text-gray-600">
						Decision
						<select
							data-testid="review-decision"
							value={decision}
							onChange={(event) => setDecision(event.target.value)}
							className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
						>
							<option value="classify">Classify direction</option>
							<option value="link">Link to existing order</option>
							<option value="duplicate">Duplicate representation</option>
							<option value="insufficient">Needs more evidence</option>
						</select>
					</label>
					{decision === 'classify' && (
						<>
							<label className="text-xs text-gray-600">
								Direction
								<select
									name="direction"
									data-testid="review-direction"
									value={fields.direction}
									onChange={change}
									className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
								>
									<option value="client">Client</option>
									<option value="supplier">Supplier</option>
								</select>
							</label>
							<label className="text-xs text-gray-600">
								Counterparty
								<input
									name="counterparty_name"
									data-testid="review-counterparty"
									value={fields.counterparty_name}
									onChange={change}
									className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
								/>
							</label>
							<label className="text-xs text-gray-600">
								Currency
								<select
									name="currency"
									data-testid="review-currency"
									value={fields.currency}
									onChange={change}
									className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
								>
									<option value="INR">INR</option>
									<option value="USD">USD</option>
									<option value="EUR">EUR</option>
								</select>
							</label>
							<label className="text-xs text-gray-600">
								Basis
								<select
									name="amount_basis"
									data-testid="review-basis"
									value={fields.amount_basis}
									onChange={change}
									className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
								>
									<option value="net">Net of tax</option>
									<option value="gross">Including tax</option>
									<option value="unknown">Unknown</option>
								</select>
							</label>
							<label className="text-xs text-gray-600">
								Gross
								<input
									name="gross_amount"
									data-testid="review-gross"
									value={fields.gross_amount}
									onChange={change}
									className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
								/>
							</label>
							<label className="text-xs text-gray-600">
								Tax
								<input
									name="tax_amount"
									data-testid="review-tax"
									value={fields.tax_amount}
									onChange={change}
									className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
								/>
							</label>
							<label className="text-xs text-gray-600">
								Net
								<input
									name="net_amount"
									data-testid="review-net"
									value={fields.net_amount}
									onChange={change}
									className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
								/>
							</label>
						</>
					)}
					{decision === 'link' && (
						<label className="text-xs text-gray-600">
							Existing order
							<select
								name="link_target"
								data-testid="review-link-target"
								value={fields.link_target}
								onChange={change}
								className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
							>
								<option value="">Select an order…</option>
								{canonicalOrders.map((order) => (
									<option key={order.orderUid} value={order.orderUid}>
										{order.orderNumber} · {order.direction} ·{' '}
										{order.counterpartyName}
									</option>
								))}
							</select>
						</label>
					)}
					{decision === 'duplicate' && (
						<label className="text-xs text-gray-600">
							Duplicate of copy
							<select
								name="duplicate_target"
								data-testid="review-duplicate-target"
								value={fields.duplicate_target}
								onChange={change}
								className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
							>
								<option value="">Select a reviewed copy…</option>
								{resolvedMappings.map((mapping) => (
									<option key={mapping.mappingId} value={mapping.mappingId}>
										{mapping.documentNumber || '(no number)'} ·{' '}
										{STORE_LABELS[mapping.legacyStore] || mapping.legacyStore}#
										{mapping.legacyId}
									</option>
								))}
							</select>
						</label>
					)}
					<label className="text-xs text-gray-600 md:col-span-2">
						Reason
						<input
							name="reason"
							data-testid="review-reason"
							value={fields.reason}
							onChange={change}
							className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
						/>
					</label>
					<label className="text-xs text-gray-600">
						Evidence reference
						<input
							name="evidence_reference"
							data-testid="review-evidence"
							value={fields.evidence_reference}
							onChange={change}
							className="mt-1 block w-full rounded border border-gray-300 px-2 py-1"
						/>
					</label>
					<div className="flex items-end">
						<button
							type="button"
							data-testid="review-submit"
							onClick={submit}
							disabled={busy}
							className="rounded bg-purple-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
						>
							Record decision
						</button>
					</div>
				</div>
			)}
			{error && (
				<p
					data-testid="review-error"
					role="alert"
					className="mt-2 text-xs text-red-600"
				>
					{error}
				</p>
			)}
		</div>
	);
}
