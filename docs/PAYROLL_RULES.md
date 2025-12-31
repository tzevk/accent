# Payroll Rules Configuration

## Overview
All payroll calculation rules are centralized in **`/src/utils/payroll-config.js`**. This ensures consistency across the application and makes updates easy.

## Salary Structure Rules (Frozen)

### Basic Salary Components

| Component | Calculation | Value |
|-----------|-------------|-------|
| **Basic + DA** | % of Gross Salary | **60%** |
| **HRA** | % of Gross Salary | **20%** |
| **Conveyance** | % of Gross Salary | **10%** |
| **Call Allowance** | % of Gross Salary | **10%** |
| **Other Allowances** | Optional | Variable |

### Provident Fund (PF)

| Type | Calculation | Rate |
|------|-------------|------|
| **Employee PF** | % of Gross (or Basic+DA) | **12%** |
| **Employer PF** | % of Gross (or Basic+DA) | **13%** |
| - EPF | % of wage base | 3.67% |
| - EPS | % of wage base (max ₹15,000) | 8.33% |
| - PF Admin | % of wage base | 0.5% |
| **Wage Ceiling** | Maximum base for PF | ₹15,000 |

### Employee State Insurance (ESIC)

| Type | Calculation | Rate |
|------|-------------|------|
| **Employee ESIC** | % of Gross Salary | **0.75%** |
| **Employer ESIC** | % of Gross Salary | **3.25%** |
| **Eligibility** | Gross salary must be | ≤ ₹21,000 |

### Other Statutory Contributions

| Component | Rate |
|-----------|------|
| **EDLI** | 0.5% of wage base |
| **EDLI Admin** | 0.01% of wage base |
| **Gratuity** | 4.81% of Basic (5+ years service) |

### Professional Tax (Maharashtra)

| Gross Salary Range | Tax Amount |
|-------------------|------------|
| > ₹10,000 | ₹200 |
| ₹7,501 - ₹10,000 | ₹175 |
| ₹5,001 - ₹7,500 | ₹150 |
| ≤ ₹5,000 | ₹0 |

## Working Standards

- **Standard Working Days**: 26 days/month
- **Standard Hours**: 8 hours/day
- **Overtime Multiplier**: 1.5x

## Usage

### Import the Configuration

```javascript
import PAYROLL_CONFIG from '@/utils/payroll-config';
```

### Access Constants

```javascript
// Get Basic+DA percentage
const basicPercent = PAYROLL_CONFIG.BASIC_DA_PERCENT; // 60

// Get HRA percentage
const hraPercent = PAYROLL_CONFIG.HRA_PERCENT; // 20

// Get Employee PF percentage
const empPF = PAYROLL_CONFIG.EMPLOYEE_PF_PERCENT; // 12

// Get Employer PF percentage
const empPF = PAYROLL_CONFIG.EMPLOYER_PF_PERCENT; // 13
```

### Helper Functions

#### Calculate Salary from Gross

```javascript
import { calculateSalaryFromGross } from '@/utils/payroll-config';

const breakdown = calculateSalaryFromGross(50000);
console.log(breakdown);
// {
//   gross: 50000,
//   basicDA: 30000,  // 60%
//   hra: 10000,      // 20%
//   conveyance: 5000, // 10%
//   callAllowance: 5000, // 10%
//   otherAllowances: 0
// }
```

#### Calculate PF

```javascript
import { calculatePF } from '@/utils/payroll-config';

const pfBreakdown = calculatePF(30000, true, '15000');
console.log(pfBreakdown);
// {
//   wageBase: 15000,
//   employeeContribution: 1800,  // 12% of 15000
//   employerEPF: 551,            // 3.67% of 15000
//   employerEPS: 1249,           // 8.33% of 15000
//   employerTotal: 1800,
//   pfAdmin: 75                  // 0.5% of 15000
// }
```

#### Calculate ESIC

```javascript
import { calculateESIC } from '@/utils/payroll-config';

const esicBreakdown = calculateESIC(20000, true);
console.log(esicBreakdown);
// {
//   eligible: true,
//   employeeContribution: 150,  // 0.75% of 20000
//   employerContribution: 650   // 3.25% of 20000
// }
```

#### Calculate Professional Tax

```javascript
import { calculateProfessionalTax } from '@/utils/payroll-config';

const pt = calculateProfessionalTax(15000); // Returns 200
```

## Calculation Examples

### Example 1: Monthly Salary Breakdown (Gross: ₹50,000)

```
Gross Salary:              ₹50,000
├── Basic + DA (60%):      ₹30,000
├── HRA (20%):             ₹10,000
├── Conveyance (10%):      ₹5,000
└── Call Allowance (10%):  ₹5,000

Employee Deductions:
├── PF (12% of 15k):       ₹1,800
├── ESIC (Not eligible):   ₹0
└── Professional Tax:      ₹200
    Total Deductions:      ₹2,000

Net Salary:                ₹48,000

Employer Contributions:
├── PF (13% of 15k):       ₹1,950
│   ├── EPF (3.67%):       ₹551
│   └── EPS (8.33%):       ₹1,249
├── PF Admin (0.5%):       ₹75
├── EDLI (0.5%):           ₹75
├── Gratuity (4.81%):      ₹1,443
└── ESIC (Not eligible):   ₹0
    Total:                 ₹3,543

Total CTC:                 ₹53,543
```

### Example 2: Monthly Salary Breakdown (Gross: ₹18,000 - ESIC Eligible)

```
Gross Salary:              ₹18,000
├── Basic + DA (60%):      ₹10,800
├── HRA (20%):             ₹3,600
├── Conveyance (10%):      ₹1,800
└── Call Allowance (10%):  ₹1,800

Employee Deductions:
├── PF (12% of 10.8k):     ₹1,296
├── ESIC (0.75%):          ₹135
└── Professional Tax:      ₹200
    Total Deductions:      ₹1,631

Net Salary:                ₹16,369

Employer Contributions:
├── PF (13% of 10.8k):     ₹1,404
├── ESIC (3.25%):          ₹585
├── PF Admin (0.5%):       ₹54
├── EDLI (0.5%):           ₹54
└── Gratuity (4.81%):      ₹519
    Total:                 ₹2,616

Total CTC:                 ₹20,616
```

## Modifying Rules

To change any payroll rule:

1. Open `/src/utils/payroll-config.js`
2. Update the constant value
3. The change will automatically apply across the entire application

### Example: Change HRA to 25%

```javascript
// In /src/utils/payroll-config.js
export const PAYROLL_CONFIG = {
  // ... other config
  HRA_PERCENT: 25,  // Changed from 20 to 25
  // ... rest of config
};
```

## Notes

- All percentages are calculated on **Gross Salary** unless specified otherwise
- PF calculations are capped at ₹15,000 wage base (configurable)
- ESIC is only applicable if gross salary ≤ ₹21,000
- Professional Tax rates are for Maharashtra (can be customized per state)
- Other Allowances can be added as optional components

## Files Using This Configuration

- `/src/app/employees/page.jsx` - Employee management & salary structure
- `/src/app/api/employees/[id]/salary-structure/route.js` - Salary structure API
- `/scripts/create-payroll-schema.js` - Database schema for payroll
- `/src/utils/payroll-config.js` - **Main configuration file**

---

**Last Updated**: December 31, 2025
