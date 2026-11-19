'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
	Building2,
	CalendarDays,
	ChevronDown,
	Fingerprint,
	FileText,
	Landmark,
	LayoutDashboard,
	ChevronsUpDown,
	LibraryBig,
	LogOut,
	ListTodo,
	MessageSquare,
	ShieldCheck,
	Tags,
	Ticket,
	Users,
	Wallet,
} from 'lucide-react';
import {
	Sidebar as SidebarPrimitive,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuSub,
	SidebarMenuSubButton,
	SidebarMenuSubItem,
	SidebarRail,
	SidebarTrigger,
} from '@/components/ui/sidebar';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSessionRBAC } from '@/utils/client-rbac';
import { clearSessionCache } from '@/context/SessionContext';

function NavButton({ icon: Icon, label, href, active, badge }) {
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				render={<Link href={href} />}
				isActive={active}
				tooltip={label}
			>
				<Icon />
				<span>{label}</span>
				{badge ? <SidebarMenuBadge>{badge}</SidebarMenuBadge> : null}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

function MasterButton({ icon: Icon, label, href, active }) {
	return (
		<SidebarMenuSubItem>
			<SidebarMenuSubButton
				render={<Link href={href} title={label} />}
				isActive={active}
			>
				<Icon />
				<span>{label}</span>
			</SidebarMenuSubButton>
		</SidebarMenuSubItem>
	);
}

export default function Sidebar() {
	const pathname = usePathname();
	const {
		user,
		can,
		RESOURCES,
		PERMISSIONS,
		loading: rbacLoading,
	} = useSessionRBAC();
	const router = useRouter();
	const displayName =
		user?.full_name || user?.username || (rbacLoading ? '' : 'Account');
	const displayEmail = user?.email || '';
	const isSignin = pathname.startsWith('/signin');
	const [mounted, setMounted] = useState(false);
	const [unreadMessages, setUnreadMessages] = useState(0);
	const [todoPanelOpen, setTodoPanelOpen] = useState(false);

	const isMasterRoute = ['/employees', '/masters', '/company', '/vendors'].some(
		(prefix) => pathname.startsWith(prefix)
	);
	const [mastersOpen, setMastersOpen] = useState(isMasterRoute);

	useEffect(() => {
		if (isMasterRoute) setMastersOpen(true);
	}, [isMasterRoute]);

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted || isSignin) return;
		try {
			const saved = localStorage.getItem('todoPanelOpen');
			if (saved === 'true') setTodoPanelOpen(true);
		} catch {}
	}, [mounted, isSignin]);

	useEffect(() => {
		const handler = (e) => setTodoPanelOpen(e.detail?.open ?? false);
		window.addEventListener('todoPanelChanged', handler);
		return () => window.removeEventListener('todoPanelChanged', handler);
	}, []);

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
		const interval = setInterval(fetchUnreadCount, 60000);
		return () => clearInterval(interval);
	}, [mounted, isSignin, user]);

	const isOnUserDashboard = pathname.startsWith('/user/dashboard');
	const isOnAdminRoute = pathname.startsWith('/admin/');
	const isAdmin =
		!isOnUserDashboard &&
		(isOnAdminRoute || user?.is_super_admin || user?.role?.code === 'admin');

	const adminRouteOverride = isOnAdminRoute && !isOnUserDashboard;
	const canViewEmployees =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.EMPLOYEES, PERMISSIONS.READ)));
	const canViewRolePermissions =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.SETTINGS, PERMISSIONS.READ)));
	const canViewUsers =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.USERS, PERMISSIONS.READ)));
	const canViewActivities =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.ACTIVITIES, PERMISSIONS.READ)));
	const canViewDeliverables =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.DELIVERABLES, PERMISSIONS.READ)));
	const canViewCompanies =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.COMPANIES, PERMISSIONS.READ)));
	const canViewVendors =
		adminRouteOverride ||
		(!rbacLoading &&
			(user?.is_super_admin || can(RESOURCES.VENDORS, PERMISSIONS.READ)));

	const masterLinks = [
		canViewEmployees && {
			icon: Users,
			label: 'Employees',
			href: '/employees',
			active: pathname === '/employees',
		},
		canViewEmployees && {
			icon: Fingerprint,
			label: 'Attendance',
			href: '/employees/attendance',
			active: pathname === '/employees/attendance',
		},
		canViewEmployees && {
			icon: CalendarDays,
			label: 'Leave Requests',
			href: '/employees/leaves',
			active: pathname === '/employees/leaves',
		},
		canViewEmployees &&
			canViewRolePermissions && {
				icon: ShieldCheck,
				label: 'Edit Role Permissions',
				href: '/employees/role-permissions',
				active: pathname === '/employees/role-permissions',
			},
		canViewUsers && {
			icon: ShieldCheck,
			label: 'User Master',
			href: '/masters/users',
			active: pathname.startsWith('/masters/users'),
		},
		canViewActivities && {
			icon: FileText,
			label: 'Activity Master',
			href: '/masters/activities',
			active: pathname.startsWith('/masters/activities'),
		},
		canViewActivities && {
			icon: FileText,
			label: 'Software Master',
			href: '/masters/software',
			active: pathname.startsWith('/masters/software'),
		},
		canViewDeliverables && {
			icon: FileText,
			label: 'Deliverables Master',
			href: '/masters/deliverables',
			active: pathname.startsWith('/masters/deliverables'),
		},
		canViewDeliverables && {
			icon: FileText,
			label: 'Deliverable Category Master',
			href: '/masters/deliverable-categories',
			active: pathname.startsWith('/masters/deliverable-categories'),
		},
		canViewCompanies && {
			icon: Building2,
			label: 'Company Master',
			href: '/company',
			active: pathname.startsWith('/company'),
		},
		canViewVendors && {
			icon: Building2,
			label: 'Vendor Master',
			href: '/vendors',
			active: pathname.startsWith('/vendors'),
		},
		canViewCompanies && {
			icon: Landmark,
			label: 'Bank Master',
			href: '/masters/banks',
			active: pathname.startsWith('/masters/banks'),
		},
		canViewCompanies && {
			icon: FileText,
			label: 'Description Master',
			href: '/masters/descriptions',
			active: pathname.startsWith('/masters/descriptions'),
		},
		canViewCompanies && {
			icon: Tags,
			label: 'Expense Category Master',
			href: '/masters/categories',
			active: pathname.startsWith('/masters/categories'),
		},
		isAdmin && {
			icon: CalendarDays,
			label: 'Holiday Master',
			href: '/masters/holidays',
			active: pathname.startsWith('/masters/holidays'),
		},
		isAdmin && {
			icon: Wallet,
			label: 'Account Head Master',
			href: '/masters/accounts/account-heads',
			active: pathname.startsWith('/masters/accounts'),
		},
	].filter(Boolean);

	const toggleTodoPanel = () => {
		const next = !todoPanelOpen;
		setTodoPanelOpen(next);
		try {
			localStorage.setItem('todoPanelOpen', String(next));
		} catch {}
		window.dispatchEvent(
			new CustomEvent('toggleTodoPanel', { detail: { open: next } })
		);
	};

	const handleSignOut = async () => {
		clearSessionCache();
		try {
			await fetch('/api/logout', { method: 'POST', credentials: 'include' });
		} catch {}
		router.push('/signin');
	};

	if (isSignin || !mounted) return null;

	return (
		<SidebarPrimitive
			collapsible="icon"
			className="border-sidebar-border"
			style={{ top: 64, height: 'calc(100svh - 4rem)' }}
		>
			<SidebarHeader className="px-1.5 py-2">
				<SidebarTrigger className="focus:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-sidebar-ring" />
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<NavButton
								icon={LayoutDashboard}
								label="Dashboard"
								href={isAdmin ? '/admin/dashboard' : '/user/dashboard'}
								active={
									pathname === '/dashboard' ||
									pathname === '/admin/dashboard' ||
									pathname === '/user/dashboard'
								}
							/>
							<NavButton
								icon={MessageSquare}
								label="Messages"
								href="/messages"
								active={pathname.startsWith('/messages')}
								badge={unreadMessages > 0 ? unreadMessages : null}
							/>
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip="Tasks"
									isActive={todoPanelOpen}
									onClick={toggleTodoPanel}
								>
									<ListTodo />
									<span>Tasks</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
							<NavButton
								icon={Ticket}
								label="Support Tickets"
								href="/tickets"
								active={
									pathname === '/tickets' || pathname.startsWith('/tickets/')
								}
							/>
							<NavButton
								icon={CalendarDays}
								label="Timesheet"
								href="/user/timesheet"
								active={pathname.startsWith('/user/timesheet')}
							/>
							{isAdmin && (
								<NavButton
									icon={Ticket}
									label="Manage Tickets"
									href="/admin/tickets"
									active={pathname === '/admin/tickets'}
								/>
							)}
							{masterLinks.length > 0 && (
								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip="Masters"
										isActive={isMasterRoute}
										data-open={mastersOpen}
										onClick={() => setMastersOpen((open) => !open)}
									>
										<LibraryBig />
										<span>Masters</span>
										<ChevronDown
											className={`ml-auto size-4 transition-transform ${mastersOpen ? 'rotate-180' : ''}`}
										/>
									</SidebarMenuButton>
									{mastersOpen && (
										<SidebarMenuSub>
											{masterLinks.map((link) => (
												<MasterButton key={link.href} {...link} />
											))}
										</SidebarMenuSub>
									)}
								</SidebarMenuItem>
							)}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter className="border-t border-sidebar-border p-2">
				<SidebarMenu>
					<SidebarMenuItem>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<SidebarMenuButton />}
								className="h-auto py-1.5 group-data-[collapsible=icon]:p-0!"
							>
								<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
									{displayName ? displayName.slice(0, 2).toUpperCase() : ''}
								</div>
								<div className="min-w-0 flex-1 text-left group-data-[collapsible=icon]:hidden">
									<p className="truncate text-xs font-medium text-sidebar-foreground">
										{displayName}
									</p>
									{displayEmail && (
										<p className="truncate text-xs text-muted-foreground">
											{displayEmail}
										</p>
									)}
								</div>
								<ChevronsUpDown className="ml-auto size-4 shrink-0 text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden" />
							</DropdownMenuTrigger>
							<DropdownMenuContent
								side="top"
								align="start"
								className="w-(--anchor-width) min-w-56"
							>
								<DropdownMenuItem onClick={handleSignOut}>
									<LogOut />
									<span>Log out</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
		</SidebarPrimitive>
	);
}
