import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';
import { 
  generatePayrollSlip, 
  generateMonthlyPayroll,
  calculateEmployeePayroll 
} from '@/utils/payroll-calculator';

/**
 * POST - Generate payroll slip(s)
 * 
 * Body options:
 * 1. Generate for single employee: { employee_id: 123, month: '2025-12-01' }
 * 2. Generate for all employees: { month: '2025-12-01', all: true }
 * 3. Calculate without saving: { employee_id: 123, month: '2025-12-01', preview: true }
 */
export async function POST(request) {
  // RBAC check
  const authResult = await ensurePermission(request, RESOURCES.PAYROLL, PERMISSIONS.CREATE);
  if (authResult.authorized === false) return authResult.response;

  try {
    const body = await request.json();
    const { employee_id, month, all, preview } = body;
    
    if (!month) {
      return NextResponse.json(
        { success: false, error: 'Month is required (format: YYYY-MM-01)' },
        { status: 400 }
      );
    }
    
    // Validate month format
    const monthDate = new Date(month);
    if (isNaN(monthDate.getTime())) {
      return NextResponse.json(
        { success: false, error: 'Invalid month format. Use YYYY-MM-01' },
        { status: 400 }
      );
    }
    
    // Preview mode - calculate without saving
    if (preview && employee_id) {
      const payroll = await calculateEmployeePayroll(employee_id, month);
      
      return NextResponse.json({
        success: true,
        preview: true,
        data: payroll
      });
    }
    
    // Generate for all employees
    if (all) {
      const results = await generateMonthlyPayroll(month);
      
      return NextResponse.json({
        success: true,
        message: `Payroll generation completed for ${month}`,
        results
      });
    }
    
    // Generate for single employee
    if (employee_id) {
      const slip = await generatePayrollSlip(employee_id, month);
      
      return NextResponse.json({
        success: true,
        message: 'Payroll slip generated successfully',
        data: slip
      }, { status: 201 });
    }
    
    return NextResponse.json(
      { success: false, error: 'Either employee_id or all=true must be provided' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('POST /api/payroll/generate error:', error);
    
    // Handle duplicate entry error
    if (error.message.includes('already exists')) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 409 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: 'Failed to generate payroll', details: error.message },
      { status: 500 }
    );
  }
}
