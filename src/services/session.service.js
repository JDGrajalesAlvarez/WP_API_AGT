// services/session.service.js
const { Pool } = require('pg');

/**
 * Pool de conexiones reutilizables hacia la base de datos PostgreSQL.
 * Configurado con límites de tiempo para evitar fugas de recursos en producción.
 */
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || '1234'),
  database: process.env.DB_NAME || 'api_whatsapp',
  max: 20, // Máximo de conexiones simultáneas en el pool
  idleTimeoutMillis: 30000, // Cierra conexiones inactivas después de 30 segundos
  connectionTimeoutMillis: 2000, // Termina la espera si la conexión tarda más de 2 segundos
});

/**
 * Máquina de estados finitos para el flujo de consentimiento de datos del usuario.
 * @readonly
 * @enum {string}
 */
const ESTADOS = {
  PENDIENTE_POLITICAS: 'PENDIENTE_POLITICAS',
  ACEPTADO: 'ACEPTADO',
  RECHAZADO: 'RECHAZADO'
};

/** Versión global de los términos y condiciones cargada desde el entorno */
const POLICY_VERSION_ACTUAL = process.env.POLICY_VERSION || 'v1.0';

/**
 * Utilidad interna para normalizar los identificadores entrantes de WhatsApp.
 * Clasifica si el destino es una cuenta corporativa/ecosistema (BSUID) o un teléfono estándar.
 * 
 * @param {string|number} identificador - ID crudo proveniente de la API o webhook.
 * @returns {{waUserId: string, phoneNumber: string}} Datos limpios y normalizados para la BD.
 */
function extraerDatosIdentificador(identificador) {
  const idLimpio = String(identificador).trim();
  const esBSUID = idLimpio.startsWith('CO.') || /[a-zA-Z]/.test(idLimpio);

  return {
    waUserId: idLimpio,
    // Anonimiza el número telefónico si se detecta un canal estructurado como BSUID
    phoneNumber: esBSUID ? 'PRIVATED_BSUID' : idLimpio.replace(/\D/g, '')
  };
}

/**
 * Recupera el registro de un usuario o realiza un UPSERT si es la primera vez que interactúa.
 * Actualiza de forma proactiva el nombre registrado si el cliente lo modificó en su perfil de WhatsApp.
 * 
 * @param {string} identificador - Teléfono o BSUID del cliente.
 * @param {string} [nombreUsuario='Usuario'] - Nombre de perfil extraído del webhook.
 * @returns {Promise<object>} Estado de la sesión actual del usuario y metadatos básicos.
 */
async function obtenerEstadoUsuario(identificador, nombreUsuario = 'Usuario') {
  const { waUserId, phoneNumber } = extraerDatosIdentificador(identificador);

  const queryUPSERT = `
    INSERT INTO users (wa_user_id, phone_number, first_name, data_policy_accepted)
    VALUES ($1, $2, $3, FALSE)
    ON CONFLICT (wa_user_id) DO UPDATE 
    SET 
      first_name = EXCLUDED.first_name,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, wa_user_id, phone_number, first_name, data_policy_accepted, updated_at;
  `;

  try {
    const result = await pool.query(queryUPSERT, [waUserId, phoneNumber, nombreUsuario]);
    const userRow = result.rows[0];
    const aceptoPoliticas = userRow.data_policy_accepted;

    return {
      id: userRow.id, // UUID único del sistema interno
      waUserId: userRow.wa_user_id,
      phoneNumber: userRow.phone_number,
      firstName: userRow.first_name,
      estado: aceptoPoliticas ? ESTADOS.ACEPTADO : ESTADOS.PENDIENTE_POLITICAS,
      dataPolicyAccepted: aceptoPoliticas,
      updatedAt: userRow.updated_at
    };
  } catch (error) {
    console.error('[SESSION SERVICE ERROR - obtenerEstadoUsuario]:', error.message);
    throw error;
  }
}

/**
 * Modifica el consentimiento legal del usuario y escribe la traza inmutable en logs.
 * Ejecuta ambas operaciones bajo una transacción ACID estricta para mitigar estados inconsistentes.
 * 
 * @param {object} params - Parámetros estructurados de la firma del log.
 * @param {string} params.userId - UUID del usuario en base de datos.
 * @param {string} params.wamid - ID único del mensaje de WhatsApp que detonó la acción.
 * @param {string} params.consentStatus - Estado enviado ('ACCEPTED' o 'REJECTED').
 * @param {string} [params.policyVersion] - Versión legal evaluada.
 * @param {object} params.rawPayload - Objeto JSON completo del webhook para auditoría técnica.
 * @param {string|null} [params.ipAddress=null] - Opcional. Dirección IP del cliente.
 * @returns {Promise<object>} Estado resultante de la actualización de políticas.
 */
async function registrarConsentimiento({ userId, wamid, consentStatus, policyVersion = POLICY_VERSION_ACTUAL, rawPayload, ipAddress = null }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Inicio de Transacción Atómica

    const estaAceptado = (consentStatus === 'ACCEPTED');

    // 1. Actualización del estado lógico en el perfil del usuario
    const queryUpdateUser = `
      UPDATE users 
      SET data_policy_accepted = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING wa_user_id;
    `;
    const userResult = await client.query(queryUpdateUser, [estaAceptado, userId]);

    if (userResult.rowCount === 0) {
      throw new Error(`No se encontró el usuario con ID: ${userId}`);
    }

    const waUserId = userResult.rows[0].wa_user_id;

    // 2. Registro histórico inmutable en la tabla de auditoría legal
    const queryConsentLog = `
      INSERT INTO data_consent_logs (user_id, wamid, consent_status, policy_version, response_raw, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6);
    `;

    await client.query(queryConsentLog, [
      userId,
      wamid,
      consentStatus,
      policyVersion,
      JSON.stringify(rawPayload || {}),
      ipAddress
    ]);

    await client.query('COMMIT'); // Consolidación de cambios en disco

    return {
      userId,
      waUserId,
      estado: estaAceptado ? ESTADOS.ACEPTADO : ESTADOS.RECHAZADO,
      dataPolicyAccepted: estaAceptado
    };

  } catch (error) {
    await client.query('ROLLBACK'); // Aborta todos los cambios parciales ante cualquier fallo
    console.error('[SESSION SERVICE ERROR - registrarConsentimiento]:', error.message);
    throw error;
  } finally {
    client.release(); // Libera el cliente de vuelta al Pool de conexiones de inmediato
  }
}

