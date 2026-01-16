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
  if (!dateString) return '';
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

// Generate Purchase Order HTML matching the format
function generatePurchaseOrderHTML(data) {
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
  const netTotal = subtotal + cgstAmount + sgstAmount;

  // Extract state code from vendor address or GSTIN
  const vendorStateCode = data.vendor_gstin ? data.vendor_gstin.substring(0, 2) : '27';
  const vendorState = vendorStateCode === '27' ? 'Maharashtra' : '';

  // Generate items rows
  let itemsHTML = '';
  if (items.length > 0) {
    items.forEach((item, index) => {
      const qty = parseFloat(item.quantity) || parseFloat(item.qty) || 1;
      const rate = parseFloat(item.rate) || parseFloat(item.unit_price) || 0;
      const amount = item.amount > 0 ? parseFloat(item.amount) : qty * rate;
      itemsHTML += `
        <tr>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">${index + 1}</td>
          <td style="border: 1px solid #000; padding: 8px;">${item.description || item.name || '-'}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: center;">${qty}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(rate).replace('₹', '')}</td>
          <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: 500;">${formatCurrency(amount).replace('₹', '')}</td>
        </tr>
      `;
    });
  } else {
    // Empty row placeholder
    itemsHTML = `
      <tr>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">1</td>
        <td style="border: 1px solid #000; padding: 8px;">${data.description || '-'}</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: center;">1</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: right;">${formatCurrency(subtotal).replace('₹', '')}</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: right; font-weight: 500;">${formatCurrency(subtotal).replace('₹', '')}</td>
      </tr>
    `;
  }

  // Add empty rows to fill space
  const minRows = 5;
  const currentRows = items.length || 1;
  for (let i = currentRows; i < minRows; i++) {
    itemsHTML += `
      <tr>
        <td style="border: 1px solid #000; padding: 8px; height: 30px;">&nbsp;</td>
        <td style="border: 1px solid #000; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #000; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #000; padding: 8px;">&nbsp;</td>
        <td style="border: 1px solid #000; padding: 8px;">&nbsp;</td>
      </tr>
    `;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Order - ${data.po_number || 'Draft'}</title>
  <style>
    @media print {
      body { margin: 0; padding: 0; }
      .no-print { display: none !important; }
    }
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      font-size: 12px; 
      line-height: 1.4; 
      color: #000; 
      background: #f5f5f5; 
      padding: 20px;
    }
    .po-container { 
      width: 100%; 
      max-width: 800px; 
      margin: 0 auto; 
      background: white;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      padding: 0;
    }
    .print-button { 
      position: fixed; 
      bottom: 20px; 
      right: 20px; 
      background: linear-gradient(135deg, #7F2487 0%, #64126D 100%); 
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
  </style>
</head>
<body>
  <div class="po-container">
    <!-- Main Purchase Order Table -->
    <table style="width: 100%; border: 2px solid #000;">
      
      <!-- Title Row -->
      <tr>
        <td colspan="5" style="border-bottom: 2px solid #000; padding: 12px; text-align: center; font-weight: 700; font-size: 16px;">
          Purchase Order
        </td>
      </tr>

      <!-- Header Section: Vendor Info & PO Details -->
      <tr>
        <td colspan="2" style="border: 1px solid #000; padding: 0; width: 50%; vertical-align: top;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px; font-weight: bold;">To,</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px;">
                <div style="font-weight: bold;">${data.vendor_name || ''}</div>
              </td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px;">
                <strong>Kind Attn:</strong> ${data.kind_attn || data.vendor_name || ''}
              </td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px;">
                <strong>GSTIN:</strong> ${data.vendor_gstin || ''}
              </td>
            </tr>
            <tr>
              <td style="padding: 8px;">
                <strong>State:</strong> ${vendorState} &nbsp;&nbsp;&nbsp;&nbsp; <strong>State code:</strong> ${vendorStateCode}
              </td>
            </tr>
          </table>
        </td>
        <td colspan="3" style="border: 1px solid #000; padding: 0; width: 50%; vertical-align: top;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px; width: 120px;"><strong>P. Order No.</strong></td>
              <td style="border-bottom: 1px solid #000; padding: 8px;">: ${data.po_number || ''}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px;"><strong>Date</strong></td>
              <td style="border-bottom: 1px solid #000; padding: 8px;">: ${formatDate(data.created_at)}</td>
            </tr>
            <tr>
              <td style="border-bottom: 1px solid #000; padding: 8px;"><strong>Quotation No.</strong></td>
              <td style="border-bottom: 1px solid #000; padding: 8px;">: ${data.quotation_no || ''}</td>
            </tr>
            <tr>
              <td style="padding: 8px;"><strong>Date</strong></td>
              <td style="padding: 8px;">: ${formatDate(data.quotation_date) || ''}</td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Items Table Header -->
      <tr style="background: #f0f0f0;">
        <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 60px; font-weight: bold;">Sr. No</th>
        <th style="border: 1px solid #000; padding: 10px; text-align: center; font-weight: bold;">Description</th>
        <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 60px; font-weight: bold;">No.</th>
        <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 100px; font-weight: bold;">Rate (Rs)</th>
        <th style="border: 1px solid #000; padding: 10px; text-align: center; width: 100px; font-weight: bold;">Total Value<br>(Rs)</th>
      </tr>

      <!-- Items Rows -->
      ${itemsHTML}

      <!-- Tax rows -->
      <tr>
        <td colspan="4" style="border: 1px solid #000; padding: 8px; text-align: left;">Add:<br>CGST @ 9%<br>SGST @ 9%</td>
        <td style="border: 1px solid #000; padding: 8px; text-align: right; vertical-align: bottom;">
          ${formatCurrency(cgstAmount).replace('₹', '')}<br>
          ${formatCurrency(sgstAmount).replace('₹', '')}
        </td>
      </tr>

      <!-- Amount in Words & Net Total -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 10px; font-weight: bold;">
          Rs. <br>
          <em style="font-weight: normal; font-style: italic;">${amountToWords(netTotal)}</em>
        </td>
        <td style="border: 1px solid #000; padding: 10px; text-align: center; font-weight: bold; background: #f0f0f0;">NET TOTAL</td>
        <td style="border: 1px solid #000; padding: 10px; text-align: right; font-weight: bold; font-size: 14px; background: #f0f0f0;">${formatCurrency(netTotal).replace('₹', '')}</td>
      </tr>

      <!-- Company Details & Signature Section -->
      <tr>
        <td colspan="3" style="border: 1px solid #000; padding: 12px; vertical-align: top;">
          <div style="margin-bottom: 8px;">
            <strong>GSTIN:</strong> 27AAPCS0767C1Z7
          </div>
          <div style="margin-bottom: 8px;">
            <strong>State:</strong> Maharashtra &nbsp;&nbsp;&nbsp;&nbsp; <strong>State Code:</strong> 27
          </div>
          <div style="margin-top: 12px;">
            <strong>Notes:</strong>
            <ul style="margin-left: 20px; margin-top: 5px;">
              <li>Taxes applicable will be charged extra.</li>
              <li>Payment 100% within 30 days.</li>
              <li>TDS will be deducted as applicable</li>
            </ul>
          </div>
        </td>
        <td colspan="2" style="border: 1px solid #000; padding: 12px; vertical-align: top; text-align: right;">
          <div style="font-weight: bold; margin-bottom: 60px;">For Accent Techno Solutions Pvt. Ltd</div>
          <div style="border-top: 1px solid #000; display: inline-block; padding-top: 5px;">
            <strong>Mr. Santosh D Mestry</strong><br>
            <span>Director</span>
          </div>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td colspan="5" style="border-top: 1px solid #000; padding: 8px; text-align: center; font-size: 10px; color: #666;">
          F/PU/05/01
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

// GET - Download purchase order as printable HTML
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
        { success: false, message: 'Purchase order ID is required' },
        { status: 400 }
      );
    }

    connection = await dbConnect();

    const [purchaseOrders] = await connection.execute(
      'SELECT * FROM purchase_orders WHERE id = ?',
      [id]
    );

    if (!purchaseOrders || purchaseOrders.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const purchaseOrder = purchaseOrders[0];

    // Generate HTML
    const html = generatePurchaseOrderHTML(purchaseOrder);

    // Return as HTML response
    return new NextResponse(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });

  } catch (error) {
    console.error('Error downloading purchase order:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to download purchase order', error: error.message },
      { status: 500 }
    );
  } finally {
    if (connection) await connection.end();
  }
}
