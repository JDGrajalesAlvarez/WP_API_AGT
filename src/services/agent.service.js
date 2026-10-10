// src/services/agent.service.js
const sessionService = require('./session.service');
const aiService = require('./ai.service');

/**
 * Orquesta la respuesta inteligente para un usuario autorizado:
 * 1. Lee la memoria histórica de PostgreSQL
 * 2. Formatea la entrada actual
 * 3. Llama a Gemini
 * 
 * @param {string} userId - UUID del usuario
 * @param {string} textoEntrante - Pregunta/mensaje actual enviado por el usuario
 * @returns {Promise<string>} Respuesta procesada
 */
async function procesarConsultaConMemoria(userId, textoEntrante) {
    // 1. Obtener los últimos 10 mensajes (5 turnos de conversación) de la BD
    const historial = await sessionService.obtenerHistorialChat(userId, 10);

    // 2. Si el historial no contiene el mensaje entrante actual, lo añadimos
    const ultimoMensaje = historial[historial.length - 1];
    if (!ultimoMensaje || ultimoMensaje.parts[0].text !== textoEntrante) {
        historial.push({
            role: 'user',
            parts: [{ text: textoEntrante }]
        });
    }

    // 3. Invocar la IA con el contexto conversacional
    const respuestaLLM = await aiService.generarRespuesta({
        contents: historial,
        systemInstruction: 'Eres un asistente virtual corporativo útil, amable y directo. Responde de forma clara y adaptada a la consulta del usuario.'
    });

    return respuestaLLM;
}

module.exports = { procesarConsultaConMemoria };