import { NextResponse } from 'next/server';
import puppeteer from 'puppeteer';
import chromium from '@sparticuz/chromium';
import { dbConnect } from '@/utils/database';
import {
	ensurePermission,
	RESOURCES,
	PERMISSIONS,
} from '@/utils/api-permissions';

export const runtime = 'nodejs';

function generateInvoiceHTML(data) {
	const formatDate = (dateStr) => {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		return d
			.toLocaleDateString('en-IN', {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
			})
			.replace(/\//g, '.');
	};

	const formatCurrency = (amount) =>
		new Intl.NumberFormat('en-IN', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
		}).format(amount || 0);

	const numberToWords = (num) => {
		const ones = [
			'',
			'One',
			'Two',
			'Three',
			'Four',
			'Five',
			'Six',
			'Seven',
			'Eight',
			'Nine',
			'Ten',
			'Eleven',
			'Twelve',
			'Thirteen',
			'Fourteen',
			'Fifteen',
			'Sixteen',
			'Seventeen',
			'Eighteen',
			'Nineteen',
		];
		const tens = [
			'',
			'',
			'Twenty',
			'Thirty',
			'Forty',
			'Fifty',
			'Sixty',
			'Seventy',
			'Eighty',
			'Ninety',
		];
		if (num === 0) return 'Zero';
		if (num < 20) return ones[num];
		if (num < 100)
			return (
				tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '')
			);
		if (num < 1000)
			return (
				ones[Math.floor(num / 100)] +
				' Hundred' +
				(num % 100 ? ' ' + numberToWords(num % 100) : '')
			);
		if (num < 100000)
			return (
				numberToWords(Math.floor(num / 1000)) +
				' Thousand' +
				(num % 1000 ? ' ' + numberToWords(num % 1000) : '')
			);
		if (num < 10000000)
			return (
				numberToWords(Math.floor(num / 100000)) +
				' Lakh' +
				(num % 100000 ? ' ' + numberToWords(num % 100000) : '')
			);
		return (
			numberToWords(Math.floor(num / 10000000)) +
			' Crore' +
			(num % 10000000 ? ' ' + numberToWords(num % 10000000) : '')
		);
	};

	const grossAmount = parseFloat(data.gross_amount) || 0;
	const cgstRate = parseFloat(data.cgst_rate) || 9;
	const sgstRate = parseFloat(data.sgst_rate) || 9;
	const igstRate = parseFloat(data.igst_rate) || 18;
	const gstType = data.gst_type || 'cgst_sgst';

	const cgstAmount =
		gstType === 'cgst_sgst' ? (grossAmount * cgstRate) / 100 : 0;
	const sgstAmount =
		gstType === 'cgst_sgst' ? (grossAmount * sgstRate) / 100 : 0;
	const igstAmount = gstType === 'igst' ? (grossAmount * igstRate) / 100 : 0;
	const totalGst = cgstAmount + sgstAmount + igstAmount;
	const netAmount = parseFloat(data.net_amount) || grossAmount + totalGst;

	const rupees = Math.floor(netAmount);
	const paise = Math.round((netAmount - rupees) * 100);
	const amountInWords =
		data.amount_in_words ||
		'Rupees ' +
			numberToWords(rupees) +
			(paise > 0 ? ' And ' + numberToWords(paise) + ' Paise' : '') +
			' Only .';

	let lineItems = [];
	if (data.line_items) {
		try {
			lineItems =
				typeof data.line_items === 'string'
					? JSON.parse(data.line_items)
					: data.line_items;
		} catch (_) {}
	}
	if (!lineItems.length && data.items) {
		try {
			const items =
				typeof data.items === 'string' ? JSON.parse(data.items) : data.items;
			lineItems = (items || []).map((item, i) => ({
				sr_no: item.sr_no || i + 1,
				description: item.description || '',
				unit: item.unit || '-',
				charges: item.charges || '-',
				amount:
					item.amount != null
						? item.amount
						: (item.quantity || 1) * (item.rate || 0),
			}));
		} catch (_) {}
	}
	if (!lineItems.length) {
		lineItems = [
			{
				sr_no: 1,
				description: data.description || data.scope_of_work || '',
				unit: data.unit || '-',
				charges: data.charges || '-',
				amount: grossAmount,
			},
		];
	}

	const lineItemsHTML = lineItems
		.map(
			(item) => `
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 4px;text-align:center;vertical-align:top;">${item.sr_no || ''}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;white-space:pre-wrap;">${item.description || ''}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 4px;text-align:center;vertical-align:top;">${item.unit || '-'}</td>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 4px;text-align:center;vertical-align:top;">${item.charges || '-'}</td>
      <td style="border-bottom:1px solid #000;padding:6px 8px;text-align:right;vertical-align:top;">${item.amount ? formatCurrency(item.amount) : ''}</td>
    </tr>
  `
		)
		.join('');

	return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tax Invoice - ${data.invoice_number || 'Draft'}</title>
  <style>
    @page { size: A4; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      font-size: 10px;
      color: #000;
      background: white;
      padding: 0;
    }
    .outer { width: 100%; border-collapse: collapse; }
    td, th { font-family: Arial, sans-serif; font-size: 10px; }
  </style>
