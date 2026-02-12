#!/bin/bash

set -e

API_URL="http://localhost:3000"

echo "Creating order..."

curl -i -X POST "$API_URL/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "11111121-1211-1111-1111-112112112112",
    "amount": 100
  }'

echo ""
echo "Done"
