// services/whatsapp.service.js
const axios = require('axios');

async function enviarMensaje(destinatario, texto, botones = null, messageId = null) {
  try {
    const apiVersion = process.env.GRAPH_API_VERSION || 'v20.0';
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    if (!phoneNumberId || !process.env.WHATSAPP_TOKEN) {
      throw new Error("Faltan variables de entorno: PHONE_NUMBER_ID o WHATSAPP_TOKEN");
    }

    const idLimpio = String(destinatario).trim();
    const esBSUID = idLimpio.startsWith('CO.') || /[a-zA-Z]/.test(idLimpio);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual'
    };

    // 1. ASIGNACIÓN CORRECTA DEL DESTINATARIO
    if (esBSUID) {
      payload.recipient = idLimpio; // Obligatorio para BSUIDs (CO...)
    } else {
      payload.to = idLimpio.replace(/\D/g, ''); // Para números de teléfono (57323...)
    }

    // 2. CONSTRUCCIÓN DEL TIPO DE MENSAJE
    if (Array.isArray(botones) && botones.length > 0) {
      payload.type = 'interactive';
      payload.interactive = {
        type: 'button',
        body: { text: texto },
        action: {
          buttons: botones.slice(0, 3).map((btn) => ({
            type: 'reply',
            reply: {
              id: String(btn.id).trim(),
              title: String(btn.title).substring(0, 20).trim()
            }
          }))
        }
      };
    } else {
      payload.type = 'text';
      payload.text = { body: texto };
    }

    // 3. CONTEXTO PARA VINCULAR CON EL MENSAJE ENTRANTE
    if (messageId) {
      payload.context = { message_id: messageId };
    }

    console.log(`[WA SERVICE] Payload final enviado a Meta:`, JSON.stringify(payload, null, 2));

    const response = await axios({
      method: 'POST',
      url: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: payload,
      timeout: 10000
    });

    console.log(`[WA SERVICE] Mensaje entregado con éxito a Meta para ${idLimpio}`);
    return response.data;

  } catch (error) {
    console.error('[WA SERVICE ERROR]:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = { enviarMensaje };