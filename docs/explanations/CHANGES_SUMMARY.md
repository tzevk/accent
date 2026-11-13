# Changes Summary - Remove Hard-Coded User Access

> **Historical change log — dated 2026-03-05** (committed 2026-03-06). Describes the state at that
> date; paths may have moved since. Part of the [documentation index](../README.md) (audit records).

## Overview

Removed all hard-coded references to "Rajesh Panchal" and replaced them with proper super admin permission checks using the `is_super_admin` flag in the database. This allows any user to be promoted to super admin with full system access.

## Files Modified

### 1. Frontend Components

#### `/src/app/reports/project-activities/page.jsx`

**Changes:**

- Removed `isRajeshPanchal` constant
- Updated access check to use only `isSuperAdmin` and `hasReportsPermission`
- Updated all UI conditional rendering from `isRajeshPanchal` to `isSuperAdmin`
- Super admins can now edit project activities and daily entries
- Super admins see debug options

**Impact:**

- Any super admin can now access project activities report
- Any super admin can edit project activity entries
- No longer restricted to a specific username

#### `/src/components/Navbar.jsx`

**Changes:**

- Removed `isRajeshPanchal` check from reports menu filtering
- Simplified logic to rely on `user.is_super_admin` and RBAC permissions

**Impact:**

- Reports menu items now shown based purely on super admin status or permissions
- No special case for specific usernames

#### `/src/app/projects/page.jsx`

**Changes:**

- Removed `PROJECTS_ADMIN_NAME` constant
- Changed `isProjectAdmin` logic from username check to `is_super_admin` check only

**Impact:**

- Any super admin can view, edit, and delete all projects
- Project access no longer tied to specific username

### 2. API Routes

#### `/src/app/api/reports/project-activities/route.js`

**Changes:**

- Removed `isRajeshPanchal` permission check
- Updated comment and logic to check only `isSuperAdmin` or `hasReportsPermission`
- Updated debug logging to remove Rajesh reference

**Impact:**

- API now allows any super admin to fetch project activities
- Access control based on proper RBAC system

#### `/src/app/api/projects/route.js`

**Changes:**

- Removed `isProjectAdmin` variable based on username
- Changed `canSeeAllProjects` to check only `user.is_super_admin`

**Impact:**

- GET endpoint returns all projects for any super admin
- Team-based filtering only applied to non-super admins

#### `/src/app/api/projects/list/route.js`

**Changes:**

- Removed `isProjectAdmin` username check
- Updated `canReadProjects` and `canSeeAllProjects` logic to use only super admin flag

**Impact:**

- Project list endpoint accessible by any super admin
- Proper permission-based access control

#### `/src/app/api/projects/[id]/route.js`

**Changes:**

- Removed `isProjectAdmin` checks in GET, PUT, and DELETE methods
- Updated `canSeeAllProjects` and `hasFullAccess` to use only super admin flag

**Impact:**

- Any super admin can view, update, and delete any project
- No username dependencies

#### `/src/app/api/projects/[id]/activities/route.js`

**Changes:**

- Removed `isProjectAdmin` checks from POST, PUT, and DELETE methods
- Updated `hasUpdatePermission` logic to use only super admin flag or RBAC

**Impact:**

- Any super admin can add, update, and delete project activities
- Permission-based system for non-super admins

#### `/src/app/api/projects/[id]/detail/route.js`

**Changes:**

- Removed `isProjectAdmin` variable
- Updated `canSeeAllProjects` to check only super admin status

**Impact:**

- Project detail endpoint accessible by any super admin
- Team-based restrictions for regular users

#### `/src/app/api/users/[id]/activity-assignments/route.js`

**Changes:**

- Removed `isRajeshPanchal` check from PUT method
- Simplified permission logic to check only `is_super_admin`

**Impact:**

- Any super admin can edit any user's activity assignments
- No special username required

## New Documentation Files

### `docs/explanations/SUPER_ADMIN_SETUP.md`

**Purpose:**

- Comprehensive guide on creating and managing super admin users
- Explains all super admin privileges
- Includes verification steps and troubleshooting

**Contents:**

- Multiple methods to create super admin
- Database structure explanation
- Security considerations
- Complete examples and scripts
- Troubleshooting guide

### `scripts/create_super_admin.sql`

**Purpose:**

- Ready-to-use SQL script for creating super admin users
- Includes both methods: promoting existing users and creating new ones

**Features:**

- Pre-filled template with placeholders
- Verification queries
- Optional employee linking
- Password hashing instructions
- Clear comments and instructions

## Super Admin Capabilities

A user with `is_super_admin = 1` now has:

### Project Management

✅ View all projects (not restricted by team membership)
✅ Edit any project
✅ Delete any project
✅ Add/edit/delete project activities
✅ See all project details

### Project Activities

✅ Access project activities report (`/reports/project-activities`)
✅ Edit daily entries for any user
✅ View all activity assignments
✅ Update activity progress for any project

