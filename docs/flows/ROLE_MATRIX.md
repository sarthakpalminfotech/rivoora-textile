# Rivoora Textile — Role Matrix

Built from `shared/src/roles.ts` (permissions), the server permission checks (`requirePermission` in
`server/src/routes/*.ts`, the hold guard, service-level visibility) and the client route guards / nav
(`client/src/App.tsx`, `components/layout/nav-items.ts`). Commit `b4fd6be`.

Legend: ✅ can do · 👁 view only · ✖ no access. Operation IDs refer to `FLOW_INVENTORY.md`.
Roles: **J** Jenish (owner, key `jemish`) · **G** Gaurang (partner) · **S** Supervisor · **T** Taka entry · **Q** QC ·
**GS** Godown supervisor · **D** Dhruvil. J and G can additionally *act as* any role (AUTH-04); the matrix shows each
role's own rights.

Every write on a **held** order is refused for everyone (J included) except receiving and hold / release; every write on
a **closed** order likewise except receiving, QC of returning takas and goods return (`GRD`).

---

## 1. Per role: landing, navigation, what they never see

Produced mechanically (see `COVERAGE_CHECK.md` §C for the script). Phone / tablet bar holds at most 4 items; the rest go
into **More**.

| Role | Landing | Sidebar (desktop) | Phone / tablet bar | Masters page | Order statuses visible | Bilingual |
|---|---|---|---|---|---|---|
| Jenish | `/orders` | Orders · Machine view · Butta cutting · Mill · Inventory · Dispatched · Yarn inventory · Yarn PO · Masters | Orders · Machine view · Inventory · More (Butta cutting, Mill, Dispatched, Yarn inventory, Yarn PO, Masters) | Customers · Materials · Designs · Machines · Damage master · Butta parties · Mill parties · Weavers · Yarn parties · Yarn qualities · TFO machines · Users | all 19 | no |
| Gaurang | `/orders` (order details open on Jobsheets while Jobsheet pending) | same as Jenish | same | same (Customers / Materials read-only) | all except Pending for production | no |
| Supervisor | `/jobsheets` | Orders · Jobsheets · Machine view · Yarn inventory · Yarn PO | Machine view · Orders · Jobsheets · More (Yarn inventory, Yarn PO) | — | Jobsheet created, In production, Production completed, Taka entry done | no |
| Taka entry | `/scan` | Scan jobsheet · Jobsheets | Scan jobsheet · Jobsheets | — | none (jobsheets only: all 4 jobsheet statuses) | yes |
| QC | `/qc` | QC | QC | — | none | yes |
| Godown supervisor | `/butta` | Orders · Butta cutting · Mill · Receive goods | Orders · Butta cutting · Mill · Receive goods | — | In production → Returned (not Closed) | no |
| Dhruvil | `/godown/orders` | Orders (godown) · Dispatched · Receive goods · Design library | same 4 | — | At outside weaver, Awaiting goods, In godown, Partly dispatched, Dispatched, Returned (status visibility only; godown screens are not filtered by status) | no |
| Yarn inventory supervisor (Sprint 20) | `/yarn` | Yarn inventory · Yarn PO | Yarn inventory · Yarn PO | — | none | no |

**Never sees**

