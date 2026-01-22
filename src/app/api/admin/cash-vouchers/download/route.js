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

    // Generate line items rows - always show at least 5 rows
    const actualItems = lineItems.length > 0 ? lineItems : [];
    const totalRowsNeeded = 5;
    const emptyRowsNeeded = Math.max(0, totalRowsNeeded - actualItems.length);
    
    const lineItemsHtml = actualItems.map((item, index) => `
        <tr>
          <td style="width: 50px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px; text-align: center; font-size: 11px;">${item.sr_no || index + 1}</td>
          <td style="width: 70px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px; font-size: 11px;">${formatDate(item.bill_date)}</td>
          <td style="width: 60px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px; font-size: 11px;">${item.bill_no || ''}</td>
          <td style="width: 100px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px; font-size: 11px;">${item.account_head || ''}</td>
          <td style="width: 60px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px; text-align: center; font-size: 11px;">${item.amount_rs || ''}</td>
          <td style="border: none; padding: 6px 8px; font-size: 11px;">${item.description || ''}</td>
        </tr>
      `).join('');

    // Add empty rows to fill to 5 rows total - always show
    const emptyRowsHtml = Array(emptyRowsNeeded).fill(`
      <tr>
        <td style="width: 50px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px; height: 24px;">&nbsp;</td>
        <td style="width: 70px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px;">&nbsp;</td>
        <td style="width: 60px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px;">&nbsp;</td>
        <td style="width: 100px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px;">&nbsp;</td>
        <td style="width: 60px; border-left: none; border-right: 1px solid #333; border-top: none; border-bottom: none; padding: 6px 8px;">&nbsp;</td>
        <td style="border: none; padding: 6px 8px;">&nbsp;</td>
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
        height: auto;
        max-width: 200mm;
        max-height: none;
        overflow: visible;
        page-break-after: avoid;
        page-break-inside: avoid;
      }
      /* Keep same styling for print - column separators only */
      table {
        border: 2px solid #333 !important;
      }
      table thead tr {
        border-bottom: 2px solid #333 !important;
      }
      table thead th {
        border-bottom: 2px solid #333 !important;
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
      height: auto;
      min-height: 100mm;
      margin: 0 auto;
      background: #ffffff;
      border: 2px solid #333;
      box-sizing: border-box;
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
      flex: 0.4;
      padding: 8px 4px;
      text-align: center;
      border-right: 1px solid #333;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .title-section h1 {
      font-size: 10px;
      margin: 0;
    }
    .voucher-details {
      width: 220px;
      min-width: 220px;
      max-width: 220px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex-shrink: 0;
      border-left: 1px solid #333;
    }
    .voucher-details .row {
      display: flex;
      align-items: center;
      border-bottom: 1px solid #333;
      flex: 1;
    }
    .voucher-details .row:last-child {
      border-bottom: none;
    }
    .voucher-details .label {
      width: 70px;
      min-width: 70px;
      padding: 5px 8px;
      font-size: 10px;
      font-weight: bold;
      background: #f3f4f6;
      text-align: left;
      height: 100%;
      display: flex;
      align-items: center;
      border-right: 1px solid #333;
    }
    .voucher-details .value {
      flex: 1;
      padding: 5px 8px;
      font-size: 11px;
      text-align: left;
      height: 100%;
      display: flex;
      align-items: center;
      overflow: hidden;
      word-break: break-word;
    }
    .voucher-details .sr-no {
      font-size: 11px;
      font-weight: bold;
      color: #7B1FA2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .voucher-details .row.empty-row {
      display: none;
    }
    @media print {
      .voucher-details .row.empty-row {
        display: none !important;
      }
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 2px solid #333;
      table-layout: fixed;
    }
    th {
      background: #f3f4f6;
      border-left: none;
      border-right: 1px solid #333;
      border-top: none;
      border-bottom: 2px solid #333;
      padding: 6px 8px;
      font-size: 11px;
      text-transform: uppercase;
    }
    th:last-child {
      border-right: none;
    }
    td {
      font-size: 11px;
      padding: 5px 8px !important;
    }
    .footer-section {
      display: flex;
      border-top: 2px solid #333;
    }
    .payment-mode {
      width: 180px; /* SR.NO (50) + BILL DATE (70) + BILL NO (60) = 180px */
      padding: 8px 12px;
      border-right: 1px solid #333;
      font-size: 12px;
    }
    .total-section {
      width: 160px; /* ACCOUNT HEAD (100) + AMOUNT (60) = 160px */
      padding: 6px 10px;
      border-right: 1px solid #333;
      background: #f3f4f6;
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
      width: 25%;
      padding: 17px 10px;
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
      margin-bottom: 30px;
    }
    .signature-box .name {
      font-size: 11px;
      border-top: 1px solid #999;
      padding-top: 5px;
      margin-top: 30px;
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
          <img src="/accent-logo.png" alt="Accent Logo" style="height: 45px;" />
          <h2>Accent Techno Solutions Pvt. Ltd.</h2>
        </div>
        <p>17/130, Anand Nagar, Neharu Road, Vakola,</p>
        <p>Santacruz (E), Mumbai - 400 055.</p>
      </div>
      <div class="title-section">
        <h1>PETTY<br>CASH-CHEQUE<br>VOUCHER</h1>
      </div>
      <div class="voucher-details">
        <div class="row${voucher.voucher_number ? '' : ' empty-row'}">
          <div class="label">SR. NO.:</div>
          <div class="value sr-no">${voucher.voucher_number || ''}</div>
        </div>
        <div class="row${voucher.voucher_date ? '' : ' empty-row'}">
          <div class="label">DATE:</div>
          <div class="value">${formatDate(voucher.voucher_date) || ''}</div>
        </div>
        <div class="row${voucher.project_number ? '' : ' empty-row'}">
          <div class="label">PROJECT:</div>
          <div class="value">${voucher.project_number || ''}</div>
        </div>
        <div class="row${voucher.paid_to ? '' : ' empty-row'}">
          <div class="label">PAID TO:</div>
          <div class="value">${voucher.paid_to || ''}</div>
        </div>
      </div>
    </div>

    <!-- Line Items -->
    <table>
      <thead>
        <tr>
          <th style="width: 50px;">SR. NO.</th>
          <th style="width: 70px;">BILL DATE</th>
          <th style="width: 60px;">BILL NO.</th>
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

    <!-- Footer with Total - using table for alignment -->
    <table style="width: 100%; border-collapse: collapse; border-left: 2px solid #333; border-right: 2px solid #333; border-bottom: 2px solid #333; table-layout: fixed;">
      <tr>
        <td style="width: 180px; padding: 8px 12px; border-right: 1px solid #333; font-size: 12px; border-top: none; border-bottom: none; border-left: none;">
          <strong>Paid by:</strong> 
          <span style="margin-left: 10px; text-transform: uppercase;">${voucher.payment_mode || 'Cash'}</span>
        </td>
        <td style="width: 160px; padding: 6px 10px; border-right: 1px solid #333; background: #f3f4f6; text-align: center; border-top: none; border-bottom: none; border-left: none;">
          <span style="font-size: 11px; font-weight: bold;">TOTAL:</span>
          <span style="font-size: 12px; font-weight: bold; margin-left: 8px;">${voucher.total_amount}</span>
        </td>
        <td style="padding: 8px 12px; border: none;">
          <div style="font-size: 14px;">${voucher.amount_in_words || ''}</div>
        </td>
      </tr>
    </table>

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
