const { enviarMensajeTexto } = require('../services/whatsappService');

// Lista de números de Colombia autorizados (sin el signo +)
const numerosAutorizados = [
  '573104665545' // Agregado tal cual viene en el objeto 'from'
];

const respuestaEspecifica = '¡Hola Juan! Recibí tu mensaje correctamente desde el Webhook de Meta.';

const verificarWebhook = (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // Agrega estos console.log para depurar directamente en la terminal de Node
  console.log("[DEBUG] Token recibido de Meta:", token);
  console.log(
    "[DEBUG] Token esperado (.env):",
    process.env.WEBHOOK_VERIFY_TOKEN,
  );

  if (mode === "subscribe" && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log("[WEBHOOK VERIFICADO EXITOSAMENTE]");
    // Enviar el challenge de vuelta a Meta como texto sin formato
    return res.status(200).send(challenge);
  }

  console.log("[ERROR VERIFICACION] Los tokens no coinciden.");
  return res.sendStatus(403);
};

const recibirMensaje = async (req, res) => {
  // 1. Responder 200 OK inmediatamente a Meta
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    // Extraer el mensaje del payload
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    // Verificar que sea un mensaje de texto entrante
    if (message && message.type === 'text') {
      const remitente = message.from;             // "573104665545"
      const textoMensaje = message.text.body;     // "Hola"
      const nombreUsuario = value.contacts?.[0]?.profile?.name || 'Usuario';

      console.log(`\n[MENSAJE DETECTADO] De: ${nombreUsuario} (${remitente}) | Texto: "${textoMensaje}"`);

      // Verificar si el remitente está en la lista permitida
      const estaAutorizado = numerosAutorizados.includes(remitente);

      if (estaAutorizado) {
        console.log(`[AUTORIZADO] Enviando respuesta automática a ${remitente}...`);
        await enviarMensajeTexto(remitente, respuestaEspecifica);
      } else {
        console.log(`[NO AUTORIZADO] El número ${remitente} no está registrado en la lista de permitidos.`);
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