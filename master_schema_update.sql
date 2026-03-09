-- ESQUEMA COMPLETO Y ACTUALIZADO PARA BASE MASTER (CONFIRMACIONES)
-- Ejecutar en Supabase SQL Editor. Este script crea la tabla desde cero si no existe
-- o añade las columnas que faltan si por algún motivo ya había sido creada parcialmente.

CREATE TABLE IF NOT EXISTS master_confirmaciones (
  id SERIAL PRIMARY KEY,
  semana_id UUID REFERENCES semanas(id) ON DELETE CASCADE,
  titulo_despacho TEXT NOT NULL,
  total_ars NUMERIC DEFAULT 0,
  datos_json JSONB NOT NULL,
  fecha_subida TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_semana_master UNIQUE (semana_id)
);

-- Asegurar que las nuevas columnas requeridas para el cálculo de Cajas y Totales existan:
ALTER TABLE master_confirmaciones 
ADD COLUMN IF NOT EXISTS total_productos NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS costo_envio NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS envio_texto TEXT,
ADD COLUMN IF NOT EXISTS cajas_qty INTEGER DEFAULT 0;

-- Políticas de Seguridad (RLS) habilitadas para que la app funcione correctamente
ALTER TABLE master_confirmaciones ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'master_confirmaciones' AND policyname = 'Permitir todo a autenticados en confirmaciones'
    ) THEN
        CREATE POLICY "Permitir todo a autenticados en confirmaciones" 
        ON master_confirmaciones FOR ALL USING (auth.role() = 'authenticated');
    END IF;
END $$;
