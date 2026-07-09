'use client';

import Link from 'next/link';
import Image from 'next/image';
import accentLogo from '@/../public/accent-logo.png';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import {
	HomeIcon,
	DocumentTextIcon,
	UserGroupIcon,
	BriefcaseIcon,
	ArrowRightOnRectangleIcon,
	Bars3Icon,
	XMarkIcon,
	UserCircleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	ShieldCheckIcon,
	ChartBarIcon,
	BanknotesIcon,
	ReceiptPercentIcon,
	WalletIcon,
	ArrowDownCircleIcon,
	ArrowUpCircleIcon,
	ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { useSessionRBAC } from '@/utils/client-rbac';
import { clearSessionCache } from '@/context/SessionContext';

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

// Reports menu items
const reportsMenuConfig = [
	{
		name: 'Project Activities',
		href: '/reports/project-activities',
		icon: ChartBarIcon,
		resource: 'reports',
		reportField: 'project_activities',
	},
	{
		name: 'Employee Report',
		href: '/reports/employee-report',
		icon: UserGroupIcon,
		resource: 'reports',
		reportField: 'project_activities',
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
// Admin menu items with their resource keys
const adminMenuConfig = [
	{ name: 'Admin Logs', href: '/admin/activity-logs', resource: 'admin' },
	{ name: 'All Todos', href: '/admin/todos', resource: 'admin' },
	{ name: 'Cash Voucher', href: '/admin/cash-voucher', resource: 'admin' },
	{ name: 'Expenses', href: '/admin/expenses', resource: 'admin' },
	{
		name: 'Other Expenses',
		href: '/admin/other-expenses',
		resource: 'admin',
	},
	{
		name: 'Petty Cash Expenses',
		href: '/admin/petty-cash-expenses',
		resource: 'admin',
	},
	{
		name: 'Live Monitoring',
		href: '/admin/live-monitoring',
		resource: 'admin',
	},
	{
		name: 'Material Requisition',
		href: '/admin/material-requisition',
		resource: 'admin',
	},
	{ name: 'Payment Entry', href: '/admin/payment-entry', resource: 'admin' },
	{
		name: 'Payment Payable',
		href: '/admin/payment-payable',
		resource: 'admin',
	},
	{
		name: 'Payment Receivable',
		href: '/admin/payment-receivable',
		resource: 'admin',
	},
	{
		name: 'Purchase Invoice',
		href: '/admin/purchase-invoice',
		resource: 'admin',
	},
	{
		name: 'Purchase Order (Incoming)',
		href: '/admin/purchase-order',
		resource: 'admin',
	},
	{
		name: 'Purchase Order (Outgoing)',
		href: '/admin/outgoing-purchase-order',
		resource: 'admin',
	},
	{ name: 'Quotation (Outgoing)', href: '/admin/quotation', resource: 'admin' },
	{
		name: 'Quotation (Incoming)',
		href: '/admin/quotation-outgoing',
		resource: 'admin',
	},
	{
		name: 'Salary Sheet (Excel)',
		href: '/admin/salary-sheet',
		resource: 'admin',
	},
	{ name: 'Salary Slip (PDF)', href: '/admin/salary-slip', resource: 'admin' },
	{ name: 'Sale Invoice', href: '/admin/invoice', resource: 'admin' },
];

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
			// {
			// 	name: 'Payment Receivable',
			// 	href: '/admin/payment-receivable',
			// 	icon: ArrowDownCircleIcon,
			// },
			// {
			// 	name: 'Payment Payable',
			// 	href: '/admin/payment-payable',
			// 	icon: ArrowUpCircleIcon,
			// },
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
				name: 'Petty Cash Expenses',
				href: '/admin/petty-cash-expenses',
				icon: WalletIcon,
			},
			{
				name: 'Payment Entry',
				href: '/admin/payment-entry',
				icon: BanknotesIcon,
			},
		],
	},
	{
		key: 'payroll',
		name: 'Payroll',
		icon: ClipboardDocumentCheckIcon,
		items: [
			{
				name: 'Material Requisition',
				href: '/admin/material-requisition',
				icon: ClipboardDocumentCheckIcon,
			},
			{
				name: 'Salary Sheet (Excel)',
				href: '/admin/salary-sheet',
				icon: DocumentTextIcon,
			},
			{
				name: 'Salary Slip (PDF)',
				href: '/admin/salary-slip',
				icon: DocumentTextIcon,
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
	const router = useRouter();
	const pathname = usePathname();
	const isSignin = pathname.startsWith('/signin');
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
	const [isReportsMenuOpen, setIsReportsMenuOpen] = useState(false);
	const [activeAdminGroup, setActiveAdminGroup] = useState(null);
	const [scrolled, setScrolled] = useState(false);
	const [isWindows, setIsWindows] = useState(false);
	const {
		loading: userLoading,
		user,
		can,
		RESOURCES,
		PERMISSIONS,
	} = useSessionRBAC();
	const displayName =
		user?.full_name || user?.username || (userLoading ? '' : 'Account');
	const displayEmail = user?.email || '';

	// Filter navigation items based on user permissions
	const navigation = useMemo(() => {
		if (userLoading && !user) return []; // Hide nav while loading (prevents flash)
		if (!user) return [];
		if (user.is_super_admin) return navigationConfig; // Super admin sees all

		return navigationConfig.filter((item) => {
			return can(item.resource, PERMISSIONS.READ);
		});
	}, [user, userLoading, can, PERMISSIONS]);

	// Filter admin menu items based on permissions
	const adminMenuItems = useMemo(() => {
		if (userLoading || !user) return []; // Hide admin while loading
		if (user.is_super_admin) return adminMenuConfig; // Super admin sees all

		// Show admin menu only if user has admin permission
		if (can(RESOURCES.ADMIN, PERMISSIONS.READ) || can('admin', 'read')) {
			return adminMenuConfig;
		}
		return [];
	}, [user, userLoading, can, RESOURCES, PERMISSIONS]);

	// Check if admin menu should be visible
	const showAdminMenu = adminMenuItems.length > 0;

	// Filter reports menu items based on permissions
	const reportsMenuItems = useMemo(() => {
		if (userLoading || !user) return []; // Hide reports while loading
		if (user.is_super_admin) return reportsMenuConfig; // Super admin sees all

		// Filter based on permissions
		const filteredItems = reportsMenuConfig.filter((item) => {
			return (
				can(item.resource, PERMISSIONS.READ) ||
				hasReportFieldAccess(user, item.reportField)
			);
		});

		return filteredItems;
	}, [user, userLoading, can, PERMISSIONS]);

	// Check if reports menu should be visible
	const showReportsMenu = reportsMenuItems.length > 0;

	// Handle scroll effect
	useEffect(() => {
		const handleScroll = () => {
			setScrolled(window.scrollY > 10);
		};
		window.addEventListener('scroll', handleScroll);
		return () => window.removeEventListener('scroll', handleScroll);
	}, []);

	// Detect Windows to compensate gradient rendering differences
	useEffect(() => {
		setIsWindows(navigator.userAgent.includes('Windows'));
	}, []);

	// Close mobile menu when route changes
	useEffect(() => {
		setIsMobileMenuOpen(false);
		setIsAdminMenuOpen(false);
		setIsReportsMenuOpen(false);
		setActiveAdminGroup(null);
	}, [pathname]);

	// Close dropdowns when clicking outside
	useEffect(() => {
		const handleClickOutside = (e) => {
			if (isAdminMenuOpen && !e.target.closest('.admin-dropdown')) {
				setIsAdminMenuOpen(false);
				setActiveAdminGroup(null);
			}
			if (isReportsMenuOpen && !e.target.closest('.reports-dropdown')) {
				setIsReportsMenuOpen(false);
			}
		};
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	}, [isAdminMenuOpen, isReportsMenuOpen]);

	const handleSignOut = async () => {
		// Clear session cache immediately to prevent stale data
		clearSessionCache();
		try {
			await fetch('/api/logout', { method: 'POST', credentials: 'include' });
		} catch {}
		setIsMobileMenuOpen(false);
		router.push('/signin');
	};

	if (isSignin) return null;

	return (
		<>
			<nav
				className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 anim-fade-in ${
					scrolled ? 'shadow-xl backdrop-blur-lg' : 'shadow-lg'
				}`}
			>
				{/* Background overlay to avoid filtering text; adjust only on Windows */}
				<div
					className="absolute inset-0 -z-10 pointer-events-none"
					style={{
						background: scrolled
							? 'linear-gradient(135deg, rgba(100, 18, 109, 0.95) 0%, rgba(134, 40, 143, 0.95) 100%)'
							: 'linear-gradient(135deg, #64126D 0%, #86288F 100%)',
						filter: isWindows ? 'saturate(1.08) brightness(1.06)' : undefined,
						transition: 'filter 200ms ease, background 200ms ease',
					}}
				/>
				<div className="px-4 sm:px-6 lg:px-8 xl:px-10">
					<div className="flex justify-between items-center h-16">
						{/* Logo */}
						<div className="flex items-center">
							<Link
								href="/dashboard"
								className="flex-shrink-0 flex items-center group"
							>
								<Image
									src={accentLogo}
									alt="Accent Techno Solutions logo"
									width={100}
									height={40}
									className="h-10 w-auto object-contain md:h-11 xl:h-12"
								/>
							</Link>
						</div>

						{/* Desktop Navigation */}
						<div className="hidden md:flex items-center space-x-2 xl:space-x-3">
							{navigation.map((item) => {
								const Icon = item.icon;
								const isActive = pathname === item.href;

								return (
									<Link
										key={item.name}
										href={item.href}
										className={`group flex items-center space-x-2 px-4 py-2.5 xl:px-5 xl:py-3 rounded-xl text-sm xl:text-base font-medium transition-all duration-300 relative overflow-hidden active:scale-[.98] ${
											isActive
												? 'text-white shadow-lg'
												: 'text-white/90 hover:text-white'
										}`}
										style={{
											background: isActive
												? 'rgba(255, 255, 255, 0.2)'
												: 'transparent',
										}}
										onMouseEnter={(e) => {
											if (!isActive) {
												e.target.style.background = 'rgba(255, 255, 255, 0.1)';
											}
										}}
										onMouseLeave={(e) => {
											if (!isActive) {
												e.target.style.background = 'transparent';
											}
										}}
									>
										<Icon
											className={`h-5 w-5 transition-transform duration-200 ${
												isActive ? '' : 'group-hover:scale-110'
											}`}
										/>
										<span className="font-medium">{item.name}</span>
										{isActive && (
											<div
												className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-6 h-0.5 rounded-full"
												style={{ backgroundColor: '#FFFFFF' }}
											/>
										)}
									</Link>
								);
							})}

							{/* Reports Dropdown - Only show if user has reports permissions */}
							{showReportsMenu && (
								<div
									className="relative reports-dropdown"
									onMouseLeave={() => setIsReportsMenuOpen(false)}
								>
									<button
										onClick={() => setIsReportsMenuOpen(!isReportsMenuOpen)}
										onMouseEnter={() => setIsReportsMenuOpen(true)}
										className={`group flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden active:scale-[.98] ${
											pathname.startsWith('/reports')
												? 'text-white shadow-lg'
												: 'text-white/90 hover:text-white'
										}`}
										style={{
											background: pathname.startsWith('/reports')
												? 'rgba(255, 255, 255, 0.2)'
												: isReportsMenuOpen
													? 'rgba(255, 255, 255, 0.1)'
													: 'transparent',
										}}
									>
										<ChartBarIcon
											className={`h-5 w-5 transition-transform duration-200 ${
												pathname.startsWith('/reports')
													? ''
													: 'group-hover:scale-110'
											}`}
										/>
										<span className="font-medium">Reports</span>
										<ChevronDownIcon
											className={`h-4 w-4 transition-transform duration-200 ${
												isReportsMenuOpen ? 'rotate-180' : ''
											}`}
										/>
										{pathname.startsWith('/reports') && (
											<div
												className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-6 h-0.5 rounded-full"
												style={{ backgroundColor: '#FFFFFF' }}
											/>
										)}
									</button>

									{/* Reports Dropdown Menu */}
									{isReportsMenuOpen && (
										<div className="absolute left-0 top-full pt-1 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 anim-drop">
											{reportsMenuItems.map((item) => {
												const Icon = item.icon;
												return (
													<Link
														key={item.name}
														href={item.href}
														onClick={() => setIsReportsMenuOpen(false)}
														className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
															pathname === item.href
																? 'text-purple-700 bg-purple-50 font-medium'
																: 'text-gray-700 hover:bg-gray-50'
														}`}
													>
														<Icon className="h-4 w-4" />
														{item.name}
													</Link>
												);
											})}
										</div>
									)}
								</div>
							)}

							{/* Admin Hover-Flyout - Only show if user has admin permissions */}
							{showAdminMenu && (
								<div
									className="relative admin-dropdown"
									onMouseLeave={() => {
										setIsAdminMenuOpen(false);
										setActiveAdminGroup(null);
									}}
								>
									<button
										onClick={() => {
											setIsAdminMenuOpen((v) => !v);
											setActiveAdminGroup(null);
										}}
										onMouseEnter={() => setIsAdminMenuOpen(true)}
										className={`group flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden active:scale-[.98] ${
											pathname.startsWith('/admin')
												? 'text-white shadow-lg'
												: 'text-white/90 hover:text-white'
										}`}
										style={{
											background: pathname.startsWith('/admin')
												? 'rgba(255, 255, 255, 0.2)'
												: isAdminMenuOpen
													? 'rgba(255, 255, 255, 0.1)'
													: 'transparent',
										}}
									>
										<ShieldCheckIcon
											className={`h-5 w-5 transition-transform duration-200 ${
												pathname.startsWith('/admin')
													? ''
													: 'group-hover:scale-110'
											}`}
										/>
										<span className="font-medium">Admin</span>
										<ChevronDownIcon
											className={`h-4 w-4 transition-transform duration-200 ${
												isAdminMenuOpen ? 'rotate-180' : ''
											}`}
										/>
										{pathname.startsWith('/admin') && (
											<div
												className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-6 h-0.5 rounded-full"
												style={{ backgroundColor: '#FFFFFF' }}
											/>
										)}
									</button>

									{/* Admin Flyout Panel - opens below the button, then the right-side submenu flies out on hover */}
									{isAdminMenuOpen && (
										<div
											className="absolute left-0 top-full pt-2 z-50 anim-drop"
											style={{ paddingTop: '0.5rem' }}
										>
											<div className="flex items-start">
												{/* Left column - group list */}
												<div
													className={`bg-white shadow-xl border border-gray-100 py-2 ${
														activeAdminGroup
															? 'rounded-l-xl border-r-0 w-56'
															: 'rounded-xl w-56'
													}`}
												>
													{adminMenuGroups.map((group) => {
														const GroupIcon = group.icon;
														const isActive = activeAdminGroup === group.key;
														const hasActiveChild = group.items.some(
															(item) => pathname === item.href
														);
														return (
															<button
																key={group.key}
																type="button"
																onMouseEnter={() =>
																	setActiveAdminGroup(group.key)
																}
																onFocus={() => setActiveAdminGroup(group.key)}
																onClick={() =>
																	setActiveAdminGroup((cur) =>
																		cur === group.key ? null : group.key
																	)
																}
																className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
																	isActive || hasActiveChild
																		? 'bg-purple-50 text-[#64126D] font-medium'
																		: 'text-gray-700 hover:bg-gray-50'
																}`}
															>
																<GroupIcon
																	className={`h-4 w-4 ${isActive || hasActiveChild ? 'text-[#64126D]' : 'text-gray-500'}`}
																/>
																<span className="flex-1">{group.name}</span>
																<ChevronRightIcon className="h-3.5 w-3.5 text-gray-400" />
															</button>
														);
													})}
												</div>

												{/* Right column - submenu for the hovered group (only shown when a group is active) */}
												{activeAdminGroup && (
													<div className="min-w-[240px] bg-white rounded-r-xl shadow-xl border border-gray-100 py-2">
														{adminMenuGroups
															.find((g) => g.key === activeAdminGroup)
															?.items.map((item) => {
																const ItemIcon = item.icon;
																return (
																	<Link
																		key={item.href}
																		href={item.href}
																		onClick={() => {
																			setIsAdminMenuOpen(false);
																			setActiveAdminGroup(null);
																		}}
																		className={`flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
																			pathname === item.href
																				? 'text-purple-700 bg-purple-50 font-medium'
																				: 'text-gray-700 hover:bg-gray-50'
																		}`}
																	>
																		<ItemIcon className="h-4 w-4 text-gray-500" />
																		{item.name}
																	</Link>
																);
															})}
													</div>
												)}
											</div>
										</div>
									)}
								</div>
							)}
						</div>

						{/* Profile Menu and Mobile Button */}
						<div className="flex items-center space-x-3">
							{/* User Profile Display */}
							<div className="hidden md:flex items-center space-x-3">
								<div className="flex items-center space-x-2 px-3 py-2 rounded-xl text-white/90">
									<UserCircleIcon className="h-6 w-6" />
									<div className="flex flex-col min-w-[60px]">
										{userLoading && !displayName ? (
											<span className="h-4 w-20 bg-white/20 rounded animate-pulse" />
										) : (
											<span className="text-sm font-medium">{displayName}</span>
										)}
										{displayEmail && (
											<span className="text-xs text-white/60">
												{displayEmail}
											</span>
										)}
									</div>
								</div>

								{/* Sign Out Button */}
								<button
									onClick={handleSignOut}
									className="flex items-center space-x-1.5 px-3 py-2 rounded-xl text-white/90 hover:text-white hover:bg-white/10 transition-all duration-200"
								>
									<ArrowRightOnRectangleIcon className="h-5 w-5" />
								</button>
							</div>

							{/* Mobile menu button */}
							<button
								onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
								className="md:hidden p-2 rounded-xl text-white/90 hover:text-white hover:bg-white/10 transition-all duration-200"
							>
								{isMobileMenuOpen ? (
									<XMarkIcon className="h-6 w-6" />
								) : (
									<Bars3Icon className="h-6 w-6" />
								)}
							</button>
						</div>
					</div>
				</div>

				{/* Mobile Navigation Menu */}
				{isMobileMenuOpen && (
					<div
						className="md:hidden border-t border-white/20 anim-slide-up"
						style={{
							background: `linear-gradient(135deg, #64126D 0%, #86288F 100%)`,
							filter: isWindows ? 'saturate(1.06) brightness(1.05)' : undefined,
						}}
					>
						<div className="px-4 py-4 space-y-2">
							{navigation.map((item) => {
								const Icon = item.icon;
								const isActive = pathname === item.href;

								return (
									<Link
										key={item.name}
										href={item.href}
										className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 active:scale-[.98] ${
											isActive
												? 'bg-white/20 text-white'
												: 'text-white/90 hover:bg-white/10 hover:text-white'
										}`}
									>
										<Icon className="h-5 w-5" />
										<span>{item.name}</span>
									</Link>
								);
							})}

							{/* Reports Section on Mobile */}
							{showReportsMenu && (
								<div className="pt-2 mt-2 border-t border-white/10">
									<p className="px-4 py-2 text-xs font-semibold text-white/60 uppercase tracking-wider">
										Reports
									</p>
									{reportsMenuItems.map((item) => {
										const Icon = item.icon;
										const isActive = pathname === item.href;
										return (
											<Link
												key={item.name}
												href={item.href}
												className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 active:scale-[.98] ${
													isActive
														? 'bg-white/20 text-white'
														: 'text-white/90 hover:bg-white/10 hover:text-white'
												}`}
											>
												<Icon className="h-5 w-5" />
												<span>{item.name}</span>
											</Link>
										);
									})}
								</div>
							)}

							{/* Admin Section on Mobile */}
							{showAdminMenu && (
								<div className="pt-2 mt-2 border-t border-white/10 space-y-3">
									<p className="px-4 py-1 text-xs font-semibold text-white/60 uppercase tracking-wider">
										Admin
									</p>
									{adminMenuGroups.map((group) => (
										<div key={group.key}>
											<p className="px-4 py-1 text-[11px] font-semibold text-white/50 uppercase tracking-wider">
												{group.name}
											</p>
											<div className="grid grid-cols-1 gap-1">
												{group.items.map((item) => {
													const isActive = pathname === item.href;
													return (
														<Link
															key={item.href}
															href={item.href}
															className={`flex items-center space-x-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 active:scale-[.98] ${
																isActive
																	? 'bg-white/20 text-white'
																	: 'text-white/90 hover:bg-white/10 hover:text-white'
															}`}
														>
															<span>{item.name}</span>
														</Link>
													);
												})}
											</div>
										</div>
									))}
								</div>
							)}

							{/* Mobile Profile Section */}
							<div className="pt-4 mt-4 border-t border-white/20">
								<div className="flex items-center space-x-3 px-4 py-2 text-white/90">
									<UserCircleIcon className="h-6 w-6" />
									<div>
										<p className="text-sm font-medium text-white">
											{displayName}
										</p>
										{displayEmail && (
											<p className="text-xs text-white/70">{displayEmail}</p>
										)}
									</div>
								</div>
								<button
									onClick={handleSignOut}
									className="w-full flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium text-white/90 hover:bg-red-500/20 hover:text-white transition-all duration-200 mt-2"
								>
									<ArrowRightOnRectangleIcon className="h-5 w-5" />
									<span>Sign Out</span>
								</button>
							</div>
						</div>
					</div>
				)}
			</nav>

			{/* Overlay for mobile menu */}
			{isMobileMenuOpen && (
				<div
					className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden anim-fade-in"
					onClick={() => setIsMobileMenuOpen(false)}
				/>
			)}

			{/* Masters overlay removed */}
		</>
	);
}
