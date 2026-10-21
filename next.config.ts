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

	// The four PDF routes launch @sparticuz/chromium. The package's JS
	// resolves from node_modules on Vercel, but it locates its Brotli packs
	// (bin/chromium.br, bin/swiftshader.tar.br) by relative path at runtime,
	// and the file tracer drops them because no import graph reaches those
	// files — the launch then fails with
	// 'The input directory "/var/task/node_modules/@sparticuz/chromium/bin"
	// does not exist'. Force-include the package for those routes only.
	outputFileTracingIncludes: {
		'/api/admin/quotations/download': [
			'./node_modules/@sparticuz/chromium/**/*',
		],
		'/api/admin/invoices/download': ['./node_modules/@sparticuz/chromium/**/*'],
		'/api/admin/payment-entries/get-receipt-pdf': [
			'./node_modules/@sparticuz/chromium/**/*',
		],
		'/api/reports/project-activities/download': [
			'./node_modules/@sparticuz/chromium/**/*',
		],
	},

	// Enable compression
	compress: true,

	// Next buffers every request body when a proxy runs, and silently truncates
	// it past this limit (default 10 MB). The upload route's own cap is 20 MB of
	// image bytes — ~28 MB once base64-encoded — so buffer the whole envelope and
	// let the route's 413 check be the gate instead of a silent truncation.
	experimental: {
		proxyClientMaxBodySize: '28mb',
	},

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
			{
				// Issue #360: the salary-profiles and contract lists merged into
				// the employee hub. The Payroll group deep-links the filtered
				// view, and these permanent redirects keep bookmarks working.
				source: '/employees/payroll',
				destination: '/employees?type=Payroll',
				permanent: true,
			},
			{
				source: '/employees/contract',
				destination: '/employees?type=Contract',
				permanent: true,
			},
			{
				// The Employee Project Monthly Cost report became the Company
				// Monthly Cost report: it now leads with the company's total
				// monthly cost reconciled across every cost source, so the old
				// employee-and-project slug no longer describes it. The
				// permanent redirect keeps bookmarks working.
				source: '/reports/employee-project-monthly-cost',
				destination: '/reports/company-monthly-cost',
				permanent: true,
			},
			{
				// The report's API moved with it. The wildcard carries the
				// download, drilldown and command paths across, and a 308 keeps
				// the method and body of a revision or reconstruction post
				// intact.
				source: '/api/reports/employee-project-monthly-cost/:path*',
				destination: '/api/reports/company-monthly-cost/:path*',
				permanent: true,
			},
		];
	},

	// B6 / SEC-24: static security headers on every route (ADR-0012 § CSP).
	// `script-src 'unsafe-inline'` is unavoidable — Next inlines its bootstrap
	// script — and is contained by `connect-src 'self'` + `img-src 'self'`
	// (a nonce-CSP would force every page to render dynamically; ADR-0012
	// rejected it). Development adds `'unsafe-eval'` on top: React/Turbopack
	// evaluate source URLs to reconstruct callstacks, and without it every dev
	// session logs a CSP EvalError. Production never gets it — the
	// security-uploads-headers E2E asserts the eval-free header against a real
	// production build. HSTS is safe from day one because the app is HTTPS-only
	// on Vercel; `upgrade-insecure-requests` is a no-op on localhost
	// (potentially trustworthy origin).
	async headers() {
		return [
			{
				source: '/(.*)',
				headers: [
					{
						key: 'Content-Security-Policy',
						value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`,
					},
					{
						key: 'Strict-Transport-Security',
						value: 'max-age=63072000; includeSubDomains',
					},
					{ key: 'X-Frame-Options', value: 'DENY' },
					{ key: 'X-Content-Type-Options', value: 'nosniff' },
					{ key: 'Referrer-Policy', value: 'no-referrer' },
				],
			},
			// SEC-02: user content under /uploads is always a server-rasterized PNG
			// (see src/app/api/uploads/route.js); never let a browser sniff or render
			// it inline. Content-Disposition: attachment makes direct navigation
			// download instead of display; <img> subresource loads are unaffected.
			// Last matching rule wins per key, so the attachment handling survives
			// the catch-all CSP rule above.
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
