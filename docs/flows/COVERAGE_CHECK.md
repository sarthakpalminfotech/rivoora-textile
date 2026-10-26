# Rivoora Textile — Coverage Check

Proof that the flow inventory skipped nothing. Every list below was **produced mechanically** from the code (commit
`b4fd6be`) by the scripts in the Appendix, and every item is mapped to an operation in `FLOW_INVENTORY.md` or a
section of `STATE_MACHINES.md` / `ROLE_MATRIX.md`. The script fails an item as **UNMAPPED** / **MISSING** if it
has no mapping, or if the mapped operation ID does not exist in `FLOW_INVENTORY.md`.

**Result of the last run: 217 server routes, 65 client routes (+ the index route) and every config value — all
mapped ("All items mapped.").**

## How it was produced

```bash
# repo root; save the three Appendix scripts into one folder <dir>
node <dir>/routes.mjs .                 # A: every server route (method, full path, permission gate) — 217 routes
npx tsx <dir>/coverage.mts .            # A + B + C below; prints "All items mapped." or the list of misses on stderr
npx tsx <dir>/roles-matrix.mts .        # ROLE_MATRIX §1 and §3 (permissions, landing, nav, statuses per role)
```

Sources read by the scripts: `server/src/index.ts` (router mounts), `server/src/routes/*.ts` (every
`.get/.post/.put/.patch/.delete` and `requirePermission` gate), `client/src/App.tsx` (every `path:`),
`shared/src/pipeline.ts`, `statuses.ts`, `challans.ts`, `roles.ts`, `freeStock.ts`, `outside.ts`, `yarn.ts`,
`orderSteps.ts`, `types.ts` (taka / jobsheet event kinds), `server/src/db/schema.ts` (order / hold event types),
`client/src/components/layout/nav-items.ts`.

Cross-checks done by hand with grep (results are in `FLOW_INVENTORY.md` / `GAPS_AND_QUESTIONS.md`):

