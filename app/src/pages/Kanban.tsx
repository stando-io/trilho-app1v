import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { can, useAuth } from '../auth';
import CardModal from '../components/CardModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import InlinePrompt from '../components/InlinePrompt';
import LoadingOverlay from '../components/LoadingOverlay';
import SecurityPrompt from '../components/SecurityPrompt';
import { useToast } from '../components/Toast';
import { useProjectId } from '../project';
import { useProjectEvents } from '../realtime';
import type {
  CardDraft,
  CardFilters,
  KanbanCard,
  KanbanColumn,
  Member,
  Priority,
  Sector,
} from '../types';
import { useSecurityGate } from '../useSecurityGate';
import {
  DEFAULT_VIEW_PREFERENCES,
  fetchViewPreferences,
  VIEW_MODES,
  viewBackgroundValue,
} from '../viewPreferences';
import type { ViewMode, ViewPreferences } from '../viewPreferences';
import {
  avatarColor,
  columnColor,
  dueLabel,
  initials,
  isFinalColumn,
  isOverdue,
  isToday,
  NO_RESPONSIBLE_COLOR,
  PRIORITY_GROUP_COLORS,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  resolveColumnColor,
} from '../views/taskViewUtils';
import TasksListView from '../views/TasksListView';
import TasksCalendarView from '../views/TasksCalendarView';
import TasksGanttView from '../views/TasksGanttView';
import type { GanttMilestone } from '../views/TasksGanttView';

interface BoardGroup {
  key: string;
  name: string;
  color: string;
  cards: KanbanCard[];
  columnId: string | null;
  isDone: boolean;
  locked: boolean;
  field: { type: 'priority'; value: Priority } | { type: 'responsible'; value: string | null } | null;
}

const EMPTY_FILTERS: CardFilters = {
  q: '',
  status: '',
  department_id: '',
  sector_id: '',
  responsible_id: '',
};

const SWATCH_COLORS = [
  '#5b4fe9',
  '#2563eb',
  '#0d9488',
  '#16a34a',
  '#f59e0b',
  '#e11d48',
  '#8b5cf6',
  '#64748b',
];

