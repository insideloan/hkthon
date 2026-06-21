// Table wrapper (shared `*`). Tailwind lives here only (CONVENTIONS.md §6.1) so
// templates can be swapped without touching feature components.
import { clsx } from 'clsx';
import type { HTMLAttributes, ReactNode, ThHTMLAttributes } from 'react';

export function Table({ children, className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={clsx('w-full border-collapse text-sm', className)} {...rest}>
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-gray-300 text-left text-gray-600">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

type TableRowProps = HTMLAttributes<HTMLTableRowElement> & {
  /** Emphasis for highlighted queue rows. */
  emphasis?: 'none' | 'warn' | 'danger';
};

export function TableRow({ children, emphasis = 'none', className, ...rest }: TableRowProps) {
  return (
    <tr
      className={clsx(
        'border-b border-gray-100 transition-colors hover:bg-gray-50',
        emphasis === 'warn' && 'bg-amber-50 hover:bg-amber-100',
        emphasis === 'danger' && 'bg-red-50 hover:bg-red-100',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function TableHeaderCell({
  children,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={clsx('px-3 py-2 font-medium', className)} {...rest}>
      {children}
    </th>
  );
}

export function TableCell({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={clsx('px-3 py-2 align-middle', className)} {...rest}>
      {children}
    </td>
  );
}
