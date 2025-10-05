import dotenv from "dotenv";
import { dbConnect } from "../database.js";

// Load environment variables from .env.local
dotenv.config({ path: ".env" });

async function runMigration() {
  let connection;
  try {
    connection = await dbConnect({ multipleStatements: true });

    const createFunctionsTable = `
      CREATE TABLE IF NOT EXISTS functions_master (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        function_name VARCHAR(100) UNIQUE NOT NULL,
        status ENUM('active', 'inactive') DEFAULT 'active',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `;

    const createActivitiesTable = `
      CREATE TABLE IF NOT EXISTS activities_master (
        id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
        function_id CHAR(36),
        activity_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (function_id) REFERENCES functions_master(id) ON DELETE SET NULL
      );
    `;

    await connection.query(createFunctionsTable);
    await connection.query(createActivitiesTable);
    console.log("✅ Successfully created 'functions' and 'activities' tables");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

runMigration();