### Reports

✅ Access all reports
✅ View project activities data
✅ No access restrictions

### User Management

✅ Create, edit, delete users
✅ Manage permissions
✅ Edit any user's activity assignments

### Admin Features

✅ Full admin dashboard access
✅ All master data management
✅ System configuration

### Navigation

✅ See all menu items
✅ All admin menu options
✅ All reports menu options

## Permission Flow

### Before (Hard-Coded)

```javascript
const isRajeshPanchal = user?.full_name?.toLowerCase() === 'rajesh panchal';
const hasAccess = isRajeshPanchal || isSuperAdmin || hasPermission;
```

### After (Proper RBAC)

```javascript
const isSuperAdmin =
	user?.is_super_admin === true || user?.is_super_admin === 1;
const hasAccess = isSuperAdmin || hasPermission;
```

## Database Schema

The super admin system relies on the `is_super_admin` column in the `users` table:

```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NOT NULL,
  is_super_admin BOOLEAN DEFAULT FALSE,  -- Key field
  -- ... other fields
);
```

## How to Create a Super Admin

### Quick Method (SQL)

```sql
-- Promote existing user
UPDATE users
SET is_super_admin = 1
WHERE username = 'desired_username';
```

### Comprehensive Method

See [SUPER_ADMIN_SETUP.md](SUPER_ADMIN_SETUP.md) for detailed instructions.

### Quick Script

Use [create_super_admin.sql](../../scripts/create_super_admin.sql) for a ready-to-run script.

## Verification Checklist

After creating a super admin, verify they can:

- [ ] Login successfully
- [ ] Access `/admin/dashboard`
- [ ] Access `/reports/project-activities`
- [ ] View all projects at `/projects`
- [ ] Edit project activities
- [ ] See all reports in navigation
- [ ] Manage users
- [ ] No "Access Denied" errors

## Migration Notes

### Previous System

- Special access hard-coded for username "Rajesh Panchal"
- Required code changes to grant similar access to other users
- Not scalable or maintainable

### Current System

- Permission-based via `is_super_admin` flag
- Easy to promote/demote users
- No code changes required
- Follows RBAC principles
- Scalable and maintainable

### For Existing "Rajesh Panchal" User

If the user "Rajesh Panchal" exists in your system:

1. Set `is_super_admin = 1` for this user
2. They will retain the same level of access
3. Now administered through proper permission system

## Security Improvements

1. **Centralized Control**: All super admin checks use database flag
2. **Auditable**: Can easily query who has super admin access
3. **Revocable**: Remove super admin status by updating one field
4. **No Code Dependencies**: Adding/removing super admins doesn't require code changes
5. **Consistent**: Same permission check across all modules

## Testing Recommendations

