import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/admin/cash-vouchers/next-number
 * Get the next voucher number
 */
export async function GET(request) {
  let db;
  
  try {
    let user;
    try {
      user = await getCurrentUser(request);
    } catch (authErr) {
      return NextResponse.json({ success: false, error: 'Authentication failed' }, { status: 500 });
    }
    
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    db = await dbConnect();
    
    // Ensure table exists
    await db.execute(`
      CREATE TABLE IF NOT EXISTS cash_vouchers (
        id INT PRIMARY KEY AUTO_INCREMENT,
        voucher_number VARCHAR(50) UNIQUE,
        voucher_date DATE,
        voucher_type ENUM('payment', 'receipt') DEFAULT 'payment',
        paid_to VARCHAR(255),
        payment_mode ENUM('cash', 'cheque') DEFAULT 'cash',
        total_amount DECIMAL(15,2) DEFAULT 0,
        amount_in_words TEXT,
        line_items JSON,
        prepared_by VARCHAR(255),
        checked_by VARCHAR(255),
        approved_by VARCHAR(255),
        receiver_signature VARCHAR(255),
        status ENUM('pending', 'approved', 'rejected', 'paid') DEFAULT 'pending',
        notes TEXT,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Get last voucher number
    const [lastVoucher] = await db.execute(
      `SELECT voucher_number FROM cash_vouchers ORDER BY id DESC LIMIT 1`
    );
    
    let voucherNumber = 'CV-0001';
    if (lastVoucher.length > 0 && lastVoucher[0].voucher_number) {
      const lastNum = parseInt(lastVoucher[0].voucher_number.replace('CV-', '')) || 0;
      voucherNumber = `CV-${String(lastNum + 1).padStart(4, '0')}`;
    }

    return NextResponse.json({
      success: true,
      voucher_number: voucherNumber
    });
    
  } catch (error) {
    console.error('Get next voucher number error:', error?.message);
    return NextResponse.json(
      { success: false, error: 'Failed to get voucher number' },
      { status: 500 }
    );
  } finally {
    if (db && typeof db.release === 'function') {
      try { db.release(); } catch (e) { /* ignore */ }
    }
  }
}
