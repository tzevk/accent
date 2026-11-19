'use client';

import { usePathname } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import {
	HomeIcon,
	DocumentTextIcon,
	UserGroupIcon,
	BriefcaseIcon,
	ShieldCheckIcon,
	ChartBarIcon,
	CalendarDaysIcon,
	// ScaleIcon (used by TEMP-HIDDEN 'Client Balance' report entry in reportsMenuConfig)
	BanknotesIcon,
	ReceiptPercentIcon,
	WalletIcon,
	ArrowUpCircleIcon,
	ClipboardDocumentCheckIcon,
	ClipboardDocumentListIcon,
	FingerPrintIcon,
	ChatBubbleLeftRightIcon,
	TicketIcon,
	BuildingOfficeIcon,
	BuildingLibraryIcon,
	TagIcon,
} from '@heroicons/react/24/outline';
import { useSessionRBAC } from '@/utils/client-rbac';
import { Navigation2 } from '@/components/watermelon-ui/navigation-2';

// Base navigation items with their resource keys
const navigationConfig = [
	{
		name: 'Dashboard',
		href: '/dashboard',
		icon: HomeIcon,
		resource: 'dashboard',
	},
	{ name: 'Leads', href: '/leads', icon: UserGroupIcon, resource: 'leads' },
	{
		name: 'Proposals',
		href: '/proposals',
		icon: DocumentTextIcon,
		resource: 'proposals',
	},
	{
		name: 'Projects',
		href: '/projects',
		icon: BriefcaseIcon,
		resource: 'projects',
	},
];

// Sidebar pages surfaced in the mobile menu (the sidebar is hidden below 640px)
const mobilePagesConfig = [
	{ name: 'Messages', href: '/messages', icon: ChatBubbleLeftRightIcon },
	{ name: 'Support Tickets', href: '/tickets', icon: TicketIcon },
	{
		name: 'Employees',
		href: '/employees',
		icon: UserGroupIcon,
		resource: 'employees',
	},
	{
		name: 'User Master',
		href: '/masters/users',
		icon: ShieldCheckIcon,
		resource: 'users',
	},
	{
		name: 'Activity Master',
		href: '/masters/activities',
		icon: DocumentTextIcon,
		resource: 'activities',
	},
	{
		name: 'Software Master',
		href: '/masters/software',
		icon: DocumentTextIcon,
		resource: 'activities',
	},
	{
		name: 'Deliverables Master',
		href: '/masters/deliverables',
		icon: DocumentTextIcon,
		resource: 'deliverables',
	},
	{
		name: 'Deliverable Category Master',
		href: '/masters/deliverable-categories',
		icon: DocumentTextIcon,
		resource: 'deliverables',
	},
	{
		name: 'Company Master',
		href: '/company',
		icon: BuildingOfficeIcon,
		resource: 'companies',
	},
	{
		name: 'Vendor Master',
		href: '/vendors',
		icon: BuildingOfficeIcon,
		resource: 'vendors',
	},
	{
		name: 'Bank Master',
		href: '/masters/banks',
		icon: BuildingLibraryIcon,
		resource: 'companies',
	},
	{
		name: 'Description Master',
		href: '/masters/descriptions',
		icon: DocumentTextIcon,
		resource: 'companies',
	},
	{
		name: 'Expense Category Master',
		href: '/masters/categories',
		icon: TagIcon,
		resource: 'companies',
	},
];