</head>
<body>
  <table class="outer" style="border-collapse:collapse;border:1px solid #000;">

    <!-- TAX INVOICE title row -->
    <tr>
      <td colspan="2" style="border-bottom:1px solid #000;padding:6px;text-align:center;font-weight:bold;font-size:12px;letter-spacing:1px;">
        TAX INVOICE
      </td>
    </tr>

    <!-- To / Invoice meta split -->
    <tr>
      <td style="width:50%;border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;">
        <div>To,</div>
        <br>
        <div>${data.client_name || ''}</div>
        <br>
        <div>${data.client_address ? data.client_address.replace(/\n/g, '<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;') : ''}</div>
      </td>
     <td style="width:50%; border-bottom:1px solid #000; padding:0; vertical-align:top; height:120px;">   <!-- match the left cell's height -->
  <div style="display:flex; flex-direction:column; height:100%;">
    <!-- Row 1 -->
    <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
      <span style="width:45%;">Invoice No.</span>
      <span style="width:55%; font-weight:bold; text-align:right;">${data.invoice_number || ''}</span>
    </div>
    <!-- Row 2 -->
    <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
      <span style="width:45%;">Date of Invoice</span>
      <span style="width:55%; text-align:right;">${formatDate(data.invoice_date)}</span>
    </div>
    <!-- Row 3 -->
    <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
      <span style="width:45%;">PO Number</span>
      <span style="width:55%; text-align:right;">${data.po_number || 'Agreement'}</span>
    </div>
    <!-- Row 4 -->
    <div style="flex:1; display:flex; align-items:center; padding:0 12px;">
      <span style="width:45%;">PO Date</span>
      <span style="width:55%; text-align:right;">${formatDate(data.po_date)}</span>
    </div>
  </div>
</td>
    </tr>

    <!-- PAN / GSTIN / State | Original & Balance PO Value -->
<tr style="height:70px;">   <!-- match your pixel budget for this section -->
  <td style="width:50%; border-right:1px solid #000; border-bottom:1px solid #000; padding:0; vertical-align:top; height:70px;">
  <div style="display:flex; flex-direction:column; height:100%; padding:6px 8px;">
    <div style="flex:1; display:flex; align-items:center;">PAN No. : ${data.client_pan || ''}</div>
    <div style="flex:1; display:flex; align-items:center;">GSTIN : ${data.client_gstin || ''}</div>
    <div style="flex:1; display:flex; align-items:center;">
      State : ${data.client_state || 'Maharashtra'} &nbsp;&nbsp; State Code : ${data.client_state_code || '27'}
    </div>
  </div>
