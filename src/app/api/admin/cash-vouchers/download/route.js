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


    // Generate line items rows
    const lineItemsHtml = lineItems.length > 0 
      ? lineItems.map((item, index) => `
        <tr>
          <td style="border: 1px solid #333; padding: 6px 8px; text-align: center; font-size: 11px;">${item.sr_no || index + 1}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; font-size: 11px;">${formatDate(item.bill_date)}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; font-size: 11px;">${item.bill_no || ''}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; font-size: 11px;">${item.account_head || ''}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; text-align: center; font-size: 11px;">${item.amount_rs || ''}</td>
          <td style="border: 1px solid #333; padding: 6px 8px; font-size: 11px;">${item.description || ''}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="6" style="border: 1px solid #333; padding: 15px; text-align: center; color: #666; font-size: 11px;">No line items</td></tr>`;

    // Add empty rows to fill the form (minimum 5 rows for A4 half page)
    const emptyRowsNeeded = Math.max(0, 5 - lineItems.length);
    const emptyRowsHtml = Array(emptyRowsNeeded).fill(`
      <tr>
        <td style="border: 1px solid #333; padding: 6px 8px; height: 24px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 6px 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 6px 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 6px 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 6px 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 6px 8px;">&nbsp;</td>
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
      size: A4 portrait;
      margin: 0 5mm;
    }
    @media print {
      body { 
        -webkit-print-color-adjust: exact; 
        print-color-adjust: exact;
        margin: 0;
        padding: 0 5mm;
      }
      .no-print { display: none !important; }
      .voucher {
        width: 200mm;
        height: 120mm;
        max-width: 200mm;
        max-height: 120mm;
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
      width: 190mm;
      height: 130mm;
      max-height: 130mm;
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
      padding: 10px 12px;
      border-right: 1px solid #333;
    }
    .company-info .logo-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .company-info h2 {
      margin: 0;
      font-size: 14px;
    }
    .company-info p {
      margin: 0;
      font-size: 11px;
      color: #444;
      line-height: 1.4;
    }
    .title-section {
      flex: 0.8;
      padding: 8px 12px;
      text-align: center;
      border-right: 1px solid #333;
    }
    .title-section h1 {
      font-size: 11px;
    }
    .voucher-details {
      width: 180px;
    }
    .voucher-details .row {
      display: flex;
      border-bottom: 1px solid #333;
      white-space: nowrap;
    }
    .voucher-details .row:last-child {
      border-bottom: none;
    }
    .voucher-details .label {
      width: 60px;
      padding: 5px 8px;
      font-size: 10px;
      font-weight: bold;
      background: #FFF9C4;
    }
    .voucher-details .value {
      flex: 1;
      padding: 5px 8px;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .voucher-details .sr-no {
      font-size: 11px;
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
      padding: 6px 8px;
      font-size: 11px;
      text-transform: uppercase;
    }
    td {
      font-size: 11px;
      padding: 5px 8px !important;
    }
    .footer-section {
      display: flex;
      border-top: 1px solid #333;
    }
    .payment-mode {
      width: 147px;
      padding: 8px 12px;
      border-right: 1px solid #333;
      font-size: 12px;
    }
    .total-section {
      width: 94px;
      padding: 6px 10px;
      border-right: 1px solid #333;
      background: #FFF9C4;
    }
    .words-section {
      flex: 1;
      padding: 8px 12px;
    }
    .signatures {
      display: flex;
      border-top: 1px solid #333;
    }
    .signature-box {
      flex: 1;
      padding: 12px 10px;
      text-align: center;
      border-right: 1px solid #333;
    }
    .signature-box:last-child {
      border-right: none;
    }
    .signature-box .label {
      font-size: 10px;
      font-weight: bold;
      color: #444;
      margin-bottom: 20px;
    }
    .signature-box .name {
      font-size: 11px;
      border-top: 1px solid #999;
      padding-top: 5px;
      margin-top: 20px;
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
    .cut-line {
      width: 190mm;
      margin: 10px auto;
      border-bottom: 2px dashed #666;
      position: relative;
    }
    .cut-line::before {
      content: '✂';
      position: absolute;
      left: -20px;
      top: -10px;
      font-size: 16px;
      color: #666;
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
          <img src="/accent-logo.png" alt="Accent Logo" style="height: 32px;" />
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
          <div class="label" style="width: 50px;">SR. NO.:</div>
          <div class="value sr-no">${voucher.voucher_number || ''}</div>
        </div>
        <div class="row">
          <div class="label" style="width: 50px;">DATE:</div>
          <div class="value">${formatDate(voucher.voucher_date) || ''}</div>
        </div>
        <div class="row">
          <div class="label" style="width: 50px;">PROJECT:</div>
          <div class="value">${voucher.project_number || ''}</div>
        </div>
        <div class="row">
          <div class="label" style="width: 50px;">PAID TO:</div>
          <div class="value">${voucher.paid_to || ''}</div>
        </div>
      </div>
    </div>

    <!-- Line Items -->
    <table>
      <thead>
        <tr>
          <th style="width: 10px;">SR. NO.</th>
          <th style="width: 70px;">BILL DATE</th>
          <th style="width: 30px;">BILL NO.</th>
          <th style="width: 100px;">ACCOUNT HEAD</th>
          <th style="width: 60px;">AMOUNT</th>
          <th style="width: auto;">DESCRIPTION</th>
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
        <strong>Paid by:</strong> 
        <span style="margin-left: 10px; text-transform: uppercase;">${voucher.payment_mode || 'Cash'}</span>
      </div>
      <div class="total-section" style="display: flex; align-items: center; justify-content: center; gap: 8px;">
        <span style="font-size: 11px; font-weight: bold;">TOTAL:</span>
        <span style="font-size: 12px; font-weight: bold;">${voucher.total_amount}</span>
      </div>
      <div class="words-section">
        <div style="font-size: 14px;">${voucher.amount_in_words || ''}</div>
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

  <!-- Cut line -->
  <div class="cut-line"></div>

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
