export const addLogoToSheet = (sheet, imageId) => {
  if (!imageId) return;
  sheet.addImage(imageId, {
    tl: { col: 7, row: 0 },
    ext: { width: 140, height: 50 },
  });
};

export const applyHeaderStyle = (row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF7F2487" },
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };
  });
};

export const autoFitColumns = (sheet, columns, rows) => {
  columns.forEach((header, index) => {
    const longestDataCell = rows.reduce((max, row) => {
      const value = row[index];
      const length =
        value === null || value === undefined ? 0 : String(value).length;
      return Math.max(max, length);
    }, String(header).length);
    sheet.getColumn(index + 1).width = Math.min(
      Math.max(longestDataCell + 2, 12),
      45,
    );
  });
};

export const buildTabSheet = (workbook, imageId, title, columns, rows, formName, projectId) => {
  const sheet = workbook.addWorksheet(title);
  addLogoToSheet(sheet, imageId);
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = {
    size: 15,
    bold: true,
    color: { argb: "FF111827" },
  };
  sheet.getCell("A2").value = `Project: ${formName || ""}`;
  sheet.getCell("A2").font = { size: 11, color: { argb: "FF4B5563" } };
  sheet.getCell("A3").value = `Project ID: ${projectId || ""}`;
  sheet.getCell("A3").font = { size: 11, color: { argb: "FF4B5563" } };

  const headerRow = sheet.addRow(columns);
  applyHeaderStyle(headerRow);

  rows.forEach((rowData) => {
    const row = sheet.addRow(rowData);
    row.alignment = { vertical: "top", wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });
  });

  sheet.views = [{ state: "frozen", ySplit: 4 }];
  autoFitColumns(sheet, columns, rows);
  return sheet;
};
