import { useRef } from 'react';
import type { RolePermissions, YarnZone } from '@rivoora/shared';
import { TransferDialog, WithdrawDialog } from './stock-dialogs';
import { CreateProgramsDialog } from './tfo-board';
import { StartWarpingDialog } from './warping';

/** The two buttons of every zone: Transfer, and Withdraw / New programs / Start warping. */
export type ZoneAction = { kind: 'transfer' | 'withdraw' | 'program' | 'warping'; zone: YarnZone };

/** The zone's second action. Sprint 20: new TFO programs are created by the owners only (`canPlanYarn`). */
export function zoneMainAction(zone: YarnZone, can: (p: keyof RolePermissions) => boolean): ZoneAction['kind'] | null {
  if (zone === 'direct') return 'withdraw';
  if (zone === 'tfo') return can('canPlanYarn') ? 'program' : null;
  return 'warping';
}

/** Opens the dialog of a zone action (zone panels on /yarn and the zone screen header). */
export function ZoneActionDialogs({ action, onClose }: { action: ZoneAction | null; onClose: () => void }) {
  // Keep the last zone while a dialog animates closed.
  const lastZone = useRef<YarnZone>('direct');
  if (action) lastZone.current = action.zone;
  return (
    <>
      <TransferDialog open={action?.kind === 'transfer'} onOpenChange={(o) => !o && onClose()} from={lastZone.current} />
      <WithdrawDialog open={action?.kind === 'withdraw'} onOpenChange={(o) => !o && onClose()} />
      <CreateProgramsDialog open={action?.kind === 'program'} onOpenChange={(o) => !o && onClose()} />
      <StartWarpingDialog open={action?.kind === 'warping'} onOpenChange={(o) => !o && onClose()} />
    </>
  );
}
