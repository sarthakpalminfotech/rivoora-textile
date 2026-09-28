import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, errorMessage } from './api';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err, query) => {
      // Only toast background refetch failures; first loads render their own error state.
      if (query.state.data !== undefined) toast.error(errorMessage(err));
    },
  }),
  mutationCache: new MutationCache({
    onError: (err, _vars, _ctx, mutation) => {
      // Field errors are shown inline by the form that triggered them.
      if (mutation.meta?.silentFieldErrors && err instanceof ApiError && err.field) return;
      toast.error(errorMessage(err));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silentFieldErrors?: boolean };
  }
}
