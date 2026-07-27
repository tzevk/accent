# Support Ticket System Documentation

## Overview

A structured employee support ticket system with automatic routing to HR or Admin departments based on request category.

## Ticket Flow

```
New → Under Review → In Progress → Waiting for Employee → Resolved → Closed
```

### Status Definitions

1. **New** (🆕)
   - Initial status when a ticket is created
   - Visible to assigned department (HR/Admin)
   - Awaiting first review

2. **Under Review** (👀)
   - Department has acknowledged the ticket
   - Investigating the request
   - May request additional information

3. **In Progress** (⚡)
   - Actively working on the request
   - Changes being implemented
   - Employee will be updated on progress

4. **Waiting for Employee** (⏳)
   - Department needs information/action from employee
   - Employee must respond to proceed
   - Auto-moves back to "In Progress" when employee comments

5. **Resolved** (✅)
   - Request has been completed
   - Resolution notes provided
   - Employee can review and request reopening if needed

6. **Closed** (🔒)
   - Final status, ticket is archived
   - No further action
   - Historical record maintained

## Ticket Creation (Employee Side)

### Required Fields

- **Subject**: Brief summary of the request
- **Category**: Determines routing to HR or Admin
- **Description**: Detailed explanation of the request
- **Priority**: Low, Medium, High, or Urgent

### Optional Fields

- **Attachment URL**: Link to supporting documents

### Categories & Routing

#### HR Department

| Category             | Icon | Description                         |
| -------------------- | ---- | ----------------------------------- |
| Payroll              | 💰   | Salary, deductions, tax issues      |
| Leave                | 🏖️   | Leave applications, balance queries |
| Policy               | 📋   | Company policies, guidelines        |
| Confidential Matters | 🔒   | Private HR matters (restricted)     |

#### Admin Department

| Category        | Icon | Description                         |
| --------------- | ---- | ----------------------------------- |
| Access Cards    | 🪪   | ID cards, access permissions        |
| Seating         | 💺   | Desk allocation, workspace requests |
| Maintenance     | 🔧   | Facility issues, repairs            |
| General Request | 📝   | Other administrative requests       |

## Routing Logic

Tickets are automatically routed when created:

```javascript
// HR Categories
['payroll', 'leave', 'policy', 'confidential'] → HR

// Admin Categories
['access_cards', 'seating', 'maintenance', 'general_request'] → Admin
```

**Routing is automatic and cannot be changed by the employee.**

## Priority Levels

| Priority | Color  | Description                 |
| -------- | ------ | --------------------------- |
| Low      | Gray   | Can wait, not blocking work |
| Medium   | Blue   | Normal priority             |
| High     | Orange | Needs attention soon        |
| Urgent   | Red    | Critical, blocking work     |

## Employee Features

### Dashboard View

- Statistics cards showing ticket counts by status
- Filter by status, priority, or department
- Search by ticket number, subject, or description
- Click any ticket to view full details

### Ticket Creation

1. Click "Create Ticket" button
2. Fill in required fields:
   - Subject
   - Select category (shows routing destination)
   - Detailed description
   - Priority level
   - Optional attachment URL
3. Submit

### Ticket Tracking

- View all your submitted tickets
- Real-time status updates
- Comment thread for communication
- Attachment viewing
- Resolution notes when closed

## Admin/HR Features

### Management Dashboard

- View all tickets routed to your department
- Filter by status, priority, category, and department
- Search across all fields including employee names
- Statistics showing ticket counts for each status

### Ticket Management Actions

1. **Status Updates**
   - Quick action buttons to move tickets through the flow
   - Required resolution notes when marking Resolved/Closed

2. **Assignment**
   - Assign tickets to specific team members
   - Dropdown showing all users
   - Unassign if needed

3. **Communication**
   - Add internal or external comments
   - Comments visible to employee
   - Track conversation history

4. **Priority Management**
   - Update priority levels as needed
   - Helps with workload prioritization

## Technical Implementation

### Database Schema

```sql
CREATE TABLE support_tickets (
  id INT PRIMARY KEY,
  ticket_number VARCHAR(20) UNIQUE,
  user_id INT NOT NULL,
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  category ENUM(...) NOT NULL,
  priority ENUM('low', 'medium', 'high', 'urgent'),
  status ENUM('new', 'under_review', 'in_progress', 'waiting_for_employee', 'resolved', 'closed'),
  routed_to ENUM('hr', 'admin') NOT NULL,
  attachment_url VARCHAR(500),
  assigned_to INT,
  resolution_notes TEXT,
  resolved_at DATETIME,
  resolved_by INT,
  created_at DATETIME,
  updated_at DATETIME
);

CREATE TABLE ticket_comments (
  id INT PRIMARY KEY,
  ticket_id INT NOT NULL,
  user_id INT NOT NULL,
  comment TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT FALSE,
  attachments JSON,
  created_at DATETIME
);
```

### API Endpoints

#### GET /api/tickets

- List tickets (filtered by user or all for admins)
- Query params: status, priority, routed_to, category, all

#### POST /api/tickets

- Create new ticket
- Auto-generates ticket number (TKT-YYYYMM-####)
- Auto-routes based on category

#### GET /api/tickets/[id]

- Get single ticket with comments
- Includes user names, assignment info

#### PUT /api/tickets

- Update ticket status, priority, assignment
- Admin/owner only

#### POST /api/tickets/[id]

- Add comment to ticket
- Auto-updates status from "waiting_for_employee" when employee comments

### File Structure

```
src/
├── app/
│   ├── tickets/
│   │   └── page.jsx           # Employee ticket view
│   ├── admin/
│   │   └── tickets/
│   │       └── page.jsx       # Admin/HR management view
│   └── api/
│       └── tickets/
│           ├── route.js       # Ticket CRUD
│           └── [id]/
│               └── route.js   # Ticket details & comments
```

## User Experience

### Employee Flow

1. Employee creates ticket → selects category
2. System shows "Routed to [HR/Admin]" confirmation
3. Employee tracks progress in dashboard
4. Receives updates via comments
5. Can respond if status is "Waiting for Employee"
6. Sees resolution notes when completed

### Admin/HR Flow

1. New tickets appear in dashboard
2. Review and move to "Under Review"
3. Assign to team member if needed
4. Work on request → "In Progress"
5. If need info → "Waiting for Employee"
6. Complete work → "Resolved" (add notes)
7. Archive → "Closed"

## Best Practices

### For Employees

- Choose the correct category for faster routing
- Provide detailed descriptions
- Attach relevant documents
- Respond promptly when status is "Waiting for You"
- Review resolution notes before closing

### For Admin/HR

- Acknowledge tickets quickly (New → Under Review)
- Assign to appropriate team members
- Add regular updates via comments
- Use "Waiting for Employee" when blocked
- Always add resolution notes when resolving
- Close tickets only when confirmed complete

## Future Enhancements

- Email notifications on status changes
- SLA tracking by priority level
- Ticket templates for common requests
- File upload instead of URL only
- Department-specific ticket queues
- Bulk ticket operations
- Advanced reporting and analytics
- Mobile-responsive design improvements
