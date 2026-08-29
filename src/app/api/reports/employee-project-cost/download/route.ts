import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
	const url = new URL(request.url);
	const target = new URL(
		`/api/reports/employee-project-monthly-cost/download${url.search}`,
		url.origin
	);
	const { GET: newGet } =
		await import('@/app/api/reports/employee-project-monthly-cost/download/route');
	const newRequest = new Request(target.toString(), {
		headers: request.headers,
		method: 'GET',
	});
	return newGet(newRequest);
}
