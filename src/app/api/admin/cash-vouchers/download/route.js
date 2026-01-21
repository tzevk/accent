import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/cash-vouchers/download?id=X
 * Generate a printable HTML page for a cash voucher (can be saved as PDF)
 */
export async function GET(request) {
  let db;
  
  try {
    let user;
    try {
      user = await getCurrentUser(request);
    } catch (authErr) {
      return new Response('Authentication failed', { status: 500 });
    }
    
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return new Response('Voucher ID is required', { status: 400 });
    }

    db = await dbConnect();
    
    const [vouchers] = await db.execute(
      'SELECT * FROM cash_vouchers WHERE id = ?',
      [id]
    );

    if (vouchers.length === 0) {
      return new Response('Voucher not found', { status: 404 });
    }

    const voucher = vouchers[0];
    const lineItems = typeof voucher.line_items === 'string' 
      ? JSON.parse(voucher.line_items || '[]') 
      : (voucher.line_items || []);

    // Format date
    const formatDate = (dateString) => {
      if (!dateString) return '';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    // Format currency
    const formatCurrency = (amount) => {
      return new Intl.NumberFormat('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount || 0);
    };

    // Generate line items rows
    const lineItemsHtml = lineItems.length > 0 
      ? lineItems.map((item, index) => `
        <tr>
          <td style="border: 1px solid #333; padding: 3px 4px; text-align: center; font-size: 8px;">${item.sr_no || index + 1}</td>
          <td style="border: 1px solid #333; padding: 3px 4px; font-size: 8px;">${formatDate(item.bill_date)}</td>
          <td style="border: 1px solid #333; padding: 3px 4px; font-size: 8px;">${item.bill_no || ''}</td>
          <td style="border: 1px solid #333; padding: 3px 4px; font-size: 8px;">${item.account_head || ''}</td>
          <td style="border: 1px solid #333; padding: 3px 4px; text-align: right; font-size: 8px;">${item.amount_rs || ''}</td>
          <td style="border: 1px solid #333; padding: 3px 4px; text-align: right; font-size: 8px;">${item.amount_ps || '00'}</td>
          <td style="border: 1px solid #333; padding: 3px 4px; font-size: 8px;">${item.description || ''}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="7" style="border: 1px solid #333; padding: 10px; text-align: center; color: #666; font-size: 8px;">No line items</td></tr>`;

    // Add empty rows to fill the form (minimum 4 rows for compact size)
    const emptyRowsNeeded = Math.max(0, 4 - lineItems.length);
    const emptyRowsHtml = Array(emptyRowsNeeded).fill(`
      <tr>
        <td style="border: 1px solid #333; padding: 3px 4px; height: 18px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 3px 4px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 3px 4px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 3px 4px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 3px 4px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 3px 4px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 3px 4px;">&nbsp;</td>
      </tr>
    `).join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cash Voucher - ${voucher.voucher_number}</title>
  <style>
    @page {
      size: A5 portrait;
      margin: 0 10mm;
    }
    @media print {
      body { 
        -webkit-print-color-adjust: exact; 
        print-color-adjust: exact;
        margin: 0;
        padding: 0 10mm;
      }
      .no-print { display: none !important; }
      .voucher {
        width: 148mm;
        height: 90mm;
        max-width: 148mm;
        max-height: 80mm;
        overflow: hidden;
        page-break-after: avoid;
        page-break-inside: avoid;
      }
    }
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background: #fff;
    }
    .voucher {
      width: 148mm;
      height: 105mm;
      margin: 0 auto;
      background: #FFFDE7;
      border: 2px solid #333;
      box-sizing: border-box;
      overflow: hidden;
    }
    .header {
      display: flex;
      border-bottom: 1px solid #333;
    }
    .company-info {
      flex: 1;
      padding: 6px 8px;
      border-right: 1px solid #333;
    }
    .company-info .logo-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 2px;
    }
    .company-info h2 {
      margin: 0;
      font-size: 9px;
    }
    .company-info p {
      margin: 0;
      font-size: 7px;
      color: #444;
      line-height: 1.2;
    }
    .title-section {
      flex: 0.8;
      padding: 2px 8px;
      text-align: center;
      border-right: 1px solid #333;
    }
    .title-section h1 {
      font-size: 10px;
    }
    .voucher-details {
      width: 160px;
    }
    .voucher-details .row {
      display: flex;
      border-bottom: 1px solid #333;
    }
    .voucher-details .row:last-child {
      border-bottom: none;
    }
    .voucher-details .label {
      padding: 3px 5px;
      font-size: 8px;
      font-weight: bold;
      background: #FFF9C4;
    }
    .voucher-details .value {
      flex: 1;
      padding: 3px 5px;
      font-size: 9px;
    }
    .voucher-details .sr-no {
      font-size: 9px;
      font-weight: bold;
      color: #7B1FA2;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      background: #FFF9C4;
      border: 1px solid #333;
      padding: 3px 4px;
      font-size: 8px;
      text-transform: uppercase;
    }
    td {
      font-size: 8px;
      padding: 2px 4px !important;
    }
    .footer-section {
      display: flex;
      border-top: 1px solid #333;
    }
    .payment-mode {
      flex: 1;
      padding: 5px 8px;
      border-right: 1px solid #333;
      font-size: 9px;
    }
    .total-section {
      width: 100px;
      padding: 5px 8px;
      border-right: 1px solid #333;
      background: #FFF9C4;
    }
    .words-section {
      flex: 1;
      padding: 5px 8px;
    }
    .signatures {
      display: flex;
      border-top: 1px solid #333;
    }
    .signature-box {
      flex: 1;
      padding: 8px 6px;
      text-align: center;
      border-right: 1px solid #333;
    }
    .signature-box:last-child {
      border-right: none;
    }
    .signature-box .label {
      font-size: 7px;
      font-weight: bold;
      color: #444;
      margin-bottom: 15px;
    }
    .signature-box .name {
      font-size: 8px;
      border-top: 1px solid #999;
      padding-top: 3px;
      margin-top: 15px;
    }
    .print-btn {
      display: block;
      margin: 20px auto;
      padding: 12px 30px;
      background: #7B1FA2;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
    }
    .print-btn:hover {
      background: #6A1B9A;
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  
  <div class="voucher">
    <!-- Header -->
    <div class="header">
      <div class="company-info">
        <div class="logo-row">
          <img src="/accent-logo.png" alt="Accent Logo" style="height: 24px;" />
          <h2>Accent Techno Solutions Pvt. Ltd.</h2>
        </div>
        <p>17/130, Anand Nagar, Neharu Road, Vakola,</p>
        <p>Santacruz (E), Mumbai - 400 055.</p>
      </div>
      <div class="title-section">
        <h1>PETTY<br>CASH-CHEQUE<br>VOUCHER</h1>
      </div>
      <div class="voucher-details">
        <div class="row">
          <div class="label" style="width: 60px;">SR. NO.:</div>
          <div class="value sr-no">${voucher.voucher_number || ''}</div>
        </div>
        <div class="row">
          <div class="label" style="width: 60px;">DATE:</div>
          <div class="value">${formatDate(voucher.voucher_date) || ''}</div>
        </div>
        <div class="row">
          <div class="label" style="width: 60px;">PROJECT:</div>
          <div class="value">${voucher.project_number || ''}</div>
        </div>
        <div class="row">
          <div class="label" style="width: 60px;">PAID TO:</div>
          <div class="value">${voucher.paid_to || ''}</div>
        </div>
      </div>
    </div>

    <!-- Line Items -->
    <table>
      <thead>
        <tr>
          <th style="width: 50px;">SR. NO.</th>
          <th style="width: 90px;">BILL DATE</th>
          <th style="width: 80px;">BILL NO.</th>
          <th style="width: 150px;">ACCOUNT HEAD</th>
          <th colspan="2" style="width: 100px;">
            AMOUNT
            <div style="display: flex; border-top: 1px solid #333; margin-top: 5px;">
              <div style="flex: 1; border-right: 1px solid #333; padding: 3px;">RS.</div>
              <div style="flex: 1; padding: 3px;">PS.</div>
            </div>
          </th>
          <th>DESCRIPTION</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsHtml}
        ${emptyRowsHtml}
      </tbody>
    </table>

    <!-- Footer with Total -->
    <div class="footer-section">
      <div class="payment-mode">
        <strong>Paid by Cash/Cheque:</strong> 
        <span style="margin-left: 10px; text-transform: uppercase;">${voucher.payment_mode || 'Cash'}</span>
      </div>
      <div class="total-section">
        <div style="font-size: 11px; font-weight: bold;">TOTAL</div>
        <div style="font-size: 16px; font-weight: bold;">₹ ${formatCurrency(voucher.total_amount)}</div>
      </div>
      <div class="words-section">
        <div style="font-size: 11px; font-weight: bold; margin-bottom: 5px;">Rs. (In Words)</div>
        <div style="font-size: 12px;">${voucher.amount_in_words || ''}</div>
      </div>
    </div>

    <!-- Signatures -->
    <div class="signatures">
      <div class="signature-box">
        <div class="label">PREPARED BY</div>
        <div class="name">${voucher.prepared_by || ''}</div>
      </div>
      <div class="signature-box">
        <div class="label">CHECKED BY</div>
        <div class="name">${voucher.checked_by || ''}</div>
      </div>
      <div class="signature-box">
        <div class="label">APPROVED BY</div>
        <div class="name">${voucher.approved_by_name || ''}</div>
      </div>
      <div class="signature-box">
        <div class="label">RECEIVER'S SIGNATURE</div>
        <div class="name">${voucher.receiver_signature || ''}</div>
      </div>
    </div>
  </div>

  <script>
    // Auto-print when loaded with ?print=true
    if (window.location.search.includes('print=true')) {
      window.onload = function() { window.print(); };
    }
  </script>
</body>
</html>
    `;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
    
  } catch (error) {
    console.error('Download cash voucher error:', error?.message);
    return new Response('Failed to generate voucher', { status: 500 });
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}
