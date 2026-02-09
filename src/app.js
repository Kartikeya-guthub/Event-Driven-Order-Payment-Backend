require('dotenv').config();
const express = require('express');
const ordersRouter = require('./routes/orders');

const app = express();
const PORT = process.env.APP_PORT || process.env.PORT || 3000;

app.use(express.json());

app.use('/orders', ordersRouter);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
