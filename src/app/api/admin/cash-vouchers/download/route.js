import { dbConnect } from '@/utils/database';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/cash-vouchers/download?id=X
 * Refactored ledger engine forcing total numerical nodes to line up below the amount column.
 */
export async function GET(request) {
	let db;

	try {
		let user;
		try {
			user = await getCurrentUser(request);
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
		const lineItems =
			typeof voucher.line_items === 'string'
				? JSON.parse(voucher.line_items || '[]')
				: voucher.line_items || [];

		const formatDate = (dateString) => {
			if (!dateString) return '';
			const date = new Date(dateString);
			return date.toLocaleDateString('en-IN', {
				day: '2-digit',
				month: 'short',
				year: 'numeric',
			});
		};

		const escapeHtml = (str) => {
			if (!str) return '';
			return String(str)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#039;');
		};

		const formatDecimalAmount = (val) => {
			if (val === undefined || val === null || val === '') return '';
			const parsed = parseFloat(val);
			return isNaN(parsed) ? String(val) : parsed.toFixed(2);
		};

		const actualItems = lineItems.length > 0 ? lineItems : [];
		const totalRowsNeeded = 5;
		const emptyRowsNeeded = Math.max(0, totalRowsNeeded - actualItems.length);

		const lineItemsHtml = actualItems
			.map(
				(item, index) => `
        <tr>
          <td style="width: 50px; text-align: center;">${escapeHtml(item.sr_no || index + 1)}</td>
          <td style="width: 80px; text-align: center;">${escapeHtml(formatDate(item.bill_date))}</td>
          <td style="width: 80px;">${escapeHtml(item.bill_no || '')}</td>
          <td style="width: 130px;">${escapeHtml(item.account_head || '')}</td>
          <td style="width: 90px; text-align: right; font-weight: bold;">${escapeHtml(formatDecimalAmount(item.amount_rs))}</td>
          <td>${escapeHtml(item.description || '')}</td>
        </tr>
      `
			)
			.join('');

		const emptyRowsHtml = Array(emptyRowsNeeded)
			.fill(
				`
      <tr>
        <td style="width: 50px;">&nbsp;</td>
        <td style="width: 80px;">&nbsp;</td>
        <td style="width: 80px;">&nbsp;</td>
        <td style="width: 130px;">&nbsp;</td>
        <td style="width: 90px;">&nbsp;</td>
        <td>&nbsp;</td>
      </tr>
    `
			)
			.join('');

		const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cash Voucher - ${escapeHtml(voucher.voucher_number)}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 5mm 10mm;
    }
    
    @media print {
      body {
        background-color: #ffffff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        padding: 0;
      }
      .no-print { 
        display: none !important; 
      }
      .voucher {
        border: 2px solid #000000 !important;
      }
      th, .total-title-cell, .title-banner-pane {
        background-color: #f2f2f2 !important;
      }
      .meta-row.hidden-field {
        display: none !important;
      }
    }

    body {
      font-family: Arial, sans-serif;
      background-color: #fafafa;
      margin: 0;
      padding: 15px;
      color: #000000;
      line-height: 1.2;
    }

    .print-btn {
      display: block;
      margin: 0 auto 15px auto;
      padding: 8px 20px;
      background-color: #7B1FA2;
      color: #ffffff;
      border: none;
      border-radius: 4px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
    }

    .voucher {
      width: 100%;
      max-width: 185mm;
      margin: 0 auto;
      background-color: #ffffff;
      border: 2px solid #000000;
      box-sizing: border-box;
    }

    .title-banner-pane {
      width: 100%;
      background-color: #f2f2f2;
      padding: 6px 12px;
      border-bottom: 2px solid #000000;
      text-align: center;
      box-sizing: border-box;
    }

    .horizontal-title {
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 1px;
      margin: 0;
      text-transform: uppercase;
    }

    .header-split-grid {
      display: grid;
      grid-template-columns: 105mm 1fr;
      border-bottom: 2px solid #000000;
      box-sizing: border-box;
      width: 100%;
    }

    .company-pane-flex {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 14px;
      padding: 8px 10px;
      border-right: 1px solid #000000;
      box-sizing: border-box;
    }

    .logo-left-node {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .logo-left-node img {
      height: 42px;
      width: auto;
      object-fit: contain;
    }

    .text-right-node {
      display: flex;
      flex-direction: column;
      justify-content: center;
      flex: 1;
      gap: 2px;
    }

    .company-title {
      margin: 0;
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 0.1px;
    }

    .company-address {
      margin: 0;
      font-size: 9px;
      color: #222222;
      line-height: 1.3;
    }

    .meta-table {
      width: 100%;
      height: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .meta-table tr {
      border-bottom: 1px solid #000000;
    }

    .meta-table tr:last-child {
      border-bottom: none;
    }

    .meta-table tr.hidden-field {
      display: none;
    }

    .meta-label-cell {
      width: 75px;
      background-color: #f2f2f2;
      padding: 4px 6px;
      font-size: 9px;
      font-weight: bold;
      border-right: 1px solid #000000;
      text-transform: uppercase;
      vertical-align: middle;
    }

    .meta-value-cell {
      padding: 4px 6px;
      font-size: 10px;
      vertical-align: middle;
      font-weight: normal;
    }

    /* Consolidated Ledger and Summary Architecture */
    .ledger-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: none;
    }

    .ledger-table th {
      background-color: #f2f2f2;
      border-bottom: 2px solid #000000;
      border-right: 1px solid #000000;
      padding: 6px 8px;
      font-size: 9px;
      font-weight: bold;
      text-align: center;
    }

    .ledger-table th:last-child {
      border-right: none;
    }

    .ledger-table td {
      padding: 4px 8px;
      font-size: 10px;
      border-right: 1px solid #000000;
      border-bottom: 1px solid #e0e0e0;
      height: 22px;
      vertical-align: middle;
      box-sizing: border-box;
    }

    .ledger-table td:last-child {
      border-right: none;
    }

    /* Integrated Summary Block Formatting */
    .total-row {
      border-top: 2px solid #000000;
      border-bottom: 2px solid #000000 !important;
    }

    .total-row td {
      border-bottom: none;
      padding: 6px 8px;
    }

    .payment-method-text {
      font-size: 10px;
    }

    .total-title-cell {
      background-color: #f2f2f2;
      text-align: center;
      font-weight: bold;
      font-size: 9px;
    }

    .total-value-cell {
      text-align: right;
      font-weight: bold;
      font-size: 10px;
    }

    .words-expression-text {
      font-style: italic;
      font-size: 10px;
    }

    .signature-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      background-color: #ffffff;
    }

    .signature-cell {
      border-right: 1px solid #000000;
      padding: 6px 8px;
      vertical-align: bottom;
      height: 75px; 
      box-sizing: border-box;
    }

    .signature-cell:last-child {
      border-right: none;
    }

    .signature-container {
      display: flex;
      flex-direction: column;
      width: 100%;
    }

    .signature-actor {
      font-size: 10px;
      font-weight: bold;
      text-align: center;
      width: 100%;
      margin-bottom: 2px;
      min-height: 14px;
    }

    .signature-line {
      border-top: 1px dashed #444444;
      width: 90%;
      margin: 0 auto 4px auto;
    }

    .signature-caption {
      font-size: 8px;
      font-weight: bold;
      color: #333333;
      text-align: center;
      text-transform: uppercase;
    }

    .cut-line {
      max-width: 185mm;
      margin: 15px auto;
      border-bottom: 1px dashed #000000;
      position: relative;
    }
    
    .cut-line::before {
      content: '✂';
      position: absolute;
      left: 5px;
      top: -9px;
      font-size: 12px;
    }
  </style>
</head>
<body>

  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
  
  <div class="voucher">
    
    <div class="title-banner-pane">
      <h1 class="horizontal-title">Petty Cash - Cheque Voucher</h1>
    </div>

    <div class="header-split-grid">
      
      <div class="company-pane-flex">
        <div class="logo-left-node">
          <img src="/accent-logo.png" alt="Company Logo" />
        </div>
        <div class="text-right-node">
          <h2 class="company-title">Accent Techno Solutions Pvt. Ltd.</h2>
          <p class="company-address">17/130, Anand Nagar, Neharu Road, Vakola,</p>
          <p class="company-address">Santacruz (E), Mumbai - 400 055.</p>
        </div>
      </div>
      
      <table class="meta-table">
        <tr class="${voucher.voucher_number ? '' : 'hidden-field'}">
          <td class="meta-label-cell">SR. NO.:</td>
          <td class="meta-value-cell" style="font-weight: bold;">${escapeHtml(voucher.voucher_number)}</td>
        </tr>
        <tr class="${voucher.voucher_date ? '' : 'hidden-field'}">
          <td class="meta-label-cell">DATE:</td>
          <td class="meta-value-cell">${escapeHtml(formatDate(voucher.voucher_date))}</td>
        </tr>
        <tr class="${voucher.project_number ? '' : 'hidden-field'}">
          <td class="meta-label-cell">PROJECT:</td>
          <td class="meta-value-cell">${escapeHtml(voucher.project_number)}</td>
        </tr>
        <tr class="${voucher.paid_to ? '' : 'hidden-field'}">
          <td class="meta-label-cell">PAID TO:</td>
          <td class="meta-value-cell">${escapeHtml(voucher.paid_to)}</td>
        </tr>
      </table>
      
    </div>

    <table class="ledger-table">
      <thead>
        <tr>
          <th style="width: 50px;">SR. NO.</th>
          <th style="width: 80px;">BILL DATE</th>
          <th style="width: 80px;">BILL NO.</th>
          <th style="width: 130px;">ACCOUNT HEAD</th>
          <th style="width: 90px;">AMOUNT</th>
          <th>DESCRIPTION</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsHtml}
        ${emptyRowsHtml}
        
        <tr class="total-row">
          <td colspan="3" class="payment-method-text">
            <strong>Paid by:</strong> 
            <span style="margin-left: 6px; text-transform: uppercase;">${escapeHtml(voucher.payment_mode || 'Cash')}</span>
          </td>
          <td class="total-title-cell">TOTAL:</td>
          <td class="total-value-cell">${escapeHtml(formatDecimalAmount(voucher.total_amount))}</td>
          <td class="words-expression-text">
            <div>${voucher.amount_in_words ? 'Rs. ' + escapeHtml(voucher.amount_in_words) : ''}</div>
          </td>
        </tr>
      </tbody>
    </table>

    <table class="signature-table">
      <tr>
        <td class="signature-cell">
          <div class="signature-container">
            <div class="signature-actor">${escapeHtml(voucher.prepared_by)}</div>
            <div class="signature-line"></div>
            <div class="signature-caption">PREPARED BY</div>
          </div>
        </td>
        <td class="signature-cell">
          <div class="signature-container">
            <div class="signature-actor">${escapeHtml(voucher.checked_by)}</div>
            <div class="signature-line"></div>
            <div class="signature-caption">CHECKED BY</div>
          </div>
        </td>
        <td class="signature-cell">
          <div class="signature-container">
            <div class="signature-actor">${escapeHtml(voucher.approved_by_name)}</div>
            <div class="signature-line"></div>
            <div class="signature-caption">APPROVED BY</div>
          </div>
        </td>
        <td class="signature-cell">
          <div class="signature-container">
            <div class="signature-actor">${escapeHtml(voucher.receiver_signature)}</div>
            <div class="signature-line"></div>
            <div class="signature-caption">RECEIVER'S SIGNATURE</div>
          </div>
        </td>
      </tr>
    </table>
  </div>

  <div class="cut-line"></div>

  <script>
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
			try {
				db.release();
			} catch (e) {
				/* ignore */
			}
		}
	}
}
