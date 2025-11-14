import { NextResponse } from 'next/server';
import { dbConnect } from '@/utils/database';
import { randomUUID } from 'crypto';

// Helper to detect primary key column for employees table
async function detectEmployeePrimaryKey(db) {
  try {
    const [pkRows] = await db.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND CONSTRAINT_NAME = 'PRIMARY'`
    );
    if (pkRows && pkRows.length > 0 && pkRows[0].COLUMN_NAME) {
      return pkRows[0].COLUMN_NAME;
    }
  } catch (err) {
    console.warn('Could not detect employees primary key:', err.message);
  }
  return 'id'; // Default fallback
}

// Calculate salary breakdown server-side according to authoritative rules.
function calculateSalaryBreakdown(input) {
  // Accept both camelCase and snake_case keys
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

  // Validation
  if ([grossSalary, otherAllowance_in, leaveDays, totalWorkingDays, otHours, otRate, totalWorkingHours].some(v => Number.isNaN(Number(v)))) {
    return { error: 'Invalid numeric input' };
  }
  if (grossSalary < 0 || otherAllowance_in < 0 || leaveDays < 0 || totalWorkingDays <= 0 || otHours < 0 || otRate < 0 || totalWorkingHours <= 0) {
    return { error: 'Negative values are not allowed' };
  }
  if (leaveDays > totalWorkingDays) {
    return { error: 'Leave days cannot exceed total working days' };
  }

  // Base splits
  let basicDA = 0;
  let hra = 0;
  let conveyance = 0;

  const gross = Math.round(grossSalary);

  if (otherAllowance_in <= 0) {
    basicDA = Math.round(0.6 * gross);
    hra = Math.round(0.2 * gross);
    conveyance = Math.round(0.1 * gross);
  } else {
    const remainder = Math.max(0, gross - Math.round(otherAllowance_in));
    basicDA = Math.round(0.6 * remainder);
    hra = Math.round(0.2 * remainder);
    conveyance = Math.round(0.1 * remainder);
  }

  // If frontend provided manual overrides for components, allow them but still validate non-negative
  if (Number.isFinite(basicDA_in) && basicDA_in >= 0) basicDA = Math.round(basicDA_in);
  if (Number.isFinite(hra_in) && hra_in >= 0) hra = Math.round(hra_in);
  if (Number.isFinite(conveyance_in) && conveyance_in >= 0) conveyance = Math.round(conveyance_in);

  // Leave deduction
  const leaveDeduction = Math.round((gross / totalWorkingDays) * leaveDays);
  // Overtime
  const otPay = Math.round((gross / totalWorkingHours) * otHours * otRate);

  let netGross = Math.round(Math.max(0, gross - leaveDeduction + otPay));

  // Dependent calculations
  const employeePF = Math.min(Math.round(basicDA * 0.12), 1800);
  const employerPF = Math.min(Math.round(basicDA * 0.13), 1950);
  const bonus = Math.round((basicDA * 8.33) / 100);
  const professionalTax = 200;
  const mlwfEmployee = 5;
  const mlwfEmployer = 13;
  const mediclaim = 500;

  // Final derived fields
  const employeeInHand = Math.round(Math.max(0, netGross - (employeePF + professionalTax + mlwfEmployee)));
  const employeeCTC = Math.round(netGross + employerPF + bonus + mlwfEmployer + mediclaim + Math.round(otherAllowance_in || 0));

  // Attendance derived (simple heuristics)
  const weekOffs = Math.floor((totalWorkingDays || 26) / 7);
  const workingDays = Math.max(0, (totalWorkingDays || 26) - weekOffs);
  const paidDays = Math.max(0, workingDays - leaveDays);

  return {
    inputs: {
      gross_salary: gross,
      other_allowance: Math.round(otherAllowance_in || 0),
      leave_days: Math.round(leaveDays),
      total_working_days: Math.round(totalWorkingDays),
      ot_hours: Math.round(otHours),
      ot_rate: Number(otRate),
      total_working_hours: Math.round(totalWorkingHours),
    },
    breakdown: {
      basic_da: Math.round(basicDA),
      hra: Math.round(hra),
      conveyance_allowance: Math.round(conveyance),
      leave_deduction: Math.round(leaveDeduction),
      ot_pay: Math.round(otPay),
      adjusted_gross: Math.round(netGross),
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
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS gross_salary DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS leave_deduction DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS ot_pay DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS adjusted_gross DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS employee_pf DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS employer_pf DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS bonus DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS in_hand_salary DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS ctc DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS pl_used DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS pl_balance DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS ot_hours DECIMAL(12,2) DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS ot_rate DECIMAL(12,2) DEFAULT 1`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS week_offs INT DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS working_days INT DEFAULT 0`);
  await db.execute(`ALTER TABLE salary_master ADD COLUMN IF NOT EXISTS paid_days INT DEFAULT 0`);
}

export async function GET(request, { params }) {
  try {
    const { id: employeeId } = await params;
    if (!employeeId) return NextResponse.json({ success: false, error: 'Employee id required' }, { status: 400 });
    const db = await dbConnect();
    await ensureTable(db);
    const pkCol = await detectEmployeePrimaryKey(db);
    const [rows] = await db.execute(
      'SELECT * FROM salary_master WHERE employee_id = ? ORDER BY effective_from DESC LIMIT 1',
      [employeeId]
    );
    await db.end();
    if (!rows || rows.length === 0) {
      console.debug('[salary-api] GET: no persisted rows for employee', employeeId);
      // Try to compute from employee master record if available (gross or salary_structure)
      try {
        const [empRows] = await db.execute(`SELECT gross_salary, salary_structure FROM employees WHERE ${pkCol} = ? LIMIT 1`, [employeeId]);
        if (empRows && empRows.length > 0) {
          const emp = empRows[0];
          let grossFromEmp = null;
          let otherAllowanceFromEmp = 0;
          // salary_structure may be JSON with parts; try to extract gross or sum parts
          if (emp.salary_structure) {
            try {
              const ss = typeof emp.salary_structure === 'string' ? JSON.parse(emp.salary_structure) : emp.salary_structure;
              // If salary_structure contains a gross-like field, use it; otherwise sum known parts
              if (ss.gross_salary || ss.gross) grossFromEmp = Number(ss.gross_salary || ss.gross) || null;
              else {
                const parts = ['basic_salary','hra','conveyance','medical_allowance','special_allowance','incentives'];
                const sum = parts.reduce((s, k) => s + (Number(ss[k] || 0) || 0), 0);
                if (sum > 0) grossFromEmp = Math.round(sum);
                otherAllowanceFromEmp = Number(ss.other_allowance || ss.other || 0) || 0;
              }
            } catch (e) {
              console.debug('[salary-api] failed to parse salary_structure for employee', employeeId, e.message);
            }
          }
          if (emp.gross_salary && (!grossFromEmp)) grossFromEmp = Number(emp.gross_salary) || null;
          if (grossFromEmp) {
            const computed = calculateSalaryBreakdown({ grossSalary: grossFromEmp, otherAllowance: otherAllowanceFromEmp });
            if (computed && !computed.error) {
              const fakeRecord = {
                effective_from: null,
                gross_salary: computed.inputs?.gross_salary ?? grossFromEmp,
                da: computed.breakdown?.basic_da,
                hra: computed.breakdown?.hra,
                conveyance: computed.breakdown?.conveyance_allowance,
                other_allowance: computed.inputs?.other_allowance ?? otherAllowanceFromEmp
              };
              console.debug('[salary-api] GET: computed from employee master for', employeeId, { fakeRecord, computed });
              await db.end();
              return NextResponse.json({ success: true, data: { record: null, computed, derived_from_employee: true, employee: { id: employeeId } } });
            }
          }
        }
      } catch (e) {
        console.error('[salary-api] GET: error while attempting compute from employee master', employeeId, e.message);
      }

      return NextResponse.json({ success: true, data: null });
    }
    const result = calculateSalaryBreakdown(rows[0]);
    if (result && result.error) {
      console.error('[salary-api] GET: computation error for employee', employeeId, result.error);
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    console.debug('[salary-api] GET: returning record and computed for employee', employeeId, { record: rows[0], computed: result });
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
      effective_from,
    } = body || {};

    if (!effective_from) {
      return NextResponse.json({ success: false, error: 'Effective From date is required' }, { status: 400 });
    }

    const id = randomUUID();
    const db = await dbConnect();
    await ensureTable(db);
    const pkCol = await detectEmployeePrimaryKey(db);
    // Ensure employees table has columns we may update here (best-effort, ignore errors)
    try {
      await db.execute('ALTER TABLE employees ADD COLUMN salary_structure TEXT');
  } catch { /* ignore - column may already exist or ALTER not supported */ }
    try {
      await db.execute('ALTER TABLE employees ADD COLUMN gross_salary DECIMAL(12,2)');
  } catch { /* ignore */ }
    try {
      await db.execute('ALTER TABLE employees ADD COLUMN total_deductions DECIMAL(12,2)');
  } catch { /* ignore */ }
    try {
      await db.execute('ALTER TABLE employees ADD COLUMN net_salary DECIMAL(12,2)');
  } catch { /* ignore */ }

    // Recompute authoritative salary breakdown server-side
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

    // Flatten values for insert (use provided inputs where sensible, but saved computed fields are authoritative)
    const ins = {
      id,
      employee_id: employeeId,
      effective_from: String(effective_from).slice(0,10),
      salary_type,
      basic_salary: Number(basic_salary) || 0,
      attendance_days: Number(attendance_days) || 0,
      total_working_days: Number(total_working_days) || 26,
      loan_active: loan_active ? 1 : 0,
      loan_emi: Number(loan_emi) || 0,
      advance_payment: Number(advance_payment) || 0,
      additional_earnings: Number(additional_earnings) || 0,
      additional_deductions: Number(additional_deductions) || 0,
      pf: Number(pf) || 0,
      pt: Number(pt) || 0,
      mlwf: Number(mlwf) || 0,
      da: computed.breakdown.basic_da,
      hra: computed.breakdown.hra,
      conveyance: computed.breakdown.conveyance_allowance,
      call_allowance: body.call_allowance || null,
      other_allowance: computed.inputs.other_allowance,
      gross_salary: computed.inputs.gross_salary,
      leave_deduction: computed.breakdown.leave_deduction,
      ot_pay: computed.breakdown.ot_pay,
      adjusted_gross: computed.breakdown.adjusted_gross,
      employee_pf: computed.breakdown.employee_pf,
      employer_pf: computed.breakdown.employer_pf,
      bonus: computed.breakdown.bonus,
      in_hand_salary: computed.breakdown.in_hand_salary,
      ctc: computed.breakdown.employee_ctc,
      pl_used: Number(body.pl_used || 0),
      pl_balance: Number(body.pl_balance || 0),
      ot_hours: computed.inputs.ot_hours,
      ot_rate: computed.inputs.ot_rate,
      week_offs: computed.breakdown.week_offs,
      working_days: computed.breakdown.working_days,
      paid_days: computed.breakdown.paid_days,
    };

    // Perform insert + optional employees update inside a transaction so both succeed or both fail
    try {
      await db.beginTransaction();

      await db.execute(
        `INSERT INTO salary_master (
          id, employee_id, effective_from, salary_type, basic_salary, attendance_days, total_working_days, loan_active, loan_emi, advance_payment,
          additional_earnings, additional_deductions, pf, pt, mlwf, da, hra, conveyance, call_allowance, other_allowance,
          gross_salary, leave_deduction, ot_pay, adjusted_gross, employee_pf, employer_pf, bonus, in_hand_salary, ctc, pl_used, pl_balance,
          ot_hours, ot_rate, week_offs, working_days, paid_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
        [
          ins.id, ins.employee_id, ins.effective_from, ins.salary_type, ins.basic_salary, ins.attendance_days, ins.total_working_days, ins.loan_active, ins.loan_emi, ins.advance_payment,
          ins.additional_earnings, ins.additional_deductions, ins.pf, ins.pt, ins.mlwf, ins.da, ins.hra, ins.conveyance, ins.call_allowance, ins.other_allowance,
          ins.gross_salary, ins.leave_deduction, ins.ot_pay, ins.adjusted_gross, ins.employee_pf, ins.employer_pf, ins.bonus, ins.in_hand_salary, ins.ctc, ins.pl_used, ins.pl_balance,
          ins.ot_hours, ins.ot_rate, ins.week_offs, ins.working_days, ins.paid_days
        ]
      );

      // Prepare employee update fields: prefer explicit salary_structure from request, else persist computed summary
      const empUpdates = [];
      const empParams = [];
      if (body && body.salary_structure) {
        empUpdates.push('salary_structure = ?');
        empParams.push(body.salary_structure);
      }
      // Persist computed gross/net/deductions to employee master for quick access in UI
      if (ins.gross_salary !== undefined && ins.gross_salary !== null) {
        empUpdates.push('gross_salary = ?');
        empParams.push(ins.gross_salary);
      }
      if (ins.other_allowance !== undefined && ins.other_allowance !== null) {
        // treat other_allowance as total_deductions if no explicit total_deductions provided
        empUpdates.push('total_deductions = ?');
        empParams.push(ins.other_allowance);
      }
      if (ins.in_hand_salary !== undefined && ins.in_hand_salary !== null) {
        empUpdates.push('net_salary = ?');
        empParams.push(ins.in_hand_salary);
      }

      if (empUpdates.length > 0) {
        empParams.push(employeeId);
        console.debug('[salary-api] POST: updating employees table with', empUpdates);
        const [updateRes] = await db.execute(`UPDATE employees SET ${empUpdates.join(', ')} WHERE ${pkCol} = ?`, empParams);
        console.debug('[salary-api] POST: employees update result', updateRes && updateRes.affectedRows ? updateRes.affectedRows : updateRes);
        // If update didn't affect any row, rollback and surface an error to help debugging invisible writes
        if (!updateRes || (typeof updateRes.affectedRows === 'number' && updateRes.affectedRows === 0)) {
          try { await db.rollback(); } catch {}
          try { await db.end(); } catch {}
          console.error('[salary-api] POST: employees update affected 0 rows - rolling back transaction');
          return NextResponse.json({ success: false, error: 'Failed to persist employee salary snapshot (no rows updated). Transaction rolled back.' }, { status: 500 });
        }
      }

      await db.commit();
      // Verify persisted salary_structure for visibility on refresh
      try {
        const [empCheck] = await db.execute(`SELECT salary_structure, gross_salary, total_deductions, net_salary FROM employees WHERE ${pkCol} = ? LIMIT 1`, [employeeId]);
        await db.end();
        const persisted = empCheck && empCheck[0] ? empCheck[0] : null;
        console.debug('[salary-api] POST: persisted employee salary snapshot', persisted);
        return NextResponse.json({ success: true, data: { id, computed, persisted } }, { status: 201 });
      } catch (checkErr) {
        try { await db.end(); } catch {}
        console.warn('[salary-api] POST: verification query failed', checkErr?.message || checkErr);
        return NextResponse.json({ success: true, data: { id, computed } }, { status: 201 });
      }
    } catch (txErr) {
      try { await db.rollback(); } catch { /* ignore rollback errors */ }
      try { await db.end(); } catch { /* ignore */ }
      console.error('Transaction failed for salary master POST:', txErr);
      return NextResponse.json({ success: false, error: 'Failed to save salary master (transaction rolled back)', details: txErr?.message }, { status: 500 });
    }
  } catch (error) {
    console.error('POST salary master error:', error);
    return NextResponse.json({ success: false, error: 'Failed to save salary master', details: error.message }, { status: 500 });
  }
}

// Update existing salary entry by salary id (body.id) - recompute server-side and persist
export async function PUT(request, { params }) {
  try {
    const { id: employeeId } = await params;
    if (!employeeId) return NextResponse.json({ success: false, error: 'Employee id required' }, { status: 400 });
    const body = await request.json();
    const salaryId = body.id || body.salary_id;
    if (!salaryId) return NextResponse.json({ success: false, error: 'Salary record id required in body.id' }, { status: 400 });

    const db = await dbConnect();
    await ensureTable(db);

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

    if (updates.length === 0) {
      await db.end();
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    paramsArr.push(salaryId);
    const sql = `UPDATE salary_master SET ${updates.join(', ')} WHERE id = ? AND employee_id = ?`;
    // ensure we also check employee id to avoid accidental cross-updates
    paramsArr.push(employeeId);

    await db.execute(sql, paramsArr);
    await db.end();

    return NextResponse.json({ success: true, data: { id: salaryId, computed } });
  } catch (err) {
    console.error('PUT salary master error:', err);
    return NextResponse.json({ success: false, error: 'Failed to update salary master', details: err.message }, { status: 500 });
  }
}
