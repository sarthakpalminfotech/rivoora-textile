import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from '@/components/layout/app-layout';
import { PageSkeleton } from '@/components/layout/page-skeleton';
import { PageTitleProvider } from '@/components/layout/page-title';
import { LandingRedirect, NotFoundOrLanding, RequirePermission } from '@/components/layout/require-permission';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { RolePermissions } from '@/config/roles';
import { Button } from '@/components/ui/button';
import { useKeyboardInsetVar } from '@/hooks/useKeyboardInset';
import { useRole } from '@/hooks/useRole';
import { loadSession } from '@/features/auth/api';
import { authStore } from '@/lib/auth-store';
import { queryClient } from '@/lib/query-client';
import RouteError from '@/pages/route-error';

// Route-level code splitting
const OrdersPage = lazy(() => import('@/features/orders/orders-page'));
const OrderDetailsPage = lazy(() => import('@/features/orders/order-details-page'));
const AddOrderPage = lazy(() => import('@/features/orders/add-order-page'));
const EditOrderPage = lazy(() => import('@/features/orders/edit-order-page'));
const MastersPage = lazy(() => import('@/features/masters/masters-page'));
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
const WeaversPage = lazy(() => import('@/features/masters/weavers/weavers-page'));
const ReceiveGoodsPage = lazy(() => import('@/features/outside/receive-goods-page'));
const OutsidePoReceivePage = lazy(() => import('@/features/outside/outside-po-receive-page'));
const FgReceivePage = lazy(() => import('@/features/outside/fg-receive-page'));
const PoPrintPage = lazy(() => import('@/features/outside/po-print-page'));
const DamageDetailsPage = lazy(() => import('@/features/takas/damage-details-page'));
const QcHomePage = lazy(() => import('@/features/qc/qc-home-page'));
const QcTakaPage = lazy(() => import('@/features/butta-qc/qc-taka-page'));
const MillQcTakaPage = lazy(() => import('@/features/mill-qc/qc-taka-page'));
const GodownOrdersPage = lazy(() => import('@/features/godown/godown-orders-page'));
const GodownOrderPage = lazy(() => import('@/features/godown/godown-order-page'));
const SplitPage = lazy(() => import('@/features/godown/split-page'));
const InventoryPage = lazy(() => import('@/features/inventory/inventory-page'));
const InventoryItemDetailsPage = lazy(() => import('@/features/inventory/item-details-page'));
const DamagedDetailsPage = lazy(() => import('@/features/inventory/damaged-details-page'));
const DispatchPrintPage = lazy(() => import('@/features/dispatch/print-page'));
const DispatchedPage = lazy(() => import('@/features/dispatch/dispatched-page'));
const DispatchedOrderPage = lazy(() => import('@/features/dispatch/dispatched-order-page'));
const GoodsReturnPage = lazy(() => import('@/features/dispatch/goods-return-page'));
const UsersPage = lazy(() => import('@/features/masters/users/users-page'));
const YarnPartiesPage = lazy(() => import('@/features/masters/yarn/yarn-parties-page'));
const YarnQualitiesPage = lazy(() => import('@/features/masters/yarn/yarn-qualities-page'));
const TfoMachinesPage = lazy(() => import('@/features/masters/yarn/tfo-machines-page'));
const YarnPoListPage = lazy(() => import('@/features/yarn/po-list-page'));
const YarnPoDetailsPage = lazy(() => import('@/features/yarn/po-details-page'));
const YarnPoFormPage = lazy(() => import('@/features/yarn/po-form-page'));
const YarnReceivePage = lazy(() => import('@/features/yarn/receive-page'));
const YarnPoPrintPage = lazy(() => import('@/features/yarn/po-print-page'));
const LoginPage = lazy(() => import('@/features/auth/login-page'));
const NotFoundPage = lazy(() => import('@/pages/not-found-page'));

