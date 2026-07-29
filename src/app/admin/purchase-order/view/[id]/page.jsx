'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { useSessionRBAC } from '@/utils/client-rbac';
import { formatCurrency } from '@/lib/format';
import Navbar from '@/components/Navbar';
import {
	ClipboardDocumentListIcon,
	ArrowLeftIcon,
	ArrowDownTrayIcon,
	PencilSquareIcon,
} from '@heroicons/react/24/outline';

const STATUS_STYLES = {
	draft: 'bg-gray-100 text-gray-700',
	pending: 'bg-yellow-100 text-yellow-700',
	approved: 'bg-blue-100 text-blue-700',
	completed: 'bg-green-100 text-green-700',
	cancelled: 'bg-red-100 text-red-700',
};

function getStatusStyle(status) {
	return STATUS_STYLES[status] || STATUS_STYLES.pending;
}

function statusLabel(status) {
	if (!status) return '—';
	return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function ViewPurchaseOrderPage() {
	const router = useRouter();
	const params = useParams();
	const { user, loading: authLoading } = useSessionRBAC();

	const [loading, setLoading] = useState(true);
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
		project_label: '',
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
							project_label: '',
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

	// Resolve the project_id to a human label once projects are loaded
	useEffect(() => {
		if (!projects.length || !poData.project_id) return;
		const match = projects.find(
			(p) => String(p.id || p.project_id) === String(poData.project_id)
		);
		if (match) {
			setPoData((prev) => ({
				...prev,
				project_label:
					match.project_code || match.project_id || String(match.id),
			}));
		}
	}, [projects, poData.project_id]);

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

			<main className="px-6 lg:px-8 xl:px-12 2xl:px-16 py-6 max-w-full mx-auto">
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
								View Purchase Order
							</h1>
							<p className="text-sm text-gray-500 mt-1">
								{poData.po_number || '—'}
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
							onClick={() =>
								router.push(`/admin/purchase-order/edit/${poData.id}`)
							}
							disabled={!poData.id}
							className="flex items-center gap-2 px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
						>
							<PencilSquareIcon className="h-5 w-5" />
							Edit
						</button>
					</div>
				</div>

				{/* Read-only form */}
				<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Company Name
							</label>
							<select
								name="company_id"
								value={poData.company_id}
								disabled
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700 cursor-not-allowed"
							>
								<option value="">
									{loadingCompanies
										? 'Loading companies…'
										: poData.company_name || '—'}
								</option>
								{companies.map((company) => (
									<option key={company.id} value={company.id}>
										{company.company_name}
									</option>
								))}
							</select>
						</div>
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								City
							</label>
							<input
								type="text"
								name="city"
								value={poData.city}
								readOnly
								placeholder="—"
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								PO Number
							</label>
							<input
								type="text"
								name="po_number"
								value={poData.po_number}
								readOnly
								placeholder="—"
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								PO Date
							</label>
							<input
								type="date"
								name="po_date"
								value={poData.po_date}
								readOnly
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								PO Amount (₹)
							</label>
							<input
								type="text"
								name="po_amount"
								value={
									poData.po_amount === '' || poData.po_amount == null
										? '—'
										: formatCurrency(poData.po_amount)
								}
								readOnly
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Tax Amount (₹)
							</label>
							<input
								type="text"
								name="tax_amount"
								value={
									poData.tax_amount === '' || poData.tax_amount == null
										? '—'
										: formatCurrency(poData.tax_amount)
								}
								readOnly
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Net Amount (₹)
							</label>
							<input
								type="text"
								name="net_amount"
								value={
									poData.net_amount === '' || poData.net_amount == null
										? '—'
										: formatCurrency(poData.net_amount)
								}
								readOnly
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
						<div>
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Project No
							</label>
							<input
								type="text"
								name="project_id"
								value={poData.project_label || poData.project_id || '—'}
								readOnly
								placeholder={loadingProjects ? 'Loading projects…' : '—'}
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
						<div className="md:col-span-2">
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Status
							</label>
							<div className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50">
								<span
									className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusStyle(poData.status)}`}
								>
									{statusLabel(poData.status)}
								</span>
							</div>
						</div>
						<div className="md:col-span-2">
							<label className="block text-xs font-medium text-gray-700 mb-1">
								Remarks
							</label>
							<input
								type="text"
								name="remarks"
								value={poData.remarks}
								readOnly
								placeholder="—"
								className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-700"
							/>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
