import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';

export interface DependentOn {
	field: string;
	values: string[];
	clearFields?: string[];
}

export interface ComputedField {
	dependsOn: string[];
	calculate: (values: Record<string, unknown>) => number;
}

export interface FormField {
	name: string;
	label: string;
	type?: 'text' | 'date' | 'number' | 'textarea' | 'select';
	required?: boolean;
	hint?: string;
	placeholder?: string;
	rows?: number;
	min?: number | string;
	step?: string;
	fullWidth?: boolean;
	options?: Array<{ value: string; label: string }>;
	vendorAutofill?: boolean;
	employeeAutofill?: boolean;
	dependentOn?: DependentOn;
	computed?: ComputedField;
}

export interface Column {
	key: string;
	label: string;
	headClassName?: string;
	cellClassName?: string;
	money?: boolean;
	date?: boolean;
	render?: (row: Record<string, unknown>) => ReactNode;
}

export type StatTone =
	| 'purple'
	| 'amber'
	| 'sky'
	| 'rose'
	| 'green'
	| 'slate'
	| 'violet';

export interface StatsConfig {
	key: string;
	label: string;
	tone: StatTone;
	icon?: ComponentType<{ className?: string }>;
	hint?: string;
	money?: boolean;
}

export interface ExtraFilters {
	values: Record<string, string | number | boolean | undefined>;
	node: ReactNode;
}

export interface ResourcePageProps {
	title: string;
	subtitle?: string;
	endpoint: string;
	queryKey: string | readonly unknown[];
	statsConfig?: StatsConfig[];
	columns: Column[];
	defaultValues: Record<string, unknown>;
	zodSchema: z.ZodTypeAny;
	formFields: FormField[];
	transformSubmit?: (
		values: Record<string, unknown>
	) => Record<string, unknown>;
	searchPlaceholder?: string;
	extraFilters?: ExtraFilters;
	pageSize?: number;
	canView?: boolean;
	vendorListEndpoint?: string;
	employeeListEndpoint?: string;
}

export type ModalMode = 'view' | 'edit' | 'create' | null;

export interface ResourceFormModalProps extends Omit<
	ResourcePageProps,
	| 'subtitle'
	| 'queryKey'
	| 'statsConfig'
	| 'columns'
	| 'searchPlaceholder'
	| 'extraFilters'
	| 'pageSize'
	| 'canView'
> {
	mode: ModalMode;
	row: Record<string, unknown> | null;
	onClose: () => void;
	onSaved: () => void;
}

export interface Pagination {
	page: number;
	limit: number;
	total: number;
	totalPages: number;
}

export interface ApiListResponse<T = Record<string, unknown>> {
	success: boolean;
	data: T[];
	pagination: Pagination;
	stats?: Record<string, number | string | null>;
	error?: string;
}

export interface VendorListItem {
	id?: number | string;
	vendor_id?: number | string;
	vendor_name?: string;
	email?: string;
	phone?: string;
	gst_vat_tax_id?: string;
	pan_legal_reg_no?: string;
	address_street?: string;
	address_city?: string;
	address_state?: string;
	address_country?: string;
	address_pin?: string;
}

export interface EmployeeListItem {
	id?: number | string;
	first_name?: string;
	last_name?: string;
}

export interface VendorListResponse {
	success: boolean;
	data: VendorListItem[];
	error?: string;
}

export interface EmployeeListResponse {
	success: boolean;
	employees: EmployeeListItem[];
	error?: string;
}
