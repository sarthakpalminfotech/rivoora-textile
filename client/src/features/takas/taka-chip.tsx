import { AlertTriangle, Check, CheckCircle2 } from 'lucide-react';
import {
  challanLabel,
  damageLabelOf,
  damageResolvedText,
  formatMeters,
  formatPcs,
  hasOpenDamage,
  isFreshAfterDamage,
  takaStageColour,
  takaActualPcs,
  takaStageLabel,
  type Taka,
} from '@rivoora/shared';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FreeStockTag, FromOrderTag, InOrderTag, ReButtaTag, ReturnLotTag, ReturnedTag } from './taka-tags';

type ChipTaka = Pick<Taka, 'takaNo' | 'meters' | 'pcs' | 'damages'> &
  Partial<
    Pick<
      Taka,
      | 'stage'
      | 'challanNo'
      | 'challanKind'
      | 'actualPcs'
      | 'refinishCount'
      | 'parentTakaNo'
      | 'godownCheckedAt'
      | 'reworkCount'
      | 'isReturnLot'
      | 'returnedAt'
      | 'originOrderNo'
      | 'isFreeStock'
      | 'allocatedOrderNo'
      | 'weaverTakaNo'
    >
  >;

/** Selection mode (send back): a tick box in front of the chip; `disabledReason` greys the chip out (shown as a tooltip). */
export interface TakaChipSelect {
  selected: boolean;
  disabledReason: string | null;
  onToggle: () => void;
}

/** A small colour dot for a taka's stage (colour from the pipeline config) with the stage label as its tooltip. */
export function StageDot({ stage, className }: { stage: string; className?: string }) {
  return (
    <Tooltip content={takaStageLabel(stage)}>
      <span
        role="img"
        aria-label={takaStageLabel(stage)}
        className={cn('inline-block size-2.5 shrink-0 rounded-full ring-2 ring-white', className)}
        style={{ backgroundColor: takaStageColour(stage) }}
      />
    </Tooltip>
  );
}

/** Pink "Refinish ×2" tag: the taka is marked for refinish (stage `refinish`) or went through refinishing before. */
export function RefinishTag({ count, active }: { count: number; active?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-bold',
        active ? 'bg-pink-100 text-pink-700' : 'bg-slate-100 text-slate-500',
      )}
    >
      Refinish{count > 1 ? ` ×${count}` : ''}
    </span>
  );
}

/** Green "Fresh" tag — shown when every damage of the taka was resolved. */
export function FreshTag({ bilingual }: { bilingual?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[12px] font-bold text-green-800">
      <CheckCircle2 className="size-3" aria-hidden />
      Fresh
      {bilingual && (
        <span lang="hi" className="font-semibold">
          · ठीक
        </span>
      )}
    </span>
  );
}

/**
 * The damage lines of a taka: an open damage in red ("Machine damage · Hole · 2 pcs"), a resolved one in grey,
 * struck through, with "Resolved at butta QC".
 */
export function TakaDamageLines({ damages, className }: { damages: Taka['damages']; className?: string }) {
  if (!damages.length) return null;
  return (
    <ul className={cn('basis-full space-y-0.5', className)}>
      {damages.map((d) => {
        const resolved = damageResolvedText(d);
        return (
          <li
            key={d.id}
            className={cn('flex flex-wrap items-center gap-x-1.5 text-[12px] font-semibold leading-snug', resolved ? 'text-slate-400' : 'text-red-600')}
          >
            {!resolved && <AlertTriangle className="size-3 shrink-0" aria-hidden />}
            <span className={cn(resolved && 'line-through')}>{damageLabelOf(d)}</span>
            {resolved && <span className="font-medium">· {resolved}</span>}
          </li>
        );
      })}
    </ul>
  );
}

interface TakaChipProps {
  taka: ChipTaka;
  /** `lg` = the big chips of the Taka entry screen. */
  size?: 'md' | 'lg';
  /** Show the stage dot (Takas tab). */
  showStage?: boolean;
  /** Show the challan number (item drawers of at butta cutting / QC pending takas). */
  showChallan?: boolean;
  bilingual?: boolean;
  onClick?: () => void;
  /** Selection mode: the chip becomes a tick-box row instead of opening the drawer. */
  select?: TakaChipSelect;
  className?: string;
}

/**
 * Taka chip: "6245 · 105.5 m · 12 pcs". Open damages make it red and list each damage; a taka whose damages are all
 * resolved shows a green "Fresh" tag and its resolved damages in grey. Clickable when `onClick` is given.
 */
