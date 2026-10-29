import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from '../api';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import ImageLightbox from './ImageLightbox';
import { isFinalColumn } from '../views/taskViewUtils';
import type {
  AttachmentRow,
  CardDraft,
  KanbanCard,
  KanbanColumn,
  Member,
  Sector,
} from '../types';

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  'a',
  'ul',
  'ol',
  'li',
  'img',
  'div',
  'span',
]);

const ACTION_LABELS: Record<string, string> = {
  card_created: 'criou o card',
  card_updated: 'atualizou o card',
  card_deleted: 'excluiu o card',
  card_subtask_added: 'vinculou uma sub-tarefa',
  card_subtask_removed: 'desvinculou uma sub-tarefa',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'Título',
  description: 'Descrição',
  priority: 'Prioridade',
  column_id: 'Coluna',
  department_id: 'Departamento',
  responsible_id: 'Responsável',
  due_date: 'Limite',
  origin: 'Origem',
  learning_index_active: 'Índice ativo',
  learning_index_score: 'Nota do índice',
  learning_index_note: 'Observação do índice',
};

function scoreBand(score: number): 'low' | 'warn' | 'ok' {
  if (score >= 7) return 'ok';
  if (score >= 4) return 'warn';
  return 'low';
}

interface SubtaskRow {
  id: string;
  subtask_id: string;
  title: string;
  task_code: string;
  completed_at: string | null;
  column_name: string | null;
}

interface ParentRow {
  id: string;
  card_id: string;
  title: string;
  task_code: string;
  completed_at: string | null;
  column_name: string | null;
}

interface CardCharLimits {
  title_max_chars: number;
  description_max_chars: number;
}

function charCounterClass(count: number, max: number): string {
  if (count >= max) return 'char-counter char-counter-limit';
  if (count >= Math.ceil(max * 0.8)) return 'char-counter char-counter-warn';
  return 'char-counter';
}

function visibleTextLength(html: string): number {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.innerText || div.textContent || '').length;
}

interface ActivityRow {
  kind: 'event' | 'comment';
  id?: string;
  action?: string;
  body?: string;
  user_name: string | null;
  meta?: Record<string, unknown>;
  created_at: string;
}

const ATTACHMENT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeRichHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  function clean(element: Element): void {
    Array.from(element.children).forEach(clean);
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      const fragment = document.createDocumentFragment();
      while (element.firstChild) fragment.appendChild(element.firstChild);
      element.replaceWith(fragment);
      return;
    }
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value;
      if (tag === 'a' && name === 'href' && !/^\s*javascript:/i.test(value)) return;
      if (tag === 'img' && name === 'src' && /^(https?:|\/uploads\/)/i.test(value)) return;
      if (tag === 'img' && name === 'alt') return;
      if (tag === 'span' && name === 'data-attachment' && ATTACHMENT_ID_RE.test(value)) {
        return;
      }
      if (tag === 'span' && name === 'data-user' && ATTACHMENT_ID_RE.test(value)) {
        return;
      }
      element.removeAttribute(attribute.name);
    });
    if (tag === 'span' && ATTACHMENT_ID_RE.test(element.getAttribute('data-attachment') ?? '')) {
      element.setAttribute('class', 'mention-pill');
    } else if (tag === 'span' && ATTACHMENT_ID_RE.test(element.getAttribute('data-user') ?? '')) {
      element.setAttribute('class', 'mention-pill mention-pill-user');
    }
  }
  Array.from(doc.body.children).forEach(clean);
  return doc.body.innerHTML;
}

export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function changesSummary(meta: Record<string, unknown> | undefined): string {
  const changes = meta?.changes as Record<string, { from: unknown; to: unknown }> | undefined;
  if (!changes) return '';
  return Object.entries(changes)
    .map(([field, change]) => {
      const label = FIELD_LABELS[field] ?? field;
      const from = change.from === null || change.from === undefined ? '—' : String(change.from);
      const to = change.to === null || change.to === undefined ? '—' : String(change.to);
      return `${label}: "${from}" → "${to}"`;
    })
    .join(' · ');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function commentBodyHtml(body: string): string {
  return escapeHtml(body).replace(
    /(@|#)Imagem (\d+)/g,
    '<span class="mention-pill mention-pill-static" data-index="$2">#Imagem $2</span>',
  );
}

interface CardModalProps {
  draft: CardDraft;
  setDraft: React.Dispatch<React.SetStateAction<CardDraft | null>>;
  columns: KanbanColumn[];
  sectors: Sector[];
  members: Member[];
  projectId: string;
  canCreateCard: boolean;
  canEditCard: boolean;
  canDeleteCard: boolean;
  busy: boolean;
  error: string;
  onSave: (event: FormEvent) => void;
  onDelete: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onAttachmentsChanged?: () => void;
  onNavigateCard?: (cardId: string) => void;
  refreshSignal?: number;
}

export default function CardModal({
  draft,
  setDraft,
  columns,
  sectors,
  members,
  projectId,
  canCreateCard,
  canEditCard,
  canDeleteCard,
  busy,
  error,
  onSave,
  onDelete,
  onPrev,
  onNext,
  onAttachmentsChanged,
  onNavigateCard,
  refreshSignal = 0,
}: CardModalProps) {
  const toast = useToast();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [tab, setTab] = useState<'descricao' | 'subtarefas' | 'indice' | 'atividade'>('descricao');
  const [subtasks, setSubtasks] = useState<SubtaskRow[]>([]);
  const [parents, setParents] = useState<ParentRow[]>([]);
  const [charLimits, setCharLimits] = useState<CardCharLimits>({
    title_max_chars: 200,
    description_max_chars: 4000,
  });
  const [descVisibleCount, setDescVisibleCount] = useState(0);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachmentsLoaded, setAttachmentsLoaded] = useState(false);
  const [mentionMenu, setMentionMenu] = useState<{
    kind: 'image' | 'user';
    x: number;
    y: number;
    query: string;
  } | null>(null);
  const [commentMention, setCommentMention] = useState<{
    kind: 'image' | 'user';
    query: string;
  } | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const dragAttachmentRef = useRef<string | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [subtaskQuery, setSubtaskQuery] = useState('');
  const [subtaskResults, setSubtaskResults] = useState<KanbanCard[]>([]);
  const [commentText, setCommentText] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const confirmedRef = useRef(false);
  const originalColumnRef = useRef(draft.column_id);
  const [confirmDoneOpen, setConfirmDoneOpen] = useState(false);

  useEffect(() => {
    setTab('descricao');
    setSubtaskQuery('');
    setSubtaskResults([]);
    setCommentText('');
    setMentionMenu(null);
    setCommentMention(null);
    setLightbox(null);
    setRenameId(null);
    setAttachmentsLoaded(false);
    setEditorKey((key) => key + 1);
    originalColumnRef.current = draft.column_id;
  }, [draft.id]);

  useEffect(() => {
    setMentionMenu(null);
    setCommentMention(null);
  }, [tab]);

  useEffect(() => {
    if (tab === 'descricao' && editorRef.current) {
      editorRef.current.innerHTML = sanitizeRichHtml(draft.description || '');
      setDescVisibleCount(visibleTextLength(draft.description || ''));
    }
  }, [editorKey, tab]);

  useEffect(() => {
    if (!attachmentsLoaded) return;
    const editor = editorRef.current;
    if (!editor) return;
    let changed = false;
    editor.querySelectorAll<HTMLSpanElement>('span[data-attachment]').forEach((pill) => {
      const id = pill.dataset.attachment ?? '';
      const index = attachments.findIndex((row) => row.id === id);
      if (index < 0) {
        pill.remove();
        changed = true;
        return;
      }
      const label = `#Imagem ${index + 1}`;
      if (pill.textContent !== label) {
        pill.textContent = label;
        changed = true;
      }
    });
    if (changed) syncEditor();
  }, [attachments, attachmentsLoaded, editorKey, tab]);

  useEffect(() => {
    let cancelled = false;
    void api<CardCharLimits>('/settings/limits')
      .then((limits) => {
        if (!cancelled) setCharLimits(limits);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draft.id || !projectId) {
      setSubtasks([]);
      setParents([]);
      setActivity([]);
      setAttachments([]);
      setAttachmentsLoaded(false);
      return;
    }
    let cancelled = false;
    void api<SubtaskRow[]>(`/projects/${projectId}/cards/${draft.id}/subtasks`)
      .then((rows) => {
        if (!cancelled) setSubtasks(rows);
      })
      .catch(() => undefined);
    void api<ParentRow[]>(`/projects/${projectId}/cards/${draft.id}/parents`)
      .then((rows) => {
        if (!cancelled) setParents(rows);
      })
      .catch(() => undefined);
    void api<ActivityRow[]>(`/projects/${projectId}/cards/${draft.id}/activity`)
      .then((rows) => {
        if (!cancelled) setActivity(rows);
      })
      .catch(() => undefined);
    void api<AttachmentRow[]>(`/projects/${projectId}/cards/${draft.id}/attachments`)
      .then((rows) => {
        if (cancelled) return;
        setAttachments(rows);
        setAttachmentsLoaded(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [draft.id, projectId]);

  useEffect(() => {
    const query = subtaskQuery.trim();
    if (!draft.id || query.length < 2) {
      setSubtaskResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void api<KanbanCard[]>(`/projects/${projectId}/cards?q=${encodeURIComponent(query)}`)
        .then((rows) => {
          const linked = new Set(subtasks.map((row) => row.subtask_id));
          setSubtaskResults(
            rows.filter((row) => row.id !== draft.id && !linked.has(row.id)).slice(0, 8),
          );
        })
        .catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [subtaskQuery, draft.id, projectId, subtasks]);

  async function refreshSubtasks() {
    if (!draft.id) return;
    const rows = await api<SubtaskRow[]>(`/projects/${projectId}/cards/${draft.id}/subtasks`);
    setSubtasks(rows);
    try {
      const parentRows = await api<ParentRow[]>(`/projects/${projectId}/cards/${draft.id}/parents`);
      setParents(parentRows);
    } catch {
      // lista de pais é complementar; falha não bloqueia a aba
    }
  }

  useEffect(() => {
    if (refreshSignal === 0 || !draft.id) return;
    void refreshSubtasks().catch(() => undefined);
  }, [refreshSignal]);

  async function refreshActivity() {
    if (!draft.id) return;
    const rows = await api<ActivityRow[]>(`/projects/${projectId}/cards/${draft.id}/activity`);
    setActivity(rows);
  }

  async function refreshAttachments() {
    if (!draft.id) return;
    const rows = await api<AttachmentRow[]>(`/projects/${projectId}/cards/${draft.id}/attachments`);
    setAttachments(rows);
    setAttachmentsLoaded(true);
    onAttachmentsChanged?.();
  }

  async function deleteAttachment(row: AttachmentRow) {
    if (!draft.id) return;
    if (!window.confirm(`Excluir a imagem "${row.filename}"?`)) return;
    try {
      await api(`/projects/${projectId}/cards/${draft.id}/attachments/${row.id}`, {
        method: 'DELETE',
      });
      await refreshAttachments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao excluir a imagem');
    }
  }

  function startRename(row: AttachmentRow) {
    setRenameId(row.id);
    setRenameValue(row.filename);
  }

  function cancelRename() {
    setRenameId(null);
    setRenameValue('');
  }

  async function saveRename(row: AttachmentRow) {
    const value = renameValue.trim();
    setRenameId(null);
    if (!draft.id || !value || value === row.filename) return;
    try {
      await api(`/projects/${projectId}/cards/${draft.id}/attachments/${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ filename: value }),
      });
      await refreshAttachments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao renomear a imagem');
    }
  }

  function dropAttachment(targetId: string) {
    const sourceId = dragAttachmentRef.current;
    dragAttachmentRef.current = null;
    if (!sourceId || sourceId === targetId) return;
    const ids = attachments.map((row) => row.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const order = [...ids];
    order.splice(from, 1);
    order.splice(to, 0, sourceId);
    void applyAttachmentOrder(order);
  }

  async function applyAttachmentOrder(order: string[]) {
    if (!draft.id) return;
    try {
      await api(`/projects/${projectId}/cards/${draft.id}/attachments`, {
        method: 'PATCH',
        body: JSON.stringify({ order }),
      });
      await refreshAttachments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao reordenar as imagens');
      await refreshAttachments().catch(() => undefined);
    }
  }

  async function addSubtask(cardId: string) {
    if (!draft.id) return;
    try {
      await api(`/projects/${projectId}/cards/${draft.id}/subtasks`, {
        method: 'POST',
        body: JSON.stringify({ subtask_id: cardId }),
      });
      setSubtaskQuery('');
      setSubtaskResults([]);
      await refreshSubtasks();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao vincular sub-tarefa');
    }
  }

  async function removeSubtask(subtaskId: string) {
    if (!draft.id) return;
    try {
      await api(`/projects/${projectId}/cards/${draft.id}/subtasks/${subtaskId}`, {
        method: 'DELETE',
      });
      await refreshSubtasks();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao remover sub-tarefa');
    }
  }

  async function postComment() {
    if (!draft.id || !commentText.trim()) return;
    try {
      await api(`/projects/${projectId}/cards/${draft.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentText.trim() }),
      });
      setCommentText('');
      await refreshActivity();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao publicar comentário');
    }
  }

  function syncEditor() {
    if (!editorRef.current) return;
    const html = sanitizeRichHtml(editorRef.current.innerHTML);
    setDraft((previous) => (previous ? { ...previous, description: html } : previous));
  }

  function execCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditor();
  }

  function insertLink() {
    const url = window.prompt('URL do link:');
    if (!url) return;
    if (/^\s*javascript:/i.test(url)) {
      toast.error('URL não permitida.');
      return;
    }
    execCommand('createLink', url);
  }

  async function uploadImage(file: File) {
    if (!draft.id) {
      toast.error('Salve o card para anexar imagens.');
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      toast.error('Use uma imagem PNG, JPG, GIF ou WEBP.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 2 MB.');
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(',')[1] ?? '';
      await api<{ url: string; attachment_id: string | null }>(`/projects/${projectId}/uploads`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, data_base64: base64, card_id: draft.id }),
      });
      await refreshAttachments();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao enviar a imagem');
    } finally {
      setUploading(false);
    }
  }

  function filterMentionOptions(query: string): Array<{ row: AttachmentRow; index: number }> {
    const normalized = query.trim().toLowerCase();
    return attachments
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row, index }) =>
          !normalized ||
          row.filename.toLowerCase().includes(normalized) ||
          `imagem ${index + 1}`.includes(normalized),
      );
  }

  function filterMemberOptions(query: string): Member[] {
    const normalized = query.trim().toLowerCase();
    return members
      .filter((member) => !normalized || member.name.toLowerCase().includes(normalized))
      .slice(0, 8);
  }

  function caretTextBefore(): { node: Text; offset: number; before: string } | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return null;
    return {
      node: node as Text,
      offset: range.startOffset,
      before: (node.textContent ?? '').slice(0, range.startOffset),
    };
  }

  function handleEditorInput() {
    syncEditor();
    setDescVisibleCount((editorRef.current?.innerText || '').length);
    const context = caretTextBefore();
    const selection = window.getSelection();
    const rect =
      selection && selection.rangeCount > 0
        ? selection.getRangeAt(0).getBoundingClientRect()
        : null;
    const imageMatch = context ? /#([^\s#]{0,40})$/.exec(context.before) : null;
    if (imageMatch && attachments.length > 0) {
      setMentionMenu({
        kind: 'image',
        x: rect?.left ?? 0,
        y: rect?.bottom ?? 0,
        query: imageMatch[1] ?? '',
      });
      return;
    }
    const userMatch = context ? /@([^\s@]{0,40})$/.exec(context.before) : null;
    if (userMatch) {
      setMentionMenu({
        kind: 'user',
        x: rect?.left ?? 0,
        y: rect?.bottom ?? 0,
        query: userMatch[1] ?? '',
      });
      return;
    }
    setMentionMenu(null);
  }

  function handleEditorBeforeInput(event: React.FormEvent<HTMLDivElement>) {
    const count = editorRef.current?.innerText?.length ?? 0;
    if (count < charLimits.description_max_chars) return;
    const native = event.nativeEvent as InputEvent;
    if (native.inputType?.startsWith('delete')) return;
    event.preventDefault();
    toast.error(`Descrição no limite máximo de ${charLimits.description_max_chars} caracteres.`);
  }

  function handleEditorPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    const count = editorRef.current?.innerText?.length ?? 0;
    const room = charLimits.description_max_chars - count;
    if (room <= 0) {
      toast.error(`Descrição no limite máximo de ${charLimits.description_max_chars} caracteres.`);
      return;
    }
    const slice = text.slice(0, room);
    document.execCommand('insertText', false, slice);
    if (slice.length < text.length) {
      toast.error('Texto colado truncado no limite de caracteres da descrição.');
    }
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && mentionMenu) {
      event.preventDefault();
      event.stopPropagation();
      setMentionMenu(null);
    }
  }

  function handleEditorClick(event: React.MouseEvent<HTMLDivElement>) {
    const pill = (event.target as HTMLElement).closest(
      'span[data-attachment]',
    ) as HTMLElement | null;
    if (!pill) return;
    const id = pill.dataset.attachment ?? '';
    const index = attachments.findIndex((row) => row.id === id);
    if (index < 0) return;
    const row = attachments[index]!;
    setLightbox({ url: row.url, alt: `#Imagem ${index + 1} — ${row.filename}` });
  }

  function insertMention(row: AttachmentRow, index: number) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const context = caretTextBefore();
    if (context) {
      const tokenMatch = /#[^\s#]*$/.exec(context.before);
      if (tokenMatch) {
        const range = document.createRange();
        range.setStart(context.node, context.offset - tokenMatch[0].length);
        range.setEnd(context.node, context.offset);
        range.deleteContents();
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    document.execCommand(
      'insertHTML',
      false,
      `<span class="mention-pill" data-attachment="${row.id}">#Imagem ${index + 1}</span>&nbsp;`,
    );
    setMentionMenu(null);
    syncEditor();
  }

  function insertUserMention(member: Member) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const context = caretTextBefore();
    if (context) {
      const tokenMatch = /@[^\s@]*$/.exec(context.before);
      if (tokenMatch) {
        const range = document.createRange();
        range.setStart(context.node, context.offset - tokenMatch[0].length);
        range.setEnd(context.node, context.offset);
        range.deleteContents();
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    document.execCommand(
      'insertHTML',
      false,
      `<span class="mention-pill mention-pill-user" data-user="${member.id}">@${escapeHtml(member.name)}</span>&nbsp;`,
    );
    setMentionMenu(null);
    syncEditor();
  }

  function handleCommentChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setCommentText(value);
    const caret = event.target.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const imageMatch = /#([^\s#]{0,40})$/.exec(before);
    if (imageMatch) {
      setCommentMention({ kind: 'image', query: imageMatch[1] ?? '' });
      return;
    }
    const userMatch = /@([^\s@]{0,40})$/.exec(before);
    setCommentMention(userMatch ? { kind: 'user', query: userMatch[1] ?? '' } : null);
  }

  function insertCommentImageMention(index: number) {
    const textarea = commentInputRef.current;
    const label = `#Imagem ${index + 1} `;
    const caret = textarea?.selectionStart ?? commentText.length;
    const tokenMatch = /#[^\s#]*$/.exec(commentText.slice(0, caret));
    const start = caret - (tokenMatch ? tokenMatch[0].length : 0);
    setCommentText(commentText.slice(0, start) + label + commentText.slice(caret));
    setCommentMention(null);
    window.requestAnimationFrame(() => {
      const element = commentInputRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(start + label.length, start + label.length);
    });
  }

  function insertCommentUserMention(member: Member) {
    const textarea = commentInputRef.current;
    const label = `@${member.name} `;
    const caret = textarea?.selectionStart ?? commentText.length;
    const tokenMatch = /@[^\s@]*$/.exec(commentText.slice(0, caret));
    const start = caret - (tokenMatch ? tokenMatch[0].length : 0);
    setCommentText(commentText.slice(0, start) + label + commentText.slice(caret));
    setCommentMention(null);
    window.requestAnimationFrame(() => {
      const element = commentInputRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(start + label.length, start + label.length);
    });
  }

  function handleCommentClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest('[data-index]') as HTMLElement | null;
    if (!target) return;
    const index = Number(target.dataset.index ?? '0') - 1;
    const row = attachments[index];
    if (!row) return;
    setLightbox({ url: row.url, alt: `#Imagem ${index + 1} — ${row.filename}` });
  }

  async function copyCardCode() {
    try {
      await navigator.clipboard.writeText(draft.task_code);
    } catch {
      const legacy = document.createElement('textarea');
      legacy.value = draft.task_code;
      document.body.appendChild(legacy);
      legacy.select();
      document.execCommand('copy');
      legacy.remove();
    }
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1600);
  }

  const selectedColumn = columns.find((column) => column.id === draft.column_id);
  const columnName = selectedColumn?.name;
  const isConclude = selectedColumn ? isFinalColumn(selectedColumn) : false;
  const tabsDisabled = !draft.id;
  const uploadLocked = !draft.id;
  const mentionOptions = mentionMenu && mentionMenu.kind === 'image' ? filterMentionOptions(mentionMenu.query) : [];
  const mentionMemberOptions = mentionMenu && mentionMenu.kind === 'user' ? filterMemberOptions(mentionMenu.query) : [];
  const commentImageOptions =
    commentMention && commentMention.kind === 'image' ? filterMentionOptions(commentMention.query) : [];
  const commentMemberOptions =
    commentMention && commentMention.kind === 'user' ? filterMemberOptions(commentMention.query) : [];

  return (
    <div className="modal-backdrop">
      <div className="modal modal-card" role="dialog" aria-modal="true">
        <h3>{draft.id ? 'Editar card' : 'Novo card'}</h3>
        <div className="modal-code">
          {draft.id ? (
            <>
              <span className="modal-code-label">Código</span>
              <span className="modal-code-value">{draft.task_code}</span>
              <button
                type="button"
                className="modal-code-copy"
                aria-label="Copiar código do card"
                title="Copiar código"
                onClick={() => void copyCardCode()}
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
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Copiar</span>
              </button>
              {copiedCode && <span className="code-copied">Copiado</span>}
            </>
          ) : (
            <span className="modal-code-label">Preencha os dados e salve para gerenciar detalhes</span>
          )}
          <span className="card-modal-nav">
            <button
              type="button"
              className="card-nav-btn"
              aria-label="Card anterior"
              title="Card anterior"
              disabled={!onPrev}
              onClick={() => onPrev?.()}
            >
              ‹
            </button>
            <button
              type="button"
              className="card-nav-btn"
              aria-label="Próximo card"
              title="Próximo card"
              disabled={!onNext}
              onClick={() => onNext?.()}
            >
              ›
            </button>
          </span>
        </div>
        <input
          className="card-modal-title"
          aria-label="Título do card"
          placeholder="Título do card"
          value={draft.title}
          maxLength={charLimits.title_max_chars}
          autoFocus
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
        <div className="title-counter-row">
          <span className={charCounterClass(draft.title.length, charLimits.title_max_chars)}>
            {draft.title.length} / {charLimits.title_max_chars}
          </span>
        </div>
        <hr className="card-modal-rule" />
        {error && <div className="error-box">{error}</div>}
        <form
          ref={formRef}
          onSubmit={(event) => {
            if (isConclude && !confirmedRef.current) {
              event.preventDefault();
              setConfirmDoneOpen(true);
              return;
            }
            confirmedRef.current = false;
            onSave(event);
          }}
        >
          <div className="card-modal-body">
            <div className="card-modal-main">
              <div className="card-modal-tabs" role="tablist" aria-label="Seções do card">
                <button
                  type="button"
                  role="tab"
                  className="card-modal-tab"
                  aria-selected={tab === 'descricao'}
                  onClick={() => setTab('descricao')}
                >
                  Descrição
                </button>
                <button
                  type="button"
                  role="tab"
                  className="card-modal-tab"
                  aria-selected={tab === 'subtarefas'}
                  disabled={tabsDisabled}
                  title={tabsDisabled ? 'Salve o card para gerenciar sub-tarefas' : undefined}
                  onClick={() => setTab('subtarefas')}
                >
                  Sub-tarefas
                  {draft.id && parents.length > 0 && (
                    <span
                      className="card-modal-tab-dot"
                      aria-label="Esta tarefa é sub-tarefa de outro card"
                      title="Esta tarefa é sub-tarefa de outro card"
                    />
                  )}
                </button>
                <button
                  type="button"
                  role="tab"
                  className="card-modal-tab"
                  aria-selected={tab === 'indice'}
                  disabled={tabsDisabled}
                  title={tabsDisabled ? 'Salve o card para registrar o índice' : undefined}
                  onClick={() => setTab('indice')}
                >
                  Índice
                  {draft.learning_index_active && draft.learning_index_score !== null && (
                    <span
                      className={`card-modal-tab-badge badge-${scoreBand(draft.learning_index_score)}`}
                    >
                      {draft.learning_index_score}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  role="tab"
                  className="card-modal-tab"
                  aria-selected={tab === 'atividade'}
                  disabled={tabsDisabled}
                  title={tabsDisabled ? 'Salve o card para ver a atividade' : undefined}
                  onClick={() => setTab('atividade')}
                >
                  Atividade
                </button>
              </div>
              {tab === 'descricao' && (
                <>
                  <div className="rt-toolbar" role="toolbar" aria-label="Formatar descrição">
                    <button
                      type="button"
                      className="rt-btn"
                      aria-label="Negrito"
                      title="Negrito"
                      onClick={() => execCommand('bold')}
                    >
                      <strong>N</strong>
                    </button>
                    <button
                      type="button"
                      className="rt-btn"
                      aria-label="Itálico"
                      title="Itálico"
                      onClick={() => execCommand('italic')}
                    >
                      <em>I</em>
                    </button>
                    <button
                      type="button"
                      className="rt-btn"
                      aria-label="Sublinhado"
                      title="Sublinhado"
                      onClick={() => execCommand('underline')}
                    >
                      <u>S</u>
                    </button>
                    <button
                      type="button"
                      className="rt-btn"
                      aria-label="Lista com marcadores"
                      title="Lista com marcadores"
                      onClick={() => execCommand('insertUnorderedList')}
                    >
                      • Lista
                    </button>
                    <button
                      type="button"
                      className="rt-btn"
                      aria-label="Lista numerada"
                      title="Lista numerada"
                      onClick={() => execCommand('insertOrderedList')}
                    >
                      1. Numerada
                    </button>
                    <button
                      type="button"
                      className="rt-btn"
                      aria-label="Inserir link"
                      title="Inserir link"
                      onClick={insertLink}
                    >
                      Link
                    </button>
                    <button
                      type="button"
                      className="rt-btn"
                      aria-label="Anexar imagem"
                      title={
                        uploadLocked ? 'Salve o card para anexar imagens' : 'Anexar imagem à galeria'
                      }
                      disabled={uploading || uploadLocked}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? 'Enviando…' : 'Imagem'}
                    </button>
                  </div>
                  <div
                    key={editorKey}
                    ref={(element) => {
                      editorRef.current = element;
                    }}
                    className="rt-editor"
                    contentEditable
                    role="textbox"
                    aria-multiline="true"
                    aria-label="Descrição do card"
                    suppressContentEditableWarning
                    onInput={handleEditorInput}
                    onBeforeInput={handleEditorBeforeInput}
                    onPaste={handleEditorPaste}
                    onClick={handleEditorClick}
                    onKeyDown={handleEditorKeyDown}
                    onBlur={() => setMentionMenu(null)}
                  />
                  <div className="desc-counter-row">
                    <span
                      className={charCounterClass(descVisibleCount, charLimits.description_max_chars)}
                    >
                      {descVisibleCount} / {charLimits.description_max_chars}
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadImage(file);
                      event.target.value = '';
                    }}
                  />
                  <div
                    className={`card-upload-zone${dragOver ? ' is-over' : ''}${
                      uploadLocked ? ' is-locked' : ''
                    }`}
                    onClick={() => {
                      if (uploadLocked) {
                        toast.error('Salve o card para anexar imagens.');
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    onDragOver={(event) => {
                      if (uploadLocked) return;
                      event.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragOver(false);
                      if (uploadLocked) {
                        toast.error('Salve o card para anexar imagens.');
                        return;
                      }
                      const file = event.dataTransfer.files?.[0];
                      if (file) void uploadImage(file);
                    }}
                  >
                    {uploadLocked ? (
                      <>
                        Salve o card para anexar imagens
                        <span className="muted small">
                          {' '}
                          a galeria fica disponível após o primeiro salvamento
                        </span>
                      </>
                    ) : (
                      <>
                        Arraste uma imagem aqui ou clique para anexar
                        <span className="muted small"> PNG, JPG, GIF ou WEBP até 2 MB</span>
                      </>
                    )}
                  </div>
                  {attachments.length > 0 && (
                    <div className="attachment-gallery" role="list" aria-label="Imagens anexadas">
                      {attachments.map((row, index) => (
                        <div
                          key={row.id}
                          className="attachment-thumb"
                          role="listitem"
                          draggable={!uploading && renameId !== row.id}
                          onDragStart={() => {
                            dragAttachmentRef.current = row.id;
                          }}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            dropAttachment(row.id);
                          }}
                        >
                          <button
                            type="button"
                            className="attachment-thumb-view"
                            title="Abrir imagem"
                            aria-label={`Abrir ${row.filename}`}
                            onClick={() =>
                              setLightbox({
                                url: row.url,
                                alt: `#Imagem ${index + 1} — ${row.filename}`,
                              })
                            }
                          >
                            <img src={row.url} alt={row.filename} loading="lazy" />
                          </button>
                          <span className="attachment-thumb-tag">#Imagem {index + 1}</span>
                          {renameId === row.id ? (
                            <input
                              className="attachment-thumb-rename"
                              value={renameValue}
                              aria-label="Novo nome do arquivo"
                              autoFocus
                              onChange={(event) => setRenameValue(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void saveRename(row);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  cancelRename();
                                }
                              }}
                              onBlur={() => void saveRename(row)}
                            />
                          ) : (
                            <span className="attachment-thumb-actions">
                              <button
                                type="button"
                                className="attachment-thumb-btn"
                                aria-label={`Renomear ${row.filename}`}
                                title="Renomear"
                                onClick={() => startRename(row)}
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
                                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                className="attachment-thumb-btn"
                                aria-label={`Excluir ${row.filename}`}
                                title="Excluir"
                                onClick={() => void deleteAttachment(row)}
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
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {tab === 'subtarefas' && draft.id && (
                <>
                  <div className="subtask-add">
                    <input
                      aria-label="Buscar card para vincular como sub-tarefa"
                      placeholder="Buscar card pelo título ou código…"
                      value={subtaskQuery}
                      onChange={(event) => setSubtaskQuery(event.target.value)}
                    />
                    {subtaskResults.length > 0 && (
                      <div className="subtask-results" role="listbox" aria-label="Resultados da busca">
                        {subtaskResults.map((card) => (
                          <button
                            key={card.id}
                            type="button"
                            className="subtask-result"
                            role="option"
                            onClick={() => void addSubtask(card.id)}
                          >
                            <strong>{card.task_code}</strong> {card.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {parents.length > 0 && (
                    <div>
                      <p className="muted small">Esta tarefa é uma sub-tarefa vinculada ao card</p>
                      {parents.map((parent) => (
                        <div key={parent.id} className="subtask-row">
                          <button
                            type="button"
                            className="subtask-link"
                            title={onNavigateCard ? 'Abrir card pai' : undefined}
                            disabled={!onNavigateCard}
                            onClick={() => onNavigateCard?.(parent.card_id)}
                          >
                            <strong>{parent.task_code}</strong> {parent.title}
                          </button>
                          <span className="muted small">{parent.column_name ?? ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {subtasks.length === 0 ? (
                    <p className="muted small">Nenhuma sub-tarefa vinculada.</p>
                  ) : (
                    <div>
                      {subtasks.map((row) => (
                        <div key={row.id} className="subtask-row">
                          <button
                            type="button"
                            className={`subtask-link${row.completed_at ? ' subtask-done' : ''}`}
                            title={onNavigateCard ? 'Abrir card' : undefined}
                            disabled={!onNavigateCard}
                            onClick={() => onNavigateCard?.(row.subtask_id)}
                          >
                            <strong>{row.task_code}</strong> {row.title}
                          </button>
                          <span className="muted small">{row.column_name ?? ''}</span>
                          <button
                            type="button"
                            className="btn btn-plain"
                            aria-label={`Desvincular sub-tarefa ${row.task_code}`}
                            onClick={() => void removeSubtask(row.subtask_id)}
                          >
                            Remover
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              {tab === 'indice' && (
                <div className="index-block">
                  <div className="index-block-head">
                    <div>
                      <h3 className="index-block-title">Índice de aprendizado</h3>
                      <p className="hint">Avalie o nível de absorção do setor</p>
                    </div>
                    <label className="view-toggle" title="Ativar índice neste card">
                      <input
                        type="checkbox"
                        checked={draft.learning_index_active}
                        onChange={(event) =>
                          setDraft({ ...draft, learning_index_active: event.target.checked })
                        }
                      />
                      <span className="view-switch" aria-hidden="true" />
                    </label>
                  </div>
                  <div
                    className="index-block-body"
                    aria-disabled={!draft.learning_index_active}
                    style={{ opacity: draft.learning_index_active ? 1 : 0.5 }}
                  >
                    <div className="index-score-row" role="group" aria-label="Nota do índice">
                      {Array.from({ length: 11 }, (_, i) => i).map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={`index-score-btn index-score-${scoreBand(value)}${
                            draft.learning_index_score === value ? ' index-score-selected' : ''
                          }`}
                          disabled={!draft.learning_index_active}
                          aria-pressed={draft.learning_index_score === value}
                          onClick={() => setDraft({ ...draft, learning_index_score: value })}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                    <label className="field">
                      <span>Observação (opcional)</span>
                      <textarea
                        rows={2}
                        disabled={!draft.learning_index_active}
                        placeholder="Ex.: equipe engajada mas com dúvidas no módulo X"
                        value={draft.learning_index_note}
                        onChange={(event) =>
                          setDraft({ ...draft, learning_index_note: event.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
              {tab === 'atividade' && draft.id && (
                <>
                  {activity.length === 0 ? (
                    <p className="muted small">Nenhuma atividade registrada.</p>
                  ) : (
                    <div className="activity-list">
                      {activity.map((row, index) => (
                        <div
                          key={row.id ?? `${row.created_at}-${index}`}
                          className="activity-item"
                        >
                          <div className="activity-meta">
                            {row.user_name ?? 'Sistema'} · {formatWhen(row.created_at)}
                          </div>
                          {row.kind === 'comment' ? (
                            <div
                              className="activity-comment-body"
                              onClick={handleCommentClick}
                              dangerouslySetInnerHTML={{ __html: commentBodyHtml(row.body ?? '') }}
                            />
                          ) : (
                            <>
                              <div>{ACTION_LABELS[row.action ?? ''] ?? row.action}</div>
                              {(() => {
                                const summary = changesSummary(row.meta);
                                return summary ? <div className="activity-changes">{summary}</div> : null;
                              })()}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="subtask-add">
                    <textarea
                      ref={commentInputRef}
                      rows={2}
                      aria-label="Novo comentário"
                      placeholder="Escreva um comentário… use # para imagem e @ para pessoa"
                      value={commentText}
                      onChange={handleCommentChange}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' && commentMention !== null) {
                          event.preventDefault();
                          setCommentMention(null);
                        }
                      }}
                    />
                    {commentMention !== null &&
                      commentMention.kind === 'image' &&
                      commentImageOptions.length > 0 && (
                        <div
                          className="mention-menu mention-menu-comment"
                          role="listbox"
                          aria-label="Mencionar imagem"
                        >
                          {commentImageOptions.slice(0, 8).map(({ row, index }) => (
                            <button
                              key={row.id}
                              type="button"
                              role="option"
                              className="mention-option"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => insertCommentImageMention(index)}
                            >
                              <img src={row.url} alt="" aria-hidden="true" />
                              <span className="mention-option-label">#Imagem {index + 1}</span>
                              <span className="mention-option-name">{row.filename}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    {commentMention !== null &&
                      commentMention.kind === 'user' &&
                      commentMemberOptions.length > 0 && (
                        <div
                          className="mention-menu mention-menu-comment"
                          role="listbox"
                          aria-label="Mencionar pessoa"
                        >
                          {commentMemberOptions.map((member) => (
                            <button
                              key={member.id}
                              type="button"
                              role="option"
                              className="mention-option"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => insertCommentUserMention(member)}
                            >
                              <span className="mention-option-label">@{member.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    <button
                      type="button"
                      className="btn"
                      disabled={!commentText.trim()}
                      onClick={() => void postComment()}
                    >
                      Comentar
                    </button>
                  </div>
                </>
              )}
            </div>
            <aside className="card-modal-side" aria-label="Detalhes do card">
              <label className="field">
                <span>Coluna</span>
                <select
                  value={draft.column_id}
                  onChange={(event) => setDraft({ ...draft, column_id: event.target.value })}
                >
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Prioridade</span>
                <select
                  value={draft.priority}
                  onChange={(event) =>
                    setDraft({ ...draft, priority: event.target.value as CardDraft['priority'] })
                  }
                >
                  <option value="baixa">Baixa</option>
                  <option value="media">Média</option>
                  <option value="alta">Alta</option>
                </select>
              </label>
              <label className="field">
                <span>Departamento</span>
                <select
                  value={draft.department_id}
                  onChange={(event) => setDraft({ ...draft, department_id: event.target.value })}
                >
                  <option value="">Sem departamento</option>
                  {sectors.map((sector) => (
                    <optgroup key={sector.id} label={sector.name}>
                      {sector.departments.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Responsável</span>
                <select
                  value={draft.responsible_id}
                  onChange={(event) => setDraft({ ...draft, responsible_id: event.target.value })}
                >
                  <option value="">Sem responsável</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Limite</span>
                <input
                  type="date"
                  value={draft.due_date}
                  onChange={(event) => setDraft({ ...draft, due_date: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Origem</span>
                <input
                  value={draft.origin}
                  onChange={(event) => setDraft({ ...draft, origin: event.target.value })}
                  placeholder="Ex.: reuniao de kickoff"
                />
              </label>
              {draft.learning_index_active && draft.learning_index_score !== null && (
                <div className={`index-registered index-registered-${scoreBand(draft.learning_index_score)}`}>
                  <span className="index-registered-label">Índice registrado</span>
                  <span className="index-registered-value">{draft.learning_index_score}/10</span>
                </div>
              )}
              {columnName && <p className="muted small">Coluna atual: {columnName}</p>}
            </aside>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-plain" onClick={() => setDraft(null)}>
              Cancelar
            </button>
            {draft.id && canDeleteCard && (
              <button type="button" className="btn btn-danger" onClick={onDelete}>
                Excluir
              </button>
            )}
            {(canEditCard || (!draft.id && canCreateCard)) && (
              <button
                type="submit"
                className="btn"
                disabled={busy || draft.title.trim().length === 0 || (!draft.id && !draft.column_id)}
              >
                {busy ? 'Salvando' : isConclude ? 'Concluir' : 'Salvar'}
              </button>
            )}
          </div>
        </form>
      </div>
      {mentionMenu && mentionMenu.kind === 'image' && mentionOptions.length > 0 && (
        <div
          className="mention-menu"
          role="listbox"
          aria-label="Mencionar imagem"
          style={{ left: mentionMenu.x, top: mentionMenu.y }}
        >
          {mentionOptions.slice(0, 8).map(({ row, index }) => (
            <button
              key={row.id}
              type="button"
              role="option"
              className="mention-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(row, index)}
            >
              <img src={row.url} alt="" aria-hidden="true" />
              <span className="mention-option-label">#Imagem {index + 1}</span>
              <span className="mention-option-name">{row.filename}</span>
            </button>
          ))}
        </div>
      )}
      {mentionMenu && mentionMenu.kind === 'user' && mentionMemberOptions.length > 0 && (
        <div
          className="mention-menu"
          role="listbox"
          aria-label="Mencionar pessoa"
          style={{ left: mentionMenu.x, top: mentionMenu.y }}
        >
          {mentionMemberOptions.map((member) => (
            <button
              key={member.id}
              type="button"
              role="option"
              className="mention-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertUserMention(member)}
            >
              <span className="mention-option-label">@{member.name}</span>
            </button>
          ))}
        </div>
      )}
      {lightbox && (
        <ImageLightbox url={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
      <ConfirmDialog
        open={confirmDoneOpen}
        title="Concluir Tarefa"
        message="Tem certeza de que deseja marcar esta tarefa como concluída?"
        confirmLabel="Confirmar Conclusão"
        confirmVariant="warning"
        onConfirm={() => {
          confirmedRef.current = true;
          setConfirmDoneOpen(false);
          formRef.current?.requestSubmit();
        }}
        onCancel={() => {
          setConfirmDoneOpen(false);
          setDraft({ ...draft, column_id: originalColumnRef.current });
        }}
      />
    </div>
  );
}
