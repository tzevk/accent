import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { randomUUID } from 'crypto';

function computeSalary(payload) {
  const {
    salary_type = 'Monthly',
    basic_salary = 0,
    attendance_days = 0,
    total_working_days = 26,
    loan_active = 0,
    loan_emi = 0,
    advance_payment = 0,
    additional_earnings = 0,
    additional_deductions = 0,
    pf: pf_input,
    pt: pt_input,
    mlwf: mlwf_input,
    da: da_input,
    hra: hra_input,
    conveyance: conveyance_input,
    call_allowance: call_allowance_input,
    other_allowance: other_allowance_input,
    effective_from,
  } = payload || {};

  const basic = Number(basic_salary) || 0;
  const attendance = Number(attendance_days) || 0;
  const workingDays = Number(total_working_days) || 0;
  const emi = Number(loan_active ? loan_emi : 0) || 0;
  const adv = Number(advance_payment) || 0;
  const now = new Date();

  // Earnings (allow override if provided)
  const def_da = basic * 0.10;
  const def_hra = basic * 0.40;
  const def_conveyance = 1500;
  const def_callAllowance = String(salary_type).toLowerCase() === 'monthly' ? 1500 : 0;
  const def_otherAllowance = basic > 40000 ? 2000 : 1000;

  const da = Number(da_input);
  const daFinal = Number.isFinite(da) && da >= 0 ? da : def_da;
  const hra = Number(hra_input);
  const hraFinal = Number.isFinite(hra) && hra >= 0 ? hra : def_hra;
  const conveyance = Number(conveyance_input);
  const conveyanceFinal = Number.isFinite(conveyance) && conveyance >= 0 ? conveyance : def_conveyance;
  const callAllowance = Number(call_allowance_input);
  const callAllowanceFinal = Number.isFinite(callAllowance) && callAllowance >= 0 ? callAllowance : def_callAllowance;
  const otherAllowance = Number(other_allowance_input);
  const otherAllowanceFinal = Number.isFinite(otherAllowance) && otherAllowance >= 0 ? otherAllowance : def_otherAllowance;
  const addEarn = Number(additional_earnings) || 0;
  const gross = basic + daFinal + hraFinal + conveyanceFinal + callAllowanceFinal + otherAllowanceFinal + addEarn;

  // Deductions
  const pf = Number(pf_input);
  const pfFinal = Number.isFinite(pf) && pf >= 0 ? pf : Math.min(15000, basic) * 0.12; // default capped at 1800
  const pt = Number(pt_input);
  const ptFinal = Number.isFinite(pt) && pt >= 0 ? pt : (gross > 7500 ? 200 : 0);
  const mlwf = Number(mlwf_input);
  const mlwfFinal = Number.isFinite(mlwf) && mlwf >= 0 ? mlwf : ((now.getMonth() + 1) === 6 ? 10 : 0);
  const addDed = Number(additional_deductions) || 0;
  const totalDeductions = pfFinal + ptFinal + mlwfFinal + addDed;
  const netSalary = gross - totalDeductions;

  // Attendance-linked
  const absentDays = Math.max(0, workingDays - attendance);
  const payablePct = workingDays > 0 ? attendance / workingDays : 0;
  const monthlySalary = netSalary * payablePct;
  const hourlySalary = String(salary_type).toLowerCase() === 'hourly' && workingDays > 0 ? monthlySalary / (workingDays * 8) : 0;
  const annualSalary = monthlySalary * 12;
  const tds = annualSalary > 500000 ? annualSalary * 0.05 : 0;
  const tdsMonthly = tds / 12;
  const finalPayable = monthlySalary - (emi + adv + tdsMonthly);

  return {
    inputs: {
      salary_type,
      basic_salary: basic,
      attendance_days: attendance,
      total_working_days: workingDays,
      loan_active: loan_active ? 1 : 0,
      loan_emi: emi,
      advance_payment: adv,
      effective_from: effective_from || null,
    },
  earnings: { da: daFinal, hra: hraFinal, conveyance: conveyanceFinal, call_allowance: callAllowanceFinal, other_allowance: otherAllowanceFinal, additional_earnings: addEarn, gross },
  deductions: { pf: pfFinal, pt: ptFinal, mlwf: mlwfFinal, additional_deductions: addDed, total_deductions: totalDeductions },
    attendance: { absent_days: absentDays, payable_days_pct: payablePct },
    summary: { net_salary: netSalary, monthly_salary: monthlySalary, hourly_salary: hourlySalary, annual_salary: annualSalary, tds, tds_monthly: tdsMonthly, final_payable: finalPayable },
  };
}

