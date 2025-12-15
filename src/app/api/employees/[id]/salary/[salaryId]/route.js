import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';

// Helper to calculate salary breakdown (same as parent route)
function calculateSalaryBreakdown(input) {
  const map = (k1, k2) => (input[k1] !== undefined ? input[k1] : input[k2]);

  const grossSalary = Number(map('grossSalary', 'gross_salary')) || 0;
  const basicDA_in = Number(map('basicDA', 'basic_da'));
  const hra_in = Number(map('hra', 'hra'));
  const conveyance_in = Number(map('conveyanceAllowance', 'conveyance_allowance'));
  const otherAllowance_in = Number(map('otherAllowance', 'other_allowance')) || 0;

  const leaveDays = Number(map('leaveDays', 'leave_days') || map('absent_days','absent_days') || 0);
  const totalWorkingDays = Number(map('totalWorkingDays','total_working_days')) || 26;
  const otHours = Number(map('otHours','ot_hours')) || 0;
  const otRate = Number(map('otRate','ot_rate')) || 1;
  const totalWorkingHours = Number(map('totalWorkingHours','total_working_hours')) || 208;

  if (!grossSalary || grossSalary <= 0) return { error: 'Invalid or missing gross salary' };

  const netGrossForSplit = Math.max(0, grossSalary - otherAllowance_in);
  const defaultBasicDa = Math.round(netGrossForSplit * 0.7);
  const defaultHra = Math.round(netGrossForSplit * 0.2);
  const defaultConveyance = Math.round(netGrossForSplit * 0.1);

  const basicDA = (basicDA_in !== undefined && !isNaN(basicDA_in)) ? basicDA_in : defaultBasicDa;
  const hra = (hra_in !== undefined && !isNaN(hra_in)) ? hra_in : defaultHra;
  const conveyanceAllowance = (conveyance_in !== undefined && !isNaN(conveyance_in)) ? conveyance_in : defaultConveyance;

  const perDayRate = grossSalary / totalWorkingDays;
  const leaveDeduction = Math.round(perDayRate * leaveDays);
  const otPayPerHour = grossSalary / totalWorkingHours;
  const otPay = Math.round(otPayPerHour * otHours * otRate);
  const netGross = Math.max(0, grossSalary - leaveDeduction + otPay);

  const employeePF = Math.min(Math.round(basicDA * 0.12), 1800);
  const employerPF = Math.min(Math.round(basicDA * 0.13), 1950);
  const bonus = Math.round((basicDA * 8.33) / 100);
  const professionalTax = 200;
  const mlwfEmployee = 5;
  const mlwfEmployer = 13;
  const mediclaim = 500;
  const callAllowance = Number(map('callAllowance', 'call_allowance')) || 0;

  const employeeInHand = Math.round(Math.max(0, netGross + callAllowance - (employeePF + professionalTax + mlwfEmployee)));
  const employeeCTC = Math.round(netGross + callAllowance + employerPF + bonus + mlwfEmployer + mediclaim + Math.round(otherAllowance_in || 0));

  const weekOffs = Math.floor((totalWorkingDays || 26) / 7);
  const workingDays = Math.max(0, (totalWorkingDays || 26) - weekOffs);
  const paidDays = Math.max(0, workingDays - leaveDays);

  return {
    inputs: {
      gross_salary: Math.round(grossSalary),
      other_allowance: Math.round(otherAllowance_in),
      leave_days: leaveDays,
      total_working_days: totalWorkingDays,
      ot_hours: otHours,
      ot_rate: otRate
    },
    breakdown: {
      basic_da: Math.round(basicDA),
      hra: Math.round(hra),
      conveyance_allowance: Math.round(conveyanceAllowance),
      adjusted_gross: Math.round(netGross),
      leave_deduction: Math.round(leaveDeduction),
      ot_pay: Math.round(otPay),
      employee_pf: Math.round(employeePF),
      employer_pf: Math.round(employerPF),
      bonus: Math.round(bonus),
      professional_tax: professionalTax,
      mlwf_employee: mlwfEmployee,
      mlwf_employer: mlwfEmployer,
      mediclaim: mediclaim,
      in_hand_salary: Math.round(employeeInHand),
      employee_ctc: Math.round(employeeCTC),
      week_offs: weekOffs,
      working_days: workingDays,
      paid_days: paidDays,
    }
  };
}

