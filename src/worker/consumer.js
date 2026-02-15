const { Kafka } = require("kafkajs");
require("dotenv").config();
const db = require("../../db/connection");
const { processPayment } = require("../mock/paymentService");
const { v4: uuidv4 } = require('uuid');


const kafka = new Kafka({
    clientId: "payment-worker",
    brokers: [process.env.KAFKA_BROKER],
})

const consumer = kafka.consumer({groupId:"payment-group"})

async function start(){
    await consumer.connect();
    await consumer.subscribe({ topic: "order-events", fromBeginning: true });
    console.log("Payment Worker connected to Kafka and subscribed to order-events");

    await consumer.run({
        eachMessage: async({ topic, partition, message })=>{
            try{
                const value = message.value.toString();
                const event = JSON.parse(value);

                console.log("Received event:", event);
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
            console.log(`Event ${eventId} already processed, skipping`);
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
      console.log(`Order ${orderId} already processed or invalid state`);
      return;
    }

    const version = result.rows[0].version;
    console.log(`Order ${orderId} set to PAYMENT_PENDING`);

    // STEP 2: Process payment
    const paymentResult = await processPayment({
      orderId,
      amount: event.payload.amount,
    });

    // STEP 3: Update state + emit event (atomically)
    if (paymentResult.status === "SUCCESS") {
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
          console.log(`Order ${orderId} state changed by another worker, skipping`);
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
        console.log(`Order ${orderId} PAID + event emitted`);
        
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

    } else {
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
          console.log(`Order ${orderId} state changed by another worker, skipping`);
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
        console.log(`Order ${orderId} FAILED + event emitted`);
        
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  } catch (err) {
    console.error("Processing failed", err);
  }
}else {
  console.log(`Skipping event type ${event.eventType}`);
}

            }catch(err){
                console.error("Error processing message:", err);
            }
        }
    })
}

start().catch(err=>{
    console.error("Error starting consumer:", err);
    process.exit(1);
});