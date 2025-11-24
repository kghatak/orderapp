# Scripts Directory

This directory contains utility scripts for the OrderApp deployment and testing.

## health-check.sh

A comprehensive health check script that tests the deployed application on Azure.

### Usage

```bash
# Run the health check
./scripts/health-check.sh
```

### What it tests

1. **Basic Connectivity** - Tests if the application is reachable
2. **Order API Endpoint** - Tests the specific order endpoint with ID `ORD-00000887`
3. **Multiple Endpoints** - Tests various API endpoints (/, /order, /product, /outlet, etc.)
4. **Performance** - Measures response time

### Example Output

```
🚀 Starting health check for OrderApp deployment
Target URL: https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net
================================================
1. Testing basic connectivity...
✅ Basic connectivity: OK
2. Testing order endpoint with ID: ORD-00000887
HTTP Status: 200
✅ Order endpoint: OK
3. Testing multiple API endpoints...
   Testing Root endpoint... OK (200)
   Testing Order listing... OK (200)
   Testing Product listing... OK (200)
4. Performance test...
Response time: 1234ms
✅ Performance: Excellent (< 2s)
================================================
🎉 Health check completed!
```

### Customization

You can modify the script to:
- Change the target URL
- Test different order IDs
- Add new endpoints to test
- Adjust performance thresholds
- Add authentication headers if needed

### Integration

This script is also integrated into the GitHub Actions workflow and runs automatically after each deployment.