</td>
  
  <td style="width:50%; border-bottom:1px solid #000; padding:0; vertical-align:top; height:70px;">
    <div style="display:flex; flex-direction:column; height:100%;">
      <!-- Row 1: Original PO Value -->
      <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
        <span style="width:45%;">Original PO Value :</span>
        <span style="width:55%; text-align:right;">${data.original_po_value ? formatCurrency(data.original_po_value) : '-'}</span>
      </div>
      <!-- Row 2: Balance PO Value -->
      <div style="flex:1; display:flex; align-items:center; padding:0 12px; font-weight:bold;">
        <span style="width:45%;">Balance PO Value :</span>
        <span style="width:55%; text-align:right;">${data.balance_po_value ? formatCurrency(data.balance_po_value) : '-'}</span>
      </div>
    </div>
  </td>
</tr>

    <!-- Kind Attn -->
    <tr>
      <td colspan="2" style="border-bottom:1px solid #000;padding:4px 8px;">
        Kind Attn. &nbsp; : ${data.kind_attn || ''}
      </td>
    </tr>

    <!-- Line items table header -->
    <tr>
      <td colspan="2" style="padding:0;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid #000;">
              <th style="border-right:1px solid #000;padding:5px 4px;text-align:center;width:50px;">Sr. No.</th>
              <th style="border-right:1px solid #000;padding:5px 8px;text-align:center;">Description</th>
              <th style="border-right:1px solid #000;padding:5px 4px;text-align:center;width:70px;">Unit</th>
              <th style="border-right:1px solid #000;padding:5px 4px;text-align:center;width:80px;">Charges</th>
              <th style="padding:5px 8px;text-align:center;width:90px;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHTML}
          </tbody>
        </table>
      </td>
    </tr>

    <!-- GSTIN/PAN/Service/TAN left | Totals right -->
<tr style="height:110px;">   <!-- adjust this to your pixel budget (we used 110px for Section F) -->
  
  <!-- LEFT cell: 4 items → each gets flex:1 -->
  <td style="width:50%; border-right:1px solid #000; border-bottom:1px solid #000; padding:0; vertical-align:top; height:110px;">
    <div style="display:flex; flex-direction:column; height:100%; padding:6px 8px;">
      <div style="flex:1; display:flex; align-items:center;">GSTIN : ${data.gst_number || ''}</div>
      <div style="flex:1; display:flex; align-items:center;">PAN NO : ${data.pan_number || ''}</div>
      <div style="flex:1; display:flex; align-items:center;">
        Service Category : ${data.service_category || 'Consulting & Advisory Engineering Services (Service Code : 998331)'}
      </div>
      <div style="flex:1; display:flex; align-items:center;">Tan No : ${data.tan_number || ''}</div>
    </div>
  </td>

  <!-- RIGHT cell: 5 tax rows → each gets flex:1 -->
  <td style="width:50%; border-bottom:1px solid #000; padding:0; vertical-align:top; height:110px;">
    <div style="display:flex; flex-direction:column; height:100%;">
      
      <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
        <span style="width:55%;">Total Amount Before Tax &gt;&gt;</span>
        <span style="width:45%; text-align:right;">${formatCurrency(grossAmount)}</span>
      </div>
      
      <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
        <span style="width:55%;">Add : CGST _ ${cgstRate}% &gt;&gt;</span>
        <span style="width:45%; text-align:right;">${gstType === 'cgst_sgst' ? formatCurrency(cgstAmount) : '-'}</span>
      </div>
      
      <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
        <span style="width:55%;">Add : SGST _ ${sgstRate}% &gt;&gt;</span>
        <span style="width:45%; text-align:right;">${gstType === 'cgst_sgst' ? formatCurrency(sgstAmount) : '-'}</span>
      </div>
      
      <div style="flex:1; display:flex; align-items:center; border-bottom:1px solid #000; padding:0 12px;">
        <span style="width:55%;">Add : IGST _${igstRate}% &gt;&gt;</span>
        <span style="width:45%; text-align:right;">${gstType === 'igst' ? formatCurrency(igstAmount) : '-'}</span>
      </div>
      
      <div style="flex:1; display:flex; align-items:center; padding:0 12px; font-weight:bold;">
        <span style="width:55%;">Total Amount : GST &gt;&gt;</span>
        <span style="width:45%; text-align:right;">${formatCurrency(totalGst)}</span>
      </div>
      
    </div>
  </td>
