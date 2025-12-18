import { dbConnect } from '@/utils/database';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/utils/api-permissions';

/**
 * GET /api/users/[id]/attendance
 * Fetch attendance data for a user including in/out time, leaves, etc.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const requestedUserId = parseInt(id);
    
    const currentUser = await getCurrentUser(request);
    
    if (!currentUser) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Users can view their own attendance
    const isOwnData = requestedUserId === currentUser.id;
    if (!isOwnData && !currentUser.is_super_admin) {
      return NextResponse.json({ 
        success: false, 
        error: 'Forbidden' 
      }, { status: 403 });
    }

    const db = await dbConnect();
    
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
    
    // Try to get attendance data from attendance table if it exists
    let attendanceData = {
      inTime: null,
      outTime: null,
      currentMonth: now.toLocaleString('default', { month: 'long', year: 'numeric' }),
      daysInMonth: daysInMonth,
      daysPresent: 0,
      weeklyOff: 0,
      holidays: 0,
      leaves: {
        total: 18, // Default annual leave
        used: 0,
        balance: 18
      }
    };

    try {
      // Check if attendance table exists and get today's record
      const [todayAttendance] = await db.execute(`
        SELECT in_time, out_time 
        FROM attendance 
        WHERE user_id = ? AND DATE(date) = CURDATE()
        LIMIT 1
      `, [requestedUserId]);
      
      if (todayAttendance.length > 0) {
        attendanceData.inTime = todayAttendance[0].in_time;
        attendanceData.outTime = todayAttendance[0].out_time;
      }

      // Get monthly attendance summary
      const [monthlyAttendance] = await db.execute(`
        SELECT 
          COUNT(DISTINCT DATE(date)) as days_present,
          COUNT(DISTINCT CASE WHEN status = 'weekly_off' THEN DATE(date) END) as weekly_off,
          COUNT(DISTINCT CASE WHEN status = 'holiday' THEN DATE(date) END) as holidays
        FROM attendance 
        WHERE user_id = ? 
        AND MONTH(date) = ? 
        AND YEAR(date) = ?
      `, [requestedUserId, currentMonth, currentYear]);

      if (monthlyAttendance.length > 0) {
        attendanceData.daysPresent = monthlyAttendance[0].days_present || 0;
        attendanceData.weeklyOff = monthlyAttendance[0].weekly_off || 0;
        attendanceData.holidays = monthlyAttendance[0].holidays || 0;
      }
    } catch {
      // Attendance table might not exist, use activity logs to estimate
      console.log('Attendance table not found, using activity logs');
      
      try {
        // Check if user_activity_logs table exists
        const [tables] = await db.execute(`SHOW TABLES LIKE 'user_activity_logs'`);
        
        if (tables.length > 0) {
          // Count distinct days with activity as proxy for presence
          const [activityDays] = await db.execute(`
            SELECT COUNT(DISTINCT DATE(created_at)) as days_active
            FROM user_activity_logs 
            WHERE user_id = ? 
            AND MONTH(created_at) = ? 
            AND YEAR(created_at) = ?
          `, [requestedUserId, currentMonth, currentYear]);
          
          if (activityDays.length > 0) {
            attendanceData.daysPresent = activityDays[0].days_active || 0;
          }
        }
      } catch (logError) {
        console.log('Activity logs table also not found:', logError.message);
      }

      // Calculate weekly offs (Sundays in the month)
      let weeklyOff = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(currentYear, currentMonth - 1, d);
        if (date.getDay() === 0) weeklyOff++; // Sunday
      }
      attendanceData.weeklyOff = weeklyOff;
    }

    // Try to get leave data
    try {
      // First check if employee_leaves table exists
      const [leaveTable] = await db.execute(`SHOW TABLES LIKE 'employee_leaves'`);
      
      if (leaveTable.length > 0) {
        const [leaveData] = await db.execute(`
          SELECT 
            COALESCE(SUM(total_leaves), 18) as total_leaves,
            COALESCE(SUM(used_leaves), 0) as used_leaves
          FROM employee_leaves 
          WHERE employee_id = (SELECT employee_id FROM users WHERE id = ?)
          AND year = ?
        `, [requestedUserId, currentYear]);

        if (leaveData.length > 0 && leaveData[0].total_leaves) {
          attendanceData.leaves.total = leaveData[0].total_leaves;
          attendanceData.leaves.used = leaveData[0].used_leaves;
          attendanceData.leaves.balance = leaveData[0].total_leaves - leaveData[0].used_leaves;
        }
      }
    } catch (leaveError) {
      // Leave table might not exist, use defaults
      console.log('Leave table not found, using defaults:', leaveError.message);
    }

    await db.end();

    return NextResponse.json({ 
      success: true, 
      data: attendanceData 
    });
  } catch (error) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch attendance data' 
    }, { status: 500 });
  }
}
