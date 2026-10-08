// controllers/webhook.controller.js
const botService = require("../services/bot.service");

/**
 * Valida la suscripción inicial del Webhook solicitada por los servidores de Meta.
 * Este endpoint es requerido por Meta una sola vez al configurar o editar el Webhook 
 * en el panel de desarrolladores (Request tipo GET).
 * 
 * @param {object} req - Objeto de petición de Express.
 * @param {object} res - Objeto de respuesta de Express.
 * @returns {object} Respuesta HTTP con el challenge de Meta o un estado 403.
 */
const verificarWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Validación estricta del modo de suscripción y el token de verificación privado (.env)
  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  // Alerta crítica: Alguien intentó registrar el webhook con un token incorrecto
  console.warn("[WEBHOOK SECURITY WARNING] Intento de verificación fallido. Los tokens no coinciden.");
  return res.sendStatus(403);
};

/**
 * Recibe, clasifica y procesa todas las notificaciones en tiempo real (eventos POST) 
 * enviadas por la API de Cloud WhatsApp (Mensajes entrantes y cambios de estado).
 * 
 * @param {object} req - Objeto de petición de Express que contiene el payload de Meta.
 * @param {object} res - Objeto de respuesta de Express.
 * @returns {Promise<void>}
 */
const recibirMensaje = async (req, res) => {
  // Regla de Oro de Meta: Responder con 200 OK de inmediato para evitar que Meta reintente 
  // el envío del mismo evento y sature el servidor, manteniendo la latencia baja.
  res.status(200).send("EVENT_RECEIVED");

  try {
    const rawBody = req.body;

    // Desestructuración segura del objeto intermedio que agrupa los cambios del webhook
    const value = rawBody.entry?.[0]?.changes?.[0]?.value;

    if (!value) return;

    // -------------------------------------------------------------------------
    // FLUJO A: El Webhook contiene un Mensajes Entrante (Mensajes del Cliente)
    // -------------------------------------------------------------------------
    const mensaje = value?.messages?.[0];

    if (mensaje) {
      // Prioriza 'from' (teléfono del cliente) y respalda con 'from_user_id' para cuentas del ecosistema Meta
      const remitente = mensaje.from || mensaje.from_user_id;
      const messageId = mensaje.id;

      // Extracción del nombre del perfil del cliente con respaldos para evitar valores nulos
      const nombreUsuario =
        value.contacts?.[0]?.profile?.name ||
        value.contacts?.[0]?.profile?.username ||
        "Usuario";

      // Normalización del contenido: Captura texto libre o mapea el ID del botón interactivo presionado
      let texto = "";
      if (mensaje.type === "text") {
        texto = mensaje.text.body;
      } else if (mensaje.type === "interactive" && mensaje.interactive.button_reply) {
        texto = mensaje.interactive.button_reply.id;
      }

      // Delegación asíncrona al servicio del Bot para procesar las reglas de negocio
      await botService.procesarMensaje(
        remitente,
        texto,
        nombreUsuario,
        messageId,
        rawBody // Se envía el payload completo para auditorías técnicas e inserciones JSONB
      );
      return;
    }

    // -------------------------------------------------------------------------
    // FLUJO B: El Webhook contiene una Actualización de Estado (statuses)
    // -------------------------------------------------------------------------
    // NOTA OPERATIVA: Meta notifica cuando un mensaje saliente enviado por el bot 
    // cambia de estado a: 'sent' (enviado), 'delivered' (entregado), 'read' (leído) o 'failed' (fallido).
    const statusUpdate = value?.statuses?.[0];

    if (statusUpdate) {
      const wamid = statusUpdate.id; // Corresponde al ID del mensaje original guardado previamente
      const currentStatus = statusUpdate.status;
      const errorMessage = statusUpdate.errors?.[0]?.message || null;

      /*
        TODO: Integración futura en session.service para actualización asíncrona de estados.
        
        await sessionService.registrarEstadoMensaje({
          wamid: wamid,
          messageCreatedAt: new Date(), // Requerido si manejas particiones de tablas por fecha
          status: currentStatus,
          errorMessage: errorMessage,
          rawPayload: rawBody
        });
      */
    }

  } catch (error) {
    // Captura fallas críticas durante el parseo o la ejecución del botService sin tumbar el hilo principal
    console.error("[WEBHOOK PROCESSING ERROR]:", error.message);
  }
};

module.exports = {
  verificarWebhook,
  recibirMensaje,
};