</tr>

    <!-- Amount in words | Total Amount After Tax -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:middle;">
        <strong>${amountInWords}</strong>
      </td>
      <td style="border-bottom:1px solid #000;padding:0;vertical-align:middle;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:6px 8px;font-weight:bold;">Total Amount After Tax &gt;&gt;</td>
            <td style="padding:6px 8px;font-weight:bold;text-align:right;">${formatCurrency(netAmount)}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Payment Terms & Conditions -->
<tr>
  <td colspan="2" style="border-bottom:1px solid #000; padding:8px 12px;">
    <div style="font-weight:bold; margin-bottom:4px;">Payment Terms &amp; Conditions:</div>
    <div style="padding-left:16px;">
      <div style="display:flex; gap:4px; margin-bottom:2px;">
        <span style="width:20px;">1</span>
        <span>a) Payment shall be made within 15 days from the receipt of invoice.</span>
      </div>
      <div style="padding-left:24px; margin-bottom:2px;">b) Interest @ 18% will be charged on delayed payment.</div>
      <div style="display:flex; gap:4px;">
        <span style="width:20px;">2</span>
        <span>Subject to Mumbai Jurisdiction.</span>
      </div>
    </div>
  </td>
</tr>

    <!-- Cheque instructions | For ATSPL signature block -->
    <tr>
      <td style="border-right:1px solid #000;border-bottom:1px solid #000;padding:6px 8px;vertical-align:top;">
        Cheque/ Demand Draft /wire Transfer for requisite amount to be drawn in favor of
        <strong>"Accent Techno Solutions Private Ltd"</strong> payable at Mumbai.
      </td>
      <td style="padding:6px 8px;vertical-align:top;">
        For Accent Techno Solutions Private Limited
      </td>
    </tr>

    <!-- Payment remittance detail | Signature -->
    <!-- Payment remittance detail | Signature -->
<tr style="height:90px;">   <!-- adjust to your pixel budget -->
  
  <!-- LEFT cell: Payment remittance detail (3 items) -->
  <td style="width:50%; border-right:1px solid #000; border-bottom:1px solid #000; padding:0; vertical-align:top; height:90px;">
    <div style="display:flex; flex-direction:column; height:100%; padding:6px 8px; align-items:center; justify-content:center;">
      <!-- Row 1: Title -->
      <div style="flex:1; display:flex; align-items:center; justify-content:center; font-weight:bold;">
        Payment remittance detail
      </div>
      <!-- Row 2: Bank name -->
      <div style="flex:1; display:flex; align-items:center; justify-content:center;">
        Bank - Axis Bank Ltd.
      </div>
      <!-- Row 3: Address -->
      <div style="flex:1; display:flex; align-items:center; justify-content:center; text-align:center">
        Add. - ${data.bank_address || ''}
      </div>
    </div>
  </td>

  <!-- RIGHT cell: Signature block -->
  <td style="width:50%; border-bottom:1px solid #000; padding:0; vertical-align:bottom; height:90px;">
    <div style="display:flex; flex-direction:column; height:100%; padding:6px 8px; justify-content:flex-end; align-items:flex-start;">
      <div style="text-align:left;">
        <div style="font-weight:bold;">Santosh Dinkar Mestry</div>
        <div>Managing Director</div>
      </div>
    </div>
  </td>
</tr>

  </table>

  <!-- Doc reference footer (outside main table, bottom-left) -->
  <div style="margin-top:6px;font-size:9px;">
    F/ATSPL/ADMN/09<br>Rev 001
  </div>