export default function Kanban() {
  const projectId = useProjectId();
  const location = useLocation();
  const navigate = useNavigate();

  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [cards, setCards] = useState<KanbanCard[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [filters, setFilters] = useState<CardFilters>(EMPTY_FILTERS);
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [sectorsLoaded, setSectorsLoaded] = useState(false);
  const [pendingNewCard, setPendingNewCard] = useState<{ department: string } | null>(() => {
    const params = new URLSearchParams(location.search);
    const department = params.get('nova_tarefa');
    if (params.has('novo') || department) return { department: department ?? '' };
    return null;
  });
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [pendingCardId, setPendingCardId] = useState<string | null>(() => {
    const params = new URLSearchParams(location.search);
    return params.get('card');
  });
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [draftError, setDraftError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [renamingColumn, setRenamingColumn] = useState<{ id: string; name: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ columnId: string; index: number } | null>(null);
  const [confirmingDone, setConfirmingDone] = useState<{
    cardId: string;
    columnId: string;
    index: number;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [assignMenu, setAssignMenu] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colcfgOpen, setColcfgOpen] = useState(false);
  const [colorFor, setColorFor] = useState<string | null>(null);
  const [viewPrefs, setViewPrefs] = useState<ViewPreferences>(DEFAULT_VIEW_PREFERENCES);
  const [viewMode, setViewMode] = useState<ViewMode | null>(null);
  const [milestones, setMilestones] = useState<GanttMilestone[]>([]);
  const suppressEventsUntil = useRef(0);
  const { user } = useAuth();

  const canCreateCard = can(user, 'kanban.criar_cards');
  const canEditCard = can(user, 'kanban.editar_cards');
  const canMoveCard = can(user, 'kanban.mover_cards');
  const canDeleteCard = can(user, 'kanban.excluir_cards');
  const canOpenCardModal = canEditCard || canDeleteCard;
  const toast = useToast();

  const gate = useSecurityGate(toast.error);

  const loadBoard = useCallback(async () => {
    if (!projectId) {
      setColumns([]);
      setCards([]);
      setLoaded(true);
      return;
    }
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    if (filters.department_id) params.set('department_id', filters.department_id);
    if (filters.sector_id) params.set('sector_id', filters.sector_id);
    if (filters.responsible_id) params.set('responsible_id', filters.responsible_id);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    try {
      const [columnRows, cardRows] = await Promise.all([
        api<KanbanColumn[]>(`/projects/${projectId}/columns`),
        api<KanbanCard[]>(`/projects/${projectId}/cards${suffix}`),
      ]);
      setColumns(columnRows);
      setCards(cardRows);
      setLoaded(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar o quadro');
      setLoaded(true);
    }
  }, [projectId, filters]);

  useEffect(() => {
    setLoaded(false);
    void loadBoard();
  }, [loadBoard]);

  const handleEvent = useCallback(
    (event: { type: string }) => {
      if (event.type === 'cards_changed' || event.type === 'columns_changed') {
        if (Date.now() < suppressEventsUntil.current) return;
        void loadBoard();
        setRefreshSignal((signal) => signal + 1);
        return;
      }
      if (event.type === 'structure_changed') {
        if (!projectId) return;
        void api<Sector[]>(`/projects/${projectId}/sectors`)
          .then(setSectors)
          .catch(() => undefined);
        void api<Member[]>(`/projects/${projectId}/members`)
          .then(setMembers)
          .catch(() => undefined);
      }
    },
    [loadBoard, projectId],
  );
  useProjectEvents(projectId, handleEvent);

  useEffect(() => {
    void fetchViewPreferences()
      .then((prefs) => {
        setViewPrefs(prefs);
        setViewMode(prefs.mode);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!projectId) {
      setSectorsLoaded(true);
      return;
    }
    void api<Sector[]>(`/projects/${projectId}/sectors`)
      .then((rows) => {
        setSectors(rows);
        setSectorsLoaded(true);
      })
      .catch(() => setSectorsLoaded(true));
    void api<Member[]>(`/projects/${projectId}/members`)
      .then(setMembers)
      .catch(() => undefined);
    void api<GanttMilestone[]>(`/projects/${projectId}/milestones`)
      .then(setMilestones)
      .catch(() => undefined);
  }, [projectId]);

  function structural(task: () => Promise<unknown>) {
    return gate.guarded(async () => {
      suppressEventsUntil.current = Date.now() + 1500;
      await task();
      await loadBoard();
    });
  }

  async function moveCard(cardId: string, columnId: string, position: number) {
    const card = cards.find((item) => item.id === cardId);
    const target = columns.find((item) => item.id === columnId);
    const body: { column_id: string; position: number; responsible_id?: string } = {
      column_id: columnId,
      position,
    };
    if (user && card && !card.responsible_id && target?.name === 'Em Andamento') {
      body.responsible_id = user.id;
    }
    suppressEventsUntil.current = Date.now() + 1500;
    try {
      await api(`/projects/${projectId}/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      await loadBoard();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao mover o card');
      await loadBoard();
    }
  }

  async function toggleAssumir(card: KanbanCard) {
    if (!user) return;
    setAssignMenu(null);
    suppressEventsUntil.current = Date.now() + 1500;
    try {
      await api(`/projects/${projectId}/cards/${card.id}/assumir`, { method: 'POST' });
      await loadBoard();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao assumir a tarefa');
      await loadBoard();
    }
  }

  function isCardDrag(event: DragEvent<HTMLElement>): boolean {
    return Array.from(event.dataTransfer.types).includes('text/plain');
  }

  function handleDragStart(event: DragEvent<HTMLElement>, cardId: string) {
    event.dataTransfer.setData('text/plain', cardId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(cardId);
    setDropHint(null);
  }

  const boardGroups = useMemo<BoardGroup[]>(() => {
    const grouping = viewPrefs.kanban.grouping;
    if (grouping === 'status') {
      return columns.map((column, index) => ({
        key: column.id,
        name: column.name,
        color: resolveColumnColor(columnColor(column, index), viewPrefs),
        cards: cards.filter((card) => card.column_id === column.id),
        columnId: column.id,
        isDone: column.is_done,
        locked: column.locked,
        field: null,
      }));
    }
    if (grouping === 'prioridade') {
      return PRIORITY_ORDER.map((priority) => ({
        key: `prio:${priority}`,
        name: PRIORITY_LABELS[priority],
        color: resolveColumnColor(PRIORITY_GROUP_COLORS[priority], viewPrefs),
        cards: cards.filter((card) => card.priority === priority),
        columnId: null,
        isDone: false,
        locked: false,
        field: { type: 'priority' as const, value: priority },
      }));
    }
    const groups: BoardGroup[] = members.map((member) => ({
      key: `resp:${member.id}`,
      name: member.name,
      color: resolveColumnColor(avatarColor(member.name), viewPrefs),
      cards: cards.filter((card) => card.responsible_id === member.id),
      columnId: null,
      isDone: false,
      locked: false,
      field: { type: 'responsible' as const, value: member.id },
    }));
    groups.push({
      key: 'resp:none',
      name: 'Sem responsável',
      color: resolveColumnColor(NO_RESPONSIBLE_COLOR, viewPrefs),
      cards: cards.filter((card) => !card.responsible_id),
      columnId: null,
      isDone: false,
      locked: false,
      field: { type: 'responsible' as const, value: null },
    });
    return groups;
  }, [viewPrefs, columns, cards, members]);

  async function applyGroupField(cardId: string, group: BoardGroup) {
    if (!group.field || !projectId) return;
    const card = cards.find((item) => item.id === cardId);
    if (!card) return;
    if (group.field.type === 'priority') {
      if (card.priority === group.field.value) return;
      suppressEventsUntil.current = Date.now() + 1500;
      try {
        await api(`/projects/${projectId}/cards/${cardId}`, {
          method: 'PATCH',
          body: JSON.stringify({ priority: group.field.value }),
        });
        toast.success('Prioridade atualizada.');
        await loadBoard();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Erro ao atualizar a prioridade');
        await loadBoard();
      }
      return;
    }
    if ((card.responsible_id ?? null) === group.field.value) return;
    suppressEventsUntil.current = Date.now() + 1500;
    try {
      await api(`/projects/${projectId}/cards/${cardId}`, {
        method: 'PATCH',
        body: JSON.stringify({ responsible_id: group.field.value }),
      });
      toast.success('Responsável atualizado.');
      await loadBoard();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao atualizar o responsável');
      await loadBoard();
    }
  }

  function handleGroupDragOver(event: DragEvent<HTMLElement>, group: BoardGroup) {
    if (!isCardDrag(event)) return;
    event.preventDefault();
    const index = group.cards.length;
    setDropHint((prev) =>
      prev && prev.columnId === group.key && prev.index === index
        ? prev
        : { columnId: group.key, index },
    );
  }

  function handleGroupCardDragOver(
    event: DragEvent<HTMLElement>,
    group: BoardGroup,
    index: number,
  ) {
    if (!isCardDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const next = after ? index + 1 : index;
    setDropHint((prev) =>
      prev && prev.columnId === group.key && prev.index === next
        ? prev
        : { columnId: group.key, index: next },
    );
  }

  function handleGroupDragLeave(event: DragEvent<HTMLElement>, groupKey: string) {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setDropHint((hint) => (hint?.columnId === groupKey ? null : hint));
  }

  function requestMove(cardId: string, columnId: string, position: number) {
    const targetColumn = columns.find((column) => column.id === columnId);
    const currentColumn = cards.find((card) => card.id === cardId)?.column_id;
    if (targetColumn && isFinalColumn(targetColumn) && currentColumn !== columnId) {
      setConfirmingDone({ cardId, columnId, index: position });
      return;
    }
    void moveCard(cardId, columnId, position);
  }

  function handleGroupDrop(event: DragEvent<HTMLElement>, group: BoardGroup) {
    event.preventDefault();
    const cardId = event.dataTransfer.getData('text/plain');
    setDraggingId(null);
    if (!cardId) {
      setDropHint(null);
      return;
    }
    const hinted = dropHint?.columnId === group.key ? dropHint.index : group.cards.length;
    setDropHint(null);
    if (!group.columnId) {
      void applyGroupField(cardId, group);
      return;
    }
    const others = cards.filter(
      (card) => card.column_id === group.columnId && card.id !== cardId,
    );
    void requestMove(cardId, group.columnId, Math.min(hinted, others.length));
  }

  function handleGroupCardDrop(
    event: DragEvent<HTMLElement>,
    group: BoardGroup,
    target: KanbanCard,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const cardId = event.dataTransfer.getData('text/plain');
    setDraggingId(null);
    if (!cardId || cardId === target.id) {
      setDropHint(null);
      return;
    }
    const hasHint = dropHint?.columnId === group.key;
    const hintIndex = dropHint?.index;
    setDropHint(null);
    if (!group.columnId) {
      void applyGroupField(cardId, group);
      return;
    }
    const others = cards.filter(
      (card) => card.column_id === group.columnId && card.id !== cardId,
    );
    let index: number;
    if (hasHint && hintIndex !== undefined) {
      index = hintIndex;
      const full = cards.filter((card) => card.column_id === group.columnId);
      const movedIndex = full.findIndex((card) => card.id === cardId);
      if (movedIndex !== -1 && movedIndex < index) index -= 1;
      index = Math.min(Math.max(index, 0), others.length);
    } else {
      const targetIndex = others.findIndex((card) => card.id === target.id);
      index = targetIndex === -1 ? others.length : targetIndex;
    }
    requestMove(cardId, group.columnId, index);
  }

  function openNewCard(columnId: string | null, departmentId = '') {
    setDraftError('');
    setDraft({
      id: null,
      task_code: '',
      title: '',
      description: '',
      priority: 'media',
      department_id: departmentId,
      responsible_id: '',
      due_date: '',
      origin: '',
      column_id: columnId ?? columns[0]?.id ?? '',
      learning_index_active: false,
      learning_index_score: null,
      learning_index_note: '',
    });
  }

  useEffect(() => {
    if (!loaded || !sectorsLoaded || !pendingNewCard) return;
    openNewCard(null, pendingNewCard.department);
    setPendingNewCard(null);
    const params = new URLSearchParams(location.search);
    params.delete('nova_tarefa');
    params.delete('novo');
    const remaining = params.toString();
    navigate(`${location.pathname}${remaining ? `?${remaining}` : ''}`, { replace: true });
  }, [loaded, sectorsLoaded, pendingNewCard, location, navigate]);

  useEffect(() => {
    if (!loaded || !pendingCardId || !canOpenCardModal) {
      if (pendingCardId && !canOpenCardModal) setPendingCardId(null);
      return;
    }
    const card = cards.find((row) => row.id === pendingCardId);
    if (!card) {
      setPendingCardId(null);
      return;
    }
    openEditCard(card);
    setPendingCardId(null);
    const params = new URLSearchParams(location.search);
    params.delete('card');
    const remaining = params.toString();
    navigate(`${location.pathname}${remaining ? `?${remaining}` : ''}`, { replace: true });
  }, [loaded, pendingCardId, cards, canOpenCardModal, location, navigate]);

  function openEditCard(card: KanbanCard) {
    setDraftError('');
    setDraft({
      id: card.id,
      task_code: card.task_code,
      title: card.title,
      description: card.description,
      priority: card.priority,
      department_id: card.department_id ?? '',
      responsible_id: card.responsible_id ?? '',
      due_date: card.due_date ?? '',
      origin: card.origin,
      column_id: card.column_id,
      learning_index_active: card.learning_index_active,
      learning_index_score: card.learning_index_score,
      learning_index_note: card.learning_index_note,
    });
  }

  function handleNavigateCard(cardId: string) {
    const card = cards.find((row) => row.id === cardId);
    if (card) {
      openEditCard(card);
      return;
    }
    setPendingCardId(cardId);
  }

  async function saveCard(event: FormEvent) {
    event.preventDefault();
    if (!draft || !projectId) return;
    setBusy(true);
    setDraftError('');
    suppressEventsUntil.current = Date.now() + 1500;
    const body = {
      title: draft.title.trim(),
      description: draft.description,
      priority: draft.priority,
      department_id: draft.department_id || null,
      responsible_id: draft.responsible_id || null,
      due_date: draft.due_date || null,
      origin: draft.origin,
      learning_index_active: draft.learning_index_active,
      learning_index_score: draft.learning_index_score,
      learning_index_note: draft.learning_index_note,
    };
    try {
      if (draft.id) {
        await api(`/projects/${projectId}/cards/${draft.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, column_id: draft.column_id }),
        });
        setDraft(null);
      } else {
        const created = await api<{ id: string; task_code: string; column_id: string }>(
          `/projects/${projectId}/cards`,
          { method: 'POST', body: JSON.stringify({ ...body, column_id: draft.column_id }) },
        );
        setDraft({
          ...draft,
          id: created.id,
          task_code: created.task_code,
          column_id: created.column_id,
        });
      }
      await loadBoard();
    } catch (err) {
      setDraftError(err instanceof ApiError ? err.message : 'Erro ao salvar o card');
    } finally {
      setBusy(false);
    }
  }

  async function deleteFromModal() {
    if (!draft?.id) return;
    if (!window.confirm(`Excluir o card "${draft.title}"?`)) return;
    const result = await structural(() =>
      api(`/projects/${projectId}/cards/${draft.id}`, { method: 'DELETE' }),
    );
    if (result.ok) setDraft(null);
  }

  async function createColumn(event: FormEvent) {
    event.preventDefault();
    const name = newColumnName.trim();
    if (!name) return;
    const result = await structural(() =>
      api(`/projects/${projectId}/columns`, {
        method: 'POST',
        body: JSON.stringify({ name, is_done: false }),
      }),
    );
    if (result.ok) setNewColumnName('');
  }

  async function renameColumn(columnId: string, name: string) {
    const result = await structural(() =>
      api(`/projects/${projectId}/columns/${columnId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
    );
    if (result.ok) setRenamingColumn(null);
  }

  async function moveColumn(column: KanbanColumn, direction: 'left' | 'right') {
    const index = columns.findIndex((item) => item.id === column.id);
    const target = direction === 'left' ? index - 1 : index + 1;
    if (target < 0 || target >= columns.length) return;
    await structural(() =>
      api(`/projects/${projectId}/columns/${column.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ position: target }),
      }),
    );
  }

  async function deleteColumn(column: KanbanColumn) {
    if (!window.confirm(`Excluir a coluna "${column.name}"?`)) return;
    await structural(() => api(`/projects/${projectId}/columns/${column.id}`, { method: 'DELETE' }));
  }

  async function setColumnColor(column: KanbanColumn, color: string | null) {
    setMenuOpen(null);
    setColorFor(null);
    await structural(() =>
      api(`/projects/${projectId}/columns/${column.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ color }),
      }),
    );
  }

  async function clearColumnCards(column: KanbanColumn) {
    setMenuOpen(null);
    if (!window.confirm(`Limpar todas as tarefas da coluna "${column.name}"?`)) return;
    await structural(() =>
      api(`/projects/${projectId}/columns/${column.id}/cards`, { method: 'DELETE' }),
    );
  }

  const activeFilterCount = [
    filters.q,
    filters.status,
    filters.sector_id,
    filters.department_id,
    filters.responsible_id,
  ].filter(Boolean).length;

  function clearFilters() {
    setQuery('');
    setFilters(EMPTY_FILTERS);
  }

  const departmentOptions = filters.sector_id
    ? sectors.filter((sector) => sector.id === filters.sector_id)
    : sectors;

  const activeMode: ViewMode = viewMode ?? viewPrefs.mode;

  const modalIndex = draft?.id ? cards.findIndex((card) => card.id === draft.id) : -1;

  if (!projectId) {
    return (
      <div>
        <h1>Quadro</h1>
        <div className="panel">
          <h2>Nenhum projeto selecionado</h2>
          <p>Selecione ou crie um projeto para usar o quadro.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="page-board"
      style={{ backgroundColor: viewBackgroundValue(viewPrefs.kanban.background) }}
    >
      <div className="panel kanban-toolbar">
        <div className="kanban-toolbar-main">
          <form
            className="kanban-search"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters((f) => ({ ...f, q: query }));
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
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar card..."
              aria-label="Buscar card"
            />
          </form>
          <button
            type="button"
            className={`btn btn-plain kanban-filterbtn${filtersOpen ? ' is-open' : ''}`}
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
            {activeFilterCount > 0 && (
              <span className="filter-count">({activeFilterCount})</span>
            )}
          </button>
          {activeMode === 'kanban' && (
            <button
              type="button"
              className={`btn btn-plain kanban-colcfg${colcfgOpen ? ' is-open' : ''}`}
              aria-expanded={colcfgOpen}
              aria-label="Personalizar colunas"
              onClick={() => {
                setColcfgOpen((open) => !open);
                setNewColumnName('');
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
                <path d="M1 14h6M9 8h6M17 16h6" />
              </svg>
              Colunas
            </button>
          )}
          {activeMode === 'kanban' && colcfgOpen && (
            <>
              <button
                type="button"
                className="col-menu-scrim"
                aria-label="Fechar personalização de colunas"
                onClick={() => setColcfgOpen(false)}
              />
              <div className="colcfg-pop" role="menu">
                <p className="colcfg-title">Colunas</p>
                {columns.map((column, index) => (
                  <div className="colcfg-row" key={column.id}>
                    <span
                      className="board-col-dot"
                      style={{ background: columnColor(column, index) }}
                      aria-hidden="true"
                    />
                    <span className="colcfg-name">{column.name}</span>
                    <button
                      type="button"
                      className="colcfg-btn"
                      aria-label={`Mover coluna ${column.name} para cima`}
                      disabled={index === 0}
                      onClick={() => void moveColumn(column, 'left')}
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
                      aria-label={`Mover coluna ${column.name} para baixo`}
                      disabled={index === columns.length - 1}
                      onClick={() => void moveColumn(column, 'right')}
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
                    {!column.locked && (
                      <button
                        type="button"
                        className="colcfg-btn colcfg-danger"
                        aria-label={`Excluir coluna ${column.name}`}
                        onClick={() => {
                          setColcfgOpen(false);
                          void deleteColumn(column);
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <form
                  className="colcfg-create"
                  onSubmit={(event) => void createColumn(event)}
                >
                  <input
                    value={newColumnName}
                    onChange={(event) => setNewColumnName(event.target.value)}
                    placeholder="Nova coluna"
                    aria-label="Nome da nova coluna"
                  />
                  <button
                    type="submit"
                    className="btn"
                    disabled={newColumnName.trim().length === 0}
                  >
                    Criar
                  </button>
                </form>
              </div>
            </>
          )}
          <span className="toolbar-spacer" />
          <div className="view-switcher" role="tablist" aria-label="Modo de visualização">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={activeMode === mode.id}
                className={`view-switch-btn${activeMode === mode.id ? ' is-active' : ''}`}
                title={mode.hint}
                onClick={() => setViewMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {canCreateCard && (
            <button type="button" className="btn kanban-newcard" onClick={() => openNewCard(null)}>
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Novo Card
            </button>
          )}
        </div>
        {filtersOpen && (
          <form
            className="filters kanban-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters((f) => ({ ...f, q: query }));
            }}
          >
            <select
              aria-label="Situação"
              value={filters.status}
              onChange={(event) =>
                setFilters((f) => ({ ...f, status: event.target.value as CardFilters['status'] }))
              }
            >
              <option value="">Todas as situações</option>
              <option value="pending">Pendentes</option>
              <option value="done">Concluídos</option>
            </select>
            <select
              aria-label="Setor"
              value={filters.sector_id}
              onChange={(event) =>
                setFilters((f) => ({ ...f, sector_id: event.target.value, department_id: '' }))
              }
            >
              <option value="">Todos setores</option>
              {sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Departamento"
              value={filters.department_id}
              onChange={(event) => setFilters((f) => ({ ...f, department_id: event.target.value }))}
            >
              <option value="">Todos departamentos</option>
              {departmentOptions.map((sector) => (
                <optgroup key={sector.id} label={sector.name}>
                  {sector.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              aria-label="Responsável"
              value={filters.responsible_id}
              onChange={(event) =>
                setFilters((f) => ({ ...f, responsible_id: event.target.value }))
              }
            >
              <option value="">Todos responsáveis</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-plain"
              onClick={() => {
                clearFilters();
              }}
            >
              Limpar
            </button>
          </form>
        )}
      </div>

      {canCreateCard && (
        <button
          type="button"
          className="kanban-fab"
          aria-label="Novo card"
          onClick={() => openNewCard(null)}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}

      {!loaded ? (
        <div className="panel">
          <LoadingOverlay />
        </div>
      ) : activeMode === 'lista' ? (
        <TasksListView
          cards={cards}
          columns={columns}
          members={members}
          prefs={viewPrefs}
          onOpenCard={openEditCard}
          canOpen={canOpenCardModal}
        />
      ) : activeMode === 'calendario' ? (
        <TasksCalendarView
          cards={cards}
          columns={columns}
          prefs={viewPrefs}
          onOpenCard={openEditCard}
          canOpen={canOpenCardModal}
        />
      ) : activeMode === 'gantt' ? (
        <TasksGanttView
          cards={cards}
          columns={columns}
          prefs={viewPrefs}
          milestones={milestones}
        />
      ) : (
        <div
          className={`board${
            viewPrefs.kanban.density === 'compacto' ? ' board-compact' : ''
          }`}
        >
          {boardGroups.map((group) => {
            const column = group.columnId
              ? columns.find((item) => item.id === group.columnId)
              : undefined;
            const columnCards = group.cards;
            const hint =
              dropHint?.columnId === group.key && draggingId ? dropHint.index : null;
            return (
              <section
                key={group.key}
                className={`board-col${group.isDone ? ' board-col-done' : ''}${
                  draggingId && hint !== null ? ' board-col-drop' : ''
                }`}
                style={{ ['--col-color' as string]: group.color }}
                onDragOver={(event) => handleGroupDragOver(event, group)}
                onDragLeave={(event) => handleGroupDragLeave(event, group.key)}
                onDrop={(event) => handleGroupDrop(event, group)}
              >
                <header className="board-col-head">
                  {column && renamingColumn?.id === column.id ? (
                    <InlinePrompt
                      initialValue={renamingColumn.name}
                      label="Novo nome da coluna"
                      onSubmit={(value) => void renameColumn(column.id, value)}
                      onCancel={() => setRenamingColumn(null)}
                    />
                  ) : (
                    <div className="board-col-top">
                      <span className="board-col-title">{group.name}</span>
                      <span className="board-col-count">{columnCards.length}</span>
                      {canCreateCard && column && (
                        <button
                          type="button"
                          className="board-col-add"
                          aria-label={`Adicionar card em ${column.name}`}
                          title="+ Adicionar"
                          onClick={() => openNewCard(column.id)}
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      )}
                      {column && (
                        <button
                          type="button"
                          className="board-col-menu"
                          aria-label={`Opções da coluna ${column.name}`}
                          aria-expanded={menuOpen === column.id}
                          onClick={() => {
                            setColorFor(null);
                            setMenuOpen(menuOpen === column.id ? null : column.id);
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            aria-hidden="true"
                          >
                            <circle cx="3" cy="8" r="1.5" fill="currentColor" />
                            <circle cx="8" cy="8" r="1.5" fill="currentColor" />
                            <circle cx="13" cy="8" r="1.5" fill="currentColor" />
                          </svg>
                        </button>
                      )}
                      {column && menuOpen === column.id && (
                        <>
                          <button
                            type="button"
                            className="col-menu-scrim"
                            aria-label="Fechar menu da coluna"
                            onClick={() => {
                              setMenuOpen(null);
                              setColorFor(null);
                            }}
                          />
                          <div className="col-menu-pop" role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="col-menu-item"
                              onClick={() => {
                                setMenuOpen(null);
                                setColorFor(null);
                                setRenamingColumn({ id: column.id, name: column.name });
                              }}
                            >
                              Renomear coluna
                            </button>
                            {viewPrefs.kanban.column_colors === 'status' && (
                              <>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="col-menu-item"
                                  aria-expanded={colorFor === column.id}
                                  onClick={() =>
                                    setColorFor(colorFor === column.id ? null : column.id)
                                  }
                                >
                                  Mudar cor
                                </button>
                                {colorFor === column.id && (
                                  <div className="col-colors">
                                    {SWATCH_COLORS.map((color) => (
                                      <button
                                        key={color}
                                        type="button"
                                        className={`col-swatch${
                                          column.color === color ? ' is-active' : ''
                                        }`}
                                        style={{ background: color }}
                                        aria-label={`Cor ${color}`}
                                        onClick={() => void setColumnColor(column, color)}
                                      />
                                    ))}
                                    <button
                                      type="button"
                                      className="col-swatch-reset"
                                      onClick={() => void setColumnColor(column, null)}
                                    >
                                      Padrão
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                            {canDeleteCard && (
                              <button
                                type="button"
                                role="menuitem"
                                className="col-menu-item"
                                onClick={() => void clearColumnCards(column)}
                              >
                                Limpar tarefas
                              </button>
                            )}
                            {!column.locked && (
                              <button
                                type="button"
                                role="menuitem"
                                className="col-menu-item col-menu-danger"
                                onClick={() => {
                                  setMenuOpen(null);
                                  setColorFor(null);
                                  void deleteColumn(column);
                                }}
                              >
                                Excluir
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </header>

                {columnCards.length === 0 && hint === null ? (
                  <div className="board-empty-box">
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="7" height="18" rx="1.5" />
                      <rect x="14" y="3" width="7" height="11" rx="1.5" />
                    </svg>
                    <span>Nenhuma tarefa aqui</span>
                  </div>
                ) : (
                  <ul className="board-cards">
                    {columnCards.map((card, cardIndex) => (
                      <Fragment key={card.id}>
                        {hint === cardIndex && (
                          <li className="card-placeholder" aria-hidden="true" />
                        )}
                        <li>
                          <article
                            className={`card-item${card.completed_at ? ' card-done' : ''}${
                              isOverdue(card) ? ' card-overdue' : ''
                            }${draggingId === card.id ? ' card-dragging' : ''}`}
                            draggable={canMoveCard}
                            role="button"
                            tabIndex={0}
                            onDragStart={(event) => handleDragStart(event, card.id)}
                            onDragEnd={() => {
                              setDraggingId(null);
                              setDropHint(null);
                            }}
                            onDragOver={(event) =>
                              handleGroupCardDragOver(event, group, cardIndex)
                            }
                            onDrop={(event) => handleGroupCardDrop(event, group, card)}
                            onClick={canOpenCardModal ? () => openEditCard(card) : undefined}
                            onKeyDown={
                              canOpenCardModal
                                ? (event) => {
                                    if (event.key === 'Enter') openEditCard(card);
                                  }
                                : undefined
                            }
                          >
                            <div className="card-top">
                              <span className={`badge badge-${card.priority}`}>
                                {PRIORITY_LABELS[card.priority]}
                              </span>
                              <span className="card-code">{card.task_code}</span>
                              {card.sector_name && (
                                <span className="card-sector-tag">{card.sector_name}</span>
                              )}
                              {card.completed_at && (
                                <span className="card-check" aria-hidden="true">
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                </span>
                              )}
                            </div>
                            <div className="card-title">{card.title}</div>
                            <div className="card-meta">
                              {card.due_date && (
                                <span
                                  className={`card-meta-item card-due${
                                    isOverdue(card) ? ' card-due-overdue' : ''
                                  }${isToday(card.due_date) && !card.completed_at ? ' card-meta-today' : ''}`}
                                >
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                    <line x1="16" y1="2" x2="16" y2="6" />
                                    <line x1="8" y1="2" x2="8" y2="6" />
                                    <line x1="3" y1="10" x2="21" y2="10" />
                                  </svg>
                                  {dueLabel(card.due_date)}
                                </span>
                              )}
                              <span className="card-meta-item" title="Comentários">
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                </svg>
                                {card.comments_count}
                              </span>
                              <span className="card-meta-item" title="Anexos">
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                </svg>
                                {card.attachments_count}
                              </span>
                              {card.subtasks_total > 0 && (
                                <span className="card-meta-item" title="Sub-tarefas">
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <polyline points="9 11 12 14 22 4" />
                                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                                  </svg>
                                  {card.subtasks_done}/{card.subtasks_total}
                                </span>
                              )}
                            </div>
                            <div className="card-foot">
                              <span className="card-foot-left">
                                {card.responsibles.length > 0 && (
                                  <span
                                    className="avatar-stack"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setAssignMenu(assignMenu === card.id ? null : card.id);
                                    }}
                                    role="button"
                                    tabIndex={0}
                                    aria-haspopup="menu"
                                    aria-expanded={assignMenu === card.id}
                                    aria-label={`Responsáveis: ${card.responsibles.map((r) => r.name).join(', ')}`}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.stopPropagation();
                                        setAssignMenu(assignMenu === card.id ? null : card.id);
                                      }
                                    }}
                                  >
                                    {card.responsibles.slice(0, 3).map((resp) => (
                                      <span
                                        key={resp.id}
                                        className="avatar-stack-item"
                                        style={{ background: avatarColor(resp.name) }}
                                        title={resp.name}
                                      >
                                        {initials(resp.name)}
                                      </span>
                                    ))}
                                    {card.responsibles.length > 3 && (
                                      <span className="avatar-stack-item avatar-stack-more">
                                        +{card.responsibles.length - 3}
                                      </span>
                                    )}
                                  </span>
                                )}
                              </span>
                              <span className="card-foot-right">
                                {user && (
                                  <button
                                    type="button"
                                    className={`btn-assumir${
                                      card.responsibles.some((r) => r.id === user.id)
                                        ? ' btn-assumir-active'
                                        : ''
                                    }`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void toggleAssumir(card);
                                    }}
                                  >
                                    {card.responsibles.some((r) => r.id === user.id)
                                      ? '✓ Assumido'
                                      : 'Assumir'}
                                  </button>
                                )}
                                {assignMenu === card.id && (
                                  <>
                                    <button
                                      type="button"
                                      className="card-scrim"
                                      aria-label="Fechar menu de responsável"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setAssignMenu(null);
                                      }}
                                    />
                                    <div className="card-avatar-pop" role="menu">
                                      {members.map((member) => {
                                        const isOn = card.responsibles.some((r) => r.id === member.id);
                                        return (
                                          <button
                                            key={member.id}
                                            type="button"
                                            role="menuitem"
                                            className={`card-avatar-item${isOn ? ' card-avatar-item-on' : ''}`}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              const nextIds = isOn
                                                ? card.responsibles.filter((r) => r.id !== member.id).map((r) => r.id)
                                                : [...card.responsibles.map((r) => r.id), member.id];
                                              setAssignMenu(null);
                                              suppressEventsUntil.current = Date.now() + 1500;
                                              void api(`/projects/${projectId}/cards/${card.id}`, {
                                                method: 'PATCH',
                                                body: JSON.stringify({ responsible_ids: nextIds }),
                                              })
                                                .then(() => loadBoard())
                                                .catch(() => loadBoard());
                                            }}
                                          >
                                            <span
                                              className="card-avatar card-avatar-mini"
                                              style={{ background: avatarColor(member.name) }}
                                              aria-hidden="true"
                                            >
                                              {initials(member.name)}
                                            </span>
                                            <span className="card-avatar-item-text">
                                              <span>{member.name}</span>
                                            </span>
                                            {isOn && (
                                              <span className="card-avatar-item-check" aria-hidden="true">
                                                ✓
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </>
                                )}
                              </span>
                            </div>
                          </article>
                        </li>
                      </Fragment>
                    ))}
                    {hint !== null && hint === columnCards.length && (
                      <li className="card-placeholder" aria-hidden="true" />
                    )}
                  </ul>
                )}

              </section>
            );
          })}
        </div>
      )}

      {draft && (
        <CardModal
          draft={draft}
          setDraft={setDraft}
          columns={columns}
          sectors={sectors}
          members={members}
          projectId={projectId}
          canCreateCard={canCreateCard}
          canEditCard={canEditCard}
          canDeleteCard={canDeleteCard}
          busy={busy}
          error={draftError}
          onSave={(event) => void saveCard(event)}
          onDelete={() => void deleteFromModal()}
          onAttachmentsChanged={() => void loadBoard()}
          onNavigateCard={canOpenCardModal ? handleNavigateCard : undefined}
          refreshSignal={refreshSignal}
          onPrev={
            modalIndex > 0 && cards[modalIndex - 1]
              ? () => openEditCard(cards[modalIndex - 1])
              : null
          }
          onNext={
            modalIndex >= 0 && modalIndex < cards.length - 1 && cards[modalIndex + 1]
              ? () => openEditCard(cards[modalIndex + 1])
              : null
          }
        />
      )}

      <ConfirmDialog
        open={confirmingDone !== null}
        title="Concluir Tarefa"
        message="Tem certeza de que deseja marcar esta tarefa como concluída?"
        confirmLabel="Confirmar Conclusão"
        confirmVariant="warning"
        onConfirm={() => {
          const pending = confirmingDone;
          setConfirmingDone(null);
          if (pending) void moveCard(pending.cardId, pending.columnId, pending.index);
        }}
        onCancel={() => setConfirmingDone(null)}
      />

      <SecurityPrompt gate={gate} />
    </div>
  );
}
