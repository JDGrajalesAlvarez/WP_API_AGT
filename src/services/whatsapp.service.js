// services/whatsapp.service.js
const axios = require('axios');

/**
 * Despacha un mensaje (texto plano o interactivo con botones de respuesta rápida) 
 * a la API de Cloud WhatsApp de Meta.
 * 
 * @param {string|number} destinatario - Identificador del usuario (Número telefónico o BSUID corporativo).
 * @param {string} texto - Cuerpo principal del mensaje a enviar.
 * @param {Array<object>|null} [botones=null] - Opcional. Lista de hasta 3 botones [{id, title}].
 * @param {string|null} [messageId=null] - Opcional. ID de un mensaje previo para responder en hilo (contexto).
 * @returns {Promise<{wamid: string, rawPayload: object}>} Estructura normalizada ideal para almacenamiento en bases de datos inmutables.
 * @throws {Error} Si faltan variables de entorno esenciales o si la API de Meta falla.
 */
async function enviarMensaje(destinatario, texto, botones = null, messageId = null) {
  try {
    // 1. CONFIGURACIÓN Y VALIDACIÓN DE ENTORNO
    const apiVersion = process.env.GRAPH_API_VERSION || 'v20.0';
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    if (!phoneNumberId || !process.env.WHATSAPP_TOKEN) {
      throw new Error("Faltan variables de entorno esenciales: PHONE_NUMBER_ID o WHATSAPP_TOKEN");
    }

    // 2. PROCESAMIENTO Y LIMPIEZA DE IDENTIFICADORES
    const idLimpio = String(destinatario).trim();

    // Determina si el ID es un identificador interno/corporativo (BSUID) o un número telefónico estándar
    const esBSUID = idLimpio.startsWith('CO.') || /[a-zA-Z]/.test(idLimpio);

    // Inicialización del payload base exigido por Meta Cloud API
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual'
    };

    // Asignación de propiedad según la naturaleza del destino (Meta exige 'recipient' para BSUID y 'to' para números puros)
    if (esBSUID) {
      payload.recipient = idLimpio;
    } else {
      payload.to = idLimpio.replace(/\D/g, ''); // Limpia caracteres no numéricos del teléfono
    }

    // 3. CONSTRUCCIÓN DE LA ESTRUCTURA DEL MENSAJE (Interactivo vs Texto Plano)
    if (Array.isArray(botones) && botones.length > 0) {
      payload.type = 'interactive';
      payload.interactive = {
        type: 'button',
        body: { text: texto },
        action: {
          // Meta limita los botones de respuesta rápida a un máximo de 3 elementos
          buttons: botones.slice(0, 3).map((btn) => ({
            type: 'reply',
            reply: {
              id: String(btn.id).trim(),
              title: String(btn.title).substring(0, 20).trim() // Meta trunca títulos a un máximo de 20 caracteres
            }
          }))
        }
      };
    } else {
      payload.type = 'text';
      payload.text = { body: texto };
    }

    // 4. VINCULACIÓN DE CONTEXTO (Conversaciones en Hilo / Responder a...)
    if (messageId) {
      payload.context = { message_id: messageId };
    }

    // 5. PETICIÓN HTTP A LOS SERVIDORES DE META
    const response = await axios({
      method: 'POST',
      url: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: payload,
      timeout: 10000 // Previene hilos colgados limitando la espera a 10 segundos
    });

    // 6. NORMALIZACIÓN DE LA RESPUESTA PARA LA BASE DE DATOS INMUTABLE
    // Meta retorna una estructura anidada. Extraemos el WAMID para indexación directa en logs y BD.
    const generatedWamid = response.data?.messages?.[0]?.id || `outbound_fallback_${Date.now()}`;

    return {
      wamid: generatedWamid, // Mapeo directo para tablas relacionales de mensajes
      rawPayload: response.data // Almacenamiento íntegro para auditorías técnicas (ej. campos JSONB)
    };

  } catch (error) {
    // Registro exclusivo de errores críticos para no saturar los logs de producción con datos exitosos
    console.error('[WA SERVICE ERROR]:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = { enviarMensaje };
