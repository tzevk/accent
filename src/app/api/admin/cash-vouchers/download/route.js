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
          <td style="border: 1px solid #333; padding: 8px; text-align: center;">${item.sr_no || index + 1}</td>
          <td style="border: 1px solid #333; padding: 8px;">${formatDate(item.bill_date)}</td>
          <td style="border: 1px solid #333; padding: 8px;">${item.bill_no || ''}</td>
          <td style="border: 1px solid #333; padding: 8px;">${item.account_head || ''}</td>
          <td style="border: 1px solid #333; padding: 8px; text-align: right;">${item.amount_rs || ''}</td>
          <td style="border: 1px solid #333; padding: 8px; text-align: right;">${item.amount_ps || '00'}</td>
          <td style="border: 1px solid #333; padding: 8px;">${item.description || ''}</td>
        </tr>
      `).join('')
      : `<tr><td colspan="7" style="border: 1px solid #333; padding: 20px; text-align: center; color: #666;">No line items</td></tr>`;

    // Add empty rows to fill the form (minimum 8 rows)
    const emptyRowsNeeded = Math.max(0, 8 - lineItems.length);
    const emptyRowsHtml = Array(emptyRowsNeeded).fill(`
      <tr>
        <td style="border: 1px solid #333; padding: 8px; height: 30px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #333; padding: 8px;">&nbsp;</td>
      </tr>
    `).join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Cash Voucher - ${voucher.voucher_number}</title>
  <style>
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background: #fff;
    }
    .voucher {
      max-width: 900px;
      margin: 0 auto;
      background: #FFFDE7;
      border: 2px solid #333;
    }
    .header {
      display: flex;
      border-bottom: 2px solid #333;
    }
    .company-info {
      flex: 1;
      padding: 15px;
      border-right: 2px solid #333;
    }
    .company-info h2 {
      margin: 0 0 5px 0;
      font-size: 16px;
    }
    .company-info p {
      margin: 0;
      font-size: 12px;
      color: #444;
    }
    .title-section {
      flex: 1;
      padding: 15px;
      text-align: center;
      border-right: 2px solid #333;
    }
    .title-section h1 {
      margin: 0;
      font-size: 18px;
      line-height: 1.4;
    }
    .voucher-details {
      width: 220px;
    }
    .voucher-details .row {
      display: flex;
      border-bottom: 1px solid #333;
    }
    .voucher-details .row:last-child {
      border-bottom: none;
    }
    .voucher-details .label {
      padding: 8px;
      font-size: 11px;
      font-weight: bold;
      background: #FFF9C4;
    }
    .voucher-details .value {
      flex: 1;
      padding: 8px;
      font-size: 13px;
    }
    .voucher-details .sr-no {
      font-size: 20px;
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
      padding: 8px;
      font-size: 11px;
      text-transform: uppercase;
    }
    .footer-section {
      display: flex;
      border-top: 2px solid #333;
    }
    .payment-mode {
      flex: 1;
      padding: 15px;
      border-right: 2px solid #333;
    }
    .total-section {
      width: 150px;
      padding: 15px;
      border-right: 2px solid #333;
      background: #FFF9C4;
    }
    .words-section {
      flex: 1;
      padding: 15px;
    }
    .signatures {
      display: flex;
      border-top: 2px solid #333;
    }
    .signature-box {
      flex: 1;
      padding: 20px 15px;
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
      font-size: 12px;
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
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  
  <div class="voucher">
    <!-- Header -->
    <div class="header">
      <div class="company-info">
        <img src="/accent-logo.png" alt="Accent Logo" style="height: 40px; margin-bottom: 8px;" />
        <h2>Accent Techno Solutions Pvt. Ltd.</h2>
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
          <div class="label">DATE:</div>
        </div>
        <div class="row">
          <div class="value" style="text-align: center;">${formatDate(voucher.voucher_date)}</div>
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
