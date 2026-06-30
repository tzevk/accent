'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
	ClipboardDocumentListIcon,
	MagnifyingGlassIcon,
	FunnelIcon,
	ArrowPathIcon,
	ArrowDownTrayIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	PencilSquareIcon,
	TrashIcon,
	PlusIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';

export default function PurchaseOrderPage() {
	const router = useRouter();
	const { user, loading: authLoading } = useSessionRBAC();

	const [purchaseOrders, setPurchaseOrders] = useState([]);
	const [loading, setLoading] = useState(true);
	const [pagination, setPagination] = useState({
		page: 1,
		limit: 20,
		total: 0,
		totalPages: 0,
	});

	// Incoming PO form state
	const [showAddPOForm, setShowAddPOForm] = useState(false);
	const [addingPO, setAddingPO] = useState(false);
	const [incomingPOData, setIncomingPOData] = useState({
		company_id: '',
		company_name: '',
		city: '',
		po_number: '',
		po_date: '',
		po_amount: '',
		tax_amount: '',
		net_amount: '',
		project_id: '',
		project_number: '',
		remarks: '',
	});
	const [companies, setCompanies] = useState([]);
	const [loadingCompanies, setLoadingCompanies] = useState(true);
	const [projects, setProjects] = useState([]);
	const [loadingProjects, setLoadingProjects] = useState(true);

	// Filters
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState('all');

	// Stats
	const [stats, setStats] = useState({
		total: 0,
		draft: 0,
		pending: 0,
		approved: 0,
		completed: 0,
		cancelled: 0,
	});

	// Delete confirmation
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deletingPO, setDeletingPO] = useState(null);
	const [deleteLoading, setDeleteLoading] = useState(false);

	// Fetch purchase orders
	const fetchPurchaseOrders = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams({
					page: page.toString(),
					limit: pagination.limit.toString(),
				});

				if (statusFilter !== 'all') params.append('status', statusFilter);

				const res = await fetch(`/api/admin/purchase-orders?${params}`);
				const data = await res.json();

				if (data.success) {
					setPurchaseOrders(data.data || []);
					setPagination(
						data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 }
					);
					setStats(
						data.stats || {
							total: 0,
							draft: 0,
							pending: 0,
							approved: 0,
							completed: 0,
							cancelled: 0,
						}
					);
				} else {
					setPurchaseOrders([]);
				}
			} catch (error) {
				console.error('Error fetching purchase orders:', error);
				setPurchaseOrders([]);
			} finally {
				setLoading(false);
			}
		},
		[statusFilter, pagination.limit]
	);

	useEffect(() => {
		if (!authLoading && user) {
			fetchPurchaseOrders(1);
		}
	}, [authLoading, user, statusFilter, fetchPurchaseOrders]);

	// Fetch companies on mount
	useEffect(() => {
		const fetchCompanies = async () => {
			try {
				const res = await fetch('/api/companies');
				const data = await res.json();
				if (data.success) {
					setCompanies(data.data || []);
				}
			} catch (error) {
				console.error('Error fetching companies:', error);
			} finally {
				setLoadingCompanies(false);
			}
		};
		if (!authLoading && user) {
			fetchCompanies();
		}
	}, [authLoading, user]);

	// Fetch projects on mount
	useEffect(() => {
		const fetchProjects = async () => {
			try {
				const res = await fetch('/api/projects/list');
				const data = await res.json();
				if (data.success) {
					setProjects(data.data || []);
				}
			} catch (error) {
				console.error('Error fetching projects:', error);
			} finally {
				setLoadingProjects(false);
			}
		};
		if (!authLoading && user) {
			fetchProjects();
		}
	}, [authLoading, user]);

	// Handle company selection
	const handleCompanySelect = (companyId) => {
		const selectedCompany = companies.find(
			(c) => String(c.id) === String(companyId)
		);
		if (selectedCompany) {
			setIncomingPOData((prev) => ({
				...prev,
				company_id: selectedCompany.id,
				company_name: selectedCompany.company_name || '',
				city: selectedCompany.city || '',
			}));
		} else {
			setIncomingPOData((prev) => ({
				...prev,
				company_id: '',
				company_name: '',
				city: '',
			}));
		}
	};

	// Handle incoming PO input change
	const handleIncomingPOChange = (e) => {
		const { name, value } = e.target;
		setIncomingPOData((prev) => {
			const next = { ...prev, [name]: value };
			if (name === 'po_amount' || name === 'tax_amount') {
				const base = parseFloat(next.po_amount) || 0;
				const tax = parseFloat(next.tax_amount) || 0;
				next.net_amount = (base + tax).toFixed(2);
			}
			return next;
		});
	};

	// Add incoming PO
	const handleAddIncomingPO = async () => {
		if (
			!incomingPOData.company_name ||
			!incomingPOData.po_number ||
			!incomingPOData.po_date ||
			!incomingPOData.po_amount
		) {
			alert(
				'Please fill in all required fields (Company Name, PO Number, PO Date, PO Amount)'
			);
			return;
		}

		setAddingPO(true);
		try {
			const res = await fetch('/api/admin/purchase-orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					po_number: incomingPOData.po_number,
					vendor_name: incomingPOData.company_name,
					company_id: incomingPOData.company_id || null,
					project_id: incomingPOData.project_id || null,
					po_date: incomingPOData.po_date,
					po_amount: parseFloat(incomingPOData.po_amount) || 0,
					tax_amount: parseFloat(incomingPOData.tax_amount) || 0,
					net_amount:
						(parseFloat(incomingPOData.po_amount) || 0) +
						(parseFloat(incomingPOData.tax_amount) || 0),
					remarks: incomingPOData.remarks || null,
					status: 'pending',
				}),
			});

			const data = await res.json();

			if (!data.success) {
				alert(data.message || 'Failed to add incoming purchase order');
				return;
			}

			setIncomingPOData({
				company_id: '',
				company_name: '',
				city: '',
				po_number: '',
				po_date: '',
				po_amount: '',
				tax_amount: '',
				net_amount: '',
				project_id: '',
				project_number: '',
				remarks: '',
			});
			setShowAddPOForm(false);

			fetchPurchaseOrders(1);
		} catch (error) {
			console.error('Error adding incoming PO:', error);
			alert('Failed to add incoming purchase order');
		} finally {
			setAddingPO(false);
		}
	};

	// Filter purchase orders by search term
	const filteredPurchaseOrders = purchaseOrders.filter((po) => {
		if (!searchTerm) return true;
		const search = searchTerm.toLowerCase();
		return (
			po.po_number?.toLowerCase().includes(search) ||
			po.vendor_name?.toLowerCase().includes(search) ||
			po.description?.toLowerCase().includes(search)
		);
	});

	// Get status styling
	const getStatusStyle = (status) => {
		switch (status) {
			case 'draft':
				return 'bg-gray-100 text-gray-700';
			case 'pending':
				return 'bg-yellow-100 text-yellow-700';
			case 'approved':
				return 'bg-blue-100 text-blue-700';
			case 'completed':
				return 'bg-green-100 text-green-700';
			case 'cancelled':
				return 'bg-red-100 text-red-700';
			default:
				return 'bg-gray-100 text-gray-700';
		}
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
		return new Date(dateString).toLocaleDateString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
		});
	};

	// Handle download
	const handleDownload = async (purchaseOrder) => {
		try {
			// Open in new window for print/save as PDF
			window.open(
				`/api/admin/purchase-orders/download?id=${purchaseOrder.id}`,
				'_blank'
			);
		} catch (error) {
			console.error('Error downloading purchase order:', error);
			alert('Failed to download purchase order');
		}
	};

	// Handle Edit - Navigate to edit page
	const handleEdit = (po) => {
		router.push(`/admin/purchase-order/edit/${po.id}`);
	};

	// Handle Delete
	const handleDelete = (po) => {
		setDeletingPO(po);
		setShowDeleteConfirm(true);
	};

	// Confirm Delete
	const confirmDelete = async () => {
		if (!deletingPO) return;

		setDeleteLoading(true);
		try {
			const res = await fetch(
				`/api/admin/purchase-orders?id=${deletingPO.id}`,
				{
					method: 'DELETE',
				}
			);

			const data = await res.json();

			if (data.success) {
				alert(data.message || 'Purchase order deleted successfully');
				setShowDeleteConfirm(false);
				setDeletingPO(null);
				fetchPurchaseOrders(pagination.page);
			} else {
				alert(data.message || 'Failed to delete purchase order');
			}
		} catch (error) {
			console.error('Error deleting purchase order:', error);
			alert('Failed to delete purchase order');
		} finally {
			setDeleteLoading(false);
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
							<ClipboardDocumentListIcon className="h-7 w-7 text-purple-600" />
							Purchase Orders
						</h1>
						<p className="text-sm text-gray-500 mt-1">
							View and download purchase orders
						</p>
					</div>
					<button
						onClick={() => setShowAddPOForm(!showAddPOForm)}
						className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
					>
						<PlusIcon className="h-5 w-5" />
						Add Purchase Order
					</button>
				</div>

				{/* Incoming PO Form */}
				{showAddPOForm && (
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-bold text-gray-900">
								Add Incoming Purchase Order
							</h2>
							<button
								onClick={() => setShowAddPOForm(false)}
								className="text-gray-400 hover:text-gray-600"
							>
								<XMarkIcon className="h-5 w-5" />
							</button>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									Company Name *
								</label>
								<select
									name="company_id"
									value={incomingPOData.company_id}
									onChange={(e) => handleCompanySelect(e.target.value)}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
									disabled={loadingCompanies}
								>
									<option value="">Select a company...</option>
									{companies.map((company) => (
										<option key={company.id} value={company.id}>
											{company.company_name}
										</option>
									))}
								</select>
								{loadingCompanies && (
									<p className="text-[10px] text-gray-500 mt-1">
										Loading companies...
									</p>
								)}
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									City
								</label>
								<input
									type="text"
									name="city"
									value={incomingPOData.city}
									placeholder="Auto-filled from company"
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
									readOnly
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									PO Number *
								</label>
								<input
									type="text"
									name="po_number"
									value={incomingPOData.po_number}
									onChange={handleIncomingPOChange}
									placeholder="PO-00001"
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									PO Date *
								</label>
								<input
									type="date"
									name="po_date"
									value={incomingPOData.po_date}
									onChange={handleIncomingPOChange}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									PO Amount (₹) *
								</label>
								<input
									type="number"
									name="po_amount"
									value={incomingPOData.po_amount}
									onChange={handleIncomingPOChange}
									placeholder="0.00"
									step="0.01"
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									Tax Amount (₹)
								</label>
								<input
									type="number"
									name="tax_amount"
									value={incomingPOData.tax_amount}
									onChange={handleIncomingPOChange}
									placeholder="0.00"
									step="0.01"
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									Net Amount (₹)
								</label>
								<input
									type="number"
									name="net_amount"
									value={incomingPOData.net_amount}
									placeholder="Auto-calculated"
									step="0.01"
									readOnly
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									Project No
								</label>
								<select
									name="project_id"
									value={incomingPOData.project_id}
									onChange={handleIncomingPOChange}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
									disabled={loadingProjects}
								>
									<option value="">Select a project...</option>
									{projects.map((proj) => (
										<option
											key={proj.id || proj.project_id}
											value={proj.id || proj.project_id || ''}
										>
											{proj.project_code || proj.project_id || ''}
										</option>
									))}
								</select>
								{loadingProjects && (
									<p className="text-[10px] text-gray-500 mt-1">
										Loading projects...
									</p>
								)}
							</div>
							<div className="md:col-span-2">
								<label className="block text-xs font-medium text-gray-700 mb-1">
									Remarks
								</label>
								<input
									type="text"
									name="remarks"
									value={incomingPOData.remarks}
									onChange={handleIncomingPOChange}
									placeholder="Additional remarks..."
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
						</div>

						<div className="flex gap-2">
							<button
								onClick={handleAddIncomingPO}
								disabled={addingPO}
								className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
							>
								{addingPO ? 'Adding...' : 'ADD'}
							</button>
							<button
								onClick={() => setShowAddPOForm(false)}
								className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
							>
								Cancel
							</button>
						</div>
					</div>
				)}

				{/* Stats Cards */}
				<div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
						<div className="text-2xl font-bold text-gray-900">
							{stats.total || 0}
						</div>
						<div className="text-sm text-gray-600">Total</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
						<div className="text-2xl font-bold text-gray-600">
							{stats.draft || 0}
						</div>
						<div className="text-sm text-gray-600">Draft</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
						<div className="text-2xl font-bold text-yellow-600">
							{stats.pending || 0}
						</div>
						<div className="text-sm text-gray-600">Pending</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
						<div className="text-2xl font-bold text-blue-600">
							{stats.approved || 0}
						</div>
						<div className="text-sm text-gray-600">Approved</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
						<div className="text-2xl font-bold text-green-600">
							{stats.completed || 0}
						</div>
						<div className="text-sm text-gray-600">Completed</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
						<div className="text-2xl font-bold text-red-600">
							{stats.cancelled || 0}
						</div>
						<div className="text-sm text-gray-600">Cancelled</div>
					</div>
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
									placeholder="Search purchase orders..."
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
						</div>

						{/* Status Filter */}
						<div className="flex items-center gap-2">
							<FunnelIcon className="h-5 w-5 text-gray-400" />
							<select
								value={statusFilter}
								onChange={(e) => setStatusFilter(e.target.value)}
								className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
							>
								<option value="all">All Status</option>
								<option value="draft">Draft</option>
								<option value="pending">Pending</option>
								<option value="approved">Approved</option>
								<option value="completed">Completed</option>
								<option value="cancelled">Cancelled</option>
							</select>
						</div>

						{/* Refresh */}
						<button
							onClick={() => fetchPurchaseOrders(pagination.page)}
							className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
							title="Refresh"
						>
							<ArrowPathIcon
								className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`}
							/>
						</button>
					</div>
				</div>

				{/* Purchase Orders Table */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-h-0 flex flex-col overflow-hidden">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
							<span className="ml-3 text-gray-600">
								Loading purchase orders...
							</span>
						</div>
					) : filteredPurchaseOrders.length === 0 ? (
						<div className="text-center py-12">
							<ClipboardDocumentListIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
							<p className="text-gray-600">No purchase orders found</p>
						</div>
					) : (
						<div className="flex-1 min-h-0 overflow-auto">
							<table className="w-full">
								<thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
									<tr>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											PO #
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Vendor
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Description
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Amount
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Tax Amount
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Net Amount
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Date
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Delivery Date
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Status
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-200">
									{filteredPurchaseOrders.map((po) => (
										<tr
											key={po.id}
											className="hover:bg-gray-50 transition-colors"
										>
											<td className="px-6 py-4">
												<span className="font-medium text-purple-600">
													{po.po_number}
												</span>
											</td>
											<td className="px-6 py-4">
												<div className="font-medium text-gray-900">
													{po.vendor_name}
												</div>
												<div className="text-sm text-gray-500">
													{po.vendor_email}
												</div>
											</td>
											<td className="px-6 py-4 text-gray-600 max-w-[200px] truncate">
												{po.description}
											</td>
											<td className="px-6 py-4 font-semibold text-gray-900">
												{formatCurrency(po.total)}
											</td>
											<td className="px-6 py-4 text-gray-900">
												{formatCurrency(po.tax_amount)}
											</td>
											<td className="px-6 py-4 font-semibold text-gray-900">
												{formatCurrency(
													po.net_amount ??
														parseFloat(po.total || 0) +
															parseFloat(po.tax_amount || 0)
												)}
											</td>
											<td className="px-6 py-4 text-gray-600">
												{formatDate(po.created_at)}
											</td>
											<td className="px-6 py-4 text-gray-600">
												{formatDate(po.delivery_date)}
											</td>
											<td className="px-6 py-4">
												<span
													className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusStyle(po.status)}`}
												>
													{po.status?.charAt(0).toUpperCase() +
														po.status?.slice(1)}
												</span>
											</td>
											<td className="px-6 py-4">
												<div className="flex items-center justify-center gap-2">
													<button
														onClick={() => handleEdit(po)}
														className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
														title="Edit"
													>
														<PencilSquareIcon className="h-5 w-5" />
													</button>
													<button
														onClick={() => handleDownload(po)}
														className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
														title="Download PDF"
													>
														<ArrowDownTrayIcon className="h-5 w-5" />
													</button>
													<button
														onClick={() => handleDelete(po)}
														className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
														title="Delete"
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
									onClick={() => fetchPurchaseOrders(pagination.page - 1)}
									disabled={pagination.page === 1}
									className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
								>
									<ChevronLeftIcon className="h-4 w-4" />
								</button>
								<span className="px-3 py-1 text-sm">
									{pagination.page} / {pagination.totalPages}
								</span>
								<button
									onClick={() => fetchPurchaseOrders(pagination.page + 1)}
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

			{/* Delete Confirmation Modal */}
			{showDeleteConfirm && deletingPO && (
				<div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
					<div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
						<div className="flex items-center gap-4 mb-4">
							<div className="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
								<TrashIcon className="h-6 w-6 text-red-600" />
							</div>
							<div>
								<h3 className="text-lg font-bold text-gray-900">
									Delete Purchase Order
								</h3>
								<p className="text-sm text-gray-500">
									This action cannot be undone.
								</p>
							</div>
						</div>
						<p className="text-gray-600 mb-6">
							Are you sure you want to delete purchase order{' '}
							<strong>{deletingPO.po_number}</strong>?
						</p>
						<div className="flex items-center justify-end gap-3">
							<button
								onClick={() => {
									setShowDeleteConfirm(false);
									setDeletingPO(null);
								}}
								className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={confirmDelete}
								disabled={deleteLoading}
								className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
							>
								{deleteLoading ? 'Deleting...' : 'Delete'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
