# Email Fields Added to Leads Table

## Overview
Added two new email fields to the leads table to capture inquiry email information:
1. **Inquiry Email** - Email ID of the person from whom the inquiry was received
2. **CC Emails** - Additional email IDs (2-6 emails, comma-separated)

## Database Changes

### Migration Script
**File:** `scripts/add-email-fields-to-leads.js`

**Columns Added:**
```sql
ALTER TABLE leads ADD COLUMN inquiry_email VARCHAR(255) NULL 
  COMMENT 'Email ID of person from whom inquiry was received';

ALTER TABLE leads ADD COLUMN cc_emails TEXT NULL 
  COMMENT 'Additional CC email IDs (2-6 emails, comma-separated)';
```

### Execution
```bash
node scripts/add-email-fields-to-leads.js
```

**Status:** ✅ Successfully executed

## Backend API Changes

### 1. `/api/leads/route.js` (POST - Create Lead)
- Added `inquiry_email` and `cc_emails` to destructured parameters
- Added column existence checks in ALTER TABLE section
- Included both fields in INSERT statement

### 2. `/api/leads/[id]/route.js` (PUT - Update Lead)
- Added `inquiry_email` and `cc_emails` to UPDATE statement
- Both fields are optional (nullable)

## Frontend Changes

### 1. `/leads/page.js` (Leads List & Add Form)

**Form Data State:**
- Added `inquiry_email: ''`
- Added `cc_emails: ''`

**New Form Fields:**

#### Inquiry Email Field
```jsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    Inquiry Email
  </label>
  <input
    type="email"
    name="inquiry_email"
    value={formData.inquiry_email}
    onChange={handleFormChange}
    placeholder="Email from whom inquiry was received"
  />
  <p className="text-xs text-gray-500 mt-1">
    Email ID of the person from whom the inquiry was received
  </p>
</div>
```

#### CC Emails Field
```jsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">
    CC Emails (2-6 emails)
  </label>
  <input
    type="text"
    name="cc_emails"
    value={formData.cc_emails}
    onChange={handleFormChange}
    placeholder="email1@example.com, email2@example.com, email3@example.com"
  />
  <p className="text-xs text-gray-500 mt-1">
    Enter 2-6 additional email IDs separated by commas
  </p>
</div>
```

### 2. `/leads/[id]/edit/page.js` (Edit Lead)
- Added `inquiry_email` and `cc_emails` to formData state
- Populated fields when fetching existing lead data

## Usage Guidelines

### Inquiry Email
- **Purpose:** Store the primary email ID from whom the inquiry was received
- **Format:** Standard email format (e.g., `john.doe@example.com`)
- **Required:** No (optional field)

### CC Emails
- **Purpose:** Store additional CC email IDs
- **Format:** Comma-separated email addresses
- **Count:** 2-6 email addresses recommended
- **Example:** `email1@example.com, email2@example.com, email3@example.com`
- **Required:** No (optional field)

## Data Flow

### Creating a New Lead
1. User enters inquiry email in "Inquiry Email" field
2. User enters additional emails in "CC Emails" field (comma-separated)
3. Form submits to `/api/leads` POST endpoint
4. Backend validates and inserts data with both email fields
5. Data stored in database

### Updating an Existing Lead
1. Edit page loads existing lead data including email fields
2. User modifies inquiry_email or cc_emails
3. Form submits to `/api/leads/[id]` PUT endpoint
4. Backend updates the lead record with new email values

## Database Schema

```sql
CREATE TABLE leads (
  id INT PRIMARY KEY AUTO_INCREMENT,
  lead_id VARCHAR(50),
  company_id INT,
  company_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  inquiry_email VARCHAR(255),          -- NEW FIELD
  cc_emails TEXT,                      -- NEW FIELD
  phone VARCHAR(20),
  city VARCHAR(100),
  project_description TEXT,
  enquiry_type VARCHAR(50),
  enquiry_status VARCHAR(50),
  enquiry_date DATE,
  lead_source VARCHAR(255),
  priority ENUM('Low', 'Medium', 'High'),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Testing

To test the new fields:

1. Navigate to Leads page
2. Click "Add New Lead"
3. Fill in the form including:
   - Inquiry Email: `inquiry@example.com`
   - CC Emails: `cc1@example.com, cc2@example.com, cc3@example.com`
4. Submit the form
5. Verify data is saved correctly
6. Edit the lead to verify fields are populated

## Files Modified

### Backend
- ✅ `/src/app/api/leads/route.js` - POST method updated
- ✅ `/src/app/api/leads/[id]/route.js` - PUT method updated

### Frontend
- ✅ `/src/app/leads/page.js` - Add form updated
- ✅ `/src/app/leads/[id]/edit/page.js` - Edit form updated

### Scripts
- ✅ `/scripts/add-email-fields-to-leads.js` - Migration script created

## Rollback (if needed)

To remove the email fields:

```sql
ALTER TABLE leads DROP COLUMN inquiry_email;
ALTER TABLE leads DROP COLUMN cc_emails;
```

## Status
✅ **Completed and Ready for Use**

Both email fields are now fully integrated into the leads system and ready for production use.
