# Screen Time & Activity Tracking System

## 🎯 Overview

Complete screen time detection and activity tracking system that monitors:
- ⏱️ Time spent on each page
- 🖱️ Mouse movements, clicks, scrolls
- ⌨️ Keyboard activity
- 👀 Tab visibility and focus/blur events
- 💤 Idle detection (2 minutes threshold)
- 📊 Real-time activity heartbeats
- 📈 Daily productivity scoring

## ✅ Setup Complete

All database tables have been created and the system is ready to use!

### New Database Tables

1. **`user_page_visits`** - Tracks time on each page
   - Page path, duration, interaction counts
   - Click, scroll, visibility change tracking
   - Idle/active state per visit

2. **`user_interactions`** - Detailed interaction log
   - Click positions, element info
   - Mouse movements, keypresses, scrolls
   - Focus/blur, navigation events

3. **`user_screen_time`** - Daily aggregated summary
   - Total screen time, active/idle breakdown
   - Pages visited, interaction counts
   - Productivity and focus scores

## 🚀 How It Works

### Automatic Tracking

The system is now integrated into your app layout and tracks everything automatically:

1. **ActivityTracker component** added to root layout
2. Tracks all user interactions in real-time
3. Sends heartbeat every 30 seconds
4. Checks for idle state every 10 seconds
5. Logs page navigation automatically

### What Gets Tracked

#### Page Navigation
- When user visits a page
- How long they stay on each page
- When they leave a page
- Referrer information

#### User Interactions
- **Mouse:** Movements (throttled to 5 sec), clicks with position
- **Keyboard:** Keypress events
- **Scroll:** Scroll events
- **Focus:** Window/tab focus and blur
- **Visibility:** Tab visibility changes

#### Session Management
- Session start timestamp
- Active time vs idle time
- Total activity count
- Session end with summary

#### Idle Detection
- Automatic idle after 2 minutes of inactivity
- Tracks idle/active transitions
- Calculates time spent in each state

## 📊 API Endpoints

### Get Screen Time Analytics
```bash
GET /api/screen-time?user_id=1&start_date=2025-11-01&end_date=2025-11-30
```

**Response:**
```json
{
  "success": true,
  "data": {
    "daily": [
      {
        "date": "2025-11-20",
        "total_screen_time_minutes": 480,
        "active_time_minutes": 420,
        "idle_time_minutes": 60,
        "pages_visited": 45,
        "unique_pages": 12,
        "total_clicks": 234,
        "total_scrolls": 156,
        "total_keypresses": 1890,
        "productivity_score": 87.5,
        "focus_score": 92.3
      }
    ],
    "pages": [
      {
        "page_path": "/dashboard",
        "visit_count": 15,
        "total_duration_seconds": 3600,
        "avg_duration_seconds": 240,
        "total_clicks": 89,
        "total_scrolls": 45
      }
    ],
    "interactions": [
      {
        "interaction_type": "click",
        "count": 234,
        "date": "2025-11-20"
      }
    ],
    "stats": {
      "totalDays": 30,
      "totalScreenTimeMinutes": 14400,
      "totalActiveTimeMinutes": 12600,
      "totalIdleTimeMinutes": 1800,
      "avgScreenTimePerDay": 480,
      "avgActiveTimePerDay": 420,
      "avgProductivityScore": 85.2,
      "avgFocusScore": 89.5
    }
  }
}
```

### Track Activity (Internal - Called by Client)
```bash
POST /api/activity-logs/track-activity
```

This is called automatically by the `useActivityTracker` hook.

## 🎨 Frontend Integration

The tracking is **already integrated globally** via the root layout. No additional setup needed!

### How to Use in Components

```jsx
import { useActivityTracker } from '@/hooks/useActivityTracker';

export default function MyComponent() {
  const { recordActivity, isIdle } = useActivityTracker();

  // Manual activity tracking (optional)
  const handleCustomAction = () => {
    recordActivity('custom_action', {
      actionName: 'button_clicked',
      buttonId: 'submit-button'
    });
  };

  return (
    <div>
      {isIdle && <div>User is idle</div>}
      <button onClick={handleCustomAction}>Click Me</button>
    </div>
  );
}
```

## 📈 Tracked Events

### Automatic Events

| Event Type | Description | Frequency |
|------------|-------------|-----------|
| `login` | User logs in | On login |
| `logout` | User logs out | On logout |
| `view_page` | Page navigation | On page change |
| `click` | Mouse click | Every click |
| `scroll` | Page scroll | Every scroll |
| `keypress` | Keyboard input | Every keypress |
| `mouse_move` | Mouse movement | Every 5 seconds |
| `focus` | Window focus | On focus |
| `blur` | Window blur | On blur |
| `visibility_change` | Tab visibility | On change |
| `status_change` | Idle/active change | On state change |
| `heartbeat` | Session heartbeat | Every 30 seconds |

### Heartbeat Data

Every 30 seconds, a heartbeat is sent with:
- Session duration
- Active time
- Idle time
- Activity count
- Current page
- Time since last activity

## 🔍 Productivity Scoring

The system calculates two scores:

