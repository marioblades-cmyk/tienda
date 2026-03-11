ALTER TABLE catalogo_sync_logs ADD COLUMN IF NOT EXISTS semana_id UUID REFERENCES semanas(id);
