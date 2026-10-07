import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout/app-layout';
import { PageSkeleton } from '@/components/layout/page-skeleton';
import { PageTitleProvider } from '@/components/layout/page-title';
import { LandingRedirect, NotFoundOrLanding, RequirePermission } from '@/components/layout/require-permission';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { RolePermissions } from '@/config/roles';
import { useRole } from '@/hooks/useRole';
import { queryClient } from '@/lib/query-client';
import RouteError from '@/pages/route-error';

// Route-level code splitting
const OrdersPage = lazy(() => import('@/features/orders/orders-page'));
const OrderDetailsPage = lazy(() => import('@/features/orders/order-details-page'));
const AddOrderPage = lazy(() => import('@/features/orders/add-order-page'));
const EditOrderPage = lazy(() => import('@/features/orders/edit-order-page'));
const CustomersPage = lazy(() => import('@/features/masters/customers/customers-page'));
const MaterialsPage = lazy(() => import('@/features/masters/materials/materials-page'));
const DesignsPage = lazy(() => import('@/features/masters/designs/designs-page'));
const DesignDetailPage = lazy(() => import('@/features/masters/designs/design-detail-page'));
const MachinesPage = lazy(() => import('@/features/masters/machines/machines-page'));
const DamagesPage = lazy(() => import('@/features/masters/damages/damages-page'));
const JobsheetDetailsPage = lazy(() => import('@/features/jobsheets/jobsheet-details-page'));
const JobsheetPrintPage = lazy(() => import('@/features/jobsheets/print-page'));
const SupervisorJobsheetsPage = lazy(() => import('@/features/jobsheets/supervisor-jobsheets-page'));
const SupervisorOrderJobsheetsPage = lazy(() => import('@/features/jobsheets/supervisor-order-jobsheets-page'));
const MachineViewPage = lazy(() => import('@/features/machine-view/machine-view-page'));
const ScanPage = lazy(() => import('@/features/takas/scan-page'));
const JobsheetQrPage = lazy(() => import('@/features/takas/jobsheet-qr-page'));
const TakaJobsheetsPage = lazy(() => import('@/features/takas/taka-jobsheets-page'));
const TakaEntryPage = lazy(() => import('@/features/takas/taka-entry-page'));
const ChallanModulePage = lazy(() => import('@/features/challans/challan-module-page'));
const ChallanDetailsPage = lazy(() => import('@/features/challans/challan-details-page'));
const ChallanPrintPage = lazy(() => import('@/features/challans/challan-print-page'));
const PartiesPage = lazy(() => import('@/features/masters/parties/parties-page'));
const DamageDetailsPage = lazy(() => import('@/features/takas/damage-details-page'));
const QcHomePage = lazy(() => import('@/features/butta-qc/qc-home-page'));
const QcTakaPage = lazy(() => import('@/features/butta-qc/qc-taka-page'));
const MillQcHomePage = lazy(() => import('@/features/mill-qc/qc-home-page'));
const MillQcTakaPage = lazy(() => import('@/features/mill-qc/qc-taka-page'));
const GodownOrdersPage = lazy(() => import('@/features/godown/godown-orders-page'));
const GodownOrderPage = lazy(() => import('@/features/godown/godown-order-page'));
const SplitPage = lazy(() => import('@/features/godown/split-page'));
const InventoryPage = lazy(() => import('@/features/inventory/inventory-page'));
const InventoryItemDetailsPage = lazy(() => import('@/features/inventory/item-details-page'));
const DamagedDetailsPage = lazy(() => import('@/features/inventory/damaged-details-page'));
const NotFoundPage = lazy(() => import('@/pages/not-found-page'));

const guard = (permission: keyof RolePermissions, element: ReactNode) => (
  <RequirePermission permission={permission}>{element}</RequirePermission>
);

/** `/jobsheets`: the Taka entry list for the Taka entry role, the supervisor's module otherwise. */
function JobsheetsRoute() {
  const { can } = useRole();
  if (can('canUseTakaModules')) return <TakaJobsheetsPage />;
  return guard('canViewJobsheetsModule', <SupervisorJobsheetsPage />);
}

