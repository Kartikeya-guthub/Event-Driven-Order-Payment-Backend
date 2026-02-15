# 🎬 Live System Demonstration

This interactive demo walks you through the complete order and payment processing flow, demonstrating all the correctness guarantees and features of the system.

**Estimated time:** 15 minutes

---

## 📋 Prerequisites

Before starting, ensure:
- ✅ Docker Desktop is running
- ✅ All dependencies installed (`npm install`)
- ✅ Database migrations completed
- ✅ 4 terminal windows ready

---

## 🚀 Part 1: System Startup

### Terminal 1: Start Docker Services

```bash
docker-compose up -d
```

**Expected Output:**
```
✔ Container pg_local        Started
✔ Container zookeeper       Started
✔ Container kafka           Started
✔ Container pgadmin         Started
```

**Verify:**
```bash
docker ps
```

You should see 4 containers running.

---

### Terminal 2: Start API Server

```bash
npm run dev
```

**Expected Output:**
```
Server running on http://localhost:3000
```

---

### Terminal 3: Start Outbox Publisher

```bash
node src/publisher/outboxPublisher.js
```

**Expected Output:**
```json
{
  "service": "outbox-publisher",
  "type": "STARTUP",
  "message": "Outbox publisher started, polling every 2000ms"
}
```

---

### Terminal 4: Start Payment Worker

```bash
node src/worker/consumer.js
```

**Expected Output:**
```json
{
  "service": "payment-worker",
  "type": "STARTUP",
  "workerId": "payment-worker-1",
  "message": "Consumer started"
}
```

---

## 🧪 Part 2: Create Your First Order

### Step 1: Submit Order Request

```powershell
$body = @{
    userId = "550e8400-e29b-41d4-a716-446655440001"
    amount = 299.99
} | ConvertTo-Json

$response = curl -Method POST `
    -Uri http://localhost:3000/orders `
    -Body $body `
    -ContentType "application/json" `
    -UseBasicParsing

$response.Content
```

**Expected Response:**
```json
{
  "orderId": "a1b2c3d4-e5f6-4789-a012-3456789abcdef",
  "state": "CREATED"
}
```

**💡 Save the `orderId` for next steps!**

---

### Step 2: Observe the Event Flow

Watch **Terminal 3** (Publisher):
```json
{
  "service": "outbox-publisher",
  "type": "EVENT_PUBLISHED",
  "eventId": "ev-123-456",
  "eventType": "OrderCreated",
  "aggregateId": "a1b2c3d4-e5f6-4789-a012-3456789abcdef"
}
```

Watch **Terminal 4** (Worker):
```json
{
  "service": "payment-worker",
  "type": "EVENT_RECEIVED",
  "eventId": "ev-123-456",
  "eventType": "OrderCreated"
}
{
  "service": "payment-worker",
  "type": "STATE_CHANGE",
  "orderId": "a1b2c3d4-e5f6-4789-a012-3456789abcdef",
  "oldState": "CREATED",
  "newState": "PAYMENT_PENDING"
}
{
  "service": "payment-worker",
  "type": "PAYMENT_RESULT",
  "orderId": "a1b2c3d4-e5f6-4789-a012-3456789abcdef",
  "status": "SUCCESS"
}
{
  "service": "payment-worker",
  "type": "STATE_CHANGE",
  "orderId": "a1b2c3d4-e5f6-4789-a012-3456789abcdef",
  "oldState": "PAYMENT_PENDING",
  "newState": "PAID"
}
```

---

### Step 3: Verify in Database

```bash
$env:PGPASSWORD='app_password'
$orderId = 'a1b2c3d4-e5f6-4789-a012-3456789abcdef'  # Replace with your orderId

psql -h localhost -U app_user -d app_db -c `
  "SELECT id, state, version, amount FROM orders WHERE id = '$orderId';"
```

**Expected Output:**
```
                  id                  | state | version | amount
--------------------------------------+-------+---------+--------
 a1b2c3d4-e5f6-4789-a012-3456789abcdef | PAID  |       3 | 299.99
```

**Notice:**
- ✅ State is `PAID`
- ✅ Version is `3` (incremented 3 times: CREATED → PAYMENT_PENDING → PAID)

---

## 🔁 Part 3: Test Idempotency

This demonstrates that duplicate events are safely ignored.

### Step 1: Check Current Processed Events

```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT event_id, worker_id FROM processed_events ORDER BY processed_at DESC LIMIT 5;"
```

