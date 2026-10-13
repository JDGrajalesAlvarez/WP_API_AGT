// src/config/database.js
const { Pool } = require('pg');

/**
 * Pool de conexiones reutilizables hacia la base de datos PostgreSQL.
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

// Evento global para capturar errores inesperados en clientes inactivos del Pool
pool.on('error', (err) => {
    console.error('[DATABASE ERROR]: Error inesperado en un cliente inactivo de PostgreSQL:', err);
});

module.exports = {
    pool,
    query: (text, params) => pool.query(text, params)
};