/**
 * Almacena un mensaje (entrante o saliente) en la tabla 'messages'.
 * Devuelve el timestamp formateado explícitamente a texto ISO 8601 para evitar distorsiones horarias en Node.js.
 * 
 * @param {object} params
 * @param {string} params.wamid - Identificador único global de WhatsApp (Meta).
 * @param {string} params.userId - UUID de relación con la tabla 'users'.
 * @param {string} params.direction - Dirección del mensaje ('inbound' / 'outbound').
 * @param {string} params.messageType - Categoría del contenido ('text', 'interactive', etc.).
 * @param {string} params.body - Texto legible o ID del botón accionado.
 * @param {object} params.rawPayload - Payload técnico completo para almacenamiento JSONB.
 * @returns {Promise<{wamid: string, created_at: string}>}
 */
async function guardarMensaje({ wamid, userId, direction, messageType, body, rawPayload }) {
  const query = `
    INSERT INTO messages (wamid, user_id, direction, message_type, body, raw_payload)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING wamid, created_at::text;
  `;

  try {
    const res = await pool.query(query, [
      wamid,
      userId,
      direction,
      messageType,
      body,
      JSON.stringify(rawPayload || {})
    ]);
    return res.rows[0];
  } catch (error) {
    console.error('[SESSION SERVICE ERROR - guardarMensaje]:', error.message);
    throw error;
  }
}

/**
 * Recupera los últimos N mensajes de un usuario y los da con formato para el SDK del LLM.
 * 
 * @param {string} userId - UUID del usuario en PostgreSQL
 * @param {number} [limit=10] - Cantidad de mensajes a recuperar
 * @returns {Promise<Array<{role: string, parts: Array<{text: string}>}>>}
 */
async function obtenerHistorialChat(userId, limit = 10) {
  const query = `
    SELECT direction, body, created_at 
    FROM messages 
    WHERE user_id = $1 
      AND message_type = 'text'
      AND body IS NOT NULL
    ORDER BY created_at DESC 
    LIMIT $2;
  `;

  try {
    const res = await pool.query(query, [userId, limit]);

    // Invertir el array para orden cronológico (más antiguo primero)
    const filasCronologicas = res.rows.reverse();

    // Transformar al formato que espera Gemini SDK:
    // INBOUND -> 'user'
    // OUTBOUND -> 'model'
    return filasCronologicas.map((msg) => ({
      role: msg.direction === 'INBOUND' ? 'user' : 'model',
      parts: [{ text: msg.body }]
    }));
  } catch (error) {
    console.error('[SESSION SERVICE ERROR - obtenerHistorialChat]:', error.message);
    return []; // En caso de falla, retornamos historial vacío para no interrumpir el flujo
  }
}

/**
 * Inserta un registro histórico sobre el cambio de estado de un mensaje entregado.
 * Esencial para alimentar la tabla particionada de trazabilidad horaria ('message_statuses').
 * 
 * @param {object} params
 * @param {string} params.wamid - ID del mensaje original asociado.
 * @param {string} params.messageCreatedAt - Timestamp string exacto (ISO) obtenido de guardarMensaje.
 * @param {string} params.status - Nuevo estado reportado por Meta ('sent', 'delivered', 'read', 'failed').
 * @param {object} params.rawPayload - Payload completo de la actualización de estado para JSONB.
 * @returns {Promise<object>} Datos confirmados de la traza de estado guardada.
 */
async function registrarEstadoMensaje({ wamid, messageCreatedAt, status, rawPayload }) {
  const query = `
    INSERT INTO message_statuses (wamid, message_created_at, status, raw_payload)
    VALUES ($1, $2::timestamptz, $3, $4)
    RETURNING id, status, created_at;
  `;

  try {
    const res = await pool.query(query, [
      wamid,
      messageCreatedAt,
      status,
      JSON.stringify(rawPayload || {})
    ]);
    return res.rows[0];
  } catch (error) {
    console.error('[SESSION SERVICE ERROR - registrarEstadoMensaje]:', error.message);
    throw error;
  }
}

/**
 * Revoca el consentimiento de datos de un usuario de forma explícita.
 * Forza al sistema a volver a disparar el flujo de aceptación de políticas en la siguiente interacción.
 * 
 * @param {string} userId - UUID del usuario a desautorizar.
 * @returns {Promise<void>}
 */
async function forzarEstadoPendiente(userId) {
  const query = `
    UPDATE users
    SET data_policy_accepted = FALSE, updated_at = CURRENT_TIMESTAMP
    WHERE id = $1;
  `;

  try {
    await pool.query(query, [userId]);
  } catch (error) {
    console.error('[SESSION SERVICE ERROR - forzarEstadoPendiente]:', error.message);
    throw error;
  }
}

module.exports = {
  pool,
  ESTADOS,
  obtenerEstadoUsuario,
  registrarConsentimiento,
  guardarMensaje,
  obtenerHistorialChat,
  registrarEstadoMensaje,
  forzarEstadoPendiente
};
