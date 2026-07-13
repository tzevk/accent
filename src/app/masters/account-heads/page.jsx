'use client';

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import { useState, useEffect, useRef } from 'react';
import {
	PlusIcon,
	PencilIcon,
	TrashIcon,
	MagnifyingGlassIcon,
	CheckIcon,
	XMarkIcon,
	TagIcon,
} from '@heroicons/react/24/outline';

const isActive = (value) => value === true || value === 1 || value === '1';

export default function AccountHeadMaster() {
	const [accountHeads, setAccountHeads] = useState([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
	const [activeTab, setActiveTab] = useState('list');
	const [submitting, setSubmitting] = useState(false);
	const [editingId, setEditingId] = useState(null);

	const searchDebounceRef = useRef(null);

	const [formData, setFormData] = useState({
		account_head_name: '',
		is_active: true,
	});

	const fetchAccountHeads = async (searchValue) => {
		try {
			setLoading(true);
			const search =
				typeof searchValue !== 'undefined' ? searchValue : debouncedSearchTerm;
			const response = await fetch('/api/masters/account-heads');
			const result = await response.json();

			if (result.success) {
				let filtered = result.data || [];
				if (search) {
					filtered = filtered.filter((item) =>
						item.account_head_name?.toLowerCase().includes(search.toLowerCase())
					);
				}
				setAccountHeads(filtered);
			}
		} catch (error) {
			console.error('Error fetching account heads:', error);
			setAccountHeads([]);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (activeTab === 'list') {
			fetchAccountHeads();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [debouncedSearchTerm, activeTab]);

	useEffect(() => {
		if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
		searchDebounceRef.current = setTimeout(() => {
			setDebouncedSearchTerm(searchTerm.trim());
		}, 350);
		return () => {
			if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
		};
	}, [searchTerm]);

	const handleFormChange = (e) => {
		const { name, value, type, checked } = e.target;
		setFormData((prev) => ({
			...prev,
			[name]: type === 'checkbox' ? checked : value,
		}));
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		setSubmitting(true);

		try {
			const url = editingId
				? `/api/masters/account-heads?id=${editingId}`
				: '/api/masters/account-heads';

			const response = await fetch(url, {
				method: editingId ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(formData),
			});

			const result = await response.json();

			if (result.success) {
				alert(
					editingId
						? 'Account head updated successfully!'
						: 'Account head added successfully!'
				);
				resetForm();
				fetchAccountHeads();
				setActiveTab('list');
			} else {
				alert('Error: ' + result.error);
			}
		} catch (error) {
			console.error('Error:', error);
			alert('Error saving account head');
		} finally {
			setSubmitting(false);
		}
	};

	const handleEdit = (head) => {
		setFormData({
			account_head_name: head.account_head_name || '',
			is_active: isActive(head.is_active),
		});
		setEditingId(head.id);
		setActiveTab('add');
	};

	const handleDelete = async (id, name) => {
		if (!confirm(`Are you sure you want to delete "${name}"?`)) {
			return;
		}

		try {
			const response = await fetch(`/api/masters/account-heads?id=${id}`, {
				method: 'DELETE',
			});
			const result = await response.json();

			if (result.success) {
				alert('Account head deleted successfully!');
				fetchAccountHeads();
			} else {
				alert('Error deleting account head: ' + result.error);
			}
		} catch (error) {
			console.error('Error:', error);
			alert('Error deleting account head');
		}
	};

	const resetForm = () => {
		setFormData({
			account_head_name: '',
			is_active: true,
		});
		setEditingId(null);
	};

	const renderList = () => (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
				<div className="bg-white rounded-lg border border-gray-200 p-6">
					<div className="flex items-center">
						<span className="h-10 w-10 rounded-full bg-[#64126D] border border-purple-200 flex items-center justify-center text-white shadow-sm">
							<TagIcon className="h-5 w-5" />
						</span>
						<div className="ml-4">
							<p className="text-sm font-medium text-black">
								Total Account Heads
							</p>
							<p className="text-2xl font-semibold text-gray-900">
								{accountHeads.length}
							</p>
						</div>
					</div>
				</div>

				<div className="bg-white rounded-lg border border-gray-200 p-6">
					<div className="flex items-center">
						<TagIcon className="h-8 w-8 text-green-500" />
						<div className="ml-4">
							<p className="text-sm font-medium text-black">
								Active Account Heads
							</p>
							<p className="text-2xl font-semibold text-gray-900">
								{accountHeads.filter((item) => isActive(item.is_active)).length}
							</p>
						</div>
					</div>
				</div>
			</div>

			<div className="bg-white rounded-lg border border-gray-200 p-4">
				<div className="flex flex-col lg:flex-row gap-3 lg:items-center">
					<div className="flex-1">
						<div className="relative">
							<MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
							<input
								type="text"
								placeholder="Search account heads..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										if (searchDebounceRef.current) {
											clearTimeout(searchDebounceRef.current);
										}
										setDebouncedSearchTerm(searchTerm.trim());
										fetchAccountHeads(searchTerm.trim());
									}
								}}
								className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
							/>
						</div>
					</div>
				</div>
			</div>

			<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
				{loading ? (
					<div className="p-8 text-center">
						<div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#64126D]"></div>
						<p className="mt-2 text-gray-600">Loading account heads...</p>
					</div>
				) : accountHeads.length === 0 ? (
					<div className="p-8 text-center">
						<TagIcon className="mx-auto h-12 w-12 text-gray-400" />
						<h3 className="mt-2 text-sm font-medium text-gray-900">
							No account heads found
						</h3>
						<p className="mt-1 text-sm text-gray-500">
							Get started by adding a new account head.
						</p>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="min-w-full divide-y divide-gray-200">
							<thead className="bg-gray-50">
								<tr>
									<th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Sr
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Account Head
									</th>
									<th className="px-6 py-3 text-left text-xs font-medium text-black uppercase tracking-wider">
										Status
									</th>
									<th className="px-6 py-3 text-right text-xs font-medium text-black uppercase tracking-wider">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="bg-white divide-y divide-gray-200">
								{accountHeads.map((head, index) => (
									<tr key={head.id} className="hover:bg-gray-50">
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{index + 1}
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center">
												<div className="h-10 w-10 flex-shrink-0 bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-full flex items-center justify-center text-white font-medium">
													{head.account_head_name
														?.substring(0, 2)
														.toUpperCase() || 'AH'}
												</div>
												<div className="ml-4">
													<div className="text-sm font-medium text-gray-900">
														{head.account_head_name}
													</div>
												</div>
											</div>
										</td>
										<td className="px-6 py-4 whitespace-nowrap">
											<span
												className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
													isActive(head.is_active)
														? 'bg-green-100 text-green-800'
														: 'bg-gray-100 text-gray-800'
												}`}
											>
												{isActive(head.is_active) ? 'Active' : 'Inactive'}
											</span>
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
											<div className="flex justify-end space-x-2">
												<button
													onClick={() => handleEdit(head)}
													className="p-1 text-gray-400 hover:text-blue-600 rounded-full transition-colors"
													title="Edit Account Head"
												>
													<PencilIcon className="h-5 w-5" />
												</button>
												<button
													onClick={() =>
														handleDelete(head.id, head.account_head_name)
													}
													className="p-1 text-gray-400 hover:text-red-600 rounded-full transition-colors"
													title="Delete Account Head"
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
		</div>
	);

	const renderForm = () => (
		<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
			<div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
				<div>
					<h3 className="text-lg font-semibold text-gray-900">
						{editingId ? 'Edit Account Head' : 'Add New Account Head'}
					</h3>
					<p className="text-sm text-gray-600 mt-1">
						Manage account heads for organizing records
					</p>
				</div>
				<div className="flex space-x-3">
					<button
						onClick={() => {
							setActiveTab('list');
							resetForm();
						}}
						className="px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center space-x-2"
					>
						<XMarkIcon className="h-4 w-4" />
						<span>Cancel</span>
					</button>
					<button
						type="submit"
						form="add-account-head-form"
						disabled={submitting}
						className="px-4 py-2 text-sm text-white bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-md hover:from-[#86288F] hover:to-[#64126D] transition-all flex items-center space-x-2 disabled:opacity-50 shadow-lg"
					>
						<CheckIcon className="h-4 w-4" />
						<span>{submitting ? 'Saving...' : 'Save Account Head'}</span>
					</button>
				</div>
			</div>

			<form id="add-account-head-form" onSubmit={handleSubmit} className="p-6">
				<div className="space-y-6">
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Account Head Name <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							name="account_head_name"
							value={formData.account_head_name}
							onChange={handleFormChange}
							required
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
							placeholder="e.g., Salaries & Wages, Office Rent"
						/>
					</div>

					<div className="flex items-center">
						<input
							type="checkbox"
							id="is_active"
							name="is_active"
							checked={formData.is_active}
							onChange={handleFormChange}
							className="h-4 w-4 text-[#64126D] focus:ring-[#64126D] border-gray-300 rounded"
						/>
						<label
							htmlFor="is_active"
							className="ml-2 block text-sm text-gray-900"
						>
							Active Account Head
						</label>
					</div>
				</div>
			</form>
		</div>
	);

	return (
		<AccessGuard resource="companies" permission="read">
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">
								Account Head Master
							</h1>
							<p className="mt-1 text-sm text-gray-500">
								Manage account heads for cash voucher line items
							</p>
						</div>
						{activeTab === 'list' && (
							<div className="mt-4 sm:mt-0 flex gap-3">
								<button
									onClick={() => {
										setActiveTab('add');
										resetForm();
									}}
									className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-gradient-to-r from-[#64126D] to-[#86288F] hover:from-[#86288F] hover:to-[#64126D] shadow-sm transition-all"
								>
									<PlusIcon className="h-5 w-5 mr-2 -ml-1" />
									Add Account Head
								</button>
							</div>
						)}
					</div>

					{activeTab === 'list' ? renderList() : renderForm()}
				</main>
			</div>
		</AccessGuard>
	);
}
