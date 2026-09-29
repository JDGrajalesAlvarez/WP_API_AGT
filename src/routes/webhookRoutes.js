const express = require('express');
const router = express.Router();
const { verificarWebhook, recibirMensaje } = require('../controllers/webhookController');

router.get('/webhook', verificarWebhook);

router.post('/webhook', recibirMensaje);

module.exports = router;