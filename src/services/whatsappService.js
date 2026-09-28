const axios = require("axios");

const enviarMensajeTexto = async (to, text) => {
  const tokenCargado = process.env.WHATSAPP_TOKEN || "";
  console.log(
    `[DEBUG TOKEN EN NODE] Inicio: "${tokenCargado.substring(0, 10)}..." | Largo total: ${tokenCargado.length}`,
  );
  try {
    const url = `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`;

    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "text",
      text: { body: text },
    };

    const config = {
      headers: {
        // Asegúrate de que el espacio después de Bearer esté presente
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    };

    const response = await axios.post(url, data, config);
    return response.data;
  } catch (error) {
    if (error.response) {
      console.error("[ERROR META API]:", error.response.data);
    } else {
      console.error("[ERROR RED/AXIOS]:", error.message);
    }
    throw error;
  }
};

module.exports = { enviarMensajeTexto };
