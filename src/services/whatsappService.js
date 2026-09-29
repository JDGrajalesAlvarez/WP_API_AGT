require('dotenv').config(); // Carga de respaldo si no se ha inicializado previamente
const axios = require('axios');

const enviarMensajeTexto = async (to, text) => {
  const tokenCargado = process.env.WHATSAPP_TOKEN || '';
  console.log(`[DEBUG TOKEN EN NODE] Inicio: "${tokenCargado.substring(0, 10)}..." | Largo total: ${tokenCargado.length}`);

  if (!tokenCargado) {
    throw new Error('El WHATSAPP_TOKEN no está definido en las variables de entorno.');
  }

  try {
    const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;

    const response = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('[ERROR META API]:', error.response?.data || error.message);
    throw error;
  }
};

module.exports = { enviarMensajeTexto };