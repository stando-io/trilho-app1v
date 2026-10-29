import ExcelJS from 'exceljs';

export interface StructureRow {
  sector: string;
  department: string | null;
}

export interface StructureError {
  line: number;
  message: string;
}

export interface StructureParseResult {
  rows: StructureRow[];
  errors: StructureError[];
}

const MAX_ROWS = 200;

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function buildStructureTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Estrutura');
  sheet.columns = [
    { header: 'Nome do Setor', key: 'sector', width: 32 },
    { header: 'Nome do Departamento', key: 'department', width: 40 },
  ];
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF5B4FE9' } };
  sheet.addRow({ sector: 'Exemplo: Comercial', department: 'Exemplo: Atendimento' });
  sheet.addRow({ sector: 'Exemplo: Operações', department: 'Exemplo: Logística' });
  sheet.addRow({ sector: 'Exemplo: Financeiro', department: null });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook.xlsx.writeBuffer().then((buffer) => Buffer.from(buffer));
}

function validateEntries(
  entries: Array<{ line: number; sector: string; department: string }>,
): StructureParseResult {
  const errors: StructureError[] = [];
  const rows: StructureRow[] = [];
  const dataLines = entries.filter((entry) => entry.sector !== '' || entry.department !== '');
  if (dataLines.length === 0) {
    errors.push({ line: 1, message: 'A planilha não possui linhas de dados' });
    return { rows, errors };
  }
  if (dataLines.length > MAX_ROWS) {
    errors.push({ line: 1, message: `A planilha excede o limite de ${MAX_ROWS} linhas` });
    return { rows, errors };
  }
  for (const entry of dataLines) {
    const sector = entry.sector.trim();
    const department = entry.department.trim();
    if (!sector) {
      errors.push({ line: entry.line, message: 'Nome do Setor obrigatório' });
      continue;
    }
    if (sector.length > 80) {
      errors.push({ line: entry.line, message: 'Nome do Setor excede 80 caracteres' });
      continue;
    }
    if (department.length > 80) {
      errors.push({ line: entry.line, message: 'Nome do Departamento excede 80 caracteres' });
      continue;
    }
    rows.push({ sector, department: department || null });
  }
  return { rows, errors };
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ';') {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export function parseStructureCsv(text: string): StructureParseResult {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 1, message: 'Arquivo vazio' }] };
  }
  const header = parseCsvLine(lines[0]!).map(normalizeHeader);
  const sectorIndex = header.indexOf('nome do setor');
  if (sectorIndex === -1) {
    return {
      rows: [],
      errors: [{ line: 1, message: "Coluna 'Nome do Setor' não encontrada" }],
    };
  }
  const departmentIndex = header.indexOf('nome do departamento');
  const entries = lines.slice(1).map((line, index) => {
    const fields = parseCsvLine(line);
    return {
      line: index + 2,
      sector: fields[sectorIndex] ?? '',
      department: departmentIndex >= 0 ? (fields[departmentIndex] ?? '') : '',
    };
  });
  return validateEntries(entries);
}

export async function parseStructureXlsx(buffer: Buffer): Promise<StructureParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    return { rows: [], errors: [{ line: 1, message: 'Arquivo .xlsx inválido ou corrompido' }] };
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { rows: [], errors: [{ line: 1, message: 'A planilha não possui abas' }] };
  }
  const headerRow = sheet.getRow(1);
  const headerCells: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headerCells[colNumber - 1] = normalizeHeader(String(cell.value ?? ''));
  });
  const sectorIndex = headerCells.findIndex((cell) => cell === 'nome do setor');
  if (sectorIndex === -1) {
    return {
      rows: [],
      errors: [{ line: 1, message: "Coluna 'Nome do Setor' não encontrada" }],
    };
  }
  const departmentIndex = headerCells.findIndex((cell) => cell === 'nome do departamento');
  const entries: Array<{ line: number; sector: string; department: string }> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cellValue = (index: number): string => {
      if (index < 0) return '';
      const value = row.getCell(index + 1).value;
      if (value === null || value === undefined) return '';
      return String(value);
    };
    entries.push({
      line: rowNumber,
      sector: cellValue(sectorIndex),
      department: cellValue(departmentIndex),
    });
  });
  return validateEntries(entries);
}
