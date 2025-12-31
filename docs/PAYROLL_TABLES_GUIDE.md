# Core Payroll Tables - Complete Guide

## Overview

Three minimal, efficient tables for managing payroll:
1. **`da_schedule`** - DA amounts (changes every 6 months)
2. **`employee_salary_profile`** - Employee-specific salary data
3. **`payroll_slips`** - Monthly payroll snapshots (immutable)

## Table Schemas

### 1. DA Schedule Table

Tracks DA (Dearness Allowance) amounts that change every 6 months.

```sql
da_schedule (
  id INT PRIMARY KEY AUTO_INCREMENT,
  da_amount DECIMAL(10,2) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  remarks TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

**Usage:**
- Update DA every 6 months (January 1st & July 1st)
- Only one record should be `is_active = 1` at a time
- `effective_to` is NULL for current/future periods

**Example:**
```sql
INSERT INTO da_schedule (da_amount, effective_from, effective_to, is_active, remarks)
VALUES (0, '2025-07-01', '2025-12-31', 1, 'H2 2025 - Current Active');
```

### 2. Employee Salary Profile Table

Stores only what varies per employee (gross + other allowances). All percentages are calculated from these values using frozen PAYROLL_CONFIG rules.

```sql
employee_salary_profile (
  id INT PRIMARY KEY AUTO_INCREMENT,
  employee_id INT NOT NULL,
  gross DECIMAL(12,2) NOT NULL,
  other_allowances DECIMAL(10,2) DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to DATE DEFAULT NULL,
  is_active TINYINT(1) DEFAULT 1,
  pf_applicable TINYINT(1) DEFAULT 1,
  esic_applicable TINYINT(1) DEFAULT 1,
  remarks TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id)
)
```

**What's Calculated (NOT stored):**
- Basic + DA = 60% of Gross
- HRA = 20% of Gross
- Conveyance = 10% of Gross
- Call Allowance = 10% of Gross
- Employee PF = 12% of Gross
- Employer PF = 13% of Gross
- Employee ESIC = 0.75% of Gross
- Employer ESIC = 3.25% of Gross

**Example:**
```sql
INSERT INTO employee_salary_profile 
  (employee_id, gross, other_allowances, effective_from, is_active, pf_applicable, esic_applicable)
VALUES 
  (123, 50000, 0, '2025-01-01', 1, 1, 0);
```

### 3. Payroll Slips Table

Monthly snapshot results. **IMMUTABLE** - never modify after generation (audit trail).

```sql
payroll_slips (
  id INT PRIMARY KEY AUTO_INCREMENT,
  month DATE NOT NULL,
  employee_id INT NOT NULL,
  
  -- Earnings
  gross DECIMAL(12,2),
  da_used DECIMAL(10,2),
  basic DECIMAL(12,2),
  hra DECIMAL(12,2),
  conveyance DECIMAL(12,2),
  call_allowance DECIMAL(12,2),
  other_allowances DECIMAL(10,2),
  total_earnings DECIMAL(12,2),
  
  -- Employee Deductions
  pf_employee DECIMAL(10,2),
  esic_employee DECIMAL(10,2),
  pt DECIMAL(10,2),
  lwf DECIMAL(10,2),
  tds DECIMAL(10,2),
  other_deductions DECIMAL(10,2),
  total_deductions DECIMAL(12,2),
  
  -- Net Pay
  net_pay DECIMAL(12,2),
  
  -- Employer Contributions
  pf_employer DECIMAL(10,2),
  esic_employer DECIMAL(10,2),
  gratuity DECIMAL(10,2),
  pf_admin DECIMAL(10,2),
  edli DECIMAL(10,2),
  total_employer_contributions DECIMAL(12,2),
  
  -- Total CTC
  employer_cost DECIMAL(12,2),
  
  -- Payment Info
  payment_status ENUM('pending', 'processed', 'paid', 'hold'),
  payment_date DATE,
  payment_reference VARCHAR(100),
  remarks TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  
  UNIQUE KEY (month, employee_id)
)
```

## Setup Instructions

### Step 1: Create Tables

**Option A: Using Node.js Script**
```bash
node scripts/create-payroll-core-tables.js
```

**Option B: Using SQL File**
```bash
mysql -u username -p database_name < scripts/create-payroll-core-tables.sql
```

### Step 2: Configure DA Schedule

```sql
-- Set current DA (changes every 6 months)
INSERT INTO da_schedule (da_amount, effective_from, is_active, remarks)
VALUES (0, '2025-07-01', 1, 'H2 2025 - Active');
```

### Step 3: Create Employee Salary Profiles

```sql
-- Create salary profile for an employee
INSERT INTO employee_salary_profile 
  (employee_id, gross, other_allowances, effective_from, is_active)
