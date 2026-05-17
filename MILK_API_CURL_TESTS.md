# Milk Module — CURL Test Commands

Quick reference of `curl` commands to exercise every endpoint under `/milk/*`. Designed to be copy-pasted into a bash shell sequentially.

> Reflects the schema changes from the audit: `supplier.ratePerFat`, `procurement.shift`, `procurement.fatMeterReading`, formula `amount = quantity × fat × supplier.ratePerFat`, and the new `DELETE /milk/procurements/:id` route.

---

## Setup

```bash
# Adjust to match your environment
export BASE_URL=http://localhost:5020
export TENANT_ID=<your-tenant-id>
export ADMIN_PHONE=<your-admin-phone>
export ADMIN_PASSWORD=<your-admin-password>
```

## 1. Authentication

### Admin login (bridges from Order app admin → MilkUser)
```bash
export ADMIN_TOKEN=$(curl -s -X POST "$BASE_URL/milk/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"phone\": \"$ADMIN_PHONE\",
    \"password\": \"$ADMIN_PASSWORD\"
  }" | jq -r '.data.token')

echo "Admin token: $ADMIN_TOKEN"
```

### Supplier signup (public)
```bash
curl -X POST "$BASE_URL/milk/auth/signup" \
  -H 'Content-Type: application/json' \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"role\": \"supplier\",
    \"name\": \"Test Supplier\",
    \"phone\": \"9999900001\",
    \"email\": \"supplier1@example.com\",
    \"password\": \"supplier-pass\"
  }"
```

### Supplier login
```bash
export SUPPLIER_TOKEN=$(curl -s -X POST "$BASE_URL/milk/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{
    \"tenantId\": \"$TENANT_ID\",
    \"phone\": \"9999900001\",
    \"password\": \"supplier-pass\"
  }" | jq -r '.data.token')

echo "Supplier token: $SUPPLIER_TOKEN"
```

---

## 2. Supplier Management

### Create supplier (with `ratePerFat`)
```bash
export SUPPLIER_ID=$(curl -s -X POST "$BASE_URL/milk/suppliers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Ramesh Dairy",
    "phone": "9876543210",
    "village": "Khordha",
    "address": "Plot 23, Main Road",
    "milkType": "cow",
    "bankAccountNo": "1234567890",
    "bankName": "SBI",
    "ifscCode": "SBIN0001234",
    "ratePerFat": 6.5
  }' | jq -r '.data._id')

echo "Created supplier _id: $SUPPLIER_ID"
```

### List suppliers (pagination + search)
```bash
# All
curl -s "$BASE_URL/milk/suppliers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Search
curl -s "$BASE_URL/milk/suppliers?search=Ramesh&limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Active only
curl -s "$BASE_URL/milk/suppliers?isActive=true" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Get one supplier
```bash
curl -s "$BASE_URL/milk/suppliers/$SUPPLIER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Update supplier (e.g., change rate)
```bash
curl -X PUT "$BASE_URL/milk/suppliers/$SUPPLIER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "ratePerFat": 7.0,
    "village": "Khordha East"
  }'
```

### Delete supplier
```bash
# Hard delete only works if no procurements/payments exist
curl -X DELETE "$BASE_URL/milk/suppliers/$SUPPLIER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Soft delete (use after data exists)
curl -X PUT "$BASE_URL/milk/suppliers/$SUPPLIER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"isActive": false}'
```

---

## 3. Milk Purchase Entry (Procurement)

### Create procurement
Formula: `amount = quantity × fat × supplier.ratePerFat` — snapshotted at entry time.
```bash
export PROCUREMENT_ID=$(curl -s -X POST "$BASE_URL/milk/procurements" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"supplierId\": \"$SUPPLIER_ID\",
    \"date\": \"2026-05-17\",
    \"shift\": \"morning\",
    \"quantity\": 12.5,
    \"fat\": 4.2,
    \"snf\": 8.5,
    \"fatMeterReading\": 4.18,
    \"remarks\": \"Tested OK\"
  }" | jq -r '.data._id')

echo "Created procurement _id: $PROCUREMENT_ID"
# Expected amount = 12.5 × 4.2 × 7.0 = 367.5 (using updated supplier rate)
```

### List procurements (filters)
```bash
# All recent
curl -s "$BASE_URL/milk/procurements?limit=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# By supplier
curl -s "$BASE_URL/milk/procurements?supplierId=$SUPPLIER_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# By date range
curl -s "$BASE_URL/milk/procurements?fromDate=2026-05-01&toDate=2026-05-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# By shift
curl -s "$BASE_URL/milk/procurements?shift=morning" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Unpaid only
curl -s "$BASE_URL/milk/procurements?paymentStatus=pending" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Get one procurement
```bash
curl -s "$BASE_URL/milk/procurements/$PROCUREMENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Update procurement (recomputes amount)
```bash
curl -X PUT "$BASE_URL/milk/procurements/$PROCUREMENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "fat": 4.5,
    "fatMeterReading": 4.48
  }'
# Blocked with 400 if procurement is already paid.
```

