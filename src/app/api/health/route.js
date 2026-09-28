import { NextResponse } from 'next/server';

// ADR-0014: the unauthenticated uptime probe. It must never gain
// data-bearing fields — no pool stats, versions, or internals.
export function GET() {
	return NextResponse.json({ status: 'ok' });
}
