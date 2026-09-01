'use client';

import Link from 'next/link';

export default function NotFound() {
	return (
		<div className="min-h-[60vh] flex flex-col items-center justify-center px-6 py-12">
			<div className="text-center">
				<h1 className="text-6xl font-bold text-[#64126D]">404</h1>
				<h2 className="mt-4 text-xl font-semibold text-gray-900">
					Page not found
				</h2>
				<p className="mt-2 text-sm text-gray-500 max-w-md mx-auto">
					The page you are looking for doesn&apos;t exist or you don&apos;t have
					access.
				</p>
				<div className="mt-6 flex gap-3 justify-center">
					<Link
						href="/dashboard"
						className="inline-flex items-center rounded-lg bg-[#64126D] px-4 py-2 text-sm font-medium text-white hover:bg-[#52105a] transition-colors"
					>
						Go to Dashboard
					</Link>
					<Link
						href="/signin"
						className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
					>
						Sign in
					</Link>
				</div>
			</div>
		</div>
	);
}
