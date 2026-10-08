// services/bot.service.js
const sessionService = require('./session.service');
const whatsappService = require('./whatsapp.service');

/**
 * Orquestador principal del Bot de WhatsApp.
 * Procesa todos los mensajes entrantes (Inbound), gestiona el flujo de consentimiento legal,
 * almacena registros inmutables en PostgreSQL y deriva el control al agente de IA.
 * 
 * @async
 * @function procesarMensaje
 * @param {string} telefono - Número de teléfono del usuario (remitente).
 * @param {string} texto - Cuerpo del mensaje de texto enviado por el usuario.
 * @param {string} nombreUsuario - Nombre del perfil de WhatsApp del usuario.
 * @param {string} messageId - Identificador único global del mensaje de WhatsApp (wamid).
 * @param {Object} rawPayload - Objeto JSON completo con el payload crudo del webhook.
 * @returns {Promise<void>}
 */
async function procesarMensaje(telefono, texto, nombreUsuario, messageId, rawPayload) {
  // 1. Obtener el estado actual del usuario o inicializarlo si es la primera vez que interactúa
  const usuario = await sessionService.obtenerEstadoUsuario(telefono, nombreUsuario);

  // 2. REGISTRO INMUTABLE: Persistir el mensaje entrante en la tabla 'messages'
  const mensajeEntranteGuardado = await sessionService.guardarMensaje({
    wamid: messageId,
    userId: usuario.id,
    direction: 'INBOUND',
    messageType: 'text',
    body: texto,
    rawPayload: rawPayload
  });

  // 3. AUDITORÍA DE ESTADO: Registrar el estado inicial 'received' usando el timestamp exacto de la base de datos
  await sessionService.registrarEstadoMensaje({
    wamid: messageId,
    messageCreatedAt: mensajeEntranteGuardado.created_at,
    status: 'received',
    rawPayload: rawPayload
  });

  // Normalizar la entrada para evaluar de forma segura comandos de texto o IDs de interacción de botones
  const entrada = texto ? texto.trim().toLowerCase() : '';
  const linkPoliticas = "https://drive.google.com/file/d/aqui-va-el-link/view?usp=sharing";
  const policyVersion = "v1.0"; // Versión del documento de políticas para trazabilidad legal

  // 4. Máquina de estados: Control de flujo según el estado legal/conversacional del usuario
  switch (usuario.estado) {

    case sessionService.ESTADOS.PENDIENTE_POLITICAS:
      // CONDICIONAL 1: El usuario aprueba de forma explícita los términos legales
      if (['btn_acepto', '1', 'si', 'sí'].includes(entrada)) {
        await sessionService.registrarConsentimiento({
          userId: usuario.id,
          wamid: messageId,
          consentStatus: 'ACCEPTED',
          policyVersion: policyVersion,
          rawPayload: rawPayload
        });

        // Log crítico de auditoría legal
        console.log(`[AUDIT] Usuario ${telefono} ACEPTÓ términos y condiciones (${policyVersion}).`);

        // Avanza al flujo de bienvenida y activa el gatillo automatizado
        await ejecutarSiguienteAccion(usuario.id, telefono, nombreUsuario, messageId);
      }

      // CONDICIONAL 2: El usuario rechaza explícitamente los términos legales
      else if (['btn_rechazo', '2', 'no'].includes(entrada)) {
        await sessionService.registrarConsentimiento({
          userId: usuario.id,
          wamid: messageId,
          consentStatus: 'REJECTED',
          policyVersion: policyVersion,
          rawPayload: rawPayload
        });

        // Log crítico de auditoría legal
        console.log(`[AUDIT] Usuario ${telefono} RECHAZÓ términos y condiciones.`);

        const msjRechazo = "Has rechazado la política de tratamiento de datos. No podemos continuar con la atención.";
        const outboundMeta = await whatsappService.enviarMensaje(telefono, msjRechazo);

        await persistirMensajeSaliente(usuario.id, outboundMeta, msjRechazo);
      }

      // CONDICIONAL 3: Entrada inválida o primer contacto (Se despachan botones de consentimiento)
      else {
        const mensajePoliticas = `¡Hola ${nombreUsuario}! 👋\n\nAntes de comenzar, necesitamos tu confirmación respecto a nuestra política de tratamiento de datos personales.\n\nPuedes leer el documento aquí:\n📄 ${linkPoliticas}\n\n¿Aceptas nuestros términos y condiciones?`;
        const botones = [
          { id: 'btn_acepto', title: 'Sí, Acepto' },
          { id: 'btn_rechazo', title: 'No Acepto' }
        ];

        const outboundMeta = await whatsappService.enviarMensaje(telefono, mensajePoliticas, botones);
        await persistirMensajeSaliente(usuario.id, outboundMeta, mensajePoliticas);
      }
      break;

    case sessionService.ESTADOS.RECHAZADO:
      // Si un usuario rechazado vuelve a escribir, reinicia su flujo al estado pendiente de forma recursiva
      await sessionService.forzarEstadoPendiente(usuario.id);
      await procesarMensaje(telefono, '', nombreUsuario, messageId, rawPayload);
      break;

    case sessionService.ESTADOS.ACEPTADO:
      // BLOQUE DE IA: El usuario cuenta con autorización legal vigente, interactúa directo con el LLM
      await ejecutarAgenteIA(usuario.id, telefono, texto, messageId, rawPayload);
      break;
  }
}

