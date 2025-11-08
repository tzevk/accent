'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, createContext, useContext } from 'react';
import {
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  MapPinIcon,
  UserGroupIcon,
  UsersIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

// Context for mobile sidebar state
const MobileSidebarContext = createContext({
  isOpen: false,
  setIsOpen: () => {},
});

export const useMobileSidebar = () => useContext(MobileSidebarContext);

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const isSignin = pathname.startsWith('/signin');
  const [mounted, setMounted] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const NavRow = ({ icon: Icon, label, href = '#', active = false, badge, caret, mobile = false }) => (
    <Link
      href={href}
      onClick={() => mobile && setMobileOpen(false)}
      className={`group/nav-row flex items-center h-11 rounded-xl px-3 text-sm font-medium transition-colors ${
        active ? 'bg-[#64126D] text-white shadow-sm' : 'text-[#64126D] hover:bg-purple-50'
      }`}
      title={label}
    >
      <Icon className={`h-5 w-5 transition-colors ${active ? 'text-white' : 'text-[#64126D] group-hover/nav-row:text-[#64126D]'}`} />
      <span className={`ml-3 ${mobile ? 'inline' : 'hidden sidebar-open:inline'} ${
        active ? 'text-white' : 'text-gray-900 group-hover/nav-row:text-[#64126D]'
      } group-hover/nav-row:text-inherit transition-all duration-150 ease-out group-hover/nav-row:translate-x-0.5`}>
        {label}
      </span>
      {badge ? (
        <span className={`ml-auto ${mobile ? 'inline-flex' : 'hidden sidebar-open:inline-flex'} items-center text-[10px] font-semibold rounded-full px-2 py-0.5 bg-purple-100 text-[#64126D]`}>
          {badge}
        </span>
      ) : null}
      {caret ? (
        <ChevronDownIcon className={`ml-auto ${mobile ? 'inline' : 'hidden sidebar-open:inline'} h-4 w-4 text-[#64126D]`} />
      ) : null}
    </Link>
  );

  // Close mobile sidebar when route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Provide mobile sidebar context globally
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.mobileSidebarContext = { isOpen: mobileOpen, setIsOpen: setMobileOpen };
      window.openMobileSidebar = () => setMobileOpen(true);
      window.closeMobileSidebar = () => setMobileOpen(false);
      window.toggleMobileSidebar = () => setMobileOpen(prev => !prev);
    }
  }, [mobileOpen]);

  if (isSignin || !mounted) return null;

  const sidebarContent = (
    <div className="h-full flex flex-col">
      {/* Top spacing to replace removed brand block */}
      <div className="px-3 pt-2 pb-2" />

      <div className="px-3 pb-2">
        {/* PAGES header */}
        <div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
          <span>PAGES</span>
        </div>
        <div className="space-y-1 mt-1">
          <NavRow icon={ClockIcon} label="Dashboard" href="/dashboard" active={pathname === '/dashboard'} />
        </div>
      </div>

      <div className="px-3 pt-4 pb-2">
        {/* MASTERS header */}
        <div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
          <span>MASTERS</span>
        </div>
        <div className="space-y-1 mt-1">
          <NavRow icon={UserGroupIcon} label="Employee Master" href="/employees" active={pathname.startsWith('/employees')} />
          <NavRow icon={UsersIcon} label="User Master" href="/masters/users" active={pathname.startsWith('/masters/users')} />
          <NavRow icon={DocumentTextIcon} label="Activity Master" href="/masters/activities" active={pathname.startsWith('/masters/activities')} />
          <NavRow icon={BuildingOfficeIcon} label="Company Master" href="/company" active={pathname.startsWith('/company')} />
          <NavRow icon={BuildingOfficeIcon} label="Vendor Master" href="/vendors" active={pathname.startsWith('/vendors')} />
          {/* Document Master removed from sidebar per request */}
        </div>
      </div>

      <div className="mt-auto px-3 pt-4 pb-4">
        {/* SETTINGS header */}
        <div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
          <span>SETTINGS</span>
        </div>
        <div className="mt-1">
          <NavRow icon={Cog6ToothIcon} label="My Profile" href="/profile" active={pathname.startsWith('/profile')} />
        </div>
        {/* Pin/Unpin control (no company logo) */}
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setPinned((p) => !p)}
            className={`group/nav-row w-full flex items-center h-11 rounded-xl px-3 text-sm font-medium transition-colors ${
              'text-[#64126D] hover:bg-purple-50'
            }`}
            title={pinned ? 'Unpin sidebar' : 'Pin sidebar'}
          >
            <MapPinIcon className={`h-5 w-5 ${pinned ? 'text-[#64126D] fill-[#64126D]' : 'text-[#64126D]'}`} />
            <span className="ml-3 hidden sidebar-open:inline text-gray-900">
              {pinned ? 'Unpin Sidebar' : 'Pin Sidebar'}
            </span>
          </button>
        </div>
        {/* Logout button */}
        <div className="mt-2">
          <button
            type="button"
            onClick={handleLogout}
            className="group/nav-row w-full flex items-center h-11 rounded-xl px-3 text-sm font-medium text-[#64126D] hover:bg-purple-50"
            title="Sign out"
          >
            {/* Reuse an icon for now */}
            <Cog6ToothIcon className="h-5 w-5 text-[#64126D]" />
            <span className="ml-3 hidden sidebar-open:inline text-gray-900">Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        data-pinned={pinned}
        className={`fixed top-16 bottom-0 left-0 z-40 border-r border-purple-200 bg-white ${pinned ? 'w-[260px]' : 'w-[64px] hover:w-[260px]'} transition-[width] duration-200 ease-out overflow-hidden group/sidebar hidden sm:block`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      <div
        className={`fixed inset-0 z-50 sm:hidden transition-opacity duration-300 ${
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />

        {/* Sidebar Drawer */}
        <aside
          className={`absolute top-0 left-0 bottom-0 w-[280px] bg-white border-r border-purple-200 shadow-xl transform transition-transform duration-300 ease-out ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="h-full flex flex-col">
            {/* Mobile Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-purple-200">
              <h2 className="text-lg font-semibold text-[#64126D]">Menu</h2>
              <button
                onClick={() => setMobileOpen(false)}
                className="p-2 rounded-lg text-gray-600 hover:bg-purple-50 hover:text-[#64126D] transition-colors"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Mobile Sidebar Content - Always show labels */}
            <div className="flex-1 overflow-y-auto">
              <div className="px-3 pt-4 pb-2">
                <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
                  <span>PAGES</span>
                </div>
                <div className="space-y-1 mt-1">
                  <NavRow icon={ClockIcon} label="Dashboard" href="/dashboard" active={pathname === '/dashboard'} mobile />
                </div>
              </div>

              <div className="px-3 pt-4 pb-2">
                <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
                  <span>MASTERS</span>
                </div>
                <div className="space-y-1 mt-1">
                  <NavRow icon={UserGroupIcon} label="Employee Master" href="/employees" active={pathname.startsWith('/employees')} mobile />
                  <NavRow icon={UsersIcon} label="User Master" href="/masters/users" active={pathname.startsWith('/masters/users')} mobile />
                  <NavRow icon={DocumentTextIcon} label="Activity Master" href="/masters/activities" active={pathname.startsWith('/masters/activities')} mobile />
                  <NavRow icon={BuildingOfficeIcon} label="Company Master" href="/company" active={pathname.startsWith('/company')} mobile />
                  <NavRow icon={BuildingOfficeIcon} label="Vendor Master" href="/vendors" active={pathname.startsWith('/vendors')} mobile />
                </div>
              </div>

              <div className="mt-auto px-3 pt-4 pb-4">
                <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
                  <span>SETTINGS</span>
                </div>
                <div className="mt-1">
                  <NavRow icon={Cog6ToothIcon} label="My Profile" href="/profile" active={pathname.startsWith('/profile')} mobile />
                </div>
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="w-full flex items-center h-11 rounded-xl px-3 text-sm font-medium text-[#64126D] hover:bg-purple-50"
                  >
                    <Cog6ToothIcon className="h-5 w-5 text-[#64126D]" />
                    <span className="ml-3 text-gray-900">Sign out</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    router.push('/signin');
  }
}

