const { Kafka } = require("kafkajs");
require("dotenv").config();
const db = require("../../db/connection");
const { processPayment } = require("../mock/paymentService");
const { v4: uuidv4 } = require('uuid');

const MAX_RETRIES = 3;

const metrics = {
  eventsProcessed: 0,
  duplicatesSkipped: 0,
  paymentsSuccess: 0,
  paymentsFailed: 0,
  retriedEvents: 0,
  dlqEvents: 0,
};

setInterval(() => {
  console.log({
    service: "payment-worker",
    type: "METRICS",
    ...metrics,
  });
}, 10000);

const kafka = new Kafka({
    clientId: "payment-worker",
    brokers: [process.env.KAFKA_BROKER],
})

const consumer = kafka.consumer({groupId:"payment-group"})

// Extract OrderCreated processing logic
async function handleOrderCreated(event) {
  const orderId = event.aggregateId;
  const eventId = event.eventId;

  // STEP 0: Check if already processed (idempotency - check only, don't insert yet)
  const alreadyProcessed = await db.query(`
    SELECT 1 FROM processed_events
    WHERE event_id = $1 AND worker_id = $2
  `, [eventId, "payment-worker"]);

  if (alreadyProcessed.rowCount > 0) {
    console.log({
      service: "payment-worker",
      type: "DUPLICATE_EVENT",
      eventId,
    });
    metrics.duplicatesSkipped++;
    return;
  }

  // STEP 1: Set to PAYMENT_PENDING
  const result = await db.query(
    `
    UPDATE orders
    SET state = 'PAYMENT_PENDING',
        version = version + 1,
        updated_at = now()
    WHERE id = $1 AND state = 'CREATED'
    RETURNING *
    `,
    [orderId]
  );

  if (result.rowCount === 0) {
    console.log({
      service: "payment-worker",
      type: "STATE_CHANGE",
      orderId,
      newState: "ALREADY_PROCESSED_OR_INVALID_STATE",
    });
    return;
  }

  const version = result.rows[0].version;
  console.log({
    service: "payment-worker",
    type: "STATE_CHANGE",
    orderId,
    newState: "PAYMENT_PENDING",
  });

  // STEP 2: Process payment
  const paymentResult = await processPayment({
    orderId,
    amount: event.payload.amount,
  });

  console.log({
    service: "payment-worker",
    type: "PAYMENT_RESULT",
    orderId,
    status: paymentResult.status,
  });

  // STEP 3: Update state + emit event (atomically)
  if (paymentResult.status === "SUCCESS") {
    metrics.paymentsSuccess++;
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const updateResult = await client.query(
        `
        UPDATE orders
        SET state = 'PAID',
            version = version + 1,
            updated_at = now()
        WHERE id = $1 AND state = 'PAYMENT_PENDING' AND version = $2
        RETURNING *
        `,
        [orderId, version]
      );

      if (updateResult.rowCount === 0) {
        await client.query("ROLLBACK");
        console.log({
          service: "payment-worker",
          type: "STATE_CHANGE",
          orderId,
          newState: "STATE_CHANGED_BY_ANOTHER_WORKER",
        });
        return;
      }

      // Insert OrderPaid event
      await client.query(
        `
        INSERT INTO outbox (
          event_id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          uuidv4(),
          "order",
          orderId,
          "OrderPaid",
          JSON.stringify({ orderId }),
        ]
      );

      // Mark as processed (idempotency)
      await client.query(`
        INSERT INTO processed_events(event_id, worker_id)
        VALUES ($1, $2)
        ON CONFLICT (event_id, worker_id) DO NOTHING
      `, [eventId, "payment-worker"]);

      await client.query("COMMIT");
      console.log({
        service: "payment-worker",
        type: "STATE_CHANGE",
        orderId,
        newState: "PAID",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    metrics.paymentsFailed++;
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const updateResult = await client.query(
        `
        UPDATE orders
        SET state = 'FAILED',
            version = version + 1,
            updated_at = now()
        WHERE id = $1 AND state = 'PAYMENT_PENDING' AND version = $2
        RETURNING *
        `,
        [orderId, version]
      );

      if (updateResult.rowCount === 0) {
        await client.query("ROLLBACK");
        console.log({
          service: "payment-worker",
          type: "STATE_CHANGE",
          orderId,
          newState: "STATE_CHANGED_BY_ANOTHER_WORKER",
        });
        return;
      }

      // Insert OrderFailed event
      await client.query(
        `
        INSERT INTO outbox (
          event_id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload
        )
        VALUES ($1, $2, $3, $4, $5)
        `,
        [
          uuidv4(),
          "order",
          orderId,
          "OrderFailed",
          JSON.stringify({ orderId }),
        ]
      );

      // Mark as processed (idempotency)
      await client.query(`
        INSERT INTO processed_events(event_id, worker_id)
        VALUES ($1, $2)
        ON CONFLICT (event_id, worker_id) DO NOTHING
      `, [eventId, "payment-worker"]);

      await client.query("COMMIT");
      console.log({
        service: "payment-worker",
        type: "STATE_CHANGE",
        orderId,
        newState: "FAILED",
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

async function start(){
    await consumer.connect();
    await consumer.subscribe({ topic: "order-events", fromBeginning: true });
    console.log({
        service: "payment-worker",
        type: "STARTUP",
        message: "Payment Worker connected to Kafka and subscribed to order-events",
    });

    await consumer.run({
        eachMessage: async({ topic, partition, message })=>{
            try{
                const value = message.value.toString();
                const event = JSON.parse(value);

                console.log({
                    service: "payment-worker",
                    type: "EVENT_RECEIVED",
                    eventId: event.eventId,
                    eventType: event.eventType,
                });

                metrics.eventsProcessed++;

                if (event.eventType === "OrderCreated") {
                  const eventId = event.eventId;
                  let retryCount = 0;

                  while (retryCount < MAX_RETRIES) {
                    try {
                      // Process the event
                      await handleOrderCreated(event);

                      // Success → break out of retry loop
                      console.log({
                        service: "payment-worker",
                        type: "PROCESSING_SUCCESS",
                        eventId,
                        retriesUsed: retryCount,
                      });
                      break;

                    } catch (err) {
                      retryCount++;

                      console.error({
                        service: "payment-worker",
                        type: "PROCESSING_ERROR",
                        eventId,
                        retryCount,
                        error: err.message,
                      });

                      metrics.retriedEvents++;

                      if (retryCount >= MAX_RETRIES) {
                        console.error({
                          service: "payment-worker",
                          type: "DLQ_EVENT",
                          eventId,
                          reason: err.message,
                          retriesAttempted: retryCount,
                        });

                        // Move to dead-letter queue
                        try {
                          await db.query(`
                            INSERT INTO dead_letter_events (
                              event_id,
                              event_type,
                              aggregate_id,
                              payload,
                              reason
                            )
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (event_id) DO NOTHING
                          `, [
                            event.eventId,
                            event.eventType,
                            event.aggregateId,
                            JSON.stringify(event.payload),
                            err.message,
                          ]);

                          metrics.dlqEvents++;
                        } catch (dlqErr) {
                          console.error({
                            service: "payment-worker",
                            type: "DLQ_INSERT_ERROR",
                            eventId,
                            error: dlqErr.message,
                          });
                        }
                      } else {
                        // Wait before retrying
                        console.log({
                          service: "payment-worker",
                          type: "RETRY_SCHEDULED",
                          eventId,
                          retryCount,
                          maxRetries: MAX_RETRIES,
                        });
                        await new Promise(resolve => setTimeout(resolve, 1000));
                      }
                    }
                  }
                } else {
  console.log({
    service: "payment-worker",
    type: "SKIPPED_EVENT_TYPE",
    eventType: event.eventType,
  });
}

            }catch(err){
                console.error({
                  service: "payment-worker",
                  type: "ERROR",
                  error: err.message,
                });
            }
        }
    })
}

start().catch(err=>{
    console.error({
      service: "payment-worker",
      type: "ERROR",
      error: err.message,
    });
    process.exit(1);
});