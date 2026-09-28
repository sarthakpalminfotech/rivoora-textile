import { Compass } from 'lucide-react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/components/layout/page-title';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function NotFoundPage() {
  usePageTitle('Page not found');
  return (
    <div className="page-container py-10">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you're looking for doesn't exist."
        action={
          <Button asChild>
            <Link to="/orders">Go to orders</Link>
          </Button>
        }
      />
    </div>
  );
}
