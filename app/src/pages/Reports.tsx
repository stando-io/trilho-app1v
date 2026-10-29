import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { can, useAuth } from '../auth';
import { InfoTip } from '../components/InfoTip';
import LoadingOverlay from '../components/LoadingOverlay';
import PaginationFooter from '../components/PaginationFooter';
import ScoreBar from '../components/ScoreBar';
import { useToast } from '../components/Toast';
import { useProjectId } from '../project';
import { usePageSize } from '../usePageSize';
import { avatarColor, initials } from '../views/taskViewUtils';

interface ReportTable {
  title: string;
  columns: string[];
  rows: (string | number | null)[][];
}

interface FilterOptions {
  sectors: { id: string; name: string }[];
  departments: { id: string; name: string; sector_id: string }[];
  users: { id: string; name: string }[];
}

interface FilterValues {
  date_from: string;
  date_to: string;
  sector_id: string;
  department_id: string;
  user_id: string;
}

interface StackCounts {
  done: number;
  pending: number;
  overdue: number;
}

type ViewMode = 'table' | 'chart';
type PanelId = 'progress' | 'cards' | 'learning';
type SortState = { column: number; direction: 'asc' | 'desc' } | null;

const EMPTY_FILTERS: FilterValues = {
  date_from: '',
  date_to: '',
  sector_id: '',
  department_id: '',
  user_id: '',
};

const PANEL_ORDER_DEFAULT: PanelId[] = ['progress', 'cards', 'learning'];

const PANEL_LABELS: Record<PanelId, string> = {
  progress: 'Progresso',
  cards: 'Cards',
  learning: 'Índice de Aprendizado',
};

function filtersToQuery(filters: FilterValues): string {
  const params = new URLSearchParams();
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  if (filters.sector_id) params.set('sector_id', filters.sector_id);
  if (filters.department_id) params.set('department_id', filters.department_id);
  if (filters.user_id) params.set('user_id', filters.user_id);
  const text = params.toString();
  return text ? `?${text}` : '';
}

function activeFilterCount(filters: FilterValues): number {
  let count = 0;
  if (filters.date_from || filters.date_to) count += 1;
  if (filters.sector_id) count += 1;
  if (filters.department_id) count += 1;
  if (filters.user_id) count += 1;
  return count;
}

function exportHref(base: string, query: string, format: 'xlsx' | 'csv'): string {
  const separator = query.includes('?') ? '&' : '?';
  return `${base}${query}${separator}format=${format}`;
}

function readView(endpoint: 'progress' | 'cards'): ViewMode {
  try {
    const stored = window.sessionStorage.getItem(`relatorios:${endpoint}:view`);
    if (stored === 'table' || stored === 'chart') return stored;
  } catch {
    // armazenamento indisponivel: mantem a visualizacao padrao
  }
  return 'table';
}

function writeView(endpoint: 'progress' | 'cards', view: ViewMode): void {
  try {
    window.sessionStorage.setItem(`relatorios:${endpoint}:view`, view);
  } catch {
    // armazenamento indisponivel: a escolha vale so nesta sessao
  }
}

function readPanelOrder(userId: string | null): PanelId[] {
  try {
    const stored = window.localStorage.getItem(`relatorios:panel-order:${userId ?? 'anon'}`);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (
        Array.isArray(parsed) &&
        parsed.length === PANEL_ORDER_DEFAULT.length &&
        PANEL_ORDER_DEFAULT.every((id) => parsed.includes(id))
      ) {
        return parsed as PanelId[];
      }
    }
  } catch {
    // armazenamento indisponivel ou valor invalido: mantem a ordem padrao
  }
  return [...PANEL_ORDER_DEFAULT];
}

function writePanelOrder(userId: string | null, order: PanelId[]): void {
  try {
    window.localStorage.setItem(`relatorios:panel-order:${userId ?? 'anon'}`, JSON.stringify(order));
  } catch {
    // armazenamento indisponivel: a ordem vale so nesta sessao
  }
}

function filterReport(report: ReportTable, search: string): ReportTable {
  const needle = search.trim().toLowerCase();
  if (!needle) return report;
  return {
    ...report,
    rows: report.rows.filter((row) =>
      row.some((cell) => String(cell ?? '').toLowerCase().includes(needle)),
    ),
  };
}

