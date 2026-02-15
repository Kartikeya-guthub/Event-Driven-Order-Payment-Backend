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

   
    const paymentResult = await processPayment({
      orderId,
      amount: event.payload.amount,
    });

   
    if (paymentResult.status === "SUCCESS") {
      const updateResult = await db.query(
        `
        UPDATE orders
        SET state = 'PAID',
            version = version + 1,
            updated_at = now()
        WHERE id = $1 AND version = $2
        RETURNING *
        `,
        [orderId, version]
      );

      if (updateResult.rowCount === 0) {
        console.log(`Order ${orderId} version conflict - likely updated by another worker`);
        return;
      }

      console.log(`Order ${orderId} PAID`);
    } else {
      const updateResult = await db.query(
        `
        UPDATE orders
        SET state = 'FAILED',
            version = version + 1,
            updated_at = now()
        WHERE id = $1 AND version = $2
        RETURNING *
        `,
        [orderId, version]
      );

      if (updateResult.rowCount === 0) {
        console.log(`Order ${orderId} version conflict - likely updated by another worker`);
        return;
      }

      console.log(`Order ${orderId} FAILED`);
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