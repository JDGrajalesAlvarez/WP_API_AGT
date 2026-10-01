// services/bot.service.js
const sessionService = require('./session.service');
const whatsappService = require('./whatsapp.service');

async function procesarMensaje(telefono, texto, nombreUsuario) {
  // 1. Obtener estado actual de la sesión
  const usuario = await sessionService.obtenerEstadoUsuario(telefono);
  
  // Normalizar la entrada para comparar IDs de botones o texto escrito
  const entrada = texto ? texto.trim().toLowerCase() : '';
  const linkPoliticas = "https://drive.google.com/file/d/aqui-va-el-link/view?usp=sharing";

  // 2. Control del flujo
  switch (usuario.estado) {
    case sessionService.ESTADOS.PENDIENTE_POLITICAS:
      
      // -------------------------------------------------------------
      // CONDICIONAL 1: El usuario presionó "Sí, Acepto" (o escribió 1 / Sí)
      // -------------------------------------------------------------
      if (entrada === 'btn_acepto' || entrada === '1' || entrada === 'si' || entrada === 'sí') {
        
        // A. Guardar cambio de estado
        await sessionService.actualizarEstado(telefono, sessionService.ESTADOS.ACEPTADO);
        console.log(`[POLITICAS] Usuario ${telefono} ACEPTÓ los términos.`);

        // B. SALTAR A LA SIGUIENTE ACCIÓN (Ej: Menú Principal o Bienvenida)
        await ejecutarSiguienteAccion(telefono, nombreUsuario);
      } 
      
      // -------------------------------------------------------------
      // CONDICIONAL 2: El usuario presionó "No Acepto" (o escribió 2 / No)
      // -------------------------------------------------------------
      else if (entrada === 'btn_rechazo' || entrada === '2' || entrada === 'no') {
        
        // A. Guardar estado rechazado
        await sessionService.actualizarEstado(telefono, sessionService.ESTADOS.RECHAZADO);
        console.log(`[POLITICAS] Usuario ${telefono} RECHAZÓ los términos.`);

        // B. Acción de fin de conversación
        await whatsappService.enviarTexto(
          telefono, 
          "Has rechazado la política de tratamiento de datos. No podemos continuar con la atención."
        );
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

        await whatsappService.enviarMensajeBotones(telefono, mensajePoliticas, botones);
      }
      break;

    case sessionService.ESTADOS.ACEPTADO:
      // Si el usuario ya aceptó y sigue escribiendo mensajes posteriormente
      await whatsappService.enviarTexto(
        telefono, 
        `Procesando tu consulta: "${texto}"`
      );
      break;

    case sessionService.ESTADOS.RECHAZADO:
      // Si vuelve a escribir tras haber rechazado
      await sessionService.actualizarEstado(telefono, sessionService.ESTADOS.PENDIENTE_POLITICAS);
      await procesarMensaje(telefono, '', nombreUsuario); // Reintenta enviando de nuevo los botones
      break;
  }
}

// -------------------------------------------------------------------
// FUNCIÓN AUXILIAR: Siguiente Acción tras Aceptar Políticas
// -------------------------------------------------------------------
async function ejecutarSiguienteAccion(telefono, nombreUsuario) {
  // Aquí defines lo que pasa Inmediatamente después de aceptar (ejemplo: enviar menú)
  const mensajeBienvenida = `¡Gracias por aceptar, ${nombreUsuario}! 🎉\n\n¿En qué te podemos ayudar hoy?\n1. Ver Productos\n2. Hablar con un asesor\n3. Consultar horario`;
  
  await whatsappService.enviarTexto(telefono, mensajeBienvenida);
}

module.exports = {
  procesarMensaje
};