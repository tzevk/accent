import { dbConnect } from '@/utils/database';

/**
 * Utility function to log user activity
 * @param {Object} params - Activity logging parameters
 * @param {number} params.userId - ID of the user performing the action
 * @param {string} params.actionType - Type of action (login, create, update, etc.)
 * @param {string} params.resourceType - Type of resource affected (leads, projects, etc.)
 * @param {number} params.resourceId - ID of the affected resource
 * @param {string} params.description - Human-readable description
 * @param {Object} params.details - Additional JSON details
 * @param {Request} params.request - Next.js request object for IP/user agent
 * @param {string} params.status - success, failed, or pending
 */
export async function logActivity({
  userId,
  actionType,
  resourceType = null,
  resourceId = null,
  description = '',
  details = null,
  request = null,
  status = 'success'
}) {
  let db;
  try {
    db = await dbConnect();

    // Extract IP and user agent from request
    let ipAddress = null;
    let userAgent = null;

    if (request) {
      // Get IP address from various headers
      ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                  request.headers.get('x-real-ip') ||
                  request.headers.get('cf-connecting-ip') ||
                  null;
      
      userAgent = request.headers.get('user-agent') || null;
    }

    await db.execute(
      `INSERT INTO user_activity_logs 
       (user_id, action_type, resource_type, resource_id, description, details, ip_address, user_agent, status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        actionType,
        resourceType,
        resourceId,
        description,
        details ? JSON.stringify(details) : null,
        ipAddress,
        userAgent,
        status
      ]
    );

    // Update work session and daily summary asynchronously (don't block)
    updateWorkSession(userId, actionType).catch(console.error);

  } catch (error) {
    console.error('Error logging activity:', error);
    // Don't throw - logging failures shouldn't break the main flow
  } finally {
    if (db) await db.end();
  }
}

/**
 * Update active work session
 */
async function updateWorkSession(userId, actionType) {
  let db;
  try {
    db = await dbConnect();

    // Get or create today's active session
    const [sessions] = await db.execute(
      `SELECT id FROM user_work_sessions 
       WHERE user_id = ? AND status = 'active' AND DATE(session_start) = CURDATE()
       ORDER BY session_start DESC LIMIT 1`,
      [userId]
    );

    if (sessions.length > 0) {
      // Update existing session
      await db.execute(
        `UPDATE user_work_sessions 
         SET activities_count = activities_count + 1,
             pages_viewed = pages_viewed + IF(? = 'view_page', 1, 0),
             resources_modified = resources_modified + IF(? IN ('create', 'update', 'delete'), 1, 0),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [actionType, actionType, sessions[0].id]
      );
    } else if (actionType === 'login') {
      // Create new session on login
      await db.execute(
        `INSERT INTO user_work_sessions (user_id, session_start, activities_count) 
         VALUES (?, CURRENT_TIMESTAMP, 1)`,
        [userId]
      );
    }

    // Update daily summary
    await db.execute(
      `INSERT INTO user_daily_summary 
       (user_id, date, login_count, activities_completed, resources_created, resources_updated, resources_deleted, pages_viewed, first_login, last_activity)
       VALUES (?, CURDATE(), IF(? = 'login', 1, 0), 1, IF(? = 'create', 1, 0), IF(? = 'update', 1, 0), IF(? = 'delete', 1, 0), IF(? = 'view_page', 1, 0), IF(? = 'login', CURRENT_TIMESTAMP, NULL), CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE
         login_count = login_count + IF(? = 'login', 1, 0),
         activities_completed = activities_completed + 1,
         resources_created = resources_created + IF(? = 'create', 1, 0),
         resources_updated = resources_updated + IF(? = 'update', 1, 0),
         resources_deleted = resources_deleted + IF(? = 'delete', 1, 0),
         pages_viewed = pages_viewed + IF(? = 'view_page', 1, 0),
         first_login = COALESCE(first_login, IF(? = 'login', CURRENT_TIMESTAMP, NULL)),
         last_activity = CURRENT_TIMESTAMP`,
      [userId, actionType, actionType, actionType, actionType, actionType, actionType, actionType, actionType, actionType, actionType, actionType, actionType]
    );

  } catch (error) {
    console.error('Error updating work session:', error);
  } finally {
    if (db) await db.end();
  }
}

/**
 * End user session (call on logout)
 */
export async function endUserSession(userId) {
  let db;
  try {
    db = await dbConnect();

    // End active sessions
    await db.execute(
      `UPDATE user_work_sessions 
       SET session_end = CURRENT_TIMESTAMP,
           duration_minutes = TIMESTAMPDIFF(MINUTE, session_start, CURRENT_TIMESTAMP),
           status = 'ended'
       WHERE user_id = ? AND status = 'active'`,
      [userId]
    );

    // Update daily summary with total work minutes
    await db.execute(
      `UPDATE user_daily_summary uds
       JOIN (
         SELECT user_id, DATE(session_start) as work_date, SUM(duration_minutes) as total_minutes
         FROM user_work_sessions
         WHERE user_id = ? AND DATE(session_start) = CURDATE() AND status = 'ended'
         GROUP BY user_id, DATE(session_start)
       ) ws ON uds.user_id = ws.user_id AND uds.date = ws.work_date
       SET uds.total_work_minutes = ws.total_minutes`,
      [userId]
    );

  } catch (error) {
    console.error('Error ending user session:', error);
  } finally {
    if (db) await db.end();
  }
}

