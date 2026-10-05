// services/session.service.js

// Almacenamiento en memoria (Reemplazable por MySQL/Redis en producción)
const sesiones = new Map();

// Tiempo límite de inactividad antes de expirar la conversación (ej: 15 minutos)
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

const ESTADOS = {
  PENDIENTE_POLITICAS: 'PENDIENTE_POLITICAS',
  ACEPTADO: 'ACEPTADO',
  RECHAZADO: 'RECHAZADO'
};

/**
 * Obtiene o inicializa la sesión de un usuario.
 * Evalúa si la sesión activa expiró por inactividad.
 */
async function obtenerEstadoUsuario(telefono) {
  let usuario = sesiones.get(telefono);

  if (!usuario) {
    usuario = {
      telefono,
      estado: ESTADOS.PENDIENTE_POLITICAS,
      ultimaInteraccion: Date.now()
    };
    sesiones.set(telefono, usuario);
    return usuario;
  }

  // Comprobar si el tiempo de inactividad expiró (si ya había aceptado políticas)
  const tiempoTranscurrido = Date.now() - usuario.ultimaInteraccion;
  
  if (usuario.estado === ESTADOS.ACEPTADO && tiempoTranscurrido > INACTIVITY_TIMEOUT_MS) {
    // console.log(`[SESSION] La sesión de ${telefono} ha expirado por inactividad.`);
    
    // Reiniciamos al flujo de políticas/bienvenida
    usuario.estado = ESTADOS.PENDIENTE_POLITICAS;
  }

  // Actualizar la estampa de tiempo de la última interacción
  usuario.ultimaInteraccion = Date.now();
  sesiones.set(telefono, usuario);

  return usuario;
}

/**
 * Actualiza el estado de la sesión de un usuario.
 */
async function actualizarEstado(telefono, nuevoEstado) {
  const usuario = sesiones.get(telefono) || { telefono };
  
  usuario.estado = nuevoEstado;
  usuario.ultimaInteraccion = Date.now();
  
  sesiones.set(telefono, usuario);
  // console.log(`[SESSION] Estado actualizado para ${telefono}: ${nuevoEstado}`);
  
  return usuario;
}

module.exports = {
  ESTADOS,
  obtenerEstadoUsuario,
  actualizarEstado
};