VALUES 
  (1, 50000, 0, '2025-01-01', 1),
  (2, 35000, 1000, '2025-01-01', 1),
  (3, 18000, 0, '2025-01-01', 1);
```

## API Endpoints

### DA Schedule Management

**GET** `/api/payroll/da-schedule`
- Fetch all DA schedule entries

**POST** `/api/payroll/da-schedule`
```json
{
  "da_amount": 0,
  "effective_from": "2026-01-01",
  "effective_to": "2026-06-30",
  "is_active": false,
  "remarks": "H1 2026"
}
```

**PUT** `/api/payroll/da-schedule`
```json
{
  "id": 5,
  "is_active": true
}
```

**DELETE** `/api/payroll/da-schedule?id=5`

---

### Payroll Generation

**POST** `/api/payroll/generate`

**Generate for single employee:**
```json
{
  "employee_id": 123,
  "month": "2025-12-01"
}
```

**Preview calculation (without saving):**
```json
{
  "employee_id": 123,
  "month": "2025-12-01",
  "preview": true
}
```

**Generate for all employees:**
```json
{
  "month": "2025-12-01",
  "all": true
}
```

Response:
```json
{
  "success": true,
  "results": {
    "month": "2025-12-01",
    "total": 50,
    "success": 48,
    "failed": 0,
    "skipped": 2,
    "errors": []
  }
}
```

---

### Payroll Slips Management

**GET** `/api/payroll/slips`
- Query params: `month`, `employee_id`, `payment_status`

```
GET /api/payroll/slips?month=2025-12-01
GET /api/payroll/slips?employee_id=123
GET /api/payroll/slips?payment_status=pending
```

**PUT** `/api/payroll/slips`
- Update payment status only (slip data is immutable)

```json
{
  "id": 456,
  "payment_status": "paid",
  "payment_date": "2025-12-28",
  "payment_reference": "TXN123456"
}
```

## Utility Functions

### Import Functions

```javascript
import {
  getCurrentDA,
  getEmployeeSalaryProfile,
  calculateEmployeePayroll,
  generatePayrollSlip,
  generateMonthlyPayroll
} from '@/utils/payroll-calculator';
```

### Get Current DA

```javascript
const daAmount = await getCurrentDA(new Date('2025-12-01'));
console.log(daAmount); // 0
```

### Get Employee Salary Profile

```javascript
const profile = await getEmployeeSalaryProfile(123, new Date('2025-12-01'));
console.log(profile);
// {
//   employee_id: 123,
//   gross: 50000,
//   other_allowances: 0,
//   effective_from: '2025-01-01',
//   pf_applicable: 1,
//   esic_applicable: 0
// }
```

### Calculate Payroll (Preview)

```javascript
const payroll = await calculateEmployeePayroll(123, '2025-12-01');
console.log(payroll);
// Returns complete breakdown without saving
```

### Generate Payroll Slip

```javascript
const slip = await generatePayrollSlip(123, '2025-12-01');
console.log(slip);
// Generates and saves slip, returns created record
```

### Generate Monthly Payroll

```javascript
const results = await generateMonthlyPayroll('2025-12-01');
console.log(results);
// {
//   month: '2025-12-01',
//   total: 50,
//   success: 48,
//   failed: 0,
//   skipped: 2
// }
```

## Monthly Workflow

### 1. End of Month - Generate Payroll

```bash
# Preview payroll for all employees
curl -X POST http://localhost:3000/api/payroll/generate \
  -H "Content-Type: application/json" \
  -d '{"month": "2025-12-01", "all": true}'

