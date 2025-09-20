'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import { 
  HomeIcon, 
  DocumentTextIcon, 
  UserGroupIcon, 
  BriefcaseIcon,
  BuildingOfficeIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  UserCircleIcon,
  ChevronDownIcon,
  UsersIcon,
  MapPinIcon,
  DocumentDuplicateIcon,
  CogIcon
} from '@heroicons/react/24/outline';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Leads', href: '/leads', icon: UserGroupIcon },
  { name: 'Proposals', href: '/proposals', icon: DocumentTextIcon },
  { name: 'Projects', href: '/projects', icon: BriefcaseIcon },
];

const mastersNavigation = [
  {
    category: 'User & Role Masters',
    items: [
      { name: 'User Master', href: '/masters/users', icon: UsersIcon },
      { name: 'Role/Permission Master', href: '/masters/roles', icon: CogIcon },
    ]
  },
  {
    category: 'Client & Contact Masters', 
    items: [
      { name: 'Client Master', href: '/company', icon: BuildingOfficeIcon },
      { name: 'Contact Master', href: '/masters/contacts', icon: UserCircleIcon },
    ]
  },
  {
    category: 'Lead & Opportunity Masters',
    items: [
      { name: 'Lead Master', href: '/leads', icon: UserGroupIcon },
      { name: 'Opportunity Master', href: '/masters/opportunities', icon: DocumentTextIcon },
    ]
  },
  {
    category: 'Project/Proposal Masters',
    items: [
      { name: 'Proposal Master', href: '/proposals', icon: DocumentTextIcon },
      { name: 'Project Master', href: '/projects', icon: BriefcaseIcon },
    ]
  },
  {
    category: 'Employee/HR Masters',
    items: [
      { name: 'Employee Master', href: '/masters/employees', icon: UsersIcon },
      { name: 'Department Master', href: '/masters/departments', icon: BuildingOfficeIcon },
      { name: 'Designation Master', href: '/masters/designations', icon: CogIcon },
    ]
  },
  {
    category: 'Product/Service Masters',
    items: [
      { name: 'Product/Service Master', href: '/masters/products', icon: DocumentDuplicateIcon },
      { name: 'Pricing/Rate Master', href: '/masters/pricing', icon: CogIcon },
    ]
  },
  {
    category: 'Location & Geography Masters',
    items: [
      { name: 'Location Master', href: '/masters/locations', icon: MapPinIcon },
      { name: 'Region/Zones Master', href: '/masters/regions', icon: MapPinIcon },
    ]
  },
  {
    category: 'Activity & Communication Masters',
    items: [
      { name: 'Activity Master', href: '/masters/activities', icon: DocumentTextIcon },
      { name: 'Campaign Master', href: '/masters/campaigns', icon: DocumentDuplicateIcon },
    ]
  },
  {
    category: 'Document Masters',
    items: [
      { name: 'Document Master', href: '/masters/documents', icon: DocumentDuplicateIcon },
    ]
  },
  {
    category: 'Utility/Configuration Masters',
    items: [
      { name: 'Settings Master', href: '/masters/settings', icon: CogIcon },
      { name: 'Status Master', href: '/masters/status', icon: CogIcon },
      { name: 'Source Master', href: '/masters/sources', icon: CogIcon },
    ]
  }
];

