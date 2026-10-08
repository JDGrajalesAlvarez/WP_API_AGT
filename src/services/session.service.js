// services/session.service.js
const { Pool } = require('pg');

// Configuración del Pool de conexiones a PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'postgres',
  password: String(process.env.DB_PASSWORD || '1234'),
  database: process.env.DB_NAME || 'api_whatsapp',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const ESTADOS = {
  PENDIENTE_POLITICAS: 'PENDIENTE_POLITICAS',
  ACEPTADO: 'ACEPTADO',
  RECHAZADO: 'RECHAZADO'
};

const POLICY_VERSION_ACTUAL = process.env.POLICY_VERSION || 'v1.0';

/**
 * Normaliza el identificador para poblar wa_user_id y phone_number respetando BSUIDs.
 */
/**
 * Normaliza el identificador para poblar wa_user_id y phone_number respetando BSUIDs.
 */
function extraerDatosIdentificador(identificador) {
  const idLimpio = String(identificador).trim();
  const esBSUID = idLimpio.startsWith('CO.') || /[a-zA-Z]/.test(idLimpio);

  return {
    waUserId: idLimpio,
    phoneNumber: esBSUID ? 'PRIVATED_BSUID' : idLimpio.replace(/\D/g, '')
  };
}

/**
 * Obtiene o crea al usuario en la base de datos PostgreSQL.
 * Valida si data_policy_accepted es verdadero para retornar el estado de sesión.
 */
async function obtenerEstadoUsuario(identificador, nombreUsuario = 'Usuario') {
  const { waUserId, phoneNumber } = extraerDatosIdentificador(identificador);

  // 1. Añadimos first_name al INSERT y al RETURNING
  // En ON CONFLICT, actualizamos el first_name si la persona cambió su nombre en WhatsApp
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
    // 2. Pasamos nombreUsuario ($3) en los parámetros de la consulta
    const result = await pool.query(queryUPSERT, [waUserId, phoneNumber, nombreUsuario]);
    const userRow = result.rows[0];
    const aceptoPoliticas = userRow.data_policy_accepted;

    // 3. Retornamos el firstName en el objeto final
    return {
      id: userRow.id, // UUID del usuario
      waUserId: userRow.wa_user_id,
      phoneNumber: userRow.phone_number,
      firstName: userRow.first_name, // 👈 Campo disponible en la sesión
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
 * Actualiza el consentimiento de políticas del usuario y registra la traza de auditoría legal (Transacción Atómica).
 * Acepta firma de objeto para coincidir con la llamada de bot.service.js
 */
async function registrarConsentimiento({ userId, wamid, consentStatus, policyVersion = POLICY_VERSION_ACTUAL, rawPayload, ipAddress = null }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN'); // Inicio de Transacción ACID

    const estaAceptado = (consentStatus === 'ACCEPTED');

    // 1. Actualizar estado mutable en la tabla users
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

    // 2. Insertar registro inmutable de auditoría en data_consent_logs
    const queryConsentLog = `
      INSERT INTO data_consent_logs (
        user_id, 
        wamid, 
        consent_status, 
        policy_version, 
        response_raw, 
        ip_address
      )
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

    await client.query('COMMIT');
    console.log(`[SESSION SERVICE] Consentimiento (${consentStatus}) registrado para el usuario UUID: ${userId}`);

    return {
      userId,
      waUserId,
      estado: estaAceptado ? ESTADOS.ACEPTADO : ESTADOS.RECHAZADO,
      dataPolicyAccepted: estaAceptado
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[SESSION SERVICE ERROR - registrarConsentimiento]:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Guarda un mensaje entrante o saliente en la tabla particionada 'messages'.
 */

// 1. Modifica guardarMensaje para retornar created_at formateado como texto ISO
async function guardarMensaje({ wamid, userId, direction, messageType, body, rawPayload }) {
  const query = `
    INSERT INTO messages (wamid, user_id, direction, message_type, body, raw_payload)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING wamid, created_at::text; -- 👈 Se retorna como string exacto ISO 8601
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
    return res.rows[0]; // Retorna { wamid, created_at } como string exacto
  } catch (error) {
    console.error('[SESSION SERVICE ERROR - guardarMensaje]:', error.message);
    throw error;
  }
}
/**
 * Agregado: Registra la traza del estado de un mensaje en la tabla 'message_statuses'
 */
// services/session.service.js

/**
 * Registra la traza del estado de un mensaje en la tabla 'message_statuses'
 */
// 2. Asegura que si se busca la fecha directamente en BD, también se obtenga como texto exacto
async function registrarEstadoMensaje({ wamid, messageCreatedAt, status, rawPayload }) {
  const query = `
    INSERT INTO message_statuses (wamid, message_created_at, status, raw_payload)
    VALUES ($1, $2::timestamptz, $3, $4)
    RETURNING id, status, created_at;
  `;

  try {
    const res = await pool.query(query, [
      wamid,
      messageCreatedAt, // Es el string devuelto por guardarMensaje
      status,           // 'received', 'sent', 'delivered', 'read', 'failed'
      JSON.stringify(rawPayload || {})
    ]);
    return res.rows[0];
  } catch (error) {
    console.error('[SESSION SERVICE ERROR - registrarEstadoMensaje]:', error.message);
    throw error;
  }
}


/**
 * Agregado: Fuerza el reintento de políticas en caso de haber sido rechazadas anteriormente
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
  registrarEstadoMensaje,
  forzarEstadoPendiente
};