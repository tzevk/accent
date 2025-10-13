# Project Activities with Manhours - Documentation

## Overview
This feature enables tracking activities within projects with detailed manhour planning and tracking. It includes the ability to create custom activities that are automatically saved to the master activity list.

## Database Schema

### Table: `project_activities`
Stores activities assigned to specific projects with manhour tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR(36) | Primary key (UUID) |
| project_id | INT | Foreign key to projects table |
| activity_id | VARCHAR(36) | Reference to activities_master (nullable for custom activities) |
| activity_name | VARCHAR(255) | Name of the activity |
| discipline_id | VARCHAR(36) | Reference to functions_master |
| discipline_name | VARCHAR(255) | Name of the discipline |
| start_date | DATE | Planned start date |
| end_date | DATE | Planned end date |
| manhours_planned | DECIMAL(10,2) | Estimated manhours |
| manhours_actual | DECIMAL(10,2) | Actual manhours spent |
| status | VARCHAR(50) | Status: Pending, In Progress, Completed, On Hold, Cancelled |
| progress_percentage | DECIMAL(5,2) | Completion percentage (0-100) |
| notes | TEXT | Additional notes or comments |
| created_at | TIMESTAMP | Record creation timestamp |
| updated_at | TIMESTAMP | Last update timestamp |

## API Endpoints

### 1. Get Project Activities
**Endpoint:** `GET /api/projects/[id]/activities`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "project_id": 1,
      "activity_id": "activity-uuid",
      "activity_name": "Piping Design",
      "discipline_id": "discipline-uuid",
      "discipline_name": "Mechanical",
      "start_date": "2025-01-01",
      "end_date": "2025-03-31",
      "manhours_planned": 120.00,
      "manhours_actual": 95.50,
      "status": "In Progress",
      "progress_percentage": 75.00,
      "notes": "On track",
      "created_at": "2025-01-01T10:00:00Z",
      "updated_at": "2025-02-15T14:30:00Z"
    }
  ]
}
```

### 2. Add Activity to Project
**Endpoint:** `POST /api/projects/[id]/activities`

**Request Body:**
```json
{
  "activity_id": "uuid",          // Optional: existing activity from master
  "activity_name": "Custom Task", // Required
  "discipline_id": "uuid",
  "discipline_name": "Electrical",
  "start_date": "2025-02-01",
  "end_date": "2025-04-30",
  "manhours_planned": 80.00,
  "manhours_actual": 0.00,
  "status": "Pending",
  "progress_percentage": 0,
  "notes": "New custom activity",
  "save_to_master": true          // If true, saves to activities_master
}
```

**Response:**
```json
{
  "success": true,
  "message": "Activity added successfully",
  "id": "project-activity-uuid",
  "activity_id": "master-activity-uuid"
}
```

### 3. Update Project Activity
**Endpoint:** `PUT /api/projects/[id]/activities`

**Request Body:**
```json
{
  "activity_record_id": "uuid",   // Required: ID of project_activities record
  "activity_name": "Updated Name",
  "start_date": "2025-02-15",
  "end_date": "2025-05-15",
  "manhours_planned": 100.00,
  "manhours_actual": 50.00,
  "status": "In Progress",
  "progress_percentage": 50.00,
  "notes": "Updated progress"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Activity updated successfully"
}
```

### 4. Delete Project Activity
**Endpoint:** `DELETE /api/projects/[id]/activities?activity_record_id={uuid}`

**Response:**
```json
{
  "success": true,
  "message": "Activity removed successfully"
}
```

## Frontend Features

### Activities Tab in Edit Project Page
Located in `/projects/[id]/edit/page.jsx` under the "Activities" tab.

#### Key Components:

1. **Add Activity Button**
   - Opens form to add existing activities from master list
   - Allows input of manhours, dates, status, and progress

2. **Create Custom Activity Button**
   - Opens modal for creating new activities
   - Automatically saves to activities_master
   - Immediately adds to current project

3. **Activities Table**
   - Displays all project activities with:
     - Activity name and discipline
     - Start and end dates
     - Planned vs actual manhours
     - Variance calculation (with percentage)
     - Status badge
     - Progress percentage
     - Remove action

4. **Summary Statistics**
   - Total Planned Manhours
   - Total Actual Manhours
   - Total Variance (color-coded: red for over, green for under)

5. **Browse & Add from Master**
   - Browse activities by discipline
   - Quick-add button for each activity
   - Visual indicator for already-added activities

### Custom Activity Creation Modal

**Fields:**
- **Discipline** (required): Select from existing disciplines
- **Activity Name** (required): Name for the new activity
- **Default Manhours** (optional): Initial manhour estimate

**Behavior:**
- Saves activity to `activities_master` table
- Links to selected discipline (function)
- Automatically adds to current project
- Refreshes both activities catalog and project activities list

### Activity Addition Form

**Fields:**
- **Discipline**: Select discipline
- **Activity**: Select activity (filtered by discipline)
- **Start Date**: Planned start
- **End Date**: Planned completion
- **Planned Manhours**: Estimated hours
- **Actual Manhours**: Hours spent (can be updated)
- **Status**: Pending | In Progress | Completed | On Hold | Cancelled
- **Progress %**: 0-100
- **Notes**: Additional comments

## Variance Calculation

### Formula
```
Variance = Actual Manhours - Planned Manhours
Variance % = (Variance / Planned Manhours) * 100
```

### Color Coding
- **Red (Over Budget)**: Actual > Planned (positive variance)
- **Green (Under Budget)**: Actual < Planned (negative variance)
- **Gray (On Budget)**: Actual = Planned (zero variance)

## Usage Workflow

### Adding an Existing Activity
1. Click "Add Activity" button
2. Select discipline and activity from dropdowns
3. Enter dates, manhours, and other details
4. Click "Add Activity"
5. Activity appears in table with manhour tracking

### Creating a Custom Activity
1. Click "Create Custom Activity" button
2. Select discipline
3. Enter unique activity name
4. Optionally enter default manhours
5. Click "Create & Add to Project"
6. Activity is:
   - Saved to activities_master
   - Added to current project
   - Available for all future projects

### Quick Add from Master List
1. Scroll to "Browse & Add from Master Activities" section
2. Find desired activity under its discipline
3. Click activity button
4. Form opens pre-filled with activity details
5. Complete dates and manhours
6. Submit to add to project

### Updating Manhours
- Activities are displayed in editable table format
- Direct inline editing (future enhancement)
- Currently: modify through form or re-add with updated values

## Integration with Project API

The main project GET endpoint `/api/projects/[id]` now includes project activities:

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "Project Name",
    // ... other project fields
    "project_activities": [
      {
        "id": "uuid",
        "activity_name": "Design Review",
        "manhours_planned": 40.00,
        "manhours_actual": 35.00,
        // ... other activity fields
      }
    ]
  }
}
```

