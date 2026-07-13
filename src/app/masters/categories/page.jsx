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

export default function CategoryMaster() {
	const [categories, setCategories] = useState([]);
	const [loading, setLoading] = useState(true);
	const [searchTerm, setSearchTerm] = useState('');
	const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
	const [activeTab, setActiveTab] = useState('list');
	const [submitting, setSubmitting] = useState(false);
	const [editingId, setEditingId] = useState(null);

	const searchDebounceRef = useRef(null);

	const [formData, setFormData] = useState({
		category_name: '',
		is_active: true,
	});

	const fetchCategories = async (searchValue) => {
		try {
			setLoading(true);
			const search =
				typeof searchValue !== 'undefined' ? searchValue : debouncedSearchTerm;
			const response = await fetch('/api/masters/categories');
			const result = await response.json();

			if (result.success) {
				let filtered = result.data || [];
				if (search) {
					filtered = filtered.filter((item) =>
						item.category_name?.toLowerCase().includes(search.toLowerCase())
					);
				}
				setCategories(filtered);
			}
		} catch (error) {
			console.error('Error fetching categories:', error);
			setCategories([]);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (activeTab === 'list') {
			fetchCategories();
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
				? `/api/masters/categories?id=${editingId}`
				: '/api/masters/categories';

			const response = await fetch(url, {
				method: editingId ? 'PUT' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(formData),
			});

			const result = await response.json();

			if (result.success) {
				alert(
					editingId
						? 'Category updated successfully!'
						: 'Category added successfully!'
				);
				resetForm();
				fetchCategories();
				setActiveTab('list');
			} else {
				alert('Error: ' + result.error);
			}
		} catch (error) {
			console.error('Error:', error);
			alert('Error saving category');
		} finally {
			setSubmitting(false);
		}
	};

	const handleEdit = (category) => {
		setFormData({
			category_name: category.category_name || '',
			is_active: isActive(category.is_active),
		});
		setEditingId(category.id);
		setActiveTab('add');
	};

	const handleDelete = async (id, categoryName) => {
		if (!confirm(`Are you sure you want to delete "${categoryName}"?`)) {
			return;
		}

		try {
			const response = await fetch(`/api/masters/categories?id=${id}`, {
				method: 'DELETE',
			});
			const result = await response.json();

			if (result.success) {
				alert('Category deleted successfully!');
				fetchCategories();
			} else {
				alert('Error deleting category: ' + result.error);
			}
		} catch (error) {
			console.error('Error:', error);
			alert('Error deleting category');
		}
	};

	const resetForm = () => {
		setFormData({
			category_name: '',
			is_active: true,
		});
		setEditingId(null);
	};

	const renderCategoriesList = () => (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
				<div className="bg-white rounded-lg border border-gray-200 p-6">
					<div className="flex items-center">
						<span className="h-10 w-10 rounded-full bg-[#64126D] border border-purple-200 flex items-center justify-center text-white shadow-sm">
							<TagIcon className="h-5 w-5" />
						</span>
						<div className="ml-4">
							<p className="text-sm font-medium text-black">Total Categories</p>
							<p className="text-2xl font-semibold text-gray-900">
								{categories.length}
							</p>
						</div>
					</div>
				</div>

				<div className="bg-white rounded-lg border border-gray-200 p-6">
					<div className="flex items-center">
						<TagIcon className="h-8 w-8 text-green-500" />
						<div className="ml-4">
							<p className="text-sm font-medium text-black">
								Active Categories
							</p>
							<p className="text-2xl font-semibold text-gray-900">
								{categories.filter((item) => isActive(item.is_active)).length}
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
								placeholder="Search categories..."
								value={searchTerm}
								onChange={(e) => setSearchTerm(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') {
										if (searchDebounceRef.current) {
											clearTimeout(searchDebounceRef.current);
										}
										setDebouncedSearchTerm(searchTerm.trim());
										fetchCategories(searchTerm.trim());
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
						<p className="mt-2 text-gray-600">Loading categories...</p>
					</div>
				) : categories.length === 0 ? (
					<div className="p-8 text-center">
						<TagIcon className="mx-auto h-12 w-12 text-gray-400" />
						<h3 className="mt-2 text-sm font-medium text-gray-900">
							No categories found
						</h3>
						<p className="mt-1 text-sm text-gray-500">
							Get started by adding a new category.
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
										Category
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
								{categories.map((category, index) => (
									<tr key={category.id} className="hover:bg-gray-50">
										<td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
											{index + 1}
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center">
												<div className="h-10 w-10 flex-shrink-0 bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-full flex items-center justify-center text-white font-medium">
													{category.category_name
														?.substring(0, 2)
														.toUpperCase() || 'CT'}
												</div>
												<div className="ml-4">
													<div className="text-sm font-medium text-gray-900">
														{category.category_name}
													</div>
												</div>
											</div>
										</td>
										<td className="px-6 py-4 whitespace-nowrap">
											<span
												className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
													isActive(category.is_active)
														? 'bg-green-100 text-green-800'
														: 'bg-gray-100 text-gray-800'
												}`}
											>
												{isActive(category.is_active) ? 'Active' : 'Inactive'}
											</span>
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
											<div className="flex justify-end space-x-2">
												<button
													onClick={() => handleEdit(category)}
													className="p-1 text-gray-400 hover:text-blue-600 rounded-full transition-colors"
													title="Edit Category"
												>
													<PencilIcon className="h-5 w-5" />
												</button>
												<button
													onClick={() =>
														handleDelete(category.id, category.category_name)
													}
													className="p-1 text-gray-400 hover:text-red-600 rounded-full transition-colors"
													title="Delete Category"
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

	const renderAddCategoryForm = () => (
		<div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
			<div className="bg-gradient-to-r from-gray-50 to-gray-100 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
				<div>
					<h3 className="text-lg font-semibold text-gray-900">
						{editingId ? 'Edit Category' : 'Add New Category'}
					</h3>
					<p className="text-sm text-gray-600 mt-1">
						Manage categories for organizing records
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
						form="add-category-form"
						disabled={submitting}
						className="px-4 py-2 text-sm text-white bg-gradient-to-r from-[#64126D] to-[#86288F] rounded-md hover:from-[#86288F] hover:to-[#64126D] transition-all flex items-center space-x-2 disabled:opacity-50 shadow-lg"
					>
						<CheckIcon className="h-4 w-4" />
						<span>{submitting ? 'Saving...' : 'Save Category'}</span>
					</button>
				</div>
			</div>

			<form id="add-category-form" onSubmit={handleSubmit} className="p-6">
				<div className="space-y-6">
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Category Name <span className="text-red-500">*</span>
						</label>
						<input
							type="text"
							name="category_name"
							value={formData.category_name}
							onChange={handleFormChange}
							required
							className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#64126D] focus:border-transparent"
							placeholder="e.g., Hardware, Software, Services"
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
							Active Category
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
								Category Master
							</h1>
							<p className="mt-1 text-sm text-gray-500">
								Manage categories for organizing records
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
									Add Category
								</button>
							</div>
						)}
					</div>

					{activeTab === 'list'
						? renderCategoriesList()
						: renderAddCategoryForm()}
				</main>
			</div>
		</AccessGuard>
	);
}
