'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import {
	ClipboardDocumentListIcon,
	ArrowLeftIcon,
	ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

export default function EditPurchaseOrderPage() {
	const router = useRouter();
	const params = useParams();
	const { user, loading: authLoading } = useSessionRBAC();

	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [companies, setCompanies] = useState([]);
	const [projects, setProjects] = useState([]);
	const [loadingCompanies, setLoadingCompanies] = useState(true);
	const [loadingProjects, setLoadingProjects] = useState(true);

	const [poData, setPoData] = useState({
		id: null,
		po_number: '',
		po_date: '',
		po_amount: '',
		tax_amount: '',
		net_amount: '',
		company_id: '',
		company_name: '',
		city: '',
		project_id: '',
		remarks: '',
		status: 'pending',
	});

	useEffect(() => {
		const fetchPurchaseOrder = async () => {
			if (!params.id) return;

			setLoading(true);
			try {
				const res = await fetch(`/api/admin/purchase-orders?id=${params.id}`);
				const data = await res.json();

				if (data.success && data.data) {
					const poList = Array.isArray(data.data) ? data.data : [data.data];
					const po =
						poList.find((p) => p.id === parseInt(params.id)) || poList[0];

					if (po) {
						setPoData({
							id: po.id ?? null,
							po_number: po.po_number || '',
							po_date: po.po_date ? po.po_date.split('T')[0] : '',
							po_amount: po.po_amount ?? '',
							tax_amount: po.tax_amount ?? '',
							net_amount: po.net_amount ?? '',
							company_id: po.company_id ?? '',
							company_name: po.vendor_name || po.company_name || '',
							city: po.city || '',
							project_id: po.project_id ?? '',
							remarks: po.remarks || '',
							status: po.status || 'pending',
						});
					}
				}
			} catch (error) {
				console.error('Error fetching purchase order:', error);
				toast.error('Failed to load purchase order');
			} finally {
				setLoading(false);
			}
		};

		if (!authLoading && user) {
			fetchPurchaseOrder();
		}
	}, [params.id, authLoading, user]);

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

	const handleCompanySelect = (companyId) => {
		const selectedCompany = companies.find(
			(c) => String(c.id) === String(companyId)
		);
		if (selectedCompany) {
			setPoData((prev) => ({
				...prev,
				company_id: selectedCompany.id,
				company_name: selectedCompany.company_name || '',
				city: selectedCompany.city || '',
			}));
		} else {
			setPoData((prev) => ({
				...prev,
				company_id: '',
				company_name: '',
				city: '',
			}));
		}
	};

	const handleChange = (e) => {
		const { name, value } = e.target;
		setPoData((prev) => {
			const next = { ...prev, [name]: value };
			if (name === 'po_amount' || name === 'tax_amount') {
				const base = parseFloat(next.po_amount) || 0;
				const tax = parseFloat(next.tax_amount) || 0;
				next.net_amount = (base + tax).toFixed(2);
			}
			return next;
		});
	};

	const handleSave = async () => {
		if (
			!poData.company_name ||
			!poData.po_number ||
			!poData.po_date ||
			!poData.po_amount
		) {
			toast.error(
				'Please fill in all required fields (Company Name, PO Number, PO Date, PO Amount)'
			);
			return;
		}

		setSaving(true);
		try {
			const res = await fetch('/api/admin/purchase-orders', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					id: poData.id,
					po_number: poData.po_number,
					po_date: poData.po_date,
					po_amount: parseFloat(poData.po_amount) || 0,
					tax_amount: parseFloat(poData.tax_amount) || 0,
					net_amount: parseFloat(poData.net_amount) || 0,
					company_id: poData.company_id || null,
					project_id: poData.project_id || null,
					vendor_name: poData.company_name,
					remarks: poData.remarks || null,
					status: poData.status,
					total: parseFloat(poData.po_amount) || 0,
					subtotal: parseFloat(poData.po_amount) || 0,
				}),
			});

			const data = await res.json();

			if (data.success) {
				toast.success('Purchase order updated');
				router.push('/admin/purchase-order');
			} else {
				toast.error(data.message || 'Failed to update purchase order');
			}
		} catch (error) {
			console.error('Error updating purchase order:', error);
			toast.error('Failed to update purchase order');
		} finally {
			setSaving(false);
		}
	};

	const handleDownload = () => {
		if (!poData.id) return;
		window.open(
			`/api/admin/purchase-orders/download?id=${poData.id}`,
			'_blank'
		);
	};

	if (authLoading || loading) {
		return (
			<div className="min-h-screen bg-gray-50 flex items-center justify-center">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<main className="px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 max-w-[1800px] mx-auto">
				{/* Header */}
				<div className="flex items-center justify-between mb-6">
					<div className="flex items-center gap-4">
						<button
							onClick={() => router.push('/admin/purchase-order')}
							className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
						>
							<ArrowLeftIcon className="h-5 w-5 text-gray-600" />
						</button>
						<div>
							<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
								<ClipboardDocumentListIcon className="h-7 w-7 text-purple-600" />
								Edit Purchase Order
							</h1>
							<p className="text-sm text-gray-500 mt-1">
								{poData.po_number || 'Loading...'}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-3">
						<button
							onClick={handleDownload}
							className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
						>
							<ArrowDownTrayIcon className="h-5 w-5" />
							Download PDF
						</button>
						<button
							onClick={() => router.push('/admin/purchase-order')}
							className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
						>
							Cancel
						</button>
						<button
							onClick={handleSave}
							disabled={saving}
							className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
						>
							{saving ? 'Saving...' : 'Save Changes'}
						</button>
					</div>
				</div>

				{/* Form */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Company Name *
							</label>
							<select
								name="company_id"
								value={poData.company_id}
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
								value={poData.city}
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
								value={poData.po_number}
								onChange={handleChange}
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
								value={poData.po_date}
								onChange={handleChange}
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
								value={poData.po_amount}
								onChange={handleChange}
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
								value={poData.tax_amount}
								onChange={handleChange}
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
								value={poData.net_amount}
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
								value={poData.project_id}
								onChange={handleChange}
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
								Status
							</label>
							<select
								name="status"
								value={poData.status}
								onChange={handleChange}
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
							>
								<option value="draft">Draft</option>
								<option value="pending">Pending</option>
								<option value="approved">Approved</option>
								<option value="completed">Completed</option>
								<option value="cancelled">Cancelled</option>
							</select>
						</div>
						<div className="md:col-span-2">
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Remarks
							</label>
							<input
								type="text"
								name="remarks"
								value={poData.remarks}
								onChange={handleChange}
								placeholder="Additional remarks..."
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
							/>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
