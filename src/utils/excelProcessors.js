import {
    normalizeTitle,
    hashStr,
    makeProductId,
    parseEAN,
    validateEAN13,
    makeInternalEAN,
    cleanISBN
} from './comicUtils';

/**
 * Constants extracted from original HTML
 */
const SECTION_MARKERS = new Set([
    'NOVEDADES', 'REIMPRESIONES', 'MANGAS EN CURSO',
    'MANGAS YA COMPLETOS', 'MANGAS DE TOMO UNICO', 'COMICS'
]);

const SKIP_MARKERS = new Set([
    'POR FAVOR COMPLETAR LAS REEDICIONES ARRIBA. NO EN EL FONDO!'
]);

const STOP_MARKERS = ['TOTAL', 'SUBTOTAL', 'GRAN TOTAL'];

/**
 * IVREA PROCESSOR
 */
export function processIvrea(sheetData) {
    const rows = sheetData;
    const rawItems = [];
    let started = false;
    let currentSection = null;
    let skippedBefore = 0;
    const eliminados = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        // START: Fila con unico valor NOVEDADES
        if (!started) {
            const nonNull = row.filter(v => v != null && String(v).trim() !== '');
            if (nonNull.length === 1 && String(nonNull[0]).trim().toUpperCase() === 'NOVEDADES') {
                started = true;
                currentSection = 'NOVEDADES';
            } else {
                skippedBefore++;
            }
            continue;
        }

        // PARADA: Primer string es TOTAL, SUBTOTAL o GRAN TOTAL
        const firstCell = row[0] != null ? String(row[0]).trim().toUpperCase() : '';
        if (firstCell === 'TOTAL' || firstCell === 'SUBTOTAL' || firstCell === 'GRAN TOTAL') break;

        // SALTAR FILA: Texto exacto REEDICIONES o encabezados
        if (firstCell === 'POR FAVOR COMPLETAR LAS REEDICIONES ARRIBA. NO EN EL FONDO!') continue;
        if (isHeaderRow(row)) continue;

        // Detectar cambio de seccion
        const sec = isSectionMarker(row);
        if (sec) { currentSection = sec; continue; }

        const titulo = row[0] != null ? String(row[0]).trim() : null;
        if (!titulo) continue;

        const eanRaw = row[1] != null ? row[1] : null;
        let precio = null;
        if (row[2] != null) {
            const p = parseFloat(String(row[2]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[3] != null) {
            const c = parseInt(row[3]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            eanRaw,
            eanRawStr: String(eanRaw ?? ''),
            precio,
            cantidad,
            categoria: currentSection,
            agotado_distribuidor: (currentSection === 'REIMPRESIONES') ? false : (row.__isRed === true)
        });
    }

    // Phase 2: Group by title
    const byTitle = {};
    for (const item of rawItems) {
        if (!byTitle[item.tituloNorm]) byTitle[item.tituloNorm] = [];
        byTitle[item.tituloNorm].push(item);
    }

    let exactDupesRemoved = 0;
    let reimprMarked = 0;
    let reimprSoloError = 0;
    const finalItems = [];

    for (const [tituloNorm, occurrences] of Object.entries(byTitle)) {
        const reimprEntries = occurrences.filter(o => o.categoria === 'REIMPRESIONES');
        let mainEntries = occurrences.filter(o => o.categoria !== 'REIMPRESIONES');

        const seen = new Set();
        const dedupedMain = [];
        for (const o of mainEntries) {
            const key = o.tituloNorm + '|' + String(o.eanRaw);
            if (seen.has(key)) {
                exactDupesRemoved++;
                eliminados.push({ titulo: o.titulo, ean: o.eanRawStr, motivo: 'Duplicado exacto (Titulo + ISBN)', categoria: o.categoria });
            } else {
                seen.add(key);
                dedupedMain.push(o);
            }
        }
        mainEntries = dedupedMain;

        const isReimprWeek = reimprEntries.length > 0;
        if (mainEntries.length > 0) {
            if (isReimprWeek) {
                reimprMarked++;
            }
            const base = mainEntries[0];
            // La cantidad pedida puede estar en la sección REIMPRESIONES (arriba) o en el catálogo (fondo).
            // Sumar ambas para no perder pedidos cargados en reimpresiones (ej. CHAINSAW MAN 08/10).
            // NOTA: solo afecta el campo cantidad, que usa Mayoristas; el catálogo ignora cantidad.
            const cantTotal = (base.cantidad || 0) + reimprEntries.reduce((s, r) => s + (r.cantidad || 0), 0);
            finalItems.push({
                ...base,
                cantidad: cantTotal || null,
                isReimprWeek,
                soloReimpr: false,
                agotado_distribuidor: isReimprWeek ? false : base.agotado_distribuidor
            });
        } else if (isReimprWeek) {
            reimprSoloError++;
            const base = reimprEntries[0];
            finalItems.push({ ...base, categoria: null, isReimprWeek: true, soloReimpr: true });
        }
    }

    const eanToTitles = {};
    for (const item of finalItems) {
        const eanStr = parseEAN(item.eanRaw);
        if (eanStr) {
            if (!eanToTitles[eanStr]) eanToTitles[eanStr] = [];
            eanToTitles[eanStr].push(item.tituloNorm);
        }
    }

    const eanCreatedReasons = {};
    let eanCreatedTotal = 0;
    const outputItems = [];

    for (const item of finalItems) {
        const productId = makeProductId('ivrea', item.titulo);
        const eanStr = parseEAN(item.eanRaw);
        let eanOficial = null;
        let eanInterno = null;
        let eanRazon = 'ok';

        if (!eanStr) eanRazon = 'en_blanco_o_por_confirmar';
        else if (!validateEAN13(eanStr)) eanRazon = 'ean_invalido';
        else if (eanToTitles[eanStr]?.length > 1) eanRazon = 'ean_repetido_en_varios_titulos';
        else eanOficial = eanStr;

        if (eanRazon !== 'ok') {
            eanInterno = makeInternalEAN(item.tituloNorm);
            eanCreatedReasons[eanRazon] = (eanCreatedReasons[eanRazon] || 0) + 1;
            eanCreatedTotal++;
        }

        const _changes = [];
        if (item.isReimprWeek) _changes.push({ type: 'reimpr', msg: 'Reimpresion semana' });
        if (eanRazon !== 'ok') _changes.push({ type: 'int', msg: eanRazon.replace(/_/g, ' ') });

        outputItems.push({
            product_id: productId,
            titulo: item.titulo,
            titulo_normalizado: item.tituloNorm,
            categoria_principal: item.categoria,
            subetiquetas: { reimpresionSemana: item.isReimprWeek },
            errores: { soloEnReimpresiones: item.soloReimpr },
            ean_oficial: eanOficial,
            ean_interno: eanInterno,
            ean_final: eanOficial || eanInterno,
            ean_razon: eanRazon,
            precio_tapa: item.precio,
            cantidad: item.cantidad,
            agotado_distribuidor: item.agotado_distribuidor || false,
            _raw_ean: item.eanRawStr,
            _raw_titulo: item.titulo,
            _changes,
        });
    }

    const report = {
        total_filas_crudas: rawItems.length,
        titulos_unicos: outputItems.length,
        duplicados_exactos_eliminados: exactDupesRemoved,
        reimpresion_titulos_marcados: reimprMarked,
        errores_reimpresion_sin_categoria: reimprSoloError,
        ean_creados_total: eanCreatedTotal,
        ean_creados_por_razon: eanCreatedReasons,
        filas_ignoradas_antes_novedades: skippedBefore,
        eliminados
    };

    return { items: outputItems, rawItems, report };
}

/**
 * OVNIPRESS PROCESSOR
 */
export function processOvnipress(rows) {
    const rawItems = [];
    let started = false;
    let currentSection = null;
    let skippedBefore = 0;
    const eliminados = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        if (!started) {
            if (row[0] && String(row[0]).trim().toUpperCase() === 'NOVEDADES') {
                started = true;
                currentSection = 'NOVEDADES';
            } else {
                skippedBefore++;
            }
            continue;
        }

        const nonNull = row.filter(v => v != null && String(v).trim() !== '');
        if (!nonNull.length) continue;

        const firstStr = nonNull.find(v => typeof v === 'string');
        if (firstStr) {
            const t = firstStr.trim().toUpperCase();
            if (t === 'TOTAL' || t === 'SUBTOTAL' || t === 'GRAN TOTAL') break;
        }

        if (!row[0] && row[2] && String(row[2]).trim().toUpperCase() === 'ISBN') {
            if (currentSection === 'NOVEDADES') currentSection = 'CATALOGO GENERAL';
            continue;
        }

        if (row[1] && String(row[1]).trim().toLowerCase() === 'titulo') continue;

        const titulo = row[1] ? String(row[1]).trim() : null;
        if (!titulo) continue;

        const isbnRaw = row[2] ?? null;
        let precio = null;
        if (row[3] != null) {
            const p = parseFloat(String(row[3]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[4] != null) {
            const c = parseInt(row[4]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: currentSection,
            agotado_distribuidor: row.__isRed === true
        });
    }

    return buildResult('ovni', rawItems, eliminados);
}

/**
 * PANINI PROCESSOR
 */
export function processPanini(rows) {
    const rawItems = [];
    let started = false;
    let currentSection = null;
    let skippedBefore = 0;
    const eliminados = [];
    const SECTION_RE = /^\*+\s*(.+?)\s*\*+\s*$/;
    const STOP_WORDS = ['TOTAL PANINI Y UTOPIA', 'TOTAL', 'SUBTOTAL', 'GRAN TOTAL'];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const nn = row.filter(v => v != null && String(v).trim() !== '');

        if (!started) {
            const uniqueNonNull = [...new Set(nn.map(v => String(v).trim().toUpperCase()))];
            if (uniqueNonNull.length === 1 && uniqueNonNull[0].includes('NOVEDADES')) {
                started = true;
                currentSection = uniqueNonNull[0];
            } else {
                skippedBefore++;
            }
            continue;
        }

        if (!nn.length) continue;

        const firstStr = nn.find(v => typeof v === 'string');
        if (firstStr) {
            const t = firstStr.trim().toUpperCase();
            if (STOP_WORDS.some(s => t === s)) break;
        }

        if (!row[0] && row[1]) {
            const b = String(row[1]).trim();
            const m = b.match(SECTION_RE);
            if (m) {
                currentSection = m[1].trim().toUpperCase();
                continue;
            }
            if (b.toUpperCase().startsWith('NOVEDADES')) {
                currentSection = b;
                continue;
            }

            if (!row[2] && !row[3]) {
                eliminados.push({ titulo: b, ean: '', motivo: 'SIN CODIGO NI ISBN', categoria: currentSection });
                continue;
            }
        }

        if (row[0] && String(row[0]).trim().toLowerCase() === 'codigo') continue;

        const titulo = row[1] ? String(row[1]).trim() : null;
        if (!titulo) continue;

        const codigo = row[0] ? String(row[0]).trim() : null;
        const isbnRaw = row[2] ?? null;
        let precio = null;
        if (row[3] != null) {
            const p = parseFloat(String(row[3]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[4] != null) {
            const c = parseInt(row[4]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            codigo,
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: currentSection,
            agotado_distribuidor: (currentSection === 'REIMPRESIONES') ? false : (row.__isRed === true)
        });
    }

    return buildResult('panini', rawItems, eliminados);
}

/**
 * PENGUIN PROCESSOR
 */
export function processPenguin(rows) {
    const rawItems = [];
    let started = false;
    let currentSection = null;
    let skippedBefore = 0;
    const eliminados = [];
    const STOP_WORDS = ['SUBTOTAL PENGUIN', 'SUBTOTAL', 'TOTAL', 'GRAN TOTAL'];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const nn = row.filter(v => v != null && String(v).trim() !== '');

        if (!started) {
            const uniqueNonNull = [...new Set(nn.map(v => String(v).trim().toUpperCase()))];
            if (uniqueNonNull.length === 1 && uniqueNonNull[0].includes('NOVEDADES')) {
                started = true;
                currentSection = uniqueNonNull[0];
            } else {
                skippedBefore++;
            }
            continue;
        }

        if (!nn.length) continue;

        const firstStr = nn.find(v => typeof v === 'string');
        if (firstStr) {
            const t = firstStr.trim().toUpperCase();
            if (STOP_WORDS.some(s => t === s)) break;
        }

        const uniqueNonNullCat = [...new Set(nn.map(v => String(v).trim().toUpperCase()))];
        if (uniqueNonNullCat.length === 1) {
            currentSection = uniqueNonNullCat[0];
            continue;
        }

        if (row[0] && String(row[0]).trim().toUpperCase() === 'AUTOR') continue;

        const titulo = row[1] ? String(row[1]).trim() : null;
        if (!titulo) continue;

        const autor = row[0] ? String(row[0]).trim() : null;
        const isbnRaw = row[2] ?? null;
        let precio = null;
        if (row[3] != null) {
            const p = parseFloat(String(row[3]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[4] != null) {
            const c = parseInt(row[4]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            autor,
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: currentSection,
            agotado_distribuidor: (currentSection === 'REIMPRESIONES') ? false : (row.__isRed === true)
        });
    }

    return buildResult('penguin', rawItems, eliminados);
}

/**
 * PLANETA PROCESSOR
 */
export function processPlaneta(rows) {
    const rawItems = [];
    let started = false;
    let currentSection = null;
    let skippedBefore = 0;
    const eliminados = [];
    const STOP_WORDS = ['TOTAL', 'SUBTOTAL'];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const nn = row.filter(v => v != null && String(v).trim() !== '');

        if (!started) {
            const uniqueNonNull = [...new Set(nn.map(v => String(v).trim().toUpperCase()))];
            if (uniqueNonNull.length === 1 && uniqueNonNull[0].includes('NOVEDADES')) {
                started = true;
                currentSection = uniqueNonNull[0];
            } else {
                skippedBefore++;
            }
            continue;
        }

        if (!nn.length) continue;

        const firstStr = nn.find(v => typeof v === 'string');
        if (firstStr) {
            const t = firstStr.trim().toUpperCase();
            if (STOP_WORDS.some(s => t === s)) break;
        }

        const uniqueNonNullCat = [...new Set(nn.map(v => String(v).trim().toUpperCase()))];
        if (uniqueNonNullCat.length === 1) {
            const val = uniqueNonNullCat[0];
            if (val !== '0') {
                currentSection = val;
            }
            continue;
        }

        if (row[0] && ['TITULO', 'TITLE'].includes(String(row[0]).trim().toUpperCase())) continue;

        const titulo = row[0] ? String(row[0]).trim() : null;
        if (!titulo) continue;

        const isbnRaw = row[1] ?? null;
        let precio = null;
        if (row[2] != null) {
            const p = parseFloat(String(row[2]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[3] != null) {
            const c = parseInt(row[3]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: currentSection,
            agotado_distribuidor: (currentSection === 'REIMPRESIONES') ? false : (row.__isRed === true)
        });
    }

    return buildResult('planeta', rawItems, eliminados);
}

/**
 * DEUX-POPFICTION PROCESSOR
 */
export function processDeux(rows) {
    const rawItems = [];
    let started = false;
    let skippedBefore = 0;
    const eliminados = [];
    const STOP_WORDS = ['TOTAL', 'SUBTOTAL', 'SUBTOTAL POP FICTION', 'SUBTOTAL DEUX', 'GRAN TOTAL'];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const colA = row[0] != null ? String(row[0]).trim() : null;
        const colB = row[1] != null ? String(row[1]).trim() : null;
        const colC = row[2] != null ? String(row[2]).trim() : null;
        const colD = row[3] != null ? row[3] : null;

        if (!started) {
            if (colA && colA.toUpperCase().includes('LANZAMIENTO')) {
                started = true;
            } else {
                skippedBefore++;
            }
            continue;
        }

        if (colA && STOP_WORDS.includes(colA.toUpperCase())) break;
        if (colB && STOP_WORDS.includes(colB.toUpperCase())) break;
        if (colC && STOP_WORDS.includes(colC.toUpperCase())) break;

        if (colA && colA.toUpperCase() === 'PRODUCTO' && colB && colB.toUpperCase() === 'SELLO') continue;

        let titulo = colC || null;
        if (titulo) {
            titulo = titulo.split(String.fromCharCode(10)).join(' ')
                .split(String.fromCharCode(13)).join(' ')
                .trim();
        }

        if (!titulo) continue;

        const isbnRaw = colD != null ? colD : null;
        let precio = null;
        if (row[4] != null) {
            const p = parseFloat(String(row[4]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[5] != null) {
            const c = parseInt(row[5]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }
        const sello = colB || 'SIN SELLO';

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: sello.toUpperCase(),
            sello,
            agotado_distribuidor: (sello.toUpperCase() === 'REIMPRESIONES') ? false : (row.__isRed === true)
        });
    }

    return buildResult('deux', rawItems, eliminados);
}

/**
 * HOTEL DE LAS IDEAS PROCESSOR
 */
export function processHotel(rows) {
    const rawItems = [];
    let started = true; 
    let currentSection = 'CATALOGO';
    const eliminados = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const nn = row.filter(v => v != null && String(v).trim() !== '');
        if (!nn.length) continue;

        const firstStr = nn.find(v => typeof v === 'string');
        if (firstStr && firstStr.trim().toUpperCase().includes('TOTAL')) break;

        if (row[1] && ['TITULO', 'TITLE'].includes(String(row[1]).trim().toUpperCase())) continue;

        const titulo = row[1] ? String(row[1]).trim() : null;
        if (!titulo) continue;

        const autor = row[0] ? String(row[0]).trim() : null;
        const isbnRaw = row[2] ?? null;
        let precio = null;
        if (row[3] != null) {
            const p = parseFloat(String(row[3]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[4] != null) {
            const c = parseInt(row[4]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        let itemCat = currentSection;
        if (row[6] && String(row[6]).trim().toUpperCase().includes('NOVEDAD')) {
            itemCat = 'NOVEDADES';
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            autor,
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: itemCat,
            agotado_distribuidor: (itemCat === 'REIMPRESIONES') ? false : (row.__isRed === true)
        });
    }

    return buildResult('hotel', rawItems, eliminados);
}

/**
 * V&R PROCESSOR
 */
export function processVR(rows) {
    const rawItems = [];
    let started = true;
    const eliminados = [];
    const STOP_WORDS = ['SUBTOTAL V&R', 'SUBTOTAL', 'TOTAL'];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const nn = row.filter(v => v != null && String(v).trim() !== '');
        if (!nn.length) continue;

        const firstStr = nn.find(v => typeof v === 'string');
        if (firstStr) {
            const t = firstStr.trim().toUpperCase();
            if (STOP_WORDS.some(s => t === s)) break;
        }

        if (row[0] && String(row[0]).trim().toUpperCase() === 'AUTOR') continue;

        const titulo = row[1] ? String(row[1]).trim() : null;
        if (!titulo || titulo.toUpperCase() === 'NOVEDADES') continue;

        const autor = row[0] ? String(row[0]).trim() : null;
        const isbnRaw = row[2] ?? null;
        let precio = null;
        if (row[3] != null) {
            const p = parseFloat(String(row[3]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[4] != null) {
            const c = parseInt(row[4]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            autor,
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: 'V&R',
            agotado_distribuidor: row.__isRed === true
        });
    }

    return buildResult('vr', rawItems, eliminados);
}

/**
 * OTRAS PROCESSOR
 */
export function processOtras(rows) {
    const rawItems = [];
    let started = true;
    let currentSection = 'GENERAL';
    const eliminados = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const nn = row.filter(v => v != null && String(v).trim() !== '');
        if (!nn.length) continue;

        if (nn.length === 1 && typeof nn[0] === 'string') {
            const val = nn[0].trim().toUpperCase();
            if (val !== 'SUBTOTAL' && val !== 'TOTAL' && val !== 'AUTOR' && val !== 'NOMBRE' && val !== 'PRODUCTO') {
                currentSection = val;
                continue;
            }
        }

        const firstStr = nn.find(v => typeof v === 'string');
        if (firstStr) {
            const t = firstStr.trim().toUpperCase();
            if (t === 'SUBTOTAL' || t === 'TOTAL') break;
        }

        if (row[0] && ['AUTOR', 'NOMBRE'].includes(String(row[0]).trim().toUpperCase())) continue;

        const titulo = row[1] ? String(row[1]).trim() : null;
        if (!titulo) continue;

        const autor = row[0] ? String(row[0]).trim() : null;
        const isbnRaw = row[2] ?? null;
        let precio = null;
        if (row[3] != null) {
            const p = parseFloat(String(row[3]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[4] != null) {
            const c = parseInt(row[4]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            autor,
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            categoria: currentSection,
            agotado_distribuidor: (currentSection === 'REIMPRESIONES') ? false : (row.__isRed === true)
        });
    }

    return buildResult('otras', rawItems, eliminados);
}

/**
 * MERCHANDISING PROCESSOR
 */
export function processMerchandising(rows) {
    const rawItems = [];
    let started = true;
    const eliminados = [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const nn = row.filter(v => v != null && String(v).trim() !== '');
        if (!nn.length) continue;

        const firstStr = nn.find(v => typeof v === 'string');
        if (firstStr) {
            const t = firstStr.trim().toUpperCase();
            if (t.startsWith('SUBTOTAL') || t.startsWith('TOTAL')) break;
        }

        if (row[0] && String(row[0]).trim().toUpperCase() === 'PRODUCTO') continue;

        const titulo = row[0] ? String(row[0]).trim() : null;
        if (!titulo) continue;

        const isbnRaw = row[1] ?? null;
        let precio = null;
        if (row[2] != null) {
            const p = parseFloat(String(row[2]).replace(',', '.'));
            if (!isNaN(p)) precio = Math.round(p);
        }
        let cantidad = null;
        if (row[3] != null) {
            const c = parseInt(row[3]);
            if (!isNaN(c) && c > 0) cantidad = c;
        }
        const descuento = row[5] ?? null;

        rawItems.push({
            titulo,
            tituloNorm: normalizeTitle(titulo),
            isbnRaw,
            isbnRawStr: String(isbnRaw ?? ''),
            precio,
            cantidad,
            descuento,
            categoria: 'MERCHANDISING',
            agotado_distribuidor: row.__isRed === true
        });
    }

    return buildResult('merch', rawItems, eliminados);
}

/**
 * SHARED BUILD RESULT
 */
export function buildResult(prefix, rawItems, eliminados) {
    const byTitle = {};
    for (const item of rawItems) {
        if (!byTitle[item.tituloNorm]) byTitle[item.tituloNorm] = [];
        byTitle[item.tituloNorm].push(item);
    }

    let exactDupesRemoved = 0;
    const finalItems = [];

    for (const occurrences of Object.values(byTitle)) {
        const seen = new Set();
        const deduped = [];
        for (const o of occurrences) {
            const key = o.tituloNorm + '|' + o.isbnRawStr;
            if (seen.has(key)) {
                exactDupesRemoved++;
                eliminados.push({ titulo: o.titulo, ean: o.isbnRawStr, motivo: 'DUPLICADO EXACTO', categoria: o.categoria });
            } else {
                seen.add(key);
                deduped.push(o);
            }
        }
        finalItems.push(...deduped);
    }

    const eanToTitles = {};
    for (const item of finalItems) {
        const e = cleanISBN(item.isbnRaw);
        if (e) {
            if (!eanToTitles[e]) eanToTitles[e] = [];
            eanToTitles[e].push(item.tituloNorm);
        }
    }

    const eanCreatedReasons = {};
    let eanCreatedTotal = 0;
    const outputItems = finalItems.map(item => {
        const isbnClean = cleanISBN(item.isbnRaw);
        let eanOficial = null;
        let eanInterno = null;
        let eanRazon = 'ok';

        if (!isbnClean) eanRazon = 'en_blanco_o_por_confirmar';
        else if (!validateEAN13(isbnClean)) eanRazon = 'ean_invalido';
        else if (eanToTitles[isbnClean]?.length > 1) eanRazon = 'ean_repetido_en_varios_titulos';
        else eanOficial = isbnClean;

        if (eanRazon !== 'ok') {
            eanInterno = makeInternalEAN(item.tituloNorm);
            eanCreatedReasons[eanRazon] = (eanCreatedReasons[eanRazon] || 0) + 1;
            eanCreatedTotal++;
        }

        const _changes = [];
        if (item.isbnRawStr && isbnClean && item.isbnRawStr !== isbnClean)
            _changes.push({ type: 'isbn', msg: 'ISBN normalizado' });
        if (eanRazon !== 'ok') _changes.push({ type: 'int', msg: eanRazon.replace(/_/g, ' ') });

        return {
            product_id: prefix + ':' + hashStr(item.tituloNorm),
            titulo: item.titulo,
            titulo_normalizado: item.tituloNorm,
            categoria_principal: item.categoria,
            autor: item.autor || null,
            tipo: item.tipo || null,
            sello: item.sello || null,
            codigo: item.codigo || null,
            descuento: item.descuento || null,
            paginas: item.paginas || null,
            subetiquetas: { reimpresionSemana: false },
            errores: { soloEnReimpresiones: false },
            ean_oficial: eanOficial,
            ean_interno: eanInterno,
            ean_final: eanOficial || eanInterno,
            ean_razon: eanRazon,
            precio_tapa: item.precio,
            cantidad: item.cantidad,
            agotado_distribuidor: item.agotado_distribuidor || false,
            _raw_ean: item.isbnRawStr,
            _raw_titulo: item.titulo,
            _changes,
        };
    });

    const itemsPorCategoria = {};
    const rawPorCategoria = {};
    for (const item of outputItems) {
        const c = item.categoria_principal || 'Sin categoria';
        itemsPorCategoria[c] = (itemsPorCategoria[c] || 0) + 1;
    }
    for (const item of rawItems) {
        const c = item.categoria || 'Sin categoria';
        rawPorCategoria[c] = (rawPorCategoria[c] || 0) + 1;
    }

    return {
        items: outputItems,
        rawItems,
        report: {
            total_filas_crudas: rawItems.length,
            titulos_unicos: finalItems.length,
            duplicados_exactos_eliminados: exactDupesRemoved,
            reimpresion_titulos_marcados: 0,
            errores_reimpresion_sin_categoria: 0,
            ean_creados_total: eanCreatedTotal,
            ean_creados_por_razon: eanCreatedReasons,
            items_por_categoria: itemsPorCategoria,
            raw_por_categoria: rawPorCategoria,
            eliminados,
        }
    };
}

function isSectionMarker(row) {
    const nonNull = row.filter(v => v != null && String(v).trim() !== '');
    const uniqueNonNull = [...new Set(nonNull.map(v => String(v).trim().toUpperCase()))];
    if (uniqueNonNull.length === 1) {
        const t = uniqueNonNull[0];
        if (SECTION_MARKERS.has(t)) return t;
    }
    return null;
}

function isSkipRow(row) {
    const nonNull = row.filter(v => v != null && String(v).trim() !== '');
    if (!nonNull.length) return true;
    const firstStr = nonNull.find(v => typeof v === 'string');
    if (firstStr) {
        const t = firstStr.trim();
        if (SKIP_MARKERS.has(t)) return true;
        if (t.toLowerCase() === 'codigo') return true;
    }
    return false;
}

function isHeaderRow(row) {
    const first = row[0] ? String(row[0]).trim().toUpperCase() : '';
    if (first === 'TITULO' || first === 'TITLE' || first === 'NOMBRE' || first === 'PRODUCTO' || first === 'AUTOR') {
        return true;
    }
    return false;
}

export const SHEET_PROCESSORS = {
    'Ivrea': processIvrea,
    'Ovnipress': processOvnipress,
    'Panini-Utopia': processPanini,
    'Penguin': processPenguin,
    'Planeta': processPlaneta,
    'Deux-PopFiction': processDeux,
    'Hotel de las Ideas': processHotel,
    'V&R': processVR,
    'Otras': processOtras,
    'Merchandising': processMerchandising,
};
