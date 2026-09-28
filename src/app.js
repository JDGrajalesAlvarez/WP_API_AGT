const express = require('express');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();

app.use(express.json());

// Definición del endpoint /webhook
app.use('/webhook', webhookRoutes);

module.exports = app;