</body>
</html>
  `;
}

function sanitizeFileName(value) {
	return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

// Map a DB invoice row to the fields expected by generateInvoiceHTML
function mapInvoiceForTemplate(inv) {
	const taxRate = parseFloat(inv.tax_rate) || 18;
	const gstType = inv.gst_type || 'cgst_sgst';
	return {
		...inv,
		invoice_date: inv.invoice_date || inv.created_at,
		gross_amount: inv.gross_amount != null ? inv.gross_amount : inv.subtotal,
		net_amount: inv.net_amount != null ? inv.net_amount : inv.total,
		original_po_value:
			inv.original_po_value != null ? inv.original_po_value : inv.po_value,
		cgst_rate:
			inv.cgst_rate != null
				? inv.cgst_rate
				: gstType === 'cgst_sgst'
					? taxRate / 2
					: 0,
		sgst_rate:
			inv.sgst_rate != null
				? inv.sgst_rate
				: gstType === 'cgst_sgst'
					? taxRate / 2
					: 0,
		igst_rate: inv.igst_rate != null ? inv.igst_rate : taxRate,
	};
}

// GET - Download invoice as PDF
export async function GET(request) {
	// RBAC check
	const authResult = await ensurePermission(
		request,
		RESOURCES.PROPOSALS,
		PERMISSIONS.READ
	);
	if (authResult instanceof Response) return authResult;
	if (!authResult.authorized) return authResult.response;

	let connection;
	let browser;
	try {
		const { searchParams } = new URL(request.url);
		const id = searchParams.get('id');

		if (!id) {
			return NextResponse.json(
				{ success: false, message: 'Invoice ID is required' },
				{ status: 400 }
			);
		}

		connection = await dbConnect();

		const [invoices] = await connection.execute(
			'SELECT * FROM invoices WHERE id = ? AND isDelete = 0',
			[id]
		);

		if (!invoices || invoices.length === 0) {
			return NextResponse.json(
				{ success: false, message: 'Invoice not found' },
				{ status: 404 }
			);
		}

		const invoiceRow = invoices[0];

		// Fetch remaining_balance from purchase_orders if linked
		if (invoiceRow.po_id) {
			try {
				const [poRows] = await connection.execute(
					'SELECT remaining_balance FROM purchase_orders WHERE id = ?',
					[invoiceRow.po_id]
				);
				if (poRows.length > 0) {
					invoiceRow.balance_po_value = poRows[0].remaining_balance;
				}
			} catch (_) {}
		}

		const invoice = mapInvoiceForTemplate(invoiceRow);
		const html = generateInvoiceHTML(invoice);
		const filename = `${sanitizeFileName(invoice.invoice_number || 'invoice')}.pdf`;

		const viewport = {
			deviceScaleFactor: 1,
			hasTouch: false,
			height: 1754,
			isLandscape: false,
			isMobile: false,
			width: 1240,
		};

		const isVercel = process.env.VERCEL === '1';
		if (isVercel) {
			browser = await puppeteer.launch({
				args: chromium.args,
				defaultViewport: viewport,
				executablePath: await chromium.executablePath(),
				headless: true,
			});
		} else {
			browser = await puppeteer.launch({
				headless: true,
				defaultViewport: viewport,
			});
		}

		const page = await browser.newPage();
		await page.emulateMediaType('print');
		await page.setContent(html, { waitUntil: 'networkidle0' });

		const pdf = await page.pdf({
			width: '794px', // A4 width in CSS pixels
			height: '1123px', // A4 height in CSS pixels
			printBackground: true,
			margin: {
				top: '4.52cm', // 👈 Letterhead offset
				bottom: '2cm', // 👈 Your new bottom margin
				left: '1.2cm', // standard safe margin
				right: '1.2cm', // standard safe margin
			},
		});

		return new Response(Buffer.from(pdf), {
			status: 200,
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `inline; filename="${filename}"`,
			},
		});
	} catch (error) {
		console.error('Error generating invoice:', error);
		return NextResponse.json(
			{
				success: false,
				message: 'Failed to generate invoice',
				error: error.message,
			},
			{ status: 500 }
		);
	} finally {
		if (browser) {
			try {
				await browser.close();
			} catch (closeError) {
				console.error('Error closing browser:', closeError);
			}
		}
		if (connection) await connection.end();
	}
}
