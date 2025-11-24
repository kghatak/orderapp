#!/bin/bash

# Health Check Script for OrderApp Azure Deployment
# This script tests various endpoints to ensure the application is working correctly

APP_URL="https://orderapp-hbhtdqbkaxeqebcj.eastasia-01.azurewebsites.net"
TEST_ORDER_ID="ORD-00000887"

echo "🚀 Starting health check for OrderApp deployment"
echo "Target URL: $APP_URL"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test basic connectivity
echo -e "${BLUE}1. Testing basic connectivity...${NC}"
if curl -f -s --connect-timeout 10 --max-time 30 "$APP_URL" > /dev/null; then
    echo -e "${GREEN}✅ Basic connectivity: OK${NC}"
else
    echo -e "${RED}❌ Basic connectivity: FAILED${NC}"
    exit 1
fi

# Test specific order endpoint
echo -e "${BLUE}2. Testing order endpoint with ID: $TEST_ORDER_ID${NC}"
ORDER_URL="$APP_URL/order/$TEST_ORDER_ID"

RESPONSE=$(curl -s -w "HTTPSTATUS:%{http_code}" --connect-timeout 10 --max-time 30 "$ORDER_URL")
BODY=$(echo $RESPONSE | sed -E 's/HTTPSTATUS\:[0-9]{3}$//')
HTTP_CODE=$(echo $RESPONSE | tr -d '\n' | sed -E 's/.*HTTPSTATUS:([0-9]{3})$/\1/')

echo "HTTP Status: $HTTP_CODE"
if [[ "$HTTP_CODE" -ge 200 && "$HTTP_CODE" -lt 300 ]]; then
    echo -e "${GREEN}✅ Order endpoint: OK${NC}"
    echo "Response preview: $(echo "$BODY" | head -c 200)..."
elif [[ "$HTTP_CODE" -eq 404 ]]; then
    echo -e "${YELLOW}⚠️  Order not found (404) - API is working but order doesn't exist${NC}"
else
    echo -e "${RED}❌ Order endpoint: FAILED (Status: $HTTP_CODE)${NC}"
fi

# Test multiple endpoints
echo -e "${BLUE}3. Testing multiple API endpoints...${NC}"

declare -A endpoints=(
    ["/"]="Root endpoint"
    ["/order"]="Order listing"
    ["/product"]="Product listing" 
    ["/outlet"]="Outlet listing"
    ["/user"]="User listing"
    ["/school"]="School listing"
)

for endpoint in "${!endpoints[@]}"; do
    description="${endpoints[$endpoint]}"
    full_url="$APP_URL$endpoint"
    
    echo -n "   Testing $description... "
    
    response=$(curl -s -w "HTTPSTATUS:%{http_code}" --connect-timeout 5 --max-time 10 "$full_url")
    http_code=$(echo $response | tr -d '\n' | sed -E 's/.*HTTPSTATUS:([0-9]{3})$/\1/')
    
    if [[ "$http_code" -ge 200 && "$http_code" -lt 400 ]]; then
        echo -e "${GREEN}OK ($http_code)${NC}"
    else
        echo -e "${RED}FAILED ($http_code)${NC}"
    fi
done

# Performance test
echo -e "${BLUE}4. Performance test...${NC}"
start_time=$(date +%s%N)
curl -s --connect-timeout 10 --max-time 30 "$APP_URL" > /dev/null
end_time=$(date +%s%N)

response_time_ms=$(( (end_time - start_time) / 1000000 ))
echo "Response time: ${response_time_ms}ms"

if [ $response_time_ms -lt 2000 ]; then
    echo -e "${GREEN}✅ Performance: Excellent (< 2s)${NC}"
elif [ $response_time_ms -lt 5000 ]; then
    echo -e "${YELLOW}⚠️  Performance: Good (< 5s)${NC}"
else
    echo -e "${RED}❌ Performance: Slow (> 5s)${NC}"
fi

echo ""
echo "================================================"
echo -e "${GREEN}🎉 Health check completed!${NC}"
echo ""
echo "📋 Manual test commands:"
echo "curl -X GET '$APP_URL/order/$TEST_ORDER_ID'"
echo "curl -X GET '$APP_URL/order'"
echo "curl -X GET '$APP_URL/product'"
echo ""
echo "🌐 Application URL: $APP_URL"
echo "📊 Azure Portal: https://portal.azure.com/#@/resource/subscriptions/1aef6805-f5ca-4b31-8d14-19f5662bf15e/resourceGroups/orderapp-rg/providers/Microsoft.Web/sites/orderapp"