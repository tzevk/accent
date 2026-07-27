'use client';

import { useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnyFormApi } from '@tanstack/form-core';
import { apiGet } from '@/lib/api-client';
import type {
	FormField,
	VendorListItem,
	EmployeeListItem,
	CompanyListItem,
	CompanyListResponse,
	VendorListResponse,
	EmployeeListResponse,
} from '@/types/admin';

interface UseAutofillParams {
	form: AnyFormApi;
	formFields: FormField[];
	isView: boolean;
	vendorListEndpoint?: string;
	employeeListEndpoint?: string;
	companyListEndpoint?: string;
}

export interface AutofillLists {
	vendorList: VendorListItem[];
	employeeList: EmployeeListItem[];
	companyList: CompanyListItem[];
	datalistId: string;
	employeeDatalistId: string;
	companyDatalistId: string;
}

export function useAutofill({
	form,
	formFields,
	isView,
	vendorListEndpoint,
	employeeListEndpoint,
	companyListEndpoint,
}: UseAutofillParams): AutofillLists {
	const vendorAutofillField = formFields.find((f) => f.vendorAutofill);
	const employeeAutofillField = formFields.find((f) => f.employeeAutofill);
	const companyAutofillField = formFields.find((f) => f.companyAutofill);

	const datalistId = useMemo(
		() => `vendor-autofill-${Math.random().toString(36).slice(2, 9)}`,
		[]
	);
	const employeeDatalistId = useMemo(
		() => `employee-autofill-${Math.random().toString(36).slice(2, 9)}`,
		[]
	);
	const companyDatalistId = useMemo(
		() => `company-autofill-${Math.random().toString(36).slice(2, 9)}`,
		[]
	);

	const vendorsQuery = useQuery<VendorListResponse>({
		queryKey: ['vendor-autofill-list', vendorListEndpoint],
		queryFn: () => apiGet<VendorListResponse>(vendorListEndpoint!),
		enabled: Boolean(vendorListEndpoint) && Boolean(vendorAutofillField),
		staleTime: 5 * 60 * 1000,
	});

	const employeesQuery = useQuery<EmployeeListResponse>({
		queryKey: ['employee-autofill-list', employeeListEndpoint],
		queryFn: () => apiGet<EmployeeListResponse>(employeeListEndpoint!),
		enabled: Boolean(employeeListEndpoint) && Boolean(employeeAutofillField),
		staleTime: 5 * 60 * 1000,
	});

	const companiesQuery = useQuery<CompanyListResponse>({
		queryKey: ['company-autofill-list', companyListEndpoint],
		queryFn: () => apiGet<CompanyListResponse>(companyListEndpoint!),
		enabled: Boolean(companyListEndpoint) && Boolean(companyAutofillField),
		staleTime: 5 * 60 * 1000,
	});

	const vendorList = useMemo(
		() => vendorsQuery.data?.data ?? [],
		[vendorsQuery.data]
	);
	const employeeList = useMemo(
		() => employeesQuery.data?.employees ?? [],
		[employeesQuery.data]
	);
	const companyList = useMemo(
		() => companiesQuery.data?.data ?? [],
		[companiesQuery.data]
	);

	// --- Vendor autofill effect ---
	const lastVendorRef = useRef('');
	useEffect(() => {
		if (!vendorAutofillField || isView || !vendorList.length) return;
		const { unsubscribe } = form.store.subscribe(() => {
			const currentName = form.getFieldValue(vendorAutofillField.name);
			if (
				typeof currentName !== 'string' ||
				currentName === lastVendorRef.current
			)
				return;
			const match = vendorList.find(
				(v) => (v.vendor_name || '').toLowerCase() === currentName.toLowerCase()
			);
			if (!match) return;
			lastVendorRef.current = currentName;
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

	// --- Employee autofill effect ---
	const lastEmployeeRef = useRef('');
	useEffect(() => {
		if (!employeeAutofillField || isView || !employeeList.length) return;
		const { unsubscribe } = form.store.subscribe(() => {
			const currentName = form.getFieldValue(employeeAutofillField.name);
			if (
				typeof currentName !== 'string' ||
				currentName === lastEmployeeRef.current
			)
				return;
			const match = employeeList.find((e) => {
				const fullName = `${e.first_name || ''} ${e.last_name || ''}`.trim();
				return fullName.toLowerCase() === currentName.toLowerCase();
			});
			if (!match) return;
			lastEmployeeRef.current = currentName;
			form.setFieldValue('employee_id', match.id ?? '');
		});
		return unsubscribe;
	}, [form, employeeList, employeeAutofillField, isView]);

	// --- Company autofill effect ---
	const lastCompanyRef = useRef('');
	useEffect(() => {
		if (!companyAutofillField || isView || !companyList.length) return;
		const { unsubscribe } = form.store.subscribe(() => {
			const currentName = form.getFieldValue(companyAutofillField.name);
			if (
				typeof currentName !== 'string' ||
				currentName === lastCompanyRef.current
			)
				return;
			const match = companyList.find(
				(c) =>
					(c.company_name || '').toLowerCase() === currentName.toLowerCase()
			);
			if (!match) return;
			lastCompanyRef.current = currentName;
			const updates: Record<string, string> = {
				city: match.city || '',
				state: match.state || '',
				address: match.address || '',
				company_phone: match.phone || '',
				company_email: match.email || '',
				company_gstin: match.gstin || '',
				company_pan: match.pan_number || '',
			};
			Object.entries(updates).forEach(([k, v]) => {
				if (k in form.state.values) {
					form.setFieldValue(k, v);
				}
			});
		});
		return unsubscribe;
	}, [form, companyList, companyAutofillField, isView]);

	return {
		vendorList,
		employeeList,
		companyList,
		datalistId,
		employeeDatalistId,
		companyDatalistId,
	};
}
