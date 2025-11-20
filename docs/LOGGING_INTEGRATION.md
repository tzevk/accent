# Quick Integration Guide

## How to Add Activity Logging to Existing APIs

### Example 1: Add to Leads API

```javascript
// In /src/app/api/leads/route.js

import { logActivity } from '@/utils/activity-logger';

// POST - Create lead
export async function POST(request) {
  const auth = await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.CREATE);
  if (!auth.authorized) return NextResponse.json({ success: false }, { status: 401 });

  const data = await request.json();
  
  // ... existing lead creation code ...
  const [result] = await db.execute('INSERT INTO leads ...');
  const newLeadId = result.insertId;

  // ✨ ADD THIS: Log the activity
  logActivity({
    userId: auth.user.id,
    actionType: 'create',
    resourceType: 'leads',
    resourceId: newLeadId,
    description: `Created lead: ${data.company_name}`,
    details: { company: data.company_name, city: data.city },
    request: request
  }).catch(console.error); // Don't await, let it run async

  return NextResponse.json({ success: true, data: { id: newLeadId } });
}

// PUT - Update lead  
export async function PUT(request) {
  const auth = await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.UPDATE);
  if (!auth.authorized) return NextResponse.json({ success: false }, { status: 401 });

  const data = await request.json();
  
  // ✨ ADD THIS: Get old data before update (optional but recommended)
  const [oldData] = await db.execute('SELECT * FROM leads WHERE id = ?', [data.id]);
  
  // ... existing update code ...
  await db.execute('UPDATE leads SET ... WHERE id = ?', [data.id]);

  // ✨ ADD THIS: Log the update with before/after
  logActivity({
    userId: auth.user.id,
    actionType: 'update',
    resourceType: 'leads',
    resourceId: data.id,
    description: `Updated lead: ${data.company_name}`,
    details: { 
      before: oldData[0],
      after: data 
    },
    request: request
  }).catch(console.error);

  return NextResponse.json({ success: true });
}

// DELETE - Delete lead
export async function DELETE(request) {
  const auth = await ensurePermission(request, RESOURCES.LEADS, PERMISSIONS.DELETE);
  if (!auth.authorized) return NextResponse.json({ success: false }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // ✨ ADD THIS: Get lead name before deletion
  const [lead] = await db.execute('SELECT company_name FROM leads WHERE id = ?', [id]);
  
  // ... existing delete code ...
  await db.execute('DELETE FROM leads WHERE id = ?', [id]);

  // ✨ ADD THIS: Log the deletion
  logActivity({
    userId: auth.user.id,
    actionType: 'delete',
    resourceType: 'leads',
    resourceId: parseInt(id),
    description: `Deleted lead: ${lead[0]?.company_name || id}`,
    request: request
  }).catch(console.error);

  return NextResponse.json({ success: true });
}
```

### Example 2: Add to Projects API

```javascript
// In /src/app/api/projects/[id]/route.js

import { logActivity } from '@/utils/activity-logger';

export async function PUT(request, { params }) {
  const projectId = parseInt(params.id);
  
  // ... existing code ...
  
  // ✨ ADD THIS: Log project updates
  logActivity({
    userId: auth.user.id,
    actionType: 'update',
    resourceType: 'projects',
    resourceId: projectId,
    description: `Updated project: ${data.name}`,
    details: { 
      projectName: data.name,
      status: data.status 
    },
    request: request
  }).catch(console.error);

  // ✨ BONUS: Log activity assignments separately
  if (data.project_activities_list) {
    const assignedActivities = data.project_activities_list.filter(a => a.assigned_user);
    
    assignedActivities.forEach(activity => {
      logActivity({
        userId: auth.user.id,
        actionType: 'assign',
        resourceType: 'activities',
        resourceId: activity.id,
        description: `Assigned activity "${activity.name}" to user ${activity.assigned_user}`,
        details: {
          activityName: activity.name,
          assignedTo: activity.assigned_user,
          dueDate: activity.due_date,
          priority: activity.priority
        },
        request: request
      }).catch(console.error);
    });
  }

  return NextResponse.json({ success: true });
}
```

### Example 3: Track Page Views (Client-Side)

```javascript
// In /src/app/dashboard/page.jsx or any page

'use client';

import { useEffect } from 'react';
import { useSessionRBAC } from '@/utils/client-rbac';

export default function DashboardPage() {
  const { user } = useSessionRBAC();

  useEffect(() => {
    if (user?.id) {
      // ✨ ADD THIS: Log page view
      fetch('/api/activity-logs/track-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: window.location.pathname,
          title: document.title
        })
      }).catch(console.error);
    }
  }, [user?.id]);

  return <div>...</div>;
}
```

### Create the Track View Endpoint

```javascript
// Create new file: /src/app/api/activity-logs/track-view/route.js

import { NextResponse } from 'next/server';
import { logActivity } from '@/utils/activity-logger';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function POST(request) {
  try {
    const auth = await ensurePermission(request, RESOURCES.DASHBOARD, PERMISSIONS.READ);
    if (!auth.authorized) {
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const { page, title } = await request.json();

    await logActivity({
      userId: auth.user.id,
      actionType: 'view_page',
      resourceType: 'page',
      description: `Viewed ${page}`,
      details: { page, title },
      request: request
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error tracking page view:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
```

## Summary: 3 Steps to Add Logging

1. **Import the logger** at the top of your API file:
   ```javascript
   import { logActivity } from '@/utils/activity-logger';
   ```

2. **Call logActivity** after your database operations:
   ```javascript
   logActivity({
     userId: auth.user.id,
     actionType: 'create', // or 'update', 'delete', etc.
     resourceType: 'leads', // or 'projects', 'activities', etc.
     resourceId: newId,
     description: 'Human readable description',
     details: { any: 'extra', data: 'you want' },
     request: request
   }).catch(console.error);
   ```

3. **Don't await it** - Let it run asynchronously with `.catch(console.error)` so it doesn't slow down your API

That's it! The system will automatically:
- Track the timestamp
- Record IP address and user agent
- Update work sessions
- Update daily summaries
- Calculate productivity metrics
