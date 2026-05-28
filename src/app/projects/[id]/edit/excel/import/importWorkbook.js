const normalizeHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');

const firstNonEmptyHeaderRow = (sheet) => {
  let best = 1;
  let bestCount = 0;
  const upper = Math.min(sheet.rowCount || 1, 20);
  for (let i = 1; i <= upper; i += 1) {
    const row = sheet.getRow(i);
    const values = (row.values || [])
      .slice(1)
      .map((v) => String(v || '').trim());
    const count = values.filter(Boolean).length;
    if (count > bestCount) {
      best = i;
      bestCount = count;
    }
  }
  return best;
};

const sheetRowsToObjects = (sheet) => {
  if (!sheet || !sheet.rowCount) return [];
  const headerRowIndex = firstNonEmptyHeaderRow(sheet);
  const headerRow = sheet.getRow(headerRowIndex);
  const headers = (headerRow.values || []).slice(1).map(normalizeHeader);
  const objects = [];
  for (let r = headerRowIndex + 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    const raw = (row.values || []).slice(1);
    const hasAny = raw.some((cell) => String(cell || '').trim() !== '');
    if (!hasAny) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = raw[idx] ?? '';
    });
    objects.push(obj);
  }
  return objects;
};

const toIsoDate = (value) => {
  if (!value) return '';
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().split('T')[0];
};

