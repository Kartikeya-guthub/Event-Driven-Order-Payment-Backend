#!/bin/bash

set -e

API_URL="http://localhost:3000"

echo "Creating order..."

curl -i -X POST "$API_URL/orders" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "11111111-1111-1111-1111-111111111111",
    "amount": 499.99
  }'

echo ""
echo "Done"