// Reports menu items
const reportsMenuConfig = [
	// TEMP-HIDDEN (2026-08-03): 'Project Activities' report hidden from nav. Uncomment to restore:
	// {
	// 	name: 'Project Activities',
	// 	href: '/reports/project-activities',
	// 	icon: ChartBarIcon,
	// 	resource: 'reports',
	// 	reportField: 'project_activities',
	// },
	{
		name: 'Employee Report',
		href: '/reports/employee-report',
		icon: UserGroupIcon,
		resource: 'reports',
		reportField: 'project_activities',
	},
	{
		name: 'Timesheet Report',
		href: '/reports/timesheet-report',
		icon: CalendarDaysIcon,
		resource: 'reports',
		reportField: 'project_activities',
	},
	{
		name: 'Manhours Billing',
		href: '/reports/manhours-billing',
		icon: ReceiptPercentIcon,
		resource: 'reports',
		reportField: 'project_activities', // reuse so existing grants cover the new report
	},
	{
		name: 'Company Monthly Cost',
		href: '/reports/company-monthly-cost',
		icon: BanknotesIcon,
		// Financial report: gated on the reporting privilege, not the
		// `project_activities` grant, so Project Activity access alone cannot
		// reveal company expenditure (ticket #306).
		resource: 'reports',
	},
	{
		name: 'Employee Utilization',
		href: '/reports/employee-utilization',
		icon: ChartBarIcon,
		resource: 'reports',
		reportField: 'project_activities', // reuse so existing grants cover the new report
	},
	// TEMP-HIDDEN (2026-08-03): 'Client Balance' report hidden from nav. Uncomment to restore:
	// {
	// 	name: 'Client Balance',
	// 	href: '/reports/client-balance',
	// 	icon: ScaleIcon,
	// 	resource: 'reports',
	// 	reportField: 'project_activities',
	// },
	{
		name: 'Outstanding Balances',
		href: '/reports/sales-register',
		icon: DocumentTextIcon,
		resource: 'reports',
		reportField: 'project_activities',
	},
	{
		name: 'Project Status',
		href: '/reports/project-status',
		icon: ClipboardDocumentListIcon,
		resource: 'reports',
		reportField: 'project_activities', // reuse so existing grants cover the new report
	},
	{
		name: 'Employee Leave Report',
		href: '/reports/leave-overlaps',
		icon: CalendarDaysIcon,
		resource: 'reports',
		reportField: 'project_activities', // reuse so existing grants cover the new report
	},
	{
		name: 'Biometric Attendance Report',
		href: '/reports/attendance-report',
		icon: FingerPrintIcon,
		resource: 'reports',
		reportField: 'project_activities', // reuse so existing grants cover the new report
	},
	{
		name: 'Lead Audit and Performance',
		href: '/reports/lead-audit',
		icon: ChartBarIcon,
		resource: 'reports',
		// The report requires both the reporting privilege and the Lead read
		// right; the unrelated Project Activities field grant is not enough.
		alsoRequires: ['leads'],
	},
];

function hasReportFieldAccess(user, fieldKey) {
	if (!user || !fieldKey) return false;
	if (user.is_super_admin) return true;

	let fieldPerms = user.field_permissions;
	if (typeof fieldPerms === 'string') {
		try {
			fieldPerms = JSON.parse(fieldPerms);
		} catch {
			fieldPerms = null;
		}
	}

	const reportAccessSection =
		fieldPerms?.modules?.reports?.sections?.report_access;
	if (!reportAccessSection?.enabled) return false;

	const currentPerm = reportAccessSection.fields?.[fieldKey]?.permission;
	if (currentPerm === 'view' || currentPerm === 'edit') return true;

	// Backward compatibility for older permission key naming.
	if (fieldKey === 'project_activities') {
		const legacyPerm = reportAccessSection.fields?.project_reports?.permission;
		return legacyPerm === 'view' || legacyPerm === 'edit';
	}

	return false;
}

// Quotation naming convention:
// - /admin/quotation         → Outgoing (Accent → client), from proposals/projects
// - /admin/quotation-outgoing → Incoming (vendor → Accent), vendor quotations

