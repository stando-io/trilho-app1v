import { Fragment } from 'react';
import type { KanbanCard, KanbanColumn, Member, Priority } from '../types';
import type { ViewPreferences } from '../viewPreferences';
import {
  avatarColor,
  columnColor,
  formatShortDate,
  initials,
  isOverdue,
  PRIORITY_LABELS,
  PRIORITY_ORDER,
} from './taskViewUtils';

interface ListGroup {
  key: string;
  title: string;
  cards: KanbanCard[];
}

function sortCards(cards: KanbanCard[], sort: ViewPreferences['lista']['sort']): KanbanCard[] {
  const list = [...cards];
  if (sort === 'criacao') {
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list;
  }
  if (sort === 'prioridade') {
    list.sort((a, b) => {
      const diff = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (diff !== 0) return diff;
      return b.created_at.localeCompare(a.created_at);
    });
    return list;
  }
  list.sort((a, b) => {
    if (!a.due_date && !b.due_date) return b.created_at.localeCompare(a.created_at);
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  return list;
}

function buildGroups(
  cards: KanbanCard[],
  columns: KanbanColumn[],
  members: Member[],
  prefs: ViewPreferences,
): ListGroup[] {
  const grouping = prefs.lista.grouping;
  if (grouping === 'status') {
    return columns.map((column) => ({
      key: column.id,
      title: column.name,
      cards: sortCards(
        cards.filter((card) => card.column_id === column.id),
        prefs.lista.sort,
      ),
    }));
  }
  if (grouping === 'prioridade') {
    return PRIORITY_ORDER.map((priority) => ({
      key: priority,
      title: PRIORITY_LABELS[priority as Priority],
      cards: sortCards(
        cards.filter((card) => card.priority === priority),
        prefs.lista.sort,
      ),
    })).filter((group) => group.cards.length > 0);
  }
  if (grouping === 'setor') {
    const names = new Set(cards.map((card) => card.sector_name || ''));
    const groups: ListGroup[] = [];
    if (cards.some((card) => !card.sector_name)) {
      groups.push({ key: 'none', title: 'Sem setor', cards: [] });
    }
    for (const name of names) {
      if (!name) continue;
      groups.push({ key: name, title: name, cards: [] });
    }
    for (const card of cards) {
      const key = card.sector_name || 'none';
      const group = groups.find((item) => item.key === key);
      if (group) group.cards.push(card);
    }
    groups.forEach((group) => {
      group.cards = sortCards(group.cards, prefs.lista.sort);
    });
    return groups.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  }
  const groups: ListGroup[] = members.map((member) => ({
    key: member.id,
    title: member.name,
    cards: [],
  }));
  groups.push({ key: 'none', title: 'Sem responsável', cards: [] });
  for (const card of cards) {
    const key = card.responsible_id ?? 'none';
    const group = groups.find((item) => item.key === key);
    if (group) group.cards.push(card);
  }
  const visible = groups.filter((group) => group.cards.length > 0);
  visible.forEach((group) => {
    group.cards = sortCards(group.cards, prefs.lista.sort);
  });
  return visible;
}

export default function TasksListView({
  cards,
  columns,
  members,
  prefs,
  onOpenCard,
  canOpen,
}: {
  cards: KanbanCard[];
  columns: KanbanColumn[];
  members: Member[];
  prefs: ViewPreferences;
  onOpenCard: (card: KanbanCard) => void;
  canOpen: boolean;
}) {
  const groups = buildGroups(cards, columns, members, prefs);
  const compact = prefs.lista.density === 'compacto';

  return (
    <div className={`tasks-list panel${compact ? ' tasks-list-compact' : ''}`}>
      {cards.length === 0 ? (
        <p className="muted small board-empty">Nenhuma tarefa corresponde aos filtros.</p>
      ) : (
        <table className="tasks-table">
          <thead>
            <tr>
              <th scope="col">Código</th>
              <th scope="col">Título</th>
              <th scope="col">Status</th>
              <th scope="col">Prioridade</th>
              <th scope="col">Responsável</th>
              <th scope="col">Limite</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                <tr className="tasks-group-row">
                  <th colSpan={6} scope="colgroup">
                    {group.title}
                    <span className="tasks-group-count">{group.cards.length}</span>
                  </th>
                </tr>
                {group.cards.map((card) => {
                  const columnIndex = columns.findIndex(
                    (column) => column.id === card.column_id,
                  );
                  const column = columns[columnIndex];
                  return (
                    <tr
                      key={card.id}
                      className={canOpen ? 'tasks-row tasks-row-open' : 'tasks-row'}
                      onClick={canOpen ? () => onOpenCard(card) : undefined}
                      tabIndex={canOpen ? 0 : undefined}
                      onKeyDown={
                        canOpen
                          ? (event) => {
                              if (event.key === 'Enter') onOpenCard(card);
                            }
                          : undefined
                      }
                    >
                      <td className="tasks-code">{card.task_code}</td>
                      <td className="tasks-title">
                        <span className={card.completed_at ? 'tasks-done' : undefined}>
                          {card.title}
                        </span>
                      </td>
                      <td>
                        <span className="tasks-status">
                          <span
                            className="board-col-dot"
                            style={{ background: columnColor(column, columnIndex) }}
                            aria-hidden="true"
                          />
                          {column?.name ?? '—'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge badge-${card.priority}`}>
                          {PRIORITY_LABELS[card.priority]}
                        </span>
                      </td>
                      <td>
                        {card.responsible_name ? (
                          <span className="tasks-responsible">
                            <span
                              className="card-avatar card-avatar-mini"
                              style={{ background: avatarColor(card.responsible_name) }}
                              aria-hidden="true"
                            >
                              {initials(card.responsible_name)}
                            </span>
                            {card.responsible_name}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {card.due_date ? (
                          <span className={isOverdue(card) ? 'card-due card-due-overdue' : 'card-due'}>
                            {formatShortDate(card.due_date)}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
