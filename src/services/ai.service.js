// src/services/ai.service.js
const { GoogleGenAI } = require('@google/genai');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.warn('[AI SERVICE] ADVERTENCIA: GEMINI_API_KEY no está configurada en el .env');
}

const ai = new GoogleGenAI({ apiKey });

/**
 * Llama a la API de Gemini usando la versión de modelo vigente.
 */
async function generarRespuesta({ contents, systemInstruction }) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash', // 👈 Modelo actualizado según el aviso de la API
            contents: contents,
            config: {
                systemInstruction: systemInstruction || 'Eres un asistente de atención al cliente educado, claro y conciso.'
            }
        });

        return response.text || 'Lo siento, no pude procesar la respuesta en este momento.';
    } catch (error) {
        console.error('[AI SERVICE ERROR]:', error.message);
        throw new Error('Error al comunicarse con el proveedor de IA.');
    }
}

module.exports = { generarRespuesta };