// Admin menu grouped into categories for the hover-flyout navbar dropdown
const adminMenuGroups = [
	{
		key: 'quotations',
		name: 'Quotations',
		icon: DocumentTextIcon,
		items: [
			{
				name: 'Quotation (Outgoing)',
				href: '/admin/quotation',
				icon: DocumentTextIcon,
			},
			{
				name: 'Quotation (Incoming)',
				href: '/admin/quotation-outgoing',
				icon: DocumentTextIcon,
			},
		],
	},
	{
		key: 'invoicing',
		name: 'Invoicing',
		icon: ReceiptPercentIcon,
		items: [
			{ name: 'Sale Invoice', href: '/admin/invoice', icon: DocumentTextIcon },
			{
				name: 'Purchase Invoice',
				href: '/admin/purchase-invoice',
				icon: ReceiptPercentIcon,
			},
		],
	},
	{
		key: 'purchase-orders',
		name: 'Purchase Orders',
		icon: ClipboardDocumentCheckIcon,
		items: [
			{
				name: 'Purchase Order (Incoming)',
				href: '/admin/purchase-order',
				icon: ClipboardDocumentCheckIcon,
			},
			{
				name: 'Purchase Order (Outgoing)',
				href: '/admin/outgoing-purchase-order',
				icon: ClipboardDocumentCheckIcon,
			},
		],
	},
	{
		key: 'payments',
		name: 'Payments',
		icon: BanknotesIcon,
		items: [
			{
				name: 'Payment Received from client',
				href: '/admin/payment-entry',
				icon: BanknotesIcon,
			},
			{
				name: 'Payment Issued to client',
				href: '/admin/payment-issue',
				icon: ArrowUpCircleIcon,
			},
		],
	},
	{
		key: 'cash-expenses',
		name: 'Cash & Expenses',
		icon: WalletIcon,
		items: [
			{
				name: 'Cash Voucher',
				href: '/admin/cash-voucher',
				icon: BanknotesIcon,
			},
			{ name: 'Expenses', href: '/admin/expenses', icon: WalletIcon },
			{
				name: 'Other Expenses',
				href: '/admin/other-expenses',
				icon: WalletIcon,
			},
			{
				name: 'Cost Accrual',
				href: '/admin/cost-accrual',
				icon: WalletIcon,
			},
			{
				name: 'Petty Cash Expenses',
				href: '/admin/petty-cash-expenses',
				icon: WalletIcon,
			},
		],
	},
	{
		key: 'payroll',
		name: 'Payroll',
		icon: ClipboardDocumentCheckIcon,
		items: [
			{
				name: 'Payroll Run',
				href: '/admin/payroll',
				icon: ClipboardDocumentCheckIcon,
			},
			{
				name: 'Component Rates',
				href: '/admin/payroll/rates',
				icon: BanknotesIcon,
			},
			{
				name: 'DA Rates',
				href: '/admin/payroll/rates/da',
				icon: DocumentTextIcon,
			},
			{
				// Issue #434: the salary workspace owns the list and the
				// per-employee editor; the hub no longer embeds a salary form.
				// Salary Type selects the stream, so these are view filters.
				name: 'Salary Profiles',
				href: '/admin/payroll/salary-profiles?stream=payroll',
				icon: UserGroupIcon,
				resource: 'payroll',
			},
			{
				name: 'Contract Pay',
				href: '/admin/payroll/salary-profiles?stream=contract',
				icon: BriefcaseIcon,
				resource: 'payroll',
			},
		],
	},
	{
		key: 'procurement',
		name: 'Procurement',
		icon: ClipboardDocumentCheckIcon,
		items: [
			{
				name: 'Material Requisition',
				href: '/admin/material-requisition',
				icon: ClipboardDocumentCheckIcon,
			},
		],
	},
	{
		key: 'project-access',
		name: 'Project Access',
		icon: ShieldCheckIcon,
		items: [
			{
				// One shared policy for every project; gated on projects:update
				// at the API and the admin shell.
				name: 'Lead Policy',
				href: '/admin/project-lead-policy',
				icon: ShieldCheckIcon,
				resource: 'projects',
			},
		],
	},
	{
		key: 'monitoring',
		name: 'Monitoring',
		icon: ChartBarIcon,
		items: [
			{
				name: 'Admin Logs',
				href: '/admin/activity-logs',
				icon: ShieldCheckIcon,
			},
			{ name: 'All Todos', href: '/admin/todos', icon: ShieldCheckIcon },
			{
				name: 'Live Monitoring',
				href: '/admin/live-monitoring',
				icon: ChartBarIcon,
			},
		],
	},
];

// Masters moved to sidebar; removed from header

