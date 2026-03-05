import * as XLSX from 'xlsx';

/**
 * Normalizes a title for comparison and hashing.
 */
export function normalizeTitle(t) {
    return String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Generates a consistent 6-character hash for a string.
 */
export function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(31, h) + s.charCodeAt(i) | 0;
    }
    return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

/**
 * Parses an EAN/ISBN from a raw value.
 */
export function parseEAN(value) {
    if (value == null) return null;
    let s = String(value).trim();
    if (!s) return null;
    if (/^(s\/d|sin\s*isbn|isbn\s*a\s*confirmar|a\s*confirmar|por\s*confirmar|sd)$/i.test(s)) return null;
    s = s.replace(/[-\s.]/g, '').split(',')[0].replace(/[^0-9]/g, '');
    return s.length >= 10 ? s : null;
}

/**
 * Validates an EAN13 (simplified).
 */
export function validateEAN13(s) {
    return !!(s && s.length >= 10);
}

/**
 * Generates an internal EAN for titles without an official one.
 */
export function makeInternalEAN(titleNorm) {
    return 'INT-' + hashStr(titleNorm);
}

// --- SHEET PROCESSORS ---

export const PROCESSORS = {
    'Ivrea': (rows) => processStandard(rows, 'Ivrea', 0, 1, 2, 3),
    'Ovnipress': (rows) => processStandard(rows, 'Ovnipress', 1, 2, 3, 4),
    'Panini-Utopia': (rows) => processStandard(rows, 'Panini-Utopia', 1, 2, 3, 4),
    'Penguin': (rows) => processStandard(rows, 'Penguin', 1, 2, 3, 4),
    'Planeta': (rows) => processStandard(rows, 'Planeta', 0, 1, 2, 3),
    'Deux-PopFiction': (rows) => processStandard(rows, 'Deux-PopFiction', 2, 3, 4, 5),
    'Hotel de las Ideas': (rows) => processStandard(rows, 'Hotel de las Ideas', 1, 2, 3, 4),
    'V&R': (rows) => processStandard(rows, 'V&R', 1, 2, 3, 4),
    'Otras': (rows) => processStandard(rows, 'Otras', 1, 2, 3, 4),
    'Merchandising': (rows) => processStandard(rows, 'Merchandising', 0, 1, 2, 3),
};

function processStandard(rows, editorial, colTit, colIsbn, colPrec, colCant) {
    const rawItems = [];
    let started = false;
    let currentSection = 'GENERAL';
    const STOP_MARKERS = ['TOTAL', 'SUBTOTAL', 'GRAN TOTAL'];

    for (const row of rows) {
        const nonNull = row.filter(v => v != null && String(v).trim() !== '');
        if (!nonNull.length) continue;

        const firstStr = String(nonNull[0]).trim().toUpperCase();

        // Skip header/empty until we hit content
        if (!started) {
            if (firstStr === 'NOVEDADES' || firstStr === 'EDITORIAL' || row[colTit]) started = true;
            if (!started) continue;
        }

        if (STOP_MARKERS.some(s => firstStr.includes(s))) break;

        // Section detection (single cell rows)
        if (nonNull.length === 1 && isNaN(parseFloat(firstStr))) {
            currentSection = String(nonNull[0]).trim();
            continue;
        }

        const titulo = row[colTit] ? String(row[colTit]).trim() : null;
        if (!titulo || /^(titulo|nombre|producto)$/i.test(titulo)) continue;

        const eanRaw = row[colIsbn];
        let precio = null;
        if (row[colPrec] != null) {
            const p = parseFloat(String(row[colPrec]).replace(/[$.]/g, '').replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = parseInt(row[colCant]);
        if (isNaN(cantidad) || cantidad <= 0) continue;

        rawItems.push({
            editorial,
            titulo,
            isbn_raw: String(eanRaw ?? ''),
            precio,
            cantidad,
            categoria: currentSection,
        });
    }
    return rawItems;
}

/**
 * Main entry point for reading Excel files.
 */
export async function readExcelRaw(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array' });
                const resultado = [];

                // Standardize sheet names for mapping
                const sheetMap = {};
                wb.SheetNames.forEach(n => {
                    sheetMap[n.trim()] = n;
                });

                for (const key in PROCESSORS) {
                    const actualName = sheetMap[key];
                    if (actualName) {
                        const rows = XLSX.utils.sheet_to_json(wb.Sheets[actualName], { header: 1, defval: null });
                        const items = PROCESSORS[key](rows);
                        resultado.push(...items);
                    }
                }
                resolve(resultado);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}
