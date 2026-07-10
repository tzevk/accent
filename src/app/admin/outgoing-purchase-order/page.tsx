'use client';

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
	ClipboardDocumentListIcon,
	MagnifyingGlassIcon,
	FunnelIcon,
	ArrowPathIcon,
	ArrowDownTrayIcon,
	TrashIcon,
	PlusIcon,
	XMarkIcon,
} from '@heroicons/react/24/outline';

interface Company {
	id: number;
	company_name: string;
	city?: string;
}

interface Project {
	id: number;
	project_id?: string;
	project_code?: string;
}

interface OutgoingPO {
	id: number;
	sr_no: number;
	company_name: string;
	city: string;
	po_number: string;
	po_date: string;
	po_amount: number;
	tax_amount: number;
	net_amount: number;
	project_number: string;
	description: string;
	remarks: string;
	status: string;
	created_at: string;
}

export default function OutgoingPurchaseOrderPage() {
	const { user, loading: authLoading } = useSessionRBAC();

	const [outgoingPOs, setOutgoingPOs] = useState<OutgoingPO[]>([]);
	const [loadingOutgoingPOs, setLoadingOutgoingPOs] = useState(true);
	const [companies, setCompanies] = useState<Company[]>([]);
	const [loadingCompanies, setLoadingCompanies] = useState(true);
	const [projects, setProjects] = useState<Project[]>([]);
	const [loadingProjects, setLoadingProjects] = useState(true);

	const [showAddPOForm, setShowAddPOForm] = useState(false);
	const [addingPO, setAddingPO] = useState(false);
	const [outgoingPOData, setOutgoingPOData] = useState({
		company_name: '',
		city: '',
		po_number: '',
		po_date: '',
		po_amount: '',
		tax_amount: '',
		net_amount: '',
		project_number: '',
		description: '',
		remarks: '',
		status: 'pending',
	});

	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState('all');
	const [sortBy, setSortBy] = useState('po_date');
	const [sortOrder, setSortOrder] = useState('desc');

	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deletingPO, setDeletingPO] = useState<OutgoingPO | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);

	const fetchOutgoingPOs = useCallback(async () => {
		setLoadingOutgoingPOs(true);
		try {
			const res = await fetch('/api/admin/outgoing-purchase-orders');
			const data = await res.json();
			if (data.success) {
				setOutgoingPOs(data.data || []);
			}
		} catch (error) {
			console.error('Error fetching outgoing POs:', error);
		} finally {
			setLoadingOutgoingPOs(false);
		}
	}, []);

	useEffect(() => {
		if (!authLoading && user) {
			fetchOutgoingPOs();
		}
	}, [authLoading, user, fetchOutgoingPOs]);

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

	const handleCompanySelect = (companyName: string) => {
		const selectedCompany = companies.find(
			(c) => c.company_name === companyName
		);
		if (selectedCompany) {
			setOutgoingPOData((prev) => ({
				...prev,
				company_name: selectedCompany.company_name || '',
				city: selectedCompany.city || '',
			}));
		} else {
			setOutgoingPOData((prev) => ({
				...prev,
				company_name: '',
				city: '',
			}));
		}
	};

	const handleOutgoingPOChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
	) => {
		const { name, value } = e.target;
		setOutgoingPOData((prev) => {
			const next = { ...prev, [name]: value };
			if (name === 'po_amount' || name === 'tax_amount') {
				const base = parseFloat(next.po_amount) || 0;
				const tax = parseFloat(next.tax_amount) || 0;
				next.net_amount = (base + tax).toFixed(2);
			}
			return next;
		});
	};

	const handleAddOutgoingPO = async () => {
		if (
			!outgoingPOData.company_name ||
			!outgoingPOData.po_number ||
			!outgoingPOData.po_date ||
			!outgoingPOData.po_amount
		) {
			toast.error(
				'Please fill in all required fields (Company Name, PO Number, PO Date, PO Amount)'
			);
			return;
		}

		setAddingPO(true);
		try {
			const res = await fetch('/api/admin/outgoing-purchase-orders', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(outgoingPOData),
			});
			const data = await res.json();

			if (data.success) {
				setOutgoingPOData({
					company_name: '',
					city: '',
					po_number: '',
					po_date: '',
					po_amount: '',
					tax_amount: '',
					net_amount: '',
					project_number: '',
					description: '',
					remarks: '',
					status: 'pending',
				});
				setShowAddPOForm(false);
				toast.success('Outgoing purchase order added');
				fetchOutgoingPOs();
			} else {
				toast.error(data.message || 'Failed to add outgoing purchase order');
			}
		} catch (error) {
			console.error('Error adding outgoing PO:', error);
			toast.error('Failed to add outgoing purchase order');
		} finally {
			setAddingPO(false);
		}
	};

	const handleDeleteOutgoingPO = (po: OutgoingPO) => {
		setDeletingPO(po);
		setShowDeleteConfirm(true);
	};

	const confirmDelete = async () => {
		if (!deletingPO) return;

		setDeleteLoading(true);
		try {
			const res = await fetch(
				`/api/admin/outgoing-purchase-orders?id=${deletingPO.id}`,
				{ method: 'DELETE' }
			);
			const data = await res.json();
			if (data.success) {
				toast.success('Outgoing purchase order marked as deleted');
				setShowDeleteConfirm(false);
				setDeletingPO(null);
				fetchOutgoingPOs();
			} else {
				toast.error(data.message || 'Failed to delete outgoing purchase order');
			}
		} catch (error) {
			console.error('Error deleting outgoing PO:', error);
			toast.error('Failed to delete outgoing purchase order');
		} finally {
			setDeleteLoading(false);
		}
	};

	const handleDownloadOutgoingPO = (po: OutgoingPO) => {
		try {
			window.open(
				`/api/admin/outgoing-purchase-orders/download?id=${po.id}`,
				'_blank'
			);
		} catch (error) {
			console.error('Error downloading PO:', error);
			toast.error('Failed to download purchase order');
		}
	};

	const formatDate = (dateString: string) => {
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

	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat('en-IN', {
			style: 'currency',
			currency: 'INR',
			minimumFractionDigits: 2,
		}).format(amount || 0);
	};

	const getStatusStyle = (status: string) => {
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

	const sortOutgoingPOs = (pos: OutgoingPO[]) => {
		return [...pos].sort((a, b) => {
			let cmp = 0;
			switch (sortBy) {
				case 'po_date':
					cmp = new Date(a.po_date).getTime() - new Date(b.po_date).getTime();
					break;
				case 'created_at':
					cmp =
						new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
					break;
				case 'po_number':
					cmp = a.po_number.localeCompare(b.po_number);
					break;
				case 'company_name':
					cmp = a.company_name.localeCompare(b.company_name);
					break;
				case 'po_amount':
					cmp = (Number(a.po_amount) || 0) - (Number(b.po_amount) || 0);
					break;
				case 'net_amount':
					cmp = (Number(a.net_amount) || 0) - (Number(b.net_amount) || 0);
					break;
				default:
					cmp =
						new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
			}
			return sortOrder === 'desc' ? -cmp : cmp;
		});
	};

	const filteredOutgoingPOs = sortOutgoingPOs(
		outgoingPOs.filter((po) => {
			if (statusFilter !== 'all' && po.status !== statusFilter) return false;
			if (!searchTerm) return true;
			const search = searchTerm.toLowerCase();
			return (
				po.company_name?.toLowerCase().includes(search) ||
				po.po_number?.toLowerCase().includes(search) ||
				po.city?.toLowerCase().includes(search) ||
				po.project_number?.toLowerCase().includes(search) ||
				po.description?.toLowerCase().includes(search) ||
				po.remarks?.toLowerCase().includes(search)
			);
		})
	);

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

			<main className="flex-1 min-h-0 flex flex-col px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 max-w-full w-full mx-auto">
				<div className="flex items-center justify-between mb-6">
					<div>
						<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
							<ClipboardDocumentListIcon className="h-7 w-7 text-purple-600" />
							Outgoing Purchase Orders
						</h1>
						<p className="text-sm text-gray-500 mt-1">
							View and download outgoing purchase orders
						</p>
					</div>
					<button
						onClick={() => setShowAddPOForm(!showAddPOForm)}
						className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2"
					>
						<PlusIcon className="h-5 w-5" />
						Add Outgoing Purchase Order
					</button>
				</div>

				{showAddPOForm && (
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-bold text-gray-900">
								Add Outgoing Purchase Order
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
									name="company_name"
									value={outgoingPOData.company_name}
									onChange={(e) => handleCompanySelect(e.target.value)}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
									disabled={loadingCompanies}
								>
									<option value="">Select a company...</option>
									{companies.map((company) => (
										<option key={company.id} value={company.company_name}>
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
									value={outgoingPOData.city}
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
									value={outgoingPOData.po_number}
									onChange={handleOutgoingPOChange}
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
									value={outgoingPOData.po_date}
									onChange={handleOutgoingPOChange}
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
									value={outgoingPOData.po_amount}
									onChange={handleOutgoingPOChange}
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
									value={outgoingPOData.tax_amount}
									onChange={handleOutgoingPOChange}
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
									value={outgoingPOData.net_amount}
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
									name="project_number"
									value={outgoingPOData.project_number}
									onChange={handleOutgoingPOChange}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
									disabled={loadingProjects}
								>
									<option value="">Select a project...</option>
									{projects.map((proj) => (
										<option
											key={proj.id || proj.project_id}
											value={proj.project_code || proj.project_id || ''}
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
						</div>

						<div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-4">
							<div>
								<label className="block text-xs font-medium text-gray-700 mb-1">
									Status
								</label>
								<select
									name="status"
									value={outgoingPOData.status}
									onChange={handleOutgoingPOChange}
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								>
									<option value="draft">Draft</option>
									<option value="pending">Pending</option>
									<option value="approved">Approved</option>
									<option value="completed">Completed</option>
									<option value="cancelled">Cancelled</option>
								</select>
							</div>
							<div className="lg:col-span-3">
								<label className="block text-xs font-medium text-gray-700 mb-1">
									Description
								</label>
								<input
									type="text"
									name="description"
									value={outgoingPOData.description}
									onChange={handleOutgoingPOChange}
									placeholder="Brief description..."
									className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
						</div>

						<div className="mb-4">
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Remarks
							</label>
							<input
								type="text"
								name="remarks"
								value={outgoingPOData.remarks}
								onChange={handleOutgoingPOChange}
								placeholder="Additional remarks..."
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
							/>
						</div>

						<div className="flex gap-2">
							<button
								onClick={handleAddOutgoingPO}
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

				{/* Stats */}
				<div className="flex gap-4 mb-6">
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-[0.6] min-w-[60px] px-3 py-2">
						<div className="text-lg font-bold text-gray-900">
							{outgoingPOs.length}
						</div>
						<div className="text-xs text-gray-600">Total</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-[0.6] min-w-[60px] px-3 py-2">
						<div className="text-lg font-bold text-gray-600">
							{outgoingPOs.filter((p) => p.status === 'draft').length}
						</div>
						<div className="text-xs text-gray-600">Draft</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-[0.6] min-w-[60px] px-3 py-2">
						<div className="text-lg font-bold text-yellow-600">
							{outgoingPOs.filter((p) => p.status === 'pending').length}
						</div>
						<div className="text-xs text-gray-600">Pending</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-[0.6] min-w-[60px] px-3 py-2">
						<div className="text-lg font-bold text-blue-600">
							{outgoingPOs.filter((p) => p.status === 'approved').length}
						</div>
						<div className="text-xs text-gray-600">Approved</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-[0.6] min-w-[60px] px-3 py-2">
						<div className="text-lg font-bold text-green-600">
							{outgoingPOs.filter((p) => p.status === 'completed').length}
						</div>
						<div className="text-xs text-gray-600">Completed</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-[0.6] min-w-[60px] px-3 py-2">
						<div className="text-lg font-bold text-red-600">
							{outgoingPOs.filter((p) => p.status === 'cancelled').length}
						</div>
						<div className="text-xs text-gray-600">Cancelled</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-purple-200 flex-[1.5] min-w-[140px] px-3 py-2">
						<div className="text-lg font-bold text-purple-600">
							{formatCurrency(
								outgoingPOs.reduce(
									(sum, po) => sum + (Number(po.po_amount) || 0),
									0
								)
							)}
						</div>
						<div className="text-xs text-gray-600">Total Amount</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-purple-200 flex-[1.5] min-w-[140px] px-3 py-2">
						<div className="text-lg font-bold text-purple-600">
							{formatCurrency(
								outgoingPOs.reduce(
									(sum, po) => sum + (Number(po.tax_amount) || 0),
									0
								)
							)}
						</div>
						<div className="text-xs text-gray-600">Total Tax</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-purple-200 flex-[1.5] min-w-[140px] px-3 py-2">
						<div className="text-lg font-bold text-purple-600">
							{formatCurrency(
								outgoingPOs.reduce((sum, po) => {
									const net =
										po.net_amount != null
											? Number(po.net_amount)
											: (Number(po.po_amount) || 0) +
												(Number(po.tax_amount) || 0);
									return sum + (isNaN(net) ? 0 : net);
								}, 0)
							)}
						</div>
						<div className="text-xs text-gray-600">Total Net</div>
					</div>
				</div>

				{/* Filters */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
					<div className="flex flex-wrap items-center gap-4">
						<div className="flex-1 min-w-[200px]">
							<div className="relative">
								<MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
								<input
									type="text"
									placeholder="Search outgoing purchase orders..."
									value={searchTerm}
									onChange={(e) => setSearchTerm(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								/>
							</div>
						</div>

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

						<div className="flex items-center gap-2">
							<select
								value={`${sortBy}-${sortOrder}`}
								onChange={(e) => {
									const [f, o] = e.target.value.split('-');
									setSortBy(f);
									setSortOrder(o);
								}}
								className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
							>
								<option value="po_date-desc">Date: Newest First</option>
								<option value="po_date-asc">Date: Oldest First</option>
								<option value="created_at-desc">Recently Added</option>
								<option value="po_number-asc">PO # A–Z</option>
								<option value="po_number-desc">PO # Z–A</option>
								<option value="company_name-asc">Company A–Z</option>
								<option value="po_amount-desc">Amount: High to Low</option>
								<option value="po_amount-asc">Amount: Low to High</option>
								<option value="net_amount-desc">Net: High to Low</option>
								<option value="net_amount-asc">Net: Low to High</option>
							</select>
						</div>

						<button
							onClick={() => fetchOutgoingPOs()}
							className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
							title="Refresh"
						>
							<ArrowPathIcon
								className={`h-5 w-5 ${
									loadingOutgoingPOs ? 'animate-spin' : ''
								}`}
							/>
						</button>
					</div>
				</div>

				{/* Outgoing POs Table */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-h-0 flex flex-col overflow-hidden">
					{loadingOutgoingPOs ? (
						<div className="flex items-center justify-center py-12">
							<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
							<span className="ml-3 text-gray-600">
								Loading outgoing purchase orders...
							</span>
						</div>
					) : filteredOutgoingPOs.length === 0 ? (
						<div className="text-center py-12">
							<ClipboardDocumentListIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
							<p className="text-gray-600">No outgoing purchase orders found</p>
						</div>
					) : (
						<div className="flex-1 min-h-0 overflow-auto">
							<table className="w-full">
								<thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
									<tr>
										<th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase w-12">
											#
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											PO #
										</th>
										<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
											Company
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
											Status
										</th>
										<th className="px-6 py-3 text-center text-xs font-semibold text-gray-600 uppercase">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-200">
									{filteredOutgoingPOs.map((po, idx) => (
										<tr
											key={po.id}
											className="hover:bg-gray-50 transition-colors"
										>
											<td className="px-4 py-4 text-gray-500 text-sm">
												{idx + 1}
											</td>
											<td className="px-6 py-4">
												<span className="font-medium text-purple-600">
													{po.po_number}
												</span>
											</td>
											<td className="px-6 py-4">
												<div className="font-medium text-gray-900">
													{po.company_name}
												</div>
												<div className="text-sm text-gray-500">
													{po.city || ''}
												</div>
											</td>
											<td className="px-6 py-4 font-semibold text-gray-900">
												{formatCurrency(Number(po.po_amount || 0))}
											</td>
											<td className="px-6 py-4 text-gray-900">
												{formatCurrency(Number(po.tax_amount || 0))}
											</td>
											<td className="px-6 py-4 font-semibold text-gray-900">
												{formatCurrency(
													Number(po.net_amount) ||
														Number(po.po_amount || 0) +
															Number(po.tax_amount || 0)
												)}
											</td>
											<td className="px-6 py-4 text-gray-600">
												{formatDate(po.po_date || po.created_at)}
											</td>
											<td className="px-6 py-4">
												<span
													className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusStyle(po.status)}`}
												>
													{po.status
														? po.status.charAt(0).toUpperCase() +
															po.status.slice(1)
														: ''}
												</span>
											</td>
											<td className="px-6 py-4">
												<div className="flex items-center justify-center gap-2">
													<button
														onClick={() => handleDownloadOutgoingPO(po)}
														className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
														title="Download PDF"
													>
														<ArrowDownTrayIcon className="h-5 w-5" />
													</button>
													<button
														onClick={() => handleDeleteOutgoingPO(po)}
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
									Delete Outgoing Purchase Order
								</h3>
								<p className="text-sm text-gray-500">
									This will mark the purchase order as deleted.
								</p>
							</div>
						</div>
						<p className="text-gray-600 mb-6">
							Are you sure you want to mark outgoing purchase order{' '}
							<strong>{deletingPO.po_number}</strong> as deleted?
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
								{deleteLoading ? 'Deleting...' : 'Mark as Deleted'}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
