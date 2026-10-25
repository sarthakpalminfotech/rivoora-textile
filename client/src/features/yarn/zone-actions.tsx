import { useRef } from 'react';
import type { YarnZone } from '@rivoora/shared';
import { useTfoBoard } from './api';
import { TransferDialog, WithdrawDialog } from './stock-dialogs';
import { AssignProgramDialog } from './tfo-board';
import { StartWarpingDialog } from './warping';

/** The two buttons of every zone: Transfer, and Withdraw / Run program / Start warping. */
export type ZoneAction = { kind: 'transfer' | 'withdraw' | 'program' | 'warping'; zone: YarnZone };

function RunProgram({ open, onClose }: { open: boolean; onClose: () => void }) {
  const board = useTfoBoard();
  return <AssignProgramDialog open={open} onOpenChange={(o) => !o && onClose()} target={null} board={board.data} />;
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
      {action?.kind === 'program' && <RunProgram open onClose={onClose} />}
      <StartWarpingDialog open={action?.kind === 'warping'} onOpenChange={(o) => !o && onClose()} />
    </>
  );
}
