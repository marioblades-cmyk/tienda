/**
 * Utilidades de fecha/hora para Bolivia (UTC-4, America/La_Paz).
 * Usar SIEMPRE estas funciones para mostrar fechas en la UI
 * en lugar de toLocaleDateString/toLocaleTimeString directamente.
 */

const TZ = 'America/La_Paz';
const LOCALE = 'es-BO';

/**
 * Fecha corta: "19 may" / "05 jun"
 */
export const ffecha = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString(LOCALE, {
        timeZone: TZ,
        day: '2-digit',
        month: 'short',
    });
};

/**
 * Fecha larga: "19 may 2026"
 */
export const ffechaLarga = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString(LOCALE, {
        timeZone: TZ,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
};

/**
 * Solo hora: "22:55"
 */
export const fhora = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleTimeString(LOCALE, {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
    });
};

/**
 * Fecha + hora: "19 may · 22:55"
 */
export const ffechaHora = (val) => {
    if (!val) return '—';
    return `${ffecha(val)} · ${fhora(val)}`;
};

/**
 * "YYYY-MM-DD" de HOY en Bolivia — para defaults de inputs <input type="date">.
 * (Evita que después de las 20:00 se use la fecha UTC del día siguiente.)
 */
export const hoyBO = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

/**
 * Formatea una fecha pura "YYYY-MM-DD" como "DD/MM/YYYY" SIN conversión de zona.
 * Usar para fechas-solo (sin hora) para que no se corran un día.
 */
export const ffechaDia = (val) => {
    if (!val) return '—';
    const [y, m, d] = String(val).slice(0, 10).split('-');
    return (y && m && d) ? `${d}/${m}/${y}` : String(val);
};

/**
 * "19/05/2026 22:55" — para notas y tags internos
 */
export const fstamp = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    return d.toLocaleDateString(LOCALE, {
        timeZone: TZ,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }) + ' ' + d.toLocaleTimeString(LOCALE, {
        timeZone: TZ,
        hour: '2-digit',
        minute: '2-digit',
    });
};
