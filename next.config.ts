import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	// Optimize production builds
	reactStrictMode: true,

	// Optimize images
	images: {
		formats: ['image/avif', 'image/webp'],
		minimumCacheTTL: 60,
	},

	// Reduce bundle size by excluding large packages from server
	serverExternalPackages: [
		'mysql2',
		'sharp',
		'exceljs',
		'jspdf',
		'@react-pdf/renderer',
		'html2canvas',
		'docxtemplater',
		'pizzip',
	],

	// Enable compression
	compress: true,

	// Optimize for production
	poweredByHeader: false,

	// Generate source maps only in development
	productionBrowserSourceMaps: false,

	// ADR-0008 / issues #240-#241: the payroll module moved under /admin/payroll/*,
	// and the near-duplicate slips list dissolved into the run dashboard.
	// Permanent redirects keep bookmarks and saved links to the old URLs working.
	async redirects() {
		return [
			{
				source: '/admin/salary-sheet',
				destination: '/admin/payroll',
				permanent: true,
			},
			{
				source: '/admin/salary-slip',
				destination: '/admin/payroll',
				permanent: true,
			},
			{
				// Issue #241: the slips list is part of the dashboard now; the
				// source matches only the bare path, so /admin/payroll/slips/[id]
				// still resolves to the single-slip detail route.
				source: '/admin/payroll/slips',
				destination: '/admin/payroll',
				permanent: true,
			},
			{
				source: '/admin/payroll-schedules',
				destination: '/admin/payroll/rates',
				permanent: true,
			},
			{
				source: '/admin/da-schedule',
				destination: '/admin/payroll/rates/da',
				permanent: true,
			},
		];
	},

	// SEC-02: user content under /uploads is always a server-rasterized PNG
	// (see src/app/api/uploads/route.js); never let a browser sniff or render
	// it inline. Content-Disposition: attachment makes direct navigation
	// download instead of display; <img> subresource loads are unaffected.
	async headers() {
		return [
			{
				source: '/uploads/:path*',
				headers: [
					{ key: 'X-Content-Type-Options', value: 'nosniff' },
					{ key: 'Content-Disposition', value: 'attachment' },
				],
			},
		];
	},
};

export default nextConfig;
