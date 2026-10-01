// services/whatsapp.service.js
const axios = require('axios');

async function enviarMensajeBotones(to, textoCuerpo, botones) {
  try {
    const apiVersion = process.env.GRAPH_API_VERSION || 'v20.0';
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    // Si el ID contiene letras/puntos (ej: CO.1090...), es un User ID de Meta
    const esUserId = /[a-zA-Z\.]/.test(to);

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual', // <-- OBLIGATORIO para permitir el envío a User IDs de Meta
      to: to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: textoCuerpo },
        action: {
          buttons: botones.map((btn) => ({
            type: 'reply',
            reply: { id: btn.id, title: btn.title }
          }))
        }
      }
    };

    const response = await axios({
      method: 'POST',
      url: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: payload
    });

    console.log(`[WA SERVICE] Botones enviados a ${to}`);
    return response.data;
  } catch (error) {
    console.error('[WA SERVICE ERROR]:', error.response ? error.response.data : error.message);
    throw error;
  }
}

async function enviarTexto(to, texto) {
  try {
    const apiVersion = process.env.GRAPH_API_VERSION || 'v20.0';
    const phoneNumberId = process.env.PHONE_NUMBER_ID;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual', // <-- OBLIGATORIO
      to: to,
      type: 'text',
      text: { body: texto }
    };

    const response = await axios({
      method: 'POST',
      url: `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      headers: {
        'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      data: payload
    });

    console.log(`[WA SERVICE] Texto enviado a ${to}`);
    return response.data;
  } catch (error) {
    console.error('[WA SERVICE ERROR]:', error.response ? error.response.data : error.message);
    throw error;
  }
}

module.exports = {
  enviarTexto,
  enviarMensajeBotones
};