'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';
import {
	ChevronDownIcon,
	ClockIcon,
	MapPinIcon,
	UserGroupIcon,
	DocumentTextIcon,
	BuildingOfficeIcon,
	ShieldCheckIcon,
	ChatBubbleLeftRightIcon,
	TicketIcon,
	BanknotesIcon,
	CalendarDaysIcon,
	ChartBarSquareIcon,
	ClipboardDocumentListIcon,
	BuildingLibraryIcon,
	TagIcon,
	ArrowDownCircleIcon,
	ArrowUpCircleIcon,
	ReceiptPercentIcon,
	WalletIcon,
	ClipboardDocumentCheckIcon,
} from '@heroicons/react/24/outline';

export default function Sidebar() {
	const pathname = usePathname();
	const {
		user,
		can,
		RESOURCES,
		PERMISSIONS,
		loading: rbacLoading,
	} = useSessionRBAC();
	const isSignin = pathname.startsWith('/signin');
	const [mounted, setMounted] = useState(false);
	const [pinned, setPinned] = useState(false);
	const [unreadMessages, setUnreadMessages] = useState(0);
	const [accountMasterExpanded, setAccountMasterExpanded] = useState(false);
	const [employeeMasterExpanded, setEmployeeMasterExpanded] = useState(false);

	// Auto-expand employee dropdown when on an employee route
	useEffect(() => {
		if (pathname.startsWith('/employees')) {
			setEmployeeMasterExpanded(true);
		}
	}, [pathname]);
	const [financeExpanded, setFinanceExpanded] = useState(false);

	useEffect(() => {
		if (
			pathname.startsWith('/admin/quotation') ||
			pathname.startsWith('/admin/purchase-invoice') ||
			pathname.startsWith('/admin/expenses') ||
			pathname.startsWith('/admin/other-expenses') ||
			pathname.startsWith('/admin/petty-cash-expenses') ||
			pathname.startsWith('/admin/payment-receivable') ||
			pathname.startsWith('/admin/payment-payable') ||
			pathname.startsWith('/admin/invoice') ||
			pathname.startsWith('/admin/purchase-order') ||
			pathname.startsWith('/admin/outgoing-purchase-order') ||
			pathname.startsWith('/admin/cash-voucher') ||
			pathname.startsWith('/admin/payment-entry') ||
			pathname.startsWith('/admin/accounts')
		) {
			setFinanceExpanded(true);
		}
	}, [pathname]);

	const [todoPanelOpen, setTodoPanelOpen] = useState(false);

	// Sync todoPanelOpen from localStorage on mount
	useEffect(() => {
		if (!mounted || isSignin) return;
		try {
			const saved = localStorage.getItem('todoPanelOpen');
			if (saved === 'true') setTodoPanelOpen(true);
		} catch {}
	}, [mounted, isSignin]);

	// Listen for external toggle events (e.g. panel closed from dashboard)
	useEffect(() => {
		const handler = (e) => setTodoPanelOpen(e.detail?.open ?? false);
		window.addEventListener('todoPanelChanged', handler);
		return () => window.removeEventListener('todoPanelChanged', handler);
	}, []);

	// Determine if user is admin - but also respect the current route
	// If we're on /user/dashboard, treat as non-admin regardless of context state
	const isOnUserDashboard = pathname.startsWith('/user/dashboard');
	const isOnAdminDashboard = pathname.startsWith('/admin/dashboard');
	const isOnAdminRoute = pathname.startsWith('/admin/');

	// Only treat as admin if context says so AND we're NOT on user dashboard
	// OR if we're already on an admin route (means auth passed)
	const isAdmin =
		!isOnUserDashboard &&
		(isOnAdminRoute || user?.is_super_admin || user?.role?.code === 'admin');

	// Permission checks for each module - also respect route-based override
	// When on admin route, we know user is authorized so show items even while rbacLoading
	// When on user dashboard, don't show admin-level items regardless of context state
	const adminRouteOverride = isOnAdminRoute && !isOnUserDashboard;
	const canViewDashboard =
		adminRouteOverride ||
		(!rbacLoading &&
			!isOnUserDashboard &&
			(user?.is_super_admin || can(RESOURCES.DASHBOARD, PERMISSIONS.READ)));
	const canViewEmployees =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.EMPLOYEES, PERMISSIONS.READ)));
	const canViewUsers =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.USERS, PERMISSIONS.READ)));
	const canViewActivities =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.ACTIVITIES, PERMISSIONS.READ)));
	const canViewCompanies =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.COMPANIES, PERMISSIONS.READ)));
	const canViewVendors =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.VENDORS, PERMISSIONS.READ)));
	const canViewLeads =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.LEADS, PERMISSIONS.READ)));
	const canViewProjects =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.PROJECTS, PERMISSIONS.READ)));
	const canViewProposals =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.PROPOSALS, PERMISSIONS.READ)));

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted || isSignin) return;
		try {
			const saved = localStorage.getItem('sidebarPinned');
			if (saved) setPinned(saved === 'true');
		} catch {}
	}, [mounted, isSignin]);

	useEffect(() => {
		if (!mounted || isSignin) return;
		try {
			localStorage.setItem('sidebarPinned', String(pinned));
		} catch {}
	}, [pinned, mounted, isSignin]);

	// Fetch unread message count
	useEffect(() => {
		if (!mounted || isSignin || !user) return;

		const fetchUnreadCount = async () => {
			try {
				const res = await fetch('/api/messages/unread-count');
				const data = await res.json();
				if (data.success) {
					setUnreadMessages(data.data.unread_count);
				}
			} catch (error) {
				console.error('Failed to fetch unread messages:', error);
			}
		};

		fetchUnreadCount();
		// Poll every 60 seconds
		const interval = setInterval(fetchUnreadCount, 60000);
		return () => clearInterval(interval);
	}, [mounted, isSignin, user]);

	const NavRow = ({
		icon: Icon,
		label,
		href = '#',
		active = false,
		badge,
		caret,
	}) => (
		<Link
			href={href}
			className={`group/nav-row flex items-center h-10 xl:h-11 rounded-lg px-2.5 xl:px-3 text-[13px] xl:text-[14px] font-medium transition-colors ${
				active
					? 'bg-[#64126D] text-white shadow-sm'
					: 'text-[#64126D] hover:bg-purple-50'
			}`}
			title={label}
		>
			<Icon
				className={`h-[18px] w-[18px] xl:h-5 xl:w-5 transition-colors ${active ? 'text-white' : 'text-[#64126D] group-hover/nav-row:text-[#64126D]'}`}
			/>
			<span
				className={`ml-2.5 hidden sidebar-open:inline ${
					active
						? 'text-white'
						: 'text-gray-900 group-hover/nav-row:text-[#64126D]'
				} group-hover/nav-row:text-inherit transition-all duration-150 ease-out group-hover/nav-row:translate-x-0.5`}
			>
				{label}
			</span>
			{badge ? (
				<span className="ml-auto hidden sidebar-open:inline-flex items-center text-[10px] font-semibold rounded-full px-1.5 py-0.5 bg-purple-100 text-[#64126D]">
					{badge}
				</span>
			) : null}
			{caret ? (
				<ChevronDownIcon className="ml-auto hidden sidebar-open:inline h-4 w-4 text-[#64126D]" />
			) : null}
		</Link>
	);

	if (isSignin || !mounted) return null;

	return (
		<aside
			data-pinned={pinned}
			className={`fixed top-16 bottom-0 left-0 z-40 border-r border-purple-200 bg-[var(--sidebar-bg)] ${pinned ? 'w-[260px] xl:w-[280px]' : 'w-[64px] hover:w-[260px] xl:hover:w-[280px]'} transition-[width] duration-200 ease-out overflow-hidden group/sidebar hidden sm:block`}
		>
			<div className="h-full flex flex-col overflow-y-auto overflow-x-hidden">
				{/* Pin/Unpin control - at the top */}
				<div className="px-2.5 pt-2 pb-1.5">
					<button
						type="button"
						onClick={() => setPinned((p) => !p)}
						className={`group/nav-row w-full flex items-center h-10 xl:h-11 rounded-lg px-2.5 xl:px-3 text-[13px] xl:text-[14px] font-medium transition-colors ${'text-[#64126D] hover:bg-purple-50'}`}
						title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
					>
						<MapPinIcon
							className={`h-[18px] w-[18px] xl:h-5 xl:w-5 ${pinned ? 'text-[#64126D] fill-[#64126D]' : 'text-[#64126D]'}`}
						/>
						<span className="ml-2.5 hidden sidebar-open:inline text-gray-900">
							{pinned ? 'Unpin Sidebar' : 'Pin Sidebar'}
						</span>
					</button>
				</div>

				<div className="px-2.5 pb-2">
					{/* PAGES header */}
					<div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
						<span>PAGES</span>
					</div>
					<div className="space-y-1 mt-1">
						{/* Dashboard - route based on user role */}
						<NavRow
							icon={ClockIcon}
							label="Dashboard"
							href={isAdmin ? '/admin/dashboard' : '/user/dashboard'}
							active={
								pathname === '/dashboard' ||
								pathname === '/admin/dashboard' ||
								pathname === '/user/dashboard'
							}
						/>
						{/* Messages - always visible with unread badge */}
						<NavRow
							icon={ChatBubbleLeftRightIcon}
							label="Messages"
							href="/messages"
							active={pathname.startsWith('/messages')}
							badge={unreadMessages > 0 ? unreadMessages : null}
						/>
						{/* Tasks - toggle todo panel */}
						<button
							onClick={() => {
								const next = !todoPanelOpen;
								setTodoPanelOpen(next);
								try {
									localStorage.setItem('todoPanelOpen', String(next));
								} catch {}
								window.dispatchEvent(
									new CustomEvent('toggleTodoPanel', { detail: { open: next } })
								);
							}}
							className={`group/nav-row w-full flex items-center h-10 xl:h-11 rounded-lg px-2.5 xl:px-3 text-[13px] xl:text-[14px] font-medium transition-colors ${
								todoPanelOpen
									? 'bg-[#64126D] text-white shadow-sm'
									: 'text-[#64126D] hover:bg-purple-50'
							}`}
							title="Tasks"
						>
							<ClipboardDocumentListIcon
								className={`h-[18px] w-[18px] xl:h-5 xl:w-5 transition-colors ${todoPanelOpen ? 'text-white' : 'text-[#64126D]'}`}
							/>
							<span
								className={`ml-2.5 hidden sidebar-open:inline ${
									todoPanelOpen
										? 'text-white'
										: 'text-gray-900 group-hover/nav-row:text-[#64126D]'
								} transition-all duration-150 ease-out group-hover/nav-row:translate-x-0.5`}
							>
								Tasks
							</span>
						</button>
						{/* Support Tickets - always visible for reporting issues */}
						<NavRow
							icon={TicketIcon}
							label="Support Tickets"
							href="/tickets"
							active={
								pathname === '/tickets' || pathname.startsWith('/tickets/')
							}
						/>
						{/* Ticket Management - admin only */}
						{isAdmin && (
							<NavRow
								icon={TicketIcon}
								label="Manage Tickets"
								href="/admin/tickets"
								active={pathname === '/admin/tickets'}
							/>
						)}
					</div>
				</div>

				{(canViewEmployees ||
					canViewUsers ||
					canViewActivities ||
					canViewCompanies ||
					canViewVendors ||
					isAdmin) && (
					<div className="px-2.5 pt-3.5 pb-2">
						{/* MASTERS header */}
						<div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
							<span>MASTERS</span>
						</div>
						<div className="space-y-1 mt-1">
							{canViewEmployees && (
								<>
									<button
										onClick={() =>
											setEmployeeMasterExpanded(!employeeMasterExpanded)
										}
										className={`group/nav-row w-full flex items-center h-10 xl:h-11 rounded-lg px-2.5 xl:px-3 text-[13px] xl:text-[14px] font-medium transition-colors ${
											pathname.startsWith('/employees')
												? 'bg-[#64126D] text-white shadow-sm'
												: 'text-[#64126D] hover:bg-purple-50'
										}`}
										title="Employee Master"
									>
										<UserGroupIcon
											className={`h-[18px] w-[18px] xl:h-5 xl:w-5 transition-colors ${pathname.startsWith('/employees') ? 'text-white' : 'text-[#64126D]'}`}
										/>
										<span
											className={`ml-2.5 hidden sidebar-open:inline ${pathname.startsWith('/employees') ? 'text-white' : 'text-gray-900'}`}
										>
											Employee Master
										</span>
										<ChevronDownIcon
											className={`ml-auto hidden sidebar-open:inline h-4 w-4 transition-transform ${employeeMasterExpanded ? 'rotate-180' : ''} ${pathname.startsWith('/employees') ? 'text-white' : 'text-[#64126D]'}`}
										/>
									</button>
									{employeeMasterExpanded && (
										<div className="ml-6 space-y-1 mt-1">
											<Link
												href="/employees"
												className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
													pathname === '/employees'
														? 'bg-purple-100 text-[#64126D]'
														: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
												}`}
											>
												<span className="hidden sidebar-open:inline">
													Add Employee
												</span>
											</Link>
											<Link
												href="/employees/payroll"
												className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
													pathname === '/employees/payroll'
														? 'bg-purple-100 text-[#64126D]'
														: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
												}`}
											>
												<span className="hidden sidebar-open:inline">
													Payroll
												</span>
											</Link>
											<Link
												href="/employees/contract"
												className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
													pathname === '/employees/contract'
														? 'bg-purple-100 text-[#64126D]'
														: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
												}`}
											>
												<span className="hidden sidebar-open:inline">
													Contract
												</span>
											</Link>
											<Link
												href="/employees/attendance"
												className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
													pathname === '/employees/attendance'
														? 'bg-purple-100 text-[#64126D]'
														: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
												}`}
											>
												<span className="hidden sidebar-open:inline">
													Attendance
												</span>
											</Link>
										</div>
									)}
								</>
							)}
							{canViewUsers && (
								<NavRow
									icon={ShieldCheckIcon}
									label="User Master"
									href="/masters/users"
									active={pathname.startsWith('/masters/users')}
								/>
							)}
							{canViewActivities && (
								<NavRow
									icon={DocumentTextIcon}
									label="Activity Master"
									href="/masters/activities"
									active={pathname.startsWith('/masters/activities')}
								/>
							)}
							{canViewActivities && (
								<NavRow
									icon={DocumentTextIcon}
									label="Software Master"
									href="/masters/software"
									active={pathname.startsWith('/masters/software')}
								/>
							)}
							{canViewCompanies && (
								<NavRow
									icon={BuildingOfficeIcon}
									label="Company Master"
									href="/company"
									active={pathname.startsWith('/company')}
								/>
							)}
							{canViewVendors && (
								<NavRow
									icon={BuildingOfficeIcon}
									label="Vendor Master"
									href="/vendors"
									active={pathname.startsWith('/vendors')}
								/>
							)}
							{canViewCompanies && (
								<NavRow
									icon={BuildingLibraryIcon}
									label="Bank Master"
									href="/masters/banks"
									active={pathname.startsWith('/masters/banks')}
								/>
							)}
							{canViewCompanies && (
								<NavRow
									icon={DocumentTextIcon}
									label="Description Master"
									href="/masters/descriptions"
									active={pathname.startsWith('/masters/descriptions')}
								/>
							)}
							{canViewCompanies && (
								<NavRow
									icon={TagIcon}
									label="Category Master"
									href="/masters/categories"
									active={pathname.startsWith('/masters/categories')}
								/>
							)}
							{isAdmin && (
								<NavRow
									icon={CalendarDaysIcon}
									label="Holiday Master"
									href="/masters/holidays"
									active={pathname.startsWith('/masters/holidays')}
								/>
							)}
							{isAdmin && (
								<>
									<button
										onClick={() =>
											setAccountMasterExpanded(!accountMasterExpanded)
										}
										className={`group/nav-row w-full flex items-center h-10 xl:h-11 rounded-lg px-2.5 xl:px-3 text-[13px] xl:text-[14px] font-medium transition-colors ${
											pathname.startsWith('/masters/accounts')
												? 'bg-[#64126D] text-white shadow-sm'
												: 'text-[#64126D] hover:bg-purple-50'
										}`}
									>
										<BanknotesIcon
											className={`h-[18px] w-[18px] xl:h-5 xl:w-5 transition-colors ${pathname.startsWith('/masters/accounts') ? 'text-white' : 'text-[#64126D]'}`}
										/>
										<span
											className={`ml-2.5 hidden sidebar-open:inline ${pathname.startsWith('/masters/accounts') ? 'text-white' : 'text-gray-900'}`}
										>
											Account Master
										</span>
										<ChevronDownIcon
											className={`ml-auto hidden sidebar-open:inline h-4 w-4 transition-transform ${accountMasterExpanded ? 'rotate-180' : ''} ${pathname.startsWith('/masters/accounts') ? 'text-white' : 'text-[#64126D]'}`}
										/>
									</button>
									{accountMasterExpanded && (
										<div className="ml-6 space-y-1 mt-1">
											<Link
												href="/masters/accounts/account-heads"
												className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
													pathname === '/masters/accounts/account-heads'
														? 'bg-purple-100 text-[#64126D]'
														: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
												}`}
											>
												<span className="hidden sidebar-open:inline">
													Account Head Master
												</span>
											</Link>
										</div>
									)}
								</>
							)}
						</div>
					</div>
				)}

				{/* Finance section - admin only, gated on PROPOSALS read access */}
				{canViewProposals && (
					<div className="px-2.5 pt-3.5 pb-2">
						<div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
							<span>FINANCE</span>
						</div>
						<div className="space-y-1 mt-1">
							<button
								onClick={() => setFinanceExpanded(!financeExpanded)}
								className={`group/nav-row w-full flex items-center h-10 xl:h-11 rounded-lg px-2.5 xl:px-3 text-[13px] xl:text-[14px] font-medium transition-colors ${
									pathname.startsWith('/admin/quotation') ||
									pathname.startsWith('/admin/invoice') ||
									pathname.startsWith('/admin/purchase-invoice') ||
									pathname.startsWith('/admin/purchase-order') ||
									pathname.startsWith('/admin/outgoing-purchase-order') ||
									pathname.startsWith('/admin/expenses') ||
									pathname.startsWith('/admin/other-expenses') ||
									pathname.startsWith('/admin/petty-cash-expenses') ||
									pathname.startsWith('/admin/payment-receivable') ||
									pathname.startsWith('/admin/payment-payable') ||
									pathname.startsWith('/admin/cash-voucher') ||
									pathname.startsWith('/admin/payment-entry') ||
									pathname.startsWith('/admin/accounts')
										? 'bg-[#64126D] text-white shadow-sm'
										: 'text-[#64126D] hover:bg-purple-50'
								}`}
								title="Finance"
							>
								<BanknotesIcon
									className={`h-[18px] w-[18px] xl:h-5 xl:w-5 transition-colors ${
										pathname.startsWith('/admin/quotation') ||
										pathname.startsWith('/admin/invoice') ||
										pathname.startsWith('/admin/purchase-invoice') ||
										pathname.startsWith('/admin/purchase-order') ||
										pathname.startsWith('/admin/outgoing-purchase-order') ||
										pathname.startsWith('/admin/expenses') ||
										pathname.startsWith('/admin/other-expenses') ||
										pathname.startsWith('/admin/petty-cash-expenses') ||
										pathname.startsWith('/admin/payment-receivable') ||
										pathname.startsWith('/admin/payment-payable') ||
										pathname.startsWith('/admin/cash-voucher') ||
										pathname.startsWith('/admin/payment-entry') ||
										pathname.startsWith('/admin/accounts')
											? 'text-white'
											: 'text-[#64126D]'
									}`}
								/>
								<span
									className={`ml-2.5 hidden sidebar-open:inline ${
										pathname.startsWith('/admin/quotation') ||
										pathname.startsWith('/admin/invoice') ||
										pathname.startsWith('/admin/purchase-invoice') ||
										pathname.startsWith('/admin/purchase-order') ||
										pathname.startsWith('/admin/outgoing-purchase-order') ||
										pathname.startsWith('/admin/expenses') ||
										pathname.startsWith('/admin/other-expenses') ||
										pathname.startsWith('/admin/petty-cash-expenses') ||
										pathname.startsWith('/admin/payment-receivable') ||
										pathname.startsWith('/admin/payment-payable') ||
										pathname.startsWith('/admin/cash-voucher') ||
										pathname.startsWith('/admin/payment-entry') ||
										pathname.startsWith('/admin/accounts')
											? 'text-white'
											: 'text-gray-900'
									}`}
								>
									Finance
								</span>
								<ChevronDownIcon
									className={`ml-auto hidden sidebar-open:inline h-4 w-4 transition-transform ${financeExpanded ? 'rotate-180' : ''} ${
										pathname.startsWith('/admin/quotation') ||
										pathname.startsWith('/admin/invoice') ||
										pathname.startsWith('/admin/purchase-invoice') ||
										pathname.startsWith('/admin/purchase-order') ||
										pathname.startsWith('/admin/outgoing-purchase-order') ||
										pathname.startsWith('/admin/expenses') ||
										pathname.startsWith('/admin/other-expenses') ||
										pathname.startsWith('/admin/petty-cash-expenses') ||
										pathname.startsWith('/admin/payment-receivable') ||
										pathname.startsWith('/admin/payment-payable') ||
										pathname.startsWith('/admin/cash-voucher') ||
										pathname.startsWith('/admin/payment-entry') ||
										pathname.startsWith('/admin/accounts')
											? 'text-white'
											: 'text-[#64126D]'
									}`}
								/>
							</button>
							{financeExpanded && (
								<div className="ml-6 space-y-1 mt-1">
									<Link
										href="/admin/quotation"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname === '/admin/quotation'
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<DocumentTextIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Quotation (Outgoing)
										</span>
									</Link>
									<Link
										href="/admin/quotation-outgoing"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname === '/admin/quotation-outgoing'
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<DocumentTextIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Quotation (Incoming)
										</span>
									</Link>
									<Link
										href="/admin/invoice"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/invoice')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<DocumentTextIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">Invoice</span>
									</Link>
									<Link
										href="/admin/purchase-invoice"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/purchase-invoice')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<ReceiptPercentIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Purchase Invoice
										</span>
									</Link>
									<Link
										href="/admin/purchase-order"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/purchase-order') &&
											!pathname.startsWith('/admin/outgoing-purchase-order')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<ClipboardDocumentCheckIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Purchase Order
										</span>
									</Link>
									<Link
										href="/admin/outgoing-purchase-order"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/outgoing-purchase-order')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<ClipboardDocumentCheckIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Outgoing PO
										</span>
									</Link>
									<Link
										href="/admin/expenses"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/expenses')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<WalletIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">Expenses</span>
									</Link>
									<Link
										href="/admin/other-expenses"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/other-expenses')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<WalletIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Other Expenses
										</span>
									</Link>
									<Link
										href="/admin/petty-cash-expenses"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/petty-cash-expenses')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<WalletIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Petty Cash Expenses
										</span>
									</Link>
									<Link
										href="/admin/payment-receivable"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/payment-receivable')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<ArrowDownCircleIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Payment Receivable
										</span>
									</Link>
									<Link
										href="/admin/payment-payable"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/payment-payable')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<ArrowUpCircleIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Payment Payable
										</span>
									</Link>
									<Link
										href="/admin/payment-entry"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/payment-entry')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<BanknotesIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Payment Entry
										</span>
									</Link>
									<Link
										href="/admin/cash-voucher"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/cash-voucher')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<DocumentTextIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">
											Cash Voucher
										</span>
									</Link>
									<Link
										href="/admin/accounts"
										className={`group/nav-row flex items-center h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${
											pathname.startsWith('/admin/accounts')
												? 'bg-purple-100 text-[#64126D]'
												: 'text-gray-600 hover:bg-purple-50 hover:text-[#64126D]'
										}`}
									>
										<BanknotesIcon className="h-3.5 w-3.5 mr-2" />
										<span className="hidden sidebar-open:inline">Accounts</span>
									</Link>
								</div>
							)}
						</div>
					</div>
				)}

				{/* Reports section - admin only */}
				{isAdmin && (
					<div className="px-2.5 pt-3.5 pb-2">
						<div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
							<span>REPORTS</span>
						</div>
						<div className="space-y-1 mt-1">
							<NavRow
								icon={ChartBarSquareIcon}
								label="Project Activities"
								href="/reports/project-activities"
								active={pathname.startsWith('/reports/project-activities')}
							/>
						</div>
					</div>
				)}
			</div>
		</aside>
	);
}
