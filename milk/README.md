# Milk Procurement Module

MongoDB-backed milk procurement API with multi-tenancy via `tenantId`.

## Setup

1. Add to `.env`:
   ```
   MONGODB_URI=mongodb://localhost:27017/orderapp
   JWT_SECRET=your-secret-key
   ```

2. Install dependencies (already in package.json):
   ```
   npm install
   ```

## API Endpoints

### Auth (no token required)
| Method | Endpoint | Body |
|--------|----------|------|
| POST | `/auth/login` | `{ phoneNumber, password, fcmToken?, **tenantId?** }` – **Unified login for Admin** (includes `milkToken` when `tenantId` provided) |
| POST | `/milk/auth/signup` | `{ tenantId, role: "supplier", name, phone, password, email?, fcmToken? }` – suppliers only |
| POST | `/milk/auth/login` | `{ tenantId, phone, password, fcmToken? }` – suppliers or Admin (standalone milk login) |

**Frontend (Admin)**: Use **one login** at `/auth/login` with `tenantId` → response includes `milkToken` for milk API calls.

### Suppliers (requires auth + X-Tenant-Id)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/milk/suppliers` | List suppliers (admin only for create/update) |
| GET | `/milk/suppliers/:id` | Get supplier |
| POST | `/milk/suppliers` | Create supplier (admin) |
| PUT | `/milk/suppliers/:id` | Update supplier (admin) |

### Procurements
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/milk/procurements` | List (supplier sees own only) |
| GET | `/milk/procurements/:id` | Get one |
| POST | `/milk/procurements` | Create (admin) |
| PUT | `/milk/procurements/:id` | Update (admin) |

### Payments
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/milk/payments` | List |
| GET | `/milk/payments/:id` | Get one |
| POST | `/milk/payments` | Create (admin) |

### Reports
| Method | Endpoint | Query | Description |
|--------|----------|-------|-------------|
| GET | `/milk/reports/daily` | `date?` | Daily summary (admin) |
| GET | `/milk/reports/supplier` | `supplierId`, `fromDate?`, `toDate?` | Supplier summary |

## Kotlin Client Headers

```
Authorization: Bearer <jwt_token>
X-Tenant-Id: <tenantId>
Content-Type: application/json
```

## Flow

1. **Admin** uses existing Order app account (sign up via `/auth/signup` with `userProfile: "Admin"`).
2. **Admin** logs in via `/auth/login` with `phoneNumber`, `password`, `tenantId` → gets Order app data + `milkToken` in one response.
3. **Admin** creates Supplier records (name, phone, etc.). `supplierCode` is auto-generated (e.g. SUP00001).
4. **Supplier** signs up via `/milk/auth/signup` with same `tenantId` + `phone` → gets linked to Supplier record.
5. **Admin** records procurements and payments.
6. **Supplier** views own procurements, payments, and summary.
