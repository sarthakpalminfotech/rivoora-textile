import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout/app-layout';
import { PageSkeleton } from '@/components/layout/page-skeleton';
import { PageTitleProvider } from '@/components/layout/page-title';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useRole } from '@/hooks/useRole';
import { queryClient } from '@/lib/query-client';
import RouteError from '@/pages/route-error';

// Route-level code splitting
const OrdersPage = lazy(() => import('@/features/orders/orders-page'));
const OrderDetailsPage = lazy(() => import('@/features/orders/order-details-page'));
const AddOrderPage = lazy(() => import('@/features/orders/add-order-page'));
const CustomersPage = lazy(() => import('@/features/masters/customers/customers-page'));
const MaterialsPage = lazy(() => import('@/features/masters/materials/materials-page'));
const DesignsPage = lazy(() => import('@/features/masters/designs/designs-page'));
const DesignDetailPage = lazy(() => import('@/features/masters/designs/design-detail-page'));
const NotFoundPage = lazy(() => import('@/pages/not-found-page'));

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        // Full-screen views (no navigation chrome)
        path: '/orders/new',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <AddOrderPage />
          </Suspense>
        ),
      },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/orders" replace /> },
          { path: 'orders', element: <OrdersPage /> },
          { path: 'orders/:id', element: <OrderDetailsPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'materials', element: <MaterialsPage /> },
          { path: 'designs', element: <DesignsPage /> },
          { path: 'designs/:id', element: <DesignDetailPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);

/** Re-mounts the routes when the role changes so every screen starts clean. */
function RoleScopedRouter() {
  const { role } = useRole();
  return <RouterProvider key={role} router={router} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <PageTitleProvider>
          <RoleScopedRouter />
          <Toaster position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />
        </PageTitleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
