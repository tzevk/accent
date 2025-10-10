'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  DocumentDuplicateIcon,
} from '@heroicons/react/24/outline';

export default function Sidebar() {
  const pathname = usePathname();
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidebarPinned');
      if (saved) setPinned(saved === 'true');
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('sidebarPinned', String(pinned)); } catch {}
  }, [pinned]);

  const NavRow = ({ icon: Icon, label, href = '#', active = false, badge, caret }) => (
    <Link
      href={href}
      className={`group/nav-row flex items-center h-11 rounded-xl px-3 text-sm font-medium transition-colors ${
        active ? 'bg-[#64126D] text-white shadow-sm' : 'text-[#64126D] hover:bg-purple-50'
      }`}
      title={label}
    >
      <Icon className={`h-5 w-5 ${active ? 'text-white' : 'text-[#64126D]'}`} />
      <span className="ml-3 hidden sidebar-open:inline text-gray-900 group-hover/nav-row:text-inherit">
        {label}
      </span>
      {badge ? (
        <span className="ml-auto hidden sidebar-open:inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 bg-purple-100 text-[#64126D]">
          {badge}
        </span>
      ) : null}
      {caret ? (
        <ChevronDownIcon className="ml-auto hidden sidebar-open:inline h-4 w-4 text-[#64126D]" />
      ) : null}
    </Link>
  );

  return (
    <aside
      data-pinned={pinned}
      className={`fixed top-16 bottom-0 left-0 z-40 border-r border-purple-200 bg-white ${pinned ? 'w-[260px]' : 'w-[64px] hover:w-[260px]'} transition-[width] duration-200 ease-out overflow-hidden group/sidebar hidden sm:block`}
    >
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
            <NavRow icon={DocumentDuplicateIcon} label="Document Master" href="/masters/documents" active={pathname.startsWith('/masters/documents')} />
          </div>
        </div>

        <div className="mt-auto px-3 pt-4 pb-4">
          {/* SETTINGS header */}
          <div className="hidden sidebar-open:flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-purple-700/80">
            <span>SETTINGS</span>
          </div>
          <div className="mt-1">
            <NavRow icon={Cog6ToothIcon} label="My Profile" href="#" />
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
        </div>
      </div>
    </aside>
  );
}
