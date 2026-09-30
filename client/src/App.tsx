import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout/app-layout';
import { PageSkeleton } from '@/components/layout/page-skeleton';
import { PageTitleProvider } from '@/components/layout/page-title';
import { LandingRedirect, RequirePermission } from '@/components/layout/require-permission';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { RolePermissions } from '@/config/roles';
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
const MachinesPage = lazy(() => import('@/features/masters/machines/machines-page'));
const JobsheetDetailsPage = lazy(() => import('@/features/jobsheets/jobsheet-details-page'));
const JobsheetPrintPage = lazy(() => import('@/features/jobsheets/print-page'));
const SupervisorJobsheetsPage = lazy(() => import('@/features/jobsheets/supervisor-jobsheets-page'));
const MachineViewPage = lazy(() => import('@/features/machine-view/machine-view-page'));
const NotFoundPage = lazy(() => import('@/pages/not-found-page'));

const guard = (permission: keyof RolePermissions, element: ReactNode) => (
  <RequirePermission permission={permission}>{element}</RequirePermission>
);

const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        // Full-screen views (no navigation chrome)
        path: '/orders/new',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canViewOrders">
              <AddOrderPage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/print/jobsheets',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canPrintJobsheets">
              <JobsheetPrintPage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <LandingRedirect /> },
          { path: 'orders', element: guard('canViewOrders', <OrdersPage />) },
          { path: 'orders/:id', element: guard('canViewOrders', <OrderDetailsPage />) },
          { path: 'customers', element: guard('canViewMasters', <CustomersPage />) },
          { path: 'materials', element: guard('canViewMasters', <MaterialsPage />) },
          { path: 'designs', element: guard('canViewMasters', <DesignsPage />) },
          { path: 'designs/:id', element: guard('canViewMasters', <DesignDetailPage />) },
          { path: 'machines', element: guard('canViewMasters', <MachinesPage />) },
          { path: 'jobsheets', element: guard('canViewJobsheetsModule', <SupervisorJobsheetsPage />) },
          // Role-aware: Jemish / Gaurang get the full view, the supervisor his restricted one.
          { path: 'jobsheets/:id', element: <JobsheetDetailsPage /> },
          { path: 'machine-view', element: guard('canViewMachineView', <MachineViewPage />) },
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
