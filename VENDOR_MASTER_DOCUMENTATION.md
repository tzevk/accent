# Vendor Master Module - Documentation

## Overview
The Vendor Master module is a comprehensive vendor management system integrated into the AccentCRM platform. It allows you to manage suppliers, subcontractors, consultants, OEMs, and service providers with detailed information tracking across multiple categories.

## Features Implemented

### 1. Database Schema
**Table:** `vendors`
**Total Fields:** 38 columns

#### Basic Information
- `id` - Auto-incrementing primary key
- `vendor_id` - Unique vendor identifier (format: XXX-MM-YYYY, auto-generated)
- `vendor_name` - Company/supplier name (required)
- `vendor_type` - Type: Supplier, Subcontractor, Consultant, OEM, Service Provider
- `industry_category` - Category: Civil, Piping, Electrical, Instrumentation, Mechanical, HVAC, General
- `status` - Status: Active, Inactive, Blacklisted (default: Active)

#### Contact Information
- `contact_person` - Primary contact person name
- `contact_designation` - Designation of contact person
- `phone` - Phone number
- `email` - Email address
- `address_street` - Street address
- `address_city` - City
- `address_state` - State/province
- `address_country` - Country
- `address_pin` - PIN/postal code
- `website` - Website URL

#### Registration & Compliance
- `gst_vat_tax_id` - GST/VAT/Tax identification number
- `pan_legal_reg_no` - PAN/Legal registration number
- `msme_ssi_registration` - MSME/SSI registration number
- `iso_certifications` - ISO/ASME/API certifications
- `other_compliance_docs` - Other compliance documents

#### Financial Information
- `bank_name` - Bank name
- `bank_account_no` - Bank account number
- `ifsc_swift_code` - IFSC/SWIFT code
- `currency_preference` - Preferred currency (default: INR)
- `payment_terms` - Payment terms (e.g., "30 days credit")
- `credit_limit` - Credit limit amount (DECIMAL 15,2)

#### Performance & History
- `previous_projects` - Previous projects handled
- `avg_quality_rating` - Average quality rating (1-5 scale)
- `avg_delivery_rating` - Average delivery rating (1-5 scale)
- `avg_reliability_rating` - Average reliability rating (1-5 scale)
- `blacklist_notes` - Blacklist/warning notes
- `remarks` - General remarks and notes

#### Attachments
- `contract_attachments` - Contract/MOU file paths
- `certificate_attachments` - Certificate file paths
- `profile_attachments` - Company profile/brochure file paths

#### Timestamps
- `created_at` - Record creation timestamp
- `updated_at` - Last update timestamp

---

## API Endpoints

