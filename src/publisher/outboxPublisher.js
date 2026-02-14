require("dotenv").config();
const { Kafka } = require("kafkajs");
const db = require("../../db/connection");


const kafka = new Kafka({
    clientId: "outbox-publisher",
    brokers: [process.env.KAFKA_BROKER],
});

const producer = kafka.producer();

async function start(){
    await producer.connect();
    console.log("Outbox Publisher connected to Kafka");

    while(true){
        try{
            await publishBatch();
        }catch(err){
            console.error("Error publishing batch:", err);
        }
        await sleep(1000);
    }
}

async function publishBatch(){
    const { rows} = await db.query(`SELECT id,event_id,event_type,aggregate_type,aggregate_id,payload,created_at
        FROM outbox
        WHERE published = false
        ORDER BY created_at
        LIMIT 10`);

        if(rows.length === 0){
            return;
        }

        for(const row of rows){
            try{
                await producer.send({
                    topic: "order-events",
                    messages:[
                        {
                            key: row.aggregate_id,
                            value: JSON.stringify({
                                eventId: row.event_id,
                                eventType: row.event_type,
                                aggregateType: row.aggregate_type,
                                aggregateId: row.aggregate_id,
                                payload: row.payload,
                                createdAt: row.created_at.toISOString()
                            }),
                        }
                    ]
                })
                await db.query(`UPDATE outbox SET published = true,
                    published_at = NOW()
                    WHERE id = $1`, [row.id]);
                    console.log(`Published event ${row.event_id} of type ${row.event_type}`);
            }catch(err){
                console.error("Error publishing event:", err);
            }
        }
}

function sleep(ms){
    return new Promise(resolve => setTimeout(resolve, ms));
}

start().catch(err => {
    console.error("Error starting outbox publisher:", err);
    process.exit(1);
})