1. Create a test super admin user
2. Login and verify access to:
   - Project activities report
   - All projects (including ones you're not on the team for)
   - Edit capabilities on projects
   - Admin dashboard
3. Verify that editing project activities works
4. Test that non-super-admin users still have appropriate restrictions

## Breaking Changes

⚠️ **None** - This is a non-breaking change:

- Existing super admins continue to work
- Existing permissions continue to work
- Only removes hard-coded username checks
- Adds flexibility without removing functionality

## Rollback Plan

If needed, to rollback:

1. The old code used both username checks AND super admin checks
2. All users who had super admin access kept their `is_super_admin = 1`
3. Simply ensure `is_super_admin = 1` for any privileged users
4. No rollback needed as this is a pure improvement

## Benefits

✅ **Maintainable**: No more hard-coded usernames in source code
✅ **Scalable**: Easy to add multiple super admins
✅ **Secure**: Centralized permission management
✅ **Flexible**: Promote/demote users without code changes
✅ **Auditable**: Clear database records of who has super admin access
✅ **Standard**: Follows RBAC best practices

## Next Steps

1. Review [SUPER_ADMIN_SETUP.md](SUPER_ADMIN_SETUP.md) for detailed documentation
2. Run [create_super_admin.sql](../../scripts/create_super_admin.sql) to create your super admin
3. Test the super admin access
4. Remove or demote any old test accounts
5. Document your super admins internally

---

**Date**: March 5, 2026  
**Changes By**: GitHub Copilot  
**Files Changed**: 11 files  
**Documentation Created**: 2 files  
**Status**: ✅ Complete - All hard-coded references removed

## User Account and Employee link integrity (2026-10-28)

Employee records hold employment information. User Accounts control app access. An Employee can have no account.

The canonical connection is `users.employee_id` → `employees.id`.
Employee editing shows the linked account read-only. Ordinary account editing cannot change ownership.
Disabled accounts keep their Employee connection and history. **Restore Access** uses the existing account.
Exceptional repairs require a super-admin, an inactive account, and an audited reason.
Accounts with recorded activity cannot be reassigned through the repair action.

The migrations add unique connection protection, an Employee reference constraint, and a repair ledger.
They remove the obsolete `employees.username` column only after a read-only preflight.
Historical attribution uses recorded Employee IDs, then retained account connections. Names and emails never establish ownership.

Follow the [staged production rollout](RBAC_PERMISSIONS_SYSTEM.md#user-account-link-migration).
Back up the database first. The legacy-column drop loses old values, and rollback cannot recover them.
No step automatically repairs production data.

Disposable MariaDB, HTTP, and browser smoke checks exercised linking, access changes, repair rejection, concurrency, and historical attribution.
These checks do not prove production deployment.

## Dashboard Log In / Log Out (2026-11-02)

The dashboard shows Log In and Log Out instead of Punch In, Punch Out, and CRM Time.
Log In is the day's first recorded app entry, including entry with an existing authenticated Session, and stays fixed across later logins, refreshes, and tabs.
Log Out is the day's latest recorded app contact, advances while the app stays open, and carries the disclaimer "Last recorded app access; updates while the app is open."
It is last access only, not explicit sign-out, departure, attendance credit, or hours worked.
Device punches stay in the Attendance Report; the HR attendance grid is unchanged.

The browser-close epoch writer fix is retained: browser-reported close instants enter as numeric epochs converted by MariaDB, sweep signals stay database wall-clock strings, and explicit logout uses the database clock.
No global driver timezone, attendance policy, payroll formula, or device-punch derivation changes.
No attendance approval workflow or production data repair was added.

Disposable MariaDB checks exercised first-entry/latest-access days (including a day with no explicit logout), first-entry stability across a later login, empty versus unavailable days, and self-only read-only access without Work Session or biometric tables.
Chromium dashboard replays exercised fixed first entry, advancing last access, the immediate entry acknowledgement, failed-versus-empty states, and assignment-processing failures.
See the [updated Work Session decision](../adr/0033-presence-silence-counted-from-activity-evidence.md#dashboard-log-in--log-out-presentation-2026-11-02).

## Company payroll sheet grid (2026-11-12)

The Payroll stream on `/admin/payroll` now shows the company's 51 salary-sheet captions, verbatim and in company order.
The grid is read-only, freezes Employee Code and Full Name, keeps headers visible, and bounds horizontal scrolling.
Contract keeps its existing table and columns.
Generate, Finalize, Reopen, payment, Excel export and bulk PDF keep their existing roles.

Money cells are the generated Payroll Slip snapshot (`GROSS = total_earnings`, `TOTAL DED = total_deductions`, `NET SAL = net_pay`).
Attendance cells are current Attendance Records and are labelled **Current attendance — generated payroll amounts are unchanged** in the expanded row.
Unsupported or unrecorded values read **Not available**; a genuine recorded zero stays zero.
Expanded details also show payment state, recorded extra deductions, reconciliation and source/review warnings.
The footer totals the supported monetary columns — BASIC, DA, HRA, CONVEYANCE ALLOWANCE, CALL ALLOWANCE, OTHER ALLOWANCE, BONUS, INCENTIVE, PROVIDENT FUND, ESIC, PROFESSIONAL TAX, TAX DEDUCTED AT SOURCE, RETENTION AMOUNT, GROSS, TOTAL DED and NET SAL — from the same recorded cell values as the rows; a missing supported value makes that column's total **Not available**, and unsupported/rate/attendance/identity columns never acquire a zero total.
Identity and dependent attendance values report a source failure distinctly from genuinely missing records, without echoing raw database errors.
The company grid uses fixed identity-column widths with matching sticky offsets and caps expanded details to the scroll viewport, so frozen identity stays legible at narrow widths and 200% zoom.

Payroll Slip generation, salary calculation, the saved Payroll Run Roster, completeness checks, exports and slip documents are unchanged.
Company Days Paid is explained as an attendance credit, distinct from the payroll Payable Day; OT Hours are explained as attendance overtime, distinct from Logged Hours.

Lower-level coverage validates the 51-column pure read model, the opt-in `include=company-sheet` listing projection under `payroll:read`, and the grid's rendered column count, slip link, keyboard expansion and supported-money footer with blank unsupported columns.

## Vercel preview packaging (2026-11-13)

Vercel deployment uploads exclude the Playwright harness and its configuration alongside their script dependencies.
The harness remains available locally and in CI.
This prevents production type checks from loading test files whose script imports are excluded from the deployment.

## CI and local checks (2026-11-13)

GitHub Actions runs repository checks automatically again on pushes and pull requests, on standard `ubuntu-latest` runners with Node 24.
`checks.yml` runs the route-authorization check, `npm run verify` (which now includes route-auth before lint, the production build, and Vitest), the leads integration harness against MariaDB 10.11, and the financial Playwright smoke with failure artifacts.
The same npm commands run locally, so the workflow is identical on your machine.
Vercel previews and deployment builds remain enabled.
See the [testing and verification rules](../CODING_STANDARDS.md#testing-and-verification).
