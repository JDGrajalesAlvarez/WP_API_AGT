# WP_API_AGT

API PARA CONEXION DE AGENTE IA

tengo estas tablas en la bd llamada api_whatsapp:

-- ============================================================================
-- 1. EXTENSIONES Y FUNCIONES REUTILIZABLES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Función para actualizar 'updated_at' en tablas mutables
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;

$$
LANGUAGE plpgsql;

-- Función genérica para bloquear UPDATE y DELETE (Inmutabilidad Pura)
CREATE OR REPLACE FUNCTION prevent_modification()
RETURNS TRIGGER AS
$$

BEGIN
    RAISE EXCEPTION 'Operación no permitida: La tabla % es inmutable.', TG_TABLE_NAME;
    RETURN NULL;
END;

$$
LANGUAGE plpgsql;

-- ============================================================================
-- 2. TABLA: users (Perfil del usuario - MUTABLE)
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wa_user_id VARCHAR(100) NOT NULL UNIQUE,
    phone_number VARCHAR(20) NOT NULL,
    first_name VARCHAR(100),
    data_policy_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_users_wa_user_id ON users(wa_user_id);
CREATE INDEX idx_users_phone_number ON users(phone_number);

CREATE TRIGGER trigger_update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 3. TABLA INMUTABLE: data_consent_logs (Auditoría Legal de Datos)
-- ============================================================================
CREATE TABLE data_consent_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    wamid VARCHAR(255) NOT NULL,
    consent_status VARCHAR(20) NOT NULL CHECK (consent_status IN ('ACCEPTED', 'REJECTED', 'REVOKED')),
    policy_version VARCHAR(20) NOT NULL,
    response_raw JSONB NOT NULL,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX idx_consent_user_id ON data_consent_logs(user_id);
CREATE INDEX idx_consent_wamid ON data_consent_logs(wamid);

CREATE TRIGGER enforce_immutable_consent_logs
    BEFORE UPDATE OR DELETE ON data_consent_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ============================================================================
-- 4. TABLA PARTICIONADA: messages (Historial de Contenido)
-- ============================================================================
CREATE TABLE messages (
    wamid VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    message_type VARCHAR(30) NOT NULL,
    body TEXT,
    raw_payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (wamid, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_messages_user_created ON messages(user_id, created_at DESC);

-- ============================================================================
-- 5. CREACIÓN DE PARTICIONES DE MESSAGES
-- ============================================================================
CREATE TABLE messages_y2026m10 PARTITION OF messages
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE messages_y2026m11 PARTITION OF messages
    FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE messages_y2026m12 PARTITION OF messages
    FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE messages_y2027m01 PARTITION OF messages
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

CREATE TABLE messages_default PARTITION OF messages DEFAULT;

-- ============================================================================
-- 6. TRIGGERS DE INMUTABILIDAD SOBRE PARTICIONES DE MESSAGES
-- ============================================================================
-- Aplicación directa a las particiones físicas para evitar incompatibilidad con la tabla raíz
CREATE TRIGGER enforce_immutable_messages_y2026m10
    BEFORE UPDATE OR DELETE ON messages_y2026m10
    FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER enforce_immutable_messages_y2026m11
    BEFORE UPDATE OR DELETE ON messages_y2026m11
    FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER enforce_immutable_messages_y2026m12
    BEFORE UPDATE OR DELETE ON messages_y2026m12
    FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER enforce_immutable_messages_y2027m01
    BEFORE UPDATE OR DELETE ON messages_y2027m01
    FOR EACH ROW EXECUTE FUNCTION prevent_modification();

CREATE TRIGGER enforce_immutable_messages_default
    BEFORE UPDATE OR DELETE ON messages_default
    FOR EACH ROW EXECUTE FUNCTION prevent_modification();

-- ============================================================================
-- 7. TABLA INMUTABLE: message_statuses (Historial de Estados)
-- ============================================================================
CREATE TABLE message_statuses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wamid VARCHAR(255) NOT NULL,
    message_created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('received', 'sent', 'delivered', 'read', 'failed')),
    error_message TEXT,
    raw_payload JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (wamid, message_created_at) REFERENCES messages(wamid, created_at) ON DELETE RESTRICT
);

CREATE INDEX idx_statuses_wamid ON message_statuses(wamid);
CREATE INDEX idx_statuses_created_at ON message_statuses(created_at DESC);

CREATE TRIGGER enforce_immutable_statuses
    BEFORE UPDATE OR DELETE ON message_statuses
    FOR EACH ROW EXECUTE FUNCTION prevent_modification();
$$
