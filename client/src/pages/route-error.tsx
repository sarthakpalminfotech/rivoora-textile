import { AlertTriangle } from 'lucide-react';
import { useRouteError } from 'react-router-dom';
import { Button } from '@/components/ui/button';

/** Shown if a page crashes or a lazy chunk fails to load (e.g. after a deploy). */
export default function RouteError() {
  const error = useRouteError() as Error | undefined;
  const chunkFailed = /dynamically imported module|Failed to fetch|Loading chunk/i.test(error?.message ?? '');
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive-soft text-destructive">
        <AlertTriangle className="size-7" aria-hidden />
      </div>
      <h1 className="text-lg font-semibold text-slate-900">
        {chunkFailed ? 'A new version is available' : 'Something went wrong'}
      </h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {chunkFailed ? 'Reload the page to continue.' : 'Please reload the page. If this keeps happening, contact support.'}
      </p>
      <Button className="mt-5" onClick={() => window.location.reload()}>
        Reload
      </Button>
    </div>
  );
}
