import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// Helper functions
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2
  }).format(amount || 0);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  if (num === 0) return 'Zero';
  if (num < 0) return 'Minus ' + numberToWords(-num);
  
  let words = '';
  
  if (Math.floor(num / 10000000) > 0) {
    words += numberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  if (Math.floor(num / 100000) > 0) {
    words += numberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  if (Math.floor(num / 1000) > 0) {
    words += numberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  if (Math.floor(num / 100) > 0) {
    words += numberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  if (num > 0) {
    if (num < 20) {
      words += ones[num];
    } else {
      words += tens[Math.floor(num / 10)];
      if (num % 10 > 0) {
        words += ' ' + ones[num % 10];
      }
    }
  }
  return words.trim();
}

function amountToWords(amount) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  
  let result = 'Rupees ' + numberToWords(rupees);
  if (paise > 0) {
    result += ' and ' + numberToWords(paise) + ' Paise';
  }
  result += ' Only';
  return result;
}

// Generate Invoice HTML
function generateInvoiceHTML(data) {
  // Parse items if needed
  let items = data.items;
  if (typeof items === 'string') {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  items = items || [];

  // Calculate amounts
  const subtotal = parseFloat(data.subtotal) || 0;
  const cgstRate = 9;
  const sgstRate = 9;
  const cgstAmount = subtotal * cgstRate / 100;
  const sgstAmount = subtotal * sgstRate / 100;
  const totalGst = cgstAmount + sgstAmount;
  const totalAfterTax = subtotal + totalGst;

  // Generate items rows
  let itemsHTML = '';
  if (items.length > 0) {
    items.forEach((item, index) => {
      const qty = parseFloat(item.quantity) || 1;
      const rate = parseFloat(item.rate) || parseFloat(item.unit_price) || 0;
      const amount = item.amount > 0 ? parseFloat(item.amount) : qty * rate;
      const rowBg = index % 2 === 0 ? 'background: #fff;' : 'background: #fafafa;';
      itemsHTML += `
        <tr style="${rowBg}">
          <td style="border: 1px solid #eee; padding: 10px 8px; text-align: center; color: #666;">${index + 1}</td>
          <td style="border: 1px solid #eee; padding: 10px 8px; color: #1a1a1a;">${item.description || item.name || '-'}</td>
          <td style="border: 1px solid #eee; padding: 10px 8px; text-align: center;">${qty}</td>
          <td style="border: 1px solid #eee; padding: 10px 8px; text-align: right;">${formatCurrency(rate).replace('₹', '')}</td>
          <td style="border: 1px solid #eee; padding: 10px 8px; text-align: right; font-weight: 500;">${formatCurrency(amount).replace('₹', '')}</td>
        </tr>
      `;
    });
  } else {
    itemsHTML = `
      <tr>
        <td style="border: 1px solid #eee; padding: 10px 8px; text-align: center; color: #666;">1</td>
        <td style="border: 1px solid #eee; padding: 10px 8px; color: #1a1a1a;">${data.description || '-'}</td>
        <td style="border: 1px solid #eee; padding: 10px 8px; text-align: center;">1</td>
        <td style="border: 1px solid #eee; padding: 10px 8px; text-align: right;">${formatCurrency(subtotal).replace('₹', '')}</td>
        <td style="border: 1px solid #eee; padding: 10px 8px; text-align: right; font-weight: 500;">${formatCurrency(subtotal).replace('₹', '')}</td>
      </tr>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tax Invoice - ${data.invoice_number || 'Draft'}</title>
  <style>
    @media print {
      body { margin: 0; padding: 0; }
      .no-print { display: none !important; }
    }
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
      font-size: 11px; 
      line-height: 1.5; 
      color: #1a1a1a; 
      background: #f5f5f5; 
      padding: 20px;
      -webkit-font-smoothing: antialiased;
    }
    .invoice-container { 
      width: 100%; 
      max-width: 800px; 
      margin: 0 auto; 
      background: white;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      border-radius: 4px;
      overflow: hidden;
    }
    .print-button { 
      position: fixed; 
      bottom: 20px; 
      right: 20px; 
      background: linear-gradient(135deg, #1a1a1a 0%, #333 100%); 
      color: white; 
      border: none; 
      padding: 14px 28px; 
      border-radius: 6px; 
      font-size: 13px; 
      font-weight: 500;
      cursor: pointer; 
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: all 0.2s ease;
    }
    .print-button:hover { 
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
    }
    table { border-collapse: collapse; }
    .section-header {
      background: #f8f8f8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-size: 10px;
      color: #555;
    }
    .label-cell {
      color: #666;
      font-size: 10px;
    }
    .value-cell {
      color: #1a1a1a;
      font-weight: 500;
    }
    .highlight-row {
      background: #fafafa;
    }
    .total-row {
      background: #f0f0f0;
      font-weight: 600;
    }
    .amount-words {
      background: linear-gradient(135deg, #f8f8f8 0%, #f0f0f0 100%);
      font-style: italic;
      letter-spacing: 0.3px;
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <!-- Main Invoice Table -->
    <table style="width: 100%; border: 1px solid #ddd;">
      
      <!-- Title Row -->
      <tr>
        <td colspan="5" style="border-bottom: 2px solid #333; padding: 16px; text-align: center; font-weight: 700; font-size: 16px; letter-spacing: 2px; background: linear-gradient(135deg, #fafafa 0%, #f0f0f0 100%);">
          TAX INVOICE
        </td>
      </tr>

      <!-- Header Section: Client Info & Invoice Details -->
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 0; width: 50%; vertical-align: top;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; width: 80px; color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">To,</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;"></td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">Name</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; font-weight: 600; color: #1a1a1a;">: ${data.client_name || ''}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">Address</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: ${data.client_address || ''}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">PAN No.</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: ${data.client_pan || ''}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">GSTIN</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: ${data.client_gstin || ''}</td>
            </tr>
            <tr>
              <td style="padding: 8px 10px; color: #666; font-size: 10px;">State</td>
              <td style="padding: 8px 10px;">: ${data.client_state || ''} &nbsp;&nbsp;&nbsp;&nbsp; <span style="color: #666;">State Code:</span> ${data.client_state_code || ''}</td>
            </tr>
          </table>
        </td>
        <td colspan="3" style="border: 1px solid #ddd; padding: 0; width: 50%; vertical-align: top;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; width: 115px; color: #666; font-size: 10px;">Invoice No.</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; font-weight: 600; color: #1a1a1a;">: ${data.invoice_number || ''}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">Date of Invoice</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: ${formatDate(data.created_at)}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">PO Number</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: ${data.po_number || ''}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">PO Date</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: ${formatDate(data.po_date)}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">Original PO Value</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: ${data.po_value ? formatCurrency(data.po_value).replace('₹', '') : ''}</td>
            </tr>
            <tr>
              <td style="padding: 8px 10px; color: #666; font-size: 10px;">Balance PO Value</td>
              <td style="padding: 8px 10px;">: ${data.balance_po_value ? formatCurrency(data.balance_po_value).replace('₹', '') : ''}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Kind Attn Row -->
      <tr>
        <td colspan="5" style="border: 1px solid #ddd; padding: 10px 12px; background: #fafafa;">
          <span style="color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Kind Attn.</span> : <strong>${data.kind_attn || ''}</strong>
        </td>
      </tr>

      <!-- Items Table Header -->
      <tr>
        <th style="border: 1px solid #ddd; padding: 10px 8px; text-align: center; width: 50px; background: #f5f5f5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555;">Sr. No.</th>
        <th style="border: 1px solid #ddd; padding: 10px 8px; text-align: center; background: #f5f5f5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555;">Description</th>
        <th style="border: 1px solid #ddd; padding: 10px 8px; text-align: center; width: 60px; background: #f5f5f5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555;">Unit</th>
        <th style="border: 1px solid #ddd; padding: 10px 8px; text-align: center; width: 90px; background: #f5f5f5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555;">Charges</th>
        <th style="border: 1px solid #ddd; padding: 10px 8px; text-align: center; width: 90px; background: #f5f5f5; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555;">Amount</th>
      </tr>

      <!-- Items Rows -->
      ${itemsHTML}

      <!-- Bottom Section: Tax Details & Totals -->
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 0; vertical-align: top;" rowspan="6">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; width: 110px; color: #666; font-size: 10px;">GSTIN</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: 27AAHCA5765M1ZD</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">PAN NO</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">: AAHCA5765M</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px; color: #666; font-size: 10px;">Service Category</td>
              <td style="border-bottom: 1px solid #eee; padding: 8px 10px;">:</td>
            </tr>
            <tr>
              <td style="padding: 8px 10px; color: #666; font-size: 10px;">Tan No</td>
              <td style="padding: 8px 10px;">:</td>
            </tr>
          </table>
        </td>
        <td colspan="2" style="border: 1px solid #ddd; padding: 10px 12px; text-align: right; background: #fafafa;"><strong>Total Amount Before Tax >></strong></td>
        <td style="border: 1px solid #ddd; padding: 10px 12px; text-align: right; background: #fafafa; font-weight: 500;">${formatCurrency(subtotal).replace('₹', '')}</td>
      </tr>
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 8px 12px; text-align: right; color: #555;">Add : CGST @ 9% >></td>
        <td style="border: 1px solid #ddd; padding: 8px 12px; text-align: right;">${formatCurrency(cgstAmount).replace('₹', '')}</td>
      </tr>
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 8px 12px; text-align: right; color: #555;">Add : SGST @ 9% >></td>
        <td style="border: 1px solid #ddd; padding: 8px 12px; text-align: right;">${formatCurrency(sgstAmount).replace('₹', '')}</td>
      </tr>
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 8px 12px; text-align: right; color: #555;">Add : IGST @ 18% >></td>
        <td style="border: 1px solid #ddd; padding: 8px 12px; text-align: right; color: #999;">-</td>
      </tr>
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 8px 12px; text-align: right; color: #555;">Total Amount : GST >></td>
        <td style="border: 1px solid #ddd; padding: 8px 12px; text-align: right;">${formatCurrency(totalGst).replace('₹', '')}</td>
      </tr>
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 12px; text-align: right; background: linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%);"><strong style="font-size: 12px;">Total Amount After Tax >></strong></td>
        <td style="border: 1px solid #ddd; padding: 12px; text-align: right; background: linear-gradient(135deg, #f0f0f0 0%, #e8e8e8 100%);"><strong style="font-size: 13px;">${formatCurrency(totalAfterTax).replace('₹', '')}</strong></td>
      </tr>

      <!-- Amount in Words -->
      <tr>
        <td colspan="5" style="border: 1px solid #ddd; padding: 12px 14px; background: linear-gradient(135deg, #f8f8f8 0%, #f0f0f0 100%);">
          <span style="color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Amount in Words:</span> <em style="font-style: italic; letter-spacing: 0.3px; margin-left: 8px;">${amountToWords(totalAfterTax)}</em>
        </td>
      </tr>

      <!-- Payment Terms & Conditions -->
      <tr>
        <td colspan="5" style="border: 1px solid #ddd; padding: 12px 14px;">
          <div style="font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; margin-bottom: 8px;">Payment Terms & Conditions:</div>
          <div style="margin-left: 15px; color: #333; line-height: 1.6;">
            <div>1. a) Payment shall be made within 30 days from the receipt of invoice.</div>
            <div style="margin-left: 15px;">b) Interest @ 18% will be charged on delayed payment.</div>
            <div>2. Subject to Mumbai Jurisdiction.</div>
          </div>
        </td>
      </tr>

      <!-- Bank Details & Signature -->
      <tr>
        <td colspan="2" style="border: 1px solid #ddd; padding: 14px; vertical-align: top; background: #fafafa;">
          <div style="margin-bottom: 10px; line-height: 1.5;">
            Cheque/Demand Draft/Wire Transfer for requisite amount to be drawn in<br>
            favor of <strong>"Accent Techno Solutions Pvt. Ltd"</strong> payable at Mumbai.
          </div>
          <div style="margin-top: 12px;">
            <strong style="text-decoration: underline; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Payment remittance detail</strong><br>
            <div style="margin-top: 6px; line-height: 1.6;">
              Bank - Axis Bank Ltd.<br>
              Add.- City Survey No. 841 to 846, "Florence" Florence CHS LTD.<br>
              Vakola, Mumbai - 400 055 / A/c No. 917020044935714<br>
              SWIFT CODE: AXISINBB028, IFS CODE: UTIB0001244.
            </div>
          </div>
        </td>
        <td colspan="3" style="border: 1px solid #ddd; padding: 14px; vertical-align: top; text-align: center;">
          <div style="font-weight: 600; text-align: left; font-size: 11px;">For Accent Techno Solutions Private Limited</div>
          <div style="height: 50px;"></div>
          <div style="font-weight: bold;">Santosh Dinkar Mestry</div>
          <div style="font-weight: 600;">Santosh Dinkar Mestry</div>
          <div style="color: #666; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px;">Director</div>
        </td>
      </tr>

    </table>
  </div>
  
  <button class="print-button no-print" onclick="window.print()">
    Print / Save as PDF
  </button>
</body>
</html>
  `;
}

// GET - Download invoice as printable HTML
export async function GET(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
  if (authResult.authorized === false) return authResult.response;

  let connection;
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
      'SELECT * FROM invoices WHERE id = ?',
      [id]
    );

    if (!invoices || invoices.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Invoice not found' },
        { status: 404 }
      );
    }

    const invoice = invoices[0];

    // Generate HTML
    const html = generateInvoiceHTML(invoice);

    // Return as HTML response
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('Error downloading invoice:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to download invoice', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
