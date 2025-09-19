'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  HomeIcon, 
  DocumentTextIcon, 
  UserGroupIcon, 
  BriefcaseIcon,
  Cog6ToothIcon,
  ArrowRightOnRectangleIcon
} from '@heroicons/react/24/outline';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
  { name: 'Proposals', href: '/proposals', icon: DocumentTextIcon },
  { name: 'Leads', href: '/leads', icon: UserGroupIcon },
  { name: 'Projects', href: '/projects', icon: BriefcaseIcon },
  { name: 'Settings', href: '/settings', icon: Cog6ToothIcon },
];

export default function Navbar() {
  const pathname = usePathname();

  const handleSignOut = () => {
    // TODO: Implement sign out functionality
    window.location.href = '/signin';
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 shadow-lg" style={{ backgroundColor: '#64126D' }}>
      <div className="px-8">
        <div className="flex justify-between h-16">
          {/* Logo and Brand */}
          <div className="flex items-center">
            <Link href="/dashboard" className="flex-shrink-0 flex items-center">
              <h1 className="text-xl font-bold text-white">AccentCRM</h1>
            </Link>
          </div>

          {/* Navigation */}
          <div className="flex items-center space-x-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
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
            
            {/* Sign Out Button */}
            <button
              onClick={handleSignOut}
              className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-medium text-white/90 hover:bg-red-500/20 hover:text-white transition-all duration-300 ml-4"
            >
              <ArrowRightOnRectangleIcon className="h-5 w-5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
