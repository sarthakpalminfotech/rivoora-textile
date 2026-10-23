import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { isExternalJobsheetNo } from '@rivoora/shared';
import { useRole } from '@/hooks/useRole';

/**
 * A link to a jobsheet's details — plain text for roles that cannot open jobsheets (the godown supervisor's
 * read-only Orders starts at butta cutting; Sprint 15) and for the hidden external jobsheet of outside / FG takas
 * (Sprint 16: pass `jobsheetNo`; it is never opened as a jobsheet).
 */
export function JobsheetLink({ id, jobsheetNo, className, children }: { id: number; jobsheetNo?: number; className?: string; children: ReactNode }) {
  const { can } = useRole();
  if ((!can('canViewOrders') && !can('canViewProductionOrders')) || isExternalJobsheetNo(jobsheetNo)) {
    return <span className={className?.replace(/hover:underline|text-primary(\/\d+)?/g, '')}>{children}</span>;
  }
  return (
    <Link to={`/jobsheets/${id}`} className={className}>
      {children}
    </Link>
  );
}
