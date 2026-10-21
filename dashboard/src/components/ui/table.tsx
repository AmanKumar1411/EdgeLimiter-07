import { useState, type HTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import { Button } from "./button";
import { cn } from "@/lib/format";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    // `relative` keeps absolutely positioned children (sr-only headers) inside
    // the scroll container; otherwise they widen the whole page on mobile.
    <div className="relative overflow-x-auto">
      <table className={cn("w-full border-collapse text-[13px]", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("h-9 whitespace-nowrap border-b px-4 text-left text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b px-4 py-2.5 align-middle", className)} {...props} />;
}

export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  // Clamp when filtering shrinks the list.
  const current = Math.min(page, pageCount - 1);
  return {
    rows: items.slice(current * pageSize, (current + 1) * pageSize),
    page: current,
    pageCount,
    total: items.length,
    pageSize,
    setPage,
  };
}

export function Pagination({
  page,
  pageCount,
  total,
  pageSize,
  setPage,
}: ReturnType<typeof usePagination>) {
  if (total <= pageSize) return null;
  const first = page * pageSize + 1;
  const last = Math.min(total, first + pageSize - 1);
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs text-muted-foreground">
      <span>
        {first}–{last} of {total}
      </span>
      <div className="flex gap-1.5">
        <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
