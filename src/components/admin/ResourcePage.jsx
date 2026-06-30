'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PlusIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { useForm } from '@tanstack/react-form';

import Navbar from '@/components/Navbar';
import Sidebar from '@/components/Sidebar';
import StatsCard from '@/components/admin/StatsCard';
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
import Modal from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import {
	Input,
	Textarea,
	Select,
	FieldGroup,
} from '@/components/ui/form-fields';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api-client';
import { formatCurrency, formatDate } from '@/lib/format';

const PAGE_SIZE = 20;

function getNested(obj, path, fallback) {
	return (
		path
			?.split('.')
			.reduce((acc, key) => (acc == null ? acc : acc[key]), obj) ?? fallback
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
}) {
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState('');
	const [modalState, setModalState] = useState({ mode: null, row: null });

	const filters = extraFilters ? extraFilters.values : {};
	const queryParams = { page, limit: pageSize, search, ...filters };

	const listQuery = useQuery({
		queryKey: [queryKey, queryParams],
		queryFn: () => apiGet(endpoint, queryParams),
	});

	const rows = listQuery.data?.data ?? [];
	const pagination = listQuery.data?.pagination ?? {
		page: 1,
		limit: pageSize,
		total: 0,
		totalPages: 0,
	};
	const stats = listQuery.data?.stats ?? {};

	const openCreate = () => setModalState({ mode: 'create', row: null });
	const openEdit = (row) => setModalState({ mode: 'edit', row });
	const openView = (row) => setModalState({ mode: 'view', row });
	const closeModal = () => setModalState({ mode: null, row: null });

	const onDelete = async (row) => {
		if (
			!window.confirm(
				`Delete this ${title.toLowerCase()}? This cannot be undone.`
			)
		) {
			return;
		}
		try {
			await apiDelete(`${endpoint}/${row.id}`);
			toast.success(`${title} deleted`);
			listQuery.refetch();
		} catch (err) {
			toast.error(err.message || 'Delete failed');
		}
	};

	return (
		<div className="h-screen bg-[var(--page-bg, #fafafa)] flex flex-col overflow-hidden">
			<Navbar />
			<Sidebar />
			<div className="content-with-sidebar flex-1 min-h-0 flex flex-col pt-20 pb-6 px-4 sm:px-6 lg:px-8 overflow-hidden">
				<div className="max-w-7xl mx-auto w-full flex-1 min-h-0 flex flex-col space-y-5">
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
						<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
							{statsConfig.map((s) => (
								<StatsCard
									key={s.key}
									label={s.label}
									value={
										s.money
											? formatCurrency(stats[s.key] ?? 0)
											: (stats[s.key] ?? 0).toLocaleString('en-IN')
									}
									tone={s.tone}
									icon={s.icon}
									hint={s.hint}
								/>
							))}
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
										{columns.map((c) => (
											<TableHead key={c.key} className={c.headClassName}>
												{c.label}
											</TableHead>
										))}
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{listQuery.isLoading ? (
										<TableEmpty>Loading…</TableEmpty>
									) : rows.length === 0 ? (
										<TableEmpty>No records found.</TableEmpty>
									) : (
										rows.map((row) => (
											<TableRow key={row.id}>
												{columns.map((c) => {
													const value = getNested(row, c.key, '');
													let display = value;
													if (c.money) display = formatCurrency(value);
													else if (c.date) display = formatDate(value);
													else if (c.render) display = c.render(row);
													return (
														<TableCell key={c.key} className={c.cellClassName}>
															{display ?? '—'}
														</TableCell>
													);
												})}
												<TableCell className="text-right">
													<div className="inline-flex items-center gap-1.5">
														{canView ? (
															<Button
																variant="ghost"
																size="sm"
																onClick={() => openView(row)}
															>
																View
															</Button>
														) : null}
														<Button
															variant="ghost"
															size="sm"
															onClick={() => openEdit(row)}
														>
															Edit
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => onDelete(row)}
															className="text-rose-600 hover:bg-rose-50"
														>
															Delete
														</Button>
													</div>
												</TableCell>
											</TableRow>
										))
									)}
								</TableBody>
							</Table>
						</div>
						<div className="border-t border-gray-100 px-4">
							<Pagination
								page={pagination.page}
								totalPages={pagination.totalPages}
								total={pagination.total}
								onPageChange={setPage}
							/>
						</div>
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

function ResourceFormModal({
	mode,
	row,
	title,
	endpoint,
	defaultValues,
	zodSchema,
	formFields,
	transformSubmit,
	onClose,
	onSaved,
}) {
	const isView = mode === 'view';
	const isEdit = mode === 'edit';

	const form = useForm({
		defaultValues: { ...defaultValues, ...(row || {}) },
		onSubmit: async ({ value }) => {
			const parsed = zodSchema.safeParse(value);
			if (!parsed.success) {
				const first = parsed.error.issues[0];
				throw new Error(`${first.path.join('.')}: ${first.message}`);
			}
			const payload = transformSubmit ? transformSubmit(value) : value;
			try {
				if (isEdit) {
					await apiPut(`${endpoint}/${row.id}`, payload);
					toast.success(`${title} updated`);
				} else {
					await apiPost(endpoint, payload);
					toast.success(`${title} created`);
				}
				onSaved();
			} catch (err) {
				toast.error(err.message || 'Save failed');
				throw err;
			}
		},
	});

	return (
		<Modal
			open
			onClose={onClose}
			title={`${isView ? 'View' : isEdit ? 'Edit' : 'New'} ${title}`}
			size="lg"
			footer={
				isView ? (
					<Button variant="outline" size="sm" onClick={onClose}>
						Close
					</Button>
				) : (
					<>
						<Button variant="outline" size="sm" onClick={onClose}>
							Cancel
						</Button>
						<form.Subscribe selector={(s) => [s.isSubmitting]}>
							{([isSubmitting]) => (
								<Button
									size="sm"
									form="resource-form"
									type="submit"
									loading={isSubmitting}
									disabled={isView}
								>
									{isEdit ? 'Save changes' : `Create ${title}`}
								</Button>
							)}
						</form.Subscribe>
					</>
				)
			}
		>
			<form
				id="resource-form"
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					form.handleSubmit();
				}}
				className="grid grid-cols-1 sm:grid-cols-2 gap-3"
			>
				{formFields.map((field) => (
					<form.Field key={field.name} name={field.name}>
						{(fp) => {
							const error = fp.state.meta.errors?.[0];
							const commonProps = {
								id: field.name,
								value: fp.state.value ?? '',
								onBlur: fp.handleBlur,
								onChange: (e) => fp.handleChange(e.target.value),
								disabled: isView,
							};
							return (
								<FieldGroup
									label={field.label}
									required={field.required}
									hint={field.hint}
									error={error ? String(error) : undefined}
									className={field.fullWidth ? 'sm:col-span-2' : undefined}
								>
									{field.type === 'textarea' ? (
										<Textarea {...commonProps} rows={field.rows ?? 3} />
									) : field.type === 'select' ? (
										<Select {...commonProps}>
											<option value="">{field.placeholder ?? 'Select…'}</option>
											{field.options?.map((opt) => (
												<option key={opt.value} value={opt.value}>
													{opt.label}
												</option>
											))}
										</Select>
									) : (
										<Input
											{...commonProps}
											type={field.type ?? 'text'}
											placeholder={field.placeholder}
											min={field.min}
											step={field.step}
										/>
									)}
								</FieldGroup>
							);
						}}
					</form.Field>
				))}
			</form>
		</Modal>
	);
}
