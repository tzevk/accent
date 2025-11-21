# User Activity Logging System

## Overview
Complete activity tracking system that monitors all user actions, work sessions, and generates productivity analytics.

## Database Tables

### 1. `user_activity_logs`
Stores every user action in the system.

**Columns:**
- `id` - Primary key
- `user_id` - User performing the action
- `action_type` - Type of action (login, create, update, delete, etc.)
- `resource_type` - Type of resource affected (leads, projects, activities, etc.)
- `resource_id` - ID of the affected resource
- `description` - Human-readable description
- `details` - JSON field for additional data
- `ip_address` - User's IP address
- `user_agent` - Browser/device information
- `session_id` - Session identifier
- `duration_seconds` - How long the action took
- `status` - success, failed, or pending
- `created_at` - Timestamp

### 2. `user_work_sessions`
Tracks active work sessions for time tracking.

**Columns:**
- `session_start` - When user started working
- `session_end` - When user stopped working
- `duration_minutes` - Total work time
- `activities_count` - Number of actions performed
- `pages_viewed` - Number of pages visited
- `resources_modified` - Number of items created/updated/deleted
- `status` - active, idle, or ended

### 3. `user_daily_summary`
Daily aggregated statistics per user.

**Columns:**
- `date` - The date
- `total_work_minutes` - Total work time for the day
- `login_count` - Number of logins
- `activities_completed` - Total activities
- `resources_created/updated/deleted` - Counts by operation type
- `pages_viewed` - Pages visited count
- `first_login` - First login time
- `last_activity` - Last action time
- `productivity_score` - Calculated score

## Setup

### 1. Create Database Tables
```bash
node scripts/create-activity-logs-table.js
```

This will create all three tables with proper indexes and foreign keys.

### 2. Logging Functions

#### Log Any Activity
```javascript
import { logActivity } from '@/utils/activity-logger';

// In your API route
await logActivity({
  userId: user.id,
  actionType: 'create',
  resourceType: 'leads',
  resourceId: newLead.id,
  description: 'Created new lead',
  details: { leadName: newLead.name, status: newLead.status },
  request: request, // Pass Next.js request object
  status: 'success'
});
```

#### End User Session (on logout)
```javascript
import { endUserSession } from '@/utils/activity-logger';

await endUserSession(userId);
```

#### Fetch Activity Logs
```javascript
import { getUserActivityLogs } from '@/utils/activity-logger';

const logs = await getUserActivityLogs({
  userId: 123,
  actionType: 'update',
  resourceType: 'projects',
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  limit: 50,
  offset: 0
});
```

## API Endpoints

### Get Activity Logs
```
GET /api/activity-logs?user_id=1&action_type=create&start_date=2025-01-01&limit=100&page=1
```

**Query Parameters:**
- `user_id` - Filter by user (admin only, regular users see their own)
- `action_type` - Filter by action (login, create, update, etc.)
- `resource_type` - Filter by resource (leads, projects, etc.)
- `start_date` - Filter by start date (YYYY-MM-DD)
- `end_date` - Filter by end date (YYYY-MM-DD)
- `limit` - Results per page (default: 100)
- `page` - Page number (default: 1)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "user_id": 5,
      "username": "john.doe",
      "full_name": "John Doe",
      "action_type": "create",
      "resource_type": "leads",
      "resource_id": 123,
      "description": "Created new lead",
      "details": { "leadName": "ABC Corp" },
      "ip_address": "192.168.1.1",
      "user_agent": "Mozilla/5.0...",
      "status": "success",
      "created_at": "2025-11-20 10:30:00"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 500,
    "totalPages": 5
  }
}
```

### Get Work Summary
```
GET /api/work-summary?user_id=1&start_date=2025-11-01&end_date=2025-11-30
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "date": "2025-11-20",
      "user_id": 1,
      "username": "john.doe",
      "total_work_minutes": 480,
      "login_count": 2,
      "activities_completed": 45,
      "resources_created": 5,
      "resources_updated": 20,
      "resources_deleted": 2,
      "pages_viewed": 120,
      "first_login": "2025-11-20 09:00:00",
      "last_activity": "2025-11-20 17:30:00"
    }
  ],
  "stats": {
    "totalDays": 30,
    "totalWorkMinutes": 14400,
    "totalActivities": 1350,
    "averageWorkMinutesPerDay": 480,
    "averageActivitiesPerDay": 45
  }
}
```

## Action Types

- `login` - User logged in
- `logout` - User logged out
- `create` - Created a resource
- `read` - Viewed a resource
- `update` - Updated a resource
- `delete` - Deleted a resource
- `view_page` - Visited a page
- `download` - Downloaded a file
- `upload` - Uploaded a file
- `assign` - Assigned task/activity
- `approve` - Approved something
- `reject` - Rejected something
- `comment` - Added a comment
- `status_change` - Changed status
- `other` - Other actions

## Integration Examples

### Track Lead Creation
```javascript
// In /api/leads/route.js POST
const result = await db.execute('INSERT INTO leads ...');
const newLeadId = result[0].insertId;

