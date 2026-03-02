import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { jsPDF } from 'jspdf';

const safeNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const safeStr = (v) => (v == null ? '' : String(v));
const fmtAmt = (v) => {
  const n = safeNum(v);
  return n ? n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '';
};

function formatMonthLabel(monthStr) {
  if (!monthStr) return '';
  const d = new Date(monthStr);
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }).toUpperCase();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN');
}

/**
 * Render one salary slip on the given jsPDF page.
 * Uses landscape A4, offset by yStart.
 */
function renderSlip(doc, slip, yStart) {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  const tableW = pageW - margin * 2;
  let y = yStart + margin;

  // ─── Company Header ───
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text('ACCENT TECHNO SOLUTIONS PVT LTD', pageW / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text('17/130, ANAND NAGAR, NEHRU ROAD, VAKOLA, SANTACRUZ (E),', pageW / 2, y, { align: 'center' });
  y += 4;
  doc.text('MUMBAI, MAHARASHTRA - 400055  |  Mobile: 9324670725', pageW / 2, y, { align: 'center' });
  y += 6;

  // ─── Month Title Bar ───
  doc.setFillColor(232, 232, 232);
  doc.rect(margin, y, tableW, 7, 'F');
  doc.setDrawColor(0);
  doc.rect(margin, y, tableW, 7, 'S');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`SALARY SLIP FOR THE MONTH OF ${formatMonthLabel(slip.month)}`, pageW / 2, y + 5, { align: 'center' });
  y += 9;

  // ─── Employee Info Section ───
  const infoRows = [
    [
      { label: 'NAME', value: safeStr(slip.employee_name) },
      { label: 'DESIGNATION', value: safeStr(slip.designation) },
      { label: 'TOTAL DAYS', value: safeStr(slip.standard_working_days) },
    ],
    [
      { label: 'DEPARTMENT', value: safeStr(slip.department) },
      { label: 'DATE OF JOINING', value: formatDate(slip.joining_date) },
      { label: 'PRESENT DAYS', value: safeStr(slip.payable_days) },
    ],
    [
      { label: 'PF NUMBER', value: safeStr(slip.pf_number) },
      { label: 'ESIC NUMBER', value: safeStr(slip.esic_number) },
      { label: 'ABSENT DAYS', value: slip.standard_working_days && slip.payable_days
          ? (safeNum(slip.standard_working_days) - safeNum(slip.payable_days)).toFixed(1)
          : safeStr(slip.lop_days || '0.0') },
    ],
    [
      { label: 'UAN NUMBER', value: safeStr(slip.uan_number) },
      { label: 'PAN NO', value: safeStr(slip.pan_number) },
      { label: 'TOTAL PAID LEAVES', value: safeStr(slip.pl_total || 21) },
    ],
    [
      { label: 'PAYMENT MODE', value: safeStr(slip.payment_mode) },
      { label: '', value: '' },
      { label: 'PL USED', value: safeStr(slip.pl_used || 0) },
    ],
    [
      { label: '', value: '' },
      { label: '', value: '' },
      { label: 'BALANCE', value: safeStr(slip.pl_balance ?? (21 - (slip.pl_used || 0))) },
    ],
  ];

  const infoCols = [
    { labelW: 30, valueW: 48 },
    { labelW: 34, valueW: 44 },
    { labelW: 28, valueW: 34 },
  ];
  const infoRowH = 6;
  doc.setFontSize(7);

  for (let ri = 0; ri < infoRows.length; ri++) {
    const row = infoRows[ri];
    let x = margin;
    for (let ci = 0; ci < row.length; ci++) {
      const col = infoCols[ci];
      // Label cell
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.rect(x, y, col.labelW, infoRowH, 'S');
      doc.text(row[ci].label + ' :', x + 1.5, y + 4);
      x += col.labelW;
      // Value cell
      doc.setFont('helvetica', 'normal');
      doc.rect(x, y, col.valueW, infoRowH, 'S');
      doc.text(safeStr(row[ci].value), x + 1.5, y + 4);
      x += col.valueW;
    }
    y += infoRowH;
  }

  // ─── Main Earnings / Deductions Table ───
  y += 2;
  const mainCols = [
    { header: 'DESCRIPTION', w: 52 },
    { header: 'GROSS', w: 30 },
    { header: 'EARNING', w: 30 },
    { header: 'DESCRIPTION', w: 52 },
    { header: 'DEDUCTION', w: 30 },
  ];
  // Adjust column widths to fit tableW
  const totalColW = mainCols.reduce((s, c) => s + c.w, 0);
  const scale = tableW / totalColW;
  for (const c of mainCols) c.w *= scale;

  const rowH = 5.5;

  // Header row
  doc.setFillColor(232, 232, 232);
  let hx = margin;
  for (const col of mainCols) {
    doc.rect(hx, y, col.w, rowH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(col.header, hx + col.w / 2, y + 3.8, { align: 'center' });
    hx += col.w;
  }
  y += rowH;

  // Data rows
  const earningsDeductions = [
    { earn: 'BASIC', eGross: slip.basic, eEarn: slip.basic, ded: 'PROVIDENT FUND', dAmt: slip.pf_employee },
    { earn: 'DA', eGross: slip.da, eEarn: slip.da, ded: 'ESIC', dAmt: slip.esic_employee },
    { earn: 'HRA', eGross: slip.hra, eEarn: slip.hra, ded: 'PROFESSIONAL TAX', dAmt: slip.pt },
    { earn: 'CONVEYANCE ALLOWANCE', eGross: slip.conveyance, eEarn: slip.conveyance, ded: 'LOAN', dAmt: slip.loan },
    { earn: 'CALL ALLOWANCE', eGross: slip.call_allowance, eEarn: slip.call_allowance, ded: 'ADVANCE', dAmt: slip.advance },
    { earn: 'OTHER ALLOWANCE', eGross: slip.other_allowances, eEarn: slip.other_allowances, ded: 'TDS', dAmt: slip.tds },
    { earn: 'PAID HOLIDAY AMOUNT', eGross: slip.paid_holiday, eEarn: slip.paid_holiday, ded: 'RETENTION AMOUNT', dAmt: slip.retention },
    { earn: 'BONUS', eGross: slip.bonus, eEarn: slip.bonus, ded: 'MLWF', dAmt: slip.mlwf },
    { earn: 'OT RATE', eGross: slip.ot_rate, eEarn: slip.ot_rate, ded: '', dAmt: '' },
    { earn: 'INCENTIVE', eGross: slip.incentive, eEarn: slip.incentive, ded: '', dAmt: '' },
  ];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  for (const row of earningsDeductions) {
    const vals = [
      { text: row.earn, align: 'left' },
      { text: fmtAmt(row.eGross), align: 'right' },
      { text: fmtAmt(row.eEarn), align: 'right' },
      { text: row.ded, align: 'left' },
      { text: fmtAmt(row.dAmt), align: 'right' },
    ];
    let rx = margin;
    for (let ci = 0; ci < mainCols.length; ci++) {
      const cw = mainCols[ci].w;
      doc.rect(rx, y, cw, rowH, 'S');
      const txt = vals[ci].text;
      if (vals[ci].align === 'right') {
        doc.text(txt, rx + cw - 1.5, y + 3.8, { align: 'right' });
      } else if (vals[ci].align === 'center') {
        doc.text(txt, rx + cw / 2, y + 3.8, { align: 'center' });
      } else {
        doc.text(txt, rx + 1.5, y + 3.8);
      }
      rx += cw;
    }
    y += rowH;
  }

  // ─── Totals Row ───
  doc.setFillColor(232, 232, 232);
  doc.setFont('helvetica', 'bold');
  const totalVals = [
    { text: 'GROSS EARNING', align: 'left' },
    { text: '', align: 'right' },
    { text: fmtAmt(slip.total_earnings || slip.gross_salary), align: 'right' },
    { text: 'TOTAL DEDUCTION', align: 'left' },
    { text: fmtAmt(slip.total_deductions), align: 'right' },
  ];
  // NET SALARY row
  const netVals = [
    { text: '', align: 'left' },
    { text: '', align: 'right' },
    { text: '', align: 'right' },
    { text: 'NET SALARY PAYABLE', align: 'left' },
    { text: fmtAmt(slip.net_salary || slip.net_pay), align: 'right' },
  ];
  let tx = margin;
  for (let ci = 0; ci < mainCols.length; ci++) {
    const cw = mainCols[ci].w;
    doc.rect(tx, y, cw, rowH + 1, 'FD');
    const txt = totalVals[ci].text;
    if (totalVals[ci].align === 'right') {
      doc.text(txt, tx + cw - 1.5, y + 4, { align: 'right' });
    } else if (totalVals[ci].align === 'center') {
      doc.text(txt, tx + cw / 2, y + 4, { align: 'center' });
    } else {
      doc.text(txt, tx + 1.5, y + 4);
    }
    tx += cw;
  }
  y += rowH + 1;

  // Net Salary row
  let nx = margin;
  for (let ci = 0; ci < mainCols.length; ci++) {
    const cw = mainCols[ci].w;
    doc.rect(nx, y, cw, rowH + 1, 'FD');
    const txt = netVals[ci].text;
    if (netVals[ci].align === 'right') {
      doc.text(txt, nx + cw - 1.5, y + 4, { align: 'right' });
    } else if (netVals[ci].align === 'center') {
      doc.text(txt, nx + cw / 2, y + 4, { align: 'center' });
    } else {
      doc.text(txt, nx + 1.5, y + 4);
    }
    nx += cw;
  }
  y += rowH + 3;

  // ─── Footer ───
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100);
  doc.text('NOTE: THIS IS A COMPUTER GENERATED SALARY SLIP HENCE DOESN\'T REQUIRE SIGNATURE', pageW / 2, y, { align: 'center' });
  doc.setTextColor(0);
}

