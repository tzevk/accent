# Super Admin Setup Guide

This guide explains how to create a new super admin user with full permissions across all modules in the system.

## Overview

Super admins have unrestricted access to all features and modules including:
- **All Projects**: View, edit, and delete all projects regardless of team membership
- **Project Activities**: View and edit all project activities and user assignments
- **Reports**: Access all reports including project activities report
- **User Management**: Create, edit, and delete users
- **Master Data**: Manage all master data tables
- **Admin Dashboard**: Full access to admin features
- **All Modules**: Complete access to every module in the system

## Creating a Super Admin User

### Method 1: Direct Database Update (Recommended for Existing Users)

If you have an existing user that you want to promote to super admin:

```sql
-- Update an existing user to be a super admin
UPDATE users 
SET is_super_admin = 1 
WHERE username = 'desired_username';

-- Or by email
UPDATE users 
SET is_super_admin = 1 
WHERE email = 'user@example.com';

-- Verify the change
SELECT id, username, email, full_name, is_super_admin 
FROM users 
WHERE is_super_admin = 1;
```

### Method 2: Create New Super Admin User via Database

To create a completely new super admin user:

```sql
-- Insert a new super admin user
INSERT INTO users (
  username, 
  password_hash, 
  email, 
  full_name, 
  is_super_admin,
  account_type,
  status,
  is_active,
  created_at
) VALUES (
  'admin',                          -- Username
  '$2a$10$...',                     -- Hashed password (use bcrypt)
  'admin@example.com',              -- Email
  'System Administrator',           -- Full name
  1,                                -- is_super_admin = TRUE
  'employee',                       -- Account type
  'active',                         -- Status
  1,                                -- is_active = TRUE
  NOW()                             -- Created timestamp
);
```

### Method 3: Using the API (Requires Existing Super Admin)

If you already have a super admin account, you can use the API:

```javascript
// POST /api/users
{
  "username": "newadmin",
  "password": "SecurePassword123!",
  "email": "newadmin@example.com",
  "account_type": "employee",
  "employee_id": 1,  // Must link to valid employee
  "is_super_admin": true  // Note: This field needs to be added to the API
}
```

**Note**: Currently, the API doesn't expose the `is_super_admin` field in the POST endpoint. You'll need to either:
1. Add it to the API route handler in [/src/app/api/users/route.js](src/app/api/users/route.js)
2. Or use Method 1 (direct database update) after creating the user

## Password Hashing

To generate a bcrypt password hash for use in SQL:

### Using Node.js:
```javascript
const bcrypt = require('bcrypt');
const password = 'YourSecurePassword123!';
const hash = await bcrypt.hash(password, 10);
console.log(hash); // Use this in your SQL INSERT
```

### Using Online Tool:
You can use an online bcrypt generator (search "bcrypt generator online")
- Use rounds: 10
- Input your password
- Copy the resulting hash

## Permissions System

### Super Admin Privileges

When `is_super_admin = 1`, the user automatically:

1. **Bypasses all RBAC checks** - No need for explicit role or permissions
2. **Sees all projects** - Not restricted to team membership
3. **Can edit all project activities** - Full access to project activity assignments
4. **Accesses all reports** - Including project activities report
5. **No field-level restrictions** - Can view and edit all fields
6. **Admin routes accessible** - Full access to `/admin/*` routes

### How It Works in Code

The system checks super admin status at multiple levels:

#### 1. Frontend (React Components)
```javascript
// Example from Navbar.jsx
if (user.is_super_admin) return reportsMenuConfig; // Super admin sees all

// Example from project-activities page
const isSuperAdmin = user?.is_super_admin === true || user?.is_super_admin === 1;
const hasAccess = isSuperAdmin || hasReportsPermission;
```

#### 2. Backend (API Routes)
```javascript
// Example from project routes
const canSeeAllProjects = user.is_super_admin;

// Example from RBAC middleware
if (allowSuperAdmin && user.is_super_admin) {
  return true; // Bypass permission checks
}
```

#### 3. Database Queries
```javascript
// Projects are filtered by team unless super admin
if (!canSeeAllProjects) {
  filteredRows = rows.filter(project => 
    isUserInProjectTeam(project.project_team, user.id, user.email)
  );
}
```

## Verifying Super Admin Access

After creating a super admin, verify they have access to:

### 1. Project Activities Report
- Navigate to `/reports/project-activities`
- Should see all projects with activities
- Should be able to edit daily entries
- No "Access Denied" messages

