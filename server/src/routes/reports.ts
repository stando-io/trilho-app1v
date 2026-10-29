import { Router } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { getProjectPool } from '../db/projectPool.js';
import { query } from '../db/pool.js';
import { Request, Response, NextFunction } from 'express';
import { requirePermission, requireScreen } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

function requireReportAccess(req: Request, res: Response, next: NextFunction): void {
  const format = req.query.format;
  const isExport = format === 'csv' || format === 'xlsx';
  requirePermission(isExport ? 'reports.exportar' : 'reports.visualizar')(req, res, next);
}

const REPORT_TZ = 'America/Sao_Paulo';

const optionalDate = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data invalida, use AAAA-MM-DD')
    .optional(),
);

const optionalUuid = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().uuid('Identificador invalido').optional(),
);

const reportQuery = z.object({
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
  date_from: optionalDate,
  date_to: optionalDate,
  sector_id: optionalUuid,
  department_id: optionalUuid,
  user_id: optionalUuid,
});

type ReportQuery = z.infer<typeof reportQuery>;

interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

interface CardWhere {
  sql: string;
  params: unknown[];
}

function buildCardWhere(filters: ReportQuery): CardWhere {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const add = (clause: (index: number) => string, value: string): void => {
    params.push(value);
    clauses.push(clause(params.length));
  };
  if (filters.date_from)
    add((i) => `((c.created_at AT TIME ZONE '${REPORT_TZ}')::date >= $${i}::date)`, filters.date_from);
  if (filters.date_to)
    add((i) => `((c.created_at AT TIME ZONE '${REPORT_TZ}')::date <= $${i}::date)`, filters.date_to);
  if (filters.sector_id) add((i) => `d.sector_id = $${i}`, filters.sector_id);
  if (filters.department_id) add((i) => `c.department_id = $${i}`, filters.department_id);
  if (filters.user_id) add((i) => `c.responsible_id = $${i}`, filters.user_id);
  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

function percentOf(done: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((done * 100) / total)}%`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function datePartsInReportTz(date: Date): { year: string; month: string; day: string } {
  const [year = '', month = '', day = ''] = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .split('-');
  return { year, month, day };
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  if (typeof value === 'string') {
    const pureDate = ISO_DATE.exec(value);
    if (pureDate) return `${pureDate[0].slice(8, 10)}/${pureDate[0].slice(5, 7)}/${pureDate[0].slice(0, 4)}`;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    const { year, month, day } = datePartsInReportTz(parsed);
    return `${day}/${month}/${year}`;
  }
  if (Number.isNaN(value.getTime())) return '—';
  const { year, month, day } = datePartsInReportTz(value);
  return `${day}/${month}/${year}`;
}

function formatDateTime(value: Date | string | null): string {
  if (!value) return '—';
  if (typeof value === 'string' && ISO_DATE.test(value)) return formatDate(value);
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORT_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${formatDate(date)} ${time}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const PRIORITY_LABELS: Record<string, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
};

async function progressReport(projectId: string, filters: ReportQuery): Promise<ReportTable> {
  const { projectPool } = await getProjectPool(projectId);
  const where = buildCardWhere(filters);
  const [indicators, sectors] = await Promise.all([
    projectPool.query<{
      total_cards: number;
      done_cards: number;
      overdue_cards: number;
    }>(
      `SELECT count(*)::int AS total_cards,
              count(*) FILTER (WHERE c.completed_at IS NOT NULL)::int AS done_cards,
              count(*) FILTER (WHERE c.due_date IS NOT NULL
                                AND c.due_date < (now() AT TIME ZONE '${REPORT_TZ}')::date
                                AND c.completed_at IS NULL)::int AS overdue_cards
       FROM cards c
       LEFT JOIN departments d ON d.id = c.department_id
       ${where.sql}`,
      where.params,
    ),
    projectPool.query<{
      name: string;
      total_cards: number;
      completed_cards: number;
      overdue_cards: number;
    }>(
      `SELECT s.name,
              count(c.id)::int AS total_cards,
              count(c.id) FILTER (WHERE c.completed_at IS NOT NULL)::int AS completed_cards,
              count(c.id) FILTER (WHERE c.due_date IS NOT NULL
                                    AND c.due_date < (now() AT TIME ZONE '${REPORT_TZ}')::date
                                    AND c.completed_at IS NULL)::int AS overdue_cards
       FROM sectors s
       LEFT JOIN departments d ON d.sector_id = s.id
       LEFT JOIN cards c ON c.department_id = d.id
       ${where.sql}
       GROUP BY s.id
       ORDER BY s.position, s.created_at`,
      where.params,
    ),
  ]);

  const indicator = indicators.rows[0]!;
  const pending = indicator.total_cards - indicator.done_cards;

  return {
    title: 'Progresso do projeto',
    columns: ['Escopo', 'Cartões', 'Concluídos', 'Pendentes', 'Atrasados', 'Percentual'],
    rows: [
      [
        'Projeto',
        indicator.total_cards,
        indicator.done_cards,
        pending,
        indicator.overdue_cards,
        percentOf(indicator.done_cards, indicator.total_cards),
      ],
      ...sectors.rows.map((sector) => [
        sector.name,
        sector.total_cards,
        sector.completed_cards,
        sector.total_cards - sector.completed_cards,
        sector.overdue_cards,
        percentOf(sector.completed_cards, sector.total_cards),
      ]),
    ],
  };
}

async function cardsReport(projectId: string, filters: ReportQuery): Promise<ReportTable> {
  const { projectPool } = await getProjectPool(projectId);
  const where = buildCardWhere(filters);
  const [cards, members] = await Promise.all([
    projectPool.query<{
      task_code: string | null;
      title: string;
      sector_name: string | null;
      department_name: string | null;
      responsible_id: string | null;
      priority: string;
      origin: string;
      due_date: string | null;
      created_at: Date;
      situation: string;
    }>(
      `SELECT c.task_code, c.title,
              s.name AS sector_name, d.name AS department_name,
              c.responsible_id, c.priority, c.origin,
              c.due_date, c.created_at,
              CASE WHEN c.completed_at IS NOT NULL THEN 'Concluído'
                   WHEN c.due_date IS NOT NULL AND c.due_date < (now() AT TIME ZONE '${REPORT_TZ}')::date THEN 'Atrasado'
                   ELSE 'Pendente' END AS situation
       FROM cards c
       LEFT JOIN departments d ON d.id = c.department_id
       LEFT JOIN sectors s ON s.id = d.sector_id
       ${where.sql}
       ORDER BY c.task_code, c.created_at`,
      where.params,
    ),
    query<{ id: string; name: string }>(
      `SELECT u.id, u.name
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id = $1`,
      [projectId],
    ),
  ]);

  const nameById = new Map(members.map((member) => [member.id, member.name]));

  return {
    title: 'Cards',
    columns: [
      'Código',
      'Título',
      'Situação',
      'Setor',
      'Departamento',
      'Responsável',
      'Prioridade',
      'Origem',
      'Vencimento',
      'Criado em',
    ],
    rows: cards.rows.map((card) => [
      card.task_code ?? '—',
      card.title,
      card.situation,
      card.sector_name ?? '—',
      card.department_name ?? '—',
      (card.responsible_id && nameById.get(card.responsible_id)) || 'Sem responsável',
      PRIORITY_LABELS[card.priority] ?? capitalize(card.priority),
      card.origin || '—',
      formatDate(card.due_date),
      formatDateTime(card.created_at),
    ]),
  };
}

async function learningReport(projectId: string, filters: ReportQuery): Promise<ReportTable> {
  const { projectPool } = await getProjectPool(projectId);
  const where = buildCardWhere(filters);
  const [cards, members] = await Promise.all([
    projectPool.query<{
      task_code: string | null;
      responsible_id: string | null;
      learning_index_score: number | null;
      learning_index_note: string | null;
    }>(
      `SELECT c.task_code, c.responsible_id,
              c.learning_index_score, c.learning_index_note
       FROM cards c
       LEFT JOIN departments d ON d.id = c.department_id
       ${where.sql ? `${where.sql} AND` : 'WHERE'} c.learning_index_active = true
       ORDER BY c.learning_index_score ASC NULLS LAST, c.task_code, c.created_at`,
      where.params,
    ),
    query<{ id: string; name: string }>(
      `SELECT u.id, u.name
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id = $1`,
      [projectId],
    ),
  ]);

  const nameById = new Map(members.map((member) => [member.id, member.name]));

  return {
    title: 'Detalhamento das Avaliações (Índice de Aprendizado)',
    columns: ['Código', 'Técnico', 'Nota', 'Observação'],
    rows: cards.rows.map((card) => [
      card.task_code ?? '—',
      (card.responsible_id && nameById.get(card.responsible_id)) || 'Sem responsável',
      card.learning_index_score,
      card.learning_index_note || '—',
    ]),
  };
}

function toCsv(report: ReportTable): string {
  const escapeCell = (value: string | number | null): string => {
    const text = value === null ? '' : String(value);
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [report.columns.map(escapeCell).join(';')];
  for (const row of report.rows) {
    lines.push(row.map(escapeCell).join(';'));
  }
  return String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n';
}

async function toXlsx(report: ReportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(report.title);
  sheet.columns = report.columns.map((header, index) => ({
    header,
    key: `c${index}`,
    width: Math.max(14, Math.min(40, header.length + 8)),
  }));
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF5B4FE9' },
  };
  for (const row of report.rows) {
    sheet.addRow(row);
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function todaySuffix(): string {
  const { year, month, day } = datePartsInReportTz(new Date());
  return `${year}-${month}-${day}`;
}

router.get('/reports/filters', requireScreen('reports'), async (req, res, next) => {
  try {
    const { projectPool } = await getProjectPool(req.params.projectId!);
    const [sectors, departments, users] = await Promise.all([
      projectPool.query<{ id: string; name: string }>(
        'SELECT id, name FROM sectors ORDER BY position, created_at',
      ),
      projectPool.query<{ id: string; name: string; sector_id: string }>(
        'SELECT id, name, sector_id FROM departments ORDER BY name',
      ),
      query<{ id: string; name: string }>('SELECT id, name FROM users ORDER BY name'),
    ]);
    res.json({
      sectors: sectors.rows,
      departments: departments.rows,
      users,
    });
  } catch (error) {
    next(error);
  }
});

router.get('/reports/progress', requireReportAccess, async (req, res, next) => {
  try {
    const q = reportQuery.parse(req.query);
    const report = await progressReport(req.params.projectId!, q);
    const filename = `relatorio-progresso-${todaySuffix()}`;
    if (q.format === 'json') {
      res.json(report);
      return;
    }
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(toCsv(report));
      return;
    }
    const buffer = await toXlsx(report);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.get('/reports/cards', requireReportAccess, async (req, res, next) => {
  try {
    const q = reportQuery.parse(req.query);
    const report = await cardsReport(req.params.projectId!, q);
    const filename = `relatorio-cards-${todaySuffix()}`;
    if (q.format === 'json') {
      res.json(report);
      return;
    }
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(toCsv(report));
      return;
    }
    const buffer = await toXlsx(report);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

router.get('/reports/learning', requireReportAccess, async (req, res, next) => {
  try {
    const q = reportQuery.parse(req.query);
    const report = await learningReport(req.params.projectId!, q);
    const filename = `relatorio-indice-aprendizado-${todaySuffix()}`;
    if (q.format === 'json') {
      res.json(report);
      return;
    }
    if (q.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.send(toCsv(report));
      return;
    }
    const buffer = await toXlsx(report);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

export default router;
