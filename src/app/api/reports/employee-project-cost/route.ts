import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const url = new URL(request.url);
	// Rewrite to new path preserving query string
	const target = new URL(
		`/api/reports/employee-project-monthly-cost${url.search}`,
		url.origin
	);
	// Proxy fetch internally by re-importing handler
	const { GET: newGet } =
		await import('@/app/api/reports/employee-project-monthly-cost/route');
	// Create a new Request with the rewritten URL
	const newRequest = new Request(target.toString(), {
		headers: request.headers,
		method: 'GET',
	});
	return newGet(newRequest);
}

export async function POST(request: Request) {
	return GET(request);
}