export default function Navbar() {
	const pathname = usePathname();
	const isSignin = pathname.startsWith('/signin');
	const {
		loading: userLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC();

	// Check again whenever the session refreshes. A previous session snapshot
	// must not keep Projects visible after an administrator revokes access.
	const [projectAccessUser, setProjectAccessUser] = useState(null);
	useEffect(() => {
		if (userLoading || !user || user.is_super_admin) return;

		const controller = new AbortController();
		const { signal } = controller;
		const loadProjectAccess = async () => {
			try {
				const response = await fetch('/api/projects/access', {
					cache: 'no-store',
					signal,
				});
				const body = response.ok ? await response.json() : null;
				if (!signal.aborted) {
					setProjectAccessUser(body?.data?.hasAccess === true ? user : null);
				}
			} catch {
				if (!signal.aborted) setProjectAccessUser(null);
			}
		};
		void loadProjectAccess();
		return () => controller.abort();
	}, [user, userLoading]);

	// Filter navigation items based on user permissions
	const navigation = useMemo(() => {
		if (userLoading && !user) return []; // Hide nav while loading (prevents flash)
		if (!user) return [];
		if (user.is_super_admin) return navigationConfig; // Super admin sees all

		return navigationConfig.filter((item) => {
			if (item.href === '/projects') {
				// `/api/projects/access` is authoritative: it includes a
				// super admin and any scoped action that actually covers a
				// project. A global `projects:read` string says nothing about
				// project scope, so it must not reveal the entry.
				return !userLoading && projectAccessUser === user;
			}
			return can(item.resource, PERMISSIONS.READ);
		});
	}, [user, userLoading, can, PERMISSIONS, projectAccessUser]);

	// Mobile-only page list — mirrors the sidebar, which is hidden below 640px
	const mobilePageItems = useMemo(() => {
		if (userLoading || !user) return [];
		return mobilePagesConfig.filter(
			(item) => !item.resource || can(item.resource, PERMISSIONS.READ)
		);
	}, [user, userLoading, can, PERMISSIONS]);

	// Broad Admin controls: super admins, admin:read holders and project
	// administrators. A payroll-only editor is admitted to the Payroll group
	// alone (ticket #444 guards the workspace pages themselves).
	const showBroadAdminControls = useMemo(() => {
		if (userLoading || !user) return false; // Hide admin while loading
		if (user.is_super_admin) return true;
		// Project administrators maintain the shared lead policy, which lives
		// under /admin; the admin shell itself carries no data.
		if (can(RESOURCES.PROJECTS, PERMISSIONS.UPDATE)) return true;
		return can(RESOURCES.ADMIN, PERMISSIONS.READ) || can('admin', 'read');
	}, [user, userLoading, can, RESOURCES, PERMISSIONS]);

	// Admin menu visibility: the broad Admin controls above, or a payroll
	// reader who needs the Payroll workspace.
	const showAdminMenu = useMemo(
		() =>
			showBroadAdminControls ||
			(!userLoading &&
				Boolean(user) &&
				can(RESOURCES.PAYROLL, PERMISSIONS.READ)),
		[showBroadAdminControls, userLoading, user, can, RESOURCES, PERMISSIONS]
	);

	// Group items without a resource always show; an item naming one shows only
	// for a holder, and a group left with no items is dropped from the menu. A
	// payroll-only session sees the Payroll group and nothing else.
	const adminMenuGroupsToShow = useMemo(() => {
		if (user?.is_super_admin) return adminMenuGroups;
		const groups = adminMenuGroups
			.map((group) => ({
				...group,
				items: group.items.filter(
					(item) => !item.resource || can(item.resource, PERMISSIONS.READ)
				),
			}))
			.filter((group) => group.items.length > 0);
		return showBroadAdminControls
			? groups
			: groups.filter((group) => group.key === 'payroll');
	}, [user, can, PERMISSIONS, showBroadAdminControls]);

	// Filter reports menu items based on permissions
	const reportsMenuItems = useMemo(() => {
		if (userLoading || !user) return []; // Hide reports while loading
		if (user.is_super_admin) return reportsMenuConfig; // Super admin sees all

		// Filter based on permissions
		const filteredItems = reportsMenuConfig.filter((item) => {
			const opensReportSurface =
				can(item.resource, PERMISSIONS.READ) ||
				hasReportFieldAccess(user, item.reportField);
			const hasAdditionalGrants = (item.alsoRequires ?? []).every((resource) =>
				can(resource, PERMISSIONS.READ)
			);
			return opensReportSurface && hasAdditionalGrants;
		});

		return filteredItems;
	}, [user, userLoading, can, PERMISSIONS]);

	const showReportsMenu = reportsMenuItems.length > 0;

	if (isSignin) return null;

	return (
		<Navigation2
			navigation={navigation}
			reportsMenuItems={reportsMenuItems}
			showReportsMenu={showReportsMenu}
			adminMenuGroups={adminMenuGroupsToShow}
			showAdminMenu={showAdminMenu}
			mobilePageItems={mobilePageItems}
			showBroadAdminControls={showBroadAdminControls}
		/>
	);
}
