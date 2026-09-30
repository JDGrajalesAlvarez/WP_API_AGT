// services/bot.service.js
const sessionService = require('./session.service');
const whatsappService = require('./whatsapp.service');

async function procesarMensaje(telefono, texto, nombreUsuario) {
  // 1. Obtener el estado actual (verifica expiraciones automáticamente)
  const usuario = await sessionService.obtenerEstadoUsuario(telefono);
  const mensajeLimpio = texto.trim().toLowerCase();

  // 2. Control del flujo según el estado
  switch (usuario.estado) {
    case sessionService.ESTADOS.PENDIENTE_POLITICAS:
      if (mensajeLimpio === '1' || mensajeLimpio === 'si' || mensajeLimpio === 'sí') {
        await sessionService.actualizarEstado(telefono, sessionService.ESTADOS.ACEPTADO);
        await whatsappService.enviarTexto(
          telefono, 
          `¡Gracias por aceptar ${nombreUsuario}! ¿En qué te podemos colaborar hoy?`
        );
      } else if (mensajeLimpio === '2' || mensajeLimpio === 'no') {
        await sessionService.actualizarEstado(telefono, sessionService.ESTADOS.RECHAZADO);
        await whatsappService.enviarTexto(
          telefono, 
          "Has rechazado el tratamiento de datos. No podemos continuar con la atención."
        );
      } else {
        // Solicitud de confirmación inicial o respuesta no válida
        await whatsappService.enviarTexto(
          telefono, 
          `Hola ${nombreUsuario}, para continuar debes autorizar nuestra política de privacidad de datos.\n\nResponde:\n1. Si acepto\n2. No acepto`
        );
      }
      break;

    case sessionService.ESTADOS.ACEPTADO:
      // Aquí colocas el menú principal o las respuestas de tu negocio
      await whatsappService.enviarTexto(
        telefono, 
        `Procesando tu consulta: "${texto}"`
      );
      break;

    case sessionService.ESTADOS.RECHAZADO:
      // Si vuelve a escribir tras haber rechazado
      await sessionService.actualizarEstado(telefono, sessionService.ESTADOS.PENDIENTE_POLITICAS);
      await whatsappService.enviarTexto(
        telefono, 
        `Hola ${nombreUsuario}. Para recibir atención debes aceptar nuestra política de datos.\n\nResponde:\n1. Acepto\n2. Rechazo`
      );
      break;
  }
}

module.exports = {
  procesarMensaje
};