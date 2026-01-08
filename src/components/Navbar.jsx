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
  ChevronDownIcon,  // Still used for Admin dropdown
  ShieldCheckIcon
} from '@heroicons/react/24/outline';
import { useSessionRBAC } from '@/utils/client-rbac';
import { clearSessionCache } from '@/context/SessionContext';

// Base navigation items with their resource keys
const navigationConfig = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon, resource: 'dashboard' },
  { name: 'Leads', href: '/leads', icon: UserGroupIcon, resource: 'leads' },
  { name: 'Proposals', href: '/proposals', icon: DocumentTextIcon, resource: 'proposals' },
  { name: 'Projects', href: '/projects', icon: BriefcaseIcon, resource: 'projects' },
];

// Admin menu items with their resource keys
const adminMenuConfig = [
  { name: 'Quotation', href: '/admin/quotation', resource: 'admin' },
  { name: 'Purchase Order', href: '/admin/purchase-order', resource: 'admin' },
  { name: 'Invoice', href: '/admin/invoice', resource: 'admin' },
  { name: 'Accounts', href: '/admin/accounts', resource: 'admin' },
  { name: 'Live Monitoring', href: '/admin/live-monitoring', resource: 'admin' },
  { name: 'Admin Logs', href: '/admin/activity-logs', resource: 'admin' },
  { name: 'All Todos', href: '/admin/todos', resource: 'admin' },
];

// Masters moved to sidebar; removed from header

export default function Navbar() {
  const router = useRouter();
  const pathname = usePathname();
  const isSignin = pathname.startsWith('/signin');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAdminMenuOpen, setIsAdminMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const { loading: userLoading, user, can, RESOURCES, PERMISSIONS } = useSessionRBAC();
  const displayName = user?.full_name || user?.username || (userLoading ? '...' : 'Account');
  const displayEmail = user?.email || '';

  // Filter navigation items based on user permissions
  const navigation = useMemo(() => {
    if (userLoading || !user) return navigationConfig; // Show all while loading
    if (user.is_super_admin) return navigationConfig; // Super admin sees all
    
    return navigationConfig.filter(item => {
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
  }, [pathname]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (isAdminMenuOpen && !e.target.closest('.admin-dropdown')) {
        setIsAdminMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isAdminMenuOpen]);

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
            transition: 'filter 200ms ease, background 200ms ease'
          }}
        />
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center">
              <Link href="/dashboard" className="flex-shrink-0 flex items-center group">
                <Image
                  src={accentLogo}
                  alt="Accent Techno Solutions logo"
                  width={accentLogo.width}
                  height={accentLogo.height}
                  priority
                  className="h-10 w-auto object-contain md:h-11"
                />
              </Link>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-2">
              {navigation.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`group flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden active:scale-[.98] ${
                      isActive
                        ? 'text-white shadow-lg'
                        : 'text-white/90 hover:text-white'
                    }`}
                    style={{
                      background: isActive 
                        ? 'rgba(255, 255, 255, 0.2)' 
                        : 'transparent'
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
                    <Icon className={`h-5 w-5 transition-transform duration-200 ${
                      isActive ? '' : 'group-hover:scale-110'
                    }`} />
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
              
              {/* Admin Dropdown - Only show if user has admin permissions */}
              {showAdminMenu && (
              <div className="relative admin-dropdown">
                <button
                  onClick={() => setIsAdminMenuOpen(!isAdminMenuOpen)}
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
                        : 'transparent'
                  }}
                  onMouseEnter={(e) => {
                    if (!pathname.startsWith('/admin')) {
                      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!pathname.startsWith('/admin') && !isAdminMenuOpen) {
                      e.target.style.background = 'transparent';
                    }
                  }}
                >
                  <ShieldCheckIcon className={`h-5 w-5 transition-transform duration-200 ${
                    pathname.startsWith('/admin') ? '' : 'group-hover:scale-110'
                  }`} />
                  <span className="font-medium">Admin</span>
                  <ChevronDownIcon className={`h-4 w-4 transition-transform duration-200 ${
                    isAdminMenuOpen ? 'rotate-180' : ''
                  }`} />
                  {pathname.startsWith('/admin') && (
                    <div
                      className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-6 h-0.5 rounded-full"
                      style={{ backgroundColor: '#FFFFFF' }}
                    />
                  )}
                </button>

                {/* Admin Dropdown Menu */}
                {isAdminMenuOpen && (
                  <div className="absolute left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 anim-drop">
                    {adminMenuItems.map((item) => (
                      <Link
                        key={item.name}
                        href={item.href}
                        onClick={() => setIsAdminMenuOpen(false)}
                        className={`flex items-center px-4 py-2 text-sm transition-colors ${
                          pathname === item.href
                            ? 'text-purple-700 bg-purple-50 font-medium'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {item.name}
                      </Link>
                    ))}
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
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{displayName}</span>
                    {displayEmail && (
                      <span className="text-xs text-white/60">{displayEmail}</span>
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
              filter: isWindows ? 'saturate(1.06) brightness(1.05)' : undefined
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
              
              {/* Masters removed on mobile too */}
              
              {/* Mobile Profile Section */}
              <div className="pt-4 mt-4 border-t border-white/20">
                <div className="flex items-center space-x-3 px-4 py-2 text-white/90">
                  <UserCircleIcon className="h-6 w-6" />
                  <div>
                    <p className="text-sm font-medium text-white">{displayName}</p>
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
