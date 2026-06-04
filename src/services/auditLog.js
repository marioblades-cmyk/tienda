// ─────────────────────────────────────────────────────────────────────────
//  Auditoría de Acciones ("Caja Negra")
//  Registra cada paso de las acciones que tocan datos, para detectar
//  cómo se generan los fallos (pagos dobles, huérfanos, etc.).
//
//  Diseño: FIRE-AND-FORGET. Nunca bloquea ni rompe el flujo principal.
//  Si el registro falla, se ignora en silencio — el pago/acción sigue igual.
// ─────────────────────────────────────────────────────────────────────────
import { supabase } from './supabase';

// Genera un op_id único por acción del usuario (agrupa todos sus pasos)
export function newOpId() {
    try {
        if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    } catch { /* noop */ }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const dispositivo = () =>
    (typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent.slice(0, 150) : '');

// Escritura asíncrona sin await: no espera, no lanza, no afecta el flujo.
function write(entry) {
    try {
        supabase
            .from('audit_log')
            .insert([{
                client_ts: new Date().toISOString(), // hora exacta en el dispositivo (con ms)
                dispositivo: dispositivo(),
                ...entry,
            }])
            .then(({ error }) => {
                if (error) console.warn('[audit] no se pudo registrar:', error.message);
            }, (err) => {
                console.warn('[audit] insert rechazado:', err?.message);
            });
    } catch (e) {
        console.warn('[audit] excepción ignorada:', e?.message);
    }
}

export const audit = {
    // Marca el INICIO de una acción
    start(opId, { accion, vendedor_id, vendedor_nombre, cliente_id, cliente_nombre, detalle } = {}) {
        write({ op_id: opId, accion, vendedor_id, vendedor_nombre, cliente_id, cliente_nombre, paso: 'INICIO', estado: 'inicio', detalle });
    },
    // Registra un PASO intermedio exitoso (insert/update/delete que salió bien)
    step(opId, accion, paso, detalle) {
        write({ op_id: opId, accion, paso, estado: 'ok', detalle });
    },
    // Registra un paso que FALLÓ
    error(opId, accion, paso, error) {
        write({ op_id: opId, accion, paso, estado: 'error', error_msg: String(error?.message || error || 'error') });
    },
    // Marca el FIN exitoso de la acción
    done(opId, accion, detalle) {
        write({ op_id: opId, accion, paso: 'FIN', estado: 'ok', detalle });
    },
};
