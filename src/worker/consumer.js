const { Kafka } = require("kafkajs");
require("dotenv").config();
const db = require("../../db/connection");
const { processPayment } = require("../mock/paymentService");
const { v4: uuidv4 } = require('uuid');

const metrics = {
  eventsProcessed: 0,
  duplicatesSkipped: 0,
  paymentsSuccess: 0,
  paymentsFailed: 0,
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
                  const orderId = event.aggregateId;
                  const eventId = event.eventId;

  try {
        // STEP 0: Idempotency check
        try{
          await db.query(`
            INSERT INTO processed_events(event_id, worker_id)
            VALUES ($1, $2)
            `,[eventId, "payment-worker"])
        }catch(err){
          if(err.code === "23505"){
            console.log({
              service: "payment-worker",
              type: "DUPLICATE_EVENT",
              eventId,
            });
            metrics.duplicatesSkipped++;
            return;
          }
          throw err;
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
  } catch (err) {
    console.error({
      service: "payment-worker",
      type: "ERROR",
      orderId,
      error: err.message,
    });
  }
}else {
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