**Expected Output:**
```
               event_id               |     worker_id
--------------------------------------+-------------------
 ev-123-456                            | payment-worker-1
 ...
```

---

### Step 2: Manually Trigger Kafka Replay

**Stop the Worker** (Ctrl+C in Terminal 4), then restart it:

```bash
node src/worker/consumer.js
```

Kafka will redeliver messages from the last committed offset.

---

### Step 3: Observe Duplicate Detection

Watch **Terminal 4**:
```json
{
  "service": "payment-worker",
  "type": "EVENT_RECEIVED",
  "eventId": "ev-123-456",
  "eventType": "OrderCreated"
}
{
  "service": "payment-worker",
  "type": "DUPLICATE_EVENT",
  "eventId": "ev-123-456",
  "message": "Event already processed, skipping"
}
```

---

### Step 4: Verify Order State Unchanged

```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT state, version FROM orders WHERE id = '$orderId';"
```

**Expected Output:**
```
 state | version
-------+---------
 PAID  |       3
```

**✅ PROOF:** Order was not processed twice, version is still `3`!

---

## 💥 Part 4: Test Retry Logic & Dead-Letter Queue

This demonstrates failure handling with automatic retries.

### Step 1: Force Payment Failures

Edit `src/mock/paymentService.js`:

```javascript
async function processPayment(orderId, userId, amount) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  
  // Force failure
  const success = false;  // ← Change this line
  
  if (!success) {
    throw new Error('Payment gateway error: Insufficient funds');
  }
  
  return { transactionId: require('crypto').randomUUID() };
}
```

**Save the file.**

---

### Step 2: Restart Worker

**Stop Worker** (Ctrl+C in Terminal 4), then restart:

```bash
node src/worker/consumer.js
```

---

### Step 3: Create a New Order

```powershell
$body = @{
    userId = "550e8400-e29b-41d4-a716-446655440002"
    amount = 99.99
} | ConvertTo-Json

$response = curl -Method POST `
    -Uri http://localhost:3000/orders `
    -Body $body `
    -ContentType "application/json" `
    -UseBasicParsing

$response.Content
```

**Save the new `orderId`!**

---

### Step 4: Observe Retry Attempts

Watch **Terminal 4**:

```json
{
  "service": "payment-worker",
  "type": "PROCESSING_ERROR",
  "eventId": "ev-789-012",
  "error": "Payment gateway error: Insufficient funds",
  "retryCount": 1
}
{
  "service": "payment-worker",
  "type": "RETRY_SCHEDULED",
  "eventId": "ev-789-012",
  "retryCount": 1,
  "maxRetries": 3
}
{
  "service": "payment-worker",
  "type": "PROCESSING_ERROR",
  "eventId": "ev-789-012",
  "error": "Payment gateway error: Insufficient funds",
  "retryCount": 2
}
{
  "service": "payment-worker",
  "type": "RETRY_SCHEDULED",
  "eventId": "ev-789-012",
  "retryCount": 2,
  "maxRetries": 3
}
{
  "service": "payment-worker",
  "type": "PROCESSING_ERROR",
  "eventId": "ev-789-012",
  "error": "Payment gateway error: Insufficient funds",
  "retryCount": 3
}
{
  "service": "payment-worker",
  "type": "DLQ_EVENT",
  "eventId": "ev-789-012",
  "reason": "Max retries exceeded (3)"
}
```

**Notice:** The system tried 3 times, then moved the event to the dead-letter queue.

---

### Step 5: Verify Order State

```bash
$orderId = 'your-new-order-id'  # Replace

psql -h localhost -U app_user -d app_db -c `
  "SELECT state FROM orders WHERE id = '$orderId';"
```

**Expected Output:**
```
 state
-------
 FAILED
```

✅ Order is marked as `FAILED` after retries exhausted.

---

### Step 6: Check Dead-Letter Queue

```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT event_id, event_type, reason, failed_at FROM dead_letter_events ORDER BY failed_at DESC LIMIT 1;"
```

**Expected Output:**
```
               event_id               |  event_type  |            reason            |         failed_at
--------------------------------------+--------------+------------------------------+---------------------------
 ev-789-012                            | OrderCreated | Max retries exceeded (3)     | 2025-06-15 14:23:45+00
```

**✅ PROOF:** Failed event is safely stored in DLQ for manual investigation!

---

### Step 7: Restore Normal Payment Behavior

Edit `src/mock/paymentService.js`:

