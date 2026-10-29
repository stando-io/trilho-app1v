import { useMemo, useState } from 'react';
import type { CalendarItem } from '../types';

const MONTHS = [
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

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

interface CalendarCell {
  key: string;
  day: number;
  iso: string | null;
  today: boolean;
}

function isoOf(year: number, month: number, day: number): string {
  const monthText = String(month + 1).padStart(2, '0');
  const dayText = String(day).padStart(2, '0');
  return `${year}-${monthText}-${dayText}`;
}

function todayIso(): string {
  const now = new Date();
  return isoOf(now.getFullYear(), now.getMonth(), now.getDate());
}

function buildCalendarCells(cursor: Date): CalendarCell[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevious = new Date(year, month, 0).getDate();
  const today = todayIso();

  const cells: CalendarCell[] = [];
  for (let index = 0; index < firstWeekday; index += 1) {
    const day = daysInPrevious - firstWeekday + 1 + index;
    cells.push({ key: `prev-${day}`, day, iso: null, today: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = isoOf(year, month, day);
    cells.push({ key: iso, day, iso, today: iso === today });
  }
  let nextDay = 1;
  while (cells.length < 42) {
    cells.push({ key: `next-${nextDay}`, day: nextDay, iso: null, today: false });
    nextDay += 1;
  }
  return cells;
}

interface ProjectCalendarProps {
  items: CalendarItem[];
  canManage?: boolean;
  onDaySelect?: (iso: string, x: number, y: number) => void;
}

export default function ProjectCalendar({ items, canManage, onDaySelect }: ProjectCalendarProps) {
  const [cursor, setCursor] = useState(() =>
    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of items) {
      const list = map.get(item.due_date) ?? [];
      list.push(item);
      map.set(item.due_date, list);
    }
    return map;
  }, [items]);

  const cells = useMemo(() => buildCalendarCells(cursor), [cursor]);

  function moveMonth(delta: number) {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  return (
    <div>
      <div className="panel-head">
        <h2>Calendário de projetos</h2>
        <div className="inline-form cal-nav">
          <button type="button" className="btn btn-plain" onClick={() => moveMonth(-1)}>
            Mês anterior
          </button>
          <span className="cal-month">
            {MONTHS[cursor.getMonth()]} de {cursor.getFullYear()}
          </span>
          <button type="button" className="btn btn-plain" onClick={() => moveMonth(1)}>
            Próximo mês
          </button>
        </div>
      </div>
      <div className="cal-grid cal-head" aria-hidden="true">
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="cal-weekday">
            {weekday}
          </span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((cell) => {
          const cellItems = cell.iso ? (itemsByDate.get(cell.iso) ?? []) : [];
          const visible = cellItems.slice(0, 3);
          const hidden = cellItems.length - visible.length;
          const interactive = Boolean(cell.iso && canManage && onDaySelect);
          const dayLabel = interactive
            ? `Registrar em ${String(cell.day).padStart(2, '0')}/${String(
                cursor.getMonth() + 1,
              ).padStart(2, '0')}`
            : undefined;
          return (
            <div
              key={cell.key}
              className={`cal-cell${cell.iso ? '' : ' cal-cell-out'}${
                cell.today ? ' cal-cell-today' : ''
              }${interactive ? ' cal-cell-interactive' : ''}`}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={dayLabel}
              onClick={
                interactive
                  ? (event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      onDaySelect?.(cell.iso!, rect.left + rect.width / 2, rect.bottom);
                    }
                  : undefined
              }
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.currentTarget.click();
                      }
                    }
                  : undefined
              }
            >
              <span className="cal-day">{cell.day}</span>
              {visible.map((item) => (
                <span
                  key={`${item.kind}-${item.id}`}
                  className={`cal-item cal-item-${item.kind}`}
                  title={item.name}
                >
                  {item.name}
                </span>
              ))}
              {hidden > 0 && <span className="cal-more small muted">+{hidden}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
