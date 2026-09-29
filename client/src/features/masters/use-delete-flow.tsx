import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/** Confirmation modal + soft delete. Blocked deletes show the server's explanation as a toast. */
export function useDeleteFlow<T extends { id: number }>(
  mutation: UseMutationResult<unknown, Error, number>,
  describe: (row: T) => string,
  onDeleted?: () => void,
  options: { description?: string } = {},
) {
  const [target, setTarget] = useState<T | null>(null);

  const dialog = (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(o) => !o && setTarget(null)}
      title={`Delete ${target ? describe(target) : ''}?`}
      description={options.description ?? "This will remove it from the list. Records used in orders can't be deleted."}
      confirmLabel="Delete"
      destructive
      loading={mutation.isPending}
      onConfirm={() => {
        if (!target) return;
        mutation.mutate(target.id, {
          onSuccess: () => {
            toast.success(`${describe(target)} deleted`);
            setTarget(null);
            onDeleted?.();
          },
          onError: () => setTarget(null),
        });
      }}
    />
  );

  return { askDelete: setTarget, dialog };
}
