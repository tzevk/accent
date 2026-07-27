'use client';

import { useEffect } from 'react';
import type { AnyFormApi } from '@tanstack/form-core';
import type { FormField, ModalMode } from '@/types/admin';

interface UseFormEffectsParams {
	form: AnyFormApi;
	formFields: FormField[];
	isView: boolean;
	mode: ModalMode;
}

export function useFormEffects({
	form,
	formFields,
	isView,
	mode,
}: UseFormEffectsParams): void {
	// --- Dependent fields: show/hide + clear ---
	const hasDependentFields = formFields.some((f) => f.dependentOn);

	useEffect(() => {
		if (isView || !hasDependentFields) return;
		const { unsubscribe } = form.store.subscribe(() => {
			formFields.forEach((field) => {
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

	// --- Computed fields: derived from other fields ---
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

	// --- Derived fields: computed with mode awareness ---
	const derivedFields = formFields.filter((f) => f.derived);

	useEffect(() => {
		if (isView || derivedFields.length === 0) return;
		const prevRef = new Map<string, unknown>();
		const { unsubscribe } = form.store.subscribe(() => {
			derivedFields.forEach((field) => {
				if (!field.derived) return;
				if (field.derived.modes && !field.derived.modes.includes(mode!)) return;
				const currentDepVals = field.derived.dependsOn.map((d) =>
					form.getFieldValue(d)
				);
				const prevKey = currentDepVals.map(String).join('|');
				if (prevRef.get(field.name) === prevKey) return;
				prevRef.set(field.name, prevKey);
				const allValues: Record<string, unknown> = {};
				formFields.forEach((f) => {
					allValues[f.name] = form.getFieldValue(f.name);
				});
				const newVal = field.derived.calculate(allValues);
				const currentVal = form.getFieldValue(field.name);
				if (String(newVal) !== String(currentVal)) {
					form.setFieldValue(field.name, newVal);
				}
			});
		});
		return unsubscribe;
	}, [form, formFields, isView, derivedFields, mode]);
}
