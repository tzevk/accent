'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
	PlusIcon,
	ArrowPathIcon,
	PencilIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import Navbar from '@/components/Navbar';
import AccessGuard from '@/components/AccessGuard';
import {
	Table,
	TableHeader,
	TableBody,
	TableHead,
	TableRow,
	TableCell,
	TableEmpty,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { apiGet, apiDelete } from '@/lib/api-client';
import ResourceFormModal from '@/components/admin/ResourceFormModal';
import type { ModalMode, ApiListResponse, FormField } from '@/types/admin';

interface CategoryRow {
	id: number;
	category_name: string;
}

const schema = z.object({
	category_name: z.string().trim().min(1, 'Category name is required'),
});

const defaultValues = { category_name: '' };

const formFields: FormField[] = [
	{
		name: 'category_name',
		label: 'Category Name',
		type: 'text',
		required: true,
	},
];

export default function DeliverableCategoriesMasterPage() {
	const { data, refetch, isLoading } = useQuery<ApiListResponse>({
		queryKey: ['deliverable-categories'],
		queryFn: () => apiGet('/api/masters/deliverable-categories'),
	});
	const [modalState, setModalState] = useState<{
		mode: ModalMode;
		row: Record<string, unknown> | null;
	}>({ mode: null, row: null });

	const rows = (data?.data ?? []) as unknown as CategoryRow[];

	const openCreate = () => setModalState({ mode: 'create', row: null });
	const openEdit = (row: CategoryRow) =>
		setModalState({
			mode: 'edit',
			row: row as unknown as Record<string, unknown>,
		});
	const closeModal = () => setModalState({ mode: null, row: null });

	const handleDelete = async (row: CategoryRow) => {
		if (!window.confirm(`Delete category "${row.category_name}"?`)) return;
		try {
			await apiDelete(`/api/masters/deliverable-categories/${row.id}`);
			toast.success('Category deleted');
			refetch();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Delete failed');
		}
	};

	return (
		<AccessGuard resource="deliverables" permission="read" fallback={null}>
			<div className="min-h-screen bg-gray-50">
				<Navbar />
				<main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<div className="space-y-5">
						<header className="flex flex-wrap items-end justify-between gap-3">
							<div>
								<h1 className="text-2xl font-bold text-gray-900">
									Deliverable Category Master
								</h1>
								<p className="text-sm text-gray-500 mt-0.5">
									Manage the master list of deliverable categories
								</p>
							</div>
							<div className="flex items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => refetch()}
									disabled={isLoading}
								>
									<ArrowPathIcon
										className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
									/>
									Refresh
								</Button>
								<Button size="sm" onClick={openCreate}>
									<PlusIcon className="h-4 w-4" />
									Add Category
								</Button>
							</div>
						</header>

						<div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Category Name</TableHead>
										<TableHead className="text-center">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{isLoading ? (
										<TableEmpty>Loading…</TableEmpty>
									) : rows.length === 0 ? (
										<TableEmpty>No categories found.</TableEmpty>
									) : (
										rows.map((row) => (
											<TableRow key={row.id}>
												<TableCell className="font-medium">
													{row.category_name}
												</TableCell>
												<TableCell className="text-center">
													<div className="inline-flex items-center gap-1">
														<button
															onClick={() => openEdit(row)}
															className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
															title="Edit category"
														>
															<PencilIcon className="h-4 w-4" />
														</button>
														<button
															onClick={() => handleDelete(row)}
															className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
															title="Delete category"
														>
															<TrashIcon className="h-4 w-4" />
														</button>
													</div>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
					</div>

					{modalState.mode ? (
						<ResourceFormModal
							mode={modalState.mode}
							row={modalState.row}
							title={
								modalState.mode === 'create' ? 'Add Category' : 'Edit Category'
							}
							endpoint="/api/masters/deliverable-categories"
							defaultValues={defaultValues}
							zodSchema={schema}
							formFields={formFields}
							onClose={closeModal}
							onSaved={() => {
								closeModal();
								refetch();
							}}
						/>
					) : null}
				</main>
			</div>
		</AccessGuard>
	);
}
