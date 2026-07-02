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
	ChevronLeftIcon,
	ChevronRightIcon,
	PlusIcon,
	PencilIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';

export default function InvoicePage() {
	const router = useRouter();
	const { user, loading: authLoading } = useSessionRBAC();

	const [invoices, setInvoices] = useState([]);
	const [loading, setLoading] = useState(true);
	const [pagination, setPagination] = useState({
		page: 1,
		limit: 20,
		total: 0,
		totalPages: 0,
	});

	// Filters
	const [searchTerm, setSearchTerm] = useState('');

	// Fetch invoices
	const fetchInvoices = useCallback(
		async (page = 1, search = '') => {
			setLoading(true);
			try {
				const params = new URLSearchParams({
					page: page.toString(),
					limit: pagination.limit.toString(),
				});
				if (search) params.set('search', search);

				const res = await fetch(`/api/admin/invoices?${params}`);
				const data = await res.json();

				if (data.success) {
					setInvoices(data.data || []);
					setPagination(
						data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 }
					);
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
		},
		[pagination.limit]
	);

	useEffect(() => {
		if (!authLoading && user) {
			setPagination((prev) => ({ ...prev, page: 1 }));
			fetchInvoices(1, searchTerm);
		}
	}, [searchTerm, authLoading, user, fetchInvoices]);

	// Compute days overdue from due_date. Returns null if no due_date.
	const getDaysOverdue = (dueDate) => {
		if (!dueDate) return null;
		const due = new Date(dueDate);
		if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
			const today = new Date();
			const todayUtc = Date.UTC(
				today.getFullYear(),
				today.getMonth(),
				today.getDate()
			);
			const dueUtc = Date.UTC(
				due.getUTCFullYear(),
				due.getUTCMonth(),
				due.getUTCDate()
			);
			return Math.floor((todayUtc - dueUtc) / 86400000);
		}
		const today = new Date();
		return Math.floor((today - due) / 86400000);
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
				fetchInvoices(pagination.page, searchTerm);
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

			<main className="flex-1 min-h-0 flex flex-col px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 max-w-[1800px] w-full mx-auto">
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
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

				{/* Filters */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
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
							onClick={() => fetchInvoices(pagination.page, searchTerm)}
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
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Invoice #
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Client
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Description
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Amount
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Issue Date
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Due Date
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Days Overdue
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
											<td className="px-6 py-4 text-gray-600 max-w-[200px] truncate">
												{invoice.description}
											</td>
											<td className="px-6 py-4 font-semibold text-gray-900">
												{formatCurrency(invoice.total)}
											</td>
											<td className="px-6 py-4 text-gray-600">
												{formatDate(invoice.invoice_date || invoice.created_at)}
											</td>
											<td className="px-6 py-4 text-gray-600">
												{formatDate(invoice.due_date)}
											</td>
											<td className="px-6 py-4">
												{(() => {
													const days = getDaysOverdue(invoice.due_date);
													if (days == null || days <= 0)
														return <span className="text-gray-400">—</span>;
													return (
														<span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-700">
															{days} {days === 1 ? 'day' : 'days'} overdue
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

					{/* Pagination */}
					{pagination.totalPages > 1 && (
						<div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
							<span className="text-sm text-gray-600">
								Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
								{Math.min(pagination.page * pagination.limit, pagination.total)}{' '}
								of {pagination.total}
							</span>
							<div className="flex items-center gap-2">
								<button
									onClick={() => fetchInvoices(pagination.page - 1, searchTerm)}
									disabled={pagination.page === 1}
									className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
								>
									<ChevronLeftIcon className="h-4 w-4" />
								</button>
								<span className="px-3 py-1 text-sm">
									{pagination.page} / {pagination.totalPages}
								</span>
								<button
									onClick={() => fetchInvoices(pagination.page + 1, searchTerm)}
									disabled={pagination.page === pagination.totalPages}
									className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
								>
									<ChevronRightIcon className="h-4 w-4" />
								</button>
							</div>
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