export default function Navbar() {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isMastersMenuOpen, setIsMastersMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Handle scroll effect
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  const handleSignOut = () => {
    window.location.href = '/signin';
  };

  return (
    <>
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'shadow-xl backdrop-blur-lg' : 'shadow-lg'
        }`}
        style={{
          background: scrolled 
            ? `linear-gradient(135deg, rgba(100, 18, 109, 0.95) 0%, rgba(134, 40, 143, 0.95) 100%)`
            : `linear-gradient(135deg, #64126D 0%, #86288F 100%)`
        }}
      >
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo and Brand */}
            <div className="flex items-center">
              <Link 
                href="/dashboard" 
                className="flex-shrink-0 flex items-center group"
              >
                <div 
                  className="h-10 w-10 rounded-xl mr-3 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-200"
                  style={{
                    background: `linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)`
                  }}
                >
                  <BuildingOfficeIcon 
                    className="h-6 w-6" 
                    style={{ color: '#64126D' }}
                  />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white group-hover:text-gray-100 transition-colors">
                    AccentCRM
                  </h1>
                  <p className="text-xs text-white/70 hidden sm:block">
                    Business Management
                  </p>
                </div>
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
                    className={`group flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden ${
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
              
              {/* Masters Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setIsMastersMenuOpen(!isMastersMenuOpen)}
                  className={`group flex items-center space-x-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 relative overflow-hidden text-white/90 hover:text-white`}
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'transparent';
                  }}
                >
                  <CogIcon className="h-5 w-5 transition-transform duration-200 group-hover:scale-110" />
                  <span className="font-medium">Masters</span>
                  <svg
                    className={`ml-1 h-4 w-4 transition-transform ${
                      isMastersMenuOpen ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {isMastersMenuOpen && (
                  <div className="absolute right-0 mt-2 w-96 bg-white border border-gray-200 rounded-xl shadow-xl z-50 max-h-96 overflow-y-auto">
                    <div className="grid grid-cols-2 gap-3 p-6">
                      {mastersNavigation.map((master) => (
                        <div key={master.category} className="space-y-2">
                          <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wide border-b border-gray-100 pb-1">
                            {master.category}
                          </h3>
                          {master.items.map((item) => (
                            <Link
                              key={item.name}
                              href={item.href}
                              className="flex items-center space-x-2 px-3 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-900 rounded-lg transition-colors"
                              onClick={() => setIsMastersMenuOpen(false)}
                            >
                              <item.icon className="h-4 w-4" />
                              <span>{item.name}</span>
                            </Link>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Profile Menu and Mobile Button */}
            <div className="flex items-center space-x-4">
              {/* Profile Dropdown */}
              <div className="relative hidden md:block">
                <button
                  onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-xl text-white/90 hover:text-white hover:bg-white/10 transition-all duration-200"
                >
                  <UserCircleIcon className="h-6 w-6" />
                  <span className="text-sm font-medium">Admin</span>
                  <ChevronDownIcon className={`h-4 w-4 transition-transform duration-200 ${
                    isProfileMenuOpen ? 'rotate-180' : ''
                  }`} />
                </button>

                {/* Profile Dropdown Menu */}
                {isProfileMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">Admin User</p>
                      <p className="text-xs text-gray-500">admin@accentcrm.com</p>
                    </div>
                    <Link
                      href="/settings"
                      className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Cog6ToothIcon className="h-4 w-4 mr-2" />
                      Settings
                    </Link>
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <ArrowRightOnRectangleIcon className="h-4 w-4 mr-2" />
                      Sign Out
                    </button>
                  </div>
                )}
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
            className="md:hidden border-t border-white/20"
            style={{
              background: `linear-gradient(135deg, #64126D 0%, #86288F 100%)`
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
                    className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${
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
              
              {/* Mobile Masters Section */}
              <div className="space-y-2">
                <button
                  onClick={() => setIsMastersMenuOpen(!isMastersMenuOpen)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-all duration-200"
                >
                  <div className="flex items-center space-x-3">
                    <CogIcon className="h-5 w-5" />
                    <span>Masters</span>
                  </div>
                  <svg
                    className={`h-4 w-4 transition-transform ${
                      isMastersMenuOpen ? 'rotate-180' : ''
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {isMastersMenuOpen && (
                  <div className="pl-4 space-y-1">
                    {mastersNavigation.map((master) => (
                      <div key={master.category} className="space-y-1">
                        <h4 className="text-xs font-semibold text-white/70 uppercase tracking-wide px-4 py-1">
                          {master.category}
                        </h4>
                        {master.items.map((item) => (
                          <Link
                            key={item.name}
                            href={item.href}
                            className="flex items-center space-x-2 px-4 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white rounded-lg transition-colors"
                            onClick={() => {
                              setIsMastersMenuOpen(false);
                              setIsMobileMenuOpen(false);
                            }}
                          >
                            <item.icon className="h-4 w-4" />
                            <span>{item.name}</span>
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Mobile Profile Section */}
              <div className="pt-4 mt-4 border-t border-white/20">
                <div className="flex items-center space-x-3 px-4 py-2 text-white/90">
                  <UserCircleIcon className="h-6 w-6" />
                  <div>
                    <p className="text-sm font-medium text-white">Admin User</p>
                    <p className="text-xs text-white/70">admin@accentcrm.com</p>
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
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Overlay for profile menu */}
      {isProfileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 hidden md:block"
          onClick={() => setIsProfileMenuOpen(false)}
        />
      )}

      {/* Overlay for masters menu */}
      {isMastersMenuOpen && (
        <div 
          className="fixed inset-0 z-40 hidden md:block"
          onClick={() => setIsMastersMenuOpen(false)}
        />
      )}
    </>
  );
}
