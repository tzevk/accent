import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import AuthGate from '@/components/AuthGate';
import ActivityTracker from '@/components/ActivityTracker';
import AutoRefresh from '@/components/AutoRefresh';
import QueryProvider from '@/components/providers/QueryProvider';
import { SessionProvider } from '@/context/SessionContext';
import { SpellCheckProvider } from '@/hooks/useSpellCheck';

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin'],
});

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
});

export const metadata = {
	title: 'Accent - Project Management',
	description: 'Manage projects, leads, and teams efficiently',
};

export default function RootLayout({ children }) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
				suppressHydrationWarning
			>
				<QueryProvider>
					<SessionProvider>
						<SpellCheckProvider>
							<Sidebar />
							<AuthGate />
							<ActivityTracker />
							<AutoRefresh timeout={30000} />
							<div className="content-with-sidebar dashboard-content">
								{children}
							</div>
							<Toaster
								position="top-right"
								toastOptions={{
									style: {
										background: '#1f2937',
										color: '#f9fafb',
										border: '1px solid #374151',
									},
									success: {
										iconTheme: { primary: '#a855f7', secondary: '#f9fafb' },
									},
									error: {
										iconTheme: { primary: '#ef4444', secondary: '#f9fafb' },
									},
								}}
							/>
						</SpellCheckProvider>
					</SessionProvider>
				</QueryProvider>
			</body>
		</html>
	);
}