// Update existing salary entry by salary id
export async function PUT(request, { params }) {
  try {
    const { id: employeeId, salaryId } = await params;
    if (!employeeId) return NextResponse.json({ success: false, error: 'Employee id required' }, { status: 400 });
    if (!salaryId) return NextResponse.json({ success: false, error: 'Salary record id required' }, { status: 400 });

    const body = await request.json();
    const db = await dbConnect();

    const computed = calculateSalaryBreakdown({
      grossSalary: body.gross_salary || body.grossSalary || 0,
      basicDA: body.da || body.basic_da,
      hra: body.hra,
      conveyanceAllowance: body.conveyance || body.conveyance_allowance,
      otherAllowance: body.other_allowance || body.otherAllowance || 0,
      leaveDays: body.absent_days || body.leave_days || 0,
      totalWorkingDays: body.total_working_days || body.totalWorkingDays || 26,
      otHours: body.ot_hours || body.otHours || 0,
      otRate: body.ot_rate || body.otRate || 1,
      totalWorkingHours: body.total_working_hours || body.totalWorkingHours || 208,
    });

    if (!computed || computed.error) {
      await db.end();
      return NextResponse.json({ success: false, error: computed?.error || 'Salary computation failed' }, { status: 400 });
    }

    // Build update set and params
    const updates = [];
    const paramsArr = [];
    const setField = (col, val) => { updates.push(`${col} = ?`); paramsArr.push(val); };

    // Allow updating some input fields but overwrite computed fields with authoritative values
    if (body.effective_from) { setField('effective_from', String(body.effective_from).slice(0,10)); }
    if (body.salary_type) setField('salary_type', body.salary_type);
    if (body.basic_salary !== undefined) setField('basic_salary', Number(body.basic_salary) || 0);
    if (body.attendance_days !== undefined) setField('attendance_days', Number(body.attendance_days) || 0);
    if (body.total_working_days !== undefined) setField('total_working_days', Number(body.total_working_days) || 26);
    if (body.loan_active !== undefined) setField('loan_active', body.loan_active ? 1 : 0);
    if (body.loan_emi !== undefined) setField('loan_emi', Number(body.loan_emi) || 0);
    if (body.advance_payment !== undefined) setField('advance_payment', Number(body.advance_payment) || 0);

    // Computed authoritative fields
    setField('da', computed.breakdown.basic_da);
    setField('hra', computed.breakdown.hra);
    setField('conveyance', computed.breakdown.conveyance_allowance);
    setField('other_allowance', computed.inputs.other_allowance);
    setField('gross_salary', computed.inputs.gross_salary);
    setField('leave_deduction', computed.breakdown.leave_deduction);
    setField('ot_pay', computed.breakdown.ot_pay);
    setField('adjusted_gross', computed.breakdown.adjusted_gross);
    setField('employee_pf', computed.breakdown.employee_pf);
    setField('employer_pf', computed.breakdown.employer_pf);
    setField('bonus', computed.breakdown.bonus);
    setField('in_hand_salary', computed.breakdown.in_hand_salary);
    setField('ctc', computed.breakdown.employee_ctc);
    setField('pl_used', Number(body.pl_used || 0));
    setField('pl_balance', Number(body.pl_balance || 0));
    setField('ot_hours', computed.inputs.ot_hours);
    setField('ot_rate', computed.inputs.ot_rate);
    setField('week_offs', computed.breakdown.week_offs);
    setField('working_days', computed.breakdown.working_days);
    setField('paid_days', computed.breakdown.paid_days);
    if (body.manual_overrides !== undefined) setField('manual_overrides', body.manual_overrides);

    if (updates.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    paramsArr.push(salaryId);
    const sql = `UPDATE salary_master SET ${updates.join(', ')} WHERE id = ? AND employee_id = ?`;
    paramsArr.push(employeeId);

    await db.execute(sql, paramsArr);
    await db.end();

    return NextResponse.json({ success: true, data: { id: salaryId, computed } });
  } catch (err) {
    console.error('PUT salary master error:', err);
    return NextResponse.json({ success: false, error: 'Failed to update salary master', details: err.message }, { status: 500 });
  }
}