const guard = (permission: keyof RolePermissions | (keyof RolePermissions)[], element: ReactNode) => (
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
        path: '/print/dispatch-challan/:id',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canDispatch">
              <DispatchPrintPage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/print/outside-po/:id',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission={['canCreateOutsidePo', 'canReceiveOutside']}>
              <PoPrintPage />
            </RequirePermission>
          </Suspense>
        ),
      },
      // Sprint 17: Yarn PO full-screen forms + print.
      {
        path: '/yarn-po/new',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canManageYarnPo">
              <YarnPoFormPage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/yarn-po/:id/edit',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canManageYarnPo">
              <YarnPoFormPage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/yarn-po/:id/receive',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canReceiveYarn">
              <YarnReceivePage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/print/yarn-po/:id',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canManageYarnPo">
              <YarnPoPrintPage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/outside-pos/:id/receive',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canReceiveOutside">
              <OutsidePoReceivePage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        path: '/orders/:id/receive-fg',
        element: (
          <Suspense fallback={<PageSkeleton />}>
            <RequirePermission permission="canReceiveOutside">
              <FgReceivePage />
            </RequirePermission>
          </Suspense>
        ),
      },
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <LandingRedirect /> },
          // Logged-in users who open /login go to their landing page.
          { path: 'login', element: <LandingRedirect /> },
          { path: 'orders', element: guard(['canViewOrders', 'canViewProductionOrders', 'canViewGodownOrders'], <OrdersPage />) },
          { path: 'orders/:id', element: guard(['canViewOrders', 'canViewProductionOrders', 'canViewGodownOrders'], <OrderDetailsPage />) },
          { path: 'masters', element: guard('canViewMasters', <MastersPage />) },
          { path: 'customers', element: guard('canViewMasters', <CustomersPage />) },
          { path: 'materials', element: guard('canViewMasters', <MaterialsPage />) },
          { path: 'designs', element: guard('canViewMasters', <DesignsPage />) },
          { path: 'designs/:id', element: guard('canViewMasters', <DesignDetailPage />) },
          { path: 'machines', element: guard('canViewMasters', <MachinesPage />) },
          { path: 'damages', element: guard('canViewMasters', <DamagesPage />) },
          { path: 'orders/:orderId/takas/:takaId/damages', element: guard(['canEditTakas', 'canViewProductionOrders', 'canViewGodownOrders'], <DamageDetailsPage />) },
          { path: 'butta-parties', element: guard('canManageButtaParties', <PartiesPage kind="butta" />) },
          { path: 'mill-parties', element: guard('canManageMillParties', <PartiesPage kind="mill" />) },
          { path: 'weavers', element: guard('canManageWeavers', <WeaversPage />) },
          { path: 'receive-goods', element: guard('canReceiveOutside', <ReceiveGoodsPage />) },
          // Butta cutting + Mill modules (Jenish, Gaurang, Godown supervisor) and the Butta QC role.
          { path: 'butta', element: guard('canUseButtaModule', <ChallanModulePage kind="butta" />) },
          { path: 'butta/challans/:id', element: guard('canUseButtaModule', <ChallanDetailsPage kind="butta" />) },
          { path: 'mill', element: guard('canUseMillModule', <ChallanModulePage kind="mill" />) },
          { path: 'mill/challans/:id', element: guard('canUseMillModule', <ChallanDetailsPage kind="mill" />) },
          // One QC home for the QC role; the old home paths lead there.
          { path: 'qc', element: guard('canButtaQc', <QcHomePage />) },
          { path: 'butta-qc', element: <Navigate to="/qc" replace /> },
          { path: 'butta-qc/taka/:takaNo', element: guard('canButtaQc', <QcTakaPage />) },
          { path: 'mill-qc', element: <Navigate to="/qc" replace /> },
          { path: 'mill-qc/taka/:takaNo', element: guard('canMillQc', <MillQcTakaPage />) },
          // Godown Orders: final takas, split, ready to dispatch (Godown supervisor; Jenish / Gaurang may open it too).
          { path: 'godown/orders', element: guard('canUseGodownOrders', <GodownOrdersPage />) },
          { path: 'godown/orders/:orderId', element: guard('canUseGodownOrders', <GodownOrderPage />) },
          { path: 'godown/orders/:orderId/split/:takaId', element: guard('canUseGodownOrders', <SplitPage />) },
          { path: 'godown/orders/:orderId/takas/:takaId/damages', element: guard('canUseGodownOrders', <DamageDetailsPage />) },
          // Inventory (Jenish / Gaurang): design-wise pcs, damaged stock.
          { path: 'inventory', element: guard('canViewInventory', <InventoryPage />) },
          { path: 'inventory/items/:key', element: guard('canViewInventory', <InventoryItemDetailsPage />) },
          { path: 'inventory/damaged/:key', element: guard('canViewInventory', <DamagedDetailsPage />) },
          // Dispatch (Dhruvil; Jenish / Gaurang too): the Dispatched module and goods return.
          { path: 'dispatched', element: guard('canDispatch', <DispatchedPage />) },
          { path: 'dispatched/:orderId', element: guard('canDispatch', <DispatchedOrderPage />) },
          { path: 'dispatched/:orderId/challans/:challanId/gr', element: guard('canGoodsReturn', <GoodsReturnPage />) },
          { path: 'users', element: guard('canManageUsers', <UsersPage />) },
          // Sprint 17: Yarn PO (view: Jenish, Gaurang, both supervisors).
          { path: 'yarn-po', element: guard('canViewYarn', <YarnPoListPage />) },
          { path: 'yarn-po/:id', element: guard('canViewYarn', <YarnPoDetailsPage />) },
          // Sprint 17: yarn masters.
          { path: 'yarn-parties', element: guard('canManageYarnMasters', <YarnPartiesPage />) },
          { path: 'yarn-qualities', element: guard('canManageYarnMasters', <YarnQualitiesPage />) },
          { path: 'tfo-machines', element: guard('canManageYarnMasters', <TfoMachinesPage />) },
          { path: 'jobsheets', element: <JobsheetsRoute /> },
          // The supervisor's Order view: one order's jobsheets.
          { path: 'jobsheets/order/:orderId', element: guard('canViewJobsheetsModule', <SupervisorOrderJobsheetsPage />) },
          // Role-aware: Jenish / Gaurang get the full view, the supervisor his restricted one, Taka entry his entry screen.
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

/**
 * Login gate. Nobody logged in → the login screen on whatever URL was opened (the router mounts on the same URL after
 * login, so the user lands back where they were going — a QR link, a deep link…). A 401 anywhere brings it back.
 */
function AuthGate() {
  const auth = useSyncExternalStore(authStore.subscribe, authStore.get);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    void loadSession().then((r) => alive && setFailed(r === 'error'));
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (auth.status === 'in') return <RoleScopedRouter />;
  if (auth.status === 'out') {
    return (
      <Suspense fallback={<PageSkeleton />}>
        <LoginPage />
      </Suspense>
    );
  }
  if (failed) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-base font-semibold text-slate-900">Could not reach the server</p>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-[100dvh] items-center justify-center">
      <img src="/favicon.svg" alt="Rivoora Textile" className="size-12 animate-pulse" />
    </div>
  );
}

export default function App() {
  // Sprint 15: one place that keeps Save bars and modal footers above the on-screen keyboard.
  useKeyboardInsetVar();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <PageTitleProvider>
          <AuthGate />
          <Toaster position="top-center" richColors closeButton toastOptions={{ className: 'font-sans' }} />
        </PageTitleProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