function sortValue(cell: string | number | null): string | number | null {
  if (cell === null) return null;
  if (typeof cell === 'number') return cell;
  const text = cell.trim();
  const percent = /^(-?\d+(?:[.,]\d+)?)\s*%$/.exec(text);
  if (percent) return Number(percent[1].replace(',', '.'));
  if (text !== '' && /^-?\d+([.,]\d+)?$/.test(text)) return Number(text.replace(',', '.'));
  return text;
}

function compareByColumn(
  a: (string | number | null)[],
  b: (string | number | null)[],
  column: number,
  direction: 'asc' | 'desc',
): number {
  const valueA = sortValue(a[column]);
  const valueB = sortValue(b[column]);
  if (valueA === null && valueB === null) return 0;
  if (valueA === null) return 1;
  if (valueB === null) return -1;
  let result: number;
  if (typeof valueA === 'number' && typeof valueB === 'number') {
    result = valueA - valueB;
  } else {
    result = String(valueA).localeCompare(String(valueB), 'pt-BR', { numeric: true });
  }
  return direction === 'asc' ? result : -result;
}

function sortRows(
  rows: (string | number | null)[][],
  sort: SortState,
): (string | number | null)[][] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => compareByColumn(a, b, sort.column, sort.direction));
}

function toggleSort(current: SortState, column: number): SortState {
  if (!current || current.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return null;
}

function SortableHeader({
  columns,
  sort,
  onSort,
}: {
  columns: string[];
  sort: SortState;
  onSort: (column: number) => void;
}) {
  return (
    <thead>
      <tr>
        {columns.map((column, index) => {
          const active = sort !== null && sort.column === index;
          return (
            <th
              key={column}
              aria-sort={
                active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
              }
            >
              <button
                type="button"
                className={`th-sort${active ? ' is-active' : ''}`}
                title={`Ordenar por ${column}`}
                onClick={() => onSort(index)}
              >
                {column}
                {active && (
                  <span className="th-sort-mark" aria-hidden="true">
                    {sort.direction === 'asc' ? '▲' : '▼'}
                  </span>
                )}
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

interface LearningPanelProps {
  report: ReportTable;
  searching: boolean;
}

function renderCell(column: string, cell: string | number | null) {
  const value = cell === null ? '—' : cell;
  if (column === 'Situação' && typeof value === 'string') {
    const tone =
      value === 'Concluído' ? 'status-ok' : value === 'Atrasado' ? 'status-danger' : 'status-warn';
    return (
      <span className={`status-badge ${tone}`}>
        <span className="status-dot" />
        {value}
      </span>
    );
  }
  if (column === 'Prioridade' && value === 'Alta') {
    return (
      <span className="prio-cell">
        <span className="prio-dot" />
        {value}
      </span>
    );
  }
  return value;
}

function columnIndex(report: ReportTable, name: string): number {
  return report.columns.indexOf(name);
}

function ProgressChart({ report }: { report: ReportTable }) {
  const escopo = columnIndex(report, 'Escopo');
  const cartoes = columnIndex(report, 'Cartões');
  const concluidos = columnIndex(report, 'Concluídos');
  const atrasados = columnIndex(report, 'Atrasados');
  const percentual = columnIndex(report, 'Percentual');

  return (
    <div className="report-chart">
      {report.rows.map((row, rowIndex) => {
        const total = Number(row[cartoes]);
        const done = Number(row[concluidos]);
        const overdue = Number(row[atrasados]);
        const tone = overdue > 0 ? 'danger' : total > 0 && done === total ? 'success' : 'warning';
        const width = total === 0 ? 0 : Math.round((done * 100) / total);
        return (
          <div className="chart-row" key={rowIndex}>
            <span className="chart-label">{row[escopo]}</span>
            <span className="chart-track">
              <span className={`chart-fill chart-${tone}`} style={{ width: `${width}%` }} />
            </span>
            <span className="chart-value">{row[percentual]}</span>
          </div>
        );
      })}
    </div>
  );
}

function addToStack(stack: Map<string, StackCounts>, key: string, situation: string): void {
  const entry = stack.get(key) ?? { done: 0, pending: 0, overdue: 0 };
  if (situation === 'Concluído') entry.done += 1;
  else if (situation === 'Atrasado') entry.overdue += 1;
  else entry.pending += 1;
  stack.set(key, entry);
}

function CardsChart({ report }: { report: ReportTable }) {
  const situacao = columnIndex(report, 'Situação');
  const setor = columnIndex(report, 'Setor');
  const stack = new Map<string, StackCounts>();

  report.rows.forEach((row) => {
    const situation = String(row[situacao]);
    const sector = String(row[setor]);
    addToStack(stack, 'Projeto', situation);
    addToStack(stack, sector === '—' ? 'Sem setor' : sector, situation);
  });

  return (
    <div className="report-chart">
      <div className="chart-legend">
        <span>
          <span className="chart-dot chart-success" />
          Concluído
        </span>
        <span>
          <span className="chart-dot chart-warning" />
          Pendente
        </span>
        <span>
          <span className="chart-dot chart-danger" />
          Atrasado
        </span>
      </div>
      {Array.from(stack.entries()).map(([name, counts]) => {
        const total = counts.done + counts.pending + counts.overdue;
        return (
          <div className="chart-row" key={name}>
            <span className="chart-label">{name}</span>
            <span className="chart-track chart-stack">
              {total > 0 && (
                <>
                  {counts.done > 0 && (
                    <span className="chart-seg chart-success" style={{ flexGrow: counts.done }} />
                  )}
                  {counts.pending > 0 && (
                    <span className="chart-seg chart-warning" style={{ flexGrow: counts.pending }} />
                  )}
                  {counts.overdue > 0 && (
                    <span className="chart-seg chart-danger" style={{ flexGrow: counts.overdue }} />
                  )}
                </>
              )}
            </span>
            <span className="chart-value">{total}</span>
          </div>
        );
      })}
    </div>
  );
}

function LearningPanel({ report, searching }: LearningPanelProps) {
  const [tech, setTech] = useState('');
  const [sort, setSort] = useState<SortState>(null);
  const [tablePage, setTablePage] = useState(1);
  const [pageSize, setPageSize] = usePageSize('relatorios:learning:page-size');

  const technicians = useMemo(() => {
    const names = new Set<string>();
    for (const row of report.rows) {
      const name = String(row[1] ?? '');
      if (name && name !== 'Sem responsável') names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [report.rows]);

  const rows = useMemo(() => {
    const filtered = tech ? report.rows.filter((row) => row[1] === tech) : [...report.rows];
    if (sort) return filtered.sort((a, b) => compareByColumn(a, b, sort.column, sort.direction));
    return filtered.sort((a, b) => {
      const scoreA = typeof a[2] === 'number' ? a[2] : null;
      const scoreB = typeof b[2] === 'number' ? b[2] : null;
      if (scoreA === null && scoreB === null) return 0;
      if (scoreA === null) return 1;
      if (scoreB === null) return -1;
      return scoreA - scoreB;
    });
  }, [report.rows, tech, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(tablePage, pages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setTablePage(1);
  }, [rows]);

  return (
    <section className="panel report-panel">
      <div className="panel-head">
        <div className="panel-title">
          <h2>
            Índice de Aprendizado
            <InfoTip text="Histórico detalhado de notas, técnicos atribuídos e observações registradas nas avaliações dos cards para identificar pontos de atenção." />
          </h2>
        </div>
        <div className="panel-head-tools">
          <span className="pill pill-plain">{rows.length} linhas</span>
          <div className="learning-tools">
            <select
              aria-label="Filtrar por técnico"
              value={tech}
              onChange={(event) => setTech(event.target.value)}
            >
              <option value="">Todos os técnicos</option>
              {technicians.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="report-empty">
          {searching || tech ? 'Nenhum resultado encontrado.' : 'Nenhuma avaliação registrada.'}
        </p>
      ) : (
        <>
          <div className="report-table">
            <table className="table">
              <SortableHeader columns={report.columns} sort={sort} onSort={(column) => setSort((current) => toggleSort(current, column))} />
              <tbody>
                {pageRows.map((row, rowIndex) => {
                  const technician = String(row[1] ?? '');
                  const score = typeof row[2] === 'number' ? row[2] : null;
                  return (
                    <tr key={rowIndex}>
                      <td>{String(row[0] ?? '—')}</td>
                      <td>
                        <span className="learning-tech">
                          {technician && technician !== 'Sem responsável' ? (
                            <>
                              <span
                                className="card-avatar card-avatar-mini"
                                style={{ background: avatarColor(technician) }}
                                aria-hidden="true"
                              >
                                {initials(technician)}
                              </span>
                              {technician}
                            </>
                          ) : (
                            <span className="muted">Sem responsável</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <ScoreBar score={score} />
                      </td>
                      <td className="learning-note">{String(row[3] ?? '—')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationFooter
            total={rows.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setTablePage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setTablePage(1);
            }}
          />
        </>
      )}
    </section>
  );
}

interface ReportPanelProps {
  endpoint: 'progress' | 'cards';
  report: ReportTable;
  searching: boolean;
}

function ReportPanel({ endpoint, report, searching }: ReportPanelProps) {
  const [view, setView] = useState<ViewMode>(() => readView(endpoint));
  const [sort, setSort] = useState<SortState>(null);
  const [tablePage, setTablePage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(`relatorios:${endpoint}:page-size`);

  useEffect(() => {
    writeView(endpoint, view);
  }, [endpoint, view]);

  const rows = useMemo(() => sortRows(report.rows, sort), [report.rows, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(tablePage, pages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    setTablePage(1);
  }, [rows]);

  return (
    <section className="panel report-panel">
      <div className="panel-head">
        <h2>{report.title}</h2>
        <div className="panel-head-tools">
          <span className="pill pill-plain">{rows.length} linhas</span>
          <div className="view-toggle" role="group" aria-label="Visualização do relatório">
            <button
              type="button"
              className={view === 'table' ? 'active' : ''}
              aria-pressed={view === 'table'}
              onClick={() => setView('table')}
            >
              Lista
            </button>
            <button
              type="button"
              className={view === 'chart' ? 'active' : ''}
              aria-pressed={view === 'chart'}
              onClick={() => setView('chart')}
            >
              Gráfico
            </button>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="report-empty">
          {searching ? 'Nenhum resultado encontrado.' : 'Nenhum card encontrado.'}
        </p>
      ) : view === 'table' ? (
        <>
          <div className="report-table">
            <table className="table">
              <SortableHeader columns={report.columns} sort={sort} onSort={(column) => setSort((current) => toggleSort(current, column))} />
              <tbody>
                {pageRows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderCell(report.columns[cellIndex], cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationFooter
            total={rows.length}
            page={safePage}
            pageSize={pageSize}
            onPageChange={setTablePage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setTablePage(1);
            }}
          />
        </>
      ) : endpoint === 'progress' ? (
        <ProgressChart report={report} />
      ) : (
        <CardsChart report={report} />
      )}
    </section>
  );
}

export default function Reports() {
  const projectId = useProjectId();
  const toast = useToast();
  const { user } = useAuth();
  const canFilter = can(user, 'reports.filtrar');
  const canExport = can(user, 'reports.exportar');
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<FilterValues>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportTargets, setExportTargets] = useState({
    progress: true,
    cards: true,
    learning: true,
  });
  const [progress, setProgress] = useState<ReportTable | null>(null);
  const [cards, setCards] = useState<ReportTable | null>(null);
  const [learning, setLearning] = useState<ReportTable | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState('');
  const [panelOrder, setPanelOrder] = useState<PanelId[]>([...PANEL_ORDER_DEFAULT]);
  const exportRef = useRef<HTMLDivElement | null>(null);
  const searchActive = search.trim() !== '';
  const rangeError =
    filters.date_from && filters.date_to && filters.date_from > filters.date_to
      ? 'A data inicial não pode ser posterior à data final.'
      : '';

  useEffect(() => {
    setPanelOrder(readPanelOrder(user?.id ?? null));
  }, [user?.id]);

  useEffect(() => {
    if (!projectId) {
      setOptions(null);
      return;
    }

    let active = true;
    setFilters(EMPTY_FILTERS);

    (async () => {
      try {
        const data = await api<FilterOptions>(`/projects/${projectId}/reports/filters`);
        if (active) setOptions(data);
      } catch {
        // sem opcoes os selects ficam apenas com "Todos"; os relatorios seguem funcionando
        if (active) setOptions({ sectors: [], departments: [], users: [] });
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setProgress(null);
      setCards(null);
      setLearning(null);
      setLoaded(true);
      return;
    }
    if (rangeError) return;

    let active = true;
    setProgress(null);
    setCards(null);
    setLearning(null);
    setLoaded(false);
    const query = filtersToQuery(filters);

    (async () => {
      try {
        const [progressReport, cardsReport, learningReport] = await Promise.all([
          api<ReportTable>(`/projects/${projectId}/reports/progress${query}`),
          api<ReportTable>(`/projects/${projectId}/reports/cards${query}`),
          api<ReportTable>(`/projects/${projectId}/reports/learning${query}`),
        ]);
        if (!active) return;
        setProgress(progressReport);
        setCards(cardsReport);
        setLearning(learningReport);
      } catch (err) {
        if (!active) return;
        toast.error(
          err instanceof ApiError ? err.message : 'Não foi possível carregar os relatórios.',
        );
      } finally {
        if (active) setLoaded(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [projectId, filters, rangeError]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const handleOutside = (event: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [exportOpen]);

  function clearFilters(): void {
    setFilters(EMPTY_FILTERS);
  }

  function movePanel(id: PanelId, delta: -1 | 1): void {
    setPanelOrder((order) => {
      const index = order.indexOf(id);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return order;
      const updated = [...order];
      const [moved] = updated.splice(index, 1);
      updated.splice(nextIndex, 0, moved);
      writePanelOrder(user?.id ?? null, updated);
      return updated;
    });
  }

  function runExport(format: 'xlsx' | 'csv'): void {
    const targets = (['progress', 'cards', 'learning'] as const).filter(
      (target) => exportTargets[target],
    );
    const query = filtersToQuery(filters);
    targets.forEach((target, index) => {
      window.setTimeout(() => {
        const link = document.createElement('a');
        link.href = exportHref(`/api/v1/projects/${projectId}/reports/${target}`, query, format);
        link.download = '';
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 500);
    });
    setExportOpen(false);
  }

  const departmentOptions = (options?.departments ?? []).filter(
    (department) => !filters.sector_id || department.sector_id === filters.sector_id,
  );
  const filterCount = activeFilterCount(filters);

  const filteredProgress = useMemo(
    () => (progress ? filterReport(progress, search) : null),
    [progress, search],
  );
  const filteredCards = useMemo(
    () => (cards ? filterReport(cards, search) : null),
    [cards, search],
  );
  const filteredLearning = useMemo(
    () => (learning ? filterReport(learning, search) : null),
    [learning, search],
  );

  if (!projectId) {
    return (
      <div>
        <h1>Relatórios</h1>
        <div className="panel">
          <h2>Nenhum projeto selecionado</h2>
          <p>Selecione ou crie um projeto para ver os relatórios.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="panel report-toolbar">
        <div className="report-toolbar-main">
          <form
            className="kanban-search"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <svg
              className="search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar nos relatórios..."
              aria-label="Buscar nos relatórios"
            />
          </form>
          {canFilter && (
            <button
              type="button"
              className={`btn btn-plain filterbtn${filtersOpen ? ' is-open' : ''}`}
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
              </svg>
              Filtros
              {filterCount > 0 && <span className="filter-count">({filterCount})</span>}
            </button>
          )}
          <div className="report-organize">
            <button
              type="button"
              className={`btn btn-plain report-organizebtn${organizeOpen ? ' is-open' : ''}`}
              aria-expanded={organizeOpen}
              aria-label="Organizar painéis"
              onClick={() => setOrganizeOpen((open) => !open)}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
                <path d="M1 14h6M9 8h6M17 16h6" />
              </svg>
              Painéis
            </button>
            {organizeOpen && (
              <>
                <button
                  type="button"
                  className="col-menu-scrim"
                  aria-label="Fechar organização de painéis"
                  onClick={() => setOrganizeOpen(false)}
                />
                <div className="colcfg-pop report-colcfg-pop" role="menu">
                  <p className="colcfg-title">Painéis</p>
                  {panelOrder.map((id, index) => (
                    <div className="colcfg-row" key={id}>
                      <span className="colcfg-name">{PANEL_LABELS[id]}</span>
                      <button
                        type="button"
                        className="colcfg-btn"
                        aria-label={`Mover ${PANEL_LABELS[id]} para cima`}
                        disabled={index === 0}
                        onClick={() => movePanel(id, -1)}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="colcfg-btn"
                        aria-label={`Mover ${PANEL_LABELS[id]} para baixo`}
                        disabled={index === panelOrder.length - 1}
                        onClick={() => movePanel(id, 1)}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M12 5v14M19 12l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="toolbar-spacer" />
          {canExport && (
            <div className="export-dropdown" ref={exportRef}>
              <button
                type="button"
                className="btn"
                aria-haspopup="menu"
                aria-expanded={exportOpen}
                onClick={() => setExportOpen((open) => !open)}
              >
                Exportar
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="m6 9 6 6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            {exportOpen && (
              <div className="export-menu" role="menu">
                <label className="export-option">
                  <input
                    type="checkbox"
                    checked={exportTargets.progress}
                    onChange={() => setExportTargets((t) => ({ ...t, progress: !t.progress }))}
                  />
                  Progresso
                </label>
                <label className="export-option">
                  <input
                    type="checkbox"
                    checked={exportTargets.cards}
                    onChange={() => setExportTargets((t) => ({ ...t, cards: !t.cards }))}
                  />
                  Cards
                </label>
                <label className="export-option">
                  <input
                    type="checkbox"
                    checked={exportTargets.learning}
                    onChange={() => setExportTargets((t) => ({ ...t, learning: !t.learning }))}
                  />
                  Índice de aprendizado
                </label>
                <div className="export-formats">
                  <button
                    type="button"
                    className="btn"
                    disabled={!exportTargets.progress && !exportTargets.cards && !exportTargets.learning}
                    onClick={() => runExport('xlsx')}
                  >
                    Excel
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!exportTargets.progress && !exportTargets.cards && !exportTargets.learning}
                    onClick={() => runExport('csv')}
                  >
                    CSV
                  </button>
                </div>
              </div>
            )}
            </div>
          )}
        </div>
        {filtersOpen && <div className="report-toolbar-divider" />}
        {filtersOpen && (
          <form
            className="filters report-filters"
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <div className="filter-period">
              <input
                type="date"
                aria-label="Data inicial"
                value={filters.date_from}
                onChange={(event) => setFilters({ ...filters, date_from: event.target.value })}
              />
              <span className="filter-period-sep">até</span>
              <input
                type="date"
                aria-label="Data final"
                value={filters.date_to}
                onChange={(event) => setFilters({ ...filters, date_to: event.target.value })}
              />
            </div>
            <select
              aria-label="Setor"
              value={filters.sector_id}
              onChange={(event) =>
                setFilters({
                  ...filters,
                  sector_id: event.target.value,
                  department_id: '',
                })
              }
            >
              <option value="">Todos setores</option>
              {(options?.sectors ?? []).map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Departamento"
              value={filters.department_id}
              onChange={(event) => setFilters({ ...filters, department_id: event.target.value })}
            >
              <option value="">Todos departamentos</option>
              {departmentOptions.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Responsável"
              value={filters.user_id}
              onChange={(event) => setFilters({ ...filters, user_id: event.target.value })}
            >
              <option value="">Todos responsáveis</option>
              {(options?.users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-plain" onClick={clearFilters}>
              Limpar
            </button>
          </form>
        )}
      </div>

      {rangeError && <div className="error-box">{rangeError}</div>}

      {!loaded ? (
        <div className="panel">
          <LoadingOverlay />
        </div>
      ) : (
        filteredProgress &&
        filteredCards &&
        filteredLearning && (
          <div className="report-list">
            {panelOrder.map((id) => {
              if (id === 'progress') {
                return (
                  <ReportPanel
                    key={id}
                    endpoint="progress"
                    report={filteredProgress}
                    searching={searchActive}
                  />
                );
              }
              if (id === 'cards') {
                return (
                  <ReportPanel
                    key={id}
                    endpoint="cards"
                    report={filteredCards}
                    searching={searchActive}
                  />
                );
              }
              return <LearningPanel key={id} report={filteredLearning} searching={searchActive} />;
            })}
          </div>
        )
      )}
    </div>
  );
}
