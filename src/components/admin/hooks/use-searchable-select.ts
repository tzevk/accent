'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { AnyFormApi } from '@tanstack/form-core';
import { apiGet } from '@/lib/api-client';
import type { FormField, CompanyListItem } from '@/types/admin';

interface UseSearchableSelectParams {
	form: AnyFormApi;
	formFields: FormField[];
	isView: boolean;
	companyList: CompanyListItem[];
}

interface UseSearchableSelectReturn {
	searchableLists: Record<string, Array<Record<string, unknown>>>;
	dependencyValues: Record<string, string>;
	getSearchableOptions: (
		field: FormField,
		depVals?: Record<string, string>
	) => Array<{ value: string; label: string; id?: string | number }>;
	setPendingFill: React.Dispatch<
		React.SetStateAction<{
			field: FormField;
			value: string;
		} | null>
	>;
}

export function useSearchableSelect({
	form,
	formFields,
	isView,
	companyList,
}: UseSearchableSelectParams): UseSearchableSelectReturn {
	const searchableFields = useMemo(
		() =>
			formFields.filter(
				(f) => f.type === 'searchableSelect' && f.searchableEndpoint
			),
		[formFields]
	);

	const uniqueSearchableEndpoints = useMemo(
		() => [...new Set(searchableFields.map((f) => f.searchableEndpoint!))],
		[searchableFields]
	);

	const searchableQueries = useQueries({
		queries: uniqueSearchableEndpoints.map((endpoint) => ({
			queryKey: ['searchable-list', endpoint],
			queryFn: () => apiGet(endpoint),
			staleTime: 5 * 60 * 1000,
		})),
	});

	const searchableLists = useMemo(() => {
		const map: Record<string, Array<Record<string, unknown>>> = {};
		uniqueSearchableEndpoints.forEach((endpoint, i) => {
			const result = searchableQueries[i];
			map[endpoint] =
				((result.data as Record<string, unknown> | null)
					?.data as unknown as Array<Record<string, unknown>>) ?? [];
		});
		return map;
	}, [uniqueSearchableEndpoints, searchableQueries]);

	// --- Dependency tracking ---
	const searchableDependencyFields = useMemo(
		() => [
			...new Set(
				formFields
					.filter((f) => f.searchableDependency)
					.map((f) => f.searchableDependency!.field)
			),
		],
		[formFields]
	);

	const [dependencyValues, setDependencyValues] = useState<
		Record<string, string>
	>(() => Object.fromEntries(searchableDependencyFields.map((f) => [f, ''])));

	useEffect(() => {
		if (isView || searchableDependencyFields.length === 0) return;
		const updateDeps = () => {
			const next: Record<string, string> = {};
			let changed = false;
			searchableDependencyFields.forEach((depField) => {
				const val = String(form.getFieldValue(depField) ?? '');
				next[depField] = val;
				if (dependencyValues[depField] !== val) changed = true;
			});
			if (changed) setDependencyValues(next);
		};
		updateDeps();
		const { unsubscribe } = form.store.subscribe(updateDeps);
		return unsubscribe;
	}, [form, dependencyValues, isView, searchableDependencyFields]);

	// --- Options builder ---
	const getSearchableOptions = useCallback(
		(
			field: FormField,
			depVals?: Record<string, string>
		): Array<{ value: string; label: string; id?: string | number }> => {
			if (field.companyAutofill) {
				return companyList.map((c) => ({
					value: c.company_name || '',
					label: c.company_name || '',
					id: c.id,
				}));
			}
			if (field.searchableEndpoint) {
				let items = searchableLists[field.searchableEndpoint] || [];
				if (field.searchableDependency && depVals) {
					const filterValue = depVals[field.searchableDependency.field] ?? '';
					if (filterValue) {
						const fv = String(filterValue).toLowerCase();
						items = items.filter(
							(item) =>
								String(
									item[field.searchableDependency!.itemKey] ?? ''
								).toLowerCase() === fv
						);
					}
				}
				const valueKey = field.searchableValueKey || field.name;
				return items.map((item) => ({
					value: String(item[valueKey] ?? ''),
					label: field.searchableLabelFn
						? field.searchableLabelFn(item)
						: String(item[valueKey] ?? ''),
					id: item.id as string | number | undefined,
				}));
			}
			return [];
		},
		[companyList, searchableLists]
	);

	// --- Fill logic (when a searchable select changes) ---
	const [pendingFill, setPendingFill] = useState<{
		field: FormField;
		value: string;
	} | null>(null);

	useEffect(() => {
		if (!pendingFill || isView) return;
		const { field, value } = pendingFill;
		if (!field.searchableEndpoint || !field.searchableFillFields) return;
		const items = searchableLists[field.searchableEndpoint] || [];
		const vk = field.searchableValueKey || field.name;
		const item = items.find((i) => String(i[vk] ?? '') === value);
		if (item) {
			Object.entries(field.searchableFillFields).forEach(([dk, fk]) => {
				const fv = item[dk];
				if (fv != null) {
					form.setFieldValue(fk, String(fv));
				}
			});
		}
		setPendingFill(null);
	}, [pendingFill, isView, searchableLists, form]);

	return {
		searchableLists,
		dependencyValues,
		getSearchableOptions,
		setPendingFill,
	};
}
