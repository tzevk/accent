'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
	ClipboardDocumentListIcon,
	MagnifyingGlassIcon,
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
	project_number: string;
	remarks: string;
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

	// Add form state
	const [showAddPOForm, setShowAddPOForm] = useState(false);
	const [addingPO, setAddingPO] = useState(false);
	const [outgoingPOData, setOutgoingPOData] = useState({
		company_name: '',
		city: '',
		po_number: '',
		po_date: '',
		po_amount: '',
		project_number: '',
		remarks: '',
	});

	// Search
	const [searchTerm, setSearchTerm] = useState('');

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
		setOutgoingPOData((prev) => ({
			...prev,
			[name]: value,
		}));
	};

	const handleAddOutgoingPO = async () => {
		if (
			!outgoingPOData.company_name ||
			!outgoingPOData.po_number ||
			!outgoingPOData.po_date ||
			!outgoingPOData.po_amount
		) {
			alert(
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
				alert('Outgoing Purchase Order added successfully!');
				setOutgoingPOData({
					company_name: '',
					city: '',
					po_number: '',
					po_date: '',
					po_amount: '',
					project_number: '',
					remarks: '',
				});
				fetchOutgoingPOs();
			} else {
				alert(data.message || 'Failed to add outgoing purchase order');
			}
		} catch (error) {
			console.error('Error adding outgoing PO:', error);
			alert('Failed to add outgoing purchase order');
		} finally {
			setAddingPO(false);
		}
	};

	const handleDeleteOutgoingPO = async (poId: number) => {
		if (
			!confirm('Are you sure you want to delete this outgoing purchase order?')
		)
			return;

		try {
			const res = await fetch(
				`/api/admin/outgoing-purchase-orders?id=${poId}`,
				{
					method: 'DELETE',
				}
			);
			const data = await res.json();
			if (data.success) {
				fetchOutgoingPOs();
			} else {
				alert(data.message || 'Failed to delete outgoing purchase order');
			}
		} catch (error) {
			console.error('Error deleting outgoing PO:', error);
			alert('Failed to delete outgoing purchase order');
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
			alert('Failed to download purchase order');
		}
	};

	const formatDate = (dateString: string) => {
		if (!dateString) return '-';
		return new Date(dateString).toLocaleDateString('en-IN', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
		});
	};

	const filteredOutgoingPOs = outgoingPOs.filter((po) => {
		if (!searchTerm) return true;
		const search = searchTerm.toLowerCase();
		return (
			po.company_name?.toLowerCase().includes(search) ||
			po.po_number?.toLowerCase().includes(search) ||
			po.city?.toLowerCase().includes(search) ||
			po.project_number?.toLowerCase().includes(search) ||
			po.remarks?.toLowerCase().includes(search)
		);
	});

	const totalAmount = outgoingPOs.reduce(
		(sum, po) => sum + (Number(po.po_amount) || 0),
		0
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
							<div className="md:col-span-2">
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
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-gray-900">
							{outgoingPOs.length}
						</div>
						<div className="text-xs text-gray-600">Total POs</div>
					</div>
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2">
						<div className="text-lg font-bold text-purple-600">
							₹
							{totalAmount.toLocaleString('en-IN', {
								minimumFractionDigits: 2,
								maximumFractionDigits: 2,
							})}
						</div>
						<div className="text-xs text-gray-600">Total Amount</div>
					</div>
				</div>

				{/* Search + Refresh */}
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
							<table className="w-full text-sm">
								<thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
									<tr>
										<th className="px-4 py-3 text-left font-semibold text-gray-600">
											Sr. No.
										</th>
										<th className="px-4 py-3 text-left font-semibold text-gray-600">
											Company Name
										</th>
										<th className="px-4 py-3 text-left font-semibold text-gray-600">
											City
										</th>
										<th className="px-4 py-3 text-left font-semibold text-gray-600">
											PO No.
										</th>
										<th className="px-4 py-3 text-left font-semibold text-gray-600">
											PO Date
										</th>
										<th className="px-4 py-3 text-right font-semibold text-gray-600">
											PO Amount
										</th>
										<th className="px-4 py-3 text-left font-semibold text-gray-600">
											Project No
										</th>
										<th className="px-4 py-3 text-left font-semibold text-gray-600">
											Remarks
										</th>
										<th className="px-4 py-3 text-center font-semibold text-gray-600">
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
											<td className="px-4 py-3 text-gray-700">
												{po.sr_no || idx + 1}
											</td>
											<td className="px-4 py-3 font-medium text-gray-900">
												{po.company_name}
											</td>
											<td className="px-4 py-3 text-gray-700">
												{po.city || '-'}
											</td>
											<td className="px-4 py-3 font-medium text-purple-600">
												{po.po_number}
											</td>
											<td className="px-4 py-3 text-gray-700">
												{formatDate(po.po_date)}
											</td>
											<td className="px-4 py-3 text-right font-semibold text-gray-900">
												₹
												{Number(po.po_amount || 0).toLocaleString('en-IN', {
													minimumFractionDigits: 2,
												})}
											</td>
											<td className="px-4 py-3 text-gray-700">
												{po.project_number || '-'}
											</td>
											<td className="px-4 py-3 text-gray-700 text-xs">
												{po.remarks || '-'}
											</td>
											<td className="px-4 py-3">
												<div className="flex items-center justify-center gap-2">
													<button
														onClick={() => handleDownloadOutgoingPO(po)}
														className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
														title="Download PDF"
													>
														<ArrowDownTrayIcon className="h-4 w-4" />
													</button>
													<button
														onClick={() => handleDeleteOutgoingPO(po.id)}
														className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
														title="Delete"
													>
														<TrashIcon className="h-4 w-4" />
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
