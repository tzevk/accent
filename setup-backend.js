#!/usr/bin/env node

/**
 * AccentCRM Backend Setup Script
 * This script sets up the database, creates tables, and initializes the backend
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer);
    });
  });
}

async function checkEnvironmentFile() {
  const envPath = path.join(process.cwd(), '.env.local');
  
  if (fs.existsSync(envPath)) {
    log('✅ Found .env.local file', 'green');
    return true;
  }
  
  log('❌ .env.local file not found', 'red');
  return false;
}

async function createEnvironmentFile() {
  log('\n📝 Creating .env.local file...', 'blue');
  
  const rl = createReadlineInterface();
  
  try {
    const dbHost = await askQuestion(rl, '🔗 Database Host (default: localhost): ') || 'localhost';
    const dbPort = await askQuestion(rl, '🔌 Database Port (default: 3306): ') || '3306';
    const dbName = await askQuestion(rl, '🗄️  Database Name (default: accentcrm): ') || 'accentcrm';
    const dbUser = await askQuestion(rl, '👤 Database User (default: root): ') || 'root';
    const dbPassword = await askQuestion(rl, '🔐 Database Password: ');
    
    const envContent = `# AccentCRM Database Configuration
DB_HOST=${dbHost}
DB_PORT=${dbPort}
DB_NAME=${dbName}
DB_USER=${dbUser}
DB_PASSWORD=${dbPassword}

# Next.js Configuration
NEXTAUTH_SECRET=your-secret-key-here
NEXTAUTH_URL=http://localhost:3000
`;
    
    fs.writeFileSync('.env.local', envContent);
    log('✅ .env.local file created successfully', 'green');
    
  } finally {
    rl.close();
  }
}

async function testDatabaseConnection() {
  log('\n🔌 Testing database connection...', 'blue');
  
  try {
    // Load environment variables
    dotenv.config({ path: '.env.local' });
    
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    
    await connection.ping();
    log('✅ Database connection successful', 'green');
    await connection.end();
    return true;
    
  } catch (error) {
    log(`❌ Database connection failed: ${error.message}`, 'red');
    return false;
  }
}

async function createDatabase() {
  log('\n🗄️  Creating database...', 'blue');
  
  try {
    dotenv.config({ path: '.env.local' });
    
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\``);
    log(`✅ Database '${process.env.DB_NAME}' created/verified`, 'green');
    await connection.end();
    return true;
    
  } catch (error) {
    log(`❌ Failed to create database: ${error.message}`, 'red');
    return false;
  }
}

async function runSQLScript(scriptPath, description) {
  log(`\n📋 Running ${description}...`, 'blue');
  
  try {
    if (!fs.existsSync(scriptPath)) {
      log(`❌ SQL script not found: ${scriptPath}`, 'red');
      return false;
    }
    
    dotenv.config({ path: '.env.local' });
    
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      multipleStatements: true
    });
    
    const sql = fs.readFileSync(scriptPath, 'utf8');
    
    // Split SQL into individual statements and execute
    const statements = sql.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        await connection.execute(statement);
      }
    }
    
    log(`✅ ${description} completed successfully`, 'green');
    await connection.end();
    return true;
    
  } catch (error) {
    log(`❌ Failed to run ${description}: ${error.message}`, 'red');
    return false;
  }
}

async function runNodeScript(scriptPath, description) {
  log(`\n📦 Running ${description} script: ${scriptPath}...`, 'blue');
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath], { stdio: 'inherit', shell: true });
    child.on('close', (code) => {
      if (code === 0) {
        log(`✅ ${description} completed successfully`, 'green');
        resolve(true);
      } else {
        log(`❌ ${description} failed with code ${code}`, 'red');
        resolve(false);
      }
    });
  });
}

async function installDependencies() {
  log('\n📦 Checking dependencies...', 'blue');
  
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  
  if (!fs.existsSync(packageJsonPath)) {
    log('❌ package.json not found', 'red');
    return false;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  
  const requiredPackages = ['mysql2', 'dotenv'];
  const missingPackages = requiredPackages.filter(pkg => !dependencies[pkg]);
  
  if (missingPackages.length > 0) {
    log(`📦 Installing missing packages: ${missingPackages.join(', ')}`, 'yellow');
    
    const installCmd = spawn('npm', ['install', ...missingPackages], {
      stdio: 'inherit',
      shell: true
    });
    
    return new Promise((resolve) => {
      installCmd.on('close', (code) => {
        if (code === 0) {
          log('✅ Dependencies installed successfully', 'green');
          resolve(true);
        } else {
          log('❌ Failed to install dependencies', 'red');
          resolve(false);
        }
      });
    });
  } else {
    log('✅ All required dependencies are already installed', 'green');
    return true;
  }
}

async function verifySetup() {
  log('\n🔍 Verifying setup...', 'blue');
  
  try {
    dotenv.config({ path: '.env.local' });
    
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    
    // Check if employees table exists
    const [tables] = await connection.execute(
      "SHOW TABLES LIKE 'employees'"
    );
    
    if (tables.length > 0) {
      log('✅ Employees table exists', 'green');
      
      // Get table info
      const [columns] = await connection.execute('DESCRIBE employees');
      log(`📊 Table has ${columns.length} columns`, 'cyan');
      
      // Check record count
      const [count] = await connection.execute('SELECT COUNT(*) as count FROM employees');
      log(`📈 Current employee records: ${count[0].count}`, 'cyan');
    } else {
      log('❌ Employees table not found', 'red');
    }
    
    await connection.end();
    return true;
    
  } catch (error) {
    log(`❌ Setup verification failed: ${error.message}`, 'red');
    return false;
  }
}

async function main() {
  log('🚀 AccentCRM Backend Setup', 'bright');
  log('================================', 'cyan');
  
  try {
    // Step 1: Check/Create environment file
    const hasEnv = await checkEnvironmentFile();
    if (!hasEnv) {
      await createEnvironmentFile();
    }
    
    // Step 2: Install dependencies
    const depsInstalled = await installDependencies();
    if (!depsInstalled) {
      log('\n❌ Setup failed: Could not install dependencies', 'red');
      process.exit(1);
    }
    
    // Step 3: Test database connection
    const connectionOk = await testDatabaseConnection();
    if (!connectionOk) {
      log('\n❌ Setup failed: Could not connect to database', 'red');
      log('💡 Please check your database credentials in .env.local', 'yellow');
      process.exit(1);
    }
    
    // Step 4: Create database
    const dbCreated = await createDatabase();
    if (!dbCreated) {
      log('\n❌ Setup failed: Could not create database', 'red');
      process.exit(1);
    }
    
    // Step 5: Run SQL scripts
    const sqlScripts = [
      { path: './employees_schema.sql', description: 'employee schema' }
    ];
    
    for (const script of sqlScripts) {
      const success = await runSQLScript(script.path, script.description);
      if (!success) {
        log(`\n⚠️  Warning: Could not run ${script.description}`, 'yellow');
        log(`   Please run the SQL script manually: ${script.path}`, 'yellow');
      }
    }

    // Step 5b: Run migration/node scripts (e.g., add designation column to leads)
    // These are idempotent scripts located under src/utils/migrations
    const migrations = [
      { path: './src/utils/migrations/add-leads-designation.js', description: 'add leads designation migration' }
    ];

    for (const m of migrations) {
      const ok = await runNodeScript(m.path, m.description);
      if (!ok) {
        log(`\n⚠️  Warning: Migration failed: ${m.description}`, 'yellow');
        log(`   You can run it manually: node ${m.path}`, 'yellow');
      }
    }
    
    // Step 6: Verify setup
    await verifySetup();
    
    // Final message
    log('\n🎉 Setup completed successfully!', 'green');
    log('================================', 'cyan');
    log('You can now start the development server with:', 'bright');
    log('npm run dev', 'cyan');
    log('\nAccess your CRM at: http://localhost:3000', 'blue');
    
  } catch (error) {
    log(`\n💥 Setup failed with error: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Run the setup when executed directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  main().catch(console.error);
}

export { main };
