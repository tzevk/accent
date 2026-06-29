'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionRBAC } from '@/utils/client-rbac';
import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import {
	DocumentTextIcon,
	MagnifyingGlassIcon,
	FunnelIcon,
	ArrowPathIcon,
	ArrowDownTrayIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	FolderIcon,
	PencilSquareIcon,
	PlusIcon,
	EyeIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';

export default function QuotationPage() {
	const router = useRouter();
	const { user, loading: authLoading } = useSessionRBAC();

	const [quotations, setQuotations] = useState([]);
	const [loading, setLoading] = useState(true);
	const [pagination, setPagination] = useState({
		page: 1,
		limit: 20,
		total: 0,
		totalPages: 0,
	});
	const [projects, setProjects] = useState([]);
	const [projectsLoading, setProjectsLoading] = useState(false);
	const [selectedQuotation, setSelectedQuotation] = useState(null);
	const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
	const [attachmentProjectId, setAttachmentProjectId] = useState('');
	const [attachmentSearch, setAttachmentSearch] = useState('');
	const [attachmentError, setAttachmentError] = useState('');
	const [attachmentSuccess, setAttachmentSuccess] = useState('');
	const [savingAttachment, setSavingAttachment] = useState(false);

	// Filters
	const [searchTerm, setSearchTerm] = useState('');
	const [statusFilter, setStatusFilter] = useState('all');
	const [sourceFilter, setSourceFilter] = useState('all');

	// Stats
	const [stats, setStats] = useState({
		total: 0,
		draft: 0,
		sent: 0,
		approved: 0,
		rejected: 0,
	});

	// Fetch quotations
	const fetchQuotations = useCallback(
		async (page = 1) => {
			setLoading(true);
			try {
				const params = new URLSearchParams({
					page: page.toString(),
					limit: pagination.limit.toString(),
				});

				if (statusFilter !== 'all') params.append('status', statusFilter);
				if (sourceFilter !== 'all') params.append('source', sourceFilter);

				const res = await fetch(`/api/admin/quotations?${params}`);
				const data = await res.json();

				if (data.success) {
					setQuotations(data.data || []);
					setPagination(
						data.pagination || { page: 1, limit: 20, total: 0, totalPages: 0 }
					);
					setStats(
						data.stats || {
							total: 0,
							draft: 0,
							sent: 0,
							approved: 0,
							rejected: 0,
						}
					);
				} else {
					setQuotations([]);
				}
			} catch (error) {
				console.error('Error fetching quotations:', error);
				setQuotations([]);
			} finally {
				setLoading(false);
			}
		},
		[statusFilter, sourceFilter, pagination.limit]
	);

	const fetchProjects = useCallback(async () => {
		setProjectsLoading(true);
		try {
			const res = await fetch('/api/projects/list');
			const data = await res.json();

			if (data.success) {
				setProjects(data.data || []);
			}
		} catch (error) {
			console.error('Error fetching projects:', error);
			setProjects([]);
		} finally {
			setProjectsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!authLoading && user) {
			fetchQuotations(1);
		}
	}, [authLoading, user, statusFilter, sourceFilter, fetchQuotations]);

	useEffect(() => {
		if (attachmentModalOpen) {
			fetchProjects();
		}
	}, [attachmentModalOpen, fetchProjects]);

	// Filter quotations by search term
	const filteredQuotations = quotations.filter((q) => {
		if (!searchTerm) return true;
		const search = searchTerm.toLowerCase();
		return (
			q.quotation_number?.toLowerCase().includes(search) ||
			q.client_name?.toLowerCase().includes(search) ||
			q.subject?.toLowerCase().includes(search) ||
			q.project_name?.toLowerCase().includes(search)
		);
	});

	// Get status styling
	const getStatusStyle = (status) => {
		switch (status) {
			case 'draft':
				return 'bg-gray-100 text-gray-700';
			case 'sent':
				return 'bg-blue-100 text-blue-700';
			case 'approved':
				return 'bg-green-100 text-green-700';
			case 'rejected':
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

	const getProjectKey = (project) => {
		if (!project) return '';
		return String(project.id ?? project.project_id ?? '');
	};

	const getProjectLabel = (project) => {
		if (!project) return '';
		const code = project.project_id || project.id;
		const name = project.name || 'Untitled Project';
		return code ? `${code} - ${name}` : name;
	};

	const openProjectAttachmentModal = (quotation) => {
		setSelectedQuotation(quotation);
		setAttachmentProjectId(
			quotation.project_id ? String(quotation.project_id) : ''
		);
		setAttachmentSearch('');
		setAttachmentError('');
		setAttachmentSuccess('');
		setAttachmentModalOpen(true);
	};

	const closeProjectAttachmentModal = () => {
		setSelectedQuotation(null);
		setAttachmentProjectId('');
		setAttachmentSearch('');
		setAttachmentError('');
		setAttachmentSuccess('');
		setAttachmentModalOpen(false);
	};

	const selectedProject = projects.find(
		(project) => getProjectKey(project) === attachmentProjectId
	);
	const selectedProjectLabel = selectedProject
		? getProjectLabel(selectedProject)
		: attachmentProjectId
			? `Project ID: ${attachmentProjectId}`
			: '';

	const handleSaveProjectAttachment = async () => {
		if (!selectedQuotation) return;

		setSavingAttachment(true);
		setAttachmentError('');

		try {
			const projectId =
				attachmentProjectId === '' || attachmentProjectId === null
					? null
					: Number(attachmentProjectId);
			const res = await fetch(
				`/api/admin/quotations/${selectedQuotation.id}/project`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ projectId }),
				}
			);
			const data = await res.json().catch(() => ({
				success: false,
				error: 'Request failed',
			}));

			if (!data.success) {
				setAttachmentError(data.error || 'Failed to update project');
				return;
			}

			setQuotations((current) =>
				current.map((q) =>
					q.id === selectedQuotation.id && q.source === 'quotations'
						? {
								...q,
								project_id: data.data.project_id,
								project_name: data.data.project_name,
							}
						: q
				)
			);
			setAttachmentSuccess(
				projectId === null
					? 'Project detached successfully.'
					: `Project updated successfully${
							selectedProject ? `: ${getProjectLabel(selectedProject)}` : ''
						}.`
			);
			setTimeout(() => {
				closeProjectAttachmentModal();
				fetchQuotations(pagination.page);
			}, 700);
		} catch (error) {
			console.error('Error updating quotation project:', error);
			setAttachmentError('Failed to update project');
		} finally {
			setSavingAttachment(false);
		}
	};

	const handleDetachProjectAttachment = async () => {
		if (!selectedQuotation?.project_id) return;

		setSavingAttachment(true);
		setAttachmentError('');
		setAttachmentSuccess('');

		try {
			const res = await fetch(
				`/api/admin/quotations/${selectedQuotation.id}/project`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ projectId: null }),
				}
			);
			const data = await res.json().catch(() => ({
				success: false,
				error: 'Request failed',
			}));

			if (!data.success) {
				setAttachmentError(data.error || 'Failed to detach project');
				return;
			}

			setQuotations((current) =>
				current.map((q) =>
					q.id === selectedQuotation.id && q.source === 'quotations'
						? {
								...q,
								project_id: null,
								project_name: null,
							}
						: q
				)
			);
			setAttachmentSuccess('Project detached successfully.');
			setTimeout(() => {
				closeProjectAttachmentModal();
				fetchQuotations(pagination.page);
			}, 700);
		} catch (error) {
			console.error('Error detaching quotation project:', error);
			setAttachmentError('Failed to detach project');
		} finally {
			setSavingAttachment(false);
		}
	};

	const filteredProjects = projects.filter((project) => {
		if (!attachmentSearch) return true;
		const search = attachmentSearch.toLowerCase();
		return (
			getProjectLabel(project).toLowerCase().includes(search) ||
			(project.client_name || '').toLowerCase().includes(search)
		);
	});

	// Handle download - opens quotation in new tab for printing/saving as PDF
	const handleDownload = (quotation) => {
		const source = quotation.source || 'quotations';
		const url = `/api/admin/quotations/download?id=${quotation.id}&source=${source}`;
		window.open(url, '_blank');
	};

	// Handle delete quotation
	const handleDelete = async (quotation) => {
		if (
			!confirm(
				`Are you sure you want to delete quotation ${quotation.quotation_number}? This action cannot be undone.`
			)
		) {
			return;
		}

		try {
			const source = quotation.source || 'quotations';
			const res = await fetch(
				`/api/admin/quotations?id=${quotation.id}&source=${source}`,
				{
					method: 'DELETE',
				}
			);
			const data = await res.json();
			if (data.success) {
				fetchQuotations(pagination.page);
			} else {
				alert(data.error || 'Failed to delete quotation');
			}
		} catch (error) {
			console.error('Error deleting quotation:', error);
			alert('Failed to delete quotation');
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
		<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex">
			<Sidebar />
			<div className="flex-1 flex flex-col">
				<Navbar />

				<main className="flex-1 p-6 lg:px-8 xl:px-12 2xl:px-16 overflow-auto max-w-[1800px] mx-auto w-full">
					{/* Header */}
					<div className="flex items-center justify-between mb-6">
						<div>
							<h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
								<DocumentTextIcon className="h-7 w-7 text-purple-600" />
								Quotation (Incoming)
							</h1>
							<p className="text-sm text-gray-500 mt-1">
								View and download incoming quotations
							</p>
						</div>
						<div>
							<button
								onClick={() =>
									router.push('/admin/quotation/new/edit?source=quotations')
								}
								className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 shadow-sm font-medium"
							>
								<PlusIcon className="h-5 w-5" />
								Create Quotation
							</button>
						</div>
					</div>

					{/* Stats Cards */}
					<div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
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
							<div className="text-2xl font-bold text-blue-600">
								{stats.sent || 0}
							</div>
							<div className="text-sm text-gray-600">Sent</div>
						</div>
						<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
							<div className="text-2xl font-bold text-green-600">
								{stats.approved || 0}
							</div>
							<div className="text-sm text-gray-600">Approved</div>
						</div>
						<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
							<div className="text-2xl font-bold text-red-600">
								{stats.rejected || 0}
							</div>
							<div className="text-sm text-gray-600">Rejected</div>
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
										placeholder="Search quotations..."
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
									<option value="sent">Sent</option>
									<option value="approved">Approved</option>
									<option value="rejected">Rejected</option>
								</select>
							</div>

							{/* Source Filter */}
							<div className="flex items-center gap-2">
								<FolderIcon className="h-5 w-5 text-gray-400" />
								<select
									value={sourceFilter}
									onChange={(e) => setSourceFilter(e.target.value)}
									className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
								>
									<option value="all">All Sources</option>
									<option value="projects">From Projects</option>
									<option value="quotations">Standalone</option>
								</select>
							</div>

							{/* Refresh */}
							<button
								onClick={() => fetchQuotations(pagination.page)}
								className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
								title="Refresh"
							>
								<ArrowPathIcon
									className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`}
								/>
							</button>
						</div>
					</div>

					{/* Quotations Table */}
					<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
						{loading ? (
							<div className="flex items-center justify-center py-12">
								<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
								<span className="ml-3 text-gray-600">
									Loading quotations...
								</span>
							</div>
						) : filteredQuotations.length === 0 ? (
							<div className="text-center py-12">
								<DocumentTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
								<p className="text-gray-600">No quotations found</p>
								<p className="text-sm text-gray-500 mt-2">
									Save a quotation in a project to see it here
								</p>
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full">
									<thead className="bg-gray-50 border-b border-gray-200">
										<tr>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
												Quotation #
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
												Client / Project
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
												Subject
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
												Amount
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
												Date
											</th>
											<th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
												Source
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
										{filteredQuotations.map((quotation) => (
											<tr
												key={`${quotation.source}-${quotation.id}`}
												className="hover:bg-gray-50 transition-colors"
											>
												<td className="px-6 py-4">
													<span className="font-medium text-purple-600">
														{quotation.quotation_number}
													</span>
												</td>
												<td className="px-6 py-4">
													<div className="font-medium text-gray-900">
														{quotation.client_name}
													</div>
													{quotation.project_name && (
														<div className="text-sm text-gray-500">
															Project: {quotation.project_name}
														</div>
													)}
													{quotation.client_email && (
														<div className="text-sm text-gray-500">
															{quotation.client_email}
														</div>
													)}
												</td>
												<td className="px-6 py-4 text-gray-600 max-w-[200px] truncate">
													{quotation.subject}
												</td>
												<td className="px-6 py-4 font-semibold text-gray-900">
													{formatCurrency(quotation.total)}
												</td>
												<td className="px-6 py-4 text-gray-600">
													{formatDate(quotation.created_at)}
												</td>
												<td className="px-6 py-4">
													{quotation.source === 'project' ? (
														<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-700">
															<FolderIcon className="h-3 w-3" />
															Project
														</span>
													) : quotation.project_id ? (
														<span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
															<FolderIcon className="h-3 w-3" />
															Attached Project
														</span>
													) : (
														<span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
															Standalone
														</span>
													)}
												</td>
												<td className="px-6 py-4">
													<span
														className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusStyle(quotation.status)}`}
													>
														{quotation.status?.charAt(0).toUpperCase() +
															quotation.status?.slice(1) || 'Draft'}
													</span>
												</td>
												<td className="px-6 py-4">
													<div className="flex items-center justify-center gap-1">
														{(quotation.source === 'quotations' ||
															quotation.source === 'project') && (
															<button
																onClick={() =>
																	openProjectAttachmentModal(quotation)
																}
																className={`p-2 rounded-lg transition-colors ${
																	quotation.source === 'project'
																		? 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
																		: 'text-gray-500 hover:text-purple-600 hover:bg-purple-50'
																}`}
																title={
																	quotation.source === 'project'
																		? 'View Attached Project'
																		: quotation.project_id
																			? 'Change Project'
																			: 'Attach Project'
																}
															>
																<FolderIcon className="h-5 w-5" />
															</button>
														)}
														<button
															onClick={() =>
																router.push(
																	`/admin/quotation/${quotation.id}/view?source=${quotation.source || 'project'}`
																)
															}
															className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
															title="View Quotation"
														>
															<EyeIcon className="h-5 w-5" />
														</button>
														<button
															onClick={() =>
																router.push(
																	`/admin/quotation/${quotation.id}/edit?source=${quotation.source || 'project'}`
																)
															}
															className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
															title="Edit Quotation"
														>
															<PencilSquareIcon className="h-5 w-5" />
														</button>
														<button
															onClick={() => handleDownload(quotation)}
															className="p-2 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
															title="View & Print Quotation"
														>
															<ArrowDownTrayIcon className="h-5 w-5" />
														</button>
														<button
															onClick={() => handleDelete(quotation)}
															className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
															title="Delete Quotation"
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
									{Math.min(
										pagination.page * pagination.limit,
										pagination.total
									)}{' '}
									of {pagination.total}
								</span>
								<div className="flex items-center gap-2">
									<button
										onClick={() => fetchQuotations(pagination.page - 1)}
										disabled={pagination.page === 1}
										className="p-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
									>
										<ChevronLeftIcon className="h-4 w-4" />
									</button>
									<span className="px-3 py-1 text-sm">
										{pagination.page} / {pagination.totalPages}
									</span>
									<button
										onClick={() => fetchQuotations(pagination.page + 1)}
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

				{attachmentModalOpen && selectedQuotation && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4">
						<div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
							<div className="flex items-start justify-between gap-4 border-b border-gray-200 p-6">
								<div>
									<h2 className="text-lg font-semibold text-gray-900">
										{selectedQuotation.source === 'project'
											? 'Project Details'
											: 'Attach Project'}
									</h2>
									<p className="text-sm text-gray-500">
										{selectedQuotation.source === 'project'
											? 'This quotation was created within a project and cannot be re-assigned.'
											: selectedQuotation.project_id
												? 'Change the project attached to this quotation.'
												: 'Attach this standalone quotation to a project.'}
									</p>
								</div>
								<button
									onClick={closeProjectAttachmentModal}
									disabled={savingAttachment}
									className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
								>
									<span className="text-2xl leading-none">&times;</span>
								</button>
							</div>

							<div className="p-6">
								<label className="mb-2 block text-sm font-medium text-gray-700">
									{selectedQuotation.source === 'project'
										? 'Linked project'
										: 'Selected project'}
								</label>
								{selectedProjectLabel ? (
									<div
										className={`mb-4 rounded-lg border p-3 ${
											selectedQuotation.source === 'project'
												? 'border-blue-200 bg-blue-50'
												: 'border-purple-200 bg-purple-50'
										}`}
									>
										<div className="flex items-start justify-between gap-3">
											<div>
												<div
													className={`text-sm font-semibold ${
														selectedQuotation.source === 'project'
															? 'text-blue-900'
															: 'text-purple-900'
													}`}
												>
													{selectedProjectLabel}
												</div>
												{selectedProject?.client_name && (
													<div
														className={
															selectedQuotation.source === 'project'
																? 'text-blue-700 text-sm'
																: 'text-purple-700 text-sm'
														}
													>
														{selectedProject.client_name}
													</div>
												)}
											</div>
											<span
												className={`rounded-full px-2 py-1 text-xs font-medium text-white shrink-0 ${
													selectedQuotation.source === 'project'
														? 'bg-blue-600'
														: 'bg-purple-600'
												}`}
											>
												{selectedQuotation.source === 'project'
													? 'Linked'
													: 'Selected'}
											</span>
										</div>
									</div>
								) : (
									<div className="mb-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-500">
										No project selected. Choose a project below, then click Save
										Project.
									</div>
								)}

								{selectedQuotation.source !== 'project' && (
									<>
										<label className="mb-2 block text-sm font-medium text-gray-700">
											Search projects
										</label>
										<input
											type="text"
											value={attachmentSearch}
											onChange={(e) => setAttachmentSearch(e.target.value)}
											placeholder="Search by project, code, or client"
											className="mb-4 w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-transparent focus:ring-2 focus:ring-purple-500"
										/>

										<div className="mb-4 max-h-72 space-y-2 overflow-auto">
											{projectsLoading ? (
												<div className="rounded-lg border border-gray-200 p-4 text-center text-sm text-gray-500">
													Loading projects...
												</div>
											) : filteredProjects.length > 0 ? (
												filteredProjects.slice(0, 20).map((project, index) => (
													<button
														key={getProjectKey(project) || `project-${index}`}
														type="button"
														onClick={() => {
															setAttachmentProjectId(getProjectKey(project));
															setAttachmentError('');
															setAttachmentSuccess('');
														}}
														className={`w-full rounded-lg border p-3 text-left transition-colors ${
															getProjectKey(project) === attachmentProjectId
																? 'border-purple-600 bg-purple-50'
																: 'border-gray-200 hover:bg-gray-50'
														}`}
													>
														<div className="font-medium text-gray-900">
															{getProjectLabel(project)}
														</div>
														<div className="text-sm text-gray-500">
															{project.client_name || 'No client assigned'}
														</div>
														{getProjectKey(project) === attachmentProjectId && (
															<div className="mt-2 text-xs font-medium text-purple-700">
																Selected project
															</div>
														)}
													</button>
												))
											) : (
												<div className="rounded-lg border border-gray-200 p-4 text-center text-sm text-gray-500">
													No projects found
												</div>
											)}
										</div>
									</>
								)}

								{attachmentSuccess && (
									<div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">
										{attachmentSuccess}
									</div>
								)}
								{attachmentError && (
									<div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
										{attachmentError}
									</div>
								)}

								<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
									<button
										type="button"
										onClick={closeProjectAttachmentModal}
										disabled={savingAttachment}
										className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
									>
										{selectedQuotation.source === 'project'
											? 'Close'
											: 'Cancel'}
									</button>

									{selectedQuotation.source === 'project' ? (
										selectedProject && (
											<button
												type="button"
												onClick={() => {
													closeProjectAttachmentModal();
													router.push(
														`/projects/${selectedProject.project_id || selectedProject.id}`
													);
												}}
												className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
											>
												Goto Project &rarr;
											</button>
										)
									) : (
										<>
											{selectedProject && (
												<button
													type="button"
													onClick={() => {
														closeProjectAttachmentModal();
														router.push(
															`/projects/${selectedProject.project_id || selectedProject.id}`
														);
													}}
													className="rounded-lg border border-purple-300 px-4 py-2 text-sm font-medium text-purple-700 hover:bg-purple-50"
												>
													Goto Project
												</button>
											)}
											<button
												type="button"
												onClick={handleDetachProjectAttachment}
												disabled={
													savingAttachment || !selectedQuotation.project_id
												}
												className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
											>
												{savingAttachment ? 'Saving...' : 'Detach Project'}
											</button>
											<button
												type="button"
												onClick={handleSaveProjectAttachment}
												disabled={
													savingAttachment || attachmentProjectId === ''
												}
												className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
											>
												{savingAttachment ? 'Saving...' : 'Save Project'}
											</button>
										</>
									)}
								</div>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
