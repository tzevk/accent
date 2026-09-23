'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import Navbar from '@/components/Navbar';
import { InlineSpinner } from '@/components/LoadingSpinner';
import PayrollSlipDocument from '@/components/payroll/PayrollSlipDocument';
import { formatMonth } from '@/lib/format';
import { downloadFile } from '@/lib/download';
import { payrollSlipPdfRequest } from '@/lib/payroll';
import {
	ArrowLeftIcon,
	ArrowDownTrayIcon,
	ExclamationCircleIcon,
	PrinterIcon,
} from '@heroicons/react/24/outline';

/**
 * Single Payroll Slip — the focused inspect/print view for one slip id.
 * Reached from the Payroll Run dashboard's rows; the document itself is
 * PayrollSlipDocument, so the slip has exactly one rendering.
 */
export default function PayrollSlipDetailPage() {
	const params = useParams();
	const slipId = params?.id;

	const [slip, setSlip] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [downloading, setDownloading] = useState(false);

	useEffect(() => {
		if (!slipId) return;

		let cancelled = false;

		const load = async () => {
			try {
				setLoading(true);
				setError('');
				const res = await fetch(
					`/api/payroll/slips?id=${encodeURIComponent(slipId)}`
				);
				const data = await res.json();
				if (cancelled) return;

				if (!data.success) {
					setError(data.error || 'Failed to load payroll slip');
					return;
				}

				const found = data.data?.[0];
				if (!found) {
					setError('Payroll slip not found');
					return;
				}

				setSlip(found);
			} catch {
				if (!cancelled) setError('Failed to load payroll slip');
			} finally {
				if (!cancelled) setLoading(false);
			}
		};

		load();

		return () => {
			cancelled = true;
		};
	}, [slipId]);

	const downloadPDF = async () => {
		try {
			setDownloading(true);
			setError('');

			const { url, filename } = payrollSlipPdfRequest(slip, slip.month);
			await downloadFile(url, filename);
		} catch (err) {
			setError(err.message || 'Failed to export PDF');
		} finally {
			setDownloading(false);
		}
	};

	return (
		<div className="min-h-screen bg-gray-50">
			<Navbar />

			<div className="w-full px-4 sm:px-6 lg:px-8 py-6">
				<div className="mb-6 print:hidden">
					<Link
						href="/admin/payroll"
						className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-3 transition-colors w-fit"
					>
						<ArrowLeftIcon className="w-4 h-4 mr-1" />
						Back to Payroll Run
					</Link>

					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
						<div>
							<h1 className="text-2xl font-bold text-gray-900">Payroll Slip</h1>
							<p className="text-sm text-gray-500 mt-0.5">
								{slip
									? `${slip.employee_name || 'Employee'} — ${formatMonth(slip.month)}`
									: 'Inspect and print one Payroll Slip'}
							</p>
						</div>

						{slip && (
							<div className="flex items-center gap-3">
								<button
									onClick={() => window.print()}
									className="inline-flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
								>
									<PrinterIcon className="w-4 h-4 mr-2" />
									Print
								</button>

								<button
									onClick={downloadPDF}
									disabled={downloading}
									className="inline-flex items-center px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors text-sm font-medium"
									style={{
										background: 'linear-gradient(135deg, #64126D, #86288F)',
									}}
								>
									{downloading ? (
										<InlineSpinner className="w-4 h-4 mr-2" />
									) : (
										<ArrowDownTrayIcon className="w-4 h-4 mr-2" />
									)}
									Download PDF
								</button>
							</div>
						)}
					</div>
				</div>

				{error && (
					<div
						className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 print:hidden"
						role="alert"
					>
						<ExclamationCircleIcon className="w-5 h-5 flex-shrink-0" />
						<span className="text-sm">{error}</span>
					</div>
				)}

				{loading ? (
					<div className="flex items-center justify-center py-12">
						<InlineSpinner className="w-8 h-8" />
						<span className="ml-3 text-gray-500">Loading payroll slip...</span>
					</div>
				) : (
					slip && (
						<div className="max-w-3xl">
							<PayrollSlipDocument slip={slip} />
						</div>
					)
				)}
			</div>
		</div>
	);
}