| Role | Never sees |
|---|---|
| Jenish | — |
| Gaurang | Orders that are "Pending for production"; Hold / Release buttons |
| Supervisor | Client, broker, phone, rate; Pending (not sent) jobsheets; orders without the Production step; orders after Taka entry done in his Orders list; held / closed orders; masters; butta / mill / godown / dispatch / inventory; yarn rates and amounts |
| Taka entry | Client, rate, all order screens; masters; jobsheet details beyond order number; held / closed orders' jobsheets |
| QC | Client, rate; order screens; any list (only a taka-number box); held orders |
| Godown supervisor | Client, broker, phone, rate (orders, challans, Receive goods); Jobsheets tab and Order details tab; orders with no takas; held / closed orders; dispatch; inventory; masters; the whole yarn area (Sprint 20) |
| Dhruvil | Inventory module (only free stock inside the Add-from-free-stock dialog); Orders module (Jenish's); butta / mill / QC screens; masters except the view-only Design library; held orders; closed orders in godown lists |
| Yarn inventory supervisor | Everything outside yarn; Yarn PO create / edit / close / cancel / print; rates and amounts; creating TFO programs / warping jobs; manual add / remove; masters (only the ➕ quick add of a warping quality on Stop / Mark done) |

---

## 2. Operations × roles

### Login and admin
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| AUTH-01..03 | Log in / session / log out | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| AUTH-04 | Switch role (act as) | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| USR-01..04 | Users master (list, add, edit, reset password) | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |

### Masters
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| CUS-01, CUS-06 | Customers list / read | ✅ | 👁 | ✖ | ✖ | ✖ | ✖ | ✖ |
| CUS-02 | Add customer | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| CUS-03, CUS-04 | Edit / delete customer | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| CUS-05 | Client's saved designs | ✅ | 👁 | ✖ | ✖ | ✖ | ✖ | ✖ |
| MAT-01 | Materials list | ✅ | 👁 | ✖ | ✖ | ✖ | ✖ | ✖ |
| MAT-02..04 | Add / edit / delete material | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| DES-01..03 | Browse design library | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | 👁 |
| DES-04..08 | Add / edit / delete / Upload many / code check | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ (code check 👁) |
| MAC-01 | Machines list | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| MAC-02..04 | Add / edit / delete machine | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| DMG-01 | Damage master list | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| DMG-02..04 | Add / edit / delete damage name | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| DMG-05 | "Other" damage name auto-added | ✅ | ✅ | ✖ | ✅ | ✅ | ✖ | ✅ |
| PTY-01..04 | Butta / mill parties | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| WEV-01..04 | Weavers | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| YM-01..03 | Yarn parties / qualities / TFO machines | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| YM-04 | Quick-add party / quality from Yarn PO | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |

### Orders
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| ORD-01 | Orders list / filters / search | ✅ | ✅ | 👁 (production phase) | ✖ | ✖ | 👁 (orders with takas) | ✖ |
| ORD-02 | Add order | ✅ | ✖ (the screen opens, save is refused) | ✖ | ✖ | ✖ | ✖ | ✖ |
| ORD-03 | Design picker + stock panel | ✅ | ✅ (edit) | ✖ | ✖ | ✖ | ✖ | ✖ |
| ORD-04 | Edit order | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| ORD-05 | Change steps | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| ORD-06 | Send for production | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| ORD-07 | Undo send for production | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| HLD-01, HLD-02 | Hold / release | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| HLD-03, HLD-04 | Close order | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |

### Order details tabs
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| ODT-01 | Header (client / rate by permission) | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 | ✖ |
| ODT-02, ODT-03 | Dashboard + drawers | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 (without Production) | ✖ |
| ODT-04 | Jobsheets tab | ✅ | ✅ | 👁 | ✖ | ✖ | ✖ | ✖ |
| ODT-05 | Outside production tab | ✅ | ✅ | ✖ | ✖ | ✖ | 👁 + receive (once a PO exists and the order has takas) | ✖ (receives via Receive goods) |
| ODT-06 | Takas tab | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 | ✖ |
| ODT-07 | Damages tab | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 | ✖ |
| ODT-08 | Order details tab | ✅ | ✅ | 👁 | ✖ | ✖ | ✖ | ✖ |
| ODT-09 | History tab | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 | ✖ |
| ODT-10 | Docs tab (delivery challans only for dispatch roles) | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 | ✖ |

### Production
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| JS-01..04 | Create / add / edit / delete jobsheets | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| JS-05, JS-06 | Send to supervisor / pull back | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| JS-07 | Print jobsheets | ✅ | ✅ | ✅ (not Pending) | ✖ | ✖ | ✖ | ✖ |
| JS-08 | Jobsheet details | ✅ | ✅ | 👁 (order no only) | 👁 (as entry screen) | ✖ | ✖ | ✖ |
| JS-09 | Coverage / given-outside line | ✅ | ✅ | 👁 | ✖ | ✖ | ✖ | ✖ |
| SUP-01, SUP-02 | Supervisor Jobsheets (All / Order view) | ✖ | ✖ | ✅ | ✖ | ✖ | ✖ | ✖ |
| SUP-03..05 | Start (& print) / Complete / Change machine | ✖ | ✖ | ✅ | ✖ | ✖ | ✖ | ✖ |
| SUP-06 | Supervisor Orders | — | — | 👁 | ✖ | ✖ | ✖ | ✖ |
| MV-01 | Machine view | 👁 | 👁 | 👁 | ✖ | ✖ | ✖ | ✖ |

### Takas
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| TE-01..03 | Scan / QR / Taka jobsheets list | ✖ (QR link opens jobsheet details) | ✖ (same) | ✖ (same, not Pending) | ✅ | ✖ | ✖ | ✖ |
| TE-04, TE-05 | Enter takas / number preview | ✖ | ✖ | ✖ | ✅ | ✖ | ✖ | ✖ |
| ET-01, ET-02 | Edit takas (jobsheet / receipt) | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| ET-03 | Live number check | ✅ | ✅ | ✖ | ✅ | ✖ | ✅ | ✅ |
| TKD-01 | Taka drawer | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 | ✖ |
| TKD-02, TKD-03 | Damage details + share photo | ✅ | ✅ | 👁 | ✖ | ✖ | 👁 | 👁 |
| TKD-04 | Find taka by number | ✅ | ✅ | ✖ | ✖ | ✅ | ✅ | ✅ |

### Outside production / FG
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| OUT-01..04 | Create / edit / cancel / close PO | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| OUT-05 | Print PO | ✅ | ✅ | ✖ | ✖ | ✖ | ✅ | ✅ |
| OUT-06 | Receive weaver challan | ✅ | ✅ | ✖ | ✖ | ✖ | ✅ (no client / rate) | ✅ |
| OUT-07 | Receive goods module | ✅ (API; not in nav) | ✅ (API; not in nav) | ✖ | ✖ | ✖ | ✅ | ✅ |
| FG-01, FG-02 | Receive FG (lump / pcs lot) | ✅ | ✅ | ✖ | ✖ | ✖ | ✅ | ✅ |

### Butta cutting / QC / Mill / Rework
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| BUT-01..09 | Butta: pending, send, lists, details, print, receive, undo | ✅ | ✅ | ✖ | ✖ | ✖ | ✅ | ✖ |
| BUT-10 | Cancel butta challan | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| QC-01..03 | QC home, Butta QC, Mill QC | ✖ (only by acting as QC) | ✖ (same) | ✖ | ✖ | ✅ | ✖ | ✖ |
| MIL-01..07 | Mill: pending, refinish, send, lists, details, print, received count | ✅ | ✅ | ✖ | ✖ | ✖ | ✅ | ✖ |
| MIL-08 | Cancel mill challan | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| RW-01, RW-02 | Send back to butta / mill | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |

### Godown, dispatch, free stock, inventory
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| GD-01, GD-02, GD-10 | Godown orders list / screen / Damage tab | ✅ (not in nav; reached by URL / links) | ✅ (same) | ✖ | ✖ | ✖ | ✖ | ✅ |
| GD-03..09 | Tick, edit pcs, split, mark damage, resolve, refinish, ready for dispatch | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✅ |
| DSP-01, DSP-02 | Dispatch + print DC | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✅ |
| DSP-03, DSP-04 | Dispatched module | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✅ |
| DSP-05, DSP-06 | Goods return | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✅ |
| FS-01, FS-02 | Move to inventory / Add from free stock | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✅ |
| FS-03 | Assign to order (from Inventory) | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| FS-04 | Mark as fresh | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| INV-01..06 | Inventory screens | 👁 | 👁 | ✖ | ✖ | ✖ | ✖ | ✖ (free stock of one item inside FS-02 only) |

### Yarn
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| YPO-01, YPO-04 | Yarn PO list / details (rates hidden for S, Y) | ✅ | ✅ | 👁 | 👁 | ✖ | ✖ | ✖ | ✖ |
| YPO-02, YPO-03, YPO-06..08 | Create / edit / close / cancel / print | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| YPO-05 | Receive yarn challan into a zone | ✅ | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ |
| YRN-01..03, YRN-06, YRN-09 | Yarn summary, zones, movements, TFO board, history | ✅ | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ |
| YRN-04, YRN-05 | Transfer / withdraw | ✅ | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ |
| YRN-07, YRN-08 | Start / stop TFO program | ✅ | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ |
| YRN-10, YRN-11 | Start warping / mark done | ✅ | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ |
| YRN-20 | Create TFO programs / warping jobs (Pending; reserves stock) — `canPlanYarn` | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |
| YRN-21 | Edit / cancel / start pending programs and jobs; stop with boxes; done with beams | ✅ | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ |
| YRN-22 | Manual add / remove stock — `canAdjustYarnStock` | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ | ✖ |

### Other
| Op | Description | J | G | S | T | Q | GS | D |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| PRN-01 | Jobsheet print | ✅ | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ |
| PRN-02, PRN-03 | Butta / mill challan print | ✅ | ✅ | ✖ | ✖ | ✖ | ✅ | ✖ |
| PRN-04 | Delivery challan print | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✅ |
| PRN-05 | Outside PO print | ✅ | ✅ | ✖ | ✖ | ✖ | ✅ | ✅ |
| PRN-06 | Yarn PO print | ✅ | ✅ | ✖ | ✖ | ✖ | ✖ | ✖ |
| UPL-01 | Upload images | ✅ all | ✅ all | ✖ | ✖ | ✅ damage photos | ✅ damage photos | ✅ damage photos |

---

## 3. Permission × role (raw config)

Generated from `shared/src/roles.ts` by `scratchpad/roles-matrix.mts` (command in `COVERAGE_CHECK.md` §C).

| Permission | Jenish | Gaurang | Supervisor | Taka entry | Godown sup. | QC | Dhruvil |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `canViewOrders` | ✅ | ✅ | · | · | · | · | · |
| `canViewMasters` | ✅ | ✅ | · | · | · | · | · |
| `canSeeRate` | ✅ | ✅ | · | · | · | · | ✅ |
| `canSeeClient` | ✅ | ✅ | · | · | · | · | ✅ |
| `canAddOrder` | ✅ | · | · | · | · | · | · |
| `canEditOrder` | ✅ | ✅ | · | · | · | · | · |
| `canSendToProduction` | ✅ | · | · | · | · | · | · |
| `canUndoProduction` | ✅ | · | · | · | · | · | · |
| `canManageMasters` | ✅ | · | · | · | · | · | · |
| `canManageDamages` | ✅ | ✅ | · | · | · | · | · |
| `canManageJobsheets` | ✅ | ✅ | · | · | · | · | · |
| `canManageMachines` | ✅ | ✅ | · | · | · | · | · |
| `canViewJobsheetsModule` | · | · | ✅ | · | · | · | · |
| `canRunJobsheets` | · | · | ✅ | · | · | · | · |
| `canPrintJobsheets` | ✅ | ✅ | ✅ | · | · | · | · |
| `canViewMachineView` | ✅ | ✅ | ✅ | · | · | · | · |
| `canUseTakaModules` | · | · | · | ✅ | · | · | · |
| `canEnterTakas` | · | · | · | ✅ | · | · | · |
| `canEditTakas` | ✅ | ✅ | · | · | · | · | · |
| `canViewTakas` | ✅ | ✅ | ✅ | ✅ | ✅ | · | · |
| `canUseButtaModule` | ✅ | ✅ | · | · | ✅ | · | · |
| `canCancelChallan` | ✅ | ✅ | · | · | · | · | · |
| `canManageButtaParties` | ✅ | ✅ | · | · | · | · | · |
| `canButtaQc` | · | · | · | · | · | ✅ | · |
| `canUseMillModule` | ✅ | ✅ | · | · | ✅ | · | · |
| `canManageMillParties` | ✅ | ✅ | · | · | · | · | · |
| `canMillQc` | · | · | · | · | · | ✅ | · |
| `canUseGodownOrders` | ✅ | ✅ | · | · | · | · | ✅ |
| `canViewInventory` | ✅ | ✅ | · | · | · | · | · |
| `canViewProductionOrders` | · | · | ✅ | · | · | · | · |
| `canReworkTakas` | ✅ | ✅ | · | · | · | · | · |
| `canDispatch` | ✅ | ✅ | · | · | · | · | ✅ |
| `canGoodsReturn` | ✅ | ✅ | · | · | · | · | ✅ |
| `canMoveToInventory` | ✅ | ✅ | · | · | · | · | ✅ |
| `canMarkFresh` | ✅ | ✅ | · | · | · | · | · |
| `canSwitchRoles` | ✅ | ✅ | · | · | · | · | · |
| `canManageUsers` | ✅ | ✅ | · | · | · | · | · |
| `canHoldOrder` | ✅ | · | · | · | · | · | · |
| `canSeeHeldOrders` | ✅ | ✅ | · | · | · | · | · |
| `canViewGodownOrders` | · | · | · | · | ✅ | · | · |
| `canEditOrderSteps` | ✅ | ✅ | · | · | · | · | · |
| `canManageWeavers` | ✅ | ✅ | · | · | · | · | · |
| `canCreateOutsidePo` | ✅ | ✅ | · | · | · | · | · |
| `canReceiveOutside` | ✅ | ✅ | · | · | ✅ | · | ✅ |
| `canCloseOrder` | ✅ | ✅ | · | · | · | · | · |
| `canManageYarnMasters` | ✅ | ✅ | · | · | · | · | · |
| `canManageYarnPo` | ✅ | ✅ | · | · | · | · | · |
| `canReceiveYarn` | ✅ | ✅ | ✅ | · | · (Sprint 20) | · | · |
| `canViewYarn` | ✅ | ✅ | ✅ | · | · (Sprint 20) | · | · |
| `canUseYarnInventory` | ✅ | ✅ | ✅ | · | · (Sprint 20) | · | · |
| `canPlanYarn` (Sprint 20) | ✅ | ✅ | · | · | · | · | · |
| `canAdjustYarnStock` (Sprint 20) | ✅ | ✅ | · | · | · | · | · |

The Yarn inventory supervisor (`yarn_supervisor`, Sprint 20) has exactly `canViewYarn`, `canReceiveYarn`, `canUseYarnInventory` — nothing else.
| `canViewDesignLibrary` | ✅ | ✅ | · | · | · | · | ✅ |
| `canManageDesigns` | ✅ | ✅ | · | · | · | · | · |

**Notes on the matrix**
- Gaurang may **Close** an order but not **Hold** it, and may edit an order he can't add or send for production.
- `canViewTakas` is on for Taka entry, but he only sees takas on his own entry screen (no Orders access).
- `canUseGodownOrders` is on for Jenish / Gaurang, but the godown Orders item is hidden from their nav (`hideWith: canViewOrders`).
- QC has no list of pending work (the pending endpoints exist but the screen was removed).