/**
 * Flujo de transición automatizado tras la aceptación de políticas de datos.
 * Despacha el mensaje de bienvenida y prepara el terreno/contexto para la IA.
 * 
 * @async
 * @function ejecutarSiguienteAccion
 * @param {number|string} userId - ID interno del usuario en la base de datos PostgreSQL.
 * @param {string} telefono - Número de teléfono del usuario receptor.
 * @param {string} nombreUsuario - Nombre del usuario.
 * @param {string} inboundMessageId - ID del mensaje entrante que gatilló esta acción.
 * @returns {Promise<void>}
 */
async function ejecutarSiguienteAccion(userId, telefono, nombreUsuario, inboundMessageId) {
  const mensajeBienvenida = `¡Gracias por aceptar, ${nombreUsuario}! 🎉\n\n¿En qué te podemos ayudar hoy?`;

  // Despacha mensaje saliente por medio del proveedor de WhatsApp
  const outboundMeta = await whatsappService.enviarMensaje(telefono, mensajeBienvenida);

  // Persiste de manera inmutable el mensaje saliente y su estado inicial
  await persistirMensajeSaliente(userId, outboundMeta, mensajeBienvenida);

  /* TODO: Integración del Agente de IA para el saludo inicial automatizado (Proactivo)
     Ejemplo de implementación:
     const respuestaInicialIA = await aiGateway.generarSaludoInicial(userId);
     const metaIA = await whatsappService.enviarMensaje(telefono, respuestaInicialIA);
     await persistirMensajeSaliente(userId, metaIA, respuestaInicialIA); 
  */
}

/**
 * Canaliza la interacción conversacional activa del usuario con el Agente/LLM.
 * Esta función se ejecuta únicamente si el usuario ya aprobó la política de datos.
 * 
 * @async
 * @function ejecutarAgenteIA
 * @param {number|string} userId - ID interno del usuario en la base de datos PostgreSQL.
 * @param {string} telefono - Número de teléfono del usuario.
 * @param {string} texto - Entrada de texto actual provista por el usuario.
 * @param {string} inboundMessageId - ID del mensaje de WhatsApp de origen.
 * @param {Object} rawPayload - Payload original de la interacción.
 * @returns {Promise<void>}
 */
async function ejecutarAgenteIA(userId, telefono, texto, inboundMessageId, rawPayload) {
  /* TODO: Integración completa de la pasarela de Inteligencia Artificial (ai.gateway.js)
     1. Consultar el historial inmutable usando el userId para darle contexto a la IA:
        const historial = await sessionService.obtenerHistorialChat(userId);
     2. Enviar el texto actual + el historial al LLM:
        const respuestaIA = await aiGateway.procesarConAgente(userId, texto, historial);
     3. Despachar la respuesta de la IA al WhatsApp del usuario:
        const outboundMeta = await whatsappService.enviarMensaje(telefono, respuestaIA);
     4. Persistir el mensaje de la IA de forma inmutable:
        await persistirMensajeSaliente(userId, outboundMeta, respuestaIA); 
  */
}

/**
 * Abstracción auxiliar centralizada para guardar de forma inmutable mensajes salientes (Outbound).
 * Realiza el doble registro: guarda el mensaje en la tabla histórica y abre su bitácora de estados en 'sent'.
 * 
 * @async
 * @function persistirMensajeSaliente
 * @param {number|string} userId - ID interno del usuario en la base de datos PostgreSQL.
 * @param {Object} outboundMeta - Metadatos de respuesta retornados por la API de WhatsApp (debe contener wamid).
 * @param {string} cuerpoMensaje - El contenido textual exacto enviado al usuario.
 * @returns {Promise<void>}
 */
async function persistirMensajeSaliente(userId, outboundMeta, cuerpoMensaje) {
  // 1. Guardar el registro inmutable del mensaje saliente y capturar el timestamp real de la BD
  const mensajeGuardado = await sessionService.guardarMensaje({
    wamid: outboundMeta.wamid,
    userId: userId,
    direction: 'OUTBOUND',
    messageType: 'text',
    body: cuerpoMensaje,
    rawPayload: outboundMeta.rawPayload || {}
  });

  // 2. Inicializar el estado de este mensaje en 'sent' asignando el timestamp exacto devuelto por Postgres
  await sessionService.registrarEstadoMensaje({
    wamid: outboundMeta.wamid,
    messageCreatedAt: mensajeGuardado.created_at,
    status: 'sent',
    rawPayload: outboundMeta.rawPayload || {}
  });
}

module.exports = { procesarMensaje };
