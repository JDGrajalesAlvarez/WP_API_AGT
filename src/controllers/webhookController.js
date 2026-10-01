// controllers/webhook.controller.js
const botService = require('../services/bot.service');

const verificarWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("[DEBUG] Token recibido de Meta:", token);
  console.log("[DEBUG] Token esperado (.env):", process.env.WEBHOOK_VERIFY_TOKEN);

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("[WEBHOOK VERIFICADO EXITOSAMENTE]");
    return res.status(200).send(challenge);
  }

  console.log("[ERROR VERIFICACION] Los tokens no coinciden.");
  return res.sendStatus(403);
};

const recibirMensaje = async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];
    console.log(message);
    
    if (message) {
      // 1. Extraer el identificador del remitente en orden de prioridad
      const remitente = 
        value.contacts?.[0]?.wa_id || 
        message.from || 
        message.from_user_id || 
        value.contacts?.[0]?.user_id;

      const nombreUsuario = 
        value.contacts?.[0]?.profile?.name || 
        value.contacts?.[0]?.profile?.username || 
        'Usuario';

      let textoMensaje = '';

      if (message.type === 'text') {
        textoMensaje = message.text?.body;
      } else if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
        textoMensaje = message.interactive.button_reply?.id;
      }

      console.log(`[DEBUG] Remitente detectado: ${remitente} | Texto: "${textoMensaje}"`);

      if (remitente && textoMensaje) {
        await botService.procesarMensaje(remitente, textoMensaje, nombreUsuario);
      }
    }
  } catch (error) {
    console.error('Error procesando el payload del Webhook:', error.message);
  }
};

module.exports = {
  verificarWebhook,
  recibirMensaje
};