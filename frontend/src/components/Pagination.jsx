// "Showing 21–40 of 57"  [‹ Previous] Page 2 of 3 [Next ›]
//
//   <Pagination pagination={data.pagination} onPageChange={setPage} itemLabel="users" />
//
// `pagination` is the { page, pageSize, total, totalPages } object the API returns.
import Button from './Button';
import './Pagination.css';

export default function Pagination({ pagination, onPageChange, itemLabel = 'items', disabled = false }) {
  const { page, pageSize, total, totalPages } = pagination;
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination__summary">
        Showing {first}–{last} of {total} {itemLabel}
      </span>
      {totalPages > 1 && (
        <div className="pagination__controls">
          <Button variant="secondary" size="sm" icon="chevronLeft"
            disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
            Previous
          </Button>
          <span className="pagination__page">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" icon="chevronRight" iconPosition="end"
            disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </nav>
  );
}
