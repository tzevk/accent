'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
	PlusIcon,
	ArrowPathIcon,
	EyeIcon,
	PencilIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';

import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import Pagination from '@/components/admin/Pagination';
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
import { Input } from '@/components/ui/form-fields';
import { apiGet, apiDelete } from '@/lib/api-client';
import ResourceFormModal from '@/components/admin/ResourceFormModal';
import { formatCurrency, formatDate } from '@/lib/format';
import type {
	ResourcePageProps,
	ModalMode,
	Column,
	ApiListResponse,
	Pagination as PaginationType,
} from '@/types/admin';

const PAGE_SIZE = 20;

function getNested(
	obj: Record<string, unknown>,
	path: string,
	fallback: unknown
): unknown {
	return (
		path
			?.split('.')
			.reduce(
				(acc: unknown, key: string) =>
					acc == null ? acc : (acc as Record<string, unknown>)[key],
				obj
			) ?? fallback
	);
}

export default function ResourcePage({
	title,
	subtitle,
	endpoint,
	queryKey,
	statsConfig = [],
	columns,
	defaultValues,
	zodSchema,
	formFields,
	transformSubmit,
	searchPlaceholder = 'Search…',
	extraFilters,
	pageSize = PAGE_SIZE,
	canView = true,
	vendorListEndpoint,
	employeeListEndpoint,
	companyListEndpoint,
	rowActions,
	disablePagination,
}: ResourcePageProps) {
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState('');
	const [modalState, setModalState] = useState<{
		mode: ModalMode;
		row: Record<string, unknown> | null;
	}>({ mode: null, row: null });

	const filters = extraFilters ? extraFilters.values : {};
	const queryParams: Record<string, unknown> = { search, ...filters };
	if (!disablePagination) {
		queryParams.page = page;
		queryParams.limit = pageSize;
	}

	const listQuery = useQuery<ApiListResponse>({
		queryKey: [queryKey, queryParams],
		queryFn: () => apiGet(endpoint, queryParams),
	});

	const rows = listQuery.data?.data ?? [];
	const pagination: PaginationType = listQuery.data?.pagination ?? {
		page: 1,
		limit: pageSize,
		total: 0,
		totalPages: 0,
	};
	const stats: Record<string, number | string | null> =
		listQuery.data?.stats ?? {};

	const openCreate = () => setModalState({ mode: 'create', row: null });
	const openEdit = (row: Record<string, unknown>) =>
		setModalState({ mode: 'edit', row });
	const openView = (row: Record<string, unknown>) =>
		setModalState({ mode: 'view', row });
	const closeModal = () => setModalState({ mode: null, row: null });

	const onDelete = async (row: Record<string, unknown>) => {
		if (
			!window.confirm(
				`Are you sure you want to delete this ${title.toLowerCase()}?`
			)
		) {
			return;
		}
		try {
			await apiDelete(`${endpoint}/${row.id}`);
			toast.success(`${title} deleted`);
			listQuery.refetch();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Delete failed');
		}
	};

	return (
		<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col pt-2 pb-4 px-2 sm:px-4 overflow-hidden">
				<div className="max-w-full mx-auto w-full flex-1 min-h-0 flex flex-col space-y-5">
					<header className="flex flex-wrap items-end justify-between gap-3">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">{title}</h1>
							{subtitle ? (
								<p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>
							) : null}
						</div>
						<div className="flex items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => listQuery.refetch()}
								disabled={listQuery.isFetching}
							>
								<ArrowPathIcon
									className={`h-4 w-4 ${listQuery.isFetching ? 'animate-spin' : ''}`}
								/>
								Refresh
							</Button>
							<Button size="sm" onClick={openCreate}>
								<PlusIcon className="h-4 w-4" />
								Add {title}
							</Button>
						</div>
					</header>

					{statsConfig.length > 0 ? (
						<div className="flex gap-4 mb-6">
							{statsConfig.map((s) => {
								const toneColorMap: Record<string, string> = {
									purple: 'text-purple-600',
									green: 'text-green-600',
									amber: 'text-amber-600',
									rose: 'text-rose-600',
									sky: 'text-sky-600',
									slate: 'text-slate-600',
								};
								const displayValue = s.money
									? formatCurrency(stats[s.key] ?? 0)
									: (stats[s.key] ?? 0).toLocaleString('en-IN');
								return (
									<div
										key={s.key}
										className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 min-w-0 px-3 py-2"
									>
										<div
											className={`text-lg font-bold ${toneColorMap[s.tone] || 'text-gray-900'}`}
										>
											{displayValue}
										</div>
										<div className="text-xs text-gray-600">{s.label}</div>
									</div>
								);
							})}
						</div>
					) : null}

					<div className="rounded-xl border border-gray-200 bg-white shadow-sm flex-1 min-h-0 flex flex-col overflow-hidden">
						<div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
							<div className="relative flex-1 min-w-[200px] max-w-md">
								<Input
									placeholder={searchPlaceholder}
									value={search}
									onChange={(e) => {
										setSearch(e.target.value);
										setPage(1);
									}}
								/>
							</div>
							{extraFilters ? extraFilters.node : null}
						</div>

						<div className="flex-1 min-h-0 overflow-auto">
							<Table>
								<TableHeader>
									<TableRow className="sticky top-0 z-10 bg-white">
										{columns.map((c: Column) => (
											<TableHead key={c.key} className={c.headClassName}>
												{c.label}
											</TableHead>
										))}
										<TableHead className="text-center">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{listQuery.isLoading ? (
										<TableEmpty>Loading…</TableEmpty>
									) : rows.length === 0 ? (
										<TableEmpty>No records found.</TableEmpty>
									) : (
										rows.map((row) => (
											<TableRow key={row.id as string}>
												{columns.map((c: Column) => {
													const value = getNested(row, c.key, '');
													let display: React.ReactNode =
														value as React.ReactNode;
													if (c.money)
														display = formatCurrency(value as number);
													else if (c.date)
														display = formatDate(value as string);
													else if (c.render) display = c.render(row);
													return (
														<TableCell key={c.key} className={c.cellClassName}>
															{display ?? '—'}
														</TableCell>
													);
												})}
												<TableCell className="text-center">
													<div className="inline-flex items-center gap-1">
														{canView ? (
															<button
																onClick={() => openView(row)}
																className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
																title="View"
															>
																<EyeIcon className="h-4 w-4" />
															</button>
														) : null}
														<button
															onClick={() => openEdit(row)}
															className="p-1.5 text-gray-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
															title="Edit"
														>
															<PencilIcon className="h-4 w-4" />
														</button>
														<button
															onClick={() => onDelete(row)}
															className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
															title="Delete"
														>
															<TrashIcon className="h-4 w-4" />
														</button>
														{rowActions ? rowActions(row) : null}
													</div>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
						{!disablePagination ? (
							<div className="border-t border-gray-100 px-4">
								<Pagination
									page={pagination.page}
									totalPages={pagination.totalPages}
									total={pagination.total}
									onPageChange={setPage}
								/>
							</div>
						) : null}
					</div>
				</div>
			</div>

			{modalState.mode ? (
				<ResourceFormModal
					mode={modalState.mode}
					row={modalState.row}
					title={title}
					endpoint={endpoint}
					defaultValues={defaultValues}
					zodSchema={zodSchema}
					formFields={formFields}
					transformSubmit={transformSubmit}
					vendorListEndpoint={vendorListEndpoint}
					employeeListEndpoint={employeeListEndpoint}
					companyListEndpoint={companyListEndpoint}
					onClose={closeModal}
					onSaved={() => {
						closeModal();
						listQuery.refetch();
					}}
				/>
			) : null}
		</div>
	);
}
