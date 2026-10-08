// services/bot.service.js
const sessionService = require('./session.service');
const whatsappService = require('./whatsapp.service');

/**
 * Procesa los mensajes entrantes de WhatsApp controlando el flujo de consentimiento
 * y persistiendo los datos de manera inmutable en PostgreSQL.
 */
async function procesarMensaje(telefono, texto, nombreUsuario, messageId, rawPayload) {
  // 1. Obtener o crear el usuario en la BD
  const usuario = await sessionService.obtenerEstadoUsuario(telefono, nombreUsuario);

  // =========================================================================
  // 🛠️ SOLUCIÓN: Capturar el timestamp exacto devuelto por PostgreSQL
  // =========================================================================
  // 2. REGISTRO INMUTABLE: Guardar el mensaje entrante en la tabla 'messages'
  const mensajeEntranteGuardado = await sessionService.guardarMensaje({
    wamid: messageId,
    userId: usuario.id,
    direction: 'INBOUND',
    messageType: 'text',
    body: texto,
    rawPayload: rawPayload
  });
  // 3. REGISTRO INMUTABLE: Inicializar el estado del mensaje entrante como 'received'
  await sessionService.registrarEstadoMensaje({
    wamid: messageId,
    messageCreatedAt: mensajeEntranteGuardado.created_at, // <-- Cambiado de 'new Date()' a la fecha real de la BD
    status: 'received',
    rawPayload: rawPayload
  });

  // Normalizar la entrada para comparar IDs de botones o texto escrito
  const entrada = texto ? texto.trim().toLowerCase() : '';
  const linkPoliticas = "https://drive.google.com/file/d/aqui-va-el-link/view?usp=sharing";
  const policyVersion = "v1.0"; // Versión de tus políticas para la auditoría legal

  // 4. Control del flujo según el estado del usuario
  switch (usuario.estado) {
    case sessionService.ESTADOS.PENDIENTE_POLITICAS:

      // -------------------------------------------------------------
      // CONDICIONAL 1: El usuario presionó "Sí, Acepto"
      // -------------------------------------------------------------
      if (['btn_acepto', '1', 'si', 'sí'].includes(entrada)) {

        // A. Guardar consentimiento legal inmutable e internamente actualizar la tabla 'users'
        await sessionService.registrarConsentimiento({
          userId: usuario.id,
          wamid: messageId,
          consentStatus: 'ACCEPTED',
          policyVersion: policyVersion,
          rawPayload: rawPayload
        });

        console.log(`[POLITICAS] Usuario ${telefono} ACEPTÓ los términos.`);

        // B. Saltar a la acción de bienvenida y disparador de IA
        await ejecutarSiguienteAccion(usuario.id, telefono, nombreUsuario, messageId);
      }

      // -------------------------------------------------------------
      // CONDICIONAL 2: El usuario presionó "No Acepto"
      // -------------------------------------------------------------
      else if (['btn_rechazo', '2', 'no'].includes(entrada)) {

        // A. Guardar rechazo legal inmutable en 'data_consent_logs' e internamente actualizar 'users'
        await sessionService.registrarConsentimiento({
          userId: usuario.id,
          wamid: messageId,
          consentStatus: 'REJECTED',
          policyVersion: policyVersion,
          rawPayload: rawPayload
        });

        console.log(`[POLITICAS] Usuario ${telefono} RECHAZÓ los términos.`);

        // B. Enviar mensaje de salida del flujo
        const msjRechazo = "Has rechazado la política de tratamiento de datos. No podemos continuar con la atención.";
        const outboundMeta = await whatsappService.enviarMensaje(telefono, msjRechazo);

        // C. Persistir el mensaje saliente de rechazo y su estado
        await persistirMensajeSaliente(usuario.id, outboundMeta, msjRechazo);
      }

      // -------------------------------------------------------------
      // CONDICIONAL 3: Primer contacto (Enviar los botones de confirmación)
      // -------------------------------------------------------------
      else {
        const mensajePoliticas = `¡Hola ${nombreUsuario}! 👋\n\nAntes de comenzar, necesitamos tu confirmación respecto a nuestra política de tratamiento de datos personales.\n\nPuedes leer el documento aquí:\n📄 ${linkPoliticas}\n\n¿Aceptas nuestros términos y condiciones?`;

        const botones = [
          { id: 'btn_acepto', title: 'Sí, Acepto' },
          { id: 'btn_rechazo', title: 'No Acepto' }
        ];

        const outboundMeta = await whatsappService.enviarMensaje(telefono, mensajePoliticas, botones);

        // Persistir el mensaje enviado con las políticas
        await persistirMensajeSaliente(usuario.id, outboundMeta, mensajePoliticas);
      }
      break;

    case sessionService.ESTADOS.RECHAZADO:
      // Si vuelve a escribir tras haber rechazado, pasa a pendiente y se le reenvían los términos
      await sessionService.forzarEstadoPendiente(usuario.id);
      await procesarMensaje(telefono, '', nombreUsuario, messageId, rawPayload);
      break;

    case sessionService.ESTADOS.ACEPTADO:
      // -------------------------------------------------------------
      // BLOQUE DE IA: El usuario ya está autorizado y sigue chateando
      // -------------------------------------------------------------
      await ejecutarAgenteIA(usuario.id, telefono, texto, messageId, rawPayload);
      break;
  }
}

