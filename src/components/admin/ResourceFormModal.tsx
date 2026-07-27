'use client';

import { useMemo } from 'react';
import { useForm } from '@tanstack/react-form';
import toast from 'react-hot-toast';
import Modal from '@/components/ui/modal';
import SearchableSelect from '@/components/ui/searchable-select';
import { Button } from '@/components/ui/button';
import {
	Input,
	Textarea,
	Select,
	FieldGroup,
} from '@/components/ui/form-fields';
import { apiPost, apiPut } from '@/lib/api-client';
import type {
	ResourceFormModalProps,
	FormField,
	VendorListItem,
	EmployeeListItem,
	CompanyListItem,
} from '@/types/admin';
import { useAutofill } from '@/components/admin/hooks/use-autofill';
import { useSearchableSelect } from '@/components/admin/hooks/use-searchable-select';
import { useFormEffects } from '@/components/admin/hooks/use-form-effects';

export default function ResourceFormModal({
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
	companyListEndpoint,
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

	const autofill = useAutofill({
		form,
		formFields,
		isView,
		vendorListEndpoint,
		employeeListEndpoint,
		companyListEndpoint,
	});

	const searchable = useSearchableSelect({
		form,
		formFields,
		isView,
		companyList: autofill.companyList,
	});

	useFormEffects({ form, formFields, isView, mode });

	const isAutofillField = useMemo(() => {
		const names = new Set<string>();
		formFields.forEach((f) => {
			if (
				(f.vendorAutofill || f.employeeAutofill || f.companyAutofill) &&
				f.type !== 'textarea'
			)
				names.add(f.name);
		});
		return (field: FormField) => names.has(field.name);
	}, [formFields]);

	const getAutofillConfig = (field: FormField) => {
		if (field.companyAutofill)
			return {
				listId: autofill.companyDatalistId,
				options: autofill.companyList as Array<
					VendorListItem & EmployeeListItem & CompanyListItem
				>,
			};
		if (field.employeeAutofill)
			return {
				listId: autofill.employeeDatalistId,
				options: autofill.employeeList as Array<
					VendorListItem & EmployeeListItem & CompanyListItem
				>,
			};
		return {
			listId: autofill.datalistId,
			options: autofill.vendorList as Array<
				VendorListItem & EmployeeListItem & CompanyListItem
			>,
		};
	};

	return (
		<Modal
			open
			onClose={onClose}
			dismissible={false}
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
												disabled: isView || field.disabled,
											};
											// eslint-disable-next-line @typescript-eslint/no-explicit-any
											const handleChange = (e: any) =>
												fp.handleChange(e.currentTarget.value);
											const isAutofill = isAutofillField(field);
											const afConfig = isAutofill
												? getAutofillConfig(field)
												: null;

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
													) : field.type === 'searchableSelect' ? (
														isView ? (
															<Input
																{...commonProps}
																disabled
																type="text"
																value={String(fp.state.value ?? '')}
															/>
														) : (
															<SearchableSelect
																options={searchable.getSearchableOptions(
																	field,
																	searchable.dependencyValues
																)}
																value={String(fp.state.value ?? '')}
																onChange={(val) => {
																	fp.handleChange(val);
																	if (
																		field.searchableFillFields &&
																		field.searchableEndpoint
																	) {
																		searchable.setPendingFill({
																			field,
																			value: val,
																		});
																	}
																}}
																placeholder={field.placeholder ?? 'Select…'}
															/>
														)
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
																list={isAutofill ? afConfig?.listId : undefined}
															/>
															{isAutofill && afConfig ? (
																<datalist id={afConfig.listId}>
																	{afConfig.options.map((item) => {
																		const displayName =
																			item.company_name ??
																			item.vendor_name ??
																			`${item.first_name || ''} ${item.last_name || ''}`.trim();
																		return (
																			<option
																				key={
																					item.id ??
																					item.vendor_id ??
																					item.company_name ??
																					item.vendor_name ??
																					''
																				}
																				value={displayName || ''}
																			/>
																		);
																	})}
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
