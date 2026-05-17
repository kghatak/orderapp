# Milk Procurement Module — API Audit

Mapping the full requirements spec against the APIs currently implemented under [milk/](milk/) and mounted at `/milk/*` in [index.js:170-174](index.js#L170-L174).

## Status legend

- ✅ **Exists** — API is implemented and matches requirement
- ✏️ **Needs modification** — API exists but is missing fields/behavior the spec calls for
- ➕ **New** — API does not exist; needs to be created
- ❓ **Clarification needed** — spec is ambiguous

---

## 1. App Dashboard (Home Screen)

| Requirement                            | API                                                                | Status | Notes |
|----------------------------------------|--------------------------------------------------------------------|--------|-------|
| Current Date                           | n/a (client-side)                                                  | ✅     | |
| Total Milk Purchased Today (Kg)        | `GET /milk/reports/daily` → `data.totalQuantity`                   | ✏️     | Stored as **litres** in [Procurement.js:7](milk/models/Procurement.js#L7); spec says **Kg**. See Gap #4. |
| Total Number of Suppliers              | `GET /milk/reports/daily` → `data.supplierCount`                   | ✏️     | Currently **today's contributing suppliers only** ([milkReportController.js:23](milk/controllers/milkReportController.js#L23)). Spec almost certainly means **total active suppliers in tenant**. |
| Total Amount for Today                 | `GET /milk/reports/daily` → `data.totalAmount`                     | ✅     | |
| Quick-action buttons (Add Entry, Supplier List, Reports, Payments, Settings) | Each maps to APIs covered in later sections | — | Settings — see Section 9 / Gap #7 |

**Recommendation:** add `GET /milk/dashboard` returning all four values plus `totalActiveSuppliers` in one payload — saves the client from making two calls.

---

## 2. Supplier Management

### Field coverage

| Spec field                              | Model field                          | Status | Notes |
|-----------------------------------------|--------------------------------------|--------|-------|
| Supplier ID (Auto Generated)            | `supplierCode` (`SUP00001`)          | ✅     | Generated in [supplierController.js:55-63](milk/controllers/supplierController.js#L55-L63) |
| Supplier Name                           | `name`                               | ✅     | |
| Mobile Number                           | `phone`                              | ✅     | |
| Address                                 | `address` + `village`                | ✅     | Model has both — keep, client maps to single field |
| **Milk Rate (Rate per Fat)**            | ❌ — not on Supplier model           | ➕     | **See Gap #1.** Critical. Rate currently only on Procurement records (₹/litre). |

### CRUD

| Function       | API                              | Status | Notes |
|----------------|----------------------------------|--------|-------|
| Add Supplier   | `POST /milk/suppliers`           | ✏️     | Add `milkRate` to payload — Gap #1 |
| Edit Supplier  | `PUT /milk/suppliers/:id`        | ✏️     | Add `milkRate` to allowed list at [supplierController.js:110](milk/controllers/supplierController.js#L110) — Gap #1 |
| Delete Supplier| `DELETE /milk/suppliers/:id`     | ✅     | Hard delete blocked when procurements/payments exist; suggests soft delete via `isActive:false` ([supplierController.js:144-154](milk/controllers/supplierController.js#L144-L154)) |
| Search Supplier| `GET /milk/suppliers?search=...` | ✅     | Searches name, supplierCode, phone, village ([supplierController.js:11-18](milk/controllers/supplierController.js#L11-L18)) |

---

## 3. Milk Purchase Entry

Records daily milk purchases.

### Field coverage

| Spec field      | Model field ([Procurement.js](milk/models/Procurement.js)) | Status | Notes |
|-----------------|---------------------------------------------------------------|--------|-------|
| Date            | `date`                                                        | ✅     | |
| Supplier Name (dropdown) | `supplierId` (ref Supplier)                          | ✅     | Client fetches dropdown via `GET /milk/suppliers` |
| **Shift (Morning / Evening)** | ❌ — not on model                              | ➕     | **See Gap #2.** Required by spec; also needed for Daily Report column. |
| Milk Quantity (Total Kg) | `quantity`                                           | ✏️     | Field is in **litres** per code comment; spec says **Kg**. See Gap #4. |
| Fat %           | `fat`                                                         | ✅     | |
| Rate (display — derived from supplier) | `rate` (snapshot of `supplier.ratePerFat`)        | ✏️     | Per resolved Gap #1, this is now a derived/read-only display field, snapshotted onto the procurement record at entry time. |
| Total Amount     | `amount` = `quantity × fat × supplier.ratePerFat`            | ✏️     | Formula change per resolved Gap #1. Today: [procurementController.js:86](milk/controllers/procurementController.js#L86) uses `quantity × rate`. |

### CRUD buttons

| Spec button | API                                | Status | Notes |
|-------------|------------------------------------|--------|-------|
| Save        | `POST /milk/procurements`          | ✅     | |
| Update      | `PUT /milk/procurements/:id`       | ✅     | Blocks update once `paymentStatus === 'paid'` ([procurementController.js:124-128](milk/controllers/procurementController.js#L124-L128)) — good guard |
| **Delete**  | ❌ — no DELETE endpoint            | ➕     | **See Gap #3.** Routes file [procurementRoutes.js](milk/routes/procurementRoutes.js) has GET/POST/PUT only — no DELETE. |

---

## 4. Daily Milk Report

Row-level + summary report. Columns: Date | Supplier | Shift | Kg | Rate | **Mtr** | Amount.

| Feature              | API                                                | Status | Notes |
|----------------------|----------------------------------------------------|--------|-------|
| Row data             | `GET /milk/procurements?fromDate&toDate&supplierId`| ✏️     | Endpoint exists; populates supplier; missing `shift` column. After Gap #2 it'll be returned. |
| Filter by Date       | `fromDate`/`toDate` query params                   | ✅     | [procurementController.js:16-17](milk/controllers/procurementController.js#L16-L17) |
| Filter by Supplier   | `supplierId` query param                           | ✅     | |
| Show Total Kg        | `GET /milk/reports/daily` → `totalQuantity`        | ✅     | |
| Show Total Amount    | `GET /milk/reports/daily` → `totalAmount`          | ✅     | |
| **Fat Meter Reading** (label "Mtr" in spec)| `fatMeterReading` (new field)             | ➕     | Float; raw analyser reading. See resolved Gap #6a. |

**Recommendation:** the report screen will need two calls (rows from `/milk/procurements` + totals from `/milk/reports/daily`). Acceptable, but consider a single `GET /milk/reports/daily/detailed?fromDate&toDate&supplierId` returning `{ rows, totals }` for one round-trip.

---

## 5. Payment Management

List view per supplier with: Total Milk, Total Amount, Paid, Pending.

| Feature             | API                                          | Status | Notes |
|---------------------|----------------------------------------------|--------|-------|
| Per-supplier balance (single) | `GET /milk/reports/supplier?supplierId` | ✏️ | Returns `totalProcurement`, `totalPaid`, `pending` ([milkReportController.js:71-85](milk/controllers/milkReportController.js#L71-L85)). **Missing `totalMilk` (Kg)** — spec column. See Gap #5. |
| **Per-supplier balance (list of ALL suppliers)** | ❌ — endpoint only handles one supplier at a time | ➕ | **See Gap #5.** This is the spec's main payment-screen view. |
| Pay Supplier        | `POST /milk/payments`                        | ✅     | Optionally marks linked procurements as `paid` ([milkPaymentController.js:100-105](milk/controllers/milkPaymentController.js#L100-L105)) |
| Payment History     | `GET /milk/payments?supplierId&fromDate&toDate` | ✅  | |

---

## 6. Reports & Analytics

| Report                | API                                          | Status | Notes |
|-----------------------|----------------------------------------------|--------|-------|
| Daily Milk Report     | `GET /milk/reports/daily` + `/milk/procurements` | ✅ | Covered in Section 4 |
| **Weekly Milk Report**| ❌                                           | ➕     | **See Gap #6.** Add `period` parameter or a separate endpoint. |
| **Monthly Milk Report**| ❌                                          | ➕     | Same. |
| Supplier Wise Report  | `GET /milk/reports/supplier`                 | ✏️     | Exists; needs `totalMilk` field (Gap #5) and ideally a list mode (Gap #5). |

**Recommendation:** parameterise the existing daily endpoint — `GET /milk/reports/summary?period=daily|weekly|monthly&date=...` — instead of three separate endpoints. Cleaner aggregation logic in one place.

---

## 7. SMS / WhatsApp Notifications

> Send daily milk reports to suppliers.

| Feature                                  | API | Status |
|------------------------------------------|-----|--------|
| Send daily report to all suppliers       | ❌  | ➕ — **see Gap #6** (Notifications) |
| Send to single supplier (ad-hoc)         | ❌  | ➕ |
| Templated message + channel preference   | ❌  | ➕ |

**Entirely new subsystem.** Decisions needed:
- **Provider:** Twilio (SMS + WhatsApp Business), MSG91 (popular in IN), Gupshup, etc.
- **Delivery model:** on-demand admin trigger (`POST /milk/notifications/send`) vs scheduled cron at end of day vs both.
- **Storage:** persist notification logs? (recommended — track delivery status).
- **Template:** spec says "Example Message" but the example text wasn't included — please share.

---

## 8. Data Backup / Export

| Feature                          | API | Status |
|----------------------------------|-----|--------|
| Excel Export (procurements)      | ❌  | ➕ — new |
| Excel Export (payments)          | ❌  | ➕ — new |
| Excel Export (suppliers)         | ❌  | ➕ — new |
| PDF Report (daily/weekly/monthly)| ❌  | ➕ — new |

**Note:** the order app already uses `html-pdf` (deprecated — see `npm warn` from earlier) for some reports. Suggest moving to `puppeteer` or `pdfkit` while building this out. `xlsx`/`exceljs` for the spreadsheet side.

Suggested endpoints:
- `GET /milk/export/procurements?format=xlsx|pdf&fromDate&toDate&supplierId`
- `GET /milk/export/payments?format=xlsx|pdf&fromDate&toDate`
- `GET /milk/export/suppliers?format=xlsx`
- `GET /milk/export/report?period=daily|weekly|monthly&format=pdf`

---

## 9. Login System

| Role          | Existing API                                                                  | Status | Notes |
|---------------|-------------------------------------------------------------------------------|--------|-------|
| Admin Login   | `POST /milk/auth/login` (falls back to Order-app Firestore admin & auto-creates MilkUser via [milkAuthController.js:103-106](milk/controllers/milkAuthController.js#L103-L106)) | ✅ | |
| **Staff Login**| ❌ — `role` enum on MilkUser is `['admin', 'supplier']` only ([MilkUser.js:5](milk/models/MilkUser.js#L5)) | ➕ | **See Gap #8.** |
| Supplier Login| `POST /milk/auth/signup` + `POST /milk/auth/login`                            | ✅     | |

---

## Summary of Gaps

### Gap #1 — Supplier "Rate per Fat" pricing model  ➕ + ✏️  **[RESOLVED — ready to implement]**

**Decision (confirmed).** The rate lives on the **Supplier** record. Each supplier can have a different `ratePerFat`. The per-entry "Rate" field shown in Section 3 is **derived from the supplier**, not an independent input.

**Formula:**
```
amount = quantity × fat × supplier.ratePerFat
```

**Required changes:**

1. **Model** — add to [milk/models/Supplier.js](milk/models/Supplier.js):
   ```js
   ratePerFat: { type: Number, default: 0 }   // ₹ per fat-point per Kg
   ```
2. **Supplier endpoints** — accept `ratePerFat` in create ([supplierController.js:68](milk/controllers/supplierController.js#L68)) and allowed-updates ([supplierController.js:110](milk/controllers/supplierController.js#L110)).
3. **Procurement amount calculation** — at [procurementController.js:86](milk/controllers/procurementController.js#L86) and [:136](milk/controllers/procurementController.js#L136):
   - Compute `amount = quantity × fat × supplier.ratePerFat` using the supplier's current rate.
   - **Snapshot `ratePerFat` onto the Procurement record** at time of creation, so a later change to the supplier's rate does not retroactively alter historical amounts. This is the dairy-industry-standard approach.
4. **Procurement model** — change `rate` semantics from "₹/litre" to a snapshot of the supplier's `ratePerFat` at entry time. Keep the field name `rate` (acceptable) or rename to `ratePerFat` for clarity. Recommend rename + drop the "// per litre" comment from [Procurement.js:10](milk/models/Procurement.js#L10).
5. **Section 3 entry screen** — the "Rate" input becomes a read-only display, auto-populated from `supplier.ratePerFat` after the supplier dropdown selection.

### Gap #2 — Procurement `shift` field  ➕

**Problem.** Section 3 spec field `Shift (Morning/Evening)` and Section 4 report column `Shift` are not on the model.

**Changes:**
1. Add to [Procurement.js](milk/models/Procurement.js):
   ```js
   shift: { type: String, enum: ['morning', 'evening'], required: true }
   ```
2. Accept `shift` in `createProcurement` and `updateProcurement`.
3. Add optional `shift` filter to `listProcurements` and `dailySummary`.
4. Consider uniqueness: should `(tenantId, supplierId, date, shift)` be unique to prevent duplicate entries for the same supplier on the same shift? Likely yes — discuss.

### Gap #3 — Delete procurement  ➕

[procurementRoutes.js](milk/routes/procurementRoutes.js) has no DELETE. Section 3 button list has Delete.

**Changes:**
1. Add `DELETE /milk/procurements/:id` to routes, admin-only.
2. Controller should refuse to delete if `paymentStatus === 'paid'` (mirrors the existing update guard) — instead require unlinking the payment first.

### Gap #4 — Unit consistency: Kg vs litres  ✏️

Spec says **Kg** throughout (Sections 1, 3, 4, 5). [Procurement.js:7](milk/models/Procurement.js#L7) comment says **litres**. Currently the values aren't converted — they're just labelled differently.

**Decision needed.** Simplest fix: drop the misleading comment, treat `quantity` as Kg uniformly, and update [config/db.js](config/db.js) seed/test data accordingly. No conversion logic required if the unit is just renamed.

### Gap #5 — Payment Management list view & "Total Milk"  ➕ + ✏️

**Two issues:**

**5a — Missing list view.** Section 5 implies a screen listing **all suppliers** with their balances. `GET /milk/reports/supplier` only handles one supplier per call.

**Fix:** add `GET /milk/payments/balances` (or `GET /milk/reports/suppliers`):
```json
{
  "data": [
    { "supplierId": "...", "supplierName": "...", "totalMilk": 0, "totalAmount": 0, "paidAmount": 0, "pendingAmount": 0 },
    ...
  ]
}
```
With `fromDate`/`toDate` filters. Implementation: aggregation pipeline joining Suppliers → Procurements → MilkPayments.

**5b — Missing `totalMilk` (Kg).** `GET /milk/reports/supplier` doesn't return total quantity ([milkReportController.js:71-85](milk/controllers/milkReportController.js#L71-L85)). Add it.

### Gap #6a — Fat Meter Reading on Procurement  ➕  **[RESOLVED — ready to implement]**

**Decision (confirmed).** The Section 4 "Mtr" column is **Fat Meter Reading** — the raw fat reading from the milk analyser, stored as a Float. Distinct from `fat` (the fat % used for pricing).

**Changes:**
1. Add to [milk/models/Procurement.js](milk/models/Procurement.js):
   ```js
   fatMeterReading: { type: Number, default: 0 }
   ```
2. Accept `fatMeterReading` in `createProcurement` and `updateProcurement`.
3. Return it in `listProcurements` (used by the Daily Report column).
4. Display label everywhere: **"Fat Meter Reading"** (not "Mtr").

### Gap #6b — Weekly / Monthly reports  ➕

**Reports (Section 6).** Add weekly + monthly. Recommend parameterising the existing daily endpoint:
```
GET /milk/reports/summary?period=daily|weekly|monthly&date=<anchor-date>
```
Mongo aggregation can group by `$dateTrunc`.

### Gap #7 — Settings API  🟡 **[DEFERRED]**

Section 1 has a Settings button but scope is undefined. **Deferred — revisit when scope is decided.** Frontend can hide the button until then or wire it to a placeholder screen.

### Gap #8 — Staff Login & role  ➕

Section 9 lists Admin / Staff / Supplier. Current `MilkUser.role` enum is `['admin', 'supplier']` ([MilkUser.js:5](milk/models/MilkUser.js#L5)).

**Changes:**
1. Add `'staff'` to role enum.
2. Decide staff permissions (likely: can create procurements & view reports, cannot manage suppliers or process payments).
3. Update `requireRole(...)` usage on each route to include `'staff'` where appropriate.
4. Provision flow — admin creates staff accounts. `/milk/auth/signup` currently rejects anything except `supplier` ([milkAuthController.js:21-24](milk/controllers/milkAuthController.js#L21-L24)) — either relax for admin-authenticated callers, or add an `admin-only POST /milk/users` endpoint.

### Gap #9 — Notifications (SMS/WhatsApp)  🟡 **[DEFERRED]**

Section 7 notification subsystem is **deferred**. Revisit when a provider (Twilio / MSG91 / Gupshup) is chosen and the message template is available.

### Gap #10 — Data Export (Excel/PDF)  ➕

Section 8 — see endpoint suggestions under Section 8 above. Pick libraries: `exceljs` for xlsx; replace deprecated `html-pdf` with `puppeteer` or `pdfkit` for PDF.

---

## Prioritised action items

### Resolved decisions (locked in)
- **Gap #1** — Supplier-level `ratePerFat`; formula `amount = qty × fat × supplier.ratePerFat`; snapshot rate onto Procurement at entry.
- **Gap #6a** — "Mtr" = **Fat Meter Reading**, new Float field on Procurement.
- **Gap #4** — Treat `quantity` as **Kg** throughout (rename comment in Procurement model).
- **Gap #7** — Settings: deferred.
- **Gap #9** — Notifications: deferred.

### High-priority backend changes (now unblocked)
1. Add `ratePerFat` to Supplier model + create/update endpoints (Gap #1).
2. Change Procurement amount formula to `qty × fat × supplier.ratePerFat`; snapshot supplier rate onto the Procurement record (Gap #1).
3. Add `fatMeterReading` (Float) to Procurement model + endpoints + report response (Gap #6a).
4. Add `shift` (morning/evening) to Procurement model + endpoints + report filter (Gap #2).
5. Add `DELETE /milk/procurements/:id` admin-only; refuse if `paymentStatus === 'paid'` (Gap #3).
6. Add `totalMilk` (Kg) to `GET /milk/reports/supplier` (Gap #5b).
7. Add `totalActiveSuppliers` to dashboard payload (Section 1) — either extend `/milk/reports/daily` or create `/milk/dashboard`.
8. Rename/clarify `quantity` unit from litres → Kg (Gap #4).

### Medium-priority new features
9. `GET /milk/payments/balances` — list view of all supplier balances (Gap #5a).
10. Weekly/monthly reports — parameterise `/milk/reports/summary` (Gap #6b).
11. Staff role + admin-provisioned staff accounts (Gap #8).

### Larger new subsystems
12. Excel/PDF export endpoints (Gap #10).

### Deferred (revisit later)
- Notifications API (Gap #9) — pending provider choice + message template.
- Settings API (Gap #7) — pending scope.

---

## Endpoint inventory (current state)

| Method | Path                          | Auth         | Role           | File |
|--------|-------------------------------|--------------|----------------|------|
| POST   | `/milk/auth/signup`           | public       | supplier-only  | [milkAuthRoutes.js:6](milk/routes/milkAuthRoutes.js#L6) |
| POST   | `/milk/auth/login`            | public       | any            | [milkAuthRoutes.js:7](milk/routes/milkAuthRoutes.js#L7) |
| GET    | `/milk/suppliers`             | JWT + tenant | any            | [supplierRoutes.js:11](milk/routes/supplierRoutes.js#L11) |
| GET    | `/milk/suppliers/:id`         | JWT + tenant | any            | [supplierRoutes.js:12](milk/routes/supplierRoutes.js#L12) |
| POST   | `/milk/suppliers`             | JWT + tenant | admin          | [supplierRoutes.js:13](milk/routes/supplierRoutes.js#L13) |
| PUT    | `/milk/suppliers/:id`         | JWT + tenant | admin          | [supplierRoutes.js:14](milk/routes/supplierRoutes.js#L14) |
| DELETE | `/milk/suppliers/:id`         | JWT + tenant | admin          | [supplierRoutes.js:15](milk/routes/supplierRoutes.js#L15) |
| GET    | `/milk/procurements`          | JWT + tenant | any (scoped)   | [procurementRoutes.js:16](milk/routes/procurementRoutes.js#L16) |
| GET    | `/milk/procurements/:id`      | JWT + tenant | any (scoped)   | [procurementRoutes.js:17](milk/routes/procurementRoutes.js#L17) |
| POST   | `/milk/procurements`          | JWT + tenant | admin          | [procurementRoutes.js:18](milk/routes/procurementRoutes.js#L18) |
| PUT    | `/milk/procurements/:id`      | JWT + tenant | admin          | [procurementRoutes.js:19](milk/routes/procurementRoutes.js#L19) |
| GET    | `/milk/payments`              | JWT + tenant | any (scoped)   | [milkPaymentRoutes.js:11](milk/routes/milkPaymentRoutes.js#L11) |
| GET    | `/milk/payments/:id`          | JWT + tenant | any (scoped)   | [milkPaymentRoutes.js:12](milk/routes/milkPaymentRoutes.js#L12) |
| POST   | `/milk/payments`              | JWT + tenant | admin          | [milkPaymentRoutes.js:13](milk/routes/milkPaymentRoutes.js#L13) |
| GET    | `/milk/reports/daily`         | JWT + tenant | admin          | [milkReportRoutes.js:11](milk/routes/milkReportRoutes.js#L11) |
| GET    | `/milk/reports/supplier`      | JWT + tenant | any (scoped)   | [milkReportRoutes.js:12](milk/routes/milkReportRoutes.js#L12) |
