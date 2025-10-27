# MOVED TO archive-md/EMPLOYEE_SETUP.md

## Overview
This guide will help you set up the employee management system for AccentCRM with CSV import functionality.

## Quick Setup

### 1. Run Backend Setup Script
```bash
npm run setup
```
This script will:
- Create/verify `.env.local` file with database configuration
- Install required dependencies (mysql2, dotenv)
- Test database connection
- Create the database if it doesn't exist
- Run the employee schema SQL script
- Verify the setup

### 2. Manual Database Setup (Alternative)
If the setup script doesn't work, you can manually:

1. Create `.env.local` file with your database credentials:
```env
DB_HOST=localhost
DB_PORT=3306
DB_NAME=accentcrm
DB_USER=root
DB_PASSWORD=your_password
```

2. Execute the SQL schema:
```bash
mysql -u root -p accentcrm < employees_schema.sql
```

### 3. Start Development Server
```bash
npm run dev
```

## Employee Management Features

### 1. Employee CRUD Operations
- ✅ Create new employees
- ✅ View employee details
- ✅ Edit employee information
- ✅ Delete employees (with validation)
- ✅ Search and filter employees
- ✅ Pagination support

### 2. CSV/Excel Import System
- ✅ Bulk import employees from CSV and Excel files
- ✅ Download CSV and Excel templates
- ✅ Data validation and error reporting
- ✅ Progress tracking
- ✅ Duplicate detection

### 3. Required CSV Columns
- **SR.NO** - Serial number (required)
- **Employee Code** - Unique employee identifier (required)
- **Full Name** - Employee's full name (required, will be split into first/last)

### 4. Optional CSV Columns
- Phone
- Department
- Position
- Hire Date (YYYY-MM-DD format)
- Salary (numeric)
- Address
- Notes

### 5. CSV/Excel Format Example

**CSV Format:**
```csv
SR.NO,Employee Code,Full Name,Phone,Department,Position,Hire Date,Salary,Address,Notes
1,EMP001,John Doe,+1-555-0123,Engineering,Senior Developer,2023-01-15,85000,123 Main St,Sample employee
2,EMP002,Jane Smith,+1-555-0124,Sales,Sales Manager,2023-02-01,75000,456 Oak Ave,Sample employee
```

**Excel Format:**
- Same column structure as CSV
- Use .xlsx or .xls format
- Data should be in the first worksheet
- Headers in the first row

## Database Schema

### Employees Table Structure
```sql
- id (INT, Primary Key, Auto Increment)
- employee_id (VARCHAR(20), Unique, Not Null)
- first_name (VARCHAR(50), Not Null)
- last_name (VARCHAR(50), Not Null)
- email (VARCHAR(100), Unique, Not Null)
- phone (VARCHAR(20))
- department (VARCHAR(50))
- position (VARCHAR(100))
- hire_date (DATE)
- salary (DECIMAL(10,2))
- status (ENUM: 'active', 'inactive', 'terminated')
- manager_id (INT, Foreign Key)
- address (TEXT)
- emergency_contact_name (VARCHAR(100))
- emergency_contact_phone (VARCHAR(20))
- notes (TEXT)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
```

## API Endpoints

### Employee CRUD
- `GET /api/employees` - List employees with search/filter
- `POST /api/employees` - Create new employee
- `PUT /api/employees` - Update employee
- `DELETE /api/employees?id=X` - Delete employee

### CSV/Excel Import
- `POST /api/employees/import` - Import employees from CSV/Excel
- `GET /api/employees/import` - Download CSV template
- `GET /api/employees/import?format=excel` - Download Excel template

## Navigation

Access the employee management system through:
1. **Navbar** → **Masters** → **Employee/HR Masters** → **Employee Master**
2. Direct URL: `/employees`

## Features

### Modern UI/UX
- Purple gradient theme (#64126D to #86288F)
- Responsive design for desktop and mobile
- Modern form components with validation
- Interactive modals for CRUD operations
- Real-time search and filtering

### Data Validation
- Required field validation
- Email format validation
- Duplicate employee ID/email detection
- CSV format validation
- File size limits (5MB max)

### Error Handling
- Comprehensive error messages
- Import progress tracking
- Detailed import results with error breakdown
- User-friendly error dialogs

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check `.env.local` credentials
   - Ensure MySQL server is running
   - Verify database exists

2. **CSV Import Errors**
   - Download and use the provided template
   - Ensure required columns are present
   - Check for duplicate employee codes/emails
   - Verify file format is CSV

3. **Dependencies Missing**
   - Run `npm install` to install all dependencies
   - Check that mysql2 and dotenv are installed

### Support
For additional help, check the setup script output or examine the console logs for detailed error messages.
