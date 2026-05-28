import { buildTabSheet } from './sheetUtils';

const EXPORT_TAB_OPTIONS = [
  { key: 'input_documents', title: 'Input Documents' },
  { key: 'scope', title: 'Scope' },
  { key: 'project_activity', title: 'Project Activity' },
  { key: 'documents_issued', title: 'Document Issued' },
  { key: 'query_log', title: 'Query Log' },
  { key: 'assumption', title: 'Assumption' },
  { key: 'discussion', title: 'Discussion' },
];

export async function exportProjectWorkbook({ form, id, payloads }) {
  const ExcelJSImport = await import('exceljs');
  const ExcelJS = ExcelJSImport.default || ExcelJSImport;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Accent Techno Solutions';
  workbook.created = new Date();

  let logoImageId = null;
  try {
    const logoResponse = await fetch('/accent-logo.png');
    if (logoResponse.ok) {
      const logoBlob = await logoResponse.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(logoBlob);
      });
      if (typeof dataUrl === 'string') {
        logoImageId = workbook.addImage({
          base64: dataUrl,
          extension: 'png',
        });
      }
    }
  } catch {
    // Logo is optional for export; continue if fetch/parse fails.
  }

  EXPORT_TAB_OPTIONS.forEach(({ key }) => {
    const config = payloads[key];
    if (!config) return;
    buildTabSheet(
      workbook,
      logoImageId,
      config.title,
      config.columns,
      config.rows,
      form?.name,
      form?.project_id || id
    );
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeProjectId = String(form?.project_id || id || 'project').replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  const dateTag = new Date().toISOString().split('T')[0];
  anchor.href = downloadUrl;
  anchor.download = `${safeProjectId}_project_tabs_${dateTag}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}

export async function exportSingleSheetWorkbook({
  form,
  id,
  payloads,
  selectedExportSheet,
}) {
  const selected = payloads[selectedExportSheet];
  if (!selected) {
    throw new Error('Invalid sheet selected');
  }

  const ExcelJSImport = await import('exceljs');
  const ExcelJS = ExcelJSImport.default || ExcelJSImport;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Accent Techno Solutions';
  workbook.created = new Date();

  let logoImageId = null;
  try {
    const logoResponse = await fetch('/accent-logo.png');
    if (logoResponse.ok) {
      const logoBlob = await logoResponse.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(logoBlob);
      });
      if (typeof dataUrl === 'string') {
        logoImageId = workbook.addImage({
          base64: dataUrl,
          extension: 'png',
        });
      }
    }
  } catch {
    // Logo is optional.
  }

  buildTabSheet(
    workbook,
    logoImageId,
    selected.title,
    selected.columns,
    selected.rows,
    form?.name,
    form?.project_id || id
  );

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeProjectId = String(form?.project_id || id || 'project').replace(
    /[^a-zA-Z0-9_-]/g,
    '_'
  );
  const safeSheet = String(selected.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  const dateTag = new Date().toISOString().split('T')[0];
  anchor.href = downloadUrl;
  anchor.download = `${safeProjectId}_${safeSheet}_${dateTag}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(downloadUrl);
}
