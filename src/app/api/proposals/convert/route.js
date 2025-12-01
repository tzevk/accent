import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const proposalIdentifier = body.proposalId || body.id || null;
    if (!proposalIdentifier) return NextResponse.json({ success: false, error: 'proposalId required' }, { status: 400 });

    const { dbConnect } = await import('@/utils/database');
    const db = await dbConnect();

    // Try to find proposal by numeric id or proposal_id string
    let rows;
    if (Number(proposalIdentifier)) {
      [rows] = await db.execute('SELECT * FROM proposals WHERE id = ?', [proposalIdentifier]);
    } else {
      [rows] = await db.execute('SELECT * FROM proposals WHERE proposal_id = ? OR id = ?', [proposalIdentifier, proposalIdentifier]);
    }

    if (!rows || rows.length === 0) {
      await db.end?.();
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }
    const proposal = rows[0];

    // Build project payload from proposal similar to projects POST
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const currentPattern = `-${month}-${year}`;

    const [existingProjects] = await db.execute('SELECT project_id FROM projects WHERE project_id LIKE ? ORDER BY project_id DESC', [`%${currentPattern}`]);
    let maxSerial = 0;
    existingProjects.forEach(p => {
      if (p.project_id && p.project_id.endsWith(currentPattern)) {
        const serialPart = p.project_id.split('-')[0];
        const serial = parseInt(serialPart, 10);
        if (!isNaN(serial) && serial > maxSerial) maxSerial = serial;
      }
    });
    const nextSerial = String(maxSerial + 1).padStart(3, '0');
    const project_id = `${nextSerial}-${month}-${year}`;

    const client_name = proposal.client_name || proposal.client || null;

    const insertSql = `INSERT INTO projects (
      project_id, name, description, company_id, client_name,
      start_date, end_date, target_date, budget, assigned_to, status, type, priority, progress, proposal_id, notes,
      activities, disciplines, discipline_descriptions, assignments,
      project_schedule, input_document, list_of_deliverables, kickoff_meeting, in_house_meeting
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    const projectData = {
      name: proposal.proposal_title || proposal.title || `Project from ${proposal.id}`,
      description: proposal.description || proposal.project_description || null,
      company_id: proposal.company_id || null,
      start_date: proposal.planned_start_date || null,
      end_date: proposal.planned_end_date || null,
      target_date: proposal.target_date || null,
      budget: proposal.budget || proposal.proposal_value || null,
      status: 'NEW',
      priority: proposal.priority || 'MEDIUM',
      progress: 0,
      notes: proposal.notes || null
    };

    const [result] = await db.execute(insertSql, [
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
      proposal.id,
      projectData.notes,
      JSON.stringify(proposal.activities || []),
      JSON.stringify(proposal.disciplines || []),
      JSON.stringify(proposal.discipline_descriptions || {}),
      JSON.stringify([]),
      proposal.project_schedule || null,
      proposal.input_document || null,
      proposal.list_of_deliverables || null,
      proposal.kickoff_meeting || null,
      proposal.in_house_meeting || null
    ]);

    // Insert project_scope row with annexure fields from proposal
    const scopeSql = `INSERT INTO project_scope (
      project_id, scope_of_work, input_documents, deliverables, software_included, duration, mode_of_delivery, revision, site_visit, quotation_validity, exclusion, billing_and_payment_terms, other_terms_and_conditions, created_by, updated_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

    await db.execute(scopeSql, [
      project_id,
      proposal.scope_of_work || proposal.scope || proposal.description || '',
      proposal.input_documents || proposal.input_document || '',
      proposal.deliverables || proposal.list_of_deliverables || '',
      proposal.software_included || proposal.software || '',
      proposal.duration || '',
      proposal.mode_of_delivery || proposal.modeOfDelivery || '',
      proposal.revision || '',
      proposal.site_visit || proposal.siteVisit || '',
      proposal.quotation_validity || '',
      proposal.exclusion || proposal.exclusions || '',
      proposal.billing_and_payment_terms || proposal.billing_payment_terms || proposal.billing || '',
      proposal.other_terms_and_conditions || proposal.other_terms || proposal.terms_and_conditions || '',
      proposal.created_by || 'system',
      proposal.updated_by || 'system'
    ]);

    // Update proposal status and link project_id
    const convertedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await db.execute('UPDATE proposals SET status = ?, project_id = ?, converted_at = ? WHERE id = ?', ['CONVERTED', result.insertId, convertedAt, proposal.id]);

    const [created] = await db.execute('SELECT * FROM projects WHERE id = ?', [result.insertId]);
    const [scope] = await db.execute('SELECT * FROM project_scope WHERE project_id = ?', [project_id]);
    await db.end?.();

    let createdProject = null;
    try {
      if (created && created.length > 0) createdProject = created[0];
    } catch (e) {
      console.warn('Unexpected created result shape in convert route:', e?.message || e, { created });
    }

    if (!createdProject) {
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
      console.warn('Created project row not retrievable in convert route; returning fallback object', { fallback: createdProject });
    }

    return NextResponse.json({ success: true, data: { project: createdProject, project_id: createdProject.project_id, scope: scope[0] } }, { status: 201 });
  } catch (err) {
    console.error('Convert route error:', err);
    return NextResponse.json({ success: false, error: 'Conversion failed', details: err.message }, { status: 500 });
  }
}
