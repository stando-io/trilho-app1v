import { useState } from 'react';
import type { KanbanCard, KanbanColumn } from '../types';
import type { ViewPreferences } from '../viewPreferences';
import { cardGroupColor, formatShortDate, isOverdue } from './taskViewUtils';

const MONTH_NAMES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const WEEKDAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function isoOf(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

function cellLabel(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export default function TasksCalendarView({
  cards,
  columns,
  prefs,
  onOpenCard,
  canOpen,
}: {
  cards: KanbanCard[];
  columns: KanbanColumn[];
  prefs: ViewPreferences;
  onOpenCard: (card: KanbanCard) => void;
  canOpen: boolean;
}) {
  const todayIso = isoOf(new Date());
  const [cursor, setCursor] = useState(() => new Date());
  const view = prefs.calendario.view;
  const showUndated = prefs.calendario.show_undated;

  const byDate = new Map<string, KanbanCard[]>();
  for (const card of cards) {
    if (!card.due_date) continue;
    const list = byDate.get(card.due_date);
    if (list) list.push(card);
    else byDate.set(card.due_date, [card]);
  }

  const undated = showUndated ? cards.filter((card) => !card.due_date) : [];

  let label: string;
  let days: { date: Date; iso: string; outside: boolean }[] = [];

  if (view === 'dia') {
    label = formatShortDate(isoOf(cursor));
    days = [{ date: cursor, iso: isoOf(cursor), outside: false }];
  } else if (view === 'semana') {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    days = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return { date, iso: isoOf(date), outside: false };
    });
    label = `${cellLabel(start)} – ${cellLabel(end)}`;
  } else {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = startOfWeek(monthStart);
    days = Array.from({ length: 42 }, (_, index) => {
      const date = addDays(gridStart, index);
      return {
        date,
        iso: isoOf(date),
        outside: date.getMonth() !== cursor.getMonth(),
      };
    });
    label = `${MONTH_NAMES[cursor.getMonth()]} de ${cursor.getFullYear()}`;
  }

  function goPrevious() {
    if (view === 'dia') setCursor((date) => addDays(date, -1));
    else if (view === 'semana') setCursor((date) => addDays(date, -7));
    else setCursor((date) => new Date(date.getFullYear(), date.getMonth() - 1, 1));
  }

  function goNext() {
    if (view === 'dia') setCursor((date) => addDays(date, 1));
    else if (view === 'semana') setCursor((date) => addDays(date, 7));
    else setCursor((date) => new Date(date.getFullYear(), date.getMonth() + 1, 1));
  }

  function renderChip(card: KanbanCard) {
    return (
      <button
        key={card.id}
        type="button"
        className={`cal-chip${isOverdue(card) ? ' cal-chip-overdue' : ''}`}
        style={{ borderLeftColor: cardGroupColor(card, columns, prefs, 'calendario') }}
        disabled={!canOpen}
        onClick={() => onOpenCard(card)}
        title={`${card.task_code} — ${card.title}`}
      >
        <span className="cal-chip-code">{card.task_code}</span>
        <span className="cal-chip-title">{card.title}</span>
      </button>
    );
  }

  return (
    <div className="tasks-calendar panel">
      <div className="cal-head">
        <div className="cal-nav">
          <button type="button" className="cal-navbtn" aria-label="Período anterior" onClick={goPrevious}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button type="button" className="btn btn-plain" onClick={() => setCursor(new Date())}>
            Hoje
          </button>
          <button type="button" className="cal-navbtn" aria-label="Próximo período" onClick={goNext}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <h2 className="cal-label">{label}</h2>
        <span className="cal-spacer" />
      </div>

      {view !== 'dia' && (
        <div className="cal-grid cal-weekdays">
          {WEEKDAY_LABELS.map((weekday) => (
            <span key={weekday} className="cal-weekday">
              {weekday}
            </span>
          ))}
        </div>
      )}

      <div className={`cal-grid${view === 'dia' ? ' cal-grid-single' : ''}`}>
        {days.map((day) => {
          const dayCards = byDate.get(day.iso) ?? [];
          const isToday = day.iso === todayIso;
          return (
            <div
              key={day.iso}
              className={`cal-cell${day.outside ? ' cal-out' : ''}${isToday ? ' cal-today' : ''}${
                view === 'dia' ? ' cal-cell-day' : ''
              }`}
            >
              <span className="cal-daynum">{day.date.getDate()}</span>
              <div className="cal-chips">
                {view === 'dia'
                  ? dayCards.map(renderChip)
                  : dayCards.slice(0, 3).map(renderChip)}
                {view !== 'dia' && dayCards.length > 3 && (
                  <span className="cal-more">+{dayCards.length - 3}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showUndated && undated.length > 0 && (
        <div className="cal-list-day">
          <h3 className="cal-list-title">Sem data ({undated.length})</h3>
          <div className="cal-chips cal-chips-list">{undated.map(renderChip)}</div>
        </div>
      )}
    </div>
  );
}