### GET /api/vendors
Retrieves all vendors with automatic table creation if it doesn't exist.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "vendor_id": "001-10-2025",
      "vendor_name": "Test Engineering Solutions",
      ...
    }
  ]
}
```

### POST /api/vendors
Creates a new vendor with auto-generated vendor_id if not provided.

**Request Body:**
```json
{
  "vendor_name": "ABC Engineering Ltd",
  "vendor_type": "Supplier",
  "industry_category": "Civil",
  "status": "Active",
  "contact_person": "John Doe",
  "phone": "+91-1234567890",
  "email": "john@abc.com",
  ...
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "vendor_id": "001-10-2025"
  },
  "message": "Vendor created successfully"
}
```

### GET /api/vendors/[id]
Retrieves a specific vendor by ID.

### PUT /api/vendors/[id]
Updates a specific vendor.

### DELETE /api/vendors/[id]
Deletes a specific vendor.

---

## Frontend Pages

### 1. Vendor List Page (`/vendors`)
**File:** `src/app/vendors/page.jsx`

**Features:**
- Statistics cards showing:
  - Total vendors
  - Active vendors
  - Inactive vendors
  - Blacklisted vendors
- Search functionality (searches vendor name, ID, contact person, email)
- Filters by:
  - Vendor type
  - Status
- Quick add vendor form (collapsible)
- Data table with columns:
  - Vendor ID
  - Vendor Name
  - Type
  - Category
  - Contact details
  - Status badge
  - Actions (View, Edit, Delete)

### 2. Vendor Detail View (`/vendors/[id]`)
**File:** `src/app/vendors/[id]/page.js`

**Organized Sections:**
- **Basic Information** - Vendor ID, Name, Type, Category, Status
- **Contact Information** - Contact person, phone, email, full address, website
- **Registration & Compliance** - GST, PAN, MSME, ISO certifications
- **Financial Information** - Bank details, payment terms, credit limit
- **Performance & Rating** - Star ratings for quality, delivery, reliability
- **Warning Notes** - Red-highlighted blacklist/warning section
- **Remarks** - General notes
- **Timeline** - Created and updated dates

### 3. Vendor Edit Page (`/vendors/[id]/edit`)
**File:** `src/app/vendors/[id]/edit/page.js`

**Tabbed Layout (6 Tabs):**

#### Tab 1: Basic Information
- Vendor ID (auto-generated)
- Vendor Name (required)
- Vendor Type (dropdown)
- Industry/Category (dropdown)
- Status (dropdown)

#### Tab 2: Contact Information
- Primary Contact Person
- Designation
- Phone
- Email
- Full Address (Street, City, State, Country, PIN)
- Website

#### Tab 3: Registration & Compliance
- GST/VAT/Tax ID
- PAN/Legal Registration No.
- MSME/SSI Registration
- ISO/ASME/API Certifications
- Other Compliance Documents (textarea)

#### Tab 4: Financial Information
- Bank Name
- Account Number
- IFSC/SWIFT Code
- Currency Preference (dropdown: INR, USD, EUR, GBP, AED)
- Payment Terms
- Credit Limit (numeric)

#### Tab 5: Performance & History
- Quality Rating (1-5, decimal)
- Delivery Rating (1-5, decimal)
- Reliability Rating (1-5, decimal)
- Previous Projects (textarea)
- Blacklist/Warning Notes (red-highlighted textarea)
- General Remarks (textarea)

#### Tab 6: Attachments
- Contract/MOU Attachments
- Certificate Attachments
- Company Profile/Brochure
*(Note: Currently stores file paths/URLs as text. File upload functionality can be integrated later)*

---

## Navigation Integration

The Vendor Master has been added to the navigation bar under "Masters" menu:
- Employee Master
- User Master
- Activity Master
- Company Master
- **Vendor Master** ← New
- Document Master

---

## Styling & Design

The Vendor Master module follows the exact same styling as the existing Leads and Projects modules:
- Accent primary color (#64126D)
- Consistent card layouts
- Same table styling
- Matching form inputs
- Identical button styles
- Same color-coded status badges
- Consistent spacing and typography

---

## Auto-Generation Features

### Vendor ID Format
- **Pattern:** XXX-MM-YYYY (e.g., 001-10-2025)
- **XXX:** 3-digit serial number (increments per month/year)
- **MM:** Current month (01-12)
- **YYYY:** Current year

**Logic:**
1. If vendor_id is provided and valid → Use it
2. If vendor_id is empty → Auto-generate
3. Query highest vendor_id for current month/year
4. Increment serial number
5. Format as XXX-MM-YYYY

---

## Testing

### Test Scripts Created

#### 1. `scripts/create-vendors-table.js`
Creates the vendors table with all 38 columns.

**Usage:**
```bash
node scripts/create-vendors-table.js
```

#### 2. `scripts/test-vendor-master.js`
Comprehensive test that:
- Verifies table structure
- Creates a test vendor with all fields populated
- Displays vendor details
- Shows vendor statistics
- Provides cleanup command

**Usage:**
```bash
node scripts/test-vendor-master.js
```

**Test Data Includes:**
- Vendor Name: Test Engineering Solutions Pvt Ltd
- Type: Supplier
- Category: Electrical
- Full contact details
- GST, PAN, MSME numbers
- ISO certifications
- Complete bank details
- Payment terms: 30 days credit
- Credit limit: ₹5,00,000
- Performance ratings (4.2-4.7/5)

---

## Usage Workflow

### Adding a New Vendor
1. Navigate to `/vendors`
2. Click "Add Vendor" button
3. Fill in quick form with basic details
4. Submit to create vendor
5. Navigate to vendor detail page
6. Click "Edit" to add complete information across all tabs

### Viewing Vendor Details
1. Navigate to `/vendors`
2. Click "View" icon (eye) on any vendor
3. View all organized information in sections

### Editing Vendor Information
1. From vendor detail page, click "Edit"
2. Use tabs to navigate different sections
3. Fill in relevant information
4. Click "Save Changes"

### Managing Vendors
- **Search:** Type in search box to filter by name, ID, contact
- **Filter:** Use dropdowns to filter by type or status
- **Delete:** Click delete icon, confirm deletion
- **Status Change:** Edit vendor and change status (Active/Inactive/Blacklisted)

---

## Integration Points

### Current
- Standalone module
- Accessible via navigation menu
- Independent data management

### Future Integration Possibilities
1. **Projects Module**
   - Link vendors to projects
   - Select vendors from dropdown when creating/editing projects
   - Track vendor assignments per project

2. **Purchase Orders**
   - Create PO linked to vendors
   - Track vendor invoices

3. **Performance Tracking**
   - Automated rating updates based on delivery metrics
   - Performance reports and analytics

4. **Document Management**
   - File upload integration for attachments
   - Document version control

---

## Database Migration

To set up the Vendor Master in an existing database:

```bash
# 1. Create the vendors table
node scripts/create-vendors-table.js

