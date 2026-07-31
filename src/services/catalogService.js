import { supabase } from './supabase';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { SHEET_PROCESSORS } from '../utils/excelProcessors';

const CACHE_KEY = 'mcb_catalog_full_cache';
const CACHE_TIME_KEY = 'mcb_catalog_cache_time';
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutos de caché local

export const catalogService = {
    /**
     * Obtiene el catálogo completo con estrategia de caché y compresión
     * @param {boolean} forceRefresh - Si es true, ignora la caché
     */
    async fetchFullCatalog(forceRefresh = false) {
        // Mapeo de llaves para compresión (ahorra ~50% de espacio en localStorage)
        const KEY_MAP = {
            id: 'i',
            product_id: 'pid',
            titulo: 't',
            ean_oficial: 'eo',
            ean_interno: 'ei',
            precio_tapa: 'pt',
            editorial: 'ed',
            categoria: 'c',
            precio_venta_bs: 'pvb',
            precio_venta_bs_prox: 'pvbx',
            precio_n2_bs: 'pn2',
            precio_n3_bs: 'pn3',
            precio_mayoreo_bs: 'pmb',
            es_reimpresion: 'er',
            updated_at: 'u',
            created_at: 'ca',
            imagen_url: 'img',
            stock_fisico: 'sf',
            stock_minimo: 'sm',
            visible_web: 'vw',
            para_preventa: 'pp',
            es_novedad_semana: 'ens',
            es_novedad: 'en',
            agotado_distribuidor: 'ad'
        };
        const REVERSE_MAP = Object.fromEntries(Object.entries(KEY_MAP).map(([k, v]) => [v, k]));

        // 1. Intentar cargar desde caché
        if (!forceRefresh) {
            try {
                const cachedData = localStorage.getItem(CACHE_KEY);
                const cacheTime = localStorage.getItem(CACHE_TIME_KEY);
                
                if (cachedData && cacheTime) {
                    const now = Date.now();
                    const age = now - parseInt(cacheTime);
                    
                    if (age < CACHE_DURATION) {
                        console.log('📦 Cargando catálogo desde caché local (Comprimido)...');
                        const compressed = JSON.parse(cachedData);
                        // Descomprimir
                        return compressed.map(item => {
                            const decompressed = {};
                            for (const [short, long] of Object.entries(REVERSE_MAP)) {
                                if (item[short] !== undefined) decompressed[long] = item[short];
                            }
                            return decompressed;
                        });
                    }
                }
            } catch (e) {
                console.warn('Error al leer caché o descompresión:', e);
            }
        }

        // 2. Si no hay caché o expiró, descargar de Supabase (SOLO COLUMNAS NECESARIAS)
        console.log('🚀 Descargando catálogo optimizado desde Supabase...');
        const columns = 'id,product_id,titulo,ean_oficial,ean_interno,precio_tapa,editorial,categoria,precio_venta_bs,precio_venta_bs_prox,precio_n2_bs,precio_n3_bs,precio_mayoreo_bs,es_reimpresion,updated_at,created_at,imagen_url,stock_fisico,stock_minimo,visible_web,para_preventa,es_novedad_semana,es_novedad,agotado_distribuidor';

        let allItems = [];
        let from = 0;
        let to = 999;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('catalogo_productos')
                .select(columns)
                .range(from, to)
                .order('titulo', { ascending: true });

            if (error) throw error;

            if (data && data.length > 0) {
                allItems = [...allItems, ...data];
                hasMore = data.length === 1000;
                if (hasMore) {
                    from += 1000;
                    to += 1000;
                }
            } else {
                hasMore = false;
            }
        }

        // 3. Comprimir y guardar en caché
        try {
            const compressed = allItems.map(item => {
                const norm = {};
                for (const [long, short] of Object.entries(KEY_MAP)) {
                    if (item[long] !== undefined) norm[short] = item[long];
                }
                return norm;
            });
            
            localStorage.setItem(CACHE_KEY, JSON.stringify(compressed));
            localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
            console.log(`✅ Caché actualizada y comprimida. Items: ${allItems.length}`);
        } catch (e) {
            console.warn('⚠️ Límite de localStorage al comprimir:', e);
            this.ensureStorageSpace(); // Limpiar si es necesario
        }

        return allItems;
    },

    /**
     * Obtiene solo los items marcados como novedad o para preventa (muy rápido)
     */
    async fetchFeaturedOnly() {
        console.log('⚡ Cargando destacados prioritarios...');
        const columns = 'id,product_id,titulo,ean_oficial,ean_interno,precio_tapa,editorial,categoria,precio_venta_bs,precio_n2_bs,precio_n3_bs,precio_mayoreo_bs,es_reimpresion,updated_at,created_at,imagen_url,stock_fisico,stock_minimo,visible_web,para_preventa,es_novedad_semana,es_novedad';
        
        const { data, error } = await supabase
            .from('catalogo_productos')
            .select(columns)
            .or('es_novedad_semana.eq.true,para_preventa.eq.true')
            .order('titulo', { ascending: true });

        if (error) throw error;
        return data || [];
    },

    /**
     * Limpia la caché local para forzar una descarga fresca en la próxima carga
     */
    clearCache() {
        console.log('🧹 Limpiando caché local del catálogo...');
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIME_KEY);
    },

    /*
     * [x] **Fase 2: Procesamiento Automático al subir el archivo**
     *   - [x] Crear `catalogService.js` para manejo de datos y caché.
     *   - [x] Disparar limpieza automática en `AdminWeeklyView`.
     *   - [x] Carga automática de reportes en `ComicAnalysisTool`.
     *   - [x] Simplificación de UI (Eliminar Dropzone redundante).
     */
    /**
     * Procesa un archivo Excel y lo compara con el catálogo actual
     * @param {File|Blob} file 
     */
    async processAndAnalyze(file) {
        try {
            console.log('--- DEPURACIÓN EXCEL (EXCELJS) ---');
            const arrayBuffer = await file.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);
            
            // 1. Cargar catálogo actual (usando caché si existe)
            const catalog = await this.fetchFullCatalog();
            console.log('📚 Catálogo cargado:', catalog.length, 'ítems');
            
            const indexedCatalog = {};
            const eanIndex = {};
            
            catalog.forEach(item => {
                const pid = item.product_id;
                if (pid) indexedCatalog[pid] = item;
                if (item.ean_oficial) eanIndex[item.ean_oficial] = item;
                if (item.ean_interno) eanIndex[item.ean_interno] = item;
            });

            // Función para detectar rojos
            const isRed = (cell, isDebug = false) => {
                if (!cell) return false;
                const checkColor = (c) => {
                    if (!c || typeof c !== 'string') return false;
                    const val = c.toUpperCase();
                    if (isDebug) console.log('   🎨 Color check:', val);
                    return val.includes('FF0000') || val.includes('C00000') || val.endsWith('FF0000');
                };
                
                let foundRed = false;
                if (cell.font?.color?.argb && checkColor(cell.font.color.argb)) foundRed = true;
                if (!foundRed && cell.fill?.fgColor?.argb && checkColor(cell.fill.fgColor.argb)) foundRed = true;
                if (!foundRed && cell.fill?.bgColor?.argb && checkColor(cell.fill.bgColor.argb)) foundRed = true;

                return foundRed;
            };

            // 2. Procesar pestañas disponibles (Insensible a mayúsculas/minúsculas)
            const wbSheetNames = workbook.worksheets.map(ws => ws.name);
            console.log('📄 Pestañas encontradas en Excel:', wbSheetNames);
            const processorKeys = Object.keys(SHEET_PROCESSORS);
            
            const analysisResult = {};

            for (const processorKey of processorKeys) {
                const normKey = processorKey.trim().toUpperCase();
                const ws = workbook.worksheets.find(n => n.name.trim().toUpperCase() === normKey);
                
                if (ws) {
                    console.log(`✅ [MATCH] Pestaña "${ws.name}" coincide con procesador "${processorKey}"`);
                    console.log(`🔄 Procesando pestaña: "${ws.name}" como "${processorKey}"...`);
                    
                    // Convertir a formato rows (array de arrays) para SHEET_PROCESSORS
                    const rows = [];
                    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
                        const rowValues = [];
                        let rowIsRed = false;
                        
                        // Recorremos hasta 20 columnas para asegurar que no falten datos 
                        // en filas con celdas vacías intercaladas.
                        for (let c = 1; c <= 20; c++) {
                            const cell = row.getCell(c);
                            const val = cell.value;
                            
                            let finalVal = val;
                            if (val && typeof val === 'object') {
                                if (val.richText) finalVal = val.richText.map(t => t.text).join('');
                                else if (val.text) finalVal = val.text;
                                else if (val.result !== undefined) finalVal = val.result;
                                else if (val.hyperlink) finalVal = val.text || val.hyperlink;
                            }
                            
                            rowValues[c-1] = finalVal;
                            
                            // Verificamos rojos en las primeras 5 columnas (A-E)
                            const isDebug = processorKey === 'IVREA' && rowValues[0];
                            if (c <= 5 && isRed(cell, isDebug)) {
                                rowIsRed = true;
                                if (processorKey === 'IVREA') {
                                    console.log('🔴 ROJO DETECTADO:', 
                                        rowValues[0] || 'S/T', 
                                        'col:', c,
                                        'font:', cell.font?.color?.argb,
                                        'fill:', cell.fill?.fgColor?.argb
                                    );
                                }
                            }
                        }
                        
                        rowValues.__isRed = rowIsRed;
                        rows.push(rowValues);
                    });

                    const processed = SHEET_PROCESSORS[processorKey](rows);

                    if (processed.items) {
                        console.log(`📊 Items procesados en "${processorKey}": ${processed.items.length}`);
                        processed.items = processed.items.map(item => {
                            const dbMatch = indexedCatalog[item.product_id] || (item.ean_final ? eanIndex[item.ean_final] : null);
                            let comparison = 'sin_cambios';
                            
                            if (!dbMatch) {
                                comparison = 'nuevo';
                            } else {
                                const priceChanged = item.precio_tapa != null && dbMatch.precio_tapa != null && Number(item.precio_tapa) !== Number(dbMatch.precio_tapa);
                                const currentDbEan = dbMatch.ean_oficial || dbMatch.ean_interno;
                                const eanChanged = item.ean_final && item.ean_final !== currentDbEan;
                                const catChanged = item.categoria_principal && dbMatch.categoria && item.categoria_principal !== dbMatch.categoria;

                                if (priceChanged) comparison = 'cambio_precio';
                                else if (eanChanged) comparison = 'cambio_ean';
                                else if (catChanged) comparison = 'cambio_categoria';
                            }

                            return {
                                ...item,
                                editorial: processorKey,
                                comparison,
                                db_price: dbMatch?.precio_tapa,
                                db_ean: dbMatch?.ean_oficial || dbMatch?.ean_interno,
                                db_category: dbMatch?.categoria
                            };
                        });

                        if (!processed.report) processed.report = {};
                        processed.report.cambios = {
                            nuevos: processed.items.filter(i => i.comparison === 'nuevo').length,
                            precios: processed.items.filter(i => i.comparison === 'cambio_precio').length,
                            eans: processed.items.filter(i => i.comparison === 'cambio_ean').length,
                            categorias: processed.items.filter(i => i.comparison === 'cambio_categoria').length
                        };
                    }
                    analysisResult[processorKey] = processed;
                }
            }

            console.log('🏁 Resultado final del análisis:', Object.keys(analysisResult));
            analysisResult._filename = file.name;
            return analysisResult;
        } catch (err) {
            console.error('❌ ERROR CRÍTICO EN PROCESAMIENTO:', err);
            throw err;
        }
    },

    /**
     * Limpia la caché local del catálogo
     */
    clearCache() {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_TIME_KEY);
    },

    /**
     * Actualiza el stock de productos específicos en la caché local SIN recargar todo.
     * Mucho más eficiente que clearCache() para operaciones de venta/devolución.
     * @param {Array} items - Array de { id, delta } donde delta es el cambio (+/-) de stock
     */
    patchStockInCache(items) {
        try {
            const cachedData = localStorage.getItem(CACHE_KEY);
            if (!cachedData) return; // Si no hay caché, no hay nada que parchear

            const compressed = JSON.parse(cachedData);
            let changed = false;

            // Construir mapa id -> índice para búsqueda O(1)
            const idIndex = {};
            compressed.forEach((item, idx) => {
                if (item.i) idIndex[item.i] = idx;
            });

            // Aplicar el delta de stock a cada item
            for (const { id, delta } of items) {
                const idx = idIndex[id];
                if (idx !== undefined) {
                    const currentStock = compressed[idx].sf ?? 0;
                    compressed[idx].sf = Math.max(0, currentStock + delta);
                    changed = true;
                    console.log(`📦 Cache parcheada: id=${id} stock ${currentStock} → ${compressed[idx].sf}`);
                }
            }

            if (changed) {
                localStorage.setItem(CACHE_KEY, JSON.stringify(compressed));
                // Mantener el tiempo de caché original (no reiniciar el TTL)
            }
        } catch (e) {
            console.warn('⚠️ No se pudo parchear la caché, limpiando completamente:', e);
            this.clearCache(); // Fallback: limpiar todo si algo falla
        }
    },

    /**
     * Sincroniza una lista de items con el catálogo maestro (Upsert)
     */
    async upsertMaster(items) {
        if (!items || items.length === 0) return;

        const chunkSize = 500;
        for (let i = 0; i < items.length; i += chunkSize) {
            const chunk = items.slice(i, i + chunkSize);
            const { error } = await supabase
                .from('catalogo_productos')
                .upsert(chunk, { onConflict: 'product_id' });

            if (error) throw error;
        }
        
        // Al sincronizar nuevos datos, invalidamos la caché
        this.clearCache();
    },

    /**
     * Registra un movimiento de stock en la tabla stock_movimientos
     */
    async logStockMovement({ productoId, titulo, delta, stockDespues, motivo, detalle = '' }) {
        try {
            await supabase.from('stock_movimientos').insert({
                producto_id: productoId || null,
                titulo: titulo || '',
                delta,
                stock_despues: stockDespues ?? null,
                motivo,
                detalle,
            });
        } catch (e) {
            console.warn('stock_movimientos insert error:', e);
        }
    },

    /**
     * Actualiza el stock físico de un producto
     */
    async updateProductStock(id, stock, { motivo = 'EDICIÓN MANUAL', detalle = '', titulo = '' } = {}) {
        // Leer stock anterior para calcular delta
        const { data: prev } = await supabase
            .from('catalogo_productos')
            .select('stock_fisico, titulo')
            .eq('id', id)
            .maybeSingle();

        const { error } = await supabase
            .from('catalogo_productos')
            .update({ stock_fisico: stock, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;

        const delta = stock - (prev?.stock_fisico ?? 0);
        await this.logStockMovement({
            productoId: id,
            titulo: titulo || prev?.titulo || '',
            delta,
            stockDespues: stock,
            motivo,
            detalle,
        });

        this.clearCache();
        return true;
    },

    /**
     * Sube un reporte de análisis a Supabase Storage con timestamp interno
     */
    async uploadAnalysisReport(semanaId, analysis) {
        const fileName = `analysis_${semanaId}.json`;
        const filePath = `reports/${fileName}`;
        
        // Añadimos metadata al reporte para asegurar que sabemos cuándo se generó
        const reportWithMeta = {
            ...analysis,
            _mcb_generated_at: Date.now(),
            _filename: analysis._filename // Persistir nombre original
        };

        const blob = new Blob([JSON.stringify(reportWithMeta)], { type: 'application/json' });
        
        console.log(`☁️ Subiendo reporte a Storage: ${filePath}`);
        const { error } = await supabase.storage
            .from('docs')
            .upload(filePath, blob, { upsert: true });

        if (error) throw error;
        return filePath;
    },

    /**
     * Descarga un reporte de análisis desde Supabase Storage
     */
    async downloadAnalysisReport(semanaId) {
        const fileName = `analysis_${semanaId}.json`;
        const filePath = `reports/${fileName}`;
        
        console.log(`☁️ Descargando reporte desde Storage: ${filePath}`);
        // Supabase download a veces usa caché, forzamos descarga fresca
        const { data, error } = await supabase.storage
            .from('docs')
            .download(filePath);

        if (error) {
            if (error.status === 404) return null;
            throw error;
        }

        const text = await data.text();
        const parsed = JSON.parse(text);
        console.log(`✅ Reporte descargado. Generado el: ${new Date(parsed._mcb_generated_at).toLocaleString()}`);
        return parsed;
    },

    /**
     * Limpia el localStorage de forma segura si la cuota se excede
     */
    ensureStorageSpace() {
        try {
            // Intentamos guardar un pequeño test
            localStorage.setItem('_mcb_test', '1');
            localStorage.removeItem('_mcb_test');
            return true;
        } catch (e) {
            console.warn('⚠️ localStorage lleno, limpiando catálogo antiguo para hacer espacio...');
            // Borramos el catálogo caché que es lo más pesado
            localStorage.removeItem(CACHE_KEY);
            localStorage.removeItem(CACHE_TIME_KEY);
            return false;
        }
    },

    /**
     * Obtiene la configuración de precios y ajustes manuales de la DB
     */
    async fetchPricingSettings() {
        try {
            // 1. Cargar Configuraciones Globales y por Editorial
            const { data: settings, error: setErr } = await supabase
                .from('price_analysis_settings')
                .select('*');
            
            if (setErr) throw setErr;

            const pricing = {
                editoriales: {},
                global: {
                    flete: 6,
                    tcf: 0.014,
                    tca: 0.0068,
                    dtoNiveles: [5, 10, 15]
                }
            };

            if (settings) {
                settings.forEach(s => {
                    if (s.editorial && s.editorial !== 'GLOBAL_SETTINGS') {
                        pricing.editoriales[s.editorial] = {
                            margen_venta: parseFloat(s.margen_venta) || 0.40,
                            margen_mayoreo: parseFloat(s.margen_mayoreo) || 0.30,
                            descuento_proveedor: s.descuento_proveedor != null ? parseFloat(s.descuento_proveedor) : 35
                        };
                    } else if (s.editorial === 'GLOBAL_SETTINGS') {
                        pricing.global = {
                            flete: parseFloat(s.flete) || 6,
                            tcf: parseFloat(s.tcf) || 0.014,
                            tca: parseFloat(s.tca) || 0.0068,
                            dtoNiveles: s.dto_niveles || [5, 10, 15]
                        };
                    }
                });
            }

            // 2. Cargar Ajustes Manuales
            const { data: adjustments, error: adjErr } = await supabase
                .from('price_analysis_adjustments')
                .select('*');
            
            if (adjErr) throw adjErr;

            const manualAdjustments = {};
            if (adjustments) {
                adjustments.forEach(a => {
                    if (!manualAdjustments[a.editorial]) manualAdjustments[a.editorial] = {};
                    manualAdjustments[a.editorial][Math.round(a.precio_ars)] = parseFloat(a.pv_ajuste);
                });
            }

            return { pricing, manualAdjustments };
        } catch (err) {
            console.error('❌ Error al obtener configuración de precios:', err);
            return null;
        }
    },

    /**
     * Genera el Excel de catálogo mayorista (Bs) a partir del Excel semanal original.
     * No lee ni escribe nada en la base de datos: pricingConfig y manualAdjustments
     * llegan ya resueltos (reales o simulados) desde quien la llama, así el mismo
     * motor de cálculo sirve tanto para el export real (Consolidado) como para
     * una simulación (Análisis de Precios) sin persistir nada.
     */
    async generateWholesaleWorkbook(semana, pricingConfig, manualAdjustments = {}, options = {}) {
        const DEFAULTS = { flete: 6, tcf: 0.014, tca: 0.0068, margen_venta: 0.40, margen_mayoreo: 0.30 };
        const EDITORIAL_DTOS_DEFAULT = {
            'Ivrea': 35, 'Ovnipress': 30, 'Panini-Utopia': 20,
            'Penguin': 35, 'Planeta': 35, 'Deux-PopFiction': 40,
            'Hotel de las Ideas': 40, 'V&R': 35, 'Otras': 35, 'Merchandising': 0
        };

        const global = pricingConfig?.global || DEFAULTS;
        const editorialesConf = pricingConfig?.editoriales || {};

        const response = await fetch(semana.archivo_url);
        const arrayBuffer = await response.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(arrayBuffer);

        workbook.eachSheet((ws) => {
            // --- DESVINCULAR FÓRMULAS COMPARTIDAS (ANTI-CRASH) ---
            ws.eachRow(row => {
                row.eachCell(cell => {
                    if (cell.type === ExcelJS.ValueType.Formula) {
                        const f = cell.formula;
                        const r = cell.result;
                        if (f) {
                            cell.value = { formula: f, result: r };
                        }
                    }
                });
            });

            // 1. Eliminar Merchandising si existe la pestaña
            if (ws.name.toLowerCase().includes('merchandising')) {
                workbook.removeWorksheet(ws.id);
                return;
            }

            // 2. Manejo de la pestaña Totales / Subtotales
            if (['Totales', 'TOTALES', 'totales', 'subtotales', 'Resumen'].includes(ws.name)) {
                try {
                    const images = ws.getImages();
                    if (images && images.length > 0) {
                        images.forEach(img => {
                            if (img.range) {
                                img.range.tl = { col: 50, row: 1000 };
                                img.range.br = { col: 51, row: 1001 };
                            }
                        });
                    }
                    ws._media = [];
                    ws._figures = [];
                } catch (e) {}

                ws.spliceRows(22, 1);
                ws.spliceRows(11, 1);
                ws.spliceRows(1, 7);

                for (let i = ws.rowCount; i >= 1; i--) {
                    const val = String(ws.getRow(i).getCell(1).value || '').toLowerCase();
                    if (val.includes('merchandising')) {
                        ws.spliceRows(i, 1);
                    }
                }

                ws.spliceColumns(6, 1);
                ws.spliceColumns(5, 1);
                ws.spliceColumns(3, 1);

                const cellF11 = ws.getCell('F11');
                if (cellF11.value) cellF11.value = "TOTAL PEDIDO (Bs)";

                for (let r = 5; r <= 14; r++) {
                    const cellC = ws.getCell(`C${r}`);
                    cellC.numFmt = '#,##0.00';
                }
                ws.getCell('C14').value = { formula: 'SUM(C5:C13)' };

                return;
            }

            // --- PROCESAMIENTO DE HOJAS DE EDITORIALES ---
            const edName = ws.name.trim();
            const isVR = edName.toUpperCase().includes('V&R') || edName.toUpperCase().includes('V Y R');
            const isIvrea = edName.toLowerCase().includes('ivrea');
            const edConf = editorialesConf[edName] || {};

            const dto = (edConf.descuento_proveedor != null ? edConf.descuento_proveedor : (EDITORIAL_DTOS_DEFAULT[edName] ?? 35)) / 100;
            const margenVenta = edConf.margen_venta ?? DEFAULTS.margen_venta;
            const mmayo = edConf.margen_mayoreo ?? DEFAULTS.margen_mayoreo;
            const tca = global.tca ?? DEFAULTS.tca;
            const tcf = global.tcf ?? DEFAULTS.tcf;
            const flete = global.flete ?? DEFAULTS.flete;
            const edAdjustments = manualAdjustments[edName] || {};

            let colTitle = -1;
            let colIsbn = -1;
            let colPrice = -1;
            let colSubtotal = -1;

            const titleKeywords = ['título', 'titulo', 'item', 'ejemplar', 'nombre', 'descripción', 'descripcion', 'producto', 'coleccion'];
            const isbnKeywords = ['isbn', 'ean', 'código', 'codigo', 'code', 'barras'];
            const priceKeywords = ['precio', 'ars', 'p.p.p', 'tapa', 'pvp', 'p.v.p', 'lista', 'público', 'publico', 'actual'];
            const subtotalKeywords = ['subtotal', 'total $', 'importe', 'monto'];

            for (let i = 1; i <= Math.min(50, ws.rowCount); i++) {
                const row = ws.getRow(i);
                row.eachCell((cell, colNumber) => {
                    const val = String(cell.value || '').toLowerCase().trim();
                    if (val === 'novedades' || val === 'reimpresiones') return;

                    if (colTitle === -1 && titleKeywords.some(k => val.includes(k))) colTitle = colNumber;
                    if (colIsbn === -1 && isbnKeywords.some(k => val.includes(k))) colIsbn = colNumber;
                    if (colPrice === -1 && priceKeywords.some(k => val.includes(k))) colPrice = colNumber;
                    if (colSubtotal === -1 && subtotalKeywords.some(k => val.includes(k))) colSubtotal = colNumber;
                });
            }

            if (isVR) {
                colTitle = 2;
                colIsbn = 3;
                colPrice = 4;
                colSubtotal = 6;
            } else if (isIvrea) {
                if (colTitle === -1) colTitle = 2;
                if (colPrice === -1) {
                    for (let r = 10; r <= Math.min(30, ws.rowCount); r++) {
                        let found = false;
                        ws.getRow(r).eachCell((cell, colNum) => {
                            if (colNum > 2 && typeof cell.value === 'number' && cell.value > 10) {
                                colPrice = colNum;
                                found = true;
                            }
                        });
                        if (found) break;
                    }
                }
            }

            if (colTitle === -1 || colPrice === -1) return;

            let headerRowNum = 1;
            if (isVR) {
                headerRowNum = 1;
            } else {
                let foundHeader = false;
                for (let i = 1; i <= Math.min(40, ws.rowCount); i++) {
                    const val = String(ws.getRow(i).getCell(colTitle).value || '').toLowerCase().trim();
                    if (titleKeywords.some(k => val === k || val.includes(k))) {
                        headerRowNum = i;
                        foundHeader = true;
                        break;
                    }
                }
                if (!foundHeader) {
                    for (let i = 1; i <= 40; i++) {
                        const val = ws.getRow(i).getCell(colTitle).value;
                        if (val && typeof val === 'string' && val.length > 3 && !val.includes('NOVEDADES')) { headerRowNum = i; break; }
                    }
                }
            }

            const colSugerido = colSubtotal !== -1 ? colSubtotal + 1 : Math.max(colTitle, colIsbn, colPrice, 6) + 1;

            ws.getRow(headerRowNum).getCell(colPrice).value = "P. MAYOR";
            ws.getRow(headerRowNum).getCell(colSugerido).value = "PRECIO SUGERIDO";
            if (colSubtotal !== -1) {
                ws.getRow(headerRowNum).getCell(colSubtotal).value = "TOTAL (Bs)";
            }

            ws.eachRow((row, rowNumber) => {
                if (rowNumber <= headerRowNum) return;

                const cellPrice = row.getCell(colPrice);
                const ars = parseFloat(cellPrice.value);

                if (!isNaN(ars) && ars > 0) {
                    const costoReal = (ars * (1 - dto) * tca) + flete;
                    const pMayor = costoReal * (1 + mmayo);

                    let pRetail;
                    if (isIvrea) {
                        pRetail = Math.ceil(costoReal * (1 + margenVenta));
                    } else {
                        const D = (ars * (1 - dto) * tcf + flete) * (1 + margenVenta);
                        const E = Math.round(D / 5) * 5;
                        pRetail = Math.round((E * 0.65) / 5) * 5;
                    }

                    // Ajuste manual de PV, si existe para este precio ARS (ej. 21mil/22mil)
                    const manual = edAdjustments[Math.round(ars)];
                    if (manual != null) pRetail = manual;

                    const pSugerido = pRetail * 0.90;

                    cellPrice.value = Number(pMayor.toFixed(2));
                    cellPrice.numFmt = '#,##0.00';

                    row.getCell(colSugerido).value = Number(pSugerido.toFixed(2));
                    row.getCell(colSugerido).numFmt = '#,##0.00';
                }

                if (colSubtotal !== -1) {
                    const cellSub = row.getCell(colSubtotal);
                    cellSub.numFmt = '#,##0.00';
                }
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `CATALOGO_MAYORISTA_BS_${semana.nombre}${options.filenameSuffix || ''}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    },

    /**
     * Calcula los precios sugeridos (Retail, N3, Mayoreo) para un item
     */
    calculateSuggestedPrices(item, settings) {
        const ars = parseFloat(item.precio_tapa);
        if (isNaN(ars) || ars <= 0) return null;

        const editorial = item.editorial;
        const edSettings = settings.pricing.editoriales[editorial] || {
            margen_venta: 0.40,
            margen_mayoreo: 0.30,
            descuento_proveedor: 35
        };

        const global = settings.pricing.global;
        const desc = edSettings.descuento_proveedor / 100;
        const marg = edSettings.margen_venta;
        const mmayo = edSettings.margen_mayoreo;

        // --- Fórmulas de PriceAnalysisTool.jsx ---
        // 1. PV Sugerido (PVP)
        const D = (ars * (1 - desc) * global.tcf + global.flete) * (1 + marg);
        const E = Math.round(D / 5) * 5;
        const F = E * 0.65;
        const G_PV = Math.round(F / 5) * 5;

        // Aplicar ajuste manual si existe
        const arsKey = Math.round(ars);
        const pvManual = settings.manualAdjustments[editorial]?.[arsKey];
        const pvFinal = pvManual || G_PV;

        // 2. Precio N2 (-10% sobre PV)
        const precioN2 = pvFinal * 0.90;

        // 3. Precio N3 (-15% sobre PV)
        const precioN3 = pvFinal * (1 - (global.dtoNiveles[2] || 15) / 100);

        // 4. Precio Mayoreo
        const costoReal = ars * (1 - desc) * global.tca + global.flete;
        const pMayor = costoReal * (1 + mmayo);

        return {
            retail: Number(pvFinal.toFixed(2)),
            n2: Number(precioN2.toFixed(2)),
            n3: Number(precioN3.toFixed(2)),
            mayoreo: Number(pMayor.toFixed(2))
        };
    },

    /**
     * Realiza la sincronización inteligente del análisis con el Catálogo Maestro
     */
    async syncWithMaster(analysis, userId, filename = null, semanaId = null) {
        console.log('🔄 Iniciando Sincronización Inteligente...');
        
        // --- LÓGICA DE LIMPIEZA SEMANAL ---
        if (semanaId) {
            try {
                // 1. Obtener última semana sincronizada
                const { data: lastSyncData } = await supabase
                    .from('app_state')
                    .select('data')
                    .eq('id', 'last_catalog_sync_week')
                    .maybeSingle();
                
                const lastWeekId = lastSyncData?.data?.semanaId;
                
                if (lastWeekId !== semanaId) {
                    console.log(`📅 Cambio de semana detectado (${lastWeekId} -> ${semanaId}). Limpiando etiquetas antiguas...`);
                    
                    await this.clearAllReprintLabels();

                    // Actualizar app_state
                    const { error: upsertError } = await supabase
                        .from('app_state')
                        .upsert({ id: 'last_catalog_sync_week', data: { semanaId, updatedAt: new Date().toISOString() } });
                    
                    if (upsertError) console.error('❌ Error al actualizar app_state:', upsertError);
                    
                    console.log('✅ Etiquetas antiguas limpiadas.');
                } else {
                    console.log(`ℹ️ Misma semana (${semanaId}), no se requiere limpieza.`);
                }
            } catch (err) {
                console.error('❌ ERROR CRÍTICO EN LIMPIEZA SEMANAL:', err);
            }
        } else {
            console.warn('⚠️ No se proporcionó semanaId en syncWithMaster. No se limpiarán etiquetas.');
        }
        
        // Determinar filename: prioridad al parámetro, luego a la metadata del análisis, luego fallback
        const finalFilename = filename || analysis?._filename || 'AUTO_SYNC';
        
        // 1. Obtener configuraciones de precios
        const settings = await this.fetchPricingSettings();
        if (!settings) {
            console.warn('⚠️ No se pudo obtener la configuración de precios. Se usarán valores por defecto.');
        }

        const itemsToSync = [];
        const seenIds = new Set();
        let totalStats = { procesados: 0, nuevos: 0, precios: 0 };

        // 1.5 Reset global de "es_novedad" y categoria NOVEDADES
        console.log('🧹 Limpiando marcas de NOVEDAD antiguas globalmente...');
        try {
            // Reset del flag booleano (para tienda pública)
            await supabase
                .from('catalogo_productos')
                .update({ es_novedad: false })
                .eq('es_novedad', true);
            
            // Reset del campo de texto (para filtros en Admin)
            const { error: catError } = await supabase
                .from('catalogo_productos')
                .update({ categoria: 'CATÁLOGO GENERAL' })
                .eq('categoria', 'NOVEDADES');
            
            if (catError) throw catError;
            console.log('🧹 Categoría NOVEDADES reseteada a CATÁLOGO GENERAL');
        } catch (err) {
            console.error('❌ Error al resetear marcas de novedad:', err);
        }

        // 2. Consolidar items y aplicar cálculos
        for (const [edName, data] of Object.entries(analysis)) {
            if (!data.items) continue;
            
            // Reset de agotados para esta editorial antes de sincronizar
            console.log(`🧹 Reseteando agotados para editorial: ${edName}...`);
            await supabase
                .from('catalogo_productos')
                .update({ agotado_distribuidor: false })
                .ilike('editorial', edName);

            totalStats.procesados += data.items.length;

            data.items.forEach(item => {
                const esReimpresion = item.subetiquetas?.reimpresionSemana;
                if (item.comparison === 'nuevo') totalStats.nuevos++;
                if (item.comparison === 'cambio_precio') totalStats.precios++;

                const esNovedad = item.categoria_principal === 'NOVEDADES';
                const esAgotado = item.agotado_distribuidor === true;
                const tieneCambios = item.comparison !== 'sin_cambios' || esReimpresion || esNovedad || esAgotado;

                if (tieneCambios && !seenIds.has(item.product_id)) {
                    seenIds.add(item.product_id);

                    // Calcular precios inteligentes
                    const calculated = this.calculateSuggestedPrices(item, settings || { 
                        pricing: { editoriales: {}, global: { flete:6, tcf:0.014, tca:0.0068, dtoNiveles:[5,10,15] } },
                        manualAdjustments: {}
                    });

                    itemsToSync.push({
                        product_id: item.product_id,
                        titulo: item.titulo,
                        ean_oficial: item.ean_oficial,
                        ean_interno: item.ean_interno,
                        editorial: item.editorial || edName,
                        categoria: item.categoria_principal,
                        precio_tapa: item.precio_tapa || 0,
                        es_reimpresion: esReimpresion || false,
                        agotado_distribuidor: item.agotado_distribuidor || false,
                        // Precios inteligentes
                        precio_venta_bs: calculated?.retail || 0,
                        precio_n2_bs: calculated?.n2 || 0,
                        precio_n3_bs: calculated?.n3 || 0,
                        precio_mayoreo_bs: calculated?.mayoreo || 0,
                        updated_at: new Date().toISOString()
                    });
                }
            });
        }

        if (itemsToSync.length === 0) {
            console.log('✅ No hay cambios para sincronizar.');
            return { success: true, count: 0 };
        }

        // 3. Realizar Upsert masivo
        console.log(`🚀 Sincronizando ${itemsToSync.length} productos con el Maestro...`);
        await this.upsertMaster(itemsToSync);

        // 4. Registrar Log
        try {
            await supabase.from('catalogo_sync_logs').insert([{
                vendedor_id: userId,
                total_procesados: totalStats.procesados,
                nuevos_detectados: totalStats.nuevos,
                precios_actualizados: totalStats.precios,
                filename: finalFilename
            }]);
        } catch (logErr) {
            console.warn('⚠️ No se pudo registrar el log de sincronización:', logErr);
        }

        console.log('✅ Sincronización Inteligente finalizada con éxito.');
        return { success: true, count: itemsToSync.length };
    },

    /**
     * Aplica los configs de precios guardados (price_analysis_settings / adjustments)
     * a todos los items del catálogo. Se ejecuta automáticamente después de syncWithMaster.
     */
    async applyStoredPricing() {
        const EDITORIAL_DTOS_DEFAULT = {
            'Ivrea': 35, 'Ovnipress': 30, 'Panini-Utopia': 20,
            'Penguin': 35, 'Planeta': 35, 'Deux-PopFiction': 40,
            'Hotel de las Ideas': 40, 'V&R': 35, 'Otras': 35, 'Merchandising': 0
        };
        const DEFAULTS = { flete: 6, tcf: 0.014, tca: 0.0068, dtoNiveles: [5, 10, 15], margen_venta: 0.40, margen_mayoreo: 0.30 };

        // 1. Cargar configs guardados
        const { data: settings } = await supabase.from('price_analysis_settings').select('*');
        if (!settings || settings.length === 0) {
            console.log('ℹ️ applyStoredPricing: sin configs guardados, omitiendo.');
            return { count: 0 };
        }

        let { flete, tcf, tca, dtoNiveles } = DEFAULTS;
        const edSettings = {};

        settings.forEach(s => {
            if (s.editorial === 'GLOBAL_SETTINGS') {
                flete = parseFloat(s.flete) || DEFAULTS.flete;
                tcf = parseFloat(s.tcf) || DEFAULTS.tcf;
                tca = parseFloat(s.tca) || DEFAULTS.tca;
                dtoNiveles = s.dto_niveles || DEFAULTS.dtoNiveles;
            } else if (s.editorial) {
                edSettings[s.editorial] = {
                    dto: (parseFloat(s.descuento_proveedor) || 35) / 100,
                    margen: parseFloat(s.margen_venta) || DEFAULTS.margen_venta,
                    mmayo: parseFloat(s.margen_mayoreo) || DEFAULTS.margen_mayoreo,
                };
            }
        });

        // 2. Cargar ajustes manuales (overrides por editorial + precio ARS)
        const { data: adjustments } = await supabase.from('price_analysis_adjustments').select('*');
        const adjustMap = {};
        (adjustments || []).forEach(a => {
            if (!adjustMap[a.editorial]) adjustMap[a.editorial] = {};
            adjustMap[a.editorial][Math.round(Number(a.precio_ars))] = parseFloat(a.pv_ajuste);
        });

        // 3. Obtener todos los items del catálogo
        const allItems = [];
        let from = 0;
        let hasMore = true;
        while (hasMore) {
            const { data, error } = await supabase
                .from('catalogo_productos')
                .select('id, product_id, titulo, editorial, precio_tapa')
                .range(from, from + 999);
            if (error) throw error;
            if (!data || data.length === 0) break;
            allItems.push(...data);
            hasMore = data.length === 1000;
            from += 1000;
        }

        // 4. Calcular precios Bs. para cada item
        const payload = [];
        for (const item of allItems) {
            const ars = Number(item.precio_tapa || 0);
            if (!ars) continue;

            const ed = item.editorial;
            const edConf = edSettings[ed] || {};
            const dto = edConf.dto ?? ((EDITORIAL_DTOS_DEFAULT[ed] ?? 35) / 100);
            const margen = edConf.margen ?? DEFAULTS.margen_venta;
            const mmayo = edConf.mmayo ?? DEFAULTS.margen_mayoreo;

            const override = adjustMap[ed]?.[Math.round(ars)];
            const D = (ars * (1 - dto) * tcf + flete) * (1 + margen);
            const E = Math.round(D / 5) * 5;
            const pvFinal = override || Math.round(E * 0.65 / 5) * 5;

            const costoReal = ars * (1 - dto) * tca + flete;
            const pMayor = costoReal * (1 + mmayo);
            const n2 = pvFinal * (1 - (dtoNiveles[1] ?? 10) / 100);
            const n3 = pvFinal * (1 - (dtoNiveles[2] ?? 15) / 100);

            payload.push({
                id: item.id,
                product_id: item.product_id,
                titulo: item.titulo,
                editorial: item.editorial,
                precio_tapa: item.precio_tapa,
                precio_venta_bs: Number(pvFinal.toFixed(2)),
                precio_n2_bs: Number(n2.toFixed(2)),
                precio_n3_bs: Number(n3.toFixed(2)),
                precio_mayoreo_bs: Number(pMayor.toFixed(2)),
                updated_at: new Date(),
            });
        }

        // 5. Upsert en batches de 500
        for (let i = 0; i < payload.length; i += 500) {
            const { error } = await supabase
                .from('catalogo_productos')
                .upsert(payload.slice(i, i + 500), { onConflict: 'id' });
            if (error) throw error;
        }

        this.clearCache();
        console.log(`✅ applyStoredPricing: ${payload.length} items actualizados con precios Bs.`);
        return { count: payload.length };
    },

    /**
     * Resetea el flag 'es_reimpresion' de TODA la tabla catalogo_productos.
     * Útil antes de cargar una nueva lista semanal de IVREA.
     */
    async clearAllReprintLabels() {
        console.log('🧹 Limpiando todas las etiquetas de reimpresión del catálogo maestro...');
        const { error } = await supabase
            .from('catalogo_productos')
            .update({ es_reimpresion: false })
            .eq('es_reimpresion', true); // Solo los que están marcados, para ahorrar recursos

        if (error) {
            console.error('❌ Error al limpiar reimpresiones:', error);
            throw error;
        }
        
        this.clearCache();
        return true;
    },

    /**
     * Descarga una imagen remota o procesa un archivo local y lo persiste en Supabase Storage
     * @param {string} productId - ID del producto en el catálogo
     * @param {string|File|Blob} imageSource - URL de la imagen externa o un archivo local
     */
    async persistProductImage(productId, imageSource) {
        if (!productId || !imageSource) return null;
        
        // Si ya es una URL de Supabase, no hacer nada
        if (typeof imageSource === 'string' && imageSource.includes('supabase.co/storage')) return imageSource;

        console.log(`📸 [INICIO] Persistiendo imagen para ${productId}...`);
        
        try {
            let blob;
            let ext = 'jpg';
            
            if (imageSource instanceof File || imageSource instanceof Blob) {
                // CASO 1: Es un archivo local
                console.log("📁 Procesando archivo local...");
                blob = imageSource;
                ext = imageSource.name?.split('.').pop() || 'jpg';
            } else {
                // CASO 2: Es una URL remota
                console.log(`🔗 Descargando vía proxy principal: ${imageSource}`);
                
                // Intentar con una cadena de proxies (Weserv es el más potente para imágenes)
                const proxies = [
                    (url) => `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}`,
                    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
                    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
                ];

                let response;
                let lastError;

                for (const getProxy of proxies) {
                    try {
                        const proxyUrl = getProxy(imageSource);
                        console.log(`📡 Probando puente: ${proxyUrl}`);
                        response = await fetch(proxyUrl);
                        if (response.ok) {
                            console.log("✅ Puente exitoso!");
                            break; 
                        }
                    } catch (e) {
                        lastError = e;
                    }
                }
                
                if (!response || !response.ok) {
                    console.error("❌ Fallaron todos los proxies de descarga.", lastError);
                    throw new Error('No se pudo descargar la imagen por bloqueo del servidor de origen. Intenta subirla desde tu PC.');
                }
                
                blob = await response.blob();
                const contentType = response.headers.get('content-type') || 'image/jpeg';
                ext = contentType.split('/')[1] || 'jpg';
            }
            
            // Limpiar extensión
            if (ext.includes('+')) ext = ext.split('+')[0]; // ej: svg+xml -> svg

            const fileName = `${productId}.${ext}`;
            const filePath = `products/${fileName}`;

            // 3. Subir a Storage
            console.log(`☁️ Subiendo a bucket 'catalog-images' en ruta: ${filePath}...`);
            const { error: uploadError } = await supabase.storage
                .from('catalog-images')
                .upload(filePath, blob, { upsert: true });

            if (uploadError) {
                console.error("❌ ERROR EN STORAGE (SUPABASE):", uploadError);
                throw uploadError;
            }
            console.log("✅ Subida exitosa a Supabase Storage");

            // 4. Obtener URL pública e invalidar caché
            const { data: { publicUrl } } = supabase.storage
                .from('catalog-images')
                .getPublicUrl(filePath);

            // 5. Actualizar Catálogo en DB
            console.log("🗄️ Actualizando registro en base de datos...");
            const { error: dbError } = await supabase
                .from('catalogo_productos')
                .update({ imagen_url: publicUrl, updated_at: new Date().toISOString() })
                .eq('product_id', productId);

            if (dbError) throw dbError;

            this.clearCache();
            return publicUrl;
        } catch (err) {
            console.error('❌ FALLO TOTAL EN persistProductImage:', err);
            throw err;
        }
    },

    /**
     * Extrae imágenes de un texto HTML crudo siguiendo una lógica contextual avanzada.
     * @param {string} html - Código fuente de la página cargada
     * @param {string} baseUrl - URL base (opcional) para completar links relativos
     */
    extractFromRawHTML(html, baseUrl = "") {
        if (!html) return [];
        console.log(`🛠 [SMART SCAN] Iniciando extracción profunda (${html.length} caracteres)`);

        try {
            // A. DETECTAR DOMINIO BASE AUTOMÁTICAMENTE
            let detectedBaseUrl = baseUrl || "";
            if (!detectedBaseUrl) {
                const ogUrlMatch = html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i);
                const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
                if (ogUrlMatch || canonicalMatch) {
                    try {
                        detectedBaseUrl = new URL(ogUrlMatch ? ogUrlMatch[1] : canonicalMatch[1]).origin;
                    } catch (e) { /* silent */ }
                }
            }
            
            // Fallback para distribuidores conocidos
            if (!detectedBaseUrl && (html.includes('ivrea') || html.includes('editorialivrea'))) {
                detectedBaseUrl = "https://www.ivrea.com.ar";
            }

            // B. AYUDANTE DE LIMPIEZA
            const decodeEntities = (s) => {
                if (!s) return "";
                return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/#\d+;/g, '');
            };

            const forbiddenLabels = [
                'calendario de salidas', 'editorial ivrea', 'más info', 'mas info', 
                'logotipo', 'banner', 'proximas', 'proximamente', 'ver más', 'ver mas', 
                'home', 'contacto', 'quienes somos', 'donde comprar', 'archivo',
                'novedades', 'reimpresiones', 'nuestra editorial', 'facebook', 'twitter', 'instagram'
            ];

            const isGenericOrGarbage = (l) => {
                if (!l) return true;
                const lower = l.toLowerCase();
                if (lower.includes('<') || lower.includes('>') || lower.includes('{') || lower.includes('=') || lower.includes('class=')) return true;
                if (lower.includes('window.') || lower.includes('.jpg') || lower.includes('.png')) return true;
                return forbiddenLabels.some(f => lower.includes(f)) || l.length < 3 || l.length > 80;
            };

            // C. MOTOR DE EXTRACCIÓN MEJORADO (Regex para atributos múltiples en una sola etiqueta)
            const imgTags = html.match(/<(img|source|a)[^>]+>/gi) || [];
            
            const results = [];
            const processedUrls = new Set();
            const processedFileNames = new Set();

            for (const tag of imgTags) {
                // 1. Extraer URL Priorizando lazyload (data-src > data-lazy-src > srcset > src)
                const dataSrc = tag.match(/data-src=["']([^"'>]+)["']/i);
                const dataLazy = tag.match(/data-lazy-src=["']([^"'>]+)["']/i);
                const srcset = tag.match(/srcset=["']([^"'>\s]+)/i);
                const src = tag.match(/src=["']([^"'>]+)["']/i);
                const href = tag.match(/href=["']([^"'>]+\.(jpg|jpeg|png|webp)[^"'>]*)["']/i);

                let rawUrl = (dataSrc ? dataSrc[1] : (dataLazy ? dataLazy[1] : (srcset ? srcset[1] : (src ? src[1] : (href ? href[1] : null)))));
                
                if (!rawUrl || rawUrl.startsWith('data:')) continue;

                // Saltear placeholders conocidos
                if (rawUrl.includes('dflazy') || rawUrl.includes('placeholder') || rawUrl.includes('loading') || rawUrl.includes('/blank.')) continue;

                // 2. Limpiar URL
                let finalUrl = rawUrl;
                try {
                    if (finalUrl.startsWith('//')) finalUrl = 'https:' + finalUrl;
                    else if (finalUrl.startsWith('/') && detectedBaseUrl) finalUrl = detectedBaseUrl + finalUrl;
                    else if (!finalUrl.startsWith('http') && detectedBaseUrl) finalUrl = detectedBaseUrl + '/' + finalUrl;
                } catch (e) { continue; }

                if (processedUrls.has(finalUrl)) continue;

                // MAGIA PARA WHAKOOM: Cambiar /small/ por /large/ para obtener alta resolución y saltar el filtro
                if (finalUrl.includes('whakoom.com/small/')) {
                    finalUrl = finalUrl.replace('/small/', '/large/');
                }

                // Filtro de miniaturas e iconos
                const lowSrc = finalUrl.toLowerCase();
                if (lowSrc.includes('pixel') || lowSrc.includes('logo') || lowSrc.includes('avatar') || 
                    lowSrc.includes('icon') || lowSrc.includes('thumb-') || lowSrc.includes('/small/') || 
                    lowSrc.includes('spinner') || lowSrc.includes('header') || lowSrc.includes('footer')) continue;

                // 3. Extraer Nombre de Archivo para deduplicar
                const fileName = finalUrl.split('/').pop().split('?')[0];
                if (processedFileNames.has(fileName)) continue;

                // 4. BÚSQUEDA DE TÍTULO EN CONTEXTO
                let label = null;
                const altMatch = tag.match(/alt=["']([^"']+)["']/i);
                if (altMatch && !isGenericOrGarbage(decodeEntities(altMatch[1]))) {
                    label = decodeEntities(altMatch[1]).trim();
                }

                if (!label) {
                    const tagIdx = html.indexOf(tag);
                    const ctxStart = Math.max(0, tagIdx - 500);
                    const ctxEnd = Math.min(html.length, tagIdx + 700);
                    const context = html.substring(ctxStart, ctxEnd);
                    
                    const headingMatches = context.match(/<(h[1-4]|strong|b)[^>]*>([^<]+)<\/\1>/gi);
                    if (headingMatches) {
                        for (const h of headingMatches) {
                            const text = decodeEntities(h.replace(/<[^>]+>/g, '').trim());
                            if (!isGenericOrGarbage(text)) {
                                label = text;
                                break; 
                            }
                        }
                    }
                }

                // Fallback Limpio al Nombre de Archivo (ej: chainsawman01.jpg -> Chainsawman 01)
                if (!label || isGenericOrGarbage(label)) {
                    label = fileName.replace(/\.(jpg|jpeg|png|webp|gif)/i, '')
                                   .replace(/[_-]/g, ' ')
                                   .replace(/\d+x\d+/g, '') // Limpiar 135x200
                                   .replace(/\d+w/g, '')    // Limpiar 135w
                                   .replace(/\b[a-z]/g, (c) => c.toUpperCase());
                }

                // 5. Normalización final del label EXTRAÍDO
                label = decodeEntities(label).replace(/[^\w\s#\-+]/g, ' ').replace(/\s+/g, ' ').trim();

                if (label && !isGenericOrGarbage(label)) {
                    let finalLabel = label;
                    let counter = 1;
                    while (results.some(r => r.label === finalLabel)) {
                        finalLabel = `${label} #${counter}`;
                        counter++;
                    }

                    results.push({ url: finalUrl, label: finalLabel });
                    processedUrls.add(finalUrl);
                    processedFileNames.add(fileName);
                }
            }

            console.log(`✅ [SMART SCAN] Finalizado. ${results.length} imágenes útiles.`);
            return results;
        } catch (err) {
            console.error('❌ Error parsing raw HTML:', err);
            return [];
        }
    },

    /**
     * Calcula una puntuación de coincidencia entre dos strings (fuzzy match)
     */
    calculateMatchScore(str1, str2) {
        if (!str1 || !str2) return 0;
        
        // 1. Normalización profunda
        const normalize = (s) => {
            let res = s.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // quitar tildes
                .replace(/#/g, ' ') // Tomo #1 -> Tomo 1
                .replace(/[^\w\s]/gi, ' ') // quitar otros símbolos
                .replace(/\s+/g, ' ')
                .trim();
            
            // Normalizar números: "01" -> "1", "002" -> "2"
            res = res.replace(/\b0+(\d+)\b/g, '$1');
            return res;
        };

        const n1 = normalize(str1);
        const n2 = normalize(str2);
        
        // 2. TOKENIZACIÓN ÉPICA (Manejo de palabras pegadas)
        const getTokens = (s) => s.split(/\s+/).filter(w => w.length > 0);
        const tokens1 = getTokens(n1);
        const tokens2 = getTokens(n2);
        
        if (tokens1.length === 0 || tokens2.length === 0) return 0;
        
        let matches = 0;
        
        // 3. COMPARACIÓN CRUZADA (Incluso sub-palabras)
        tokens1.forEach(t1 => {
            if (tokens2.includes(t1)) {
                matches += 2; // Coincidencia exacta de token (ej: "1" = "1")
            } else {
                // Chequear si una palabra contiene a la otra (ej: "chainsawman" contiene "chainsaw")
                tokens2.forEach(t2 => {
                    if (t1.length > 3 && t2.length > 3) {
                        if (t1.includes(t2) || t2.includes(t1)) {
                            matches += 1.2; // Coincidencia parcial fuerte
                        }
                    }
                });
            }
        });

        // Bono por secuencia
        for (let i = 0; i < tokens1.length - 1; i++) {
            const bigram = tokens1[i] + " " + tokens1[i+1];
            if (n2.includes(bigram)) matches += 1;
        }

        // 4. Verificación CRÍTICA de Números (Tomos)
        const getNums = (s) => (s.match(/\d+/g) || []).map(n => parseInt(n).toString());
        const nums1 = getNums(n1);
        const nums2 = getNums(n2);
        
        let numMismatch = false;
        if (nums1.length > 0 && nums2.length > 0) {
            const hasCommonNum = nums1.some(num => nums2.includes(num));
            if (!hasCommonNum) numMismatch = true;
        }

        // 5. Cálculo Final
        // Calculamos score basado en el total de tokens posibles
        const maxTokens = Math.max(tokens1.length, tokens2.length);
        let score = (matches / (maxTokens * 2)) * 100;
        
        if (numMismatch) score *= 0.1; // Penalización máxima si el número de tomo no existe en el otro
        
        return Math.min(100, Math.ceil(score));
    },

    /**
     * Extrae información de un producto específico de Panini España
     * @param {string} html 
     */
    extractProductFromPanini(html) {
        if (!html) return null;
        try {
            const decodeEntities = (s) => {
                if (!s) return "";
                return s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/#\d+;/g, '');
            };

            // 1. Título
            const titleMatch = html.match(/<span\s+class="base"\s+data-ui-id="page-title-wrapper"[^>]*>([^<]+)<\/span>/i) ||
                               html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
            const titulo = titleMatch ? decodeEntities(titleMatch[1].trim()) : null;

            // 2. Precio (EUR)
            const priceMatch = html.match(/<span\s+class="price">([^<]+)<\/span>/i);
            const precio_eur = priceMatch ? priceMatch[1].replace(/[^\d.,]/g, '').replace(',', '.') : null;

            // 3. EAN / SKU / ISBN
            const skuMatch = html.match(/<div\s+class="value"\s+itemprop="sku">([^<]+)<\/div>/i) ||
                             html.match(/["']sku["']:\s*["']([^"']+)["']/i) ||
                             html.match(/ISBN:\s*<\/span>\s*<span[^>]*>([^<]+)<\/span>/i);
            const ean = skuMatch ? skuMatch[1].trim() : null;

            // 4. Imagen
            const imgMatch = html.match(/["']full["']:\s*["']([^"']+)["']/i) ||
                             html.match(/<img\s+class="product-image-photo"[^>]+src="([^"]+)"/i);
            const imagen = imgMatch ? imgMatch[1] : null;

            if (!titulo) return null;

            return {
                titulo,
                precio_eur: parseFloat(precio_eur) || '',
                ean,
                imagen,
                origen: 'España',
                editorial: 'Panini España'
            };
        } catch (err) {
            console.error('Error parsing Panini HTML:', err);
            return null;
        }
    },

    extractVolumesFromHtml(html) {
        const pattern = /photo-gallery\/imported_from_media_libray\/([^"'\s?]+\.jpg)/g;
        const results = [];
        let match;
        const seen = new Set();
        
        while ((match = pattern.exec(html)) !== null) {
            const filename = match[1].split('?')[0];
            const url = `https://www.ivrea.com.ar/storage/photo-gallery/imported_from_media_libray/${filename}`;
            
            if (seen.has(url)) continue;
            seen.add(url);
            
            // Extraer número del final: chainsawman09 → 9
            const nameWithoutExt = filename.replace('.jpg', '');
            const numMatch = nameWithoutExt.match(/(\d+)$/);
            
            results.push({
                url,
                filename: nameWithoutExt,
                numero: numMatch ? parseInt(numMatch[1]) : null,
                numeroStr: numMatch ? numMatch[1] : null,
                label: nameWithoutExt
            });
        }
        
        return results;
    },
    
    matchVolumeToProducts(volumes, catalogItems) {
        return volumes
          .filter(vol => !vol.filename.startsWith('thumb'))
          .map(vol => {
            if (!vol.numero) return null;
            
            const numStr0 = String(vol.numero).padStart(2, '0');
            const numStr2 = String(vol.numero);
            
            // Paso 1: filtrar por número de tomo
            const byNumber = catalogItems.filter(item => {
              if (!item.titulo) return false;
              const t = item.titulo.toUpperCase().trim();
              return t.endsWith(' ' + numStr0) || 
                     t.endsWith(' ' + numStr2) ||
                     t.endsWith(numStr0) ||
                     t.endsWith(numStr2);
            });
            
            if (byNumber.length === 0) return null;
            if (byNumber.length === 1) {
              return {
                ...vol,
                catalogItem: byNumber[0],
                score: 95,
                confidence: 'high',
                selected: !byNumber[0].imagen_url
              };
            }
            
            // Paso 2: entre múltiples candidatos,
            // comparar filename SIN el número
            // contra título normalizado SIN número
            const filenameSinNum = vol.filename
              .replace(/\d+$/, '')
              .toLowerCase()
              .replace(/[-_]/g, '');
            
            let best = null;
            let topScore = 0;
            
            byNumber.forEach(item => {
              const tituloNorm = item.titulo
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
              
              // Calcular cuántos caracteres del
              // filename están en el título
              let matches = 0;
              for (let i = 0; i < filenameSinNum.length; i++) {
                if (tituloNorm.includes(filenameSinNum[i])) matches++;
              }
              
              // También usar calculateMatchScore
              const fuzzyScore = this.calculateMatchScore(
                filenameSinNum, tituloNorm
              );
              
              const score = (matches / filenameSinNum.length * 50) + fuzzyScore;
              
              if (score > topScore) {
                topScore = score;
                best = item;
              }
            });
            
            const confidence = topScore > 40 ? 'high' : 
                               topScore > 20 ? 'medium' : 'low';
            
            return {
              ...vol,
              catalogItem: best,
              score: Math.round(topScore),
              confidence,
              selected: confidence === 'high' && !best?.imagen_url
            };
          })
          .filter(v => v !== null && v.catalogItem !== null);
    }
};
