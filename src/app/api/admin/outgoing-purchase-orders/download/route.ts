/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

// Helper to format date
const formatDate = (dateString: any) => {
	if (!dateString) return '';
	const date = new Date(dateString);
	return date.toLocaleDateString('en-IN', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	});
};

// Helper to format currency
const formatCurrency = (amount: number) => {
	return new Intl.NumberFormat('en-IN', {
		style: 'currency',
		currency: 'INR',
		minimumFractionDigits: 2,
	}).format(amount || 0);
};

export async function GET(request: Request) {
	// RBAC check
	const authResult: any = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult.authorized === false) return authResult.response;

	let connection: any;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return new Response('Outgoing Purchase Order ID is required', {
				status: 400,
			});
		}

		connection = await dbConnect();
		const [rows]: any = await connection.execute(
			'SELECT * FROM outgoing_purchase_orders WHERE id = ?',
			[id]
		);

		if (!rows || rows.length === 0) {
			return new Response('Outgoing Purchase Order not found', {
				status: 404,
			});
		}

		const po = rows[0];

		const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Outgoing Purchase Order - ${po.po_number || 'Draft'}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm;
    }
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        margin: 0;
        padding: 0;
      }
      .no-print { display: none !important; }
    }
    body {
      font-family: Arial, sans-serif;
      margin: 0;
      padding: 20px;
      background: #fff;
      color: #333;
    }
    .container {
      width: 100%;
      max-width: 800px;
      margin: 0 auto;
      border: 2px solid #333;
      padding: 0;
      box-sizing: border-box;
    }
    .header {
      display: flex;
      border-bottom: 2px solid #333;
      align-items: center;
      padding: 15px;
    }
    .company-logo {
      height: 50px;
      margin-right: 15px;
    }
    .company-info {
      flex: 1;
    }
    .company-info h2 {
      margin: 0;
      font-size: 16px;
      color: #000;
    }
    .company-info p {
      margin: 2px 0 0 0;
      font-size: 11px;
      color: #555;
    }
    .title-section {
      text-align: right;
    }
    .title-section h1 {
      font-size: 18px;
      margin: 0;
      color: #7F2487;
      letter-spacing: 1px;
    }
    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-bottom: 2px solid #333;
    }
    .details-col {
      padding: 15px;
    }
    .details-col:first-child {
      border-right: 2px solid #333;
    }
    .details-row {
      display: flex;
      margin-bottom: 8px;
      font-size: 12px;
    }
    .details-label {
      width: 120px;
      font-weight: bold;
      color: #111;
    }
    .details-value {
      flex: 1;
      color: #333;
    }
    .amount-section {
      background-color: #f9f9f9;
      padding: 20px;
      text-align: center;
      border-bottom: 2px solid #333;
    }
    .amount-title {
      font-size: 12px;
      text-transform: uppercase;
      color: #666;
      margin-bottom: 5px;
      font-weight: bold;
    }
    .amount-value {
      font-size: 24px;
      font-weight: bold;
      color: #7F2487;
    }
    .remarks-section {
      padding: 15px;
      min-height: 100px;
      font-size: 12px;
    }
    .remarks-title {
      font-weight: bold;
      margin-bottom: 5px;
      color: #111;
    }
    .remarks-content {
      color: #555;
      line-height: 1.5;
    }
    .signatures {
      display: flex;
      border-top: 2px solid #333;
    }
    .signature-box {
      flex: 1;
      padding: 20px;
      text-align: center;
    }
    .signature-box:first-child {
      border-right: 2px solid #333;
    }
    .signature-label {
      font-size: 11px;
      font-weight: bold;
      color: #555;
      margin-bottom: 45px;
    }
    .signature-line {
      border-top: 1px solid #777;
      width: 70%;
      margin: 45px auto 0 auto;
      padding-top: 5px;
      font-size: 12px;
      font-weight: bold;
    }
    .print-btn {
      display: block;
      margin: 20px auto;
      padding: 12px 30px;
      background: #7F2487;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      font-weight: bold;
      box-shadow: 0 4px 10px rgba(0,0,0,0.15);
    }
    .print-btn:hover {
      background: #64126D;
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>

  <div class="container">
    <!-- Header -->
    <div class="header">
      <img src="/accent-logo.png" alt="Accent Logo" class="company-logo" onerror="this.style.display='none'" />
      <div class="company-info">
        <h2>Accent Techno Solutions Pvt. Ltd.</h2>
        <p>17/130, Anand Nagar, Neharu Road, Vakola, Santacruz (E), Mumbai - 400 055.</p>
      </div>
      <div class="title-section">
        <h1>OUTGOING PO</h1>
      </div>
    </div>

    <!-- PO Details -->
    <div class="details-grid">
      <div class="details-col">
        <div class="details-row">
          <span class="details-label">PO Number:</span>
          <span class="details-value" style="font-weight: bold; color: #7F2487;">${po.po_number}</span>
        </div>
        <div class="details-row">
          <span class="details-label">PO Date:</span>
          <span class="details-value">${formatDate(po.po_date)}</span>
        </div>
        <div class="details-row">
          <span class="details-label">Project Number:</span>
          <span class="details-value">${po.project_number || '-'}</span>
        </div>
      </div>
      <div class="details-col">
        <div class="details-row">
          <span class="details-label">Company Name:</span>
          <span class="details-value" style="font-weight: bold;">${po.company_name}</span>
        </div>
        <div class="details-row">
          <span class="details-label">City:</span>
          <span class="details-value">${po.city || '-'}</span>
        </div>
      </div>
    </div>

    <!-- Amount -->
    <div class="amount-section">
      <div class="amount-title">Total PO Value</div>
      <div class="amount-value">${formatCurrency(parseFloat(po.po_amount))}</div>
    </div>

    <!-- Remarks -->
    <div class="remarks-section">
      <div class="remarks-title">Remarks / Instructions:</div>
      <div class="remarks-content">${po.remarks || 'No additional remarks.'}</div>
    </div>

    <!-- Signatures -->
    <div class="signatures">
      <div class="signature-box">
        <div class="signature-label">PREPARED BY</div>
        <div class="signature-line">Authorized Signatory</div>
      </div>
      <div class="signature-box">
        <div class="signature-label">APPROVED BY</div>
        <div class="signature-line">Director / Manager</div>
      </div>
    </div>
  </div>

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
	} catch (error: any) {
		console.error('Error generating printable PO:', error);
		return new Response(
			'Failed to generate outgoing purchase order print page',
			{
				status: 500,
			}
		);
	} finally {
		if (connection) {
			try {
				await connection.release();
			} catch {
				try {
					await connection.end();
				} catch {}
			}
		}
	}
}
