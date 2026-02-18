/**
 * SmartOffice SQL Server Database Connection
 * READ-ONLY connection to external attendance system
 */

import sql from 'mssql';

const config = {
  server: process.env.SMARTOFFICE_SERVER,
  port: parseInt(process.env.SMARTOFFICE_PORT || '84'),
  database: process.env.SMARTOFFICE_DATABASE,
  user: process.env.SMARTOFFICE_USER,
  password: process.env.SMARTOFFICE_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    instanceName: process.env.SMARTOFFICE_INSTANCE || 'SQLEXPRESS',
  },
  pool: {
    max: 3,               // Reduced from 5 for shared server
    min: 0,
    idleTimeoutMillis: 20000, // Reduced from 30s — close idle connections sooner
  },
  requestTimeout: 15000,    // 15s query timeout to prevent hanging connections
  connectionTimeout: 10000, // 10s connection timeout
};

let pool = null;

/**
 * Connect to SmartOffice SQL Server database
 * @returns {Promise<sql.ConnectionPool>}
 */
export async function connectSmartOffice() {
  if (!config.server || !config.user || !config.password) {
    throw new Error('SmartOffice DB credentials not configured. Set SMARTOFFICE_SERVER, SMARTOFFICE_USER, SMARTOFFICE_PASSWORD, and SMARTOFFICE_DATABASE in .env.local');
  }
  
  if (pool && pool.connected) {
    return pool;
  }
  
  // If pool exists but isn't connected (e.g., disconnected), close and recreate
  if (pool) {
    try { await pool.close(); } catch (e) { /* ignore */ }
    pool = null;
  }
  
  try {
    pool = await sql.connect(config);
    console.log('Connected to SmartOffice SQL Server');
    
    // Handle unexpected disconnections
    pool.on('error', (err) => {
      console.error('SmartOffice pool error:', err);
      pool = null;
    });
    
    return pool;
  } catch (error) {
    pool = null;
    console.error('SmartOffice DB connection error:', error);
    throw error;
  }
}

/**
 * Close the SmartOffice connection
 */
export async function closeSmartOffice() {
  if (pool) {
    try {
      await pool.close();
    } catch (err) {
      console.error('Error closing SmartOffice pool:', err);
    }
    pool = null;
  }
}

/**
 * Execute a read-only query on SmartOffice database
 * @param {string} query - SQL query (SELECT only)
 * @param {object} params - Query parameters
 * @returns {Promise<any[]>}
 */
export async function querySmartOffice(query, params = {}) {
  const conn = await connectSmartOffice();
  const request = conn.request();
  
  // Add parameters
  for (const [key, value] of Object.entries(params)) {
    request.input(key, value);
  }
  
  const result = await request.query(query);
  return result.recordset;
}

export default { connectSmartOffice, closeSmartOffice, querySmartOffice };