### Focus Score
Based on:
- Time spent on productive pages
- Low context switching
- Fewer idle periods
- Consistent activity patterns

### Productivity Score
Based on:
- Active time vs idle time ratio
- Number of meaningful interactions
- Task completion indicators
- Work session quality

## 💡 Usage Examples

### View User's Screen Time Dashboard

```jsx
'use client';

import { useState, useEffect } from 'react';

export default function ScreenTimeDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/screen-time?start_date=2025-11-01&end_date=2025-11-30')
      .then(res => res.json())
      .then(result => setData(result.data));
  }, []);

  if (!data) return <div>Loading...</div>;

  return (
    <div>
      <h1>Screen Time Analytics</h1>
      
      {/* Daily Summary */}
      <div>
        <h2>Daily Activity</h2>
        {data.daily.map(day => (
          <div key={day.date}>
            <p>{day.date}</p>
            <p>Screen Time: {day.total_screen_time_minutes} min</p>
            <p>Active: {day.active_time_minutes} min</p>
            <p>Productivity: {day.productivity_score}%</p>
          </div>
        ))}
      </div>

      {/* Top Pages */}
      <div>
        <h2>Most Visited Pages</h2>
        {data.pages.map(page => (
          <div key={page.page_path}>
            <p>{page.page_path}</p>
            <p>Visits: {page.visit_count}</p>
            <p>Total Time: {Math.round(page.total_duration_seconds / 60)} min</p>
          </div>
        ))}
      </div>

      {/* Overall Stats */}
      <div>
        <h2>Overall Statistics</h2>
        <p>Avg Screen Time: {data.stats.avgScreenTimePerDay} min/day</p>
        <p>Avg Productivity: {data.stats.avgProductivityScore}%</p>
        <p>Total Clicks: {data.stats.totalClicks}</p>
      </div>
    </div>
  );
}
```

### Query Activity Logs

```sql
-- Most active users by screen time
SELECT 
  u.full_name,
  SUM(ust.total_screen_time_minutes) as total_minutes,
  AVG(ust.productivity_score) as avg_productivity
FROM user_screen_time ust
JOIN users u ON ust.user_id = u.id
WHERE ust.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY u.id
ORDER BY total_minutes DESC;

-- Page performance (where users spend most time)
SELECT 
  page_path,
  COUNT(*) as visits,
  AVG(duration_seconds) as avg_seconds,
  SUM(clicks_count) as total_clicks
FROM user_page_visits
GROUP BY page_path
ORDER BY visits DESC;

-- User activity patterns
SELECT 
  user_id,
  HOUR(created_at) as hour,
  COUNT(*) as activity_count
FROM user_activity_logs
WHERE DATE(created_at) = CURDATE()
GROUP BY user_id, HOUR(created_at)
ORDER BY user_id, hour;
```

## 🔧 Configuration

### Adjust Tracking Parameters

Edit `/src/hooks/useActivityTracker.js`:

```javascript
const IDLE_THRESHOLD = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_INTERVAL = 30 * 1000; // 30 seconds
const IDLE_CHECK_INTERVAL = 10 * 1000; // 10 seconds
```

### Disable Tracking for Specific Users

```javascript
// In useActivityTracker hook
if (!user?.id || user.trackingDisabled) return;
```

## 🛡️ Privacy & Performance

### Performance Optimizations
- Mouse movements throttled to 5 seconds
- Heartbeats sent every 30 seconds (not every action)
- Idle checks every 10 seconds
- All tracking runs asynchronously (non-blocking)

### Privacy Considerations
- Users can only view their own data (unless admin)
- No keystroke content is logged (only counts)
- IP addresses logged for security only
- Data retention policies should be implemented

### Data Retention

```sql
-- Clean up old data (recommended: run monthly)
DELETE FROM user_page_visits WHERE visit_start < DATE_SUB(NOW(), INTERVAL 90 DAY);
DELETE FROM user_interactions WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY);
DELETE FROM user_screen_time WHERE date < DATE_SUB(CURDATE(), INTERVAL 1 YEAR);
```

## 🎯 Next Steps

1. **Create Admin Dashboard** to view all users' screen time
2. **Add Charts** for visual analytics
3. **Set up Alerts** for unusual activity patterns
4. **Export Reports** to PDF/CSV
5. **Add Time Tracking** integration with payroll
6. **Implement Productivity Goals** and gamification

## 🐛 Troubleshooting

### Tracking Not Working?
- Check browser console for errors
- Verify user is logged in
- Check API endpoint permissions

### Data Not Appearing?
- Wait 30 seconds for first heartbeat
- Check database connection
- Verify tables were created correctly

### High Database Load?
- Increase heartbeat interval
- Disable mouse movement tracking
- Batch insert operations

## 📝 Summary

The complete screen time and activity tracking system is now **fully operational**:

✅ Database tables created  
✅ API endpoints ready  
✅ Frontend tracking integrated  
✅ Automatic logging enabled  
✅ Idle detection working  
✅ Heartbeat monitoring active  
✅ Productivity scoring calculated  

**Everything is tracked automatically - no additional setup required!**
