'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
	DocumentCurrencyDollarIcon,
	MagnifyingGlassIcon,
	ArrowPathIcon,
	ArrowDownTrayIcon,
	PlusIcon,
	PencilIcon,
	TrashIcon,
	ExclamationTriangleIcon,
	ClockIcon,
	CheckCircleIcon,
} from '@heroicons/react/24/outline';

export default function InvoicePage() {
	const router = useRouter();
	const { user, loading: authLoading } = useSessionRBAC();

	const [invoices, setInvoices] = useState([]);
	const [loading, setLoading] = useState(true);
	const [stats, setStats] = useState({
		total: 0,
		draft: 0,
		sent: 0,
		paid: 0,
		overdue: 0,
		cancelled: 0,
		totalGross: 0,
		totalTax: 0,
		totalNet: 0,
	});

	// Filters
	const [searchTerm, setSearchTerm] = useState('');

	// Fetch invoices
	const fetchInvoices = useCallback(async (search = '') => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search) params.set('search', search);

			const res = await fetch(`/api/admin/invoices?${params}`);
			const data = await res.json();

			if (data.success) {
				setInvoices(data.data || []);
				if (data.stats) {
					setStats(data.stats);
				}
			} else {
				setInvoices([]);
			}
		} catch (error) {
			console.error('Error fetching invoices:', error);
			setInvoices([]);
			toast.error('Failed to load invoices');
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!authLoading && user) {
			fetchInvoices(searchTerm);
		}
	}, [searchTerm, authLoading, user, fetchInvoices]);

	// Compute overdue info from due_date. Returns structured object.
	const getOverdueInfo = (dueDate) => {
		if (!dueDate) return { state: 'none' };

		// Parse due_date consistently — handle string "YYYY-MM-DD", ISO string, or Date object
		let due;
		if (typeof dueDate === 'string') {
			// For "YYYY-MM-DD" or ISO strings, parse as UTC midnight
			due = new Date(
				dueDate.includes('T') ? dueDate : dueDate + 'T00:00:00.000Z'
			);
		} else if (dueDate instanceof Date) {
			due = dueDate;
		} else {
			return { state: 'none' };
		}

		if (isNaN(due.getTime())) return { state: 'none' };

		// Compare using UTC midnight for both dates to avoid timezone bugs
		const today = new Date();
		const todayUtc = Date.UTC(
			today.getUTCFullYear(),
			today.getUTCMonth(),
			today.getUTCDate()
		);
		const dueUtc = Date.UTC(
			due.getUTCFullYear(),
			due.getUTCMonth(),
			due.getUTCDate()
		);
		const dayDiff = Math.floor((todayUtc - dueUtc) / 86400000);

		if (dayDiff > 0) return { state: 'overdue', days: dayDiff };
		if (dayDiff === 0) return { state: 'today', days: 0 };
		return { state: 'upcoming', days: -dayDiff };
	};

	// Format currency
	const formatCurrency = (amount) => {
		return new Intl.NumberFormat('en-IN', {
			style: 'currency',
			currency: 'INR',
			minimumFractionDigits: 2,
		}).format(amount || 0);
	};

	// Format date
	const formatDate = (dateString) => {
		if (!dateString) return '-';
		const d = new Date(dateString);
		return d.toLocaleDateString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			timeZone:
				typeof dateString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateString)
					? 'UTC'
					: undefined,
		});
	};

	// Handle download - opens printable invoice in new tab
	const handleDownload = (invoice) => {
		window.open(`/api/admin/invoices/download?id=${invoice.id}`, '_blank');
	};

	// Handle edit
	const handleEdit = (invoice) => {
		router.push(`/admin/invoice/edit/${invoice.id}`);
	};

	// Handle delete
	const handleDelete = async (invoice) => {
		if (
			!confirm(
				`Are you sure you want to delete invoice ${invoice.invoice_number}? This action cannot be undone.`
			)
		) {
			return;
		}

		try {
			const res = await fetch(`/api/admin/invoices/${invoice.id}`, {
				method: 'DELETE',
			});
			let data = null;
			try {
				data = await res.json();
			} catch (parseErr) {
				console.error('Non-JSON response from server:', parseErr);
			}

			if (res.ok && data?.success) {
				toast.success('Invoice deleted');
				fetchInvoices(searchTerm);
				return;
			}

			const detail =
				data?.message ||
				(data?.errors && data.errors.map((e) => e.message).join('; ')) ||
				(data?.error ? data.error : null) ||
				`Failed to delete invoice (HTTP ${res.status})`;
			toast.error(detail);
		} catch (error) {
			console.error('Error deleting invoice:', error);
			toast.error(`Failed to delete invoice: ${error.message}`);
		}
	};

	if (authLoading) {
		return (
			<div className="min-h-screen bg-gray-50 flex items-center justify-center">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
			</div>
		);
	}

	return (
		<div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
			<Navbar />

			<main className="flex-1 min-h-0 flex flex-col overflow-hidden px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 max-w-full w-full mx-auto">
				{/* Header */}
				<div className="flex items-center justify-between mb-6 shrink-0">
					<div>
						<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
							<DocumentCurrencyDollarIcon className="h-7 w-7 text-purple-600" />
							Sale Invoices
						</h1>
						<p className="text-sm text-gray-500 mt-1">
							View and download invoices
						</p>
					</div>
					<button
						onClick={() => router.push('/admin/invoice/create')}
						className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium"
					>
						<PlusIcon className="h-5 w-5" />
						Create Invoice
					</button>
				</div>

				{/* Stats Cards */}
				<div className="flex gap-4 mb-6 shrink-0">
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-gray-900">
							{stats.total || 0}
						</div>
						<div className="text-xs text-gray-600">Total</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-gray-600">
							{stats.draft || 0}
						</div>
						<div className="text-xs text-gray-600">Draft</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-blue-600">
							{stats.sent || 0}
						</div>
						<div className="text-xs text-gray-600">Sent</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-green-600">
							{stats.paid || 0}
						</div>
						<div className="text-xs text-gray-600">Paid</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-red-600">
							{stats.overdue || 0}
						</div>
						<div className="text-xs text-gray-600">Overdue</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-gray-500">
							{stats.cancelled || 0}
						</div>
						<div className="text-xs text-gray-600">Cancelled</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-purple-700 truncate">
							{formatCurrency(stats.totalGross || 0)}
						</div>
						<div className="text-xs text-gray-600">Gross Amount</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-orange-600 truncate">
							{formatCurrency(stats.totalTax || 0)}
						</div>
						<div className="text-xs text-gray-600">Tax</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-emerald-700 truncate">
							{formatCurrency(stats.totalNet || 0)}
						</div>
						<div className="text-xs text-gray-600">Net Amount</div>
					</div>
				</div>

				{/* Filters */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6 shrink-0">
					<div className="flex flex-wrap items-center gap-4">
						{/* Search */}
						<div className="flex-1 min-w-[200px]">
							<div className="relative">
								<MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
								<input
									type="text"
									placeholder="Search invoices..."
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
						</div>

						{/* Refresh */}
						<button
							onClick={() => fetchInvoices(searchTerm)}
							className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
							title="Refresh"
						>
							<ArrowPathIcon
								className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`}
							/>
						</button>
					</div>
				</div>

				{/* Invoices Table */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-h-0 flex flex-col overflow-hidden">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
							<span className="ml-3 text-gray-600">Loading invoices...</span>
						</div>
					) : invoices.length === 0 ? (
						<div className="text-center py-12">
							<DocumentCurrencyDollarIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
							<p className="text-gray-600">No invoices found</p>
						</div>
					) : (
						<div className="flex-1 min-h-0 overflow-auto">
							<table className="w-full">
								<thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
									<tr>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Invoice #
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Client
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Gross Amount
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Tax
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Net Amount
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Issue Date
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Due Date
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Days Overdue
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Status
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Download
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-200">
									{invoices.map((invoice) => (
										<tr
											key={invoice.id}
											className="hover:bg-gray-50 transition-colors"
										>
											<td className="px-6 py-4">
												<span className="font-medium text-purple-600">
													{invoice.invoice_number}
												</span>
											</td>
											<td className="px-6 py-4">
												<div className="font-medium text-gray-900">
													{invoice.client_name}
												</div>
												<div className="text-sm text-gray-500">
													{invoice.client_email}
												</div>
											</td>
											<td className="px-6 py-4 text-right font-semibold text-gray-900 tabular-nums">
												{formatCurrency(
													invoice.gross_amount ?? invoice.subtotal ?? 0
												)}
											</td>
											<td className="px-6 py-4 text-right font-semibold text-orange-600 tabular-nums">
												{formatCurrency(invoice.tax_amount ?? 0)}
											</td>
											<td className="px-6 py-4 text-right font-semibold text-gray-900 tabular-nums">
												{formatCurrency(
													invoice.total ?? invoice.net_amount ?? 0
												)}
											</td>
											<td className="px-6 py-4 text-gray-600">
												{formatDate(invoice.invoice_date || invoice.created_at)}
											</td>
											<td className="px-6 py-4 text-gray-600">
												{formatDate(invoice.due_date)}
											</td>
											<td className="px-6 py-4">
												{(() => {
													const info = getOverdueInfo(invoice.due_date);
													if (info.state === 'overdue') {
														return (
															<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
																<ExclamationTriangleIcon className="h-3.5 w-3.5" />
																{info.days}d overdue
															</span>
														);
													}
													if (info.state === 'today') {
														return (
															<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-700">
																<ClockIcon className="h-3.5 w-3.5" />
																Due today
															</span>
														);
													}
													if (info.state === 'upcoming') {
														return (
															<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
																<CheckCircleIcon className="h-3.5 w-3.5" />
																{info.days}d left
															</span>
														);
													}
													return <span className="text-gray-400">—</span>;
												})()}
											</td>
											<td className="px-6 py-4">
												{(() => {
													const statusConfig = {
														draft: {
															label: 'Draft',
															classes: 'bg-gray-100 text-gray-700',
														},
														sent: {
															label: 'Sent',
															classes: 'bg-blue-100 text-blue-700',
														},
														paid: {
															label: 'Paid',
															classes: 'bg-green-100 text-green-700',
														},
														overdue: {
															label: 'Overdue',
															classes: 'bg-red-100 text-red-700',
														},
														cancelled: {
															label: 'Cancelled',
															classes: 'bg-gray-200 text-gray-600',
														},
													};
													const config = statusConfig[invoice.status] || {
														label: invoice.status || '—',
														classes: 'bg-gray-100 text-gray-600',
													};
													return (
														<span
															className={`px-2 py-1 text-xs font-medium rounded-full ${config.classes}`}
														>
															{config.label}
														</span>
													);
												})()}
											</td>
											<td className="px-6 py-4">
												<div className="flex items-center justify-center gap-1">
													<button
														onClick={() => handleEdit(invoice)}
														className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
														title="Edit Invoice"
													>
														<PencilIcon className="h-5 w-5" />
													</button>
													<button
														onClick={() => handleDownload(invoice)}
														className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
														title="Download PDF"
													>
														<ArrowDownTrayIcon className="h-5 w-5" />
													</button>
													<button
														onClick={() => handleDelete(invoice)}
														className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
														title="Delete Invoice"
													>
														<TrashIcon className="h-5 w-5" />
													</button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
