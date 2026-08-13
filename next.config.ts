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