export function TakaChip({ taka, size = 'md', showStage, showChallan, bilingual, onClick, select, className }: TakaChipProps) {
  const damaged = hasOpenDamage(taka.damages);
  const fresh = isFreshAfterDamage(taka.damages);
  const lg = size === 'lg';
  const sub = cn(lg ? 'text-[15px]' : 'text-[13px]', 'font-semibold', damaged ? 'text-red-600' : 'text-slate-500');
  const body = (
    <>
      <span className="flex flex-wrap items-center gap-x-1.5">
        {showStage && taka.stage && <StageDot stage={taka.stage} />}
        {damaged && <AlertTriangle className={cn('shrink-0', lg ? 'size-4' : 'size-3.5')} aria-hidden />}
        {taka.takaNo}
        {taka.weaverTakaNo && <span className="text-[12px] font-medium text-slate-400">W {taka.weaverTakaNo}</span>}
        {taka.parentTakaNo && <span className="text-[12px] font-medium text-slate-400">from {taka.parentTakaNo}</span>}
        {taka.meters != null && <span className={sub}>· {formatMeters(taka.meters)}</span>}
        <span className={sub}>
          · {takaActualPcs(taka) != null ? formatPcs(takaActualPcs(taka)!) : '— pcs'}
        </span>
        {fresh && <FreshTag bilingual={bilingual} />}
        {(taka.refinishCount ?? 0) > 0 && <RefinishTag count={taka.refinishCount!} active={taka.stage === 'refinish'} />}
        {(taka.reworkCount ?? 0) > 0 && <ReButtaTag count={taka.reworkCount!} />}
        {taka.isReturnLot ? <ReturnLotTag /> : taka.returnedAt ? <ReturnedTag /> : null}
        {taka.originOrderNo != null && <FromOrderTag orderNo={taka.originOrderNo} />}
        {taka.isFreeStock && <FreeStockTag />}
        {taka.allocatedOrderNo != null && <InOrderTag orderNo={taka.allocatedOrderNo} />}
        {taka.godownCheckedAt && taka.stage !== 'ready_dispatch' && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-green-50 px-1.5 py-0.5 text-[11px] font-bold text-green-700" title="Checked by the godown">
            <CheckCircle2 className="size-3" aria-hidden /> Checked
          </span>
        )}
        {taka.stage === 'ready_dispatch' && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
            <CheckCircle2 className="size-3" aria-hidden /> Ready to dispatch
          </span>
        )}
        {showChallan && taka.challanNo != null && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-bold text-amber-800">{challanLabel(taka.challanNo, taka.challanKind ?? 'butta')}</span>
        )}
      </span>
      <TakaDamageLines damages={taka.damages} />
    </>
  );
  const chip = cn(
    'inline-flex max-w-full flex-wrap items-center gap-x-1.5 border text-left font-bold tabular-nums',
    lg ? 'min-h-10 rounded-2xl px-3.5 py-1 text-lg' : 'min-h-8 rounded-2xl px-3 py-0.5 text-[15px]',
    damaged ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-slate-50 text-slate-800',
    className,
  );
  if (select) {
    const off = select.disabledReason !== null;
    const row = (
      <button
        type="button"
        disabled={off}
        onClick={select.onToggle}
        role="checkbox"
        aria-checked={select.selected}
        aria-label={`Select taka ${taka.takaNo}`}
        className={cn(
          chip,
          'flex-row items-start gap-2.5 transition-colors focus-visible:ring-2 focus-visible:ring-primary/40',
          select.selected && 'border-primary bg-primary-soft',
          off && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border-2',
            select.selected ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white text-transparent',
          )}
        >
          <Check className="size-4" strokeWidth={3} />
        </span>
        <span className="flex min-w-0 flex-col items-start">{body}</span>
      </button>
    );
    return <li className="max-w-full">{off ? <Tooltip content={select.disabledReason}><span className="inline-block max-w-full">{row}</span></Tooltip> : row}</li>;
  }
  return (
    <li className="max-w-full">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(chip, 'flex-col items-start gap-0 transition-colors hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/40')}
          aria-label={`Taka ${taka.takaNo} details`}
        >
          {body}
        </button>
      ) : (
        <span className={cn(chip, 'flex-col items-start gap-0')}>{body}</span>
      )}
    </li>
  );
}
