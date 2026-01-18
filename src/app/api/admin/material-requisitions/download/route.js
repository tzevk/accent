import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'accent_crm',
};

// GET - Download/Print material requisition
export async function GET(request) {
  let db;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
    }
    
    db = await mysql.createConnection(dbConfig);
    
    const [rows] = await db.query(
      `SELECT * FROM material_requisitions WHERE id = ?`,
      [id]
    );
    
    if (rows.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'Requisition not found' }, { status: 404 });
    }
    
    const requisition = rows[0];
    const lineItems = typeof requisition.line_items === 'string' 
      ? JSON.parse(requisition.line_items) 
      : requisition.line_items || [];
    
    await db.end();
    
    // Format date
    const formatDate = (date) => {
      if (!date) return '';
      return new Date(date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    };
    
    // Generate HTML for printing
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Material Requisition - ${requisition.requisition_number}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: Arial, sans-serif;
          padding: 20px;
          background: white;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
          border: 2px solid #333;
        }
        .header {
          display: flex;
          align-items: center;
          padding: 20px;
          border-bottom: 2px solid #333;
        }
        .logo-section {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .logo {
          height: 50px;
          width: auto;
          object-fit: contain;
        }
        .company-name {
          text-align: left;
        }
        .company-name h2 {
          font-size: 22px;
          color: #333;
        }
        .company-name p {
          font-size: 10px;
          color: #666;
        }
        .form-title {
          flex: 1;
          text-align: center;
          font-size: 16px;
          font-weight: bold;
        }
        .info-row {
          display: flex;
          border-bottom: 1px solid #333;
        }
        .info-cell {
          padding: 10px 15px;
          border-right: 1px solid #333;
        }
        .info-cell:last-child {
          border-right: none;
        }
        .info-label {
          font-weight: bold;
          font-size: 12px;
          background: #f0f0f0;
          width: 120px;
        }
        .info-value {
          flex: 1;
          font-size: 13px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
        }
        th, td {
          border: 1px solid #333;
          padding: 10px;
          text-align: left;
          font-size: 12px;
        }
        th {
          background: #f0f0f0;
          font-weight: bold;
          text-align: center;
        }
        td.center {
          text-align: center;
        }
        .signatures {
          display: flex;
          border-bottom: 2px solid #333;
        }
        .signature-box {
          flex: 1;
          padding: 30px 15px 15px;
          text-align: center;
          border-right: 1px solid #333;
        }
        .signature-box:last-child {
          border-right: none;
        }
        .signature-line {
          border-bottom: 1px solid #333;
          margin-bottom: 8px;
          height: 30px;
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding-bottom: 5px;
          font-size: 13px;
        }
        .signature-label {
          font-size: 11px;
          font-weight: bold;
          color: #444;
        }
        .receipt-section {
          padding: 15px;
          border-bottom: 2px solid #333;
          font-size: 13px;
        }
        .receipt-row {
          display: flex;
          gap: 10px;
          margin-bottom: 8px;
        }
        .receipt-label {
          font-weight: bold;
        }
        .receipt-value {
          border-bottom: 1px solid #333;
          flex: 1;
          padding-left: 5px;
        }
        .form-number {
          padding: 10px 15px;
          font-size: 11px;
          color: #666;
        }
        .print-button {
          display: block;
          margin: 20px auto;
          padding: 12px 30px;
          background: #7c3aed;
          color: white;
          border: none;
          border-radius: 5px;
          font-size: 14px;
          cursor: pointer;
        }
        .print-button:hover {
          background: #6d28d9;
        }
        @media print {
          .print-button {
            display: none;
          }
          body {
            padding: 0;
          }
          .container {
            border-width: 1px;
          }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-section">
            <img src="/accent-logo.png" alt="Accent Logo" class="logo" />
            <div class="company-name">
              <h2>ACCENT</h2>
              <p>TECHNO SOLUTIONS</p>
            </div>
          </div>
          <div class="form-title">MATERIAL / STATIONERY REQUISITION FORM</div>
        </div>
        
        <div class="info-row">
          <div class="info-cell info-label">Requisition No.</div>
          <div class="info-cell info-value" style="flex: 1;">${requisition.requisition_number}</div>
          <div class="info-cell info-label" style="width: 100px;">Date of Req.</div>
          <div class="info-cell info-value" style="width: 100px;">${formatDate(requisition.requisition_date)}</div>
        </div>
        
        <div class="info-row">
          <div class="info-cell info-label">Requested By</div>
          <div class="info-cell info-value" style="flex: 1;">${requisition.requested_by || ''}</div>
          <div class="info-cell info-label" style="width: 100px;">Department</div>
          <div class="info-cell info-value" style="width: 100px;">${requisition.department || ''}</div>
        </div>
        
        <table>
          <thead>
            <tr>
              <th style="width: 60px;">Sr. No.</th>
              <th>Material Description</th>
              <th style="width: 100px;">Unit / Qty</th>
              <th style="width: 150px;">Purpose</th>
            </tr>
          </thead>
          <tbody>
            ${lineItems.map((item, index) => `
              <tr>
                <td class="center">${item.sr_no || index + 1}</td>
                <td>${item.description || ''}</td>
                <td class="center">${item.unit_qty || ''}</td>
                <td>${item.purpose || ''}</td>
              </tr>
            `).join('')}
            ${lineItems.length < 5 ? Array(5 - lineItems.length).fill(0).map((_, i) => `
              <tr>
                <td class="center">${lineItems.length + i + 1}</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            `).join('') : ''}
          </tbody>
        </table>
        
        <div class="signatures">
          <div class="signature-box">
            <div class="signature-line">${requisition.prepared_by || ''}</div>
            <div class="signature-label">Prepared By</div>
          </div>
          <div class="signature-box">
            <div class="signature-line">${requisition.checked_by || ''}</div>
            <div class="signature-label">Checked By</div>
          </div>
          <div class="signature-box">
            <div class="signature-line">${requisition.approved_by || ''}</div>
            <div class="signature-label">Approved By</div>
          </div>
        </div>
        
        <div class="receipt-section">
          <div class="receipt-row">
            <span class="receipt-label">Material Received / Collected By:</span>
            <span class="receipt-value">${requisition.received_by || ''}</span>
          </div>
          <div class="receipt-row">
            <span class="receipt-label">Date of Receipt of Material:</span>
            <span class="receipt-value" style="width: 150px;">${formatDate(requisition.receipt_date)}</span>
          </div>
        </div>
        
        <div class="form-number">F/ATSPL/PUR/01</div>
      </div>
      
      <button class="print-button" onclick="window.print()">Print / Save as PDF</button>
    </body>
    </html>
    `;
    
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
      }
    });
    
  } catch (error) {
    console.error('Error downloading material requisition:', error);
    if (db) await db.end();
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
