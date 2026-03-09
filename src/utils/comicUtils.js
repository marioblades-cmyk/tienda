/**
 * Comic Analysis Utilities
 * Extraído de Entelequia Processor v2.1
 */

const EAN_EMPTY_PATTERN = /^(s\/d|sin\s*isbn|isbn\s*a\s*confirmar|a\s*confirmar|por\s*confirmar|sd|sd\s*|sd\s*)$/i;

export function normalizeTitle(t) {
    if (t == null) return '';
    return String(t).toLowerCase().trim().replace(/\s+/g, ' ');
}

export function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

export function makeProductId(prefix, title) {
    return prefix + ':' + hashStr(normalizeTitle(title));
}

export function parseEAN(value) {
    if (value == null) return null;
    let s = String(value).trim();
    if (!s) return null;

    // Check for "sd", "a confirmar", etc.
    if (EAN_EMPTY_PATTERN.test(s)) return null;

    // Clean: quita guiones, puntos y espacios.
    // Si hay comas, toma el primer valor.
    // Borra letras.
    let firstPart = s.split(',')[0].trim();
    let cleaned = firstPart.replace(/[-\s.]/g, '').replace(/[^0-9]/g, '');

    return cleaned.length >= 10 ? cleaned : null;
}

export function validateEAN13(s) {
    return !!(s && (s.length === 13 || s.length === 10));
}

export function makeInternalEAN(titleNorm) {
    return 'INT-' + hashStr(titleNorm);
}

export function cleanISBN(value) {
    return parseEAN(value); // Shared logic as per user requirement
}
