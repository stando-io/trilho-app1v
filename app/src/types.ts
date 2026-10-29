export interface UserProfile {
  id: string;
  name: string;
  screens: string[];
  permissions: string[];
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  is_active: boolean;
  status?: string | null;
}

export interface MeUser {
  id: string;
  name: string;
  email: string;
  avatar_color: string | null;
  avatar_text_color: string | null;
  role: { id: string; name: string } | null;
  profile: UserProfile;
  projects: Project[];
}

export interface Profile {
  id: string;
  name: string;
  description: string;
  screens: string[];
  permissions: string[];
  users_count?: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  profile_name: string | null;
  project_role: string | null;
}

export interface Department {
  id: string;
  name: string;
  position: number;
  percent: number | null;
  total_cards: number;
  completed_cards: number;
  overdue_cards: number;
}

export interface Sector {
  id: string;
  name: string;
  position: number;
  percent: number | null;
  total_cards: number;
  completed_cards: number;
  overdue_cards: number;
  departments: Department[];
}

export type Priority = 'baixa' | 'media' | 'alta';

export interface CardDraft {
  id: string | null;
  task_code: string;
  title: string;
  description: string;
  priority: Priority;
  department_id: string;
  responsible_id: string;
  due_date: string;
  origin: string;
  column_id: string;
  learning_index_active: boolean;
  learning_index_score: number | null;
  learning_index_note: string;
}

export interface AttachmentRow {
  id: string;
  filename: string;
  url: string;
  size_bytes: number | null;
  position: number;
  created_at: string;
}

export interface KanbanColumn {
  id: string;
  name: string;
  position: number;
  is_done: boolean;
  locked: boolean;
  color: string | null;
  cards_count: number;
}

export interface KanbanCard {
  id: string;
  task_code: string;
  title: string;
  description: string;
  priority: Priority;
  column_id: string;
  department_id: string | null;
  department_name: string | null;
  sector_id: string | null;
  sector_name: string | null;
  responsible_id: string | null;
  responsible_name: string | null;
  responsibles: Array<{ id: string; name: string }>;
  comments_count: number;
  attachments_count: number;
  subtasks_total: number;
  subtasks_done: number;
  origin: string;
  due_date: string | null;
  position: number;
  completed_at: string | null;
  created_at: string;
  learning_index_active: boolean;
  learning_index_score: number | null;
  learning_index_note: string;
}

export interface CardFilters {
  q: string;
  status: '' | 'done' | 'pending';
  department_id: string;
  sector_id: string;
  responsible_id: string;
}

export interface DashboardIndicators {
  total_cards: number;
  pending_cards: number;
  done_cards: number;
  overdue_cards: number;
  completion_percent: number | null;
}

export interface SectorTemperature {
  id: string;
  name: string;
  total_cards: number;
  completed_cards: number;
  overdue_cards: number;
  percent: number | null;
  tone: 'ok' | 'warn' | 'low' | 'neutral';
  avg_score: number | null;
  scored_cards: number;
  score_tone: 'ok' | 'warn' | 'low' | 'neutral';
}

export interface StatusCount {
  column_id: string;
  name: string;
  is_done: boolean;
  total: number;
}

export interface ResponsibleCount {
  responsible_id: string | null;
  name: string;
  total: number;
  done: number;
}

export interface TeamMember {
  id: string;
  name: string;
  project_role: string | null;
}

export interface CalendarItem {
  kind: 'card' | 'milestone';
  id: string;
  name: string;
  due_date: string;
  description?: string;
}

export interface WeeklyPoint {
  label: string;
  percent: number | null;
}

export interface DashboardData {
  indicators: DashboardIndicators;
  sector_temperature: SectorTemperature[];
  by_status: StatusCount[];
  by_responsible: ResponsibleCount[];
  team: TeamMember[];
  calendar: CalendarItem[];
  weekly_evolution: WeeklyPoint[];
}
