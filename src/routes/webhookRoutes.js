const express = require('express');
const router = express.Router();
const { verificarWebhook, recibirMensaje } = require('../controllers/webhookController');

router.get('/', verificarWebhook);
router.post('/', recibirMensaje);

module.exports = router;