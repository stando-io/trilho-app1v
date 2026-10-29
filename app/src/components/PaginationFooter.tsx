import { PAGE_SIZE_OPTIONS } from '../usePageSize';

interface PaginationFooterProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function PaginationFooter({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationFooterProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="table-foot">
      <div className="table-foot-info">
        <span className="muted small">
          Mostrando {from}–{to} de {total} registros
        </span>
        <label className="page-size-label muted small">
          Exibir:
          <select
            aria-label="Itens por página"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="table-actions">
        <button
          type="button"
          className="btn btn-plain"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="btn btn-plain"
          disabled={safePage >= pages}
          onClick={() => onPageChange(safePage + 1)}
        >
          Próximo
        </button>
      </div>
    </div>
  );
}
