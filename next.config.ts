// React's development build reconstructs server error stacks in the browser
// with `eval()`, so the dev-only CSP has to allow it; production React and
// Next never eval. `headers()` is evaluated once per build/start, so this
// bakes into the production routes manifest only when NODE_ENV=production
// (build:e2e and CI both set it explicitly).
const isDev = process.env.NODE_ENV === 'development';

const CSP = [
	"default-src 'self'",
	`script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"connect-src 'self'",
	"object-src 'none'",
	"base-uri 'self'",
	"frame-ancestors 'none'",
	"form-action 'self'",
	'upgrade-insecure-requests',
].join('; ');

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
		];
	},

	// B6 / SEC-24: static security headers on every route (ADR-0012 § CSP).
	// `script-src 'unsafe-inline'` is unavoidable — Next inlines its bootstrap
	// script — and is contained by `connect-src 'self'` + `img-src 'self'`
	// (a nonce-CSP would force every page to render dynamically; ADR-0012
	// rejected it). HSTS is safe from day one because the app is HTTPS-only on
	// Vercel; `upgrade-insecure-requests` is a no-op on localhost (potentially
	// trustworthy origin). `'unsafe-eval'` is added in development only (see
	// CSP above) — production React and Next never eval.
	async headers() {
		return [
			{
				source: '/(.*)',
				headers: [
					{
						key: 'Content-Security-Policy',
						value: CSP,
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
