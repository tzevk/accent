import { NextResponse } from 'next/server';
import { ensurePermission, RESOURCES, PERMISSIONS } from '@/utils/api-permissions';

export async function GET(request, { params }) {
  try {
    // RBAC: read proposals
    const auth = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.READ);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    
    // Get database connection
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();

    // Ensure audit columns exist on both proposals and projects (best-effort)
    try {
      await pool.execute(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS converted_by VARCHAR(255) DEFAULT NULL`);
      await pool.execute(`ALTER TABLE proposals ADD COLUMN IF NOT EXISTS converted_at TIMESTAMP NULL`);
      await pool.execute(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS converted_by VARCHAR(255) DEFAULT NULL`);
      await pool.execute(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS converted_at TIMESTAMP NULL`);
    } catch (e) {
      console.warn('Schema alter warnings during convert:', e?.message || e);
    }
    
    const [rows] = await pool.execute(
      'SELECT * FROM proposals WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found' },
        { status: 404 }
      );
    }

    // Return both `data` and `proposal` for backward compatibility with callers
    return NextResponse.json({
      success: true,
      data: rows[0],
      proposal: rows[0]
    });

  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch proposal' },
      { status: 500 }
    );
  }
}

// Convert proposal to project
export async function POST(request, { params }) {
  try {
    // RBAC: approve proposals (conversion requires approval permission)
    const auth = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.APPROVE);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    if (!id) return NextResponse.json({ success: false, error: 'Proposal id required' }, { status: 400 });

    const body = await request.json();
    // Load DB
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();

    // Fetch proposal
    const [rows] = await pool.execute('SELECT * FROM proposals WHERE id = ?', [id]);
    if (!rows || rows.length === 0) {
      await pool.end?.();
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }
    const proposal = rows[0];

    // Prepare project data from proposal (map common fields)
    const projectData = {
      name: proposal.proposal_title || proposal.title || `Project from ${proposal.proposal_title || proposal.title || id}`,
      description: proposal.description || proposal.project_description || null,
      company_id: proposal.company_id || null,
      // intentionally do not set project_manager here; user will assign it on the Project page
      start_date: body.start_date || proposal.planned_start_date || null,
      end_date: body.end_date || proposal.planned_end_date || null,
      target_date: body.target_date || proposal.target_date || null,
      budget: body.budget || proposal.budget || proposal.proposal_value || null,
      status: body.status || 'NEW',
      priority: body.priority || proposal.priority || 'MEDIUM',
      progress: body.progress || 0,
      proposal_id: proposal.id,
      notes: body.notes || proposal.notes || null,
      project_schedule: proposal.project_schedule || null,
      input_document: proposal.input_document || null,
      list_of_deliverables: proposal.list_of_deliverables || null,
      kickoff_meeting: proposal.kickoff_meeting || null,
      in_house_meeting: proposal.in_house_meeting || null,
      // copy collaborative fields
      activities: proposal.activities || body.activities || [],
      disciplines: proposal.disciplines || body.disciplines || [],
      discipline_descriptions: proposal.discipline_descriptions || body.discipline_descriptions || {},
      planning_activities_list: proposal.planning_activities_list || body.planning_activities_list || [],
      documents_list: proposal.documents_list || body.documents_list || []
    };

    // Compose project_id using serial-month-year logic (reuse projects.POST behavior)
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const currentPattern = `-${month}-${year}`;

    // Find highest serial number for current month/year
    const [existingProjectsForId] = await pool.execute(
      'SELECT project_id FROM projects WHERE project_id LIKE ? ORDER BY project_id DESC',
      [`%${currentPattern}`]
    );
    let maxSerialForId = 0;
    existingProjectsForId.forEach(p => {
      if (p.project_id && p.project_id.endsWith(currentPattern)) {
        const serialPart = p.project_id.split('-')[0];
        const serial = parseInt(serialPart, 10);
        if (!isNaN(serial) && serial > maxSerialForId) maxSerialForId = serial;
      }
    });
    const nextSerial = String(maxSerialForId + 1).padStart(3, '0');
    const project_id = `${nextSerial}-${month}-${year}`;

    const client_name = proposal.client_name || proposal.client || null;

    // Build INSERT dynamically based on actual columns present in `projects` table
    const dbName = process.env.DB_NAME || null;
    let insertSql;
    let insertValues = [];
    if (dbName) {
      const [cols] = await pool.execute(
        `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH, DATA_TYPE, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects'`,
        [dbName]
      );
      const existing = new Set(cols.map((c) => c.COLUMN_NAME));
      const colMaxLen = Object.fromEntries(cols.map(c => [c.COLUMN_NAME, c.CHARACTER_MAXIMUM_LENGTH]));
      const colType = Object.fromEntries(cols.map(c => [c.COLUMN_NAME, (c.DATA_TYPE || c.COLUMN_TYPE || '').toLowerCase()]));

      const colNames = [];
      const placeholders = [];

      const push = (col, val) => {
        if (existing.has(col)) {
          let v = val;
          // If column has a max length and value is a string exceeding it, truncate to avoid Data truncated errors
          const maxLen = colMaxLen[col];
          if (typeof maxLen === 'number' && maxLen > 0 && typeof v === 'string' && v.length > maxLen) {
            console.warn(`Truncating value for column ${col} to ${maxLen} chars (was ${v.length})`);
            v = v.slice(0, maxLen);
          } else if (!maxLen && typeof v === 'string' && v.length > 250) {
            // Defensive fallback: trim very large strings to a safe upper bound to avoid unexpected truncation
            console.warn(`Truncating value for column ${col} to 250 chars as fallback (was ${v.length})`);
            v = v.slice(0, 250);
          }
          colNames.push(col);
          placeholders.push('?');
          insertValues.push(v);
        }
      };

      // Handle project_id: if the projects.project_id column is integer type, skip inserting a string value
      if (existing.has('project_id')) {
        const pType = colType['project_id'] || '';
        if (/(int|bigint|smallint|mediumint|tinyint)/.test(pType)) {
          console.warn('projects.project_id is an integer type; skipping inserting string project_id to avoid truncation. Letting DB populate or use numeric ids.');
          // Do not push project_id; we'll rely on DB-generated id or set project_id after insert if needed
        } else {
          const pidMax = colMaxLen['project_id'] || 50;
          const safePid = String(project_id).slice(0, pidMax);
          if (safePid.length !== String(project_id).length) console.warn(`project_id truncated from ${String(project_id).length} to ${safePid.length}`);
          push('project_id', safePid);
        }
      }
      push('name', projectData.name);
      push('description', projectData.description);
      push('company_id', projectData.company_id);
      push('client_name', client_name);
      push('start_date', projectData.start_date);
      push('end_date', projectData.end_date);
      push('target_date', projectData.target_date);
      push('budget', projectData.budget);
      push('assigned_to', null);
      push('status', projectData.status);
      push('type', 'ONGOING');
      push('priority', projectData.priority);
      push('progress', projectData.progress);
      push('proposal_id', projectData.proposal_id);
      push('notes', projectData.notes);
      if (existing.has('activities')) push('activities', JSON.stringify(projectData.activities || []));
      if (existing.has('disciplines')) push('disciplines', JSON.stringify(projectData.disciplines || []));
      if (existing.has('discipline_descriptions')) push('discipline_descriptions', JSON.stringify(projectData.discipline_descriptions || {}));
      if (existing.has('assignments')) push('assignments', JSON.stringify([]));
      push('project_schedule', projectData.project_schedule);
      push('input_document', projectData.input_document);
      push('list_of_deliverables', projectData.list_of_deliverables);
      push('kickoff_meeting', projectData.kickoff_meeting);
      push('in_house_meeting', projectData.in_house_meeting);

      if (colNames.length === 0) {
        throw new Error('No writable columns found in projects table for insert');
      }

      insertSql = `INSERT INTO projects (${colNames.join(',')}) VALUES (${placeholders.join(',')})`;
    } else {
      // Fallback to legacy full insert (may fail if columns missing)
      insertSql = `INSERT INTO projects (
      project_id, name, description, company_id, client_name,
      start_date, end_date, target_date, budget, assigned_to, status, type, priority, progress, proposal_id, notes,
      activities, disciplines, discipline_descriptions, assignments,
      project_schedule, input_document, list_of_deliverables, kickoff_meeting, in_house_meeting
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      insertValues = [
        project_id,
        projectData.name,
        projectData.description,
        projectData.company_id,
        client_name,
        projectData.start_date,
        projectData.end_date,
        projectData.target_date,
        projectData.budget,
        null,
        projectData.status,
        'ONGOING',
        projectData.priority,
        projectData.progress,
        projectData.proposal_id,
        projectData.notes,
        JSON.stringify(projectData.activities || []),
        JSON.stringify(projectData.disciplines || []),
        JSON.stringify(projectData.discipline_descriptions || {}),
        JSON.stringify([]),
        projectData.project_schedule,
        projectData.input_document,
        projectData.list_of_deliverables,
        projectData.kickoff_meeting,
        projectData.in_house_meeting
      ];
    }

    // Execute insert - use dynamically built values when available
    const execValues = (insertValues && insertValues.length > 0) ? insertValues : [
      project_id,
      projectData.name,
      projectData.description,
      projectData.company_id,
      client_name,
      projectData.start_date,
      projectData.end_date,
      projectData.target_date,
      projectData.budget,
      null, // assigned_to
      projectData.status,
      'ONGOING', // type
      projectData.priority,
      projectData.progress,
      projectData.proposal_id,
      projectData.notes,
      JSON.stringify(projectData.activities || []),
      JSON.stringify(projectData.disciplines || []),
      JSON.stringify(projectData.discipline_descriptions || {}),
      JSON.stringify([]),
      projectData.project_schedule,
      projectData.input_document,
      projectData.list_of_deliverables,
        projectData.kickoff_meeting,
        projectData.in_house_meeting
      ];

      // Final safety: ensure any project_id in execValues is trimmed to actual column max length
      try {
        if (dbName) {
          const [projCol] = await pool.execute(
            `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'project_id'`,
            [dbName]
          );
          if (projCol && projCol.length > 0) {
            const col = projCol[0];
            let maxLen = col.CHARACTER_MAXIMUM_LENGTH;
            if (!maxLen && typeof col.COLUMN_TYPE === 'string') {
              const m = col.COLUMN_TYPE.match(/varchar\((\d+)\)/i);
              if (m) maxLen = Number(m[1]);
            }
            if (!maxLen) maxLen = 50;
            // find project_id position in insertSql columns list
            const colsMatch = insertSql.match(/INSERT INTO projects \(([^)]+)\)/i);
            if (colsMatch) {
              const cols = colsMatch[1].split(',').map(s => s.trim());
              const idx = cols.indexOf('project_id');
                if (idx >= 0 && execValues && execValues.length > idx) {
                  const original = String(execValues[idx] ?? '');
                  console.warn('INSERT SQL columns:', cols);
                  console.warn('project_id column index in INSERT:', idx, 'detected maxLen:', maxLen);
                  console.warn('project_id value before trimming (len):', original.length, original);
                  if (original.length > maxLen) {
                    console.warn(`Final truncation: project_id length ${original.length} > ${maxLen}, trimming`);
                    execValues[idx] = original.slice(0, maxLen);
                    console.warn('project_id value after trimming (len):', String(execValues[idx]).length, execValues[idx]);
                  }
                } else {
                  console.warn('project_id not found in INSERT columns or execValues not aligned; INSERT columns:', cols);
                  console.warn('execValues length:', execValues ? execValues.length : 0);
                }
            }
          }
        }
      } catch (e) {
        console.warn('Failed to verify project_id column length before insert:', e?.message || e);
      }

      const [result] = await pool.execute(insertSql, execValues);

    // Update proposal status to CONVERTED, link the created project id and set audit fields
        // --- Post-insert: ensure a human-readable project_code exists and/or populate project_id if it's varchar ---
        try {
          const dbNameForCols = dbName || process.env.DB_NAME || process.env.MYSQL_DATABASE || null;
          if (dbNameForCols) {
            const [projCols] = await pool.execute(
              `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME IN ('project_code','project_id')`,
              [dbNameForCols]
            );
            const colMap = Object.fromEntries(projCols.map(c => [c.COLUMN_NAME, c]));

            // Ensure `project_code` column exists (idempotent)
            if (!colMap['project_code']) {
              try {
                await pool.execute(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_code VARCHAR(100)`);
                // reload definition
                const [reloaded] = await pool.execute(
                  `SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'project_code'`,
                  [dbNameForCols]
                );
                colMap['project_code'] = reloaded[0] || { CHARACTER_MAXIMUM_LENGTH: 100 };
              } catch (e) {
                console.warn('Failed to add project_code column:', e?.message || e);
              }
            }

            // Decide value to write: prefer the generated alphanumeric project_id variable (serial-month-year)
            let codeVal = String(project_id || result.insertId || `P-${result.insertId}`);
            const pcMax = (colMap['project_code'] && colMap['project_code'].CHARACTER_MAXIMUM_LENGTH) || 100;
            if (codeVal.length > pcMax) {
              console.warn(`Trimming project_code from ${codeVal.length} to ${pcMax}`);
              codeVal = codeVal.slice(0, pcMax);
            }

            // Update project_code column
            try {
              await pool.execute('UPDATE projects SET project_code = ? WHERE id = ?', [codeVal, result.insertId]);
            } catch (e) {
              console.warn('Failed to set project_code on created project:', e?.message || e);
            }

            // If projects.project_id is a VARCHAR (not integer) and we didn't insert an alphanumeric id earlier, set it now
            const pidCol = colMap['project_id'];
            if (pidCol) {
              const pType = (pidCol.DATA_TYPE || '').toLowerCase();
              if (!/(int|bigint|smallint|mediumint|tinyint)/.test(pType)) {
                // safe to set project_id string
                try {
                  const pidMax = pidCol.CHARACTER_MAXIMUM_LENGTH || 100;
                  let pidToWrite = String(project_id || codeVal).slice(0, pidMax);
                  await pool.execute('UPDATE projects SET project_id = ? WHERE id = ?', [pidToWrite, result.insertId]);
                } catch (e) {
                  console.warn('Failed to populate projects.project_id with string value:', e?.message || e);
                }
              }
            }
          }
        } catch (e) {
          console.warn('Post-insert project code handling failed:', e?.message || e);
        }

    const convertedBy = body.converted_by || 'manual';
    const convertedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    // Ensure proposals.status can accept new values (best-effort migration from ENUM to VARCHAR)
    try {
      await pool.execute("ALTER TABLE proposals MODIFY COLUMN status VARCHAR(50) DEFAULT 'draft'");
    } catch (e) {
      // ignore if ALTER fails (older DBs might not allow modification)
      console.warn('Failed to alter proposals.status column:', e?.message || e);
    }

    await pool.execute('UPDATE proposals SET status = ?, project_id = ?, converted_by = ?, converted_at = ? WHERE id = ?', ['CONVERTED', result.insertId, convertedBy, convertedAt, id]);

    // Also set audit fields on the created project row (best-effort)
    try {
      await pool.execute('UPDATE projects SET converted_by = ?, converted_at = ? WHERE id = ?', [convertedBy, convertedAt, result.insertId]);
    } catch (e) {
      console.warn('Failed to set audit fields on project:', e?.message || e);
    }

    // Fetch created project: detect primary key name and select by it (DB schema may differ)
    let created;
    try {
      let pkCol = null;
      if (dbName) {
        const [pkRows] = await pool.execute(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND CONSTRAINT_NAME = 'PRIMARY' LIMIT 1`,
          [dbName]
        );
        if (pkRows && pkRows.length > 0) pkCol = pkRows[0].COLUMN_NAME;
      }

      // If primary key column is known, try to query by that column
      if (pkCol) {
        // If we inserted a value for the pk column in the dynamic insert, try to map it from execValues
        let pkVal = undefined;
        try {
          const colsMatch = insertSql.match(/INSERT INTO projects \(([^)]+)\)/i);
          if (colsMatch) {
            const cols = colsMatch[1].split(',').map(s => s.trim());
            const idx = cols.indexOf(pkCol);
            if (idx >= 0 && execValues && execValues.length > idx) {
              pkVal = execValues[idx];
            }
          }
        } catch {
          // ignore
        }

        // If no pkVal from execValues, but we have an insertId and pk column is numeric, use insertId
        if ((pkVal === undefined || pkVal === null) && result && typeof result.insertId === 'number' && result.insertId > 0) {
          // attempt to detect if pkCol is numeric
          try {
            const [colInfo] = await pool.execute(
              `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'projects' AND COLUMN_NAME = ?`,
              [dbName, pkCol]
            );
            const dtype = colInfo?.[0]?.DATA_TYPE || '';
            if (/(int|bigint|smallint|mediumint|tinyint)/i.test(dtype)) {
              pkVal = result.insertId;
            }
          } catch {
            // fallback to using insertId anyway
            pkVal = result.insertId;
          }
        }

        if (pkVal !== undefined) {
          const [rows] = await pool.execute(`SELECT * FROM projects WHERE ${pkCol} = ?`, [pkVal]);
          created = rows;
        }
      }

      // Fallbacks: try project_code or project_id or last inserted row
      if (!created || created.length === 0) {
        // try project_code
        try {
          const [pcRows] = await pool.execute('SELECT * FROM projects WHERE project_code = ? LIMIT 1', [project_id || null]);
          if (pcRows && pcRows.length > 0) created = pcRows;
        } catch {
          // ignore
        }
      }

      if (!created || created.length === 0) {
        // try project_id column (string)
        try {
          const [pidRows] = await pool.execute('SELECT * FROM projects WHERE project_id = ? LIMIT 1', [project_id || null]);
          if (pidRows && pidRows.length > 0) created = pidRows;
        } catch {
          // ignore
        }
      }

      if (!created || created.length === 0) {
        // last-resort: return the most recently created project
        const [lastRows] = await pool.execute('SELECT * FROM projects ORDER BY created_at DESC LIMIT 1');
        created = lastRows;
      }
    } catch (e) {
      console.warn('Failed to fetch created project by primary key, falling back to last row:', e?.message || e);
      const [lastRows] = await pool.execute('SELECT * FROM projects ORDER BY created_at DESC LIMIT 1');
      created = lastRows;
    }

    await pool.end?.();

    // If we couldn't fetch the created project row for any reason, fall back to a minimal project object
    let createdProject = null;
    try {
      if (created && created.length > 0) createdProject = created[0];
    } catch (e) {
      console.warn('Unexpected created result shape:', e?.message || e, { created });
    }

    if (!createdProject) {
      // Build a safe fallback object so the frontend can proceed (contains at least id/project_id/name)
      createdProject = {
        id: result && typeof result.insertId === 'number' ? result.insertId : null,
        project_id: project_id || null,
        name: projectData.name || null,
        company_id: projectData.company_id || null,
        client_name: client_name || null,
        start_date: projectData.start_date || null,
        end_date: projectData.end_date || null,
        budget: projectData.budget || null,
        status: projectData.status || 'NEW'
      };
      console.warn('Created project row not retrievable; returning fallback project object', { fallback: createdProject });
    }

    return NextResponse.json({ success: true, data: { project: createdProject, proposal: { ...proposal, status: 'CONVERTED', project_id: createdProject.project_id } } }, { status: 201 });
  } catch (err) {
    console.error('Convert proposal to project error:', err);
    return NextResponse.json({ success: false, error: 'Failed to convert proposal', details: err.message }, { status: 500 });
  }
}

// Cache to track if schema migrations have been run this session
let proposalsSchemaInitialized = false;

export async function PUT(request, { params }) {
  try {
    // RBAC: update proposals
    const auth = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.UPDATE);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    const body = await request.json();
    
    // Get database connection
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();
    
    // Only run ALTER statements once per server session, not on every save
    if (!proposalsSchemaInitialized) {
      const alterStatements = [
        // Quotation related fields
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS quotation_number VARCHAR(100)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS quotation_date DATE',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS enquiry_number VARCHAR(100)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS enquiry_date DATE',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS quotation_validity VARCHAR(255)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS billing_payment_terms TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS other_terms TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS general_terms TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS additional_fields TEXT',
        
        // Input documents & deliverables
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS input_document TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS list_of_deliverables TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS documents_list JSON',
        
        // Software & schedule fields
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS software VARCHAR(255)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS software_items JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS duration VARCHAR(100)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS site_visit TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS mode_of_delivery VARCHAR(255)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS revision VARCHAR(255)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS exclusions TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_schedule TEXT',
        
        // Meetings
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS kickoff_meeting TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS in_house_meeting TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS kickoff_meeting_date DATE',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS internal_meeting_date DATE',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS next_internal_meeting DATE',
        
        // Disciplines & activities
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS disciplines JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS activities JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS discipline_descriptions JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planning_activities_list JSON',
        
        // Commercial items
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS commercial_items JSON',
        
        // Hours tracking
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_hours_total DECIMAL(10,2)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS actual_hours_total DECIMAL(10,2)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_hours_by_discipline JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS actual_hours_by_discipline JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_hours_per_activity JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS actual_hours_per_activity JSON',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS hours_variance_total DECIMAL(10,2)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS hours_variance_percentage DECIMAL(5,2)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS productivity_index DECIMAL(5,2)',
        
        // Client & location
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS client_contact_details TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_location_country VARCHAR(100)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_location_city VARCHAR(100)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_location_site VARCHAR(255)',
        
        // Financial
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS budget DECIMAL(15,2)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS cost_to_company DECIMAL(15,2)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS profitability_estimate DECIMAL(5,2)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS major_risks TEXT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS mitigation_plans TEXT',
        
        // Schedule
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_start_date DATE',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS planned_end_date DATE',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_duration_planned VARCHAR(100)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS target_date DATE',
        
        // Status & progress
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS progress INT DEFAULT 0',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_id INT',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS enquiry_no VARCHAR(100)',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS project_type VARCHAR(50)',
        
        // Pricing fields based on project type
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS lumpsum_cost DECIMAL(15,2) DEFAULT 0',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS total_lines INT DEFAULT 0',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS per_line_charges DECIMAL(15,2) DEFAULT 0',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS total_line_cost DECIMAL(15,2) DEFAULT 0',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS total_manhours DECIMAL(10,2) DEFAULT 0',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS manhour_charges DECIMAL(15,2) DEFAULT 0',
        'ALTER TABLE proposals ADD COLUMN IF NOT EXISTS total_manhour_cost DECIMAL(15,2) DEFAULT 0',
      ];
      
      // Run all ALTER statements in parallel for faster execution
      await Promise.allSettled(alterStatements.map(stmt => pool.execute(stmt).catch(() => {})));
      proposalsSchemaInitialized = true;
    }
    
    // Build the UPDATE dynamically so we only try to set columns that actually exist
    const dbName = process.env.DB_NAME || 'accent';
    const [cols] = await pool.execute(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'proposals'`,
      [dbName]
    );
    const existing = new Set(cols.map(c => c.COLUMN_NAME));

    // Helper to push if column exists
    const setParts = [];
    const values = [];
    const pushIf = (colName, val) => {
      if (existing.has(colName)) {
        setParts.push(`${colName} = ?`);
        // Convert empty strings to null for date/datetime fields
        // Check if field name suggests it's a date type or if value is empty string
        const isDateField = colName.includes('date') || colName.includes('_at') || colName.includes('meeting');
        if (isDateField && val === '') {
          values.push(null);
        } else {
          values.push(val);
        }
      }
    };

    // Map request body keys to possible DB column names and push accordingly
    // title/proposal_title
    pushIf('title', body.title ?? null);
    pushIf('proposal_id', body.proposal_id ?? null);
    pushIf('proposal_title', body.proposal_title ?? body.title ?? null);
    pushIf('client', body.client ?? null);
    pushIf('contact_name', body.contact_name ?? null);
    pushIf('contact_email', body.contact_email ?? null);
    pushIf('phone', body.phone ?? null);
    pushIf('project_description', body.project_description ?? body.description ?? null);
    pushIf('description', body.description ?? body.project_description ?? null);
    pushIf('value', body.value ?? body.proposal_value ?? null);
    pushIf('proposal_value', body.proposal_value ?? body.value ?? null);
    pushIf('status', body.status ?? null);
    pushIf('due_date', body.due_date ?? body.target_date ?? null);
    pushIf('target_date', body.target_date ?? body.due_date ?? null);
    pushIf('notes', body.notes ?? null);
    pushIf('lead_id', body.lead_id ?? null);
    
    // Company/Industry/Contract fields
    pushIf('company_id', body.company_id ?? null);
    pushIf('industry', body.industry ?? null);
    pushIf('contract_type', body.contract_type ?? null);
    pushIf('project_type', body.project_type ?? null);
    
    // Pricing fields based on project type
    pushIf('lumpsum_cost', body.lumpsum_cost ?? null);
    pushIf('total_lines', body.total_lines ?? null);
    pushIf('per_line_charges', body.per_line_charges ?? null);
    pushIf('total_line_cost', body.total_line_cost ?? null);
    pushIf('total_manhours', body.total_manhours ?? null);
    pushIf('manhour_charges', body.manhour_charges ?? null);
    pushIf('total_manhour_cost', body.total_manhour_cost ?? null);
    
    // Schedule fields
    pushIf('planned_start_date', body.planned_start_date ?? null);
    pushIf('planned_end_date', body.planned_end_date ?? null);
    pushIf('project_duration_planned', body.project_duration_planned ?? body.duration ?? null);
    
    // Meeting fields
    pushIf('kickoff_meeting', body.kickoff_meeting ?? null);
    pushIf('in_house_meeting', body.in_house_meeting ?? null);
    pushIf('kickoff_meeting_date', body.kickoff_meeting_date ?? null);
    pushIf('internal_meeting_date', body.internal_meeting_date ?? null);
    pushIf('next_internal_meeting', body.next_internal_meeting ?? null);
    
    // Financial fields
    pushIf('budget', body.budget ?? null);
    pushIf('cost_to_company', body.cost_to_company ?? null);
    pushIf('profitability_estimate', body.profitability_estimate ?? null);
    pushIf('major_risks', body.major_risks ?? null);
    pushIf('mitigation_plans', body.mitigation_plans ?? null);
    
    // Hours tracking fields
    pushIf('planned_hours_total', body.planned_hours_total ?? null);
    pushIf('actual_hours_total', body.actual_hours_total ?? null);
    pushIf('hours_variance_total', body.hours_variance_total ?? null);
    pushIf('hours_variance_percentage', body.hours_variance_percentage ?? null);
    pushIf('productivity_index', body.productivity_index ?? null);
    
    // Location fields
    pushIf('client_contact_details', body.client_contact_details ?? null);
    pushIf('project_location_country', body.project_location_country ?? null);
    pushIf('project_location_city', body.project_location_city ?? null);
    pushIf('project_location_site', body.project_location_site ?? null);
    
    // Priority/Progress fields
    pushIf('priority', body.priority ?? null);
    pushIf('progress', body.progress ?? null);
    pushIf('project_id', body.project_id ?? null);    // Ensure enquiry_no mirrors lead_id when lead_id is provided; otherwise accept explicit enquiry_no
    if (existing.has('enquiry_no')) {
      const enquiryVal = body.lead_id ?? body.enquiry_no ?? null;
      pushIf('enquiry_no', enquiryVal);
    }

    // Quotation / related fields
    pushIf('client_name', body.client_name ?? body.client ?? null);
    pushIf('client_address', body.client_address ?? null);
    pushIf('attention_person', body.attention_person ?? null);
    pushIf('attention_designation', body.attention_designation ?? null);
    pushIf('quotation_no', body.quotation_no ?? null);
    pushIf('quotation_number', body.quotation_number ?? body.quotation_no ?? null);
    pushIf('quotation_date', body.quotation_date ?? body.date_of_quotation ?? null);
    pushIf('date_of_quotation', body.date_of_quotation ?? body.quotation_date ?? null);
    pushIf('enquiry_no', body.enquiry_no ?? body.enquiry_number ?? null);
    pushIf('enquiry_number', body.enquiry_number ?? body.enquiry_no ?? null);
    pushIf('enquiry_date', body.enquiry_date ?? body.date_of_enquiry ?? null);
    pushIf('date_of_enquiry', body.date_of_enquiry ?? body.enquiry_date ?? null);

    if (existing.has('scope_items')) {
      pushIf('scope_items', body.scope_items ? JSON.stringify(body.scope_items) : null);
    }
    pushIf('amount_in_words', body.amount_in_words ?? null);
    pushIf('total_amount', body.total_amount ?? null);
    pushIf('gst_number', body.gst_number ?? null);
    pushIf('pan_number', body.pan_number ?? null);
    pushIf('tan_number', body.tan_number ?? null);
    pushIf('terms_and_conditions', body.terms_and_conditions ?? body.general_terms ?? null);
    pushIf('payment_mode', body.payment_mode ?? null);
    pushIf('receiver_signature', body.receiver_signature ?? null);
    pushIf('company_signature', body.company_signature ?? null);
    pushIf('signatory_name', body.signatory_name ?? null);
    pushIf('signatory_designation', body.signatory_designation ?? null);

    // Frontend fields (new)
    pushIf('input_document', body.input_document ?? null);
    pushIf('list_of_deliverables', body.list_of_deliverables ?? null);
    pushIf('project_schedule', body.project_schedule ?? null);
    pushIf('software', body.software ?? null);
    pushIf('software_items', body.software_items ?? null);
    pushIf('duration', body.duration ?? null);
    pushIf('site_visit', body.site_visit ?? null);
    pushIf('quotation_validity', body.quotation_validity ?? null);
    pushIf('mode_of_delivery', body.mode_of_delivery ?? null);
    pushIf('revision', body.revision ?? null);
    pushIf('exclusions', body.exclusions ?? null);
    pushIf('billing_payment_terms', body.billing_payment_terms ?? null);
    // existing schema used annexure_confidentiality etc. keep other_terms mapping
    pushIf('other_terms', body.other_terms ?? body.annexure_confidentiality ?? null);
    pushIf('additional_fields', body.additional_fields ?? null);
    pushIf('general_terms', body.general_terms ?? null);
    pushIf('payment_terms', body.payment_terms ?? body.payment_terms ?? null);

    // JSON fields for various data structures
    pushIf('commercial_items', body.commercial_items ?? null);
    pushIf('disciplines', body.disciplines ?? null);
    pushIf('activities', body.activities ?? null);
    pushIf('discipline_descriptions', body.discipline_descriptions ?? null);
    pushIf('planning_activities_list', body.planning_activities_list ?? null);
    pushIf('documents_list', body.documents_list ?? null);
    pushIf('planned_hours_by_discipline', body.planned_hours_by_discipline ?? null);
    pushIf('actual_hours_by_discipline', body.actual_hours_by_discipline ?? null);
    pushIf('planned_hours_per_activity', body.planned_hours_per_activity ?? null);
    pushIf('actual_hours_per_activity', body.actual_hours_per_activity ?? null);

    // If there are no columns to update, return 400
    if (setParts.length === 0) {
      return NextResponse.json({ success: false, error: 'No updatable columns found for proposals table' }, { status: 400 });
    }

    // Append updated_at if present
    if (existing.has('updated_at')) {
      setParts.push('updated_at = NOW()');
    }

    const sql = `UPDATE proposals SET ${setParts.join(', ')} WHERE id = ?`;
    values.push(id);

    const [result] = await pool.execute(sql, values);

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Proposal updated successfully'
    });

  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update proposal' },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    // RBAC: delete proposals
    const auth = await ensurePermission(request, RESOURCES.PROPOSALS, PERMISSIONS.DELETE);
    if (auth instanceof Response) return auth;
    
    const { id } = await params;
    
    // Get database connection
    const { dbConnect } = await import('@/utils/database');
    const pool = await dbConnect();
    
    const [result] = await pool.execute(
      'DELETE FROM proposals WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Proposal deleted successfully'
    });

  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete proposal' },
      { status: 500 }
    );
  }
}