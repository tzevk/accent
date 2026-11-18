import { Geist_Mono, Poppins } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import AuthGate from '@/components/AuthGate';
import ActivityTracker from '@/components/ActivityTracker';
import AutoRefresh from '@/components/AutoRefresh';
import QueryProvider from '@/components/providers/QueryProvider';
import { SessionProvider } from '@/context/SessionContext';
import { SpellCheckProvider } from '@/hooks/useSpellCheck';
import SkipToMainLink from '@/components/SkipToMainLink';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

const poppins = Poppins({
	variable: '--font-poppins',
	subsets: ['latin'],
	weight: ['400', '500', '600', '700'],
	display: 'swap',
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
				className={`${poppins.variable} ${geistMono.variable} antialiased`}
				suppressHydrationWarning
			>
				<QueryProvider>
					<SessionProvider>
						<SpellCheckProvider>
							<TooltipProvider>
								<SidebarProvider>
									{/* First focusable element: the skip link precedes the sidebar and the navigation. */}
									<SkipToMainLink />
									<Sidebar />
									<SidebarInset className="dashboard-content">
										<AuthGate />
										<ActivityTracker />
										<AutoRefresh timeout={30000} />
										<div className="content-with-sidebar">{children}</div>
									</SidebarInset>
									<Toaster
										position="top-right"
										toastOptions={{
											style: {
												background: '#1f2937',
												color: '#f9fafb',
												border: '1px solid #374151',
											},
											success: {
												iconTheme: {
													primary: '#a855f7',
													secondary: '#f9fafb',
												},
											},
											error: {
												iconTheme: {
													primary: '#ef4444',
													secondary: '#f9fafb',
												},
											},
										}}
									/>
								</SidebarProvider>
							</TooltipProvider>
						</SpellCheckProvider>
					</SessionProvider>
				</QueryProvider>
			</body>
		</html>
	);
}
