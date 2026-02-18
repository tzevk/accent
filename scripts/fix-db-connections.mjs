#!/usr/bin/env node
/**
 * Automated script to fix database connection leaks in API routes.
 * 
 * Pattern being fixed:
 *   try {
 *     const db = await dbConnect();
 *     ...
 *     await db.end();
 *     return ...;
 *   } catch (error) {
 *     return ...;
 *   }
 * 
 * Fixed to:
 *   let db;
 *   try {
 *     db = await dbConnect();
 *     ...
 *     return ...;
 *   } catch (error) {
 *     return ...;
 *   } finally {
 *     if (db) db.release();
 *   }
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

// Get files that use dbConnect but have no finally blocks
const files = execSync(
  `grep -rl "dbConnect()" src/app/api/ | xargs grep -L "finally"`,
  { encoding: 'utf8', cwd: '/Users/tanvikadam/Desktop/accent' }
).trim().split('\n').filter(f => !f.includes('.backup'));

let totalFixed = 0;
let totalFiles = 0;

for (const relPath of files) {
  const filePath = `/Users/tanvikadam/Desktop/accent/${relPath}`;
  let content = readFileSync(filePath, 'utf8');
  const original = content;
  let fileFixed = 0;

  // Find all exported async function handlers (GET, POST, PUT, DELETE, PATCH)
  // Pattern: each handler has its own try/catch block
  
  // Step 1: Find all `const|let VARNAME = await dbConnect()` patterns inside try blocks
  // and hoist the declaration to `let VARNAME;` before the try, changing to `VARNAME = await dbConnect();`
  
  // We need to handle multiple handlers in the same file, each with its own try/catch
  
  // Strategy: Find } catch patterns and add finally blocks
  // We need to be careful to match the right closing brace
  
  // Simpler approach: Use regex to find the pattern:
  //   const VARNAME = await dbConnect();
  // and the var name used, then:
  // 1. Change `const VARNAME = await dbConnect()` to `VARNAME = await dbConnect()`
  // 2. Add `let VARNAME;` at the function start (before try)
  // 3. Remove `await VARNAME.end();` lines (redundant with finally)
  // 4. Add `finally { if (VARNAME) VARNAME.release(); }` after each catch block
  
  // Find all connection variable names used in this file
  const varMatches = [...content.matchAll(/(const|let)\s+(\w+)\s*=\s*await\s+dbConnect\(\)/g)];
  const varNames = [...new Set(varMatches.map(m => m[2]))];
  
  if (varNames.length === 0) continue;
  
  for (const varName of varNames) {
    // Replace `const VARNAME = await dbConnect()` with `VARNAME = await dbConnect()`
    // (we'll add `let` declaration separately)
    const constPattern = new RegExp(`const\\s+${varName}\\s*=\\s*await\\s+dbConnect\\(\\)`, 'g');
    const letPattern = new RegExp(`let\\s+${varName}\\s*=\\s*await\\s+dbConnect\\(\\)`, 'g');
    
    content = content.replace(constPattern, `${varName} = await dbConnect()`);
    content = content.replace(letPattern, `${varName} = await dbConnect()`);
    
    // Remove standalone `await VARNAME.end();` lines (the finally block handles cleanup)
    const endPattern = new RegExp(`^\\s*await\\s+${varName}\\.end\\(\\);?\\s*$`, 'gm');
    content = content.replace(endPattern, '');
    
    // Remove `if (VARNAME) await VARNAME.end();` in catch blocks too
    const catchEndPattern = new RegExp(`^\\s*if\\s*\\(${varName}\\)\\s*await\\s+${varName}\\.end\\(\\);?\\s*$`, 'gm');
    content = content.replace(catchEndPattern, '');
  }
  
  // Now we need to:
  // 1. Add `let VARNAME;` before each `try {` that contains the dbConnect call
  // 2. Add `finally { if (VARNAME) VARNAME.release(); }` after each `catch` block
  
  // Find each exported handler function and process it
  // Pattern: export async function HANDLER(...) { ... }
  const handlerPattern = /export\s+async\s+function\s+(GET|POST|PUT|DELETE|PATCH)\s*\([^)]*\)\s*\{/g;
  let match;
  const handlers = [];
  while ((match = handlerPattern.exec(content)) !== null) {
    handlers.push({
      name: match[1],
      start: match.index,
      braceStart: match.index + match[0].length - 1
    });
  }
  
  // Also find non-exported handler functions like `async function ensureTable()`
  // but skip those — focus on route handlers only
  
  // Process handlers in reverse order to maintain correct indices
  for (let i = handlers.length - 1; i >= 0; i--) {
    const handler = handlers[i];
    const handlerEnd = handlers[i + 1]?.start || content.length;
    const handlerBody = content.substring(handler.start, handlerEnd);
    
    // Check which var names are used in this handler
    const usedVars = varNames.filter(v => handlerBody.includes(`${v} = await dbConnect()`));
    if (usedVars.length === 0) continue;
    
    const varName = usedVars[0]; // Primary connection variable
    
    // Check if this handler already has a finally block
    if (handlerBody.includes('finally')) continue;
    
    // Find the try { in this handler
    const tryIndex = handlerBody.indexOf('try {');
    if (tryIndex === -1) continue;
    
    // Check if `let VARNAME;` already exists before the try
    const beforeTry = handlerBody.substring(0, tryIndex);
    const hasLetDecl = new RegExp(`let\\s+${varName}\\s*;`).test(beforeTry) || 
                       new RegExp(`let\\s+${varName}\\s*=`).test(beforeTry);
    
    // Find the catch block's closing brace
    // We need to find the matching } for the catch block
    // Pattern: } catch (...) { ... }
    // Find the last } in the handler that closes the catch block
    
    // Simple approach: find `} catch` and then find the matching closing }
    const catchIndex = handlerBody.indexOf('} catch');
    if (catchIndex === -1) continue;
    
    // Find the opening { of catch block
    const catchOpenBrace = handlerBody.indexOf('{', catchIndex + 7);
    if (catchOpenBrace === -1) continue;
    
    // Find matching closing } for catch block
    let braceCount = 1;
    let pos = catchOpenBrace + 1;
    while (pos < handlerBody.length && braceCount > 0) {
      if (handlerBody[pos] === '{') braceCount++;
      if (handlerBody[pos] === '}') braceCount--;
      pos++;
    }
    
    if (braceCount !== 0) continue;
    
    const catchClosePos = pos - 1; // Position of the closing } of catch
    
    // Get indentation from the catch line
    const catchLine = handlerBody.substring(handlerBody.lastIndexOf('\n', catchIndex) + 1, catchIndex);
    const indent = catchLine.match(/^\s*/)[0];
    
    // Insert finally block after the catch closing brace
    const finallyBlock = ` finally {\n${indent}  if (${varName}) ${varName}.release();\n${indent}}`;
    
    // Build the new handler body
    let newHandlerBody = handlerBody.substring(0, catchClosePos + 1) + 
                         finallyBlock + 
                         handlerBody.substring(catchClosePos + 1);
    
    // Add `let VARNAME;` before try if not already declared
    if (!hasLetDecl) {
      const tryPos = newHandlerBody.indexOf('try {');
      const tryLineStart = newHandlerBody.lastIndexOf('\n', tryPos) + 1;
      const tryIndent = newHandlerBody.substring(tryLineStart, tryPos).match(/^\s*/)[0];
      newHandlerBody = newHandlerBody.substring(0, tryLineStart) + 
                       `${tryIndent}let ${varName};\n` +
                       newHandlerBody.substring(tryLineStart);
    }
    
    // Replace in content
    content = content.substring(0, handler.start) + newHandlerBody + content.substring(handlerEnd);
    fileFixed++;
  }
  
  if (content !== original) {
    // Clean up any double blank lines created by removing .end() calls
    content = content.replace(/\n\n\n+/g, '\n\n');
    writeFileSync(filePath, content);
    totalFiles++;
    totalFixed += fileFixed;
    console.log(`✅ ${relPath}: fixed ${fileFixed} handler(s)`);
  } else {
    console.log(`⏭️  ${relPath}: no changes needed (complex pattern)`);
  }
}

console.log(`\nDone: Fixed ${totalFixed} handlers across ${totalFiles} files`);
