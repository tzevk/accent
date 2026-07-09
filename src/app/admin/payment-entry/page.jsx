'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
	BanknotesIcon,
	MagnifyingGlassIcon,
	ArrowPathIcon,
	EyeIcon,
	PencilSquareIcon,
	TrashIcon,
	PlusIcon,
	XMarkIcon,
	PrinterIcon,
} from '@heroicons/react/24/outline';

const getTodayDateString = () => {
	const d = new Date();
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
};

export default function PaymentEntryPage() {
	const { user, loading: authLoading } = useSessionRBAC();

	const [entries, setEntries] = useState([]);
	const [loading, setLoading] = useState(true);
	const [pagination, setPagination] = useState({
		page: 1,
		limit: 20,
		total: 0,
		totalPages: 0,
	});
	const [searchTerm, setSearchTerm] = useState('');
	const [companies, setCompanies] = useState([]);
	const [banks, setBanks] = useState([]);
	const [invoices, setInvoices] = useState([]);

	// Modal state
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [isViewing, setIsViewing] = useState(false);
	const [editingEntry, setEditingEntry] = useState(null);
	const [formData, setFormData] = useState({
		company_name: '',
		city: '',
		receipt_no: '',
		receipt_date: getTodayDateString(),
		amount: '',
		payment_date: '',
		transaction_id: '',
		bank_name: '',
		remark: '',
		invoice_no: '',
		invoice_date: '',
	});
	const [saving, setSaving] = useState(false);
	const [printingId, setPrintingId] = useState(null);

	// Fetch entries
	const fetchEntries = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams({
					page: page.toString(),
					limit: pagination.limit.toString(),
				});

				const res = await fetch(`/api/admin/payment-entries?${params}`);
				const data = await res.json();

				if (data.success) {
					setEntries(data.data || []);
					setPagination(
						data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 }
					);
				} else {
					setEntries([]);
				}
			} catch (error) {
				console.error('Error fetching payment entries:', error);
				setEntries([]);
			} finally {
				setLoading(false);
			}
		},
		[pagination.limit]
	);

	const fetchCompanies = useCallback(async () => {
		try {
			const res = await fetch('/api/companies');
			const data = await res.json();
			if (data.success) {
				setCompanies(data.data || []);
			}
		} catch (error) {
			console.error('Error fetching companies:', error);
		}
	}, []);

	const fetchBanks = useCallback(async () => {
		try {
			const res = await fetch('/api/masters/banks?active=true');
			const data = await res.json();
			if (data.success) {
				setBanks(data.data || []);
			}
		} catch (error) {
			console.error('Error fetching banks:', error);
		}
	}, []);

	const fetchInvoices = useCallback(async () => {
		try {
			const res = await fetch('/api/admin/invoices?limit=500');
			const data = await res.json();
			if (data.success) {
				setInvoices(data.data || []);
			}
		} catch (error) {
			console.error('Error fetching invoices:', error);
		}
	}, []);

	useEffect(() => {
		if (!authLoading && user) {
			fetchEntries(1);
			fetchCompanies();
			fetchBanks();
			fetchInvoices();
		}
	}, [
		authLoading,
		user,
		fetchEntries,
		fetchCompanies,
		fetchBanks,
		fetchInvoices,
	]);

	// Filter entries
	const filteredEntries = entries.filter((e) => {
		if (!searchTerm) return true;
		const search = searchTerm.toLowerCase();
		return (
			e.company_name?.toLowerCase().includes(search) ||
			e.receipt_no?.toLowerCase().includes(search) ||
			e.transaction_id?.toLowerCase().includes(search)
		);
	});

	const formatDateForInput = (dateString) => {
		if (!dateString) return '';
		const d = new Date(dateString);
		if (isNaN(d.getTime())) return '';
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	};

	const handleOpenModal = (entry = null, viewOnly = false) => {
		setIsViewing(viewOnly);
		if (entry) {
			setEditingEntry(entry);
			setFormData({
				company_name: entry.company_name || '',
				city: entry.city || '',
				receipt_no: entry.receipt_no || '',
				receipt_date: formatDateForInput(entry.receipt_date),
				amount: entry.amount || '',
				payment_date: formatDateForInput(entry.payment_date),
				transaction_id: entry.transaction_id || '',
				bank_name: entry.bank_name || '',
				remark: entry.remark || '',
				invoice_no: entry.invoice_no || '',
				invoice_date: formatDateForInput(entry.invoice_date),
			});
		} else {
			setEditingEntry(null);
			setFormData({
				company_name: '',
				city: '',
				receipt_no: '',
				receipt_date: getTodayDateString(),
				amount: '',
				payment_date: '',
				transaction_id: '',
				bank_name: '',
				remark: '',
				invoice_no: '',
				invoice_date: '',
			});
		}
		setIsModalOpen(true);
	};

	const handleCloseModal = () => {
		setIsModalOpen(false);
		setEditingEntry(null);
	};

	const handleChange = (e) => {
		const { name, value } = e.target;
		setFormData((prev) => {
			const newData = { ...prev, [name]: value };
			if (name === 'company_name') {
				const selectedCompany = companies.find((c) => c.company_name === value);
				if (selectedCompany && selectedCompany.city && !prev.city) {
					newData.city = selectedCompany.city;
				}
			}
			if (name === 'invoice_no') {
				const matched = invoices.find(
					(inv) => (inv.invoice_number || '') === value
				);
				if (matched) {
					const d = matched.invoice_date
						? new Date(matched.invoice_date)
						: null;
					const formatted =
						d && !isNaN(d.getTime())
							? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
							: '';
					newData.invoice_date = formatted;
				}
			}
			return newData;
		});
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		setSaving(true);
		try {
			const url = '/api/admin/payment-entries';
			const method = editingEntry ? 'PUT' : 'POST';
			const body = editingEntry
				? { ...formData, id: editingEntry.id }
				: formData;

			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			const data = await res.json();

			if (data.success) {
				toast.success('Payment entry saved');
				handleCloseModal();
				fetchEntries(pagination.page);
			} else {
				toast.error(data.error || 'Failed to save payment entry');
			}
		} catch (error) {
			console.error('Error saving payment entry:', error);
			toast.error('An error occurred while saving.');
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id) => {
		if (!confirm('Are you sure you want to delete this payment entry?')) return;
		try {
			const res = await fetch(`/api/admin/payment-entries?id=${id}`, {
				method: 'DELETE',
			});
			const data = await res.json();
			if (data.success) {
				toast.success('Payment entry deleted');
				fetchEntries(pagination.page);
			} else {
				toast.error(data.error || 'Failed to delete payment entry');
			}
		} catch (error) {
			console.error('Error deleting payment entry:', error);
			toast.error('An error occurred while deleting.');
		}
	};

	const handlePrintReceipt = async (entry) => {
		setPrintingId(entry.id || 'modal');
		console.log('Printing receipt for:', entry);

		const payload = {
			receipt_no: entry.receipt_no || '-',
			receipt_date: entry.receipt_date || '-',
			company_name: entry.company_name || '-',
			amount: Number(entry.amount) || 0,
			transaction_id: entry.transaction_id || '-',
			payment_date: entry.payment_date || '-',
			bank_name: entry.bank_name || '-',
			remark: entry.remark || '-',
			invoice_no: entry.invoice_no || '-',
			invoice_date: entry.invoice_date || '-',
		};

		try {
			const res = await fetch('/api/admin/payment-entries/get-receipt-pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});

			if (!res.ok) throw new Error('Failed to generate PDF');

			const blob = await res.blob();
			const url = window.URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Receipt_${entry.receipt_no || 'Draft'}.pdf`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			window.URL.revokeObjectURL(url);
		} catch (error) {
			console.error('PDF Error:', error);
			toast.error('Failed to download receipt.');
		} finally {
			setPrintingId(null);
		}
	};

	if (authLoading) {
		return (
			<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
				<Sidebar />
				<div className="flex-1 flex flex-col">
					<Navbar />
					<div className="flex-1 flex items-center justify-center">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex overflow-hidden">
			<Sidebar />
			<div className="flex-1 flex flex-col min-w-0">
				<Navbar />

				<main className="flex-1 min-h-0 flex flex-col p-6 lg:px-8 xl:px-12 2xl:px-16 max-w-full mx-auto w-full min-w-0">
					{/* Header */}
					<div className="flex items-center justify-between mb-6">
						<div>
							<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
								<BanknotesIcon className="h-7 w-7 text-purple-600" />
								Payment Entry
							</h1>
							<p className="text-sm text-gray-500 mt-1">
								Manage payment entries
							</p>
						</div>
						<button
							onClick={() => handleOpenModal()}
							className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors shadow-sm"
						>
							<PlusIcon className="h-5 w-5" />
							Add Payment Entry
						</button>
					</div>

					{/* Filters */}
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
						<div className="flex flex-wrap items-center gap-4">
							<div className="flex-1 min-w-[200px]">
								<div className="relative">
									<MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
									<input
										type="text"
										placeholder="Search client, project, or transaction..."
										value={searchTerm}
										onChange={(e) => setSearchTerm(e.target.value)}
										className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
									/>
								</div>
							</div>

							<button
								onClick={() => fetchEntries(pagination.page)}
								className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
								title="Refresh"
							>
								<ArrowPathIcon
									className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`}
								/>
							</button>
						</div>
					</div>

					{/* Table */}
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-h-0 flex flex-col overflow-hidden">
						{loading ? (
							<div className="flex items-center justify-center py-12">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
								<span className="ml-3 text-gray-600">Loading entries...</span>
							</div>
						) : filteredEntries.length === 0 ? (
							<div className="text-center py-12">
								<BanknotesIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
								<p className="text-gray-600">No payment entries found</p>
							</div>
						) : (
							<div className="flex-1 min-h-0 overflow-auto">
								<table className="w-full">
									<thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
										<tr>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
												Sr. No
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
												Company Name
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
												Receipt No
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
												Amount
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
												Transaction ID
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
												Bank Name
											</th>
											<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">
												Actions
											</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-200">
										{filteredEntries.map((entry, index) => (
											<tr
												key={entry.id}
												className="hover:bg-gray-50 transition-colors"
											>
												<td className="px-6 py-4 text-gray-600 whitespace-nowrap">
													{(pagination.page - 1) * pagination.limit + index + 1}
												</td>
												<td className="px-6 py-4 whitespace-nowrap">
													<div className="font-medium text-gray-900">
														{entry.company_name}
													</div>
												</td>
												<td className="px-6 py-4 text-gray-600 whitespace-nowrap">
													{entry.receipt_no || '-'}
												</td>
												<td className="px-6 py-4 text-gray-900 font-semibold whitespace-nowrap">
													₹
													{Number(entry.amount || 0).toLocaleString('en-IN', {
														minimumFractionDigits: 2,
														maximumFractionDigits: 2,
													})}
												</td>
												<td className="px-6 py-4 text-gray-900 font-medium whitespace-nowrap">
													{entry.transaction_id || '-'}
												</td>
												<td className="px-6 py-4 text-gray-600 whitespace-nowrap">
													{entry.bank_name || '-'}
												</td>
												<td className="px-6 py-4 whitespace-nowrap">
													<div className="flex items-center justify-center gap-2">
														<button
															onClick={() => handleOpenModal(entry, true)}
															className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
															title="View Entry"
														>
															<EyeIcon className="h-5 w-5" />
														</button>
														<button
															onClick={() => handleOpenModal(entry)}
															className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
															title="Edit Entry"
														>
															<PencilSquareIcon className="h-5 w-5" />
														</button>
														<button
															onClick={() => handleDelete(entry.id)}
															className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
															title="Delete Entry"
														>
															<TrashIcon className="h-5 w-5" />
														</button>
														<button
															onClick={() => handlePrintReceipt(entry)}
															disabled={printingId === entry.id}
															className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50"
															title="Print Receipt"
														>
															{printingId === entry.id ? (
																<ArrowPathIcon className="h-5 w-5 animate-spin" />
															) : (
																<PrinterIcon className="h-5 w-5" />
															)}
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
									{Math.min(
										pagination.page * pagination.limit,
										pagination.total
									)}{' '}
									of {pagination.total}
								</span>
								<div className="flex items-center gap-2">
									<button
										onClick={() => fetchEntries(pagination.page - 1)}
										disabled={pagination.page === 1}
										className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50"
									>
										Previous
									</button>
									<span className="px-3 py-1 text-sm">
										{pagination.page} / {pagination.totalPages}
									</span>
									<button
										onClick={() => fetchEntries(pagination.page + 1)}
										disabled={pagination.page === pagination.totalPages}
										className="px-3 py-1 text-sm border border-gray-300 rounded-md disabled:opacity-50"
									>
										Next
									</button>
								</div>
							</div>
						)}
					</div>
				</main>
			</div>

			{/* Modal */}
			{isModalOpen && (
				<div
					className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto"
					onClick={(e) => {
						if (e.target === e.currentTarget) handleCloseModal();
					}}
				>
					<div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full my-8">
						<div className="px-6 pt-5 pb-4 border-b border-gray-200">
							<div className="flex items-center justify-between">
								<h3 className="text-xl font-semibold text-gray-900">
									{isViewing
										? 'View Payment Entry'
										: editingEntry
											? 'Edit Payment Entry'
											: 'Add Payment Entry'}
								</h3>
								<button
									onClick={handleCloseModal}
									className="p-2 text-gray-400 hover:text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
								>
									<XMarkIcon className="h-6 w-6" />
								</button>
							</div>
						</div>

						<div className="px-6 py-5">
							<form onSubmit={handleSubmit} className="space-y-4">
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Company Name *
										</label>
										<input
											type="text"
											name="company_name"
											list="company-list"
											required
											disabled={isViewing}
											value={formData.company_name}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
											placeholder="Enter or select company name"
										/>
										<datalist id="company-list">
											{companies.map((c) => (
												<option key={c.id} value={c.company_name} />
											))}
										</datalist>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											City
										</label>
										<input
											type="text"
											name="city"
											disabled={isViewing}
											value={formData.city}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
											placeholder="Enter city"
										/>
									</div>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Receipt No
										</label>
										<input
											type="text"
											name="receipt_no"
											disabled={isViewing || !editingEntry}
											value={formData.receipt_no}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
											placeholder={
												!editingEntry
													? 'Auto-generated on save'
													: 'Enter receipt number'
											}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Receipt Date
										</label>
										<input
											type="date"
											name="receipt_date"
											disabled={isViewing}
											value={formData.receipt_date}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
										/>
									</div>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Amount *
										</label>
										<input
											type="number"
											step="0.01"
											name="amount"
											required
											disabled={isViewing}
											value={formData.amount}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
											placeholder="0.00"
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Payment Date
										</label>
										<input
											type="date"
											name="payment_date"
											disabled={isViewing}
											value={formData.payment_date}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
										/>
									</div>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Transaction ID
										</label>
										<input
											type="text"
											name="transaction_id"
											disabled={isViewing}
											value={formData.transaction_id}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
											placeholder="Enter transaction ID"
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Bank Name
										</label>
										<input
											type="text"
											name="bank_name"
											list="bank-list"
											disabled={isViewing}
											value={formData.bank_name}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
											placeholder="Enter or select bank name"
										/>
										<datalist id="bank-list">
											{banks.map((b) => (
												<option key={b.BankID} value={b.BankName} />
											))}
										</datalist>
									</div>
								</div>

								<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Invoice No
										</label>
										<input
											type="text"
											name="invoice_no"
											list="invoice-list"
											disabled={isViewing}
											value={formData.invoice_no}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
											placeholder="Select or enter invoice number"
										/>
										<datalist id="invoice-list">
											{invoices.map((inv) => (
												<option key={inv.id} value={inv.invoice_number || ''}>
													{inv.client_name ? `${inv.client_name} — ` : ''}
													{inv.invoice_date
														? formatDateForInput(inv.invoice_date)
														: ''}
												</option>
											))}
										</datalist>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-700 mb-1">
											Invoice Date
										</label>
										<input
											type="date"
											name="invoice_date"
											disabled={isViewing}
											value={formData.invoice_date}
											onChange={handleChange}
											className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
										/>
									</div>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										Remark
									</label>
									<textarea
										name="remark"
										rows="2"
										disabled={isViewing}
										value={formData.remark}
										onChange={handleChange}
										className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-purple-500 focus:border-purple-500 disabled:bg-gray-100 disabled:text-gray-500"
										placeholder="Enter remark..."
									></textarea>
								</div>

								<div className="mt-5 sm:mt-6 sm:flex sm:flex-row-reverse border-t pt-4">
									{isViewing && (
										<button
											type="button"
											disabled={printingId === 'modal'}
											onClick={() =>
												handlePrintReceipt({ ...formData, id: 'modal' })
											}
											className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
										>
											{printingId === 'modal' ? (
												<ArrowPathIcon className="h-5 w-5 mr-2 animate-spin" />
											) : (
												<PrinterIcon className="h-5 w-5 mr-2" />
											)}
											{printingId === 'modal' ? 'Printing...' : 'Print Receipt'}
										</button>
									)}
									{!isViewing && (
										<button
											type="submit"
											disabled={saving}
											className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-purple-600 text-base font-medium text-white hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
										>
											{saving ? 'Saving...' : 'Save Entry'}
										</button>
									)}
									<button
										type="button"
										onClick={handleCloseModal}
										className="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 sm:mt-0 sm:w-auto sm:text-sm"
									>
										{isViewing ? 'Close' : 'Cancel'}
									</button>
								</div>
							</form>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
