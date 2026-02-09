const express = require('express');
const db = require('../../db/connection');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

router.post('/', async(req,res)=>{
    const {userId, amount} = req.body;

    const orderId = uuidv4();
    const eventId = uuidv4();

    const client = await db.getClient();
    try{
        await client.query('BEGIN');
        await client.query(
        `
        INSERT INTO orders (id, user_id, amount, state)
        VALUES ($1, $2, $3, $4)
        `,
        [orderId, userId, amount, 'CREATED']
        );

        await client.query(
            `
            INSERT INTO outbox(
            event_id, aggregate_type,
            aggregate_id,
            event_type, payload
            )
            VALUES ($1, $2, $3, $4, $5)
            `,
            [
                eventId,
                "order",
                orderId,
                "OrderCreated",
                JSON.stringify({ orderId, userId, amount })
            ]

            
        );

        await client.query("COMMIT");
        res.status(201).json({ orderId, 
            state: 'CREATED'
         });
    }catch(err){
        await client.query("ROLLBACK");
        console.error("Error creating order:", err);
        res.status(500).json({ error: "Failed to create order" });
    }finally{
        client.release();
    }
})

module.exports = router;
