import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import AuthGate from "@/components/AuthGate";
import ActivityTracker from "@/components/ActivityTracker";
import { SessionProvider } from "@/context/SessionContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Accent - Project Management",
  description: "Manage projects, leads, and teams efficiently",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <SessionProvider>
          <Sidebar />
          <AuthGate />
          <ActivityTracker />
          <div className="content-with-sidebar">
            {children}
          </div>
        </SessionProvider>
      </body>
    </html>
  );
}
