-- ============================================
-- Create Super Admin User - Quick Setup Script
-- ============================================
-- This script creates a new super admin user with full system access
-- 
-- Instructions:
-- 1. Replace the placeholders with your desired values
-- 2. Generate a bcrypt hash for your password (see SUPER_ADMIN_SETUP.md)
-- 3. Run this script in your MySQL database
-- ============================================

-- Configuration: Set your desired username and email
SET @admin_username = 'crmadmin';  -- Change this
SET @admin_email = 'crm@accent.com';  -- Change this
SET @admin_full_name = 'Super Administrator';  -- Change this
SET @admin_password_hash = 'admin321';  -- Replace with actual bcrypt hash

-- ============================================
-- Option 1: Promote an Existing User to Super Admin
-- ============================================
-- Uncomment and run this if you want to promote an existing user:

-- UPDATE users 
-- SET is_super_admin = 1 
-- WHERE username = 'existing_username';  -- Replace with actual username

-- ============================================
-- Option 2: Create a New Super Admin User
-- ============================================

-- Step 1: Check if username already exists
SELECT 'Checking if username exists...' as Status;
SELECT id, username, email, is_super_admin 
FROM users 
WHERE username = @admin_username OR email = @admin_email;

-- If the above query returns results, the user already exists!
-- You can either:
-- a) Update the existing user to be super admin (see Option 1 above)
-- b) Choose a different username/email

-- Step 2: Insert new super admin user
-- Only run this if the username doesn't exist
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
)
VALUES (
    @admin_username,
    @admin_password_hash,
    @admin_email,
    @admin_full_name,
    1,                  -- is_super_admin = TRUE (this is the key field!)
    'employee',         -- Account type
    'active',           -- Status
    1,                  -- is_active = TRUE
    NOW()               -- Created timestamp
);

-- ============================================
-- Step 3: Verify the super admin was created
-- ============================================
SELECT 'Verification: All Super Admin Users' as Status;
SELECT 
    id,
    username,
    email,
    full_name,
    is_super_admin,
    account_type,
    status,
    is_active,
    created_at
FROM users 
WHERE is_super_admin = 1
ORDER BY created_at DESC;

-- ============================================
-- Optional: Link to an Employee Record
-- ============================================
-- If you want to link this user to an employee record:
-- First, check if employee exists:

-- SELECT id, employee_id, first_name, last_name, email 
-- FROM employees 
-- WHERE email = @admin_email;

-- If employee exists, link the user:
-- UPDATE users 
-- SET employee_id = YOUR_EMPLOYEE_ID  -- Replace with actual employee.id
-- WHERE username = @admin_username;

-- If employee doesn't exist and you want to create one:
-- INSERT INTO employees (
--     employee_id,
--     first_name,
--     last_name,
--     email,
--     department,
--     position,
--     status
-- )
-- VALUES (
--     'EMP001',           -- Employee code
--     'Super',            -- First name
--     'Admin',            -- Last name
--     @admin_email,       -- Email
--     'Administration',   -- Department
--     'System Administrator',  -- Position
--     'active'            -- Status
-- );

-- Then link:
-- UPDATE users 
-- SET employee_id = LAST_INSERT_ID()
-- WHERE username = @admin_username;

-- ============================================
-- Complete! Your super admin user is ready.
-- ============================================
-- Next steps:
-- 1. Login with the username and password you set
-- 2. Verify access to:
--    - /reports/project-activities
--    - /projects (should see ALL projects)
--    - /admin/dashboard
-- 3. The user should be able to:
--    - Edit all project activities
--    - View all projects regardless of team membership
--    - Access all reports and admin features
-- ============================================

-- ============================================
-- Quick Reference: Generate Password Hash
-- ============================================
-- To generate a bcrypt hash for your password:
--
-- Using Node.js:
-- ```javascript
-- const bcrypt = require('bcrypt');
-- const password = 'YourSecurePassword123!';
-- bcrypt.hash(password, 10).then(hash => console.log(hash));
-- ```
--
-- Using Python:
-- ```python
-- import bcrypt
-- password = b'YourSecurePassword123!'
-- hash = bcrypt.hashpw(password, bcrypt.gensalt(rounds=10))
-- print(hash.decode())
-- ```
--
-- Or use an online bcrypt generator (search "bcrypt generator")
-- Make sure to use 10 rounds for compatibility
-- ============================================