await logActivity({
  userId: auth.user.id,
  actionType: 'create',
  resourceType: 'leads',
  resourceId: newLeadId,
  description: `Created lead: ${data.company_name}`,
  details: { company: data.company_name, status: data.status },
  request: request
});
```

### Track Page Views
```javascript
// In any page component
useEffect(() => {
  if (user?.id) {
    fetch('/api/activity-logs', {
      method: 'POST',
      body: JSON.stringify({
        userId: user.id,
        actionType: 'view_page',
        resourceType: 'page',
        description: `Viewed ${window.location.pathname}`
      })
    });
  }
}, [user]);
```

### Track Updates
```javascript
// In /api/projects/[id]/route.js PUT
await logActivity({
  userId: auth.user.id,
  actionType: 'update',
  resourceType: 'projects',
  resourceId: projectId,
  description: `Updated project: ${data.name}`,
  details: { 
    changes: {
      before: oldProject,
      after: data
    }
  },
  request: request
});
```

## Best Practices

1. **Always log important actions** - Create, Update, Delete operations
2. **Include context in details** - Store before/after states for updates
3. **Don't log sensitive data** - Passwords, tokens, etc.
4. **Use descriptive action_type** - Makes filtering easier
5. **Pass request object** - Automatically captures IP and user agent
6. **Log asynchronously** - Use `.catch(console.error)` to not block main flow
7. **Set status correctly** - 'success' for completed, 'failed' for errors

## Dashboard Integration

The system automatically tracks:
- Login/logout times
- Active work sessions
- Daily activity counts
- Resource modifications
- Page navigation

This data can be displayed in:
- User productivity dashboards
- Admin monitoring panels
- Time tracking reports
- Audit logs
- Analytics charts

## Security & Privacy

- Users can only view their own logs (unless admin)
- IP addresses are stored for security auditing
- Sensitive data should never be logged
- Logs can be purged after retention period
- Failed login attempts are tracked for security

## Maintenance

### Purge Old Logs
```sql
-- Delete logs older than 90 days
DELETE FROM user_activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- Delete old work sessions
DELETE FROM user_work_sessions WHERE session_start < DATE_SUB(NOW(), INTERVAL 90 DAY);

-- Delete old daily summaries (keep 1 year)
DELETE FROM user_daily_summary WHERE date < DATE_SUB(CURDATE(), INTERVAL 1 YEAR);
```

### Analyze Performance
```sql
-- Top active users
SELECT user_id, COUNT(*) as activity_count 
FROM user_activity_logs 
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY user_id 
ORDER BY activity_count DESC 
LIMIT 10;

-- Most common actions
SELECT action_type, COUNT(*) as count 
FROM user_activity_logs 
GROUP BY action_type 
ORDER BY count DESC;

-- Average work hours by user
SELECT user_id, AVG(total_work_minutes)/60 as avg_hours_per_day
FROM user_daily_summary
WHERE date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY user_id;
```
