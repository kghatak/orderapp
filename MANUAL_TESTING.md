# Manual Testing Commands for OrderApp

## Quick Health Check Commands

```bash
# Basic connectivity test
curl -I https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net

# Test specific order endpoint
curl -X GET 'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000887'

# Test order listing
curl -X GET 'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order'

# Test product listing
curl -X GET 'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/product'

# Test outlet listing
curl -X GET 'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/outlet'
```

## Advanced Testing Commands

```bash
# Test with headers and timeout
curl -H "Accept: application/json" \
     -H "User-Agent: HealthCheck/1.0" \
     --connect-timeout 10 \
     --max-time 30 \
     'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000887'

# Test with verbose output for debugging
curl -v 'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000887'

# Performance test - measure time
curl -w "Total time: %{time_total}s\nHTTP Status: %{http_code}\n" \
     -s -o /dev/null \
     'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000887'

# Test multiple orders (if they exist)
curl -X GET 'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000886'
curl -X GET 'https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000888'
```

## PowerShell Commands (Windows)

```powershell
# Basic test
Invoke-RestMethod -Uri "https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000887"

# With error handling
try {
    $response = Invoke-RestMethod -Uri "https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net/order/ORD-00000887"
    Write-Host "✅ Success: $($response | ConvertTo-Json -Depth 2)"
} catch {
    Write-Host "❌ Error: $($_.Exception.Message)"
}
```

## Expected Responses

### Successful Order Response
```json
{
  "id": "ORD-00000887",
  "item_count": 3,
  "outletId": "OUTID079",
  "delivery address": "",
  "total amount": 2871,
  "payment status": "pending",
  "utensilsUsed": [],
  "parent orderId": "ORD-00000887",
  "paymentId": "",
  "totalPaid": 0,
  "orderlineItems": [...]
}
```

### 404 Response (Order Not Found)
```json
{
  "error": "Order not found",
  "message": "The requested order does not exist"
}
```

## Troubleshooting

### If you get connection errors:
1. Check if the Azure Web App is running
2. Verify the URL is correct
3. Check Azure App Service logs

### If you get 500 errors:
1. Check application logs in Azure Portal
2. Verify environment variables are set
3. Check database connectivity

### Common HTTP Status Codes:
- **200**: Success
- **404**: Order/Resource not found (may be expected)
- **500**: Server error (application issue)
- **502/503**: Service unavailable (deployment issue)

## Run the Automated Health Check

```bash
# Run the comprehensive health check script
./scripts/health-check.sh
```