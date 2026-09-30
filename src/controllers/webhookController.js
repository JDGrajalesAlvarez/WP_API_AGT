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
  // 1. Responder 200 OK inmediatamente a Meta para no bloquear la petición
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    // Extraer la estructura del mensaje del payload de Meta
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Verificar que sea un mensaje de texto entrante
    if (message && message.type === 'text') {
      const remitente = message.from;
      const textoMensaje = message.text.body;
      const nombreUsuario = value.contacts?.[0]?.profile?.name || 'Usuario';

      await botService.procesarMensaje(remitente, textoMensaje, nombreUsuario);

      console.log(`\n[MENSAJE DETECTADO] De: ${nombreUsuario} (${remitente}) | Texto: "${textoMensaje}"`);

      // Enviar la respuesta directamente a cualquier remitente

      console.log(`[ENVIANDO RESPUESTA] A: ${remitente}...`);
    }
  } catch (error) {
    console.error('Error procesando el payload del Webhook:', error.message);
  }
};

module.exports = {
  verificarWebhook,
  recibirMensaje
};