-- Capa 3: garantiza a nivel de base de datos que nunca puede haber
-- más de un turno_caja con estado = 'ABIERTO' al mismo tiempo.
-- Aunque dos peticiones lleguen en el mismo instante (doble clic, dos
-- dispositivos), Postgres deja pasar solo la primera y rechaza la segunda
-- con un error de constraint (código 23505), que la app ya sabe manejar.
-- Ejecutar en Supabase Dashboard > SQL Editor

CREATE UNIQUE INDEX IF NOT EXISTS turnos_caja_unico_abierto
    ON turnos_caja (estado)
    WHERE estado = 'ABIERTO';
