import { Router } from 'express';
import { getProjectPool } from '../db/projectPool.js';
import { query, queryOne } from '../db/pool.js';
import { requireAnyScreen } from '../middleware/auth.js';
import { projectRoleExpr } from '../services/projectRole.js';

const router = Router({ mergeParams: true });

const DAY_MS = 86_400_000;

function parseUtcDate(text: string): Date {
  const [year = 0, month = 1, day = 1] = text.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function weeklyWindow(input: {
  created_date: string;
  start_date: string | null;
  due_date: string | null;
  today: string;
}): {
  axisStart: Date;
  totalWeeks: number;
  currentWeekIndex: number;
} {
  const created = parseUtcDate(input.created_date);
  const today = parseUtcDate(input.today);
  const start = input.start_date ? parseUtcDate(input.start_date) : created;

  if (input.due_date) {
    const due = parseUtcDate(input.due_date);
    const plannedWeeks = Math.max(1, Math.ceil(daysBetween(start, due) / 7));
    const currentFromStart = Math.max(1, Math.floor(daysBetween(start, today) / 7) + 1);
    return {
      axisStart: start,
      totalWeeks: Math.max(plannedWeeks, currentFromStart),
      currentWeekIndex: currentFromStart,
    };
  }

  const currentFromCreation = Math.max(1, Math.floor(daysBetween(created, today) / 7) + 1);
  return {
    axisStart: created,
    totalWeeks: currentFromCreation,
    currentWeekIndex: currentFromCreation,
  };
}

function toneOf(percent: number | null): 'ok' | 'warn' | 'low' | 'neutral' {
  if (percent === null) return 'neutral';
  if (percent >= 66) return 'ok';
  if (percent >= 33) return 'warn';
  return 'low';
}

function scoreTone(score: number | null): 'ok' | 'warn' | 'low' | 'neutral' {
  if (score === null) return 'neutral';
  if (score >= 7) return 'ok';
  if (score >= 4) return 'warn';
  return 'low';
}

function percentOf(done: number, total: number): number | null {
  return total === 0 ? null : Math.round((done * 100) / total);
}

function buildWeeklyEvolution(
  rows: Array<{ created_up_to: number; done_up_to: number }>,
  totalWeeks: number,
  currentWeekIndex: number,
): Array<{ label: string; percent: number | null }> {
  const percentByWeek = new Map(
    rows.map((row, index) => [
      index + 1,
      row.created_up_to > 0
        ? Math.round((row.done_up_to * 100) / row.created_up_to)
        : 0,
    ]),
  );
  const points: Array<{ label: string; percent: number | null }> = [];
  for (let week = 1; week <= totalWeeks; week += 1) {
    points.push({
      label: week === currentWeekIndex ? 'Atual' : `Sem ${week}`,
      percent: percentByWeek.get(week) ?? null,
    });
  }
  return points;
}

router.get('/dashboard', requireAnyScreen('dashboard', 'home'), async (req, res, next) => {
  try {
    const projectId = req.params.projectId!;
    const { projectPool } = await getProjectPool(projectId);

    const projectInfo = await queryOne<{
      created_date: string;
      start_date: string | null;
      due_date: string | null;
      today: string;
    }>(
      `SELECT created_at::date::text AS created_date,
              start_date::text AS start_date,
              due_date::text AS due_date,
              CURRENT_DATE::text AS today
       FROM projects
       WHERE id = $1`,
      [projectId],
    );
    if (!projectInfo) {
      res.status(404).json({ error: { message: 'Projeto não encontrado' } });
      return;
    }

    const { axisStart, totalWeeks, currentWeekIndex } = weeklyWindow(projectInfo);
    const cutoffCount = Math.min(totalWeeks, currentWeekIndex);
    const cutoffs: string[] = [];
    for (let week = 1; week <= cutoffCount; week += 1) {
      cutoffs.push(isoDate(addDays(axisStart, (week - 1) * 7)));
    }

    const [indicators, sectors, status, responsible, calendar, evolution] = await Promise.all([
      projectPool.query<{
        total_cards: number;
        done_cards: number;
        overdue_cards: number;
      }>(
        `SELECT count(*)::int AS total_cards,
                count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS done_cards,
                count(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE
                                  AND completed_at IS NULL)::int AS overdue_cards
         FROM cards`,
      ),
      projectPool.query<{
        id: string;
        name: string;
        total_cards: number;
        completed_cards: number;
        overdue_cards: number;
        avg_score: number | string | null;
        scored_cards: number;
      }>(
        `SELECT s.id, s.name,
                count(c.id)::int AS total_cards,
                count(c.id) FILTER (WHERE c.completed_at IS NOT NULL)::int AS completed_cards,
                count(c.id) FILTER (WHERE c.due_date IS NOT NULL AND c.due_date < CURRENT_DATE
                                      AND c.completed_at IS NULL)::int AS overdue_cards,
                ROUND(AVG(c.learning_index_score) FILTER (
                  WHERE c.learning_index_active = true AND c.learning_index_score IS NOT NULL
                ), 1) AS avg_score,
                count(c.id) FILTER (
                  WHERE c.learning_index_active = true AND c.learning_index_score IS NOT NULL
                )::int AS scored_cards
         FROM sectors s
         LEFT JOIN departments d ON d.sector_id = s.id
         LEFT JOIN cards c ON c.department_id = d.id
         GROUP BY s.id
         ORDER BY s.position, s.created_at`,
      ),
      projectPool.query<{ column_id: string; name: string; is_done: boolean; total: number }>(
        `SELECT k.id AS column_id, k.name, k.is_done, count(c.id)::int AS total
         FROM kanban_columns k
         LEFT JOIN cards c ON c.column_id = k.id
         GROUP BY k.id
         ORDER BY k.position, k.created_at`,
      ),
      projectPool.query<{
        responsible_id: string | null;
        total: number;
        done: number;
      }>(
        `SELECT responsible_id,
                count(*)::int AS total,
                count(*) FILTER (WHERE completed_at IS NOT NULL)::int AS done
         FROM cards
         GROUP BY responsible_id`,
      ),
      projectPool.query<{
        kind: string;
        id: string;
        name: string;
        due_date: string;
        description: string;
      }>(
        `SELECT 'card' AS kind, id, title AS name, due_date, description
         FROM cards WHERE due_date IS NOT NULL
         UNION ALL
         SELECT 'milestone' AS kind, id, name, due_date, description FROM milestones
         ORDER BY due_date`,
      ),
      projectPool.query<{ cutoff: string; created_up_to: number; done_up_to: number }>(
        `SELECT cuts.cutoff::text AS cutoff,
                count(c.id)::int AS created_up_to,
                count(c.id) FILTER (
                  WHERE c.completed_at IS NOT NULL
                    AND c.completed_at < cuts.cutoff::date + interval '1 day'
                )::int AS done_up_to
         FROM unnest($1::date[]) AS cuts(cutoff)
         LEFT JOIN cards c ON c.created_at < cuts.cutoff::date + interval '1 day'
         GROUP BY cuts.cutoff
         ORDER BY cuts.cutoff`,
        [cutoffs],
      ),
    ]);

    const indicator = indicators.rows[0]!;
    const doneCards = indicator.done_cards;

    const responsibleIds = responsible.rows
      .map((row) => row.responsible_id)
      .filter((id): id is string => id !== null);
    const users = responsibleIds.length
      ? await query<{ id: string; name: string }>('SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [
          responsibleIds,
        ])
      : [];
    const userNameById = new Map(users.map((user) => [user.id, user.name]));

    const team = await query<{ id: string; name: string; project_role: string | null }>(
      `SELECT u.id, u.name, ${projectRoleExpr('$1', 'u.id')} AS project_role
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id = $1 AND u.is_active = true
       ORDER BY u.name`,
      [projectId],
    );

    res.json({
      indicators: {
        total_cards: indicator.total_cards,
        pending_cards: indicator.total_cards - doneCards,
        done_cards: doneCards,
        overdue_cards: indicator.overdue_cards,
        completion_percent: percentOf(doneCards, indicator.total_cards),
      },
      sector_temperature: sectors.rows.map((sector) => {
        const avgScore = sector.avg_score === null ? null : Number(sector.avg_score);
        return {
          id: sector.id,
          name: sector.name,
          total_cards: sector.total_cards,
          completed_cards: sector.completed_cards,
          overdue_cards: sector.overdue_cards,
          percent: percentOf(sector.completed_cards, sector.total_cards),
          tone: toneOf(percentOf(sector.completed_cards, sector.total_cards)),
          avg_score: avgScore,
          scored_cards: sector.scored_cards,
          score_tone: scoreTone(avgScore),
        };
      }),
      by_status: status.rows,
      by_responsible: responsible.rows
        .map((row) => ({
          responsible_id: row.responsible_id,
          name: row.responsible_id
            ? (userNameById.get(row.responsible_id) ?? 'Responsável removido')
            : 'Sem responsável',
          total: row.total,
          done: row.done,
        }))
        .sort((a, b) => b.total - a.total),
      team,
      calendar: calendar.rows,
      weekly_evolution: buildWeeklyEvolution(evolution.rows, totalWeeks, currentWeekIndex),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