## State Management

### Key State Variables
```javascript
const [projectActivities, setProjectActivities] = useState([]);
const [showActivityForm, setShowActivityForm] = useState(false);
const [showCustomActivityModal, setShowCustomActivityModal] = useState(false);
const [activityForm, setActivityForm] = useState({...});
const [customActivityForm, setCustomActivityForm] = useState({...});
```

### Key Functions
- `handleAddActivityToProject()`: Adds activity to project
- `handleUpdateProjectActivity()`: Updates existing activity
- `handleDeleteProjectActivity()`: Removes activity from project
- `handleCreateCustomActivity()`: Creates new master activity and adds to project
- `handleAddExistingActivityToProject()`: Quick-add from master list

## Database Migration

To set up the project_activities table, run:

```bash
node scripts/create-project-activities-table.js
```

This creates the table with all necessary columns, indexes, and foreign key constraints.

## Benefits

1. **Detailed Tracking**: Track manhours at activity level
2. **Variance Analysis**: See over/under budget in real-time
3. **Flexible**: Add standard or custom activities
4. **Master List Growth**: Custom activities enrich the master catalog
5. **Project Planning**: Plan with start/end dates
6. **Progress Monitoring**: Track status and completion percentage
7. **Historical Data**: Maintain activity history per project

## Future Enhancements

1. **Inline Editing**: Edit manhours directly in table
2. **Bulk Import**: Import activities from CSV
3. **Activity Templates**: Save common activity sets
4. **Resource Allocation**: Link activities to employees
5. **Gantt Chart**: Visual timeline of activities
6. **Alerts**: Notifications for variance thresholds
7. **Reports**: Activity manhour reports and analytics
8. **Approval Workflow**: Require approval for manhour updates

## Error Handling

- Validates required fields (activity_name, discipline for custom activities)
- Graceful fallback if project_activities table doesn't exist
- Clear error messages for API failures
- Confirmation dialogs for destructive actions (delete)

## Performance Considerations

- Activities loaded on project fetch (single query)
- Indexed on project_id for fast retrieval
- Pagination recommended for projects with 100+ activities
- Lazy loading of activity details in future versions

## Security

- Foreign key constraints ensure data integrity
- Activity records cascade delete with project
- No direct database access from frontend
- API validates project ownership (when auth is implemented)

---

**Last Updated:** October 9, 2025  
**Version:** 1.0.0  
**Status:** Production Ready