/**
 * GET /api/payroll/bulk-pdf?month=YYYY-MM-01&salary_type=payroll
 * Returns a PDF containing all salary slips for the selected month, one per page.
 */
export async function GET(request) {
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const salaryType = searchParams.get('salary_type');

    if (!month) {
      return NextResponse.json(
        { success: false, error: 'Month is required (format: YYYY-MM-01)' },
        { status: 400 }
      );
    }

    db = await dbConnect();

    let query = `
      SELECT ps.*,
             CONCAT(e.first_name, ' ', e.last_name) as employee_name,
             e.employee_id as employee_code,
             e.department,
             e.grade as designation,
             e.position,
             e.joining_date,
             e.uan as uan_number,
             e.pf_no as pf_number,
             e.esi_no as esic_number,
             e.pan as pan_number,
             e.payment_mode
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ?
    `;
    const params = [month];

    if (salaryType === 'payroll') {
      query += ` AND NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    } else if (salaryType === 'contract') {
      query += ` AND EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    }

    query += ` ORDER BY e.employee_id ASC`;

    const [slips] = await db.execute(query, params);

    if (slips.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No payroll slips found for this month. Please generate payroll first.' },
        { status: 404 }
      );
    }

    // ─── Generate PDF ───
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    for (let i = 0; i < slips.length; i++) {
      if (i > 0) doc.addPage();
      renderSlip(doc, slips[i], 0);
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    const monthLabel = month.substring(0, 7); // YYYY-MM
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Salary_Slips_${monthLabel}.pdf"`,
        'Content-Length': pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error('GET /api/payroll/bulk-pdf error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to generate bulk PDF', details: error.message },
      { status: 500 }
    );
  } finally {
    if (db) db.release();
  }
}
