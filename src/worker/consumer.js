const { Kafka } = require("kafkajs");
require("dotenv").config();
const db = require("../../db/connection");
const { processPayment } = require("../mock/paymentService");



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

  try {
    // STEP 1: mark as PAYMENT_PENDING
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

    console.log(`Order ${orderId} set to PAYMENT_PENDING`);

    // STEP 2: call payment (outside DB)
    const paymentResult = await processPayment({
      orderId,
      amount: event.payload.amount,
    });

    // STEP 3: update final state
    if (paymentResult.status === "SUCCESS") {
      await db.query(
        `
        UPDATE orders
        SET state = 'PAID',
            version = version + 1,
            updated_at = now()
        WHERE id = $1
        `,
        [orderId]
      );

      console.log(`Order ${orderId} PAID`);
    } else {
      await db.query(
        `
        UPDATE orders
        SET state = 'FAILED',
            version = version + 1,
            updated_at = now()
        WHERE id = $1
        `,
        [orderId]
      );

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