### Delete procurement
```bash
curl -X DELETE "$BASE_URL/milk/procurements/$PROCUREMENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Blocked with 400 if procurement is already paid.
```

---

## 4. Payments

### Create payment (optionally settle procurements)
```bash
export PAYMENT_ID=$(curl -s -X POST "$BASE_URL/milk/payments" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{
    \"supplierId\": \"$SUPPLIER_ID\",
    \"amount\": 367.5,
    \"paymentDate\": \"2026-05-18\",
    \"paymentMode\": \"upi\",
    \"referenceNo\": \"UPI-12345\",
    \"procurementIds\": [\"$PROCUREMENT_ID\"],
    \"remarks\": \"Weekly payout\"
  }" | jq -r '.data._id')

echo "Created payment _id: $PAYMENT_ID"
```

### List payments
```bash
# All
curl -s "$BASE_URL/milk/payments" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# By supplier + date range
curl -s "$BASE_URL/milk/payments?supplierId=$SUPPLIER_ID&fromDate=2026-05-01&toDate=2026-05-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Get one payment (includes linked procurements)
```bash
curl -s "$BASE_URL/milk/payments/$PAYMENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

---

## 5. Reports

### Daily summary (dashboard payload)
Returns `totalQuantity`, `totalAmount`, `supplierCount` (today's contributors), `totalActiveSuppliers` (all-time active count), `recordCount`.
```bash
# Today
curl -s "$BASE_URL/milk/reports/daily" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Specific date
curl -s "$BASE_URL/milk/reports/daily?date=2026-05-17" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

### Supplier summary (includes `totalMilk` Kg)
```bash
# Admin querying a specific supplier
curl -s "$BASE_URL/milk/reports/supplier?supplierId=$SUPPLIER_ID&fromDate=2026-05-01&toDate=2026-05-31" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Supplier querying their own data (token determines scope; no supplierId needed)
curl -s "$BASE_URL/milk/reports/supplier?fromDate=2026-05-01&toDate=2026-05-31" \
  -H "Authorization: Bearer $SUPPLIER_TOKEN" | jq
```

---

## 6. Quick smoke test (end-to-end in one block)

Copy-paste this after exporting `BASE_URL`, `TENANT_ID`, `ADMIN_PHONE`, `ADMIN_PASSWORD`:

```bash
# Login
ADMIN_TOKEN=$(curl -s -X POST "$BASE_URL/milk/auth/login" -H 'Content-Type: application/json' \
  -d "{\"tenantId\":\"$TENANT_ID\",\"phone\":\"$ADMIN_PHONE\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | jq -r '.data.token')
echo "ADMIN_TOKEN=${ADMIN_TOKEN:0:30}..."

# Create supplier
SUPPLIER_ID=$(curl -s -X POST "$BASE_URL/milk/suppliers" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke Test","phone":"9988776655","ratePerFat":6.5}' \
  | jq -r '.data._id')
echo "SUPPLIER_ID=$SUPPLIER_ID"

# Create procurement (amount = 10 × 4 × 6.5 = 260)
PROCUREMENT_ID=$(curl -s -X POST "$BASE_URL/milk/procurements" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"supplierId\":\"$SUPPLIER_ID\",\"date\":\"$(date +%Y-%m-%d)\",\"shift\":\"morning\",\"quantity\":10,\"fat\":4,\"fatMeterReading\":3.98}" \
  | jq -r '.data._id')
echo "PROCUREMENT_ID=$PROCUREMENT_ID  (expected amount=260)"

# Daily report
curl -s "$BASE_URL/milk/reports/daily" -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Supplier balance
curl -s "$BASE_URL/milk/reports/supplier?supplierId=$SUPPLIER_ID" -H "Authorization: Bearer $ADMIN_TOKEN" | jq

# Cleanup
curl -s -X DELETE "$BASE_URL/milk/procurements/$PROCUREMENT_ID" -H "Authorization: Bearer $ADMIN_TOKEN" | jq
curl -s -X DELETE "$BASE_URL/milk/suppliers/$SUPPLIER_ID" -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

---

## Error responses to expect

| Code | Scenario |
|------|----------|
| 400  | Missing required field; invalid `shift`; updating/deleting a paid procurement; deleting a supplier with linked procurements/payments |
| 401  | Missing/invalid/expired token |
| 403  | Token role doesn't match endpoint requirement (e.g., supplier hitting POST /milk/suppliers) |
| 404  | Supplier/procurement/payment not found in this tenant |
| 503  | Top-level guard: MongoDB not connected ([index.js:164-169](index.js#L164-L169)) |