# 2. (Optional) Add test data
node scripts/test-vendor-master.js

# 3. Access the module
# Navigate to: http://localhost:3000/vendors
```

---

## File Structure

```
src/app/
├── api/
│   └── vendors/
│       ├── route.js              # GET all vendors, POST new vendor
│       └── [id]/
│           └── route.js          # GET, PUT, DELETE vendor by ID
└── vendors/
    ├── page.jsx                  # Vendor list/dashboard
    ├── [id]/
    │   ├── page.js              # Vendor detail view
    │   └── edit/
    │       └── page.js          # Vendor edit with tabs

scripts/
├── create-vendors-table.js       # Table creation script
└── test-vendor-master.js        # Comprehensive test script
```

---

## Success Criteria ✅

All requirements have been successfully implemented:

- ✅ Basic Information tracking
- ✅ Contact Information with full address
- ✅ Registration & Compliance documents
- ✅ Financial Information (bank details, payment terms, credit limit)
- ✅ Performance & History (ratings, previous projects, blacklist notes)
- ✅ Attachments section (ready for file upload integration)
- ✅ Auto-generated Vendor ID
- ✅ Status management (Active/Inactive/Blacklisted)
- ✅ Search and filter functionality
- ✅ Statistics dashboard
- ✅ Tabbed edit interface
- ✅ Consistent styling with existing modules
- ✅ Full CRUD operations
- ✅ Navigation integration

---

## Notes

1. **File Uploads:** Attachment fields currently store text (file paths/URLs). A file upload system can be integrated using Next.js API routes with libraries like `multer` or cloud storage solutions (AWS S3, Cloudinary).

2. **Validation:** Front-end validation is basic (required fields). Enhanced validation can be added for:
   - GST number format
   - PAN number format
   - Email format
   - Phone number format
   - Credit limit ranges

3. **Project Linking:** The `previous_projects` field currently stores text. This can be enhanced to:
   - Store project IDs (foreign keys)
   - Display linked projects in vendor view
   - Allow project selection from dropdown in edit mode

4. **Performance Ratings:** Currently manual entry. Can be automated by:
   - Linking to actual project deliveries
   - Calculating ratings based on performance metrics
   - Tracking rating history over time

---

## Cleanup

To delete the test vendor:
```sql
DELETE FROM vendors WHERE id = 1;
```

Or use the UI:
1. Navigate to vendor detail page
2. Click "Delete" button
3. Confirm deletion

---

**Module Status:** ✅ Complete and Ready for Use
**Last Updated:** October 8, 2025
**Version:** 1.0
