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
  CurrencyDollarIcon,
  TicketIcon,
  BanknotesIcon,
  ClipboardDocumentListIcon
} from '@heroicons/react/24/outline';

export default function Sidebar() {
  const pathname = usePathname();
  const { user, can, RESOURCES, PERMISSIONS, loading: rbacLoading } = useSessionRBAC();
  const isSignin = pathname.startsWith('/signin');
  const [mounted, setMounted] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  
  // Determine if user is admin - but also respect the current route
  // If we're on /user/dashboard, treat as non-admin regardless of context state
  const isOnUserDashboard = pathname.startsWith('/user/dashboard');
  const isOnAdminDashboard = pathname.startsWith('/admin/dashboard');
  const isOnAdminRoute = pathname.startsWith('/admin/');
  
  // Only treat as admin if context says so AND we're NOT on user dashboard
  // OR if we're already on an admin route (means auth passed)
  const isAdmin = !isOnUserDashboard && (isOnAdminRoute || user?.is_super_admin || user?.role?.code === 'admin');

  // Permission checks for each module - also respect route-based override
  // When on admin route, we know user is authorized so show items even while rbacLoading
  // When on user dashboard, don't show admin-level items regardless of context state
  const adminRouteOverride = isOnAdminRoute && !isOnUserDashboard;
  const canViewDashboard = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.DASHBOARD, PERMISSIONS.READ)));
  const canViewEmployees = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.EMPLOYEES, PERMISSIONS.READ)));
  const canViewUsers = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.USERS, PERMISSIONS.READ)));
  const canViewActivities = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.ACTIVITIES, PERMISSIONS.READ)));
  const canViewCompanies = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.COMPANIES, PERMISSIONS.READ)));
  const canViewVendors = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.VENDORS, PERMISSIONS.READ)));
  const canViewLeads = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.LEADS, PERMISSIONS.READ)));
  const canViewProjects = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.PROJECTS, PERMISSIONS.READ)));
  const canViewProposals = adminRouteOverride || (!rbacLoading && !isOnUserDashboard && (user?.is_super_admin || can(RESOURCES.PROPOSALS, PERMISSIONS.READ)));

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || isSignin) return;
    try {
      const saved = localStorage.getItem('sidebarPinned');
      if (saved) setPinned(saved === 'true');
    } catch {}
  }, [mounted, isSignin]);

  useEffect(() => {
    if (!mounted || isSignin) return;
    try { localStorage.setItem('sidebarPinned', String(pinned)); } catch {}
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

  const NavRow = ({ icon: Icon, label, href = '#', active = false, badge, caret }) => (
    <Link
      href={href}
      className={`group/nav-row flex items-center h-9 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
        active ? 'bg-[#64126D] text-white shadow-sm' : 'text-[#64126D] hover:bg-purple-50'
      }`}
      title={label}
    >
      <Icon className={`h-[18px] w-[18px] transition-colors ${active ? 'text-white' : 'text-[#64126D] group-hover/nav-row:text-[#64126D]'}`} />
      <span className={`ml-2.5 hidden sidebar-open:inline ${
        active ? 'text-white' : 'text-gray-900 group-hover/nav-row:text-[#64126D]'
      } group-hover/nav-row:text-inherit transition-all duration-150 ease-out group-hover/nav-row:translate-x-0.5`}>
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
      className={`fixed top-16 bottom-0 left-0 z-40 border-r border-purple-200 bg-[var(--sidebar-bg)] ${pinned ? 'w-[260px]' : 'w-[64px] hover:w-[260px]'} transition-[width] duration-200 ease-out overflow-hidden group/sidebar hidden sm:block`}
    >
      <div className="h-full flex flex-col">
        {/* Pin/Unpin control - at the top */}
        <div className="px-2.5 pt-2 pb-1.5">
          <button
            type="button"
            onClick={() => setPinned((p) => !p)}
            className={`group/nav-row w-full flex items-center h-9 rounded-lg px-2.5 text-[13px] font-medium transition-colors ${
              'text-[#64126D] hover:bg-purple-50'
            }`}
            title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
          >
            <MapPinIcon className={`h-[18px] w-[18px] ${pinned ? 'text-[#64126D] fill-[#64126D]' : 'text-[#64126D]'}`} />
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
              active={pathname === '/dashboard' || pathname === '/admin/dashboard' || pathname === '/user/dashboard'} 
            />
            {/* Messages - always visible with unread badge */}
            <NavRow 
              icon={ChatBubbleLeftRightIcon} 
              label="Messages" 
              href="/messages" 
              active={pathname.startsWith('/messages')} 
              badge={unreadMessages > 0 ? unreadMessages : null}
            />
            {/* Support Tickets - always visible for reporting issues */}
            <NavRow 
              icon={TicketIcon} 
              label="Support Tickets" 
              href="/tickets" 
              active={pathname.startsWith('/tickets')} 
            />
          </div>
        </div>

        <div className="px-2.5 pt-3.5 pb-2">
          {/* MASTERS header */}
          <div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
            <span>MASTERS</span>
          </div>
          <div className="space-y-1 mt-1">
            {canViewEmployees && (
              <NavRow icon={UserGroupIcon} label="Employee Master" href="/employees" active={pathname.startsWith('/employees')} />
            )}
            {canViewUsers && (
              <NavRow icon={ShieldCheckIcon} label="User Master" href="/masters/users" active={pathname.startsWith('/masters/users')} />
            )}
            {canViewActivities && (
              <NavRow icon={DocumentTextIcon} label="Activity Master" href="/masters/activities" active={pathname.startsWith('/masters/activities')} />
            )}
            {canViewActivities && (
              <NavRow icon={DocumentTextIcon} label="Software Master" href="/masters/software" active={pathname.startsWith('/masters/software')} />
            )}
            {canViewCompanies && (
              <NavRow icon={BuildingOfficeIcon} label="Company Master" href="/company" active={pathname.startsWith('/company')} />
            )}
            {canViewVendors && (
              <NavRow icon={BuildingOfficeIcon} label="Vendor Master" href="/vendors" active={pathname.startsWith('/vendors')} />
            )}
          </div>
        </div>

        </div>
    </aside>
  );
}

