// controllers/webhook.controller.js
const botService = require("../services/bot.service");

/**
 * Valida la suscripción inicial del Webhook solicitada por los servidores de Meta.
 */
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

/**
 * Recibe y procesa todas las notificaciones en tiempo real de la API de Cloud WhatsApp.
 */
const recibirMensaje = async (req, res) => {
  // Confirmar recepción a Meta inmediatamente para evitar reintentos y mantener baja la latencia
  res.status(200).send("EVENT_RECEIVED");

  try {
    const rawBody = req.body;
    const value = rawBody.entry?.[0]?.changes?.[0]?.value;

    // -------------------------------------------------------------------------
    // FLUJO A: El Webhook contiene un Mensaje Entrante (messages)
    // -------------------------------------------------------------------------
    const mensaje = value?.messages?.[0];

    if (mensaje) {
      // Prioriza 'from' (número de teléfono) y respalda con 'from_user_id' (identificador de ecosistema Meta)
      const remitente = mensaje.from || mensaje.from_user_id;
      const messageId = mensaje.id;

      // Obtener el nombre del perfil del cliente o asignar uno genérico
      const nombreUsuario =
        value.contacts?.[0]?.profile?.name ||
        value.contacts?.[0]?.profile?.username ||
        "Usuario";

      // Normalizar el contenido: Capturar texto plano o el ID técnico del botón presionado
      let texto = "";
      if (mensaje.type === "text") {
        texto = mensaje.text.body;
      } else if (mensaje.type === "interactive" && mensaje.interactive.button_reply) {
        texto = mensaje.interactive.button_reply.id;
      }

      console.log(`[DEBUG] Mensaje Entrante - Remitente: ${remitente} | Texto/ID: "${texto}"`);

      // Transferir el control al botService incluyendo el payload completo de Meta
      await botService.procesarMensaje(
        remitente,
        texto,
        nombreUsuario,
        messageId,
        rawBody // Pasamos el objeto completo para poblar las columnas raw_payload
      );
      return;
    }

    // -------------------------------------------------------------------------
    // FLUJO B: El Webhook contiene una Actualización de Estado (statuses)
    // -------------------------------------------------------------------------
    // NOTA DE PRODUCCIÓN: Meta envía eventos cuando un mensaje que TÚ enviaste cambia a:
    // 'sent', 'delivered', 'read' o 'failed'. Tu BD necesita este bloque para alimentar 'message_statuses'.
    const statusUpdate = value?.statuses?.[0];

    if (statusUpdate) {
      const wamid = statusUpdate.id; // El ID del mensaje original enviado por el bot
      const currentStatus = statusUpdate.status; // 'delivered', 'read', 'failed', etc.
      const errorMessage = statusUpdate.errors?.[0]?.message || null;

      console.log(`[DEBUG] Evento de Estado de Meta - WAMID: ${wamid} | Estado: ${currentStatus}`);

      /*
        TODO: Integración futura en session.service para actualización asíncrona de estados.
        
        await sessionService.registrarEstadoMensaje({
          wamid: wamid,
          messageCreatedAt: new Date(), // El motor buscará la partición correspondiente
          status: currentStatus,
          errorMessage: errorMessage,
          rawPayload: rawBody
        });
      */
    }

  } catch (error) {
    console.error("Error procesando el payload del Webhook:", error.message);
  }
};

module.exports = {
  verificarWebhook,
  recibirMensaje,
};
