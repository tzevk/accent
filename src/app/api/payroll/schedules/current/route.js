import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

// GET /api/payroll/schedules/current - Get current active values for all payroll components
export async function GET(request) {
  try {
    await ensurePermission(request, RESOURCES.EMPLOYEES, PERMISSIONS.READ);

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const grossSalary = parseFloat(searchParams.get('gross')) || 0;

    const db = await dbConnect();
    
    try {
      // Fetch all active component schedules for the given date
      const [rows] = await db.query(
        `SELECT 
          component_type,
          value_type,
          value,
          min_salary,
          max_salary
        FROM payroll_schedules
        WHERE is_active = 1
          AND effective_from <= ?
          AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY component_type, effective_from DESC`,
        [date, date]
      );

      // Group by component type (handle multiple rows for PT slabs)
      const components = {};
      
      for (const row of rows) {
        const { component_type, value_type, value, min_salary, max_salary } = row;
        
        // Special handling for PT (slab-based)
        if (component_type === 'pt') {
          if (grossSalary >= min_salary && grossSalary <= max_salary) {
            components[component_type] = {
              value_type,
              value: parseFloat(value),
              min_salary,
              max_salary
            };
          }
        } else {
          // For other components, use the first active one (most recent)
          if (!components[component_type]) {
            components[component_type] = {
              value_type,
              value: parseFloat(value)
            };
          }
        }
      }

      // Calculate actual amounts based on gross salary
      const calculated = {};
      
      for (const [type, data] of Object.entries(components)) {
        if (data.value_type === 'percentage') {
          calculated[type] = {
            type: 'percentage',
            percentage: data.value,
            amount: Math.round((grossSalary * data.value) / 100)
          };
        } else {
          calculated[type] = {
            type: 'fixed',
            amount: data.value
          };
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          date,
          gross_salary: grossSalary,
          components: calculated
        }
      });
      
    } finally {
      await db.end();
    }
    
  } catch (error) {
    console.error('Error fetching current payroll schedules:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: error.status || 500 }
    );
  }
}
