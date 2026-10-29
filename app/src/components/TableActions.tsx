type TableActionsProps = {
  onEdit?: () => void;
  onDelete?: () => void;
  editDisabled?: boolean;
  deleteDisabled?: boolean;
  editLabel?: string;
  deleteLabel?: string;
  editTitle?: string;
  deleteTitle?: string;
};

export default function TableActions({
  onEdit,
  onDelete,
  editDisabled,
  deleteDisabled,
  editLabel = 'Editar',
  deleteLabel = 'Excluir',
  editTitle,
  deleteTitle,
}: TableActionsProps) {
  if (!onEdit && !onDelete) return null;

  return (
    <span className="table-actions">
      {onEdit && (
        <button
          type="button"
          className="icon-btn"
          aria-label={editLabel}
          title={editTitle ?? editLabel}
          disabled={editDisabled}
          onClick={onEdit}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          className="icon-btn icon-btn-danger"
          aria-label={deleteLabel}
          title={deleteTitle ?? deleteLabel}
          disabled={deleteDisabled}
          onClick={onDelete}
        >
          <svg
            width="16"
            height="16"
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
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      )}
    </span>
  );
}
