'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
	ArrowDownTrayIcon,
	ArrowLeftIcon,
	BanknotesIcon,
	ExclamationCircleIcon,
} from '@heroicons/react/24/outline';
import Navbar from '@/components/Navbar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { Button } from '@/components/ui/button';
import {
	Table,
	TableHeader,
	TableBody,
	TableHead,
	TableRow,
	TableCell,
	TableEmpty,
} from '@/components/ui/table';
import { useSession } from '@/context/SessionContext';
import { apiGet } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { cn } from '@/lib/cn';
import { formatCurrency, formatDate, formatMonth } from '@/lib/format';
import { slipPdfFilename } from '@/lib/payroll';

/** One row of GET /api/me/payslips — the signed-in employee's own slip. */
interface MyPayrollSlip {
	id: number;
	month: string;
	net_pay: string | number;
	payment_status: string | null;
	payment_date: string | null;
	employee_name: string | null;
}

interface MyPayrollSlipsResponse {
	success: boolean;
	data: MyPayrollSlip[];
}

/**
 * payroll_slips.payment_status → badge, mirroring the admin Payroll Run
 * dashboard's PAYMENT_STATUSES so a slip's status reads the same to an employee
 * as it does to payroll.
 */
const PAYMENT_STATUS_BADGES: Record<string, { label: string; badge: string }> =
	{
		paid: { label: 'paid', badge: 'bg-green-100 text-green-700' },
		processed: { label: 'processed', badge: 'bg-gray-100 text-gray-700' },
		pending: { label: 'pending', badge: 'bg-yellow-100 text-yellow-700' },
		hold: { label: 'hold', badge: 'bg-red-100 text-red-700' },
	};

const paymentBadge = (slip: MyPayrollSlip) =>
	PAYMENT_STATUS_BADGES[slip.payment_status ?? ''] ??
	PAYMENT_STATUS_BADGES.pending;

/**
 * My Payroll Slips — the signed-in employee's own monthly slips, newest first,
 * each one downloadable as a PDF. Reached from the dashboard's Payroll Slips
 * tile. Served by /api/me/payslips, which scopes every read to this employee
 * and withholds months whose Payroll Run is not finalized yet.
 */
export default function MyPayrollSlipsPage() {
	const router = useRouter();
	const session = useSession() as {
		loading: boolean;
		authenticated: boolean;
	};
	const [slips, setSlips] = useState<MyPayrollSlip[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState('');
	const [downloadError, setDownloadError] = useState('');
	const [downloadingId, setDownloadingId] = useState<number | null>(null);
	const [reloadToken, setReloadToken] = useState(0);

	// Session gate — proxy.ts checks cookie presence only.
	useEffect(() => {
		if (!session.loading && !session.authenticated) {
			router.replace('/signin');
		}
	}, [session.loading, session.authenticated, router]);

	useEffect(() => {
		if (session.loading || !session.authenticated) return;
		let cancelled = false;

		apiGet<MyPayrollSlipsResponse>('/api/me/payslips')
			.then((body) => {
				if (cancelled) return;
				setSlips(body.data ?? []);
				setLoadError('');
			})
			.catch((error: Error) => {
				if (!cancelled) setLoadError(error.message);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [session.loading, session.authenticated, reloadToken]);

	const retry = useCallback(() => {
		setLoading(true);
		setReloadToken((token) => token + 1);
	}, []);

	const downloadSlip = useCallback(async (slip: MyPayrollSlip) => {
		setDownloadingId(slip.id);
		setDownloadError('');
		try {
			await downloadFile(
				`/api/me/payslips/pdf?month=${slip.month}`,
				slipPdfFilename(slip)
			);
		} catch (error) {
			setDownloadError(
				error instanceof Error ? error.message : 'Could not download this slip.'
			);
		} finally {
			setDownloadingId(null);
		}
	}, []);

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<div className="flex pt-2 sm:pl-16">
				<div className="flex-1 min-w-0">
					<div className="pl-0 pr-1 sm:pl-0.5 sm:pr-1.5 lg:pl-1 lg:pr-2 py-2 max-w-6xl mx-auto w-full">
						<button
							type="button"
							onClick={() => router.push('/user/dashboard')}
							className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#64126D] transition-colors rounded-md px-1.5 py-1 -ml-1.5 mb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#64126D]/40"
						>
							<ArrowLeftIcon className="h-4 w-4" aria-hidden />
							Back to Dashboard
						</button>

						{session.loading || loading ? (
							<LoadingSpinner
								message="Loading your Payroll Slips"
								subMessage="Fetching your monthly slips…"
								showTimer={false}
								fullScreen={false}
								size="md"
							/>
						) : (
							<div className="bg-white/80 backdrop-blur-sm rounded-xl border border-gray-200/60 shadow-sm p-3 sm:p-4 xl:p-5">
								<div className="mb-4">
									<h2 className="text-lg font-bold text-gray-900">
										My Payroll Slips
									</h2>
									<p className="text-sm text-gray-500 mt-0.5">
										Your monthly net pay, newest first. A month appears here
										once its payroll is finalized.
									</p>
								</div>

								{loadError && (
									<div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 flex items-center gap-2 text-sm text-red-700">
										<ExclamationCircleIcon className="h-5 w-5 shrink-0" />
										Could not load your Payroll Slips.
										<Button
											variant="outline"
											size="sm"
											onClick={retry}
											className="ml-auto"
										>
											Retry
										</Button>
									</div>
								)}

								{downloadError && (
									<div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 flex items-center gap-2 text-sm text-red-700">
										<ExclamationCircleIcon className="h-5 w-5 shrink-0" />
										{downloadError}
									</div>
								)}

								{!loadError && (
									<div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Month</TableHead>
													<TableHead className="text-right">Net pay</TableHead>
													<TableHead>Payment</TableHead>
													<TableHead>Paid on</TableHead>
													<TableHead className="text-right">Download</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{slips.length === 0 ? (
													<TableEmpty>
														<span className="inline-flex flex-col items-center gap-2">
															<BanknotesIcon className="w-6 h-6 text-gray-300" />
															No Payroll Slips yet — a month appears here once
															its payroll is finalized.
														</span>
													</TableEmpty>
												) : (
													slips.map((slip) => (
														<TableRow key={slip.id}>
															<TableCell className="whitespace-nowrap text-sm font-medium text-gray-900">
																{formatMonth(slip.month)}
															</TableCell>
															<TableCell className="text-right tabular-nums text-sm font-semibold text-gray-900">
																{formatCurrency(slip.net_pay)}
															</TableCell>
															<TableCell>
																<span
																	className={cn(
																		'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize',
																		paymentBadge(slip).badge
																	)}
																>
																	{paymentBadge(slip).label}
																</span>
															</TableCell>
															<TableCell className="whitespace-nowrap text-sm text-gray-600">
																{formatDate(slip.payment_date)}
															</TableCell>
															<TableCell className="text-right">
																<Button
																	variant="outline"
																	size="sm"
																	className="border-[#64126D]/30 text-[#64126D] hover:bg-[#64126D]/5"
																	onClick={() => downloadSlip(slip)}
																	disabled={downloadingId === slip.id}
																>
																	<ArrowDownTrayIcon
																		className="w-4 h-4 mr-1"
																		aria-hidden
																	/>
																	{downloadingId === slip.id
																		? 'Preparing…'
																		: 'PDF'}
																</Button>
															</TableCell>
														</TableRow>
													))
												)}
											</TableBody>
										</Table>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
