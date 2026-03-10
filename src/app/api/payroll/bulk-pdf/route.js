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
 * Draws everything inside a single outer box with equal spacing.
 */
function renderSlip(doc, slip, yStart) {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const tableW = pageW - margin * 2;
  let y = yStart + margin;

  // ─── Outer Box ───
  // We'll calculate the total height at the end and draw the border then.
  const boxStartY = y;

  // ─── Company Header (inside the box) ───
  doc.setFillColor(100, 18, 109);
  doc.rect(margin, y, tableW, 18, 'F');
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('ACCENT TECHNO SOLUTIONS PVT LTD', pageW / 2, y + 7, { align: 'center' });
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.text('17/130, ANAND NAGAR, NEHRU ROAD, VAKOLA, SANTACRUZ (E),', pageW / 2, y + 12, { align: 'center' });
  doc.text('MUMBAI, MAHARASHTRA - 400055  |  Mobile: 9324670725', pageW / 2, y + 16, { align: 'center' });
  y += 18;

  // ─── Month Title Bar ───
  doc.setFillColor(134, 40, 143);
  doc.rect(margin, y, tableW, 8, 'F');
  doc.setDrawColor(100, 18, 109);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text(`SALARY SLIP FOR THE MONTH OF ${formatMonthLabel(slip.month)}`, pageW / 2, y + 5.5, { align: 'center' });
  y += 8;

  // ─── Employee Info Section (4 pairs per row, 8 columns) ───
  const infoRows = [
    [
      { label: 'NAME', value: safeStr(slip.employee_name) },
      { label: 'DESIGNATION', value: safeStr(slip.designation) },
      { label: 'TOTAL DAYS', value: safeStr(slip.standard_working_days) },
      { label: 'TOTAL PAID LEAVES', value: safeStr(slip.pl_total || 21) },
    ],
    [
      { label: 'DEPARTMENT', value: safeStr(slip.department) },
      { label: 'DATE OF JOINING', value: formatDate(slip.joining_date) },
      { label: 'PRESENT DAYS', value: safeStr(slip.payable_days) },
      { label: 'PL USED', value: safeStr(slip.pl_used || 0) },
    ],
    [
      { label: 'PF NUMBER', value: safeStr(slip.pf_number) },
      { label: 'ESIC NUMBER', value: safeStr(slip.esic_number) },
      { label: 'ABSENT DAYS', value: slip.standard_working_days && slip.payable_days
          ? (safeNum(slip.standard_working_days) - safeNum(slip.payable_days)).toFixed(1)
          : safeStr(slip.lop_days || '0.0') },
      { label: 'BALANCE', value: safeStr(slip.pl_balance ?? (21 - (slip.pl_used || 0))) },
    ],
    [
      { label: 'UAN NUMBER', value: safeStr(slip.uan_number) },
      { label: 'PAN NO', value: safeStr(slip.pan_number) },
      { label: 'PAYMENT MODE', value: safeStr(slip.payment_mode || 'NEFT') },
      { label: '', value: '' },
    ],
  ];

  // 8 equal columns across the full table width
  const infoPairW = tableW / 4; // each label+value pair
  const infoLabelW = infoPairW * 0.45;
  const infoValueW = infoPairW * 0.55;
  const infoRowH = 7;

  doc.setDrawColor(100, 18, 109);
  doc.setTextColor(0, 0, 0);

  for (let ri = 0; ri < infoRows.length; ri++) {
    const row = infoRows[ri];
    let x = margin;
    for (let ci = 0; ci < row.length; ci++) {
      // Label cell - light background
      doc.setFillColor(243, 229, 245);
      doc.rect(x, y, infoLabelW, infoRowH, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 18, 109);
      if (row[ci].label) {
        doc.text(row[ci].label + ' :', x + 2, y + 4.5);
      }
      x += infoLabelW;

      // Value cell - white background
      doc.setFillColor(255, 255, 255);
      doc.rect(x, y, infoValueW, infoRowH, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(0, 0, 0);
      doc.text(safeStr(row[ci].value), x + 2, y + 4.5);
      x += infoValueW;
    }
    y += infoRowH;
  }

  // ─── Main Earnings / Deductions Table ───
  // Use 8 columns that align with the employee info grid above:
  // Col 0: Earn DESCRIPTION (label width pair 1)
  // Col 1: GROSS           (value width pair 1)  
  // Col 2: EARNING         (label width pair 2)
  // Col 3: (merged into col 2 for earning value — but we use pair2 value width)
  // For deductions side: Col 4+5 = DESCRIPTION, Col 6+7 = AMOUNT
  // Simpler: use the same 8-column grid as info section
  const colW = tableW / 8; // each column = 1/8 of tableW
  const rowH = 6.5;
  const headerH = rowH + 1;

  // Header row — 8 cells, merged in pairs to show 4 headings:
  // [DESCRIPTION (cols 0-1)] [GROSS (col 2-3)] [EARNING (col 4)] ... 
  // Actually match the web: DESCRIPTION | Gross | EARNING | DESCRIPTION | DEDUCTION
  // Using 8 equal cols: earn desc=2cols, gross=1col, earning=1col, ded desc=2cols, amount=2cols
  const earnDescW = colW * 2;
  const grossW = colW * 1.5;
  const earningW = colW * 1.5;
  const dedDescW = colW * 2;
  const dedAmtW = colW * 1;

  // Recompute to fill exactly tableW
  const rawSum = earnDescW + grossW + earningW + dedDescW + dedAmtW;
  const cols = [
    { header: 'DESCRIPTION', w: earnDescW / rawSum * tableW },
    { header: 'GROSS', w: grossW / rawSum * tableW },
    { header: 'EARNING', w: earningW / rawSum * tableW },
    { header: 'DESCRIPTION', w: dedDescW / rawSum * tableW },
    { header: 'AMOUNT', w: dedAmtW / rawSum * tableW },
  ];

  // Header row
  doc.setFillColor(100, 18, 109);
  doc.setDrawColor(100, 18, 109);
  let hx = margin;
  for (const col of cols) {
    doc.rect(hx, y, col.w, headerH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.text(col.header, hx + col.w / 2, y + 4.8, { align: 'center' });
    hx += col.w;
  }
  doc.setTextColor(0, 0, 0);
  y += headerH;

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
  doc.setFontSize(7);
  doc.setDrawColor(100, 18, 109);
  for (const row of earningsDeductions) {
    const vals = [
      { text: row.earn, align: 'left' },
      { text: fmtAmt(row.eGross), align: 'right' },
      { text: fmtAmt(row.eEarn), align: 'right' },
      { text: row.ded, align: 'left' },
      { text: fmtAmt(row.dAmt), align: 'right' },
    ];
    let rx = margin;
    for (let ci = 0; ci < cols.length; ci++) {
      const cw = cols[ci].w;
      doc.rect(rx, y, cw, rowH, 'S');
      doc.setTextColor(0, 0, 0);
      const txt = vals[ci].text;
      if (vals[ci].align === 'right') {
        doc.text(txt, rx + cw - 2, y + 4.3, { align: 'right' });
      } else {
        doc.text(txt, rx + 2, y + 4.3);
      }
      rx += cw;
    }
    y += rowH;
  }

  // ─── Totals Row ───
  doc.setFillColor(134, 40, 143);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  const totalVals = [
    { text: 'GROSS EARNING', align: 'left' },
    { text: '', align: 'right' },
    { text: fmtAmt(slip.total_earnings || slip.gross_salary), align: 'right' },
    { text: 'TOTAL DEDUCTION', align: 'left' },
    { text: fmtAmt(slip.total_deductions), align: 'right' },
  ];
  let tx = margin;
  for (let ci = 0; ci < cols.length; ci++) {
    const cw = cols[ci].w;
    doc.rect(tx, y, cw, rowH + 1, 'FD');
    const txt = totalVals[ci].text;
    if (totalVals[ci].align === 'right') {
      doc.text(txt, tx + cw - 2, y + 4.8, { align: 'right' });
    } else {
      doc.text(txt, tx + 2, y + 4.8);
    }
    tx += cw;
  }
  y += rowH + 1;

  // ─── Net Salary Row ───
  doc.setFillColor(100, 18, 109);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  // Left 3 cols merged (empty), right 2 cols: label + amount
  const leftW = cols[0].w + cols[1].w + cols[2].w;
  const netLabelW = cols[3].w;
  const netAmtW = cols[4].w;
  const netH = rowH + 2;
  // Left merged cell
  doc.rect(margin, y, leftW, netH, 'FD');
  // Label cell
  doc.rect(margin + leftW, y, netLabelW, netH, 'FD');
  doc.text('NET SALARY PAYABLE', margin + leftW + 2, y + 5.2);
  // Amount cell
  doc.rect(margin + leftW + netLabelW, y, netAmtW, netH, 'FD');
  doc.text(fmtAmt(slip.net_salary || slip.net_pay), margin + leftW + netLabelW + netAmtW - 2, y + 5.2, { align: 'right' });
  y += netH;

  // ─── Footer ───
  doc.setFillColor(243, 229, 245);
  doc.rect(margin, y, tableW, 7, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 18, 109);
  doc.text('NOTE: THIS IS A COMPUTER GENERATED SALARY SLIP HENCE DOESN\'T REQUIRE SIGNATURE', pageW / 2, y + 4.5, { align: 'center' });

  y += 7;

  // ─── Draw Outer Box ───
  doc.setDrawColor(100, 18, 109);
  doc.setLineWidth(0.6);
  doc.rect(margin, boxStartY, tableW, y - boxStartY, 'S');
  doc.setLineWidth(0.2);
  doc.setTextColor(0, 0, 0);
}

/**
 * GET /api/payroll/bulk-pdf?month=YYYY-MM-01&salary_type=payroll&employee_id=123
 * Returns a PDF containing salary slips for the selected month.
 * If employee_id is provided, returns single slip; otherwise returns all slips.
 */
export async function GET(request) {
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let db;
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const salaryType = searchParams.get('salary_type');
    const employeeId = searchParams.get('employee_id');

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
             e.pan as pan_number
      FROM payroll_slips ps
      JOIN employees e ON e.id = ps.employee_id
      WHERE ps.month = ?
    `;
    const params = [month];

    // Filter by single employee if provided
    if (employeeId) {
      query += ` AND ps.employee_id = ?`;
      params.push(employeeId);
    }

    if (salaryType === 'payroll') {
      query += ` AND NOT EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    } else if (salaryType === 'contract') {
      query += ` AND EXISTS (SELECT 1 FROM employee_salary_profile sp WHERE sp.employee_id = e.id AND sp.is_active = 1 AND sp.salary_type = 'contract')`;
    }

    query += ` ORDER BY e.employee_id ASC`;

    const [slips] = await db.execute(query, params);

    if (slips.length === 0) {
      return NextResponse.json(
        { success: false, error: employeeId ? 'No payroll slip found for this employee. Please generate payroll first.' : 'No payroll slips found for this month. Please generate payroll first.' },
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
    // Use employee name for single slip, otherwise use generic name
    const filename = employeeId && slips.length === 1 
      ? `Salary_Slip_${slips[0].employee_name?.replace(/\s+/g, '_') || employeeId}_${monthLabel}.pdf`
      : `Salary_Slips_${monthLabel}.pdf`;
    
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
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