/**
 * Get user activity logs with filters
 */
export async function getUserActivityLogs({
  userId = null,
  actionType = null,
  resourceType = null,
  startDate = null,
  endDate = null,
  limit = 100,
  offset = 0
}) {
  let db;
  try {
    db = await dbConnect();

    let query = `
      SELECT 
        ual.*,
        u.username,
        u.full_name
      FROM user_activity_logs ual
      LEFT JOIN users u ON ual.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      query += ` AND ual.user_id = ?`;
      params.push(userId);
    }

    if (actionType) {
      query += ` AND ual.action_type = ?`;
      params.push(actionType);
    }

    if (resourceType) {
      query += ` AND ual.resource_type = ?`;
      params.push(resourceType);
    }

    if (startDate) {
      query += ` AND ual.created_at >= ?`;
      params.push(startDate);
    }

    if (endDate) {
      query += ` AND ual.created_at <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY ual.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const [logs] = await db.execute(query, params);

    return logs;

  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return [];
  } finally {
    if (db) await db.end();
  }
}

/**
 * Get current status for a single user
 * @param {number} userId - User ID
 * @returns {Object} - { status, lastActivity, currentPage, sessionDuration }
 */
export async function getUserCurrentStatus(userId) {
  let db;
  try {
    db = await dbConnect();

    // Get user's last activity and current page
    const [result] = await db.execute(
      `SELECT 
        u.id,
        u.username,
        u.full_name,
        (SELECT MAX(created_at) FROM user_activity_logs WHERE user_id = u.id) as last_activity,
        (SELECT description FROM user_activity_logs 
         WHERE user_id = u.id AND action_type = 'view_page' 
         ORDER BY created_at DESC LIMIT 1) as current_page,
        (SELECT session_start FROM user_work_sessions 
         WHERE user_id = u.id AND status = 'active' 
         ORDER BY session_start DESC LIMIT 1) as session_start
      FROM users u
      WHERE u.id = ?`,
      [userId]
    );

    if (!result || result.length === 0) {
      return { status: 'offline', lastActivity: null, currentPage: null, sessionDuration: null };
    }

    const user = result[0];
    const status = getStatusFromActivity(user.last_activity);
    
    let sessionDuration = null;
    if (user.session_start && status === 'online') {
      sessionDuration = Math.floor((Date.now() - new Date(user.session_start).getTime()) / 1000);
    }

    return {
      status,
      lastActivity: user.last_activity,
      currentPage: user.current_page,
      sessionDuration,
      username: user.username,
      fullName: user.full_name
    };

  } catch (error) {
    console.error('Error getting user status:', error);
    return { status: 'offline', lastActivity: null, currentPage: null, sessionDuration: null };
  } finally {
    if (db) await db.end();
  }
}

/**
 * Get current status for all users or multiple users
 * @param {Array<number>} userIds - Optional array of user IDs (if null, gets all users)
 * @returns {Array} - Array of user status objects
 */
export async function getAllUsersStatus(userIds = null) {
  let db;
  try {
    db = await dbConnect();

    let query = `
      SELECT 
        u.id as user_id,
        u.username,
        u.full_name,
        u.email,
        r.role_name,
        (SELECT MAX(created_at) FROM user_activity_logs WHERE user_id = u.id) as last_activity,
        (SELECT description FROM user_activity_logs 
         WHERE user_id = u.id AND action_type = 'view_page' 
         ORDER BY created_at DESC LIMIT 1) as current_page,
        (SELECT session_start FROM user_work_sessions 
         WHERE user_id = u.id AND status = 'active' 
         ORDER BY session_start DESC LIMIT 1) as session_start
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
    `;

    let params = [];
    if (userIds && userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(',');
      query += ` WHERE u.id IN (${placeholders})`;
      params = userIds;
    }

    query += ` ORDER BY u.full_name`;

    const [users] = await db.execute(query, params);

    // Add status to each user
    const usersWithStatus = users.map(user => {
      const status = getStatusFromActivity(user.last_activity);
      
      let sessionDuration = null;
      if (user.session_start && status === 'online') {
        sessionDuration = Math.floor((Date.now() - new Date(user.session_start).getTime()) / 1000);
      }

      return {
        ...user,
        status,
        session_duration: sessionDuration
      };
    });

    return usersWithStatus;

  } catch (error) {
    console.error('Error getting all users status:', error);
    return [];
  } finally {
    if (db) await db.end();
  }
}

/**
 * Helper: Determine status from last activity timestamp
 */
function getStatusFromActivity(lastActivity) {
  if (!lastActivity) return 'offline';
  
  const seconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
  
  if (seconds < 120) return 'online';  // Active (< 2 min)
  if (seconds < 600) return 'idle';    // Idle (< 10 min)
  return 'offline';                     // Away (> 10 min)
}