### 2. All Projects
- Navigate to `/projects`
- Should see ALL projects in the system
- Not limited to team membership
- Can edit and delete any project

### 3. Admin Dashboard
- Navigate to `/admin/dashboard`
- Should have full access without restrictions

### 4. User Management
- Navigate to `/admin/accounts` or users section
- Can create, edit, and delete users
- Can manage permissions

## Important Notes

### Security Considerations

1. **Limit Super Admin Accounts**: Create only as many as necessary
2. **Strong Passwords**: Use strong, unique passwords for super admins
3. **Audit Logging**: Super admin actions are logged via activity logger
4. **Regular Review**: Periodically review who has super admin access

### Database Structure

The `users` table includes:
```sql
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email VARCHAR(100),
  full_name VARCHAR(100),
  is_super_admin BOOLEAN DEFAULT FALSE,  -- This field grants super admin access
  is_active BOOLEAN DEFAULT TRUE,
  status ENUM('active', 'inactive') DEFAULT 'active',
  role_id INT DEFAULT NULL,
  permissions JSON DEFAULT NULL,
  account_type ENUM('employee', 'vendor') DEFAULT 'employee',
  employee_id INT DEFAULT NULL,
  vendor_id INT DEFAULT NULL,
  -- ... other fields
);
```

### No Role Required

Super admins **do not need** a role assigned. The `is_super_admin` flag alone grants all permissions.
- `role_id` can be NULL
- `permissions` JSON can be NULL
- System checks `is_super_admin` first before checking roles/permissions

## Troubleshooting

### Super Admin Cannot Access Project Activities

1. Check database:
   ```sql
   SELECT id, username, is_super_admin 
   FROM users 
   WHERE username = 'your_admin_username';
   ```

2. Verify `is_super_admin` is `1` (not `0` or `NULL`)

3. Clear browser cookies and re-login

4. Check browser console for errors

### Super Admin Not Seeing All Projects

1. Verify the user is logged in correctly
2. Check session cookies contain `is_super_admin=1`
3. Review API responses in Network tab
4. Confirm backend logs show super admin status

### Permission Denied Errors

1. Ensure user is properly logged in
2. Check if session is still valid
3. Verify `is_super_admin` flag in database
4. Try logging out and back in

## Migration from Hard-Coded Users

**Previous System**: Used hard-coded checks for "Rajesh Panchal"
**Current System**: Uses `is_super_admin` flag

If you had users with special hard-coded access:
1. Identify those users in the database
2. Set their `is_super_admin = 1`
3. They will now have the same level of access through the proper permission system

## Example: Complete Setup Script

```sql
-- Example: Create a new super admin from scratch

-- Step 1: Create employee record (if needed)
INSERT INTO employees (employee_id, first_name, last_name, email, department, status)
VALUES ('E001', 'Admin', 'User', 'admin@company.com', 'IT', 'active');

-- Step 2: Get the employee ID
SET @emp_id = LAST_INSERT_ID();

-- Step 3: Create user with super admin flag
INSERT INTO users (
  username,
  password_hash,
  email,
  full_name,
  employee_id,
  account_type,
  is_super_admin,
  is_active,
  status
) VALUES (
  'admin',
  '$2a$10$YourBcryptHashHere',  -- Replace with actual hash
  'admin@company.com',
  'Admin User',
  @emp_id,
  'employee',
  1,  -- Super admin flag
  1,  -- Active
  'active'
);

-- Step 4: Verify creation
SELECT 
  u.id,
  u.username,
  u.email,
  u.full_name,
  u.is_super_admin,
  e.employee_id,
  e.first_name,
  e.last_name
FROM users u
LEFT JOIN employees e ON u.employee_id = e.id
WHERE u.is_super_admin = 1;
```

## Summary

To create a super admin with full access to all modules including project activities:

1. **Create or update user** with `is_super_admin = 1` in database
2. **No additional permissions needed** - super admin flag grants everything
3. **Verify access** by logging in and checking:
   - Project Activities Report (`/reports/project-activities`)
   - All Projects page (`/projects`) - should see all projects
   - Admin Dashboard (`/admin/dashboard`)
4. **User can now**:
   - Edit project activities and daily entries
   - View and manage all projects
   - Access all reports
   - Manage all users and master data
   - Access every module in the system

---

**Last Updated**: March 2026  
**Applies To**: Accent ERP System v2.0+
