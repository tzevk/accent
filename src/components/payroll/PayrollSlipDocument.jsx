import { formatDateNumeric, formatMonth } from '@/lib/format';
import { slipFigures } from '@/lib/payroll';

/**
 * The printable Payroll Slip document — company banner, earnings/deductions
 * tables and net-pay footer for one month's slip.
 *
 * Rendered by the /admin/payroll/slips/[id] detail route, so a slip has exactly
 * one rendering.
 */
export default function PayrollSlipDocument({ slip }) {
	if (!slip) return null;

	// GROSS / DEDUCTION / NET come from the shared derivation, so this document
	// prints the numbers the slips listing and the PDFs report. The cells used to
	// print the stored DECIMAL strings, so keep two decimals to hold the same
	// characters on screen.
	const { gross, deductions, net } = slipFigures(slip);

	return (
		<div
			className="border-2 rounded overflow-hidden"
			style={{ borderColor: '#64126D' }}
		>
			{/* Company Header Banner */}
			<div
				className="flex items-center"
				style={{
					background:
						'linear-gradient(135deg, #64126D 0%, #86288F 50%, #86288F 100%)',
					padding: '14px 20px',
				}}
			>
				<div className="w-[80px] mr-4 bg-white rounded-md p-1.5">
					<img
						src="/accent-logo.png"
						alt="Accent Logo"
						className="w-full h-auto"
					/>
				</div>
				<div className="flex-1 text-center">
					<h1 className="text-[20px] font-extrabold text-white tracking-wide">
						ACCENT TECHNO SOLUTIONS PVT LTD
					</h1>
					<p className="text-[10px] text-purple-200 font-medium leading-relaxed">
						17/130, ANAND NAGAR, NEHRU ROAD, VAKOLA, SANTACRUZ (E),
					</p>
					<p className="text-[10px] text-purple-200 font-medium leading-relaxed">
						MUMBAI,MAHARASHTRA - 400055
					</p>
					<p className="text-[10px] text-purple-200 font-medium leading-relaxed">
						Mobile: 9324670725
					</p>
				</div>
			</div>

			{/* Month Title Bar */}
			<div
				className="px-3 py-1.5 font-bold text-center text-xs tracking-wide"
				style={{
					background: 'linear-gradient(90deg, #f3e5f5, #e1bee7, #f3e5f5)',
					color: '#64126D',
					borderBottom: '2px solid #64126D',
				}}
			>
				PAYROLL SLIP FOR THE MONTH OF {formatMonth(slip.month).toUpperCase()}
			</div>

			{/* Employee Info Table */}
			<table className="w-full border-collapse text-[11px]">
				<colgroup>
					<col style={{ width: '12%' }} />
					<col style={{ width: '15%' }} />
					<col style={{ width: '12%' }} />
					<col style={{ width: '13%' }} />
					<col style={{ width: '13%' }} />
					<col style={{ width: '13%' }} />
					<col style={{ width: '11%' }} />
					<col style={{ width: '11%' }} />
				</colgroup>
				<tbody>
					<tr>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							NAME :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.employee_name || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							DESIGNATION :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.designation || slip.position || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							TOTAL DAYS :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.standard_working_days || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							TOTAL PAID LEAVES :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.pl_total || 21}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							DEPARTMENT :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.department || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							DATE OF JOINING :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.joining_date ? formatDateNumeric(slip.joining_date) : ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							PRESENT DAYS :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.payable_days || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							PL USED :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.pl_used || 0}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							PF NUMBER :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.pf_number || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							ESIC NUMBER :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.esic_number || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							ABSENT DAYS :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.standard_working_days && slip.payable_days
								? (
										parseFloat(slip.standard_working_days) -
										parseFloat(slip.payable_days)
									).toFixed(1)
								: slip.lop_days || '0.0'}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							BALANCE :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.pl_balance ?? 21 - (slip.pl_used || 0)}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							UAN NUMBER :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.uan_number || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							PAN NO :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
						>
							{slip.pan_number || ''}
						</td>
						<td
							className="px-2 py-1.5 font-bold text-[10px]"
							style={{
								border: '1px solid #d8b4fe',
								background: '#faf5ff',
								color: '#64126D',
							}}
						>
							PAYMENT MODE :
						</td>
						<td
							className="px-2 py-1.5 bg-white"
							style={{ border: '1px solid #d8b4fe' }}
							colSpan={3}
						>
							{slip.payment_mode || ''}
						</td>
					</tr>
				</tbody>
			</table>

			{/* Earnings & Deductions Table */}
			<table className="w-full border-collapse text-[11px]">
				<colgroup>
					<col style={{ width: '25%' }} />
					<col style={{ width: '12.5%' }} />
					<col style={{ width: '12.5%' }} />
					<col style={{ width: '25%' }} />
					<col style={{ width: '25%' }} />
				</colgroup>
				<thead>
					<tr
						style={{
							background: 'linear-gradient(135deg, #64126D, #86288F)',
						}}
					>
						<th
							className="px-2 py-1.5 text-white text-[11px] tracking-wide"
							style={{ border: '1px solid #a855f7' }}
						>
							DESCRIPTION
						</th>
						<th
							className="px-2 py-1.5 text-white text-[11px] tracking-wide"
							style={{ border: '1px solid #a855f7' }}
						>
							GROSS
						</th>
						<th
							className="px-2 py-1.5 text-white text-[11px] tracking-wide"
							style={{ border: '1px solid #a855f7' }}
						>
							EARNING
						</th>
						<th
							className="px-2 py-1.5 text-white text-[11px] tracking-wide"
							style={{ border: '1px solid #a855f7' }}
						>
							DESCRIPTION
						</th>
						<th
							className="px-2 py-1.5 text-white text-[11px] tracking-wide"
							style={{ border: '1px solid #a855f7' }}
						>
							AMOUNT
						</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							BASIC
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.basic || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.basic || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							PROVIDENT FUND
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							{slip.pf_employee || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							DA
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.da || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.da || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							ESIC
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							{slip.esic_employee || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							HRA
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.hra || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.hra || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							PROFESSIONAL TAX
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							{slip.pt || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							CONVEYANCE ALLOWANCE
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.conveyance || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.conveyance || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							LOAN
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							{slip.loan || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							CALL ALLOWANCE
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.call_allowance || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.call_allowance || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							ADVANCE
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							{slip.advance || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							OTHER ALLOWANCE
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.other_allowances || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.other_allowances || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							TAX DEDUCTED AT SOURCE
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							{slip.tds || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							PAID HOLIDAY AMOUNT
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.paid_holiday || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.paid_holiday || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							RETENTION AMOUNT
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						>
							{slip.retention || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							BONUS
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.bonus || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.bonus || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							MLWF
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						>
							{slip.mlwf || ''}
						</td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							OT AMOUNT
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.ot_rate || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#f0fdf4',
							}}
						>
							{slip.ot_rate || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						></td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fef2f2',
							}}
						></td>
					</tr>
					<tr>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							INCENTIVE
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.incentive || ''}
						</td>
						<td
							className="px-2 py-1 text-right font-mono"
							style={{
								border: '1px solid #e9d5ff',
								background: '#ecfdf5',
							}}
						>
							{slip.incentive || ''}
						</td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						></td>
						<td
							className="px-2 py-1"
							style={{
								border: '1px solid #e9d5ff',
								background: '#fff1f2',
							}}
						></td>
					</tr>
					{/* Totals Row */}
					<tr
						className="font-bold"
						style={{
							background: 'linear-gradient(90deg, #e8f5e9, #f3e5f5, #fce4ec)',
						}}
					>
						<td
							className="px-2 py-1.5"
							style={{
								border: '1px solid #d8b4fe',
								borderTop: '2px solid #64126D',
							}}
						>
							GROSS EARNING
						</td>
						<td
							className="px-2 py-1.5 text-right font-mono"
							style={{
								border: '1px solid #d8b4fe',
								borderTop: '2px solid #64126D',
							}}
						></td>
						<td
							className="px-2 py-1.5 text-right font-mono"
							style={{
								border: '1px solid #d8b4fe',
								borderTop: '2px solid #64126D',
								color: '#15803d',
							}}
						>
							{gross.toFixed(2)}
						</td>
						<td
							className="px-2 py-1.5"
							style={{
								border: '1px solid #d8b4fe',
								borderTop: '2px solid #64126D',
							}}
						>
							TOTAL DEDUCTION
						</td>
						<td
							className="px-2 py-1.5 text-right font-mono"
							style={{
								border: '1px solid #d8b4fe',
								borderTop: '2px solid #64126D',
								color: '#b91c1c',
							}}
						>
							{deductions.toFixed(2)}
						</td>
					</tr>
					{/* Net Salary Row */}
					<tr
						style={{
							background: 'linear-gradient(135deg, #64126D, #86288F)',
						}}
					>
						<td
							className="px-2 py-2 text-white"
							style={{ border: '1px solid #a855f7' }}
							colSpan={3}
						></td>
						<td
							className="px-2 py-2 text-white font-extrabold text-[12px] tracking-wide"
							style={{ border: '1px solid #a855f7' }}
						>
							NET SALARY PAYABLE
						</td>
						<td
							className="px-2 py-2 text-right text-white font-extrabold text-[13px] font-mono"
							style={{ border: '1px solid #a855f7' }}
						>
							{net.toFixed(2)}
						</td>
					</tr>
				</tbody>
			</table>

			{/* Footer */}
			<div
				className="text-center text-[10px] font-medium pt-2 pb-2"
				style={{
					background: '#f3e5f5',
					color: '#64126D',
					borderTop: '2px solid #64126D',
				}}
			>
				<p>
					NOTE: THIS IS A COMPUTER GENERATED PAYROLL SLIP HENCE DOESN&apos;T
					REQUIRE SIGNATURE
				</p>
			</div>
		</div>
	);
}
