import { useMemo, useState } from 'react';
import type { KanbanCard, KanbanColumn } from '../types';
import type { ViewPreferences } from '../viewPreferences';
import { cardGroupColor, formatShortDate, isOverdue } from './taskViewUtils';

export interface GanttMilestone {
  id: string;
  name: string;
  due_date: string;
}

const MONTH_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - result.getDay());
  return result;
}

interface GanttPeriod {
  start: number;
  end: number;
  label: string;
}

function buildPeriods(scale: ViewPreferences['gantt']['scale'], now: Date): GanttPeriod[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (scale === 'semanal') {
    const first = new Date(startOfWeek(today));
    first.setDate(first.getDate() - 7);
    return Array.from({ length: 5 }, (_, index) => {
      const start = new Date(first);
      start.setDate(start.getDate() + index * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      return {
        start: start.getTime(),
        end: end.getTime(),
        label: `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')}`,
      };
    });
  }
  if (scale === 'quinzenal') {
    const half = today.getDate() <= 15 ? 1 : 16;
    const first = new Date(today.getFullYear(), today.getMonth(), half);
    first.setDate(first.getDate() - 15);
    return Array.from({ length: 4 }, (_, index) => {
      const start = new Date(first);
      start.setDate(start.getDate() + index * 15);
      const end = new Date(start);
      end.setDate(end.getDate() + 15);
      const label = `${String(start.getDate()).padStart(2, '0')}-${String(
        end.getDate() - 1,
      ).padStart(2, '0')} ${MONTH_SHORT[end.getMonth()]}`;
      return { start: start.getTime(), end: end.getTime(), label };
    });
  }
  const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return Array.from({ length: 4 }, (_, index) => {
    const start = new Date(first.getFullYear(), first.getMonth() + index, 1);
    const end = new Date(first.getFullYear(), first.getMonth() + index + 1, 1);
    return {
      start: start.getTime(),
      end: end.getTime(),
      label: `${MONTH_SHORT[start.getMonth()]}/${String(start.getFullYear()).slice(2)}`,
    };
  });
}

interface GanttRow {
  key: string;
  label: string;
  sublabel: string;
  left: number;
  width: number;
  color: string;
  done: boolean;
  overdue: boolean;
  milestone: boolean;
  dueDate: string;
}

export default function TasksGanttView({
  cards,
  columns,
  prefs,
  milestones,
}: {
  cards: KanbanCard[];
  columns: KanbanColumn[];
  prefs: ViewPreferences;
  milestones: GanttMilestone[];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const periods = useMemo(
    () => buildPeriods(prefs.gantt.scale, new Date()),
    [prefs.gantt.scale],
  );
  const windowStart = periods[0].start;
  const windowEnd = periods[periods.length - 1].end;
  const total = windowEnd - windowStart;
  const todayPct = Math.min(
    Math.max((Date.now() - windowStart) / total, 0),
    1,
  );

  const rows: GanttRow[] = [];

  const dated = cards
    .filter((card) => card.due_date)
    .filter((card) => {
      const due = Date.parse(`${card.due_date}T00:00:00`);
      if (due >= windowStart && due < windowEnd) return true;
      return isOverdue(card);
    })
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));

  for (const card of dated) {
    const created = Date.parse(card.created_at);
    const due = Date.parse(`${card.due_date}T00:00:00`);
    const start = Math.min(Math.max(created, windowStart), windowEnd);
    const end = Math.max(due, start);
    const left = Math.min(Math.max((start - windowStart) / total, 0), 0.99);
    const right = Math.min(Math.max((end - windowStart) / total, 0), 1);
    rows.push({
      key: card.id,
      label: card.title,
      sublabel: card.task_code,
      left,
      width: Math.max(right - left, 0.012),
      color: cardGroupColor(card, columns, prefs, 'gantt'),
      done: Boolean(card.completed_at),
      overdue: isOverdue(card),
      milestone: false,
      dueDate: card.due_date ?? '',
    });
  }

  if (prefs.gantt.show_milestones) {
    const visible = milestones
      .filter((milestone) => {
        const due = Date.parse(`${milestone.due_date}T00:00:00`);
        return due >= windowStart && due < windowEnd;
      })
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    for (const milestone of visible) {
      const due = Date.parse(`${milestone.due_date}T00:00:00`);
      const left = Math.min(Math.max((due - windowStart) / total, 0), 0.97);
      rows.push({
        key: `ms-${milestone.id}`,
        label: milestone.name,
        sublabel: 'Marco',
        left,
        width: 0.03,
        color: '#0d9488',
        done: false,
        overdue: false,
        milestone: true,
        dueDate: milestone.due_date,
      });
    }
  }

  const periodWidth = 100 / periods.length;

  return (
    <div className="tasks-gantt panel">
      <div className="gantt-legend" aria-hidden="true">
        <span className="gantt-legend-item">
          <span className="gantt-legend-swatch" style={{ background: '#5b4fe9' }} />
          Período
        </span>
        <span className="gantt-legend-item">
          <span className="gantt-legend-swatch gantt-legend-today" />
          Hoje
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="muted small board-empty">Nenhuma tarefa com limite neste período.</p>
      ) : (
        <div className="gantt">
          <div className="gantt-head">
            <div className="gantt-label-col">Tarefa</div>
            <div className="gantt-track gantt-track-head">
              {periods.map((period) => (
                <span
                  key={period.start}
                  className="gantt-period"
                  style={{ width: `${periodWidth}%` }}
                >
                  {period.label}
                </span>
              ))}
            </div>
          </div>
          <div className="gantt-body">
            <div
              className="gantt-today-line"
              style={{ ['--today-pct' as string]: todayPct }}
              aria-hidden="true"
            />
            {rows.map((row) => (
              <div
                key={row.key}
                className={`gantt-row${row.milestone ? ' gantt-row-milestone' : ''}${
                  hover === row.key ? ' gantt-row-hover' : ''
                }`}
                onMouseEnter={() => setHover(row.key)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="gantt-label-col" title={row.label}>
                  <span className={`gantt-code${row.done ? ' gantt-done-label' : ''}`}>
                    {row.sublabel}
                  </span>
                  <span className={`gantt-name${row.done ? ' gantt-done-label' : ''}`}>
                    {row.label}
                  </span>
                </div>
                <div className="gantt-track">
                  <div
                    className={`gantt-bar${row.milestone ? ' gantt-bar-milestone' : ''}${
                      row.overdue ? ' gantt-bar-overdue' : ''
                    }${row.done ? ' gantt-bar-done' : ''}`}
                    style={{
                      left: `${row.left * 100}%`,
                      width: `${row.width * 100}%`,
                      background: row.color,
                    }}
                    title={`${row.label} — limite ${formatShortDate(row.dueDate)}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