// -------------------------------------------------------------------
// FUNCIÓN AUXILIAR: Siguiente Acción tras Aceptar Políticas
// -------------------------------------------------------------------
async function ejecutarSiguienteAccion(userId, telefono, nombreUsuario, inboundMessageId) {
  const mensajeBienvenida = `¡Gracias por aceptar, ${nombreUsuario}! 🎉\n\n¿En qué te podemos ayudar hoy?`;

  // 1. Enviar el mensaje de éxito a través del proveedor de WhatsApp
  const outboundMeta = await whatsappService.enviarMensaje(telefono, mensajeBienvenida);

  // 2. Guardar el mensaje saliente en la BD inmutable
  await persistirMensajeSaliente(userId, outboundMeta, mensajeBienvenida);

  // =================================================================
  // 🚀 EL DISPARADOR DEL AGENTE DE IA
  // =================================================================
  // Este mensaje de agradecimiento sirve como el catalizador para que el bot tome la iniciativa
  // o deje el contexto listo para responder la siguiente pregunta del usuario de forma proactiva.

  console.log(`[IA DISPARADOR] Activando agente para el usuario ${userId} tras la aceptación.`);

  /* 
    TODO: Integración del Agente de IA para el saludo inicial automatizado
    Ejemplo de flujo futuro:
    const respuestaInicialIA = await aiGateway.generarSaludoInicial(userId);
    const metaIA = await whatsappService.enviarMensaje(telefono, respuestaInicialIA);
    await persistirMensajeSaliente(userId, metaIA, respuestaInicialIA);
  */
}

// -------------------------------------------------------------------
// FUNCIÓN AUXILIAR: Lógica de la IA para conversaciones activas
// -------------------------------------------------------------------
async function ejecutarAgenteIA(userId, telefono, texto, inboundMessageId, rawPayload) {
  console.log(`[IA CORE] El usuario ${userId} está interactuando con la IA.`);

  /* 
    TODO: Integración completa de la pasarela de Inteligencia Artificial (ai.gateway.js)
    
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

// -------------------------------------------------------------------
// FUNCIÓN AUXILIAR: Abstracción de guardado inmutable saliente
// -------------------------------------------------------------------
async function persistirMensajeSaliente(userId, outboundMeta, cuerpoMensaje) {
  // Guardar mensaje y capturar el timestamp exacto retornado por Postgres
  const mensajeGuardado = await sessionService.guardarMensaje({
    wamid: outboundMeta.wamid,
    userId: userId,
    direction: 'OUTBOUND',
    messageType: 'text',
    body: cuerpoMensaje,
    rawPayload: outboundMeta.rawPayload || {}
  });

  // Inicializa el estado en 'sent' dentro de 'message_statuses'
  await sessionService.registrarEstadoMensaje({
    wamid: outboundMeta.wamid,
    messageCreatedAt: mensajeGuardado.created_at, // <-- Usar el timestamp retornado
    status: 'sent',
    rawPayload: outboundMeta.rawPayload || {}
  });
}

module.exports = {
  procesarMensaje
};
