'use client';

import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useRef, useMemo } from 'react';
import {
	PlusIcon,
	ArrowPathIcon,
	EyeIcon,
	PencilIcon,
	TrashIcon,
} from '@heroicons/react/24/outline';
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
import type {
	ResourcePageProps,
	ResourceFormModalProps,
	ModalMode,
	Column,
	FormField,
	ApiListResponse,
	VendorListItem,
	EmployeeListItem,
	VendorListResponse,
	EmployeeListResponse,
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
}: ResourcePageProps) {
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState('');
	const [modalState, setModalState] = useState<{
		mode: ModalMode;
		row: Record<string, unknown> | null;
	}>({ mode: null, row: null });

	const filters = extraFilters ? extraFilters.values : {};
	const queryParams = { page, limit: pageSize, search, ...filters };

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
												<TableCell className="text-right">
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
					vendorListEndpoint={vendorListEndpoint}
					employeeListEndpoint={employeeListEndpoint}
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
	vendorListEndpoint,
	employeeListEndpoint,
	onClose,
	onSaved,
}: ResourceFormModalProps) {
	const isView = mode === 'view';
	const isEdit = mode === 'edit';

	const form = useForm({
		defaultValues: {
			...defaultValues,
			...Object.fromEntries(
				Object.entries(row || {}).filter(([, v]) => v !== null)
			),
		},
		onSubmit: async ({ value }: { value: Record<string, unknown> }) => {
			const dateFields = new Set(
				formFields.filter((f) => f.type === 'date').map((f) => f.name)
			);
			const numberFields = new Set(
				formFields.filter((f) => f.type === 'number').map((f) => f.name)
			);
			const sanitized: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(value)) {
				if (v === null) {
					sanitized[k] = dateFields.has(k) ? null : '';
				} else if (v === '' && dateFields.has(k)) {
					sanitized[k] = null;
				} else if (v === '' && numberFields.has(k)) {
					sanitized[k] = 0;
				} else {
					sanitized[k] = v;
				}
			}
			const parsed = zodSchema.safeParse(sanitized);
			if (!parsed.success) {
				const first = parsed.error.issues[0];
				throw new Error(`${first.path.join('.')}: ${first.message}`);
			}
			const payload = transformSubmit ? transformSubmit(sanitized) : sanitized;
			try {
				if (isEdit) {
					await apiPut(
						`${endpoint}/${(row as Record<string, unknown>).id}`,
						payload
					);
					toast.success(`${title} updated`);
				} else {
					await apiPost(endpoint, payload);
					toast.success(`${title} created`);
				}
				onSaved();
			} catch (err) {
				toast.error(err instanceof Error ? err.message : 'Save failed');
				throw err;
			}
		},
	});

	const vendorAutofillField = formFields.find((f) => f.vendorAutofill);
	const datalistId = useMemo(
		() => `vendor-autofill-${Math.random().toString(36).slice(2, 9)}`,
		[]
	);

	const vendorsQuery = useQuery<VendorListResponse>({
		queryKey: ['vendor-autofill-list', vendorListEndpoint],
		queryFn: () => apiGet<VendorListResponse>(vendorListEndpoint!),
		enabled: Boolean(vendorListEndpoint) && Boolean(vendorAutofillField),
		staleTime: 5 * 60 * 1000,
	});
	const vendorList = useMemo(
		() => vendorsQuery.data?.data ?? [],
		[vendorsQuery.data]
	);

	const employeeAutofillField = formFields.find((f) => f.employeeAutofill);
	const employeeDatalistId = useMemo(
		() => `employee-autofill-${Math.random().toString(36).slice(2, 9)}`,
		[]
	);

	const employeesQuery = useQuery<EmployeeListResponse>({
		queryKey: ['employee-autofill-list', employeeListEndpoint],
		queryFn: () => apiGet<EmployeeListResponse>(employeeListEndpoint!),
		enabled: Boolean(employeeListEndpoint) && Boolean(employeeAutofillField),
		staleTime: 5 * 60 * 1000,
	});
	const employeeList = useMemo(
		() => employeesQuery.data?.employees ?? [],
		[employeesQuery.data]
	);

	const lastFilledNameRef = useRef('');

	useEffect(() => {
		if (!vendorAutofillField || isView) return;
		const { unsubscribe } = form.store.subscribe(() => {
			if (!vendorList.length) return;
			const currentName = form.getFieldValue(vendorAutofillField.name);
			if (
				typeof currentName !== 'string' ||
				currentName === lastFilledNameRef.current
			) {
				return;
			}
			const match = vendorList.find(
				(v) => (v.vendor_name || '').toLowerCase() === currentName.toLowerCase()
			);
			if (!match) return;
			lastFilledNameRef.current = currentName;
			const addrParts = [
				match.address_street,
				match.address_city,
				match.address_state,
				match.address_country,
				match.address_pin,
			]
				.filter(Boolean)
				.join(', ');
			const updates: Record<string, string> = {
				vendor_email: match.email || '',
				vendor_phone: match.phone || '',
				vendor_gstin: match.gst_vat_tax_id || '',
				vendor_pan: match.pan_legal_reg_no || '',
				vendor_address: addrParts,
			};
			Object.entries(updates).forEach(([k, v]) => {
				form.setFieldValue(k, v);
			});
		});
		return unsubscribe;
	}, [form, vendorList, vendorAutofillField, isView]);

	const lastFilledEmployeeRef = useRef('');

	useEffect(() => {
		if (!employeeAutofillField || isView) return;
		const { unsubscribe } = form.store.subscribe(() => {
			if (!employeeList.length) return;
			const currentName = form.getFieldValue(employeeAutofillField.name);
			if (
				typeof currentName !== 'string' ||
				currentName === lastFilledEmployeeRef.current
			) {
				return;
			}
			const match = employeeList.find((e) => {
				const fullName = `${e.first_name || ''} ${e.last_name || ''}`.trim();
				return fullName.toLowerCase() === currentName.toLowerCase();
			});
			if (!match) return;
			lastFilledEmployeeRef.current = currentName;
			form.setFieldValue('employee_id', match.id ?? '');
		});
		return unsubscribe;
	}, [form, employeeList, employeeAutofillField, isView]);

	const hasDependentFields = formFields.some((f) => f.dependentOn);

	useEffect(() => {
		if (isView || !hasDependentFields) return;
		const { unsubscribe } = form.store.subscribe(() => {
			formFields.forEach((field: FormField) => {
				if (!field.dependentOn) return;
				const current = form.getFieldValue(field.dependentOn.field) ?? '';
				const shouldShow = field.dependentOn.values.includes(
					String(current ?? '')
				);
				if (!shouldShow) {
					const val = form.getFieldValue(field.name);
					if (val !== '' && val != null) {
						form.setFieldValue(field.name, '');
					}
					field.dependentOn.clearFields?.forEach((cf) => {
						const cfVal = form.getFieldValue(cf);
						if (cfVal !== undefined && cfVal !== null) {
							form.setFieldValue(cf, undefined);
						}
					});
				}
			});
		});
		return unsubscribe;
	}, [form, formFields, isView, hasDependentFields]);

	const computedFields = formFields.filter((f) => f.computed);

	useEffect(() => {
		if (isView || computedFields.length === 0) return;
		const prevRef = new Map<string, unknown>();
		const { unsubscribe } = form.store.subscribe(() => {
			computedFields.forEach((field) => {
				if (!field.computed) return;
				const currentDepVals = field.computed.dependsOn.map((d) =>
					form.getFieldValue(d)
				);
				const prevKey = currentDepVals.join('|');
				if (prevRef.get(field.name) === prevKey) return;
				prevRef.set(field.name, prevKey);
				const allValues: Record<string, unknown> = {};
				formFields.forEach((f) => {
					allValues[f.name] = form.getFieldValue(f.name);
				});
				const newVal = field.computed.calculate(allValues);
				const currentVal = Number(form.getFieldValue(field.name)) || 0;
				if (Math.abs(newVal - currentVal) > 0.001) {
					form.setFieldValue(field.name, newVal);
				}
			});
		});
		return unsubscribe;
	}, [form, formFields, isView, computedFields]);

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
						<form.Subscribe selector={(s) => [s.isSubmitting] as const}>
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
				<form.Subscribe
					selector={(s) => {
						const vis = formFields.map((f) => {
							if (!f.dependentOn) return true;
							const depVal = s.values[f.dependentOn.field] || '';
							return f.dependentOn.values.includes(String(depVal));
						});
						return vis.join(',');
					}}
				>
					{() => (
						<>
							{formFields.map((field) => {
								if (field.dependentOn) {
									const depVal = String(
										form.getFieldValue(field.dependentOn.field) || ''
									);
									if (!field.dependentOn.values.includes(depVal)) return null;
								}
								return (
									<form.Field key={field.name} name={field.name}>
										{(fp) => {
											const error = fp.state.meta.errors?.[0];
											const commonProps = {
												id: field.name,
												value: String(fp.state.value ?? ''),
												onBlur: fp.handleBlur,
												disabled: isView,
											};
											// eslint-disable-next-line @typescript-eslint/no-explicit-any
											const handleChange = (e: any) =>
												fp.handleChange(e.currentTarget.value);
											const isAutofill =
												(field.vendorAutofill || field.employeeAutofill) &&
												field.type !== 'textarea';
											const autofillListId = field.employeeAutofill
												? employeeDatalistId
												: datalistId;
											const autofillOptions = field.employeeAutofill
												? (employeeList as Array<
														VendorListItem & EmployeeListItem
													>)
												: (vendorList as Array<
														VendorListItem & EmployeeListItem
													>);
											return (
												<FieldGroup
													label={field.label}
													required={field.required}
													hint={field.hint}
													error={error ? String(error) : undefined}
													className={
														field.fullWidth ? 'sm:col-span-2' : undefined
													}
												>
													{field.type === 'textarea' ? (
														<Textarea
															{...commonProps}
															onChange={handleChange}
															rows={field.rows ?? 3}
														/>
													) : field.type === 'select' ? (
														<Select {...commonProps} onChange={handleChange}>
															<option value="">
																{field.placeholder ?? 'Select…'}
															</option>
															{field.options?.map((opt) => (
																<option key={opt.value} value={opt.value}>
																	{opt.label}
																</option>
															))}
														</Select>
													) : (
														<>
															<Input
																{...commonProps}
																onChange={handleChange}
																type={field.type ?? 'text'}
																placeholder={
																	field.placeholder ??
																	(field.type === 'number' ? '0' : undefined)
																}
																min={field.min}
																step={field.step}
																list={isAutofill ? autofillListId : undefined}
															/>
															{isAutofill ? (
																<datalist id={autofillListId}>
																	{autofillOptions.map(
																		(
																			item: VendorListItem & EmployeeListItem
																		) => {
																			const displayName =
																				item.vendor_name ??
																				`${item.first_name || ''} ${item.last_name || ''}`.trim();
																			return (
																				<option
																					key={
																						item.id ??
																						item.vendor_id ??
																						item.vendor_name ??
																						''
																					}
																					value={displayName || ''}
																				/>
																			);
																		}
																	)}
																</datalist>
															) : null}
														</>
													)}
												</FieldGroup>
											);
										}}
									</form.Field>
								);
							})}
						</>
					)}
				</form.Subscribe>
			</form>
		</Modal>
	);
}