# Or use Node.js
node -e "
  const { generateMonthlyPayroll } = require('./src/utils/payroll-calculator');
  generateMonthlyPayroll('2025-12-01').then(console.log);
"
```

### 2. Review Generated Slips

```sql
-- View all pending slips for current month
SELECT * FROM payroll_slips 
WHERE month = '2025-12-01' 
  AND payment_status = 'pending'
ORDER BY employee_id;
```

### 3. Mark as Paid

```javascript
// Update payment status after bank transfer
await fetch('/api/payroll/slips', {
  method: 'PUT',
  body: JSON.stringify({
    id: 456,
    payment_status: 'paid',
    payment_date: '2025-12-28',
    payment_reference: 'NEFT123456'
  })
});
```

## Salary Changes

### When Employee Salary Changes

```sql
-- 1. Deactivate current profile
UPDATE employee_salary_profile 
SET is_active = 0, effective_to = '2025-12-31'
WHERE employee_id = 123 AND is_active = 1;

-- 2. Create new profile
INSERT INTO employee_salary_profile 
  (employee_id, gross, other_allowances, effective_from, is_active)
VALUES 
  (123, 55000, 0, '2026-01-01', 1);
```

### When DA Changes (Every 6 Months)

```sql
-- 1. Deactivate current DA
UPDATE da_schedule SET is_active = 0 WHERE is_active = 1;

-- 2. Activate new DA
UPDATE da_schedule 
SET is_active = 1 
WHERE effective_from = '2026-01-01';
```

## Example Calculations

### Employee with ₹50,000 Gross

```
EARNINGS:
  Gross:                    ₹50,000
  ├─ Basic+DA (60%):        ₹30,000
  ├─ HRA (20%):             ₹10,000
  ├─ Conveyance (10%):      ₹5,000
  └─ Call Allowance (10%):  ₹5,000
  Total Earnings:           ₹50,000

DEDUCTIONS:
  ├─ PF (12% of ₹15k):      ₹1,800
  ├─ ESIC:                  ₹0 (not eligible)
  └─ PT:                    ₹200
  Total Deductions:         ₹2,000

NET PAY:                    ₹48,000

EMPLOYER CONTRIBUTIONS:
  ├─ PF (13% of ₹15k):      ₹1,950
  ├─ Gratuity (4.81%):      ₹1,443
  ├─ PF Admin (0.5%):       ₹75
  └─ EDLI (0.5%):           ₹75
  Total:                    ₹3,543

TOTAL CTC:                  ₹53,543/month
```

## Important Notes

1. **Immutable History**: Once payroll slip is generated, DO NOT modify salary components
2. **Only Update Payment**: Only payment_status, payment_date, and payment_reference can be updated
3. **UNIQUE Constraint**: Cannot generate duplicate slips for same employee + month
4. **Frozen Rules**: All percentages come from `/src/utils/payroll-config.js`
5. **DA Updates**: Remember to update DA every 6 months
6. **Salary Profiles**: Create new profile when salary changes, don't update existing

## Database Queries

### Get Current Active DA
```sql
SELECT da_amount 
FROM da_schedule 
WHERE is_active = 1 
  AND CURDATE() BETWEEN effective_from AND COALESCE(effective_to, '9999-12-31');
```

### Get Employee's Current Salary
```sql
SELECT * 
FROM employee_salary_profile 
WHERE employee_id = 123 
  AND is_active = 1 
  AND CURDATE() >= effective_from 
  AND (effective_to IS NULL OR CURDATE() <= effective_to);
```

### Get Unpaid Slips
```sql
SELECT ps.*, e.name, e.employee_code
FROM payroll_slips ps
JOIN employees e ON e.id = ps.employee_id
WHERE payment_status = 'pending'
ORDER BY month DESC, employee_id;
```

### Monthly Payroll Summary
```sql
SELECT 
  month,
  COUNT(*) as total_employees,
  SUM(gross) as total_gross,
  SUM(net_pay) as total_net_pay,
  SUM(employer_cost) as total_ctc,
  SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count,
  SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END) as pending_count
FROM payroll_slips
WHERE month = '2025-12-01'
GROUP BY month;
```

---

**Last Updated**: December 31, 2025