```javascript
// Restore random success/failure
const success = Math.random() > 0.3;  // 70% success rate
```

**Save and restart Worker.**

---

## 📊 Part 5: Observability & Metrics

### Monitor System Health

Watch **Terminal 4** for periodic metrics (every 10 seconds):

```json
{
  "service": "payment-worker",
  "type": "METRICS",
  "eventsProcessed": 15,
  "duplicatesSkipped": 3,
  "paymentsSuccess": 10,
  "paymentsFailed": 2,
  "retriedEvents": 6,
  "dlqEvents": 1,
  "timestamp": "2025-06-15T14:25:30.123Z"
}
```

**Interpretation:**
- ✅ `eventsProcessed: 15` - Total events handled
- ✅ `duplicatesSkipped: 3` - Idempotency working
- ✅ `paymentsSuccess: 10` - Successful payments
- ✅ `paymentsFailed: 2` - Failed payments
- ✅ `retriedEvents: 6` - Total retry attempts
- ✅ `dlqEvents: 1` - Events in dead-letter queue

---

## 🔎 Part 6: Database Exploration

### Explore All Tables

**View Orders:**
```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT id, state, version, amount FROM orders ORDER BY created_at DESC LIMIT 5;"
```

**View Outbox:**
```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT event_id, event_type, aggregate_id, published_at FROM outbox ORDER BY created_at DESC LIMIT 5;"
```

**View Processed Events:**
```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT event_id, worker_id, processed_at FROM processed_events ORDER BY processed_at DESC LIMIT 5;"
```

**View Dead-Letter Queue:**
```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT event_id, event_type, reason FROM dead_letter_events ORDER BY failed_at DESC;"
```

---

## 🎯 Part 7: Stress Test

Create multiple orders rapidly to test system behavior under load.

### Rapid Order Creation

```powershell
for ($i = 1; $i -le 10; $i++) {
    $body = @{
        userId = "550e8400-e29b-41d4-a716-446655440000"
        amount = ($i * 10)
    } | ConvertTo-Json
    
    curl -Method POST `
        -Uri http://localhost:3000/orders `
        -Body $body `
        -ContentType "application/json" `
        -UseBasicParsing | Out-Null
    
    Write-Host "Order $i created"
}
```

---

### Observe Processing

Watch **Terminal 4** for rapid event processing:

```json
{"type":"EVENT_RECEIVED","eventId":"..."}
{"type":"STATE_CHANGE","orderId":"...","newState":"PAYMENT_PENDING"}
{"type":"PAYMENT_RESULT","status":"SUCCESS"}
{"type":"STATE_CHANGE","newState":"PAID"}
{"type":"EVENT_RECEIVED","eventId":"..."}
...
```

---

### Check Success Rate

```bash
psql -h localhost -U app_user -d app_db -c `
  "SELECT state, COUNT(*) FROM orders GROUP BY state;"
```

**Expected Output:**
```
 state  | count
--------+-------
 PAID   |   7
 FAILED |   3
```

**Analysis:** ~70% success rate (as configured in payment service).

---

## 🧹 Cleanup

When done with the demo:

### Stop All Services

```bash
# Terminal 2 (API): Ctrl+C
# Terminal 3 (Publisher): Ctrl+C
# Terminal 4 (Worker): Ctrl+C
```

### Stop Docker

```bash
docker-compose down
```

**Optional - Remove all data:**
```bash
docker-compose down -v  # Removes volumes
```

---

## 🎓 Key Takeaways

From this demo, you've verified:

1. ✅ **Transactional Outbox** - Events are never lost, even if publisher crashes
2. ✅ **Idempotency** - Duplicate events are safely ignored (no double processing)
3. ✅ **Optimistic Locking** - Version numbers prevent concurrent update conflicts
4. ✅ **Retry Logic** - Failed payments are retried automatically (max 3 times)
5. ✅ **Dead-Letter Queue** - Poison messages are isolated after max retries
6. ✅ **Structured Logging** - All events are traceable via JSON logs
7. ✅ **Metrics** - System health is observable in real-time
8. ✅ **State Machine** - Order states follow strict transitions

---

## 📚 Next Steps

- Experiment with different failure scenarios
- Monitor pgAdmin (http://localhost:5050) for visual DB exploration
- Build integration tests based on these manual steps
- Add more complex business logic (refunds, cancellations, etc.)

---

<div align="center">

**🎉 Congratulations! You've completed the full system demonstration!**

**Questions? Check [README.md](README.md) for detailed documentation.**

</div>
