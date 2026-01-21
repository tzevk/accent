/**
 * SmartOffice SQL Server Database Connection
 * READ-ONLY connection to external attendance system
 */

import sql from 'mssql';

const config = {
  server: '172.16.1.40',
  port: 84,
  database: 'SmartOfficedb',
  user: 'sa',
  password: 'Biomax@123',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    instanceName: 'SQLEXPRESS',
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool = null;

/**
 * Connect to SmartOffice SQL Server database
 * @returns {Promise<sql.ConnectionPool>}
 */
export async function connectSmartOffice() {
  if (pool) {
    return pool;
  }
  
  try {
    pool = await sql.connect(config);
    console.log('Connected to SmartOffice SQL Server');
    return pool;
  } catch (error) {
    console.error('SmartOffice DB connection error:', error);
    throw error;
  }
}

/**
 * Close the SmartOffice connection
 */
export async function closeSmartOffice() {
  if (pool) {
    await pool.close();
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