```bash
grep -rhoE "api\.(get|post|put|patch|delete)<[^>]*>?\(\s*[`'][^`']+" client/src   # which endpoints a screen calls
grep -rn "conflict(\|badRequest(" server/src/services                             # every precondition / block message
grep -n "WRITE_RULES\|READ_MESSAGE_RULES\|READ_HIDDEN_RULES" server/src/middleware/hold-guard.ts
grep -rni "coming soon" client/src                                               # placeholders
```

---

## A. Every server route → operation

Gate = the router-level `requirePermission` (any one is enough) · the route's own permission. `manage` / `run` /
`view` / `receive` / `createPermission` are local constants in the route file (`canManage…`, `canRunJobsheets`,
`canViewYarn`, `canReceiveOutside`; for yarn masters: `canManageYarnMasters`, POST also `canManageYarnPo`).
Every route except `/api/health` and `/api/auth/login|logout` also needs a session; writes also pass the hold guard (GRD).
The challan and party routers are one factory mounted twice, so their gate shows both permissions: `/api/butta…` /
`/api/butta-parties` use the first, `/api/mill…` / `/api/mill-parties` the second.

| # | Method | Path | Permission gate (router · route) | Operation(s) |
|---|---|---|---|---|
| 1 | POST | `/api/auth/login` |  ·  | AUTH-01 |
| 2 | POST | `/api/auth/logout` |  ·  | AUTH-03 |
| 3 | GET | `/api/auth/me` |  ·  | AUTH-02 |
| 4 | GET | `/api/butta-parties` | canManageButtaParties / canManageMillParties ·  | PTY-01 |
| 5 | POST | `/api/butta-parties` | canManageButtaParties / canManageMillParties ·  | PTY-02 |
| 6 | GET | `/api/butta-parties/:id` | canManageButtaParties / canManageMillParties ·  | PTY-05 |
| 7 | PUT | `/api/butta-parties/:id` | canManageButtaParties / canManageMillParties ·  | PTY-03 |
| 8 | DELETE | `/api/butta-parties/:id` | canManageButtaParties / canManageMillParties ·  | PTY-04 |
| 9 | POST | `/api/butta-qc/:takaId` | canButtaQc ·  | QC-02 |
| 10 | GET | `/api/butta-qc/pending` | canButtaQc ·  | QC-04 |
| 11 | POST | `/api/butta/challans` | canUseButtaModule / canUseMillModule ·  | BUT-03 |
| 12 | GET | `/api/butta/challans` | canUseButtaModule / canUseMillModule ·  | BUT-04 |
| 13 | GET | `/api/butta/challans/:id` | canUseButtaModule / canUseMillModule ·  | BUT-05 |
| 14 | POST | `/api/butta/challans/:id/cancel` | canUseButtaModule / canUseMillModule · canCancelChallan | BUT-10 |
| 15 | GET | `/api/butta/challans/:id/print` | canUseButtaModule / canUseMillModule ·  | BUT-06, PRN-02 |
| 16 | POST | `/api/butta/challans/:id/received-count` | canUseButtaModule / canUseMillModule ·  | MIL-07 (mill only; butta answers 400) |
| 17 | GET | `/api/butta/counts` | canUseButtaModule / canUseMillModule ·  | BUT-01 |
| 18 | GET | `/api/butta/pending-orders` | canUseButtaModule / canUseMillModule ·  | BUT-01 |
| 19 | GET | `/api/butta/pending-orders/:orderId/takas` | canUseButtaModule / canUseMillModule ·  | BUT-02 |
| 20 | POST | `/api/butta/receive` | canUseButtaModule / canUseMillModule ·  | BUT-07, BUT-08 |
| 21 | POST | `/api/butta/receive/:takaId/undo` | canUseButtaModule / canUseMillModule ·  | BUT-09 |
| 22 | GET | `/api/customers` | canViewMasters ·  | CUS-01 |
| 23 | POST | `/api/customers` | canViewMasters · canManageMasters, canAddOrder | CUS-02 |
| 24 | GET | `/api/customers/:id` | canViewMasters ·  | CUS-06 |
| 25 | PUT | `/api/customers/:id` | canViewMasters · manage | CUS-03 |
| 26 | DELETE | `/api/customers/:id` | canViewMasters · manage | CUS-04 |
| 27 | GET | `/api/customers/:id/previous-designs` | canViewMasters ·  | CUS-05 |
| 28 | GET | `/api/damages` | canViewMasters ·  | DMG-01 |
| 29 | POST | `/api/damages` | canViewMasters · manage | DMG-02 |
| 30 | GET | `/api/damages/:id` | canViewMasters ·  | DMG-06 |
| 31 | PUT | `/api/damages/:id` | canViewMasters · manage | DMG-03 |
| 32 | DELETE | `/api/damages/:id` | canViewMasters · manage | DMG-04 |
| 33 | GET | `/api/designs` | canViewDesignLibrary ·  | DES-02 |
| 34 | POST | `/api/designs` | canViewDesignLibrary · manage | DES-04 |
| 35 | GET | `/api/designs/:id` | canViewDesignLibrary ·  | DES-03 |
| 36 | PUT | `/api/designs/:id` | canViewDesignLibrary · manage | DES-05 |
| 37 | DELETE | `/api/designs/:id` | canViewDesignLibrary · manage | DES-06 |
| 38 | POST | `/api/designs/bulk` | canViewDesignLibrary · manage | DES-07 |
| 39 | GET | `/api/designs/check-code` | canViewDesignLibrary ·  | DES-08 |
| 40 | GET | `/api/designs/check-codes` | canViewDesignLibrary ·  | DES-07 |
| 41 | GET | `/api/designs/qualities` | canViewDesignLibrary ·  | DES-01 |
| 42 | GET | `/api/dispatch/challans/:id` | canDispatch ·  | DSP-02, PRN-04 |
| 43 | POST | `/api/dispatch/challans/:id/goods-return` | canDispatch · canGoodsReturn | DSP-05, DSP-06 |
| 44 | GET | `/api/dispatch/challans/:id/print` | canDispatch ·  | DSP-07 |
| 45 | GET | `/api/dispatched` | canDispatch ·  | DSP-03 |
| 46 | GET | `/api/dispatched/:orderId` | canDispatch ·  | DSP-04 |
| 47 | GET | `/api/godown/orders` | canUseGodownOrders ·  | GD-01 |
| 48 | GET | `/api/godown/orders/:orderId` | canUseGodownOrders ·  | GD-02 |
| 49 | GET | `/api/godown/orders/:orderId/damages` | canUseGodownOrders ·  | GD-10 |
| 50 | POST | `/api/godown/orders/:orderId/dispatch` | canUseGodownOrders · canDispatch | DSP-01 |
| 51 | POST | `/api/godown/orders/:orderId/ready-dispatch` | canUseGodownOrders ·  | GD-09 |
| 52 | PATCH | `/api/godown/takas/:id` | canUseGodownOrders ·  | GD-03, GD-04 |
| 53 | POST | `/api/godown/takas/:id/damage` | canUseGodownOrders ·  | GD-06 |
| 54 | POST | `/api/godown/takas/:id/refinish` | canUseGodownOrders ·  | GD-08 |
| 55 | POST | `/api/godown/takas/:id/resolve` | canUseGodownOrders ·  | GD-07 |
| 56 | POST | `/api/godown/takas/:id/split` | canUseGodownOrders ·  | GD-05 |
| 57 | GET | `/api/godown/takas/:id/split-damages` | canUseGodownOrders ·  | GD-05 |
| 58 | GET | `/api/health` |  ·  | AUTH-06 |
| 59 | GET | `/api/inventory/damaged` | canViewInventory ·  | INV-04 |
| 60 | GET | `/api/inventory/damaged/:key` | canViewInventory ·  | INV-05 |
| 61 | GET | `/api/inventory/damaged/:key/takas` | canViewInventory ·  | INV-05 |
| 62 | GET | `/api/inventory/items` | canViewInventory ·  | INV-02 |
| 63 | GET | `/api/inventory/items/:key` | canViewInventory ·  | INV-03, INV-06, ORD-03 |
| 64 | GET | `/api/inventory/items/:key/assign-targets` | canViewInventory · canMoveToInventory | FS-03 |
| 65 | GET | `/api/inventory/items/:key/free-stock` |  · canViewInventory, canMoveToInventory | FS-02, INV-03 |
| 66 | GET | `/api/inventory/items/:key/orders` | canViewInventory ·  | INV-03, INV-06, ORD-03 |
| 67 | GET | `/api/inventory/summary` | canViewInventory ·  | INV-01 |
| 68 | POST | `/api/inventory/takas/:id/mark-fresh` | canViewInventory · canMarkFresh | FS-04 |
| 69 | GET | `/api/jobsheets` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · canViewJobsheetsModule | SUP-01, SUP-02 |
| 70 | GET | `/api/jobsheets/:id` | canViewOrders, canViewJobsheetsModule, canUseTakaModules ·  | JS-08 |
| 71 | PUT | `/api/jobsheets/:id` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · manage | JS-03 |
| 72 | DELETE | `/api/jobsheets/:id` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · manage | JS-04 |
| 73 | POST | `/api/jobsheets/:id/change-machine` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · run | SUP-05 |
| 74 | POST | `/api/jobsheets/:id/complete` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · run | SUP-04 |
| 75 | POST | `/api/jobsheets/:id/pull-back` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · manage | JS-06 |
| 76 | POST | `/api/jobsheets/:id/start` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · run | SUP-03 |
| 77 | PUT | `/api/jobsheets/:id/takas` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · canEditTakas | ET-01, ET-02 |
| 78 | POST | `/api/jobsheets/:id/takas` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · canEnterTakas | TE-04 |
| 79 | GET | `/api/jobsheets/by-no/:no` | canViewOrders, canViewJobsheetsModule, canUseTakaModules ·  | TE-01, TE-02 |
| 80 | GET | `/api/jobsheets/orders` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · canViewJobsheetsModule | SUP-02 |
| 81 | GET | `/api/jobsheets/print` | canViewOrders, canViewJobsheetsModule, canUseTakaModules · canPrintJobsheets | JS-07, PRN-01 |
| 82 | GET | `/api/lookup/butta-parties` |  · canManageButtaParties, canUseButtaModule | LKP |
| 83 | GET | `/api/lookup/customers` |  · canViewMasters | LKP |
| 84 | GET | `/api/lookup/customers/:id/brokers` |  · canViewMasters | LKP |
| 85 | GET | `/api/lookup/damages` |  · canViewMasters, canEnterTakas, canEditTakas, canButtaQc, canMillQc, canUseGodownOrders, canReceiveOutside | LKP |
| 86 | GET | `/api/lookup/machines` |  · canViewMasters, canRunJobsheets, canUseButtaModule, canUseMillModule | LKP |
| 87 | GET | `/api/lookup/materials` |  · canViewMasters, canViewProductionOrders, canUseButtaModule, canUseMillModule, canCreateOutsidePo | LKP |
| 88 | GET | `/api/lookup/mill-parties` |  · canManageMillParties, canUseMillModule | LKP |
| 89 | GET | `/api/lookup/weavers` |  · canManageWeavers, canCreateOutsidePo, canReceiveOutside | LKP |
| 90 | GET | `/api/lookup/yarn-parties` |  · canManageYarnMasters, canManageYarnPo, canViewYarn | LKP |
| 91 | GET | `/api/lookup/yarn-qualities` |  · canManageYarnMasters, canManageYarnPo, canUseYarnInventory, canReceiveYarn, canViewYarn | LKP |
| 92 | GET | `/api/machine-view` |  · canViewMachineView | MV-01 |
| 93 | GET | `/api/machines` | canViewMasters ·  | MAC-01 |
| 94 | POST | `/api/machines` | canViewMasters · manage | MAC-02 |
| 95 | GET | `/api/machines/:id` | canViewMasters ·  | MAC-05 |
| 96 | PUT | `/api/machines/:id` | canViewMasters · manage | MAC-03 |
| 97 | DELETE | `/api/machines/:id` | canViewMasters · manage | MAC-04 |
| 98 | GET | `/api/materials` | canViewMasters ·  | MAT-01 |
| 99 | POST | `/api/materials` | canViewMasters · manage | MAT-02 |
| 100 | GET | `/api/materials/:id` | canViewMasters ·  | MAT-05 |
| 101 | PUT | `/api/materials/:id` | canViewMasters · manage | MAT-03 |
| 102 | DELETE | `/api/materials/:id` | canViewMasters · manage | MAT-04 |
| 103 | GET | `/api/mill-parties` | canManageButtaParties / canManageMillParties ·  | PTY-01 |
| 104 | POST | `/api/mill-parties` | canManageButtaParties / canManageMillParties ·  | PTY-02 |
| 105 | GET | `/api/mill-parties/:id` | canManageButtaParties / canManageMillParties ·  | PTY-05 |
| 106 | PUT | `/api/mill-parties/:id` | canManageButtaParties / canManageMillParties ·  | PTY-03 |
| 107 | DELETE | `/api/mill-parties/:id` | canManageButtaParties / canManageMillParties ·  | PTY-04 |
| 108 | POST | `/api/mill-qc/:takaId` | canMillQc ·  | QC-03 |
| 109 | GET | `/api/mill-qc/pending` | canMillQc ·  | QC-04 |
| 110 | GET | `/api/mill-qc/taka/:no` | canMillQc ·  | QC-03 |
| 111 | POST | `/api/mill/challans` | canUseButtaModule / canUseMillModule ·  | MIL-03 |
| 112 | GET | `/api/mill/challans` | canUseButtaModule / canUseMillModule ·  | MIL-04 |
| 113 | GET | `/api/mill/challans/:id` | canUseButtaModule / canUseMillModule ·  | MIL-05 |
| 114 | POST | `/api/mill/challans/:id/cancel` | canUseButtaModule / canUseMillModule · canCancelChallan | MIL-08 |
| 115 | GET | `/api/mill/challans/:id/print` | canUseButtaModule / canUseMillModule ·  | MIL-06, PRN-03 |
| 116 | POST | `/api/mill/challans/:id/received-count` | canUseButtaModule / canUseMillModule ·  | MIL-07 |
| 117 | GET | `/api/mill/counts` | canUseButtaModule / canUseMillModule ·  | MIL-01 |
| 118 | GET | `/api/mill/pending-orders` | canUseButtaModule / canUseMillModule ·  | MIL-01 |
| 119 | GET | `/api/mill/pending-orders/:orderId/takas` | canUseButtaModule / canUseMillModule ·  | MIL-01 |
| 120 | POST | `/api/mill/receive` | canUseButtaModule / canUseMillModule ·  | MIL-09 |
| 121 | POST | `/api/mill/receive/:takaId/undo` | canUseButtaModule / canUseMillModule ·  | MIL-09 |
| 122 | GET | `/api/mill/refinish-orders` | canUseButtaModule / canUseMillModule ·  | MIL-02 |
| 123 | GET | `/api/mill/refinish-orders/:orderId/takas` | canUseButtaModule / canUseMillModule ·  | MIL-02 |
| 124 | GET | `/api/orders` | canViewOrders, canViewProductionOrders, canViewGodownOrders ·  | ORD-01 |
| 125 | POST | `/api/orders` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canAddOrder | ORD-02 |
| 126 | GET | `/api/orders/:id` | canViewOrders, canViewProductionOrders, canViewGodownOrders ·  | ODT-01, ODT-08, ODT-09 |
| 127 | PUT | `/api/orders/:id` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canEditOrder | ORD-04, ORD-05 |
| 128 | GET | `/api/orders/:id/challans` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canViewTakas | ODT-10 |
| 129 | POST | `/api/orders/:id/close` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canCloseOrder | HLD-04 |
| 130 | GET | `/api/orders/:id/close-preview` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canCloseOrder | HLD-03 |
| 131 | GET | `/api/orders/:id/damages` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canViewTakas | ODT-07 |
| 132 | GET | `/api/orders/:id/dashboard` | canViewOrders, canViewProductionOrders, canViewGodownOrders ·  | ODT-02 |
| 133 | GET | `/api/orders/:id/dashboard/items` | canViewOrders, canViewProductionOrders, canViewGodownOrders ·  | ODT-03 |
| 134 | GET | `/api/orders/:id/fg-receipt-form` |  · canReceiveOutside | FG-01, FG-02 |
| 135 | POST | `/api/orders/:id/fg-receipts` |  · canReceiveOutside | FG-01, FG-02 |
| 136 | POST | `/api/orders/:id/hold` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canHoldOrder | HLD-01 |
| 137 | POST | `/api/orders/:id/jobsheets` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canManageJobsheets | JS-02 |
| 138 | GET | `/api/orders/:id/jobsheets` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canViewOrders, canViewProductionOrders | ODT-04, JS-09 |
| 139 | POST | `/api/orders/:id/jobsheets/generate` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canManageJobsheets | JS-01 |
| 140 | POST | `/api/orders/:id/jobsheets/send` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canManageJobsheets | JS-05 |
| 141 | GET | `/api/orders/:id/milestones` | canViewOrders, canViewProductionOrders, canViewGodownOrders ·  | ODT-09 |
| 142 | GET | `/api/orders/:id/outside-pos` |  · canCreateOutsidePo | ODT-05 |
| 143 | POST | `/api/orders/:id/outside-pos` |  · canCreateOutsidePo | OUT-01 |
| 144 | POST | `/api/orders/:id/release` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canHoldOrder | HLD-02 |
| 145 | PUT | `/api/orders/:id/steps` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canEditOrderSteps | ORD-05 |
| 146 | GET | `/api/orders/:id/takas` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canViewTakas | ODT-06 |
| 147 | POST | `/api/orders/:id/takas/add-from-free-stock` |  · canMoveToInventory | FS-02, FS-03 |
| 148 | POST | `/api/orders/:id/takas/move-to-inventory` |  · canMoveToInventory | FS-01 |
| 149 | POST | `/api/orders/:id/takas/send-back` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canReworkTakas | RW-01, RW-02 |
| 150 | POST | `/api/orders/:id/undo-production` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canUndoProduction | ORD-07 |
| 151 | POST | `/api/orders/send-to-production` | canViewOrders, canViewProductionOrders, canViewGodownOrders · canSendToProduction | ORD-06 |
| 152 | GET | `/api/outside-pos/:id` |  · canCreateOutsidePo, canReceiveOutside | OUT-08 |
| 153 | PUT | `/api/outside-pos/:id` |  · manage | OUT-02 |
| 154 | POST | `/api/outside-pos/:id/cancel` |  · manage | OUT-03 |
| 155 | POST | `/api/outside-pos/:id/close` |  · manage | OUT-04 |
| 156 | GET | `/api/outside-pos/:id/print` |  · canCreateOutsidePo, canReceiveOutside | OUT-05, PRN-05 |
| 157 | GET | `/api/outside-pos/:id/receipt-form` |  · receive | OUT-06 |
| 158 | POST | `/api/outside-pos/:id/receipts` |  · receive | OUT-06 |
| 159 | GET | `/api/receive-goods` | canReceiveOutside ·  | OUT-07 |
| 160 | GET | `/api/taka/jobsheets` | canUseTakaModules ·  | TE-03 |
| 161 | GET | `/api/takas/:id` |  · canEditTakas, canViewProductionOrders, canViewGodownOrders | TKD-01 |
| 162 | GET | `/api/takas/:id/damages` |  · canEditTakas, canUseGodownOrders, canViewProductionOrders, canViewGodownOrders | TKD-02 |
| 163 | GET | `/api/takas/by-no/:no` |  · canUseButtaModule, canButtaQc, canEditTakas, canMillQc, canUseGodownOrders | QC-01, TKD-04 |
| 164 | GET | `/api/takas/check` |  · canEnterTakas, canEditTakas, canReceiveOutside | ET-03 |
| 165 | GET | `/api/takas/lookup` |  · canUseButtaModule, canUseMillModule, canButtaQc, canMillQc, canEditTakas, canUseGodownOrders, canReceiveOutside, canDispatch | TKD-05 |
| 166 | GET | `/api/takas/next-numbers` |  · canEnterTakas, canReceiveOutside | TE-05, OUT-06 |
| 167 | POST | `/api/tfo-machines` |  · createPermission | YM-03 |
| 168 | GET | `/api/tfo-machines` |  · manage | YM-03 |
| 169 | GET | `/api/tfo-machines/:id` |  · manage | YM-03 |
| 170 | PUT | `/api/tfo-machines/:id` |  · manage | YM-03 |
| 171 | DELETE | `/api/tfo-machines/:id` |  · manage | YM-03 |
| 172 | POST | `/api/uploads` |  · canManageMasters, canManageDesigns, canAddOrder, canEditOrder, canButtaQc, canMillQc, canGoodsReturn, canReceiveOutside | UPL-01 |
| 173 | GET | `/api/users` | canManageUsers ·  | USR-01 |
| 174 | POST | `/api/users` | canManageUsers ·  | USR-02 |
| 175 | GET | `/api/users/:id` | canManageUsers ·  | USR-05 |
| 176 | PUT | `/api/users/:id` | canManageUsers ·  | USR-03 |
| 177 | POST | `/api/users/:id/reset-password` | canManageUsers ·  | USR-04 |
| 178 | GET | `/api/weavers` | canManageWeavers ·  | WEV-01 |
| 179 | POST | `/api/weavers` | canManageWeavers ·  | WEV-02 |
| 180 | GET | `/api/weavers/:id` | canManageWeavers ·  | WEV-05 |
| 181 | PUT | `/api/weavers/:id` | canManageWeavers ·  | WEV-03 |
| 182 | DELETE | `/api/weavers/:id` | canManageWeavers ·  | WEV-04 |
| 183 | GET | `/api/weavers/suggest-code` | canManageWeavers ·  | WEV-02 |
| 184 | POST | `/api/yarn-parties` |  · createPermission | YM-01 / YM-02, YM-04 |
| 185 | GET | `/api/yarn-parties` |  · manage | YM-01 |
| 186 | GET | `/api/yarn-parties/:id` |  · manage | YM-01 |
| 187 | PUT | `/api/yarn-parties/:id` |  · manage | YM-01 |
| 188 | DELETE | `/api/yarn-parties/:id` |  · manage | YM-01 |
| 189 | POST | `/api/yarn-pos` |  · manage | YPO-02 |
| 190 | GET | `/api/yarn-pos` |  · view | YPO-01 |
| 191 | PUT | `/api/yarn-pos/:id` |  · manage | YPO-03 |
| 192 | GET | `/api/yarn-pos/:id` |  · view | YPO-04 |
| 193 | POST | `/api/yarn-pos/:id/cancel` |  · manage | YPO-07 |
| 194 | POST | `/api/yarn-pos/:id/close` |  · manage | YPO-06 |
| 195 | GET | `/api/yarn-pos/:id/print` |  · manage | YPO-08, PRN-06 |
| 196 | POST | `/api/yarn-pos/:id/receipts` |  · canReceiveYarn | YPO-05 |
| 197 | GET | `/api/yarn-pos/check-no` |  · manage | YPO-02 |
| 198 | POST | `/api/yarn-qualities` |  · createPermission | YM-01 / YM-02, YM-04 |
| 199 | GET | `/api/yarn-qualities` |  · manage | YM-02 |
| 200 | GET | `/api/yarn-qualities/:id` |  · manage | YM-02 |
| 201 | PUT | `/api/yarn-qualities/:id` |  · manage | YM-02 |
| 202 | DELETE | `/api/yarn-qualities/:id` |  · manage | YM-02 |
| 203 | GET | `/api/yarn/beams` | canUseYarnInventory ·  | YRN-02 |
| 204 | GET | `/api/yarn/moves` | canUseYarnInventory ·  | YRN-03 |
| 205 | GET | `/api/yarn/summary` | canUseYarnInventory ·  | YRN-01 |
| 206 | GET | `/api/yarn/tfo/board` | canUseYarnInventory ·  | YRN-06 |
| 207 | GET | `/api/yarn/tfo/programs` | canUseYarnInventory ·  | YRN-09 |
| 208 | POST | `/api/yarn/tfo/programs` | canUseYarnInventory ·  | YRN-07 |
| 209 | GET | `/api/yarn/tfo/programs/:id` | canUseYarnInventory ·  | YRN-12 |
| 210 | POST | `/api/yarn/tfo/programs/:id/stop` | canUseYarnInventory ·  | YRN-08 |
| 211 | POST | `/api/yarn/transfers` | canUseYarnInventory ·  | YRN-04 |
| 212 | GET | `/api/yarn/warping/jobs` | canUseYarnInventory ·  | YRN-10 |
| 213 | POST | `/api/yarn/warping/jobs` | canUseYarnInventory ·  | YRN-10 |
| 214 | GET | `/api/yarn/warping/jobs/:id` | canUseYarnInventory ·  | YRN-12 |
| 215 | POST | `/api/yarn/warping/jobs/:id/done` | canUseYarnInventory ·  | YRN-11 |
| 216 | POST | `/api/yarn/withdrawals` | canUseYarnInventory ·  | YRN-05 |
| 217 | GET | `/api/yarn/zones/:zone` | canUseYarnInventory ·  | YRN-02 |

### Routes no screen calls (API only)

Found by comparing section A with the client's `api.*` calls. They are in the inventory, marked "API only":
`GET /api/takas/lookup` (TKD-05), `GET /api/butta-qc/pending` and `GET /api/mill-qc/pending` (QC-04),
`PUT /api/orders/:id/steps` (ORD-05), `GET /api/outside-pos/:id` (OUT-08), `POST /api/mill/receive` and
`/api/mill/receive/:takaId/undo` (MIL-09), `GET /api/dispatch/challans/:id/print` (DSP-07),
`GET /api/yarn/tfo/programs/:id`, `GET /api/yarn/warping/jobs/:id` (YRN-12), `POST /api/butta/challans/:id/received-count`
(answers 400 — mill only), and the single-record reads `GET /api/{users,customers,materials,machines,damages,butta-parties,mill-parties,weavers,yarn-parties,yarn-qualities,tfo-machines}/:id`.

---

## B. Every client route / screen → operation

From `client/src/App.tsx` (full-screen routes first, then the routes inside the app layout).

| # | Client route | Screen / operation(s) |
|---|---|---|
| 0 | `/` (index) | AUTH-05 (landing redirect) |
| 1 | `/orders/new` | ORD-02, ORD-03 |
| 2 | `/orders/:id/edit` | ORD-04, ORD-05, ORD-03 |
| 3 | `/print/jobsheets` | JS-07, PRN-01 |
| 4 | `/print/challan/:id` | BUT-06, PRN-02 |
| 5 | `/print/mill-challan/:id` | MIL-06, PRN-03 |
| 6 | `/print/dispatch-challan/:id` | DSP-02, PRN-04 |
| 7 | `/print/outside-po/:id` | OUT-05, PRN-05 |
| 8 | `/designs/upload` | DES-07 |
| 9 | `/yarn-po/new` | YPO-02, YM-04 |
| 10 | `/yarn-po/:id/edit` | YPO-03 |
| 11 | `/yarn-po/:id/receive` | YPO-05 |
| 12 | `/print/yarn-po/:id` | YPO-08, PRN-06 |
| 13 | `/outside-pos/:id/receive` | OUT-06 |
| 14 | `/orders/:id/receive-fg` | FG-01, FG-02 |
| 15 | `/login` | AUTH-01, AUTH-05 |
| 16 | `/orders` | ORD-01, ORD-06, SUP-06 |
| 17 | `/orders/:id` | ODT-01…ODT-10, ORD-07, HLD-01…04 |
| 18 | `/masters` | module 2–10 hub |
| 19 | `/customers` | CUS-01…04 |
| 20 | `/materials` | MAT-01…04 |
| 21 | `/designs` | DES-01, DES-02 |
| 22 | `/designs/:id` | DES-03…06 |
| 23 | `/machines` | MAC-01…04 |
| 24 | `/damages` | DMG-01…04 |
| 25 | `/orders/:orderId/takas/:takaId/damages` | TKD-02, TKD-03 |
| 26 | `/butta-parties` | PTY-01…04 |
| 27 | `/mill-parties` | PTY-01…04 |
| 28 | `/weavers` | WEV-01…04 |
| 29 | `/receive-goods` | OUT-07 |
| 30 | `/butta` | BUT-01…04, BUT-07, BUT-09 |
| 31 | `/butta/challans/:id` | BUT-05, BUT-08, BUT-10 |
| 32 | `/mill` | MIL-01…04, MIL-07 |
| 33 | `/mill/challans/:id` | MIL-05, MIL-07, MIL-08 |
| 34 | `/qc` | QC-01 |
| 35 | `/butta-qc` | QC-01 (redirect to /qc) |
| 36 | `/butta-qc/taka/:takaNo` | QC-02 |
| 37 | `/mill-qc` | QC-01 (redirect to /qc) |
| 38 | `/mill-qc/taka/:takaNo` | QC-03 |
| 39 | `/godown/orders` | GD-01 |
| 40 | `/godown/orders/:orderId` | GD-02…04, GD-06…11, DSP-01 |
| 41 | `/godown/orders/:orderId/split/:takaId` | GD-05 |
| 42 | `/godown/orders/:orderId/takas/:takaId/damages` | TKD-02 |
| 43 | `/inventory` | INV-01, INV-02, INV-04 |
| 44 | `/inventory/items/:key` | INV-03, FS-03 |
| 45 | `/inventory/damaged/:key` | INV-05, FS-04 |
| 46 | `/dispatched` | DSP-03 |
| 47 | `/dispatched/:orderId` | DSP-04 |
| 48 | `/dispatched/:orderId/challans/:challanId/gr` | DSP-05, DSP-06 |
| 49 | `/users` | USR-01…04 |
| 50 | `/yarn` | YRN-01 |
| 51 | `/yarn/movements` | YRN-03 |
| 52 | `/yarn/:zone` | YRN-02, YRN-04…12 |
| 53 | `/yarn-po` | YPO-01 |
| 54 | `/yarn-po/:id` | YPO-04, YPO-06, YPO-07 |
| 55 | `/yarn-parties` | YM-01 |
| 56 | `/yarn-qualities` | YM-02 |
| 57 | `/tfo-machines` | YM-03 |
| 58 | `/jobsheets` | SUP-01, SUP-02 (supervisor) · TE-03 (taka entry) |
| 59 | `/jobsheets/order/:orderId` | SUP-02 |
| 60 | `/jobsheets/:id` | JS-03, JS-04, JS-06, JS-08, ET-01 (office) · TE-04, TE-05 (taka entry) |
| 61 | `/machine-view` | MV-01 |
| 62 | `/scan` | TE-01 |
| 63 | `/j/:jobsheetNo` | TE-02 |
| 64 | `*` | AUTH-05 |

---

## C. Every stored value in the shared config → where it is covered

"Covered" = the value is written (in backticks) in the named document section.

**Taka stages** (11) — STATE_MACHINES §4

| Value | Label | Covered |
|---|---|---|
| `entered` |  | ✅ |
| `at_butta` |  | ✅ |
| `butta_qc` |  | ✅ |
| `waiting_mill` |  | ✅ |
| `at_mill` |  | ✅ |
| `mill_qc` |  | ✅ |
| `final` |  | ✅ |
| `refinish` |  | ✅ |
| `ready_dispatch` |  | ✅ |
| `rework_butta` |  | ✅ |
| `dispatched` |  | ✅ |

**Order statuses** (19) — STATE_MACHINES §1

| Value | Label | Covered |
|---|---|---|
| `pending_production` | Pending for production | ✅ |
| `ready_production` | Jobsheet pending | ✅ |
| `outside_production` | At outside weaver | ✅ |
| `awaiting_goods` | Awaiting goods | ✅ |
| `jobsheet_created` | Jobsheet created | ✅ |
| `in_production` | In production | ✅ |
| `production_completed` | Production completed | ✅ |
| `taka_entry_done` | Taka entry done | ✅ |
| `in_butta_cutting` | In butta cutting | ✅ |
| `ready_for_mill` | Ready for mill | ✅ |
| `in_mill` | In mill | ✅ |
| `received_from_mill` | Received from mill | ✅ |
| `mill_qc_done` | Mill QC done | ✅ |
| `in_godown` | In godown | ✅ |
| `ready_for_dispatch` | Ready for dispatch | ✅ |
| `partly_dispatched` | Partly dispatched | ✅ |
| `dispatched` | Dispatched | ✅ |
| `returned` | Returned | ✅ |
| `closed` | Closed | ✅ |

**Jobsheet statuses** (4) — STATE_MACHINES §3

| Value | Label | Covered |
|---|---|---|
| `pending` | Pending | ✅ |
| `sent` | Sent to supervisor | ✅ |
| `ongoing` | Ongoing | ✅ |
| `completed` | Completed | ✅ |

**Challan kinds** (2) — STATE_MACHINES §6

| Value | Label | Covered |
|---|---|---|
| `butta` |  | ✅ |
| `mill` |  | ✅ |

**Order kinds** (3) — STATE_MACHINES §2

| Value | Label | Covered |
|---|---|---|
| `in_house` |  | ✅ |
| `outside_production` |  | ✅ |
| `fg_purchase` |  | ✅ |

**Dashboard main stages** (6) — STATE_MACHINES §4.5

| Value | Label | Covered |
|---|---|---|
| `production` |  | ✅ |
| `outside` |  | ✅ |
| `purchase` |  | ✅ |
| `butta` |  | ✅ |
| `mill` |  | ✅ |
| `ready` |  | ✅ |

**Dashboard sub-stages** (17) — STATE_MACHINES §4.5

| Value | Label | Covered |
|---|---|---|
| `not_sent` | Not assigned to supervisor | ✅ |
| `with_supervisor` | Waiting to start on loom | ✅ |
| `on_loom` | On loom | ✅ |
| `taka_pending` | Taka entry pending | ✅ |
| `taka_done` | Taka entry done · waiting for butta cutting | ✅ |
| `outside_po` | Given outside (POs) | ✅ |
| `at_weaver` | At outside weaver | ✅ |
| `at_butta` | At butta cutting | ✅ |
| `butta_qc` | Received · QC pending | ✅ |
| `rework_butta` | Sent back to butta cutting · waiting | ✅ |
| `waiting_mill` | Waiting for mill | ✅ |
| `at_mill` | At mill (dyeing) | ✅ |
| `mill_qc` | Received · QC pending | ✅ |
| `refinish` | Refinish (in inventory) | ✅ |
| `final` | Final takas (godown) | ✅ |
| `ready_dispatch` | Ready for dispatch | ✅ |
| `dispatched` | Dispatched | ✅ |

**Damage types (found_at)** (7) — STATE_MACHINES §5

| Value | Label | Covered |
|---|---|---|
| `machine` |  | ✅ |
| `butta` |  | ✅ |
| `mill` |  | ✅ |
| `weaver` |  | ✅ |
| `unmarked` |  | ✅ |
| `godown` |  | ✅ |
| `customer_return` |  | ✅ |

**Damage recorded at** (10) — STATE_MACHINES §5

| Value | Label | Covered |
|---|---|---|
| `taka_entry` |  | ✅ |
| `edit_takas` |  | ✅ |
| `butta_qc` |  | ✅ |
| `mill_qc` |  | ✅ |
| `godown` |  | ✅ |
| `goods_return` |  | ✅ |
| `split` |  | ✅ |
| `inventory` |  | ✅ |
| `outside_receipt` |  | ✅ |
| `fg_receipt` |  | ✅ |

**Taka sources** (3) — STATE_MACHINES §4.5

| Value | Label | Covered |
|---|---|---|
| `production` |  | ✅ |
| `outside_po` |  | ✅ |
| `fg_purchase` |  | ✅ |

**Free-stock reasons** (3) — STATE_MACHINES §4.4

| Value | Label | Covered |
|---|---|---|
| `moved` |  | ✅ |
| `goods_return` |  | ✅ |
| `order_closed` |  | ✅ |

**Outside PO statuses** (5) — STATE_MACHINES §8

| Value | Label | Covered |
|---|---|---|
| `open` |  | ✅ |
| `partly_received` |  | ✅ |
| `received` |  | ✅ |
| `closed` |  | ✅ |
| `cancelled` |  | ✅ |

**Yarn PO statuses** (5) — STATE_MACHINES §9

| Value | Label | Covered |
|---|---|---|
| `open` |  | ✅ |
| `partly_received` |  | ✅ |
| `received` |  | ✅ |
| `closed` |  | ✅ |
| `cancelled` |  | ✅ |

**Yarn PO events** (5) — STATE_MACHINES §9

| Value | Label | Covered |
|---|---|---|
| `created` |  | ✅ |
| `edited` |  | ✅ |
| `received` |  | ✅ |
| `closed` |  | ✅ |
| `cancelled` |  | ✅ |

**Yarn zones** (3) — STATE_MACHINES §9

| Value | Label | Covered |
|---|---|---|
| `direct` |  | ✅ |
| `tfo` |  | ✅ |
| `warping` |  | ✅ |

**Yarn ledger + beam move kinds** (10) — STATE_MACHINES §9

| Value | Label | Covered |
|---|---|---|
| `receipt` |  | ✅ |
| `transfer_in` |  | ✅ |
| `transfer_out` |  | ✅ |
| `withdraw` |  | ✅ |
| `tfo_issue` |  | ✅ |
| `tfo_output` |  | ✅ |
| `tfo_return` |  | ✅ |
| `warping_issue` |  | ✅ |
| `beam_created` |  | ✅ |
| `consumed` |  | ✅ |

**TFO program statuses** (2) — STATE_MACHINES §10

| Value | Label | Covered |
|---|---|---|
| `running` |  | ✅ |
| `completed` |  | ✅ |

**Warping job statuses** (2) — STATE_MACHINES §11

| Value | Label | Covered |
|---|---|---|
| `in_process` |  | ✅ |
| `done` |  | ✅ |

**Beam statuses** (2) — STATE_MACHINES §12

| Value | Label | Covered |
|---|---|---|
| `in_stock` |  | ✅ |
| `consumed` |  | ✅ |

**Taka event kinds** (28) — STATE_MACHINES §14.1

| Value | Label | Covered |
|---|---|---|
| `entered` |  | ✅ |
| `sent_butta` |  | ✅ |
| `received_butta` |  | ✅ |
| `sent_mill` |  | ✅ |
| `received_mill` |  | ✅ |
| `receive_undone` |  | ✅ |
| `butta_qc_done` |  | ✅ |
| `damage_added` |  | ✅ |
| `damage_partly_resolved` |  | ✅ |
| `damage_resolved` |  | ✅ |
| `damage_kept` |  | ✅ |
| `edited` |  | ✅ |
| `challan_cancelled` |  | ✅ |
| `mill_qc_done` |  | ✅ |
| `sent_refinish` |  | ✅ |
| `split` |  | ✅ |
| `godown_checked` |  | ✅ |
| `godown_unchecked` |  | ✅ |
| `actual_pcs_changed` |  | ✅ |
| `ready_dispatch` |  | ✅ |
| `sent_back` |  | ✅ |
| `dispatched` |  | ✅ |
| `goods_returned` |  | ✅ |
| `moved_order` |  | ✅ |
| `moved_to_inventory` |  | ✅ |
| `allocated_from_free_stock` |  | ✅ |
| `received_outside` |  | ✅ |
| `received_fg` |  | ✅ |

**Jobsheet event kinds** (9) — STATE_MACHINES §14.2

| Value | Label | Covered |
|---|---|---|
| `created` |  | ✅ |
| `sent` |  | ✅ |
| `pulled_back` |  | ✅ |
| `started` |  | ✅ |
| `completed` |  | ✅ |
| `machine_changed` |  | ✅ |
| `takas_entered` |  | ✅ |
| `takas_edited` |  | ✅ |
| `cancelled` |  | ✅ |

**Order events** (2) — STATE_MACHINES §14.3

| Value | Label | Covered |
|---|---|---|
| `steps_changed` |  | ✅ |
| `order_closed` |  | ✅ |

**Order hold events** (2) — STATE_MACHINES §14.3

| Value | Label | Covered |
|---|---|---|
| `held` |  | ✅ |
| `released` |  | ✅ |

**Permissions** (52) — ROLE_MATRIX §3

| Value | Label | Covered |
|---|---|---|
| `canViewOrders` |  | ✅ |
| `canViewMasters` |  | ✅ |
| `canSeeRate` |  | ✅ |
| `canSeeClient` |  | ✅ |
| `canAddOrder` |  | ✅ |
| `canEditOrder` |  | ✅ |
| `canSendToProduction` |  | ✅ |
| `canUndoProduction` |  | ✅ |
| `canManageMasters` |  | ✅ |
| `canManageDamages` |  | ✅ |
| `canManageJobsheets` |  | ✅ |
| `canManageMachines` |  | ✅ |
| `canViewJobsheetsModule` |  | ✅ |
| `canRunJobsheets` |  | ✅ |
| `canPrintJobsheets` |  | ✅ |
| `canViewMachineView` |  | ✅ |
| `canUseTakaModules` |  | ✅ |
| `canEnterTakas` |  | ✅ |
| `canEditTakas` |  | ✅ |
| `canViewTakas` |  | ✅ |
| `canUseButtaModule` |  | ✅ |
| `canCancelChallan` |  | ✅ |
| `canManageButtaParties` |  | ✅ |
| `canButtaQc` |  | ✅ |
| `canUseMillModule` |  | ✅ |
| `canManageMillParties` |  | ✅ |
| `canMillQc` |  | ✅ |
| `canUseGodownOrders` |  | ✅ |
| `canViewInventory` |  | ✅ |
| `canViewProductionOrders` |  | ✅ |
| `canReworkTakas` |  | ✅ |
| `canDispatch` |  | ✅ |
| `canGoodsReturn` |  | ✅ |
| `canMoveToInventory` |  | ✅ |
| `canMarkFresh` |  | ✅ |
| `canSwitchRoles` |  | ✅ |
| `canManageUsers` |  | ✅ |
| `canHoldOrder` |  | ✅ |
| `canSeeHeldOrders` |  | ✅ |
| `canViewGodownOrders` |  | ✅ |
| `canEditOrderSteps` |  | ✅ |
| `canManageWeavers` |  | ✅ |
| `canCreateOutsidePo` |  | ✅ |
| `canReceiveOutside` |  | ✅ |
| `canCloseOrder` |  | ✅ |
| `canManageYarnMasters` |  | ✅ |
| `canManageYarnPo` |  | ✅ |
| `canReceiveYarn` |  | ✅ |
| `canViewYarn` |  | ✅ |
| `canUseYarnInventory` |  | ✅ |
| `canViewDesignLibrary` |  | ✅ |
| `canManageDesigns` |  | ✅ |

---

## D. Reverse check: every operation in FLOW_INVENTORY is reachable

All 216 operation IDs in `FLOW_INVENTORY.md` were checked against sections A–B and `ROLE_MATRIX.md`. Every ID is
referenced, except these, which by nature have no route or screen of their own:

- `ALR-01…15` — warnings shown inside other screens (each row names the screen and rule).
- `GRD-01…05` — the hold / close guard, which applies to the write routes listed in `server/src/middleware/hold-guard.ts`
  (`WRITE_RULES`, `READ_MESSAGE_RULES`, `READ_HIDDEN_RULES`, `CLOSED_HIDDEN_PATTERNS`).
- `FG-03` — an alias of `FS-02` (Add from free stock used for an FG order).

Modules **36**, operations **216** (incl. 15 warnings, 5 guard rules, 6 prints), state machines **13** (+ events
§14), scenarios **12**.

---

## Appendix — the scripts

### routes.mjs
```js
// Mechanical extraction of every server route: reads server/src/index.ts (mounts) + every server/src/routes/*.ts
// (method, path, the requirePermission(...) of the call and of router.use(...) gates). Usage: node routes.mjs <repo>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
const idx = readFileSync(join(repo, 'server/src/index.ts'), 'utf8');
// api.use('/orders', ordersRouter);  api.use('/butta', challansRouter('butta'));
const mounts = [...idx.matchAll(/api\.use\('([^']+)',\s*([A-Za-z]+)(?:\('([a-z]+)'\))?\)/g)].map((m) => ({ base: m[1], router: m[2], arg: m[3] }));

const rows = [];
for (const file of readdirSync(join(repo, 'server/src/routes'))) {
  const src = readFileSync(join(repo, 'server/src/routes', file), 'utf8');
  // Gates: X.use(requirePermission(...)) — applies to the routes declared AFTER it in the same router.
  const tokens = [...src.matchAll(/(\w+)\.(use|get|post|put|patch|delete)\(\s*(?:'([^']*)')?/g)];
  const gates = {};
  for (const t of tokens) {
    const [whole, rv, method, path] = t;
    const after = src.slice(t.index, t.index + 600);
    if (method === 'use') {
      const g = /requirePermission\(([^)]*)\)/.exec(after.split('\n')[0]);
      if (g) (gates[rv] ??= []).push(g[1].replace(/'/g, ''));
      continue;
    }
    if (path === undefined) continue;
    // the call's own permission: requirePermission(...) or a `manage` / `run` / `view` / `receive` / `quickAdd` const
    const call = after.slice(0, after.indexOf('ah(') > 0 ? after.indexOf('ah(') : 200);
    const own = /requirePermission\(([^)]*)\)/.exec(call)?.[1]?.replace(/'/g, '') ?? (/(?:^|[\s,])(manage|run|view|receive|quickAdd|createPermission)\s*,/.exec(call)?.[1] ?? '');
    rows.push({ file, router: rv, method: method.toUpperCase(), path, gate: (gates[rv] ?? []).join(' + '), own });
  }
}

const routerOf = (row) => {
  // routers defined inside a factory (challansRouter / partiesRouter / crudRouter) use the local name `router`
  if (row.file === 'challans.ts') return mounts.filter((m) => m.router === 'challansRouter');
  if (row.file === 'parties.ts') return mounts.filter((m) => m.router === 'partiesRouter');
  if (row.file === 'yarn-masters.ts') return mounts.filter((m) => ['yarnPartiesRouter', 'yarnQualitiesRouter', 'tfoMachinesRouter'].includes(m.router));
  return mounts.filter((m) => m.router === row.router);
};

const out = [];
for (const r of rows) {
  for (const m of routerOf(r)) {
    // the mill-only refinish routes
    if (r.file === 'challans.ts' && r.path.startsWith('/refinish') && m.arg !== 'mill') continue;
    const full = `/api${m.base}${r.path === '/' ? '' : r.path}`;
    out.push(`${r.method.padEnd(6)} ${full.padEnd(52)} gate: ${r.gate || '-'} | own: ${r.own || '-'}  (${r.file})`);
  }
}
out.push('GET    /api/health                                          gate: - | own: -  (index.ts, public)');
console.log(out.sort((a, b) => a.slice(7).localeCompare(b.slice(7))).join('\n'));
console.error(`${out.length} routes`);
```

### coverage.mts
```ts
// Builds the mechanical lists of docs/flows/COVERAGE_CHECK.md and checks that every item is mapped to FLOW_INVENTORY /
// STATE_MACHINES. Usage (repo root): npx tsx coverage.mts <repo>  → markdown on stdout, unmapped items on stderr.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.argv[2];
const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const inv = readFileSync(join(repo, 'docs/flows/FLOW_INVENTORY.md'), 'utf8');
const sm = readFileSync(join(repo, 'docs/flows/STATE_MACHINES.md'), 'utf8');
const misses: string[] = [];
const out: string[] = [];
const idExists = (id: string) => inv.includes(`| ${id} |`) || new RegExp(`\\b${id}\\b`).test(inv);

/* ---------- A. server routes ---------- */
const routes = execFileSync('node', [join(here, 'routes.mjs'), repo], { encoding: 'utf8' }).trim().split('\n');
// [method regex, path regex, operation ids]
const R: [string, RegExp, string][] = [
  ['POST', /^\/api\/auth\/login$/, 'AUTH-01'], ['GET', /^\/api\/auth\/me$/, 'AUTH-02'], ['POST', /^\/api\/auth\/logout$/, 'AUTH-03'], ['GET', /^\/api\/health$/, 'AUTH-06'],
  ['GET', /^\/api\/users$/, 'USR-01'], ['POST', /^\/api\/users$/, 'USR-02'], ['PUT', /^\/api\/users\/:id$/, 'USR-03'], ['POST', /^\/api\/users\/:id\/reset-password$/, 'USR-04'], ['GET', /^\/api\/users\/:id$/, 'USR-05'],
  ['GET', /^\/api\/customers$/, 'CUS-01'], ['POST', /^\/api\/customers$/, 'CUS-02'], ['PUT', /^\/api\/customers\/:id$/, 'CUS-03'], ['DELETE', /^\/api\/customers\/:id$/, 'CUS-04'], ['GET', /^\/api\/customers\/:id\/previous-designs$/, 'CUS-05'], ['GET', /^\/api\/customers\/:id$/, 'CUS-06'],
  ['GET', /^\/api\/materials$/, 'MAT-01'], ['POST', /^\/api\/materials$/, 'MAT-02'], ['PUT', /^\/api\/materials\/:id$/, 'MAT-03'], ['DELETE', /^\/api\/materials\/:id$/, 'MAT-04'], ['GET', /^\/api\/materials\/:id$/, 'MAT-05'],
  ['GET', /^\/api\/designs\/qualities$/, 'DES-01'], ['GET', /^\/api\/designs$/, 'DES-02'], ['GET', /^\/api\/designs\/:id$/, 'DES-03'], ['POST', /^\/api\/designs$/, 'DES-04'], ['PUT', /^\/api\/designs\/:id$/, 'DES-05'], ['DELETE', /^\/api\/designs\/:id$/, 'DES-06'], ['POST', /^\/api\/designs\/bulk$/, 'DES-07'], ['GET', /^\/api\/designs\/check-codes$/, 'DES-07'], ['GET', /^\/api\/designs\/check-code$/, 'DES-08'],
  ['GET', /^\/api\/machines$/, 'MAC-01'], ['POST', /^\/api\/machines$/, 'MAC-02'], ['PUT', /^\/api\/machines\/:id$/, 'MAC-03'], ['DELETE', /^\/api\/machines\/:id$/, 'MAC-04'], ['GET', /^\/api\/machines\/:id$/, 'MAC-05'],
  ['GET', /^\/api\/damages$/, 'DMG-01'], ['POST', /^\/api\/damages$/, 'DMG-02'], ['PUT', /^\/api\/damages\/:id$/, 'DMG-03'], ['DELETE', /^\/api\/damages\/:id$/, 'DMG-04'], ['GET', /^\/api\/damages\/:id$/, 'DMG-06'],
  ['GET', /^\/api\/(butta|mill)-parties$/, 'PTY-01'], ['POST', /^\/api\/(butta|mill)-parties$/, 'PTY-02'], ['PUT', /^\/api\/(butta|mill)-parties\/:id$/, 'PTY-03'], ['DELETE', /^\/api\/(butta|mill)-parties\/:id$/, 'PTY-04'], ['GET', /^\/api\/(butta|mill)-parties\/:id$/, 'PTY-05'],
  ['GET', /^\/api\/weavers$/, 'WEV-01'], ['POST', /^\/api\/weavers$/, 'WEV-02'], ['GET', /^\/api\/weavers\/suggest-code$/, 'WEV-02'], ['PUT', /^\/api\/weavers\/:id$/, 'WEV-03'], ['DELETE', /^\/api\/weavers\/:id$/, 'WEV-04'], ['GET', /^\/api\/weavers\/:id$/, 'WEV-05'],
  ['POST', /^\/api\/yarn-(parties|qualities)$/, 'YM-01 / YM-02, YM-04'], ['.*', /^\/api\/yarn-parties/, 'YM-01'], ['.*', /^\/api\/yarn-qualities/, 'YM-02'], ['.*', /^\/api\/tfo-machines/, 'YM-03'],
  ['GET', /^\/api\/orders$/, 'ORD-01'], ['POST', /^\/api\/orders$/, 'ORD-02'], ['PUT', /^\/api\/orders\/:id$/, 'ORD-04, ORD-05'], ['PUT', /^\/api\/orders\/:id\/steps$/, 'ORD-05'],
  ['POST', /^\/api\/orders\/send-to-production$/, 'ORD-06'], ['POST', /^\/api\/orders\/:id\/undo-production$/, 'ORD-07'],
  ['POST', /^\/api\/orders\/:id\/hold$/, 'HLD-01'], ['POST', /^\/api\/orders\/:id\/release$/, 'HLD-02'], ['GET', /^\/api\/orders\/:id\/close-preview$/, 'HLD-03'], ['POST', /^\/api\/orders\/:id\/close$/, 'HLD-04'],
  ['GET', /^\/api\/orders\/:id$/, 'ODT-01, ODT-08, ODT-09'], ['GET', /^\/api\/orders\/:id\/dashboard$/, 'ODT-02'], ['GET', /^\/api\/orders\/:id\/dashboard\/items$/, 'ODT-03'],
  ['GET', /^\/api\/orders\/:id\/jobsheets$/, 'ODT-04, JS-09'], ['GET', /^\/api\/orders\/:id\/outside-pos$/, 'ODT-05'], ['GET', /^\/api\/orders\/:id\/takas$/, 'ODT-06'],
  ['GET', /^\/api\/orders\/:id\/damages$/, 'ODT-07'], ['GET', /^\/api\/orders\/:id\/milestones$/, 'ODT-09'], ['GET', /^\/api\/orders\/:id\/challans$/, 'ODT-10'],
  ['POST', /^\/api\/orders\/:id\/jobsheets\/generate$/, 'JS-01'], ['POST', /^\/api\/orders\/:id\/jobsheets$/, 'JS-02'], ['PUT', /^\/api\/jobsheets\/:id$/, 'JS-03'], ['DELETE', /^\/api\/jobsheets\/:id$/, 'JS-04'],
  ['POST', /^\/api\/orders\/:id\/jobsheets\/send$/, 'JS-05'], ['POST', /^\/api\/jobsheets\/:id\/pull-back$/, 'JS-06'], ['GET', /^\/api\/jobsheets\/print$/, 'JS-07, PRN-01'], ['GET', /^\/api\/jobsheets\/:id$/, 'JS-08'],
  ['GET', /^\/api\/jobsheets$/, 'SUP-01, SUP-02'], ['GET', /^\/api\/jobsheets\/orders$/, 'SUP-02'], ['POST', /^\/api\/jobsheets\/:id\/start$/, 'SUP-03'], ['POST', /^\/api\/jobsheets\/:id\/complete$/, 'SUP-04'], ['POST', /^\/api\/jobsheets\/:id\/change-machine$/, 'SUP-05'],
  ['GET', /^\/api\/machine-view$/, 'MV-01'],
  ['GET', /^\/api\/jobsheets\/by-no\/:no$/, 'TE-01, TE-02'], ['GET', /^\/api\/taka\/jobsheets$/, 'TE-03'], ['POST', /^\/api\/jobsheets\/:id\/takas$/, 'TE-04'], ['GET', /^\/api\/takas\/next-numbers$/, 'TE-05, OUT-06'],
  ['PUT', /^\/api\/jobsheets\/:id\/takas$/, 'ET-01, ET-02'], ['GET', /^\/api\/takas\/check$/, 'ET-03'],
  ['POST', /^\/api\/orders\/:id\/outside-pos$/, 'OUT-01'], ['PUT', /^\/api\/outside-pos\/:id$/, 'OUT-02'], ['POST', /^\/api\/outside-pos\/:id\/cancel$/, 'OUT-03'], ['POST', /^\/api\/outside-pos\/:id\/close$/, 'OUT-04'],
  ['GET', /^\/api\/outside-pos\/:id\/print$/, 'OUT-05, PRN-05'], ['GET', /^\/api\/outside-pos\/:id\/receipt-form$/, 'OUT-06'], ['POST', /^\/api\/outside-pos\/:id\/receipts$/, 'OUT-06'], ['GET', /^\/api\/receive-goods$/, 'OUT-07'], ['GET', /^\/api\/outside-pos\/:id$/, 'OUT-08'],
  ['GET', /^\/api\/orders\/:id\/fg-receipt-form$/, 'FG-01, FG-02'], ['POST', /^\/api\/orders\/:id\/fg-receipts$/, 'FG-01, FG-02'],
  ['GET', /^\/api\/butta\/pending-orders$/, 'BUT-01'], ['GET', /^\/api\/butta\/counts$/, 'BUT-01'], ['GET', /^\/api\/butta\/pending-orders\/:orderId\/takas$/, 'BUT-02'], ['POST', /^\/api\/butta\/challans$/, 'BUT-03'],
  ['GET', /^\/api\/butta\/challans$/, 'BUT-04'], ['GET', /^\/api\/butta\/challans\/:id$/, 'BUT-05'], ['GET', /^\/api\/butta\/challans\/:id\/print$/, 'BUT-06, PRN-02'], ['POST', /^\/api\/butta\/receive$/, 'BUT-07, BUT-08'],
  ['POST', /^\/api\/butta\/receive\/:takaId\/undo$/, 'BUT-09'], ['POST', /^\/api\/butta\/challans\/:id\/cancel$/, 'BUT-10'], ['POST', /^\/api\/butta\/challans\/:id\/received-count$/, 'MIL-07 (mill only; butta answers 400)'],
  ['GET', /^\/api\/takas\/by-no\/:no$/, 'QC-01, TKD-04'], ['POST', /^\/api\/butta-qc\/:takaId$/, 'QC-02'], ['GET', /^\/api\/mill-qc\/taka\/:no$/, 'QC-03'], ['POST', /^\/api\/mill-qc\/:takaId$/, 'QC-03'], ['GET', /^\/api\/(butta|mill)-qc\/pending$/, 'QC-04'],
  ['GET', /^\/api\/mill\/(pending-orders|counts)/, 'MIL-01'], ['GET', /^\/api\/mill\/refinish-orders/, 'MIL-02'], ['POST', /^\/api\/mill\/challans$/, 'MIL-03'], ['GET', /^\/api\/mill\/challans$/, 'MIL-04'],
  ['GET', /^\/api\/mill\/challans\/:id$/, 'MIL-05'], ['GET', /^\/api\/mill\/challans\/:id\/print$/, 'MIL-06, PRN-03'], ['POST', /^\/api\/mill\/challans\/:id\/received-count$/, 'MIL-07'], ['POST', /^\/api\/mill\/challans\/:id\/cancel$/, 'MIL-08'], ['POST', /^\/api\/mill\/receive/, 'MIL-09'],
  ['POST', /^\/api\/orders\/:id\/takas\/send-back$/, 'RW-01, RW-02'],
  ['GET', /^\/api\/godown\/orders$/, 'GD-01'], ['GET', /^\/api\/godown\/orders\/:orderId$/, 'GD-02'], ['PATCH', /^\/api\/godown\/takas\/:id$/, 'GD-03, GD-04'], ['GET', /^\/api\/godown\/takas\/:id\/split-damages$/, 'GD-05'], ['POST', /^\/api\/godown\/takas\/:id\/split$/, 'GD-05'],
  ['POST', /^\/api\/godown\/takas\/:id\/damage$/, 'GD-06'], ['POST', /^\/api\/godown\/takas\/:id\/resolve$/, 'GD-07'], ['POST', /^\/api\/godown\/takas\/:id\/refinish$/, 'GD-08'], ['POST', /^\/api\/godown\/orders\/:orderId\/ready-dispatch$/, 'GD-09'], ['GET', /^\/api\/godown\/orders\/:orderId\/damages$/, 'GD-10'],
  ['POST', /^\/api\/godown\/orders\/:orderId\/dispatch$/, 'DSP-01'], ['GET', /^\/api\/dispatch\/challans\/:id$/, 'DSP-02, PRN-04'], ['GET', /^\/api\/dispatched$/, 'DSP-03'], ['GET', /^\/api\/dispatched\/:orderId$/, 'DSP-04'], ['POST', /^\/api\/dispatch\/challans\/:id\/goods-return$/, 'DSP-05, DSP-06'], ['GET', /^\/api\/dispatch\/challans\/:id\/print$/, 'DSP-07'],
  ['POST', /^\/api\/orders\/:id\/takas\/move-to-inventory$/, 'FS-01'], ['POST', /^\/api\/orders\/:id\/takas\/add-from-free-stock$/, 'FS-02, FS-03'], ['GET', /^\/api\/inventory\/items\/:key\/free-stock$/, 'FS-02, INV-03'], ['GET', /^\/api\/inventory\/items\/:key\/assign-targets$/, 'FS-03'], ['POST', /^\/api\/inventory\/takas\/:id\/mark-fresh$/, 'FS-04'],
  ['GET', /^\/api\/inventory\/summary$/, 'INV-01'], ['GET', /^\/api\/inventory\/items$/, 'INV-02'], ['GET', /^\/api\/inventory\/items\/:key(\/orders)?$/, 'INV-03, INV-06, ORD-03'], ['GET', /^\/api\/inventory\/damaged$/, 'INV-04'], ['GET', /^\/api\/inventory\/damaged\/:key(\/takas)?$/, 'INV-05'],
  ['GET', /^\/api\/yarn-pos$/, 'YPO-01'], ['POST', /^\/api\/yarn-pos$/, 'YPO-02'], ['GET', /^\/api\/yarn-pos\/check-no$/, 'YPO-02'], ['PUT', /^\/api\/yarn-pos\/:id$/, 'YPO-03'], ['GET', /^\/api\/yarn-pos\/:id$/, 'YPO-04'], ['POST', /^\/api\/yarn-pos\/:id\/receipts$/, 'YPO-05'],
  ['POST', /^\/api\/yarn-pos\/:id\/close$/, 'YPO-06'], ['POST', /^\/api\/yarn-pos\/:id\/cancel$/, 'YPO-07'], ['GET', /^\/api\/yarn-pos\/:id\/print$/, 'YPO-08, PRN-06'],
  ['GET', /^\/api\/yarn\/summary$/, 'YRN-01'], ['GET', /^\/api\/yarn\/(zones\/:zone|beams)$/, 'YRN-02'], ['GET', /^\/api\/yarn\/moves$/, 'YRN-03'], ['POST', /^\/api\/yarn\/transfers$/, 'YRN-04'], ['POST', /^\/api\/yarn\/withdrawals$/, 'YRN-05'],
  ['GET', /^\/api\/yarn\/tfo\/board$/, 'YRN-06'], ['POST', /^\/api\/yarn\/tfo\/programs$/, 'YRN-07'], ['POST', /^\/api\/yarn\/tfo\/programs\/:id\/stop$/, 'YRN-08'], ['GET', /^\/api\/yarn\/tfo\/programs$/, 'YRN-09'],
  ['GET', /^\/api\/yarn\/warping\/jobs$/, 'YRN-10'], ['POST', /^\/api\/yarn\/warping\/jobs$/, 'YRN-10'], ['POST', /^\/api\/yarn\/warping\/jobs\/:id\/done$/, 'YRN-11'], ['GET', /^\/api\/yarn\/(tfo\/programs|warping\/jobs)\/:id$/, 'YRN-12'],
  ['GET', /^\/api\/takas\/:id$/, 'TKD-01'], ['GET', /^\/api\/takas\/:id\/damages$/, 'TKD-02'], ['GET', /^\/api\/takas\/lookup$/, 'TKD-05'],
  ['POST', /^\/api\/uploads$/, 'UPL-01'], ['GET', /^\/api\/lookup\//, 'LKP'],
];
out.push('| # | Method | Path | Permission gate (router · route) | Operation(s) |', '|---|---|---|---|---|');
routes.forEach((line, i) => {
  const m = /^(\S+)\s+(\S+)\s+gate: (.*?) \| own: (.*?)\s+\((.*)\)$/.exec(line);
  if (!m) return;
  const [, method, path, gate, own] = m;
  const hit = R.find(([mm, re]) => (mm === '.*' || mm === method) && re.test(path));
  const ops = hit?.[2];
  if (!ops) misses.push(`route ${method} ${path}`);
  else for (const id of ops.split(/[ ,/()]+/).filter((x) => /^[A-Z]+(-\d+)?$/.test(x))) if (!idExists(id)) misses.push(`route ${method} ${path} → missing id ${id}`);
  out.push(`| ${i + 1} | ${method} | \`${path}\` | ${gate === '-' ? '' : gate.replace(/kind === butta \? (\w+) : (\w+)/, '$1 / $2')} · ${own === '-' ? '' : own} | ${ops ?? '**UNMAPPED**'} |`);
});
console.log('<!-- A -->\n' + out.join('\n'));
out.length = 0;

/* ---------- B. client routes ---------- */
const app = readFileSync(join(repo, 'client/src/App.tsx'), 'utf8');
const paths = [...app.matchAll(/path: '([^']+)'/g)].map((m) => m[1]);
const C: [RegExp, string][] = [
  [/^\/orders\/new$/, 'ORD-02, ORD-03'], [/^\/orders\/:id\/edit$/, 'ORD-04, ORD-05, ORD-03'], [/^\/print\/jobsheets$/, 'JS-07, PRN-01'], [/^\/print\/challan\/:id$/, 'BUT-06, PRN-02'], [/^\/print\/mill-challan\/:id$/, 'MIL-06, PRN-03'],
  [/^\/print\/dispatch-challan\/:id$/, 'DSP-02, PRN-04'], [/^\/print\/outside-po\/:id$/, 'OUT-05, PRN-05'], [/^\/designs\/upload$/, 'DES-07'], [/^\/yarn-po\/new$/, 'YPO-02, YM-04'], [/^\/yarn-po\/:id\/edit$/, 'YPO-03'], [/^\/yarn-po\/:id\/receive$/, 'YPO-05'],
  [/^\/print\/yarn-po\/:id$/, 'YPO-08, PRN-06'], [/^\/outside-pos\/:id\/receive$/, 'OUT-06'], [/^\/orders\/:id\/receive-fg$/, 'FG-01, FG-02'], [/^login$/, 'AUTH-01, AUTH-05'], [/^orders$/, 'ORD-01, ORD-06, SUP-06'],
  [/^orders\/:id$/, 'ODT-01…ODT-10, ORD-07, HLD-01…04'], [/^masters$/, 'module 2–10 hub'], [/^customers$/, 'CUS-01…04'], [/^materials$/, 'MAT-01…04'], [/^designs$/, 'DES-01, DES-02'], [/^designs\/:id$/, 'DES-03…06'], [/^machines$/, 'MAC-01…04'],
  [/^damages$/, 'DMG-01…04'], [/^orders\/:orderId\/takas\/:takaId\/damages$/, 'TKD-02, TKD-03'], [/^(butta|mill)-parties$/, 'PTY-01…04'], [/^weavers$/, 'WEV-01…04'], [/^receive-goods$/, 'OUT-07'],
  [/^butta$/, 'BUT-01…04, BUT-07, BUT-09'], [/^butta\/challans\/:id$/, 'BUT-05, BUT-08, BUT-10'], [/^mill$/, 'MIL-01…04, MIL-07'], [/^mill\/challans\/:id$/, 'MIL-05, MIL-07, MIL-08'], [/^qc$/, 'QC-01'], [/^(butta|mill)-qc$/, 'QC-01 (redirect to /qc)'],
  [/^butta-qc\/taka\/:takaNo$/, 'QC-02'], [/^mill-qc\/taka\/:takaNo$/, 'QC-03'], [/^godown\/orders$/, 'GD-01'], [/^godown\/orders\/:orderId$/, 'GD-02…04, GD-06…11, DSP-01'], [/^godown\/orders\/:orderId\/split\/:takaId$/, 'GD-05'],
  [/^godown\/orders\/:orderId\/takas\/:takaId\/damages$/, 'TKD-02'], [/^inventory$/, 'INV-01, INV-02, INV-04'], [/^inventory\/items\/:key$/, 'INV-03, FS-03'], [/^inventory\/damaged\/:key$/, 'INV-05, FS-04'], [/^dispatched$/, 'DSP-03'],
  [/^dispatched\/:orderId$/, 'DSP-04'], [/^dispatched\/:orderId\/challans\/:challanId\/gr$/, 'DSP-05, DSP-06'], [/^users$/, 'USR-01…04'], [/^yarn$/, 'YRN-01'], [/^yarn\/movements$/, 'YRN-03'], [/^yarn\/:zone$/, 'YRN-02, YRN-04…12'],
  [/^yarn-po$/, 'YPO-01'], [/^yarn-po\/:id$/, 'YPO-04, YPO-06, YPO-07'], [/^yarn-parties$/, 'YM-01'], [/^yarn-qualities$/, 'YM-02'], [/^tfo-machines$/, 'YM-03'], [/^jobsheets$/, 'SUP-01, SUP-02 (supervisor) · TE-03 (taka entry)'],
  [/^jobsheets\/order\/:orderId$/, 'SUP-02'], [/^jobsheets\/:id$/, 'JS-03, JS-04, JS-06, JS-08, ET-01 (office) · TE-04, TE-05 (taka entry)'], [/^machine-view$/, 'MV-01'], [/^scan$/, 'TE-01'], [/^j\/:jobsheetNo$/, 'TE-02'], [/^\*$/, 'AUTH-05'],
];
out.push('| # | Client route | Screen / operation(s) |', '|---|---|---|', '| 0 | `/` (index) | AUTH-05 (landing redirect) |');
paths.forEach((p, i) => {
  const hit = C.find(([re]) => re.test(p));
  if (!hit) misses.push(`client route ${p}`);
  out.push(`| ${i + 1} | \`${p.startsWith('/') || p === '*' ? p : '/' + p}\` | ${hit?.[1] ?? '**UNMAPPED**'} |`);
});
console.log('<!-- B -->\n' + out.join('\n'));
out.length = 0;

/* ---------- C. config values ---------- */
const imp = async (f: string) => import(pathToFileURL(join(repo, 'shared/src', f)).href);
const { TAKA_STAGES, SUB_STAGES, DAMAGE_TYPES, MAIN_STAGE_KEYS } = await imp('pipeline.ts');
const { ORDER_STATUSES, JOBSHEET_STATUSES } = await imp('statuses.ts');
const { CHALLAN_KINDS } = await imp('challans.ts');
const { ROLES } = await imp('roles.ts');
const { FREE_STOCK_REASONS, DAMAGE_RECORDED_AT, TAKA_SOURCES } = await imp('freeStock.ts');
const { PO_STATUSES } = await imp('outside.ts');
const { YARN_PO_STATUSES, YARN_MOVE_KINDS, BEAM_MOVE_KINDS, WARPING_STATUSES, BEAM_STATUSES, YARN_ZONES, YARN_PO_EVENT_KINDS } = await imp('yarn.ts');
const { TAKA_EVENT_KINDS } = await imp('types.ts');
const { ORDER_KINDS } = await imp('orderSteps.ts');
const typesSrc = readFileSync(join(repo, 'shared/src/types.ts'), 'utf8');
const jsEvents = [...(/export type JobsheetEventKind =([\s\S]*?);/.exec(typesSrc)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const schema = readFileSync(join(repo, 'server/src/db/schema.ts'), 'utf8');
const orderEvents = [...(/'order_events'[\s\S]*?\$type<([^>]+)>/.exec(schema)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const holdEvents = [...(/'order_hold_events'[\s\S]*?\$type<([^>]+)>/.exec(schema)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const both = sm + '\n' + inv;
const rm = readFileSync(join(repo, 'docs/flows/ROLE_MATRIX.md'), 'utf8');
void both;
// Covered = the stored value appears in backticks in the named document.
const tick = '`';
const list = (title: string, items: { key: string; label?: string }[], where: string, doc: string) => {
  out.push(`**${title}** (${items.length}) — ${where}`, '', '| Value | Label | Covered |', '|---|---|---|');
  for (const it of items) {
    const ok = doc.includes(tick + it.key + tick);
    if (!ok) misses.push(`${title}: ${it.key}`);
    out.push(`| ${tick}${it.key}${tick} | ${it.label ?? ''} | ${ok ? '✅' : '**MISSING**'} |`);
  }
  out.push('');
};
const keys = (a: readonly string[]) => a.map((k) => ({ key: k }));
const labelled = (a: readonly { key: string; label: string }[]) => a.map((s) => ({ key: s.key, label: s.label }));
list('Taka stages', keys(TAKA_STAGES), 'STATE_MACHINES §4', sm);
list('Order statuses', labelled(ORDER_STATUSES), 'STATE_MACHINES §1', sm);
list('Jobsheet statuses', labelled(JOBSHEET_STATUSES), 'STATE_MACHINES §3', sm);
list('Challan kinds', keys(CHALLAN_KINDS), 'STATE_MACHINES §6', sm);
list('Order kinds', keys(ORDER_KINDS), 'STATE_MACHINES §2', sm);
list('Dashboard main stages', keys(MAIN_STAGE_KEYS), 'STATE_MACHINES §4.5', sm);
list('Dashboard sub-stages', labelled(SUB_STAGES), 'STATE_MACHINES §4.5', sm);
list('Damage types (found_at)', keys(DAMAGE_TYPES), 'STATE_MACHINES §5', sm);
list('Damage recorded at', keys(DAMAGE_RECORDED_AT), 'STATE_MACHINES §5', sm);
list('Taka sources', keys(TAKA_SOURCES), 'STATE_MACHINES §4.5', sm);
list('Free-stock reasons', keys(FREE_STOCK_REASONS), 'STATE_MACHINES §4.4', sm);
list('Outside PO statuses', keys(PO_STATUSES), 'STATE_MACHINES §8', sm);
list('Yarn PO statuses', keys(YARN_PO_STATUSES), 'STATE_MACHINES §9', sm);
list('Yarn PO events', keys(YARN_PO_EVENT_KINDS), 'STATE_MACHINES §9', sm);
list('Yarn zones', keys(YARN_ZONES), 'STATE_MACHINES §9', sm);
list('Yarn ledger + beam move kinds', keys([...new Set([...YARN_MOVE_KINDS, ...BEAM_MOVE_KINDS])] as string[]), 'STATE_MACHINES §9', sm);
list('TFO program statuses', keys(['running', 'completed']), 'STATE_MACHINES §10', sm);
list('Warping job statuses', keys(WARPING_STATUSES), 'STATE_MACHINES §11', sm);
list('Beam statuses', keys(BEAM_STATUSES), 'STATE_MACHINES §12', sm);
list('Taka event kinds', keys(TAKA_EVENT_KINDS), 'STATE_MACHINES §14.1', sm);
list('Jobsheet event kinds', keys(jsEvents), 'STATE_MACHINES §14.2', sm);
list('Order events', keys(orderEvents), 'STATE_MACHINES §14.3', sm);
list('Order hold events', keys(holdEvents), 'STATE_MACHINES §14.3', sm);
list('Permissions', keys(Object.keys(ROLES.jemish.permissions)), 'ROLE_MATRIX §3', rm);
console.log('<!-- C -->\n' + out.join('\n'));

console.error(misses.length ? `UNMAPPED / MISSING (${misses.length}):\n` + misses.join('\n') : 'All items mapped.');

```

### roles-matrix.mts
```ts
// Prints the role × permission matrix, landing pages, nav items and master items per role (read from the real config).
// Usage (from the repo root): npx tsx <this file> <repo>
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const repo = process.argv[2];
const { ROLES, ROLE_KEYS } = await import(pathToFileURL(join(repo, 'shared/src/roles.ts')).href);
const { visibleStatusKeys, jobsheetStatusesForRole } = await import(pathToFileURL(join(repo, 'shared/src/statuses.ts')).href);

// nav-items.ts imports lucide-react icons; read the array textually instead.
const fs = await import('node:fs');
const nav = fs.readFileSync(join(repo, 'client/src/components/layout/nav-items.ts'), 'utf8');
const items = [...nav.matchAll(/\{ to: '([^']+)', label: '([^']+)'[^}]*permission: '(\w+)', group: '(\w+)'(?:, hideWith: '(\w+)')?(?:, phoneOrder: (\d))?/g)].map((m) => ({
  to: m[1], label: m[2], permission: m[3], group: m[4], hideWith: m[5], phoneOrder: m[6] ? Number(m[6]) : undefined,
}));

const perms = Object.keys(ROLES.jemish.permissions);
const yes = (r: string, p: string) => (ROLES[r].permissions[p] ? '✅' : '·');
console.log('| Permission | ' + ROLE_KEYS.join(' | ') + ' |');
console.log('|---|' + ROLE_KEYS.map(() => ':-:').join('|') + '|');
for (const p of perms) console.log(`| \`${p}\` | ` + ROLE_KEYS.map((r: string) => yes(r, p)).join(' | ') + ' |');
console.log();
for (const r of ROLE_KEYS) {
  const can = (p: string) => !!ROLES[r].permissions[p];
  const seen = new Set<string>();
  const vis = (group: string) =>
    items.filter((i) => {
      if (i.group !== group || !can(i.permission) || (i.hideWith && can(i.hideWith)) || seen.has(i.to + group)) return false;
      seen.add(i.to + group);
      return true;
    });
  const main = vis('main');
  const bar = [...main].sort((a, b) => (a.phoneOrder ?? 99) - (b.phoneOrder ?? 99));
  const barShown = bar.length <= 4 ? bar : bar.slice(0, 3);
  console.log(`## ${r} (${ROLES[r].name}) landing=${ROLES[r].landing} bilingual=${!!ROLES[r].bilingual}`);
  console.log('  nav (sidebar):', main.map((i) => `${i.label} ${i.to}`).join(' · '));
  console.log('  phone/tablet bar:', barShown.map((i) => i.label).join(' · '), bar.length > 4 ? `· More → ${bar.slice(3).map((i) => i.label).join(', ')}` : '');
  console.log('  masters page:', vis('masters').map((i) => i.label).join(' · ') || '(none)');
  console.log('  order statuses visible:', visibleStatusKeys(r).join(', ') || '(none)');
  console.log('  jobsheet statuses visible:', jobsheetStatusesForRole(r).join(', ') || '(none)');
}
```
