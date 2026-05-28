export async function getExportSheetPayloads({
  id,
  form,
  inputDocumentsList,
  projectActivities,
  documentsIssued,
  queryLog,
  assumptions,
  allUsers,
  userMaster,
  projectTeamMembers,
}) {
  const formatExportDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().split('T')[0];
  };

  const resolveTeamMemberName = (userId) => {
    if (!userId) return '';
    const allKnownUsers = [
      ...(allUsers || []),
      ...(userMaster || []),
      ...(projectTeamMembers || []),
    ];
    const found = allKnownUsers.find((u) => String(u.id) === String(userId));
    return (
      found?.full_name ||
      found?.name ||
      found?.employee_name ||
      found?.username ||
      found?.email ||
      String(userId)
    );
  };

  let discussions = [];
  try {
    const response = await fetch(`/api/projects/${id}/followups`, {
      credentials: 'include',
    });
    const result = await response.json();
    discussions =
      result?.success && Array.isArray(result.data) ? result.data : [];
  } catch {
    discussions = [];
  }

  const scopeRows = [
    ['Scope of Work', form.scope_of_work || form.description || ''],
    ['Additional Scope', form.additional_scope || ''],
    ['Deliverables', form.deliverables || form.list_of_deliverables || ''],
  ];

  const inputDocumentRows = (inputDocumentsList || []).map((doc, idx) => [
    idx + 1,
    doc.category || '',
    doc.lotNumber || doc.subLot || '',
    formatExportDate(doc.date_received),
    doc.description || '',
    doc.drawing_number || '',
    doc.sheet_number || '',
    doc.revision_number || '',
    doc.unit_qty || '',
    doc.document_sent_by || '',
    doc.remarks || '',
  ]);

  const projectActivityRows = [];
  (projectActivities || []).forEach((activity) => {
    const assignedUsers = Array.isArray(activity.assigned_users)
      ? activity.assigned_users
      : [];
    if (assignedUsers.length === 0) {
      projectActivityRows.push([
        activity.discipline || activity.function_name || '',
        activity.activity_name || activity.name || '',
        activity.activity_description || '',
        '',
        '',
        '',
        '',
        '',
        'Not Started',
        '',
      ]);
      return;
    }

    assignedUsers.forEach((assigned) => {
      const assignment =
        typeof assigned === 'object' ? assigned : { user_id: assigned };
      projectActivityRows.push([
        activity.discipline || activity.function_name || '',
        activity.activity_name || activity.name || '',
        activity.activity_description || '',
        resolveTeamMemberName(assignment.user_id),
        assignment.description || '',
        assignment.qty_assigned || '',
        formatExportDate(assignment.start_date),
        formatExportDate(assignment.due_date),
        assignment.status || 'Not Started',
        assignment.remarks || assignment.notes || '',
      ]);
    });
  });

  const documentIssuedRows = (documentsIssued || []).map((doc, idx) => [
    idx + 1,
    doc.document_name || '',
    doc.issued_for || '',
    doc.document_number || '',
    doc.revision_number || '',
    formatExportDate(doc.issue_date),
    doc.remarks || '',
  ]);

  const queryLogRows = (queryLog || []).map((row, idx) => [
    idx + 1,
    row.query_description || '',
    formatExportDate(row.query_issued_date),
    row.reply_from_client || '',
    formatExportDate(row.reply_received_date),
    row.query_updated_by || '',
    row.query_resolved || '',
    row.remark || '',
  ]);

  const assumptionRows = (assumptions || []).map((row, idx) => [
    idx + 1,
    row.assumption_description || '',
    row.reason || '',
    row.assumption_taken_by || '',
    row.remark || '',
  ]);

  const discussionRows = (discussions || []).map((row, idx) => [
    idx + 1,
    formatExportDate(row.follow_up_date),
    row.description || '',
    row.responsible_person || '',
    row.logged_by || row.created_by || '',
    row.status || '',
  ]);

  return {
    input_documents: {
      title: 'Input Documents',
      columns: [
        'Sr No',
        'Category',
        'Lot/Sub-lot',
        'Date',
        'Description',
        'Drawing No',
        'Sheet No',
        'Revision',
        'Unit/Qty',
        'Sent By',
        'Remarks',
      ],
      rows: inputDocumentRows,
    },
    scope: {
      title: 'Scope',
      columns: ['Field', 'Value'],
      rows: scopeRows,
    },
    project_activity: {
      title: 'Project Activity',
      columns: [
        'Discipline',
        'Activity',
        'Activity Description',
        'Team Member',
        'Description',
        'Qty Assigned',
        'Start Date',
        'Due Date',
        'Status',
        'Notes',
      ],
      rows: projectActivityRows,
    },
    documents_issued: {
      title: 'Document Issued',
      columns: [
        'Sr No',
        'Document Name',
        'Issued For',
        'Document Number',
        'Revision',
        'Issue Date',
        'Remarks',
      ],
      rows: documentIssuedRows,
    },
    query_log: {
      title: 'Query Log',
      columns: [
        'Sr No',
        'Query Description',
        'Issued Date',
        'Reply From Client',
        'Reply Date',
        'Updated By',
        'Resolved',
        'Remark',
      ],
      rows: queryLogRows,
    },
    assumption: {
      title: 'Assumption',
      columns: [
        'Sr No',
        'Assumption Description',
        'Reason',
        'Taken By',
        'Remark',
      ],
      rows: assumptionRows,
    },
    discussion: {
      title: 'Discussion',
      columns: [
        'Sr No',
        'Date',
        'Topic',
        'Participants',
        'Logged By',
        'Status',
      ],
      rows: discussionRows,
    },
  };
}
