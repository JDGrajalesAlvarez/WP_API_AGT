// services/whatsapp.service.js
const axios = require('axios');

/**
 * Envía un mensaje de texto plano a un número específico
 * @param {string} to - Número de teléfono del destinatario (ej: "573104665545")
 * @param {string} body - Mensaje a enviar
 */
async function enviarTexto(to, body) {
  try {
    const response = await axios({
      method: 'POST',
      url: `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/${process.env.PHONE_NUMBER_ID}/messages`,
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: {
        messaging_product: 'whatsapp',
        to: to,
        type: 'text',
        text: {
          body: body
        }
      }
    });

    console.log(`[WA SERVICE] Mensaje enviado a ${to}: ID ${response.data?.messages?.[0]?.id}`);
    return response.data;
  } catch (error) {
    console.error('[WA SERVICE ERROR]:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  enviarTexto
};