async function ensureTable(db) {
  await db.execute(`CREATE TABLE IF NOT EXISTS salary_master (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    effective_from DATE NOT NULL,
    salary_type VARCHAR(20) DEFAULT 'Monthly',
    basic_salary DECIMAL(12,2) DEFAULT 0,
    attendance_days INT DEFAULT 0,
    total_working_days INT DEFAULT 26,
    loan_active TINYINT DEFAULT 0,
    loan_emi DECIMAL(12,2) DEFAULT 0,
    advance_payment DECIMAL(12,2) DEFAULT 0,
    additional_earnings DECIMAL(12,2) DEFAULT 0,
    additional_deductions DECIMAL(12,2) DEFAULT 0,
    pf DECIMAL(12,2) DEFAULT 0,
    pt DECIMAL(12,2) DEFAULT 0,
    mlwf DECIMAL(12,2) DEFAULT 0,
    da DECIMAL(12,2) DEFAULT NULL,
    hra DECIMAL(12,2) DEFAULT NULL,
    conveyance DECIMAL(12,2) DEFAULT NULL,
    call_allowance DECIMAL(12,2) DEFAULT NULL,
    other_allowance DECIMAL(12,2) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (employee_id),
    INDEX (effective_from)
  )`);
  // Ensure new columns exist for older databases
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS pf DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS pt DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS mlwf DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS da DECIMAL(12,2) DEFAULT NULL`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS hra DECIMAL(12,2) DEFAULT NULL`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS conveyance DECIMAL(12,2) DEFAULT NULL`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS call_allowance DECIMAL(12,2) DEFAULT NULL`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS other_allowance DECIMAL(12,2) DEFAULT NULL`);
}

export async function GET(request, { params }) {
  try {
    const { id: employeeId } = await params;
    if (!employeeId) return NextResponse.json({ success: false, error: 'Employee id required' }, { status: 400 });
    const db = await dbConnect();
    await ensureTable(db);
    const [rows] = await db.execute(
      'SELECT * FROM salary_master WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1',
      [employeeId]
    );
    await db.end();
    if (!rows || rows.length === 0) return NextResponse.json({ success: true, data: null });
    const result = computeSalary(rows[0]);
    return NextResponse.json({ success: true, data: { record: rows[0], computed: result } });
  } catch (error) {
    console.error('GET salary master error:', error);
    return NextResponse.json({ success: false, error: 'Failed to get salary master', details: error.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id: employeeId } = await params;
    if (!employeeId) return NextResponse.json({ success: false, error: 'Employee id required' }, { status: 400 });
    const body = await request.json();
    const {
      salary_type = 'Monthly',
      basic_salary = 0,
      attendance_days = 0,
      total_working_days = 26,
      loan_active = 0,
      loan_emi = 0,
      advance_payment = 0,
      additional_earnings = 0,
      additional_deductions = 0,
      pf = 0,
      pt = 0,
      mlwf = 0,
      da = null,
      hra = null,
      conveyance = null,
      call_allowance = null,
      other_allowance = null,
      effective_from,
    } = body || {};

    if (!effective_from) {
      return NextResponse.json({ success: false, error: 'Effective From date is required' }, { status: 400 });
    }

    const id = randomUUID();
    const db = await dbConnect();
    await ensureTable(db);
    await db.execute(
      `INSERT INTO salary_master (id, employee_id, effective_from, salary_type, basic_salary, attendance_days, total_working_days, loan_active, loan_emi, advance_payment, additional_earnings, additional_deductions, pf, pt, mlwf, da, hra, conveyance, call_allowance, other_allowance)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
      [id, employeeId, String(effective_from).slice(0,10), salary_type, basic_salary, attendance_days, total_working_days, loan_active ? 1 : 0, loan_emi, advance_payment, additional_earnings, additional_deductions, pf, pt, mlwf, da, hra, conveyance, call_allowance, other_allowance]
    );
    await db.end();

  const computed = computeSalary({ salary_type, basic_salary, attendance_days, total_working_days, loan_active, loan_emi, advance_payment, additional_earnings, additional_deductions, pf, pt, mlwf, da, hra, conveyance, call_allowance, other_allowance, effective_from });
    return NextResponse.json({ success: true, data: { id, computed } }, { status: 201 });
  } catch (error) {
    console.error('POST salary master error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save salary master', details: error.message }, { status: 500 });
  }
}
