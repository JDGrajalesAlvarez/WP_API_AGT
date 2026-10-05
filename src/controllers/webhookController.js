// controllers/webhook.controller.js
const botService = require("../services/bot.service");

const verificarWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("[DEBUG] Token recibido de Meta:", token);
  console.log(
    "[DEBUG] Token esperado (.env):",
    process.env.WEBHOOK_VERIFY_TOKEN,
  );

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("[WEBHOOK VERIFICADO EXITOSAMENTE]");
    return res.status(200).send(challenge);
  }

  console.log("[ERROR VERIFICACION] Los tokens no coinciden.");
  return res.sendStatus(403);
};

const recibirMensaje = async (req, res) => {
  res.status(200).send("EVENT_RECEIVED");

  try {
    const body = req.body;
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // En tu webhook controller / handler
    const mensaje = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (mensaje) {
      // Si viene 'from' (ej. '573237899017') lo usa; de lo contrario toma 'from_user_id' (ej. 'CO.1090585767180234')
      const remitente = mensaje.from || mensaje.from_user_id;
      const messageId = mensaje.id;

      const nombreUsuario =
        value.contacts?.[0]?.profile?.name ||
        value.contacts?.[0]?.profile?.username ||
        "Usuario";

      // Extraer texto plano o ID de respuesta de botón
      let texto = "";
      if (mensaje.type === "text") {
        texto = mensaje.text.body;
      } else if (
        mensaje.type === "interactive" &&
        mensaje.interactive.button_reply
      ) {
        texto = mensaje.interactive.button_reply.id;
      }

      console.log(
        `[DEBUG] Remitente detectado: ${remitente} | Texto: "${texto}"`,
      );

      // Procesar con la función agnóstica
      await botService.procesarMensaje(
        remitente,
        texto,
        nombreUsuario,
        messageId,
      );
    }
  } catch (error) {
    console.error("Error procesando el payload del Webhook:", error.message);
  }
};

module.exports = {
  verificarWebhook,
  recibirMensaje,
};
