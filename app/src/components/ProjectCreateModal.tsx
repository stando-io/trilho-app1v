import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';

interface SystemUser {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
}

const STATUS_OPTIONS = ['Em prospecção', 'Iniciado', 'Em andamento'] as const;

function formatDate(iso: string): string {
  if (!iso) return '—';
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR');
}

type StepField = 'name' | 'client' | 'start' | 'manager' | 'status';
type StepErrors = Partial<Record<StepField, string>>;

interface MemberMultiSelectProps {
  label: string;
  members: SystemUser[];
  value: string[];
  onChange: (next: string[]) => void;
}

function MemberMultiSelect({ label, members, value, onChange }: MemberMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const query = search.trim().toLowerCase();
  const visible = query
    ? members.filter(
        (member) =>
          member.name.toLowerCase().includes(query) ||
          member.email.toLowerCase().includes(query),
      )
    : members;

  function toggle(userId: string) {
    onChange(
      value.includes(userId) ? value.filter((id) => id !== userId) : [...value, userId],
    );
  }

  return (
    <div className="field multi-select" ref={rootRef}>
      <span>{label}</span>
      <button
        type="button"
        className="multi-select-toggle"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {value.length > 0
          ? `${value.length} membro(s) selecionado(s)`
          : 'Selecionar membros'}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="multi-select-panel">
          <input
            type="search"
            placeholder="Buscar membro..."
            aria-label={`Buscar membro em ${label}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <ul className="multi-select-list">
            {visible.map((member) => (
              <li key={member.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={value.includes(member.id)}
                    onChange={() => toggle(member.id)}
                  />
                  <span className="multi-select-name">{member.name}</span>
                  <span className="muted small">{member.email}</span>
                </label>
              </li>
            ))}
            {visible.length === 0 && (
              <li className="muted small multi-select-empty">Nenhum membro encontrado</li>
            )}
          </ul>
        </div>
      )}
      {value.length > 0 && (
        <div className="multi-chips">
          {value.map((userId) => (
            <span key={userId} className="multi-chip">
              {members.find((member) => member.id === userId)?.name ?? userId}
              <button
                type="button"
                aria-label="Remover membro da seleção"
                onClick={() => onChange(value.filter((id) => id !== userId))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export type CreateMode = 'rascunho' | 'base-manual' | 'base-importada';

interface ImportError {
  line: number;
  message: string;
}

interface ProjectCreateModalProps {
  onClose: () => void;
  onCreated: (projectId: string, mode: CreateMode) => void | Promise<void>;
}

export default function ProjectCreateModal({ onClose, onCreated }: ProjectCreateModalProps) {
  const [step, setStep] = useState(1);
  const [members, setMembers] = useState<SystemUser[]>([]);
  const [memberError, setMemberError] = useState('');
  const [errors, setErrors] = useState<StepErrors>({});
  const [apiError, setApiError] = useState('');
  const [busy, setBusy] = useState<'rascunho' | 'manual' | 'import' | null>(null);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [contract, setContract] = useState('');
  const [client, setClient] = useState('');
  const [start, setStart] = useState('');
  const [due, setDue] = useState('');
  const [managerId, setManagerId] = useState('');
  const [status, setStatus] = useState('');

  const [leadGerente, setLeadGerente] = useState('');
  const [leadAnalista, setLeadAnalista] = useState('');
  const [leadLider, setLeadLider] = useState('');
  const [leadVice, setLeadVice] = useState('');
  const [tecnicos, setTecnicos] = useState<string[]>([]);
  const [suporte, setSuporte] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await api<SystemUser[]>('/users');
        if (alive) setMembers(rows.filter((row) => row.is_active));
      } catch (err) {
        if (alive) {
          setMemberError(
            err instanceof ApiError ? err.message : 'Erro ao carregar os membros',
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function clearError(field: StepField) {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: '' } : prev));
  }

  function validateStepOne(): boolean {
    const next: StepErrors = {};
    if (name.trim().length < 2) next.name = 'Informe o nome do projeto';
    if (!client.trim()) next.client = 'Informe o cliente ou empresa';
    if (!start) next.start = 'Informe a data de início previsto';
    if (!managerId) next.manager = 'Selecione o gerente responsável';
    if (!status) next.status = 'Selecione o status inicial';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function goNext() {
    if (validateStepOne()) setStep(2);
  }

  function memberName(id: string): string {
    return members.find((member) => member.id === id)?.name || '—';
  }

  function membersLabel(ids: string[]): string {
    if (ids.length === 0) return '—';
    return ids.map((id) => members.find((member) => member.id === id)?.name || id).join(', ');
  }

  async function createProject(draft: boolean): Promise<string> {
    const created = await api<{ id: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: name.trim(),
        contract_number: contract.trim(),
        client_name: client.trim(),
        start_date: start || null,
        due_date: due || null,
        manager_id: managerId,
        status,
        draft,
        team: {
          gerente_projeto: leadGerente || null,
          analista_processo: leadAnalista || null,
          lider_implantacao: leadLider || null,
          vice_lider_implantacao: leadVice || null,
          tecnicos_implantacao: tecnicos,
          operacao_assistida: suporte,
        },
      }),
    });
    return created.id;
  }

  async function handleSaveDraft() {
    setBusy('rascunho');
    setApiError('');
    setImportErrors([]);
    try {
      const projectId = await createProject(true);
      await onCreated(projectId, 'rascunho');
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Erro ao salvar o rascunho');
    } finally {
      setBusy(null);
    }
  }

  async function handleManualBase() {
    setBusy('manual');
    setApiError('');
    setImportErrors([]);
    try {
      const projectId = await createProject(false);
      await onCreated(projectId, 'base-manual');
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Erro ao criar o projeto');
    } finally {
      setBusy(null);
    }
  }

  function readFileBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result === 'string') {
          resolve(result.split(',', 2)[1] ?? '');
        } else {
          reject(new Error('Falha ao ler o arquivo'));
        }
      };
      reader.onerror = () => reject(new Error('Falha ao ler o arquivo'));
      reader.readAsDataURL(file);
    });
  }

  async function handleImportFile(file: File) {
    setBusy('import');
    setApiError('');
    setImportErrors([]);
    try {
      let projectId = createdProjectId;
      if (!projectId) {
        projectId = await createProject(false);
        setCreatedProjectId(projectId);
      }
      const fileBase64 = await readFileBase64(file);
      const response = await fetch(`/api/v1/projects/${projectId}/base/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_base64: fileBase64, filename: file.name }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorBody = (body as { error?: { message?: string; errors?: ImportError[] } })?.error;
        const lineErrors = errorBody?.errors ?? [];
        if (lineErrors.length > 0) {
          setImportErrors(lineErrors);
        } else {
          setApiError(errorBody?.message ?? 'Erro ao importar a planilha');
        }
        return;
      }
      await onCreated(projectId, 'base-importada');
    } catch (err) {
      setApiError(err instanceof ApiError ? err.message : 'Erro ao importar a planilha');
    } finally {
      setBusy(null);
    }
  }

  const memberSelect = (
    value: string,
    onChange: (next: string) => void,
    ariaLabel: string,
    errorKey?: StepField,
  ) => (
    <select
      value={value}
      aria-label={ariaLabel}
      className={errorKey && errors[errorKey] ? 'is-error' : ''}
      aria-invalid={errorKey ? Boolean(errors[errorKey]) : undefined}
      onChange={(event) => {
        onChange(event.target.value);
        if (errorKey) clearError(errorKey);
      }}
    >
      <option value="">Selecione o membro</option>
      {members.map((member) => (
        <option key={member.id} value={member.id}>
          {member.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="Novo projeto">
        <div className="steps-progress" aria-hidden="true">
          <span className={step >= 1 ? 'on' : ''} />
          <span className={step >= 2 ? 'on' : ''} />
          <span className={step >= 3 ? 'on' : ''} />
        </div>
        <h3>Novo projeto</h3>
        <span className="step-badge">Etapa {step} de 3</span>
        <p className="step-subtitle">
          {step === 1
            ? 'Informações principais'
            : step === 2
              ? 'Monte a equipe'
              : 'Confirme as informações'}
        </p>

        {memberError && <div className="error-box">{memberError}</div>}
        {apiError && <div className="error-box">{apiError}</div>}

        {step === 1 ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              goNext();
            }}
          >
            <label className="field">
              <span>Nome do projeto *</span>
              <input
                value={name}
                placeholder="Ex.: Implantação Cliente Alfa"
                aria-label="Nome do projeto"
                aria-invalid={Boolean(errors.name)}
                className={errors.name ? 'is-error' : ''}
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                  clearError('name');
                }}
              />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </label>

            <label className="field">
              <span>Número do contrato</span>
              <input
                value={contract}
                placeholder="Ex.: CTR-0001"
                aria-label="Número do contrato"
                onChange={(event) => setContract(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Cliente / Empresa *</span>
              <input
                value={client}
                placeholder="Ex.: Cliente Alfa Ltda"
                aria-label="Cliente / Empresa"
                aria-invalid={Boolean(errors.client)}
                className={errors.client ? 'is-error' : ''}
                onChange={(event) => {
                  setClient(event.target.value);
                  clearError('client');
                }}
              />
              {errors.client && <span className="field-error">{errors.client}</span>}
            </label>

            <div className="form-grid">
              <label className="field">
                <span>Início previsto *</span>
                <input
                  type="date"
                  value={start}
                  aria-label="Início previsto"
                  aria-invalid={Boolean(errors.start)}
                  className={errors.start ? 'is-error' : ''}
                  onChange={(event) => {
                    setStart(event.target.value);
                    clearError('start');
                  }}
                />
                {errors.start && <span className="field-error">{errors.start}</span>}
              </label>

              <label className="field">
                <span>Entrega prevista</span>
                <input
                  type="date"
                  value={due}
                  aria-label="Entrega prevista"
                  onChange={(event) => setDue(event.target.value)}
                />
              </label>
            </div>

            <label className="field">
              <span>Gerente responsável *</span>
              {memberSelect(managerId, setManagerId, 'Gerente responsável', 'manager')}
              {errors.manager && <span className="field-error">{errors.manager}</span>}
            </label>

            <label className="field">
              <span>Status inicial *</span>
              <select
                value={status}
                aria-label="Status inicial"
                aria-invalid={Boolean(errors.status)}
                className={errors.status ? 'is-error' : ''}
                onChange={(event) => {
                  setStatus(event.target.value);
                  clearError('status');
                }}
              >
                <option value="">Selecione o status</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {errors.status && <span className="field-error">{errors.status}</span>}
            </label>

            <div className="modal-actions">
              <button type="button" className="btn btn-plain" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="btn">
                Próximo →
              </button>
            </div>
          </form>
        ) : step === 2 ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setStep(3);
            }}
          >
            <div className="modal-section">
              <h4>Liderança</h4>
              <label className="field">
                <span>Gerente de projeto</span>
                {memberSelect(leadGerente, setLeadGerente, 'Gerente de projeto')}
              </label>
              <label className="field">
                <span>Analista de processo</span>
                {memberSelect(leadAnalista, setLeadAnalista, 'Analista de processo')}
              </label>
              <label className="field">
                <span>Líder de implantação</span>
                {memberSelect(leadLider, setLeadLider, 'Líder de implantação')}
              </label>
              <label className="field">
                <span>Vice-líder de implantação</span>
                {memberSelect(leadVice, setLeadVice, 'Vice-líder de implantação')}
              </label>
            </div>

            <div className="modal-section">
              <h4>Equipe técnica</h4>
              <MemberMultiSelect
                label="Técnicos de implantação"
                members={members}
                value={tecnicos}
                onChange={setTecnicos}
              />
              <MemberMultiSelect
                label="Operação assistida / Suporte"
                members={members}
                value={suporte}
                onChange={setSuporte}
              />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-plain" onClick={() => setStep(1)}>
                ← Voltar
              </button>
              <button type="submit" className="btn">
                Próximo →
              </button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
            }}
          >
            <div className="modal-section">
              <h4>Dados do projeto</h4>
              <dl className="summary-list">
                <div>
                  <dt>Nome</dt>
                  <dd>{name}</dd>
                </div>
                <div>
                  <dt>Contrato</dt>
                  <dd>{contract || '—'}</dd>
                </div>
                <div>
                  <dt>Cliente / Empresa</dt>
                  <dd>{client}</dd>
                </div>
                <div>
                  <dt>Início previsto</dt>
                  <dd>{formatDate(start)}</dd>
                </div>
                <div>
                  <dt>Entrega prevista</dt>
                  <dd>{formatDate(due)}</dd>
                </div>
                <div>
                  <dt>Gerente responsável</dt>
                  <dd>{memberName(managerId)}</dd>
                </div>
                <div>
                  <dt>Status inicial</dt>
                  <dd>{status}</dd>
                </div>
              </dl>
            </div>

            <div className="modal-section">
              <h4>Liderança</h4>
              <dl className="summary-list">
                <div>
                  <dt>Gerente de projeto</dt>
                  <dd>{memberName(leadGerente)}</dd>
                </div>
                <div>
                  <dt>Analista de processo</dt>
                  <dd>{memberName(leadAnalista)}</dd>
                </div>
                <div>
                  <dt>Líder de implantação</dt>
                  <dd>{memberName(leadLider)}</dd>
                </div>
                <div>
                  <dt>Vice-líder de implantação</dt>
                  <dd>{memberName(leadVice)}</dd>
                </div>
              </dl>
            </div>

            <div className="modal-section">
              <h4>Equipe técnica</h4>
              <dl className="summary-list">
                <div>
                  <dt>Técnicos de implantação</dt>
                  <dd>{membersLabel(tecnicos)}</dd>
                </div>
                <div>
                  <dt>Operação assistida / Suporte</dt>
                  <dd>{membersLabel(suporte)}</dd>
                </div>
              </dl>
            </div>

            <div className="modal-section wizard-finish">
              <h4>CONCLUIR CADASTRO</h4>
              <p className="muted small">
                Confira as informações acima e escolha como finalizar: salvar como rascunho,
                montar a base manualmente ou importar uma planilha com setores e departamentos.
              </p>
              {importErrors.length > 0 && (
                <div className="error-box">
                  <strong>Planilha com erros:</strong>
                  <ul className="import-error-list">
                    {importErrors.map((item) => (
                      <li key={`${item.line}-${item.message}`}>
                        Linha {item.line}: {item.message}
                      </li>
                    ))}
                  </ul>
                  {createdProjectId && (
                    <p className="muted small">
                      O projeto já foi criado — escolha outro arquivo para tentar novamente.
                    </p>
                  )}
                </div>
              )}
              <div className="wizard-finish-actions">
                <button
                  type="button"
                  className="btn btn-plain"
                  disabled={busy !== null}
                  onClick={() => void handleSaveDraft()}
                >
                  {busy === 'rascunho' ? 'Salvando' : 'Salvar como Rascunho'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => void handleManualBase()}
                >
                  {busy === 'manual' ? 'Salvando' : 'Criar Base Manualmente'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy !== null}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {busy === 'import' ? 'Importando' : 'Importar Planilha'}
                </button>
                <button type="button" className="btn btn-plain" onClick={() => setStep(2)}>
                  ← Voltar
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                aria-label="Importar planilha preenchida"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void handleImportFile(file);
                }}
              />
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