async function importDiscussions(rows, id) {
  if (!id || !Array.isArray(rows) || rows.length === 0) return 0;
  let successCount = 0;
  for (const row of rows) {
    const topic = row.topic || row.description || '';
    const date = toIsoDate(row.date || row.follow_up_date);
    if (!topic || !date) continue;
    try {
      const res = await fetch(`/api/projects/${id}/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          follow_up_date: date,
          description: topic,
          responsible_person: row.participants || row.responsible_person || '',
          logged_by: row.logged_by || '',
          status: row.status || 'Scheduled',
        }),
      });
      const data = await res.json();
      if (data?.success) successCount += 1;
    } catch {
      // Skip failed row and continue import.
    }
  }
  return successCount;
}

export async function importProjectWorkbook({
  file,
  form,
  allUsers,
  userMaster,
  projectTeamMembers,
  id,
}) {
  const ExcelJSImport = await import('exceljs');
  const ExcelJS = ExcelJSImport.default || ExcelJSImport;
  const workbook = new ExcelJS.Workbook();
  const arr = await file.arrayBuffer();
  await workbook.xlsx.load(arr);

  const sheetMap = {};
  workbook.worksheets.forEach((ws) => {
    sheetMap[normalizeHeader(ws.name)] = ws;
  });

  const results = {
    inputDocumentsList: null,
    nextForm: null,
    projectActivities: null,
    documentsIssued: null,
    queryLog: null,
    assumptions: null,
    discussionImported: 0,
    updates: 0,
  };

  const inputWs = sheetMap.input_documents;
  if (inputWs) {
    const rows = sheetRowsToObjects(inputWs)
      .map((r) => ({
        id: Date.now() + Math.random(),
        category: r.category || 'lot',
        lotNumber: r.lot_sub_lot || '',
        subLot: r.lot_sub_lot || '',
        date_received: toIsoDate(r.date),
        description: r.description || '',
        drawing_number: r.drawing_no || r.drawing_number || '',
        sheet_number: r.sheet_no || r.sheet_number || '',
        revision_number: r.revision || r.revision_number || '',
        unit_qty: r.unit_qty || '',
        document_sent_by: r.sent_by || r.document_sent_by || '',
        remarks: r.remarks || '',
      }))
      .filter((r) => r.description);
    if (rows.length > 0) {
      results.inputDocumentsList = rows;
      results.updates += 1;
    }
  }

  const scopeWs = sheetMap.scope;
  if (scopeWs) {
    const rows = sheetRowsToObjects(scopeWs);
    const nextForm = { ...form };
    rows.forEach((r) => {
      const field = normalizeHeader(r.field || '');
      const value = String(r.value || '');
      if (field === 'scope_of_work') nextForm.scope_of_work = value;
      if (field === 'additional_scope') nextForm.additional_scope = value;
      if (field === 'deliverables') {
        nextForm.deliverables = value;
        nextForm.list_of_deliverables = value;
      }
    });
    results.nextForm = nextForm;
    results.updates += 1;
  }

  const activityWs = sheetMap.project_activity;
  if (activityWs) {
    const rows = sheetRowsToObjects(activityWs);
    const userPool = [
      ...(allUsers || []),
      ...(userMaster || []),
      ...(projectTeamMembers || []),
    ];
    const userByName = new Map(
      userPool
        .map((u) => [
          String(u?.full_name || u?.name || u?.employee_name || '')
            .trim()
            .toLowerCase(),
          u,
        ])
        .filter(([name]) => !!name)
    );
    const grouped = new Map();
    rows.forEach((r) => {
      const key = `${r.discipline || ''}__${r.activity || ''}__${r.activity_description || ''}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          id: Date.now() + Math.random(),
          type: 'activity',
          discipline: r.discipline || '',
          activity_name: r.activity || '',
          activity_description: r.activity_description || '',
          assigned_users: [],
        });
      }
      const activity = grouped.get(key);
      const memberName = String(r.team_member || '')
        .trim()
        .toLowerCase();
      const foundUser = userByName.get(memberName);
      if (memberName) {
        activity.assigned_users.push({
          user_id: foundUser?.id || r.team_member,
          description: r.description || '',
          qty_assigned: r.qty_assigned || '',
          start_date: toIsoDate(r.start_date),
          due_date: toIsoDate(r.due_date),
          status: r.status || 'Not Started',
          remarks: r.notes || r.remarks || '',
        });
      }
    });
    const importedActivities = Array.from(grouped.values()).filter(
      (a) => a.activity_name
    );
    if (importedActivities.length > 0) {
      results.projectActivities = importedActivities;
      results.updates += 1;
    }
  }

  const issuedWs = sheetMap.document_issued;
  if (issuedWs) {
    const rows = sheetRowsToObjects(issuedWs)
      .map((r) => ({
        id: Date.now() + Math.random(),
        document_name: r.document_name || '',
        issued_for: r.issued_for || '',
        document_number: r.document_number || '',
        revision_number: r.revision || r.revision_number || '',
        issue_date: toIsoDate(r.issue_date),
        remarks: r.remarks || '',
      }))
      .filter((r) => r.document_name || r.document_number);
    if (rows.length > 0) {
      results.documentsIssued = rows;
      results.updates += 1;
    }
  }

  const queryWs = sheetMap.query_log;
  if (queryWs) {
    const rows = sheetRowsToObjects(queryWs)
      .map((r) => ({
        id: Date.now() + Math.random(),
        query_description: r.query_description || '',
        query_issued_date: toIsoDate(r.issued_date),
        reply_from_client: r.reply_from_client || '',
        reply_received_date: toIsoDate(r.reply_date),
        query_updated_by: r.updated_by || '',
        query_resolved: r.resolved || '',
        remark: r.remark || '',
      }))
      .filter((r) => r.query_description);
    if (rows.length > 0) {
      results.queryLog = rows;
      results.updates += 1;
    }
  }

  const assumptionWs = sheetMap.assumption;
  if (assumptionWs) {
    const rows = sheetRowsToObjects(assumptionWs)
      .map((r) => ({
        id: Date.now() + Math.random(),
        assumption_description: r.assumption_description || '',
        reason: r.reason || '',
        assumption_taken_by: r.taken_by || '',
        remark: r.remark || '',
      }))
      .filter((r) => r.assumption_description);
    if (rows.length > 0) {
      results.assumptions = rows;
      results.updates += 1;
    }
  }

  const discussionWs = sheetMap.discussion;
  if (discussionWs) {
    const discussionRows = sheetRowsToObjects(discussionWs);
    results.discussionImported = await importDiscussions(discussionRows, id);
  }

  return results;
}
