import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  getSubStage,
  isDamageType,
  isMainStageKey,
  isSubStageKey,
  type DamageType,
  type MainStageKey,
  type SubStageKey,
} from '@rivoora/shared';

export const ORDER_TABS = ['dashboard', 'jobsheets', 'outside', 'takas', 'damages', 'details', 'history', 'docs'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

const isTab = (v: string | null): v is OrderTab => v !== null && (ORDER_TABS as readonly string[]).includes(v);

export const HISTORY_VIEWS = ['overview', 'detailed'] as const;
export type HistoryView = (typeof HISTORY_VIEWS)[number];

type Patch = Partial<Record<'tab' | 'stage' | 'sub' | 'type' | 'hview', string | null>>;

/**
 * Order details view state, kept in the URL (`?tab=dashboard&stage=production&sub=on_loom`, `?tab=damages&type=machine`)
 * so opening a jobsheet and pressing Back returns to the same view. Updates replace the history entry.
 * `stage` is null when the URL has none (the dashboard then uses its default stage).
 */
export function useOrderView() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: OrderTab = isTab(rawTab) ? rawTab : 'dashboard';
  const rawSub = params.get('sub');
  const sub: SubStageKey | null = isSubStageKey(rawSub) ? rawSub : null;
  const rawStage = params.get('stage');
  const stage: MainStageKey | null = isMainStageKey(rawStage) ? rawStage : sub ? getSubStage(sub).mainStage : null;
  const rawType = params.get('type');
  const damageType: DamageType | null = isDamageType(rawType) ? rawType : null;

  const rawHView = params.get('hview');
  const historyView: HistoryView = rawHView === 'detailed' ? 'detailed' : 'overview';

  const update = useCallback(
    (patch: Patch) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === undefined) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return {
    tab,
    /** False when the URL has no (valid) tab — the page then picks its default. */
    tabInUrl: isTab(rawTab),
    stage,
    /** Only a sub-stage of the selected main stage counts. */
    sub: sub && (!stage || getSubStage(sub).mainStage === stage) ? sub : null,
    damageType,
    /** History tab: Overview (main steps, default) or Detailed (every status change). */
    historyView,
    setHistoryView: (v: HistoryView) => update({ hview: v === 'overview' ? null : v }),
    setTab: (t: OrderTab) => update({ tab: t, ...(t !== 'damages' ? { type: null } : {}) }),
    selectStage: (s: MainStageKey) => update({ tab: 'dashboard', stage: s, sub: null }),
    /** Clicking the open sub-stage again closes the panel. */
    toggleSub: (s: SubStageKey) => update({ tab: 'dashboard', stage: getSubStage(s).mainStage, sub: sub === s ? null : s }),
    openDamages: (type: DamageType | null) => update({ tab: 'damages', type }),
    setDamageType: (type: DamageType | null) => update({ type }),
  };
}

export type OrderView = ReturnType<typeof useOrderView>;
