# 🚀 Event-Driven Order & Payment System

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Kafka](https://img.shields.io/badge/Apache%20Kafka-231F20?style=for-the-badge&logo=apache-kafka&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

**A production-ready event-driven microservice demonstrating advanced distributed systems patterns**

[Features](#-features) • [Architecture](#-architecture) • [Quick Start](#-quick-start) • [Verification](#-correctness-guarantees) • [Demo](#-live-demo)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Features](#-features)
- [Architecture](#-architecture)
- [Correctness Guarantees](#-correctness-guarantees-with-proof)
- [Tech Stack](#-tech-stack)
- [Quick Start](#-quick-start)
- [API Documentation](#-api-documentation)
- [Database Schema](#-database-schema)
- [Observability](#-observability)
- [Live Demo](#-live-demo)
- [Testing](#-testing)
- [Project Structure](#-project-structure)

---

## 🎯 Overview

This project implements a **production-grade event-driven order and payment processing system** using the **Transactional Outbox Pattern**, **Event Sourcing**, and **CQRS principles**. It demonstrates how to build resilient, scalable microservices that guarantee exactly-once processing semantics.

### Why This Project Matters

Most developers build CRUD APIs. This project showcases:
- ✅ **Event-driven architecture** with guaranteed delivery
- ✅ **Distributed transaction handling** without 2PC
- ✅ **Idempotency** and duplicate detection
- ✅ **Retry logic** with dead-letter queues
- ✅ **Observability** through structured logging
- ✅ **Concurrency control** with optimistic locking

---

## ✨ Features

### Core Capabilities

| Feature | Description | Status |
|---------|-------------|--------|
| 🔄 **Transactional Outbox** | Atomic DB writes + event publishing | ✅ Complete |
| 🎯 **Idempotency** | Duplicate event detection & prevention | ✅ Complete |
| 🔒 **Optimistic Locking** | Version-based concurrency control | ✅ Complete |
| ♻️ **Retry Logic** | Controlled retries with exponential backoff | ✅ Complete |
| 💀 **Dead Letter Queue** | Poison message handling | ✅ Complete |
| 📊 **Structured Logging** | JSON logs for observability | ✅ Complete |
| 📈 **Metrics** | Real-time system health monitoring | ✅ Complete |
| 🔐 **State Machine** | Deterministic order state transitions | ✅ Complete |

### Advanced Patterns Implemented

1. **Transactional Outbox Pattern**
   - Ensures events are never lost
   - Atomic database write + event publishing
   - Survives publisher crashes

2. **Event-Driven Architecture**
   - OrderCreated → PaymentPending → OrderPaid/OrderFailed
   - Asynchronous payment processing
   - Event replay capability

3. **Idempotency & Deduplication**
   - `processed_events` table tracks handled events
   - Safe Kafka message redelivery
   - No duplicate order processing

4. **Optimistic Locking**
   - Version-based concurrency control
   - Prevents lost updates in concurrent scenarios
   - Race condition handling

5. **Failure Handling**
   - Automatic retries (max 3 attempts)
   - Dead-letter queue for poison messages
   - Graceful degradation

---

## 🏗️ Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ POST /orders
       ▼
┌─────────────────┐
│   API Server    │ ────► Insert Order (CREATED)
│  (Express.js)   │ ────► Insert Event to Outbox
└─────────────────┘
       │
       ▼
┌──────────────────────────────────────────┐
│         PostgreSQL Database              │
│  ┌──────────┐  ┌─────────┐  ┌─────────┐ │
│  │  orders  │  │ outbox  │  │processed│ │
│  │          │  │         │  │ events  │ │
│  └──────────┘  └─────────┘  └─────────┘ │
└──────────────────────────────────────────┘
       │
       ▼
┌─────────────────┐
│Outbox Publisher │ ────► Poll outbox table
│   (Background)  │ ────► Publish to Kafka
└─────────────────┘ ────► Mark as published
       │
       ▼
┌─────────────────┐
│  Apache Kafka   │
│  order-events   │
└─────────────────┘
       │
       ▼
┌─────────────────┐
│Payment Worker   │ ────► Consume events
│  (Consumer)     │ ────► Process payment
└─────────────────┘ ────► Update order state
                    ────► Emit OrderPaid/Failed
```

### Event Flow

```
OrderCreated Event
       ↓
  Idempotency Check ──┐ (duplicate?) → Skip
       ↓              └── (new) → Continue
  Update: PAYMENT_PENDING
       ↓
  Process Payment ──┐ (success) → OrderPaid Event
       ↓            └── (failed)  → OrderFailed Event
  Update State
       ↓
  Publish Follow-up Event
```

---

## 🔥 Correctness Guarantees (with Proof)

This system guarantees the following properties:

### 1️⃣ **No Order is Processed Twice**

**Guarantee:** Even if Kafka delivers the same message multiple times, the order is processed exactly once.

**Mechanism:** 
- `processed_events` table with unique constraint on `(event_id, worker_id)`
- Worker checks this table before processing

**Proof:**
```sql
-- Event processed once
SELECT COUNT(*) FROM processed_events WHERE event_id = 'abc-123';
-- Result: 1 (always)

-- Even after Kafka redelivery
SELECT state FROM orders WHERE id = 'order-1';
-- State doesn't change on duplicate delivery
```

### 2️⃣ **Events Are Not Lost (Even if Publisher Crashes)**

**Guarantee:** If the system crashes after saving an order, the event will still be published when the system restarts.

**Mechanism:**
- Transactional Outbox Pattern
- Events saved in DB transaction with order
- Publisher polls unpublished events

**Proof:**
```sql
-- Create order (crashes before publishing)
INSERT INTO orders...
INSERT INTO outbox...
COMMIT; -- ← Crash here

-- After restart, publisher finds unpublished event
SELECT * FROM outbox WHERE published_at IS NULL;
-- Event is still there and will be published
```

### 3️⃣ **Duplicate Kafka Messages Are Handled Safely**

**Guarantee:** Replaying the same Kafka message doesn't cause side effects.

**Mechanism:**
- Idempotency check before any business logic
- Database constraint prevents duplicate inserts

**Proof:**
```bash
# Publish same event twice
kafka-console-producer --topic order-events
> {"eventId": "abc-123", ...}
> {"eventId": "abc-123", ...}  # Duplicate

# Worker logs show:
# First: "Processing event abc-123"
# Second: "DUPLICATE_EVENT detected, skipping"
```

### 4️⃣ **Order State Transitions Are Deterministic**

**Guarantee:** Orders follow a strict state machine: `CREATED → PAYMENT_PENDING → PAID/FAILED`

**Mechanism:**
- Optimistic locking with version numbers
- State transition validation in SQL

**Proof:**
```sql
-- Only valid transitions succeed
UPDATE orders SET state = 'PAID' 
WHERE id = ? AND state = 'PAYMENT_PENDING' AND version = 1;
-- ✅ Succeeds

UPDATE orders SET state = 'PAID' 
WHERE id = ? AND state = 'CREATED';
-- ❌ Fails (invalid transition)
```

### 5️⃣ **System Recovers from Worker Crashes**

**Guarantee:** If a worker crashes mid-processing, the event is redelivered and processed.

**Mechanism:**
- Kafka consumer groups with offset commits
- Only commit offset after successful processing

**Proof:**
```
1. Worker receives event
2. Worker crashes (no offset commit)
3. Worker restarts
4. Kafka redelivers event (offset not committed)
5. Worker processes event successfully
6. Worker commits offset
```

---

## 🛠️ Tech Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| **Runtime** | Node.js 18+ | JavaScript runtime |
| **Framework** | Express.js | REST API server |
| **Database** | PostgreSQL 15+ | Relational data & outbox |
| **Message Broker** | Apache Kafka 3.x | Event streaming |
| **Container** | Docker & Docker Compose | Service orchestration |
| **Libraries** | kafkajs, uuid, dotenv | Kafka client, UUID generation |

---

## 🚀 Quick Start

### Prerequisites

- Docker Desktop (running)
- Node.js 18+
- PostgreSQL client (psql)
- Git

### 1. Clone & Install

```bash
git clone https://github.com/Kartikeya-guthub/Event-Driven-Order-Payment-Backend.git
cd Event-Driven-Order-Payment-Backend
npm install
```

### 2. Start Infrastructure

```bash
# Start Kafka, Zookeeper, PostgreSQL
docker-compose up -d

# Verify services are running
docker ps
```

### 3. Run Database Migrations

```bash
# Connect to PostgreSQL
$env:PGPASSWORD='app_password'
psql -h localhost -U app_user -d app_db -f db/migrations/001_init.sql
psql -h localhost -U app_user -d app_db -f db/migrations/002_dead_letter_events.sql
```

### 4. Start Application Services

```bash
# Terminal 1: API Server
npm run dev

# Terminal 2: Outbox Publisher
node src/publisher/outboxPublisher.js

# Terminal 3: Payment Worker
node src/worker/consumer.js
```

### 5. Create Your First Order

```bash
# PowerShell
$body = @{userId = "550e8400-e29b-41d4-a716-446655440001"; amount = 299.99} | ConvertTo-Json
curl -Method POST -Uri http://localhost:3000/orders -Body $body -ContentType "application/json" -UseBasicParsing
```

**Expected Response:**
```json
{
  "orderId": "85136923-023b-4304-a9c7-dcb4dde2eab4",
  "state": "CREATED"
}
```

---

## 📡 API Documentation

### Create Order

**Endpoint:** `POST /orders`

**Request Body:**
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440001",
  "amount": 299.99
}
```

**Response:** `201 Created`
```json
{
  "orderId": "uuid",
  "state": "CREATED"
}
```

**Error Response:** `500 Internal Server Error`
```json
{
  "error": "Failed to create order"
}
```

---

## 🗄️ Database Schema

### Tables

#### `orders`
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  state VARCHAR(50) NOT NULL,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

#### `outbox`
```sql
CREATE TABLE outbox (
  event_id UUID PRIMARY KEY,
  aggregate_type VARCHAR(50) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  published_at TIMESTAMPTZ
);
```

#### `processed_events`
```sql
CREATE TABLE processed_events (
  event_id UUID NOT NULL,
  worker_id VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_id, worker_id)
);
```

#### `dead_letter_events`
```sql
CREATE TABLE dead_letter_events (
  event_id UUID PRIMARY KEY,
  event_type TEXT,
  aggregate_id UUID,
  payload JSONB,
  failed_at TIMESTAMPTZ DEFAULT now(),
  reason TEXT
);
```

---

## 📊 Observability

### Structured Logs

All services emit JSON-formatted logs:

```json
{
  "service": "payment-worker",
  "type": "EVENT_RECEIVED",
  "eventId": "abc-123",
  "eventType": "OrderCreated"
}
```

**Log Types:**
- `STARTUP` - Service initialization
- `EVENT_RECEIVED` - Kafka message received
- `DUPLICATE_EVENT` - Duplicate detected
- `STATE_CHANGE` - Order state updated
- `PAYMENT_RESULT` - Payment success/failure
- `PROCESSING_ERROR` - Error during processing
- `DLQ_EVENT` - Event moved to dead-letter queue
- `METRICS` - System metrics (every 10s)

### Metrics

Real-time metrics printed every 10 seconds:

```json
{
  "service": "payment-worker",
  "type": "METRICS",
  "eventsProcessed": 145,
  "duplicatesSkipped": 12,
  "paymentsSuccess": 98,
  "paymentsFailed": 35,
  "retriedEvents": 8,
  "dlqEvents": 2
}
```

---

## 🎬 Live Demo

### Complete Order Flow Demonstration

#### Step 1: Verify System is Running
```bash
# Check Docker services
docker ps

# Expected output:
# kafka, zookeeper, pg_local, pgadmin (all running)
```

#### Step 2: Create an Order
```bash
$body = @{userId = "550e8400-e29b-41d4-a716-446655440001"; amount = 199.99} | ConvertTo-Json
curl -Method POST -Uri http://localhost:3000/orders -Body $body -ContentType "application/json" -UseBasicParsing
```

#### Step 3: Verify Order in Database
```bash
$env:PGPASSWORD='app_password'
psql -h localhost -U app_user -d app_db -c "SELECT id, state, version FROM orders ORDER BY created_at DESC LIMIT 1;"
```

**Expected:**
```
                  id                  |      state       | version
--------------------------------------+------------------+---------
 85136923-023b-4304-a9c7-dcb4dde2eab4 | CREATED          |       1
```

#### Step 4: Verify Outbox Event
```bash
psql -h localhost -U app_user -d app_db -c "SELECT event_id, event_type, published_at FROM outbox ORDER BY created_at DESC LIMIT 1;"
```

**Expected:**
```
               event_id               |  event_type  | published_at
--------------------------------------+--------------+--------------
 e99a8f89-27db-4f0c-8f5c-598ec6de63e3 | OrderCreated | (timestamp)
```

#### Step 5: Watch Worker Process Payment
```
# Worker logs will show:
{
  "service": "payment-worker",
  "type": "EVENT_RECEIVED",
  "eventId": "e99a8f89-27db-4f0c-8f5c-598ec6de63e3",
  "eventType": "OrderCreated"
}
{
  "service": "payment-worker",
  "type": "STATE_CHANGE",
  "orderId": "85136923-023b-4304-a9c7-dcb4dde2eab4",
  "newState": "PAYMENT_PENDING"
}
{
  "service": "payment-worker",
  "type": "PAYMENT_RESULT",
  "orderId": "85136923-023b-4304-a9c7-dcb4dde2eab4",
  "status": "SUCCESS"
}
{
  "service": "payment-worker",
  "type": "STATE_CHANGE",
  "orderId": "85136923-023b-4304-a9c7-dcb4dde2eab4",
  "newState": "PAID"
}
```

#### Step 6: Verify Final State
```bash
psql -h localhost -U app_user -d app_db -c "SELECT id, state, version FROM orders WHERE id = '85136923-023b-4304-a9c7-dcb4dde2eab4';"
```

**Expected:**
```
                  id                  | state | version
--------------------------------------+-------+---------
 85136923-023b-4304-a9c7-dcb4dde2eab4 | PAID  |       3
```

#### Step 7: Test Idempotency (Duplicate Detection)
```bash
# Manually republish the same event to Kafka
# Worker will skip it and log:
{
  "service": "payment-worker",
  "type": "DUPLICATE_EVENT",
  "eventId": "e99a8f89-27db-4f0c-8f5c-598ec6de63e3"
}

# Order state remains unchanged
```

#### Step 8: View System Metrics
```bash
# Worker periodically logs metrics:
{
  "service": "payment-worker",
  "type": "METRICS",
  "eventsProcessed": 1,
  "duplicatesSkipped": 0,
  "paymentsSuccess": 1,
  "paymentsFailed": 0,
  "retriedEvents": 0,
  "dlqEvents": 0
}
```

---

## 🧪 Testing

### Manual Verification Steps

#### Test 1: Idempotency
```bash
# Create order
curl -X POST http://localhost:3000/orders -d '{"userId":"...","amount":100}'

# Wait 3 seconds for processing

# Get order state
psql ... -c "SELECT state FROM orders WHERE id = '<orderId>';"
# Result: PAID

# Simulate duplicate (republish same Kafka event)
# ... manual Kafka republish ...

# Check order state again
psql ... -c "SELECT state FROM orders WHERE id = '<orderId>';"
# Result: PAID (unchanged)

# ✅ PASS: Order not processed twice
```

#### Test 2: Transactional Outbox
```bash
# Stop publisher
# Create order
curl -X POST http://localhost:3000/orders ...

# Check outbox (unpublished)
psql ... -c "SELECT published_at FROM outbox ORDER BY created_at DESC LIMIT 1;"
# Result: NULL

# Start publisher

# Check outbox (now published)
psql ... -c "SELECT published_at FROM outbox ORDER BY created_at DESC LIMIT 1;"
# Result: <timestamp>

# ✅ PASS: Event published after crash recovery
```

#### Test 3: Retry Logic
```bash
# Force payment failures in paymentService.js
# Create 5 orders rapidly
for ($i=1; $i -le 5; $i++) {
  curl -X POST http://localhost:3000/orders -d "{\"userId\":\"...\",\"amount\":$i00}"
}

# Watch worker logs for retries:
# PROCESSING_ERROR (retry 1)
# PROCESSING_ERROR (retry 2)
# PROCESSING_ERROR (retry 3)
# DLQ_EVENT (moved to dead-letter queue)

# Check DLQ
psql ... -c "SELECT COUNT(*) FROM dead_letter_events;"
# Result: > 0

# ✅ PASS: Failed events moved to DLQ after retries
```

---

## 📁 Project Structure

```
event-driven-order-payment/
├── db/
│   ├── connection.js           # PostgreSQL connection pool
│   └── migrations/
│       ├── 001_init.sql        # Initial schema
│       └── 002_dead_letter_events.sql
├── src/
│   ├── app.js                  # Express API server
│   ├── mock/
│   │   └── paymentService.js   # Mock payment processor
│   ├── publisher/
│   │   └── outboxPublisher.js  # Outbox event publisher
│   ├── routes/
│   │   └── orders.js           # Order routes
│   └── worker/
│       └── consumer.js         # Kafka consumer (payment worker)
├── docker-compose.yml          # Docker services configuration
├── package.json
├── .env                        # Environment variables
└── README.md
```

---

## 🎓 Learning Outcomes

This project demonstrates understanding of:

1. **Event-Driven Architecture**
   - Asynchronous message processing
   - Event sourcing principles
   - Eventual consistency

2. **Distributed Systems Patterns**
   - Transactional Outbox
   - Idempotency
   - Optimistic Locking
   - Saga Pattern (partial)

3. **Reliability Engineering**
   - Retry mechanisms
   - Dead-letter queues
   - Graceful degradation
   - Observability

4. **Data Consistency**
   - Atomic operations
   - State machines
   - Concurrency control
   - Deduplication

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---


## 👨‍💻 Author

**Kartikeya**

- GitHub: [@Kartikeya-guthub](https://github.com/Kartikeya-guthub)
- LinkedIn: [Connect](https://www.linkedin.com/in/kartikeya-sharma-94b30a296/)

---

## 🙏 Acknowledgments

This project was built to demonstrate production-ready event-driven architecture patterns suitable for enterprise microservices.

---

<div align="center">

**⭐ Star this repo if you found it helpful!**

**Built with ❤️ using Node.js, Kafka, and PostgreSQL**

</div>