/** `/jobsheets/:id`: the taka entry screen for the Taka entry role, the (role-aware) details page otherwise. */
function JobsheetRoute() {
  const { can } = useRole();
  return can('canEnterTakas') ? <TakaEntryPage /> : <JobsheetDetailsPage />;
}

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
        path: '/orders/:id/edit',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canEditOrder">
              <EditOrderPage />
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
        path: '/print/challan/:id',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canUseButtaModule">
              <ChallanPrintPage kind="butta" />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/print/mill-challan/:id',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canUseMillModule">
              <ChallanPrintPage kind="mill" />
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
          { path: 'damages', element: guard('canViewMasters', <DamagesPage />) },
          { path: 'orders/:orderId/takas/:takaId/damages', element: guard('canEditTakas', <DamageDetailsPage />) },
          { path: 'butta-parties', element: guard('canManageButtaParties', <PartiesPage kind="butta" />) },
          { path: 'mill-parties', element: guard('canManageMillParties', <PartiesPage kind="mill" />) },
          // Butta cutting + Mill modules (Jemish, Gaurang, Godown supervisor) and the Butta QC role.
          { path: 'butta', element: guard('canUseButtaModule', <ChallanModulePage kind="butta" />) },
          { path: 'butta/challans/:id', element: guard('canUseButtaModule', <ChallanDetailsPage kind="butta" />) },
          { path: 'mill', element: guard('canUseMillModule', <ChallanModulePage kind="mill" />) },
          { path: 'mill/challans/:id', element: guard('canUseMillModule', <ChallanDetailsPage kind="mill" />) },
          { path: 'butta-qc', element: guard('canButtaQc', <QcHomePage />) },
          { path: 'butta-qc/taka/:takaNo', element: guard('canButtaQc', <QcTakaPage />) },
          { path: 'mill-qc', element: guard('canMillQc', <MillQcHomePage />) },
          { path: 'mill-qc/taka/:takaNo', element: guard('canMillQc', <MillQcTakaPage />) },
          // Godown Orders: final takas, split, ready to dispatch (Godown supervisor; Jemish / Gaurang may open it too).
          { path: 'godown/orders', element: guard('canUseGodownOrders', <GodownOrdersPage />) },
          { path: 'godown/orders/:orderId', element: guard('canUseGodownOrders', <GodownOrderPage />) },
          { path: 'godown/orders/:orderId/split/:takaId', element: guard('canUseGodownOrders', <SplitPage />) },
          { path: 'godown/orders/:orderId/takas/:takaId/damages', element: guard('canUseGodownOrders', <DamageDetailsPage />) },
          // Inventory (Jemish / Gaurang): design-wise pcs, damaged stock.
          { path: 'inventory', element: guard('canViewInventory', <InventoryPage />) },
          { path: 'inventory/items/:key', element: guard('canViewInventory', <InventoryItemDetailsPage />) },
          { path: 'inventory/damaged/:key', element: guard('canViewInventory', <DamagedDetailsPage />) },
          { path: 'jobsheets', element: <JobsheetsRoute /> },
          // The supervisor's Order view: one order's jobsheets.
          { path: 'jobsheets/order/:orderId', element: guard('canViewJobsheetsModule', <SupervisorOrderJobsheetsPage />) },
          // Role-aware: Jemish / Gaurang get the full view, the supervisor his restricted one, Taka entry his entry screen.
          { path: 'jobsheets/:id', element: <JobsheetRoute /> },
          { path: 'machine-view', element: guard('canViewMachineView', <MachineViewPage />) },
          { path: 'scan', element: guard('canUseTakaModules', <ScanPage />) },
          // Target of the QR code printed on jobsheets.
          { path: 'j/:jobsheetNo', element: <JobsheetQrPage /> },
          { path: '*', element: <NotFoundOrLanding fallback={<NotFoundPage />} /> },
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
