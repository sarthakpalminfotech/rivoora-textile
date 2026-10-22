import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useRole } from '@/hooks/useRole';

/**
 * A link to a jobsheet's details — plain text for roles that cannot open jobsheets (the godown supervisor's
 * read-only Orders starts at butta cutting; Sprint 15).
 */
export function JobsheetLink({ id, className, children }: { id: number; className?: string; children: ReactNode }) {
  const { can } = useRole();
  if (!can('canViewOrders') && !can('canViewProductionOrders')) return <span className={className?.replace(/hover:underline|text-primary(\/\d+)?/g, '')}>{children}</span>;
  return (
    <Link to={`/jobsheets/${id}`} className={className}>
      {children}
    </Link>
  );
}
