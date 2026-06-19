import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { ChevronDown, ChevronRight, Download, Filter, Eye, EyeOff, FileText, Plus, Database, CheckCircle2, AlertCircle, RefreshCw, FileUp, ShoppingBag, Store } from 'lucide-react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { catalogService } from '../services/catalogService';

// Normaliza títulos para comparación robusta: sin acentos, guiones→espacio, espacios múltiples→uno
const normalizeTitle = (str) =>
    (str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[-–—]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export default function AdminConsolidatedView({ sellerIdFilter = null }) {
    const [semanas, setSemanas] = useState([]);
    const [selectedSemana, setSelectedSemana] = useState('');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedEditoriales, setExpandedEditoriales] = useState({});
    const [showOnlyWithOrders, setShowOnlyWithOrders] = useState(true);
    const [editorialFilter, setEditorialFilter] = useState('');
    const [masterConf, setMasterConf] = useState(null);
    const [masterData, setMasterData] = useState(null);
    const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);
    const [isExportingWithFormat, setIsExportingWithFormat] = useState(false);
    const [exportVerification, setExportVerification] = useState(null); // { success, msg, details: { systemQty, excelQty, systemTotal, excelTotal, titlesMatched, diff } }


    const EDITORIAL_DTOS = {
        'Ivrea': 35,
        'Ovnipress': 30,
        'Panini-Utopia': 20,
        'Penguin': 35,
        'Planeta': 35,
        'Deux-PopFiction': 40,
        'Hotel de las Ideas': 40,
        'V&R': 35,
        'Otras': 35,
        'Merchandising': 0
    };

    // Fixed editorials for Summary section
    const EDITORIALES = [
        'Ivrea', 'Ovnipress', 'Panini-Utopia', 'Penguin', 'Planeta',
        'Deux-PopFiction', 'Hotel de las Ideas', 'V&R', 'Otras', 'Merchandising'
    ];

    useEffect(() => {
        fetchSemanas();
    }, []);

    useEffect(() => {
        if (selectedSemana) fetchConsolidado();
    }, [selectedSemana]);

    const fetchSemanas = async () => {
        const { data: raw } = await supabase.from('semanas').select('id, nombre, archivo_url, archivo_nombre').order('created_at', { ascending: false });
        const data = (raw || []).filter(s => { const u = (s.nombre || '').toUpperCase(); return !(u.includes('VENTA') && u.includes('STOCK')); });
        if (data?.length) {
            setSemanas(data);
            setSelectedSemana(data[0].id);
        }
    };

    const fetchConsolidado = async () => {
        setLoading(true);
        // Note: We use the consolidated view from our SQL schema
        const { data, error } = await supabase
            .from('consolidado_detailed') // This is a view that includes vendor names as columns or aggregated
            .select('*')
        // This is a simplification; in a real app, we might join pedido_items with pedidos
        // For now, let's assume we fetch all items for this week and process them in JS
        // to handle dynamic vendor columns

        // FETCH RAW DATA AND AGGREGATE IN JS FOR HIGHER FLEXIBILITY
        let query = supabase
            .from('pedido_items')
            .select('*, catalogo_productos(precio_tapa), pedido:pedidos!inner(vendedor_nombre, tipo, semana_id, vendedor_id)')
            .eq('pedido.semana_id', selectedSemana);

        if (sellerIdFilter) {
            query = query.eq('pedido.vendedor_id', sellerIdFilter);
        }

        const [itemsResult, masterResult] = await Promise.all([
            query,
            supabase.from('master_confirmaciones').select('*').eq('semana_id', selectedSemana).maybeSingle()
        ]);

        if (itemsResult.error) console.error(itemsResult.error);
        else setItems(itemsResult.data || []);

        // Master Confirmaciones puede ser null sin ser necesariamente un error grave para el flujo
        if (masterResult.data) {
            setMasterData(masterResult.data);
            // Indexamos los confirmados por título (clave normalizada) para búsqueda O(1)
            const mapConf = {};
            (masterResult.data.datos_json || []).forEach(it => {
                const safeTitle = normalizeTitle(it.titulo);
                if (safeTitle) {
                    mapConf[safeTitle] = {
                        cantidad: it.cantidad,
                        precio: it.precio_unitario,
                        originalTitle: it.titulo
                    };
                }
            });
            setMasterConf(mapConf);
        } else {
            setMasterConf(null);
            setMasterData(null);
        }

        setLoading(false);
    };

    // Process data for tables
    const { summaryData, detailData, vendors, tiendaVendors, fileCards, mayoristasSet } = useMemo(() => {
        const vendorsSet = new Set();
        const tiendaVendorsSet = new Set();
        const mayoristasTracker = new Set();
        const editorialSummary = {};
        const editorialDetails = {};

        // Initialize summary
        EDITORIALES.forEach(ed => {
            editorialSummary[ed] = { vendors: {}, tiendaVendors: {}, subtotal: 0, dto: EDITORIAL_DTOS[ed] ?? 35, total: 0 };
        });

        // PASS 1: Reconstruir mapa de precios oficiales (ARS) para esta semana
        const officialPrices = {};
        items.forEach(item => {
            if (!item) return;
            const tKey = normalizeTitle(item.titulo);

            // Prioridad 1: Master Conf (Entelequia directo)
            if (masterConf?.[tKey]) {
                officialPrices[tKey] = masterConf[tKey].precio;
                return;
            }
            // Prioridad 2: Catálogo (ARS) o Item de Vendedor Normal (que ya es ARS)
            if (!officialPrices[tKey]) {
                const catalogPrice = item.catalogo_productos?.precio_tapa;
                if (catalogPrice) {
                    officialPrices[tKey] = catalogPrice;
                } else if (item.pedido?.tipo !== 'mayorista') {
                    officialPrices[tKey] = item.precio;
                }
            }
        });

        // PASS 2: Agregación principal
        items.forEach(item => {
            if (!item || !item.pedido) return; // Protección contra item malformado
            
            // FILTRO DE SEGURIDAD: Excluir items sacados del stock físico
            // para no pedirlos nuevamente a Entelequia en el consolidado.
            if (item.fuente === 'stock') return;
            const isTienda = item.pedido.tipo === 'tienda';
            const isMayorista = item.pedido.tipo === 'mayorista';
            const vName = isMayorista 
                ? `${item.pedido.vendedor_nombre} (MAY)` 
                : (item.pedido.vendedor_nombre || 'Desconocido');
            const editorial = item.editorial || 'Otras';

            // USAR PRECIO ARS UNIFICADO
            const searchTitle = normalizeTitle(item.titulo);
            const precioARS = officialPrices[searchTitle] || item.precio || 0;
            const amount = precioARS * (item.cantidad || 0);

            if (isTienda) tiendaVendorsSet.add(vName);
            else vendorsSet.add(vName);

            if (isMayorista) mayoristasTracker.add(vName);

            // Aggregating for Summary Table
            if (!editorialSummary[editorial]) editorialSummary[editorial] = { vendors: {}, tiendaVendors: {}, subtotal: 0, dto: EDITORIAL_DTOS[editorial] ?? 35, total: 0 };

            if (isTienda) {
                editorialSummary[editorial].tiendaVendors[vName] = (editorialSummary[editorial].tiendaVendors[vName] || 0) + amount;
            } else {
                editorialSummary[editorial].vendors[vName] = (editorialSummary[editorial].vendors[vName] || 0) + amount;
            }

            // El subtotal financiero incluye TODO (vendedores + mayoristas) en ARS
            editorialSummary[editorial].subtotal += amount;

            // Aggregating for Detail Table
            const detailKey = `${item.editorial}|${item.titulo}|${item.isbn_raw}`;
            if (!editorialDetails[editorial]) editorialDetails[editorial] = {};
            if (!editorialDetails[editorial][detailKey]) {
                const searchItemTitle = normalizeTitle(item.titulo);
                const confItem = masterConf ? masterConf[searchItemTitle] : null;

                editorialDetails[editorial][detailKey] = {
                    titulo: item.titulo,
                    ean: item.isbn_raw,
                    precio: precioARS, // Guardamos el ARS unificado
                    vendorQty: {},
                    tiendaQty: {},
                    totalQty: 0,
                    subtotal: 0,
                    confirmado: confItem ? confItem.cantidad : (masterConf ? 0 : null) // null = no hay master, 0 = no está en el master
                };
            }

            if (isTienda) {
                editorialDetails[editorial][detailKey].tiendaQty[vName] = (editorialDetails[editorial][detailKey].tiendaQty[vName] || 0) + item.cantidad;
            } else {
                editorialDetails[editorial][detailKey].vendorQty[vName] = (editorialDetails[editorial][detailKey].vendorQty[vName] || 0) + item.cantidad;
            }
            editorialDetails[editorial][detailKey].totalQty += item.cantidad;
            editorialDetails[editorial][detailKey].subtotal += amount;
        });

        // NUEVO: Procesar ítems que están en Master Conf pero no en los Pedidos (Pedidos Especiales/Extra)
        // Solo para Admin (cuando no hay sellerIdFilter de vendedor específico)
        if (masterConf && !sellerIdFilter) {
            Object.keys(masterConf).forEach(titleKey => {
                const confItem = masterConf[titleKey];

                // Buscar si este título ya fue procesado en detailData
                // titleKey ya está normalizado (lo indexamos con normalizeTitle arriba)
                let found = false;
                for (const ed in editorialDetails) {
                    for (const key in editorialDetails[ed]) {
                        const existingTitle = normalizeTitle(editorialDetails[ed][key].titulo);
                        if (existingTitle === titleKey) {
                            found = true;
                            break;
                        }
                    }
                    if (found) break;
                }

                if (!found) {
                    const defaultEd = 'Otras'; // Ponemos en Otras a priori, al no tener editorial
                    if (!editorialDetails[defaultEd]) editorialDetails[defaultEd] = {};

                    const newKey = `Otras|${confItem.originalTitle}|SPECIAL`;
                    editorialDetails[defaultEd][newKey] = {
                        titulo: confItem.originalTitle || titleKey.toUpperCase(),
                        ean: 'ESPECIAL',
                        precio: confItem.precio,
                        vendorQty: {},
                        tiendaQty: {},
                        totalQty: 0,
                        subtotal: 0,
                        confirmado: confItem.cantidad,
                        isSpecial: true
                    };

                    // Asegurarnos que la editorial exista en summary
                    if (!editorialSummary[defaultEd]) editorialSummary[defaultEd] = { vendors: {}, tiendaVendors: {}, subtotal: 0, dto: EDITORIAL_DTOS[defaultEd] ?? 35, total: 0 };
                }
            });
        }

        // Calculate totals for summary
        Object.keys(editorialSummary).forEach(ed => {
            const s = editorialSummary[ed];
            s.total = Math.round(s.subtotal * (1 - (s.dto / 100)));
        });

        // Calculate figures for cards
        const fileCards = [];
        // Extract personal vendors for cards
        vendorsSet.forEach(v => {
            let vTotal = 0;
            let vItems = 0;
            const isMayorista = mayoristasTracker.has(v);
            items.forEach(item => {
                // FILTRO DE SEGURIDAD: Excluir stock de la tarjeta (solo Entelequia)
                if (item.fuente === 'stock') return;

                const itemVName = item?.pedido?.tipo === 'mayorista' 
                    ? `${item.pedido.vendedor_nombre} (MAY)` 
                    : (item?.pedido?.vendedor_nombre || 'Desconocido');
                
                if (itemVName === v && item?.pedido?.tipo !== 'tienda') {
                    // USAR PRECIO ARS UNIFICADO
                    const searchTitle = normalizeTitle(item.titulo);
                    const precioARS = officialPrices[searchTitle] || item.precio || 0;
                    const amount = precioARS * (item.cantidad || 0);

                    const editorial = item.editorial || 'Otras';
                    const dto = EDITORIAL_DTOS[editorial] ?? 35;
                    vTotal += amount * (1 - (dto / 100));
                    vItems += item.cantidad || 0;
                }
            });
            fileCards.push({ name: v, total: Math.round(vTotal), items: vItems, type: isMayorista ? 'mayorista' : 'vendedor' });
        });

        // Extract tienda vendors for cards
        tiendaVendorsSet.forEach(v => {
            let tiendaTotal = 0;
            let tiendaItems = 0;
            items.forEach(item => {
                // FILTRO DE SEGURIDAD: Excluir stock de la tarjeta (solo Entelequia)
                if (item.fuente === 'stock') return;

                if (item?.pedido?.vendedor_nombre === v && item?.pedido?.tipo === 'tienda') {
                    // USAR PRECIO ARS UNIFICADO
                    const searchTitle = normalizeTitle(item.titulo);
                    const precioARS = officialPrices[searchTitle] || item.precio || 0;
                    const amount = precioARS * (item.cantidad || 0);

                    const editorial = item.editorial || 'Otras';
                    const dto = EDITORIAL_DTOS[editorial] ?? 35;
                    tiendaTotal += amount * (1 - (dto / 100));
                    tiendaItems += item.cantidad || 0;
                }
            });
            fileCards.push({ name: `TIENDA - ${v}`, total: Math.round(tiendaTotal), items: tiendaItems, type: 'tienda' });
        });

        return {
            summaryData: editorialSummary,
            detailData: editorialDetails,
            vendors: Array.from(vendorsSet).sort(),
            tiendaVendors: Array.from(tiendaVendorsSet).sort(),
            fileCards,
            mayoristasSet: mayoristasTracker
        };
    }, [items]);

    const exportExcel = () => {
        const wb = XLSX.utils.book_new();

        // Summary Sheet
        const summaryRows = [['Editorial', ...vendors, ...tiendaVendors.map(v => `T. ${v}`), 'Subtotal', 'Dto %', 'Total']];
        EDITORIALES.forEach(ed => {
            const s = summaryData[ed];
            summaryRows.push([
                ed,
                ...vendors.map(v => s.vendors[v] || 0),
                ...tiendaVendors.map(v => s.tiendaVendors[v] || 0),
                s.subtotal,
                s.dto,
                s.total
            ]);
        });

        summaryRows.push([]); // Espacio antes del total

        const totalFooterRow = ['TOTAL (C/ DTO)'];
        vendors.forEach(v => {
            totalFooterRow.push(EDITORIALES.reduce((sum, ed) => sum + ((summaryData[ed].vendors[v] || 0) * (1 - summaryData[ed].dto / 100)), 0));
        });
        tiendaVendors.forEach(v => {
            totalFooterRow.push(EDITORIALES.reduce((sum, ed) => sum + ((summaryData[ed].tiendaVendors[v] || 0) * (1 - summaryData[ed].dto / 100)), 0));
        });
        totalFooterRow.push(EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].subtotal, 0));
        totalFooterRow.push('');
        totalFooterRow.push(Math.round(EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].total, 0)));

        summaryRows.push(totalFooterRow);

        const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen Editorial');

        // Detail Sheet
        const detailRows = [];
        const headerRow = ['Editorial', 'Título', 'EAN', 'Precio', ...vendors, ...tiendaVendors.map(v => `T. ${v}`), 'Total Pedido'];
        if (masterConf) headerRow.push('Total Confirmado');
        headerRow.push('Subtotal $');
        detailRows.push(headerRow);

        Object.entries(detailData).forEach(([ed, products]) => {
            Object.values(products).forEach(p => {
                const row = [
                    ed, p.titulo, p.ean, p.precio,
                    ...vendors.map(v => p.vendorQty[v] || 0),
                    ...tiendaVendors.map(v => p.tiendaQty[v] || 0),
                    p.totalQty
                ];
                if (masterConf) row.push(p.confirmado !== null ? p.confirmado : '');
                row.push(p.subtotal);
                detailRows.push(row);
            });
        });
        const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
        XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalle Títulos');

        XLSX.writeFile(wb, `Consolidado_${semanas.find(s => s.id === selectedSemana)?.nombre}.xlsx`);
    };

    const exportWithFormat = async () => {
        const semana = semanas.find(s => s.id === selectedSemana);
        if (!semana?.archivo_url) {
            alert("No hay un archivo base cargado para esta semana. Súbelo en la pestaña 'Semanas' primero.");
            return;
        }

        setIsExportingWithFormat(true);
        try {
            console.log("Iniciando exportación con formato...");
            const response = await fetch(semana.archivo_url);
            const arrayBuffer = await response.arrayBuffer();
            
            // Verificar si es .xls (legacy) o .xlsx
            const isLegacy = semana.archivo_nombre?.toLowerCase().endsWith('.xls') || 
                             semana.archivo_url.toLowerCase().includes('.xls?');
            
            if (isLegacy) {
                alert("Atención: El archivo base es formato .xls (antiguo). ExcelJS solo soporta .xlsx (moderno). La preservación exacta de formato podría fallar o el archivo podría requerir reparación.");
            }

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);
            
            // BUSCAR TODAS LAS HOJAS QUE PAREZCAN DE PRODUCTOS
            const productSheets = [];

            console.log("Analizando todas las hojas del libro (" + workbook.worksheets.length + ")...");

            // ======= DIAGNÓSTICO COMPLETO =======
            console.log("=== INVENTARIO COMPLETO DEL EXCEL ===");
            workbook.worksheets.forEach((ws, idx) => {
                const firstRow = ws.getRow(1);
                const cells = [];
                firstRow.eachCell((cell, col) => cells.push(`Col${col}="${cell.value}"`));
                console.log(`Hoja ${idx + 1}: NOMBRE EXACTO="${ws.name}" | Primera fila: ${cells.join(', ')}`);
            });
            console.log("=====================================");

            for (const ws of workbook.worksheets) {
                let foundTitle = -1;
                let foundQty = -1;
                let foundIsbn = -1;

                console.log(`Analizando hoja: "${ws.name}"...`);

                // Escanear las primeras 50 filas
                for (let i = 1; i <= Math.min(50, ws.rowCount); i++) {
                    const row = ws.getRow(i);
                    row.eachCell((cell, colNumber) => {
                        const val = String(cell.value || '').toLowerCase();
                        
                        // Buscar Título
                        if (foundTitle === -1 && (
                            val === 'título' || val === 'titulo' || val.includes('titulo') ||
                            val.includes('producto') || val.includes('detalle') || 
                            val === 'articulo' || val === 'artículo' || val.includes('articulo') ||
                            val === 'nombre' || val === 'tãtulo' || val.includes('descrip') ||
                            val === 'ejemplar' || val === 'item' || val === 'manga'
                        )) {
                            foundTitle = colNumber - 1;
                        }

                        // Buscar Cantidad (excluir "páginas" y columnas de páginas)
                        if (foundQty === -1 && (
                            val.includes('cantidad') || val.includes('cant') || 
                            val.includes('unidades') || val.includes('pedido') ||
                            val === 'q' || val === 'qty'
                        ) && !val.includes('pag') && !val.includes('p\u00e1g')) {
                            if (colNumber - 1 !== foundTitle) {
                                foundQty = colNumber - 1;
                            }
                        }

                        // Buscar ISBN
                        if (foundIsbn === -1 && (
                            val.includes('isbn') || val.includes('ean') || 
                            val.includes('código') || val.includes('codigo') || 
                            val.includes('barra') || val.includes('ean13')
                        )) {
                            foundIsbn = colNumber - 1;
                        }
                    });

                    if (foundTitle !== -1 && foundQty !== -1 && foundTitle !== foundQty) {
                        const headers = [];
                        row.eachCell(c => headers.push(String(c.value || '')));
                        console.log(`[HEADERS ${ws.name}] Fila ${i}:`, headers.join(' | '));
                        break;
                    }
                }

                // REGLA DE ORO: Si son iguales o falta cantidad, intentar rescate
                if (foundTitle !== -1 && (foundQty === -1 || foundQty === foundTitle)) {
                    console.log(`⚠️ Cantidad no clara en "${ws.name}". Re-escaneando...`);
                    foundQty = -1;
                    for (let j = 1; j <= Math.min(50, ws.rowCount); j++) {
                        const r = ws.getRow(j);
                        r.eachCell((cell, colNumber) => {
                            const v = String(cell.value || '').toLowerCase();
                            if (foundQty === -1 && (v.includes('cant') || v.includes('pedido') || v.includes('unid') || v === 'q' || v === 'qty')) {
                                if (colNumber - 1 !== foundTitle) {
                                    foundQty = colNumber - 1;
                                    console.log(`   ✅ Columna de cantidad rescatada para "${ws.name}": Columna ${colNumber}`);
                                }
                            }
                        });
                        if (foundQty !== -1) break;
                    }
                }

                if (foundTitle !== -1 && foundQty !== -1) {
                    // Buscar Precio
                    let foundPrice = -1;
                    for (let j = 1; j <= Math.min(50, ws.rowCount); j++) {
                        const r = ws.getRow(j);
                        r.eachCell((cell, colNumber) => {
                            const v = String(cell.value || '').toLowerCase();
                            if (foundPrice === -1 && (v.includes('precio') || v.includes('p. publico') || v.includes('p. lista') || v.includes('importe') || v.includes('unit'))) {
                                if (colNumber - 1 !== foundTitle && colNumber - 1 !== foundQty) {
                                    foundPrice = colNumber - 1;
                                }
                            }
                        });
                        if (foundPrice !== -1) break;
                    }

                    productSheets.push({
                        ws,
                        titleColIndex: foundTitle,
                        qtyColIndex: foundQty,
                        isbnColIndex: foundIsbn,
                        priceColIndex: foundPrice
                    });
                    console.log(`✅ Hoja "${ws.name}" lista: Título=${foundTitle}, Cant=${foundQty}, Precio=${foundPrice}`);
                } else if (foundTitle !== -1 && foundQty === -1) {
                    // FALLBACK ESPECÍFICO: Si conocemos la hoja pero no detectamos cantidad, usar columna por nombre de hoja
                    const wsNameLower = ws.name.toLowerCase().replace(/\s/g, '');
                    let fallbackQty = -1;
                    if (wsNameLower.includes('ovni')) fallbackQty = 4; // Columna E
                    
                    if (fallbackQty !== -1) {
                        console.log(`🔧 Fallback aplicado para "${ws.name}": columna de cantidad = ${fallbackQty + 1}`);
                        productSheets.push({
                            ws,
                            titleColIndex: foundTitle,
                            qtyColIndex: fallbackQty,
                            isbnColIndex: foundIsbn
                        });
                    } else {
                        console.log(`❌ Hoja "${ws.name}" descartada: no se encontró columna de cantidad.`);
                    }
                }
            }

            if (productSheets.length === 0) {
                alert("No se encontró ninguna hoja con columnas de 'Título' y 'Cantidad'.");
                setIsExportingWithFormat(false);
                return;
            }

            // Consolidar todos los productos en un mapa plano para búsqueda rápida
            const flatProducts = {};
            const isbnProducts = {};

            Object.values(detailData).forEach(products => {
                Object.values(products).forEach(p => {
                    const normTitle = String(p.titulo || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                    const normIsbn = String(p.ean || '').replace(/[^0-9]/g, '');
                    const isMay = Object.keys(p.vendorQty).some(v => v.endsWith('(MAY)'));
                    const isNormal = Object.keys(p.vendorQty).some(v => !v.endsWith('(MAY)')) || Object.keys(p.tiendaQty).length > 0;

                    if (normTitle) {
                        if (flatProducts[normTitle]) {
                            // ACUMULAR CANTIDADES (Evita pérdida de unidades por duplicados)
                            flatProducts[normTitle].qty += p.totalQty;
                            if (isMay) flatProducts[normTitle].isMay = true;
                            if (isNormal) flatProducts[normTitle].isNormal = true;
                            flatProducts[normTitle].sourceType = 
                                (flatProducts[normTitle].isMay && flatProducts[normTitle].isNormal) ? 'AMBOS' : 
                                (flatProducts[normTitle].isMay ? 'MAYORISTA' : 'NORMAL');
                        } else {
                            flatProducts[normTitle] = { 
                                qty: p.totalQty, 
                                original: p.titulo, 
                                precio: p.precio, 
                                editorial: p.editorial,
                                normTitle: normTitle,
                                isMay,
                                isNormal,
                                sourceType: isMay && isNormal ? 'AMBOS' : (isMay ? 'MAYORISTA' : 'NORMAL')
                            };
                        }
                    }
                    
                    if (normIsbn && normIsbn.length > 5 && normTitle) {
                        const currentInfo = flatProducts[normTitle];
                        if (!isbnProducts[normIsbn]) {
                            isbnProducts[normIsbn] = currentInfo;
                        } else if (isbnProducts[normIsbn] !== currentInfo) {
                            // Si el ISBN apunta a un objeto distinto (título distinto), marcar como DUPLICATE
                            isbnProducts[normIsbn] = 'DUPLICATE';
                        }
                    }
                });
            });

            console.log("Muestra de títulos normalizados en DB:", Object.keys(flatProducts).slice(0, 10));
            console.log("Mapa de productos consolidado:", Object.keys(flatProducts).length, "títulos.");

            let matchedCount = 0;
            let totalQtyInDB = 0;
            let totalQtyFilledInExcel = 0;

            const filledProducts = new Set(); // Para evitar duplicados (reimpresiones)

            // Calcular total teórico del sistema
            Object.values(detailData).forEach(products => {
                Object.values(products).forEach(p => {
                    totalQtyInDB += p.totalQty;
                });
            });
            
            console.log("Total consolidado en sistema:", totalQtyInDB);

            // Procesar cada hoja identificada
            productSheets.forEach(({ ws, titleColIndex, qtyColIndex, isbnColIndex, priceColIndex }) => {
                console.log(`\n>>> Procesando hoja: "${ws.name}" | TitleCol=${titleColIndex+1}, QtyCol=${qtyColIndex+1} <<<`);
                
                // DUMP de las primeras 15 filas para diagnóstico
                console.log(`--- DUMP de primeras 15 filas de "${ws.name}" ---`);
                for (let dbgRow = 1; dbgRow <= Math.min(15, ws.rowCount); dbgRow++) {
                    const r = ws.getRow(dbgRow);
                    const rowDump = [];
                    r.eachCell((cell, col) => rowDump.push(`C${col}:"${cell.value}"`));
                    console.log(`  Fila ${dbgRow}: ${rowDump.join(' | ')}`);
                }
                console.log(`--- FIN DUMP ---`);

                let sheetMatchCount = 0;
                let samplesPrinted = 0;

                ws.eachRow((row, rowNumber) => {
                    // Saltar encabezados
                    if (rowNumber <= 5) {
                        const val = String(row.getCell(titleColIndex + 1).value || '').toLowerCase();
                        if (val.includes('título') || val.includes('detalle') || val.includes('editorial')) return;
                    }

                    const cellTitle = row.getCell(titleColIndex + 1).value;
                    const cellIsbn = isbnColIndex !== -1 ? String(row.getCell(isbnColIndex + 1).value || '').replace(/[^0-9]/g, '') : null;
                    const cellPrice = priceColIndex !== -1 ? Number(row.getCell(priceColIndex + 1).value) || 0 : 0;
                    
                    if (!cellTitle && !cellIsbn) return;

                    // FILTRO DE NOTAS/INSTRUCCIONES DEL DISTRIBUIDOR
                    const titleStr = String(cellTitle || '').toUpperCase();
                    if (titleStr.includes('POR FAVOR COMPLETAR') || 
                        titleStr.includes('NO EN EL FONDO') || 
                        titleStr.includes('REEDICIONES') ||
                        (cellPrice === 0 && (!cellIsbn || cellIsbn.length < 5))) {
                        return; // Es una nota, aviso o celda vacía/inválida
                    }

                    // Imprimir muestra de los primeros 5 títulos para diagnóstico
                    if (samplesPrinted < 5 && cellTitle) {
                        console.log(`  [Muestra ${ws.name}] Fila ${rowNumber} - Título: "${cellTitle}" | ISBN: "${cellIsbn || 'N/A'}"`);
                        samplesPrinted++;
                    }

                    let matchedQty = undefined;
                    let productKey = null;

                    // 1. PRIORIDAD: Intentar por Título (Más específico si hay ISBNs duplicados)
                    if (cellTitle) {
                        const normCellTitle = String(cellTitle).toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (flatProducts[normCellTitle] !== undefined) {
                            const pInfo = flatProducts[normCellTitle];
                            matchedQty = pInfo.qty;
                            productKey = `title:${normCellTitle}`;
                        }
                    }

                    // 2. SEGUNDO INTENTO: Por ISBN (Si el título no coincidió y el ISBN no es ambiguo)
                    if (matchedQty === undefined && cellIsbn && isbnProducts[cellIsbn] !== undefined && isbnProducts[cellIsbn] !== 'DUPLICATE') {
                        const pInfo = isbnProducts[cellIsbn];
                        
                        // VERIFICACIÓN DE SEGURIDAD: ¿El título del Excel se parece al menos un poco al del sistema?
                        const excelT = String(cellTitle || '').toLowerCase();
                        const dbT = String(pInfo.original || '').toLowerCase();
                        
                        // Si el título del Excel no contiene al menos una palabra clave del título del sistema, descartamos el match por ISBN
                        // Excluimos palabras cortas como "del", "las", "vol", etc.
                        const keywords = dbT.split(/[^a-z0-9]/).filter(w => w.length > 3);
                        const isPlausible = keywords.length === 0 || keywords.some(k => excelT.includes(k));
                        
                        if (isPlausible) {
                            matchedQty = pInfo.qty;
                            productKey = `title:${pInfo.normTitle}`; // Usamos el título del sistema como clave única
                        } else {
                            console.log(`⚠️ Match por ISBN ${cellIsbn} RECHAZADO por diferencia total de títulos: "${excelT}" vs "${dbT}"`);
                        }
                    }

                    // SOLO RELLENAR SI NO SE HA RELLENADO ANTES (Evita duplicar pedidos en reimpresiones)
                    if (matchedQty !== undefined && !filledProducts.has(productKey)) {
                        console.log(`  [DEBUG ${ws.name}] Fila ${rowNumber}: Escribiendo ${matchedQty} en columna ${qtyColIndex + 1} (${cellTitle})`);
                        row.getCell(qtyColIndex + 1).value = matchedQty;
                        matchedCount++;
                        sheetMatchCount++;
                        totalQtyFilledInExcel += matchedQty;
                        filledProducts.add(productKey);
                    } else if (matchedQty !== undefined) {
                        row.getCell(qtyColIndex + 1).value = 0;
                    }
                });
            });

            console.log("Coincidencias totales encontradas:", matchedCount);

            // --- REPORTE DE DISCREPANCIAS (TEMPORAL) ---
            const missingTitles = [];
            Object.values(flatProducts).forEach(p => {
                const key = `title:${p.normTitle}`;
                if (!filledProducts.has(key)) {
                    missingTitles.push({
                        Título: p.original,
                        Unidades: p.qty,
                        Tipo: p.sourceType,
                        Editorial: p.editorial
                    });
                }
            });

            if (missingTitles.length > 0) {
                console.group("%c🚨 REPORTE DE TÍTULOS NO ENCONTRADOS EN EL EXCEL", "color: red; font-weight: bold; font-size: 14px;");
                console.log(`Se detectaron ${missingTitles.length} títulos que están en el sistema pero NO existen en el Excel del distribuidor.`);
                console.table(missingTitles);
                console.groupEnd();
            }

            if (matchedCount === 0) {
                alert("No se encontraron coincidencias entre el Excel del distribuidor y los pedidos de la semana.");
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `PEDIDO_CONSOLIDADO_${semana.nombre}_${semana.archivo_nombre || 'distribuidor.xlsx'}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            
            if (matchedCount > 0) {
                // --- VERIFICACIÓN REAL POST-LLENADO ---
                // Re-escaneamos el Excel ya lleno para ver qué hay realmente ahí dentro
                let realExcelTotal = 0;
                const excelTotalsByEditorial = {};

                productSheets.forEach(({ ws, titleColIndex, qtyColIndex, priceColIndex }) => {
                    let sheetTotal = 0;
                    ws.eachRow((row, rowNumber) => {
                        if (rowNumber <= 5) return; // Saltar headers

                        const qty = Number(row.getCell(qtyColIndex + 1).value) || 0;
                        if (qty > 0) {
                            // Intentar obtener precio de la columna detectada, o del sistema si no hay columna
                            let price = 0;
                            if (priceColIndex !== -1) {
                                const pVal = row.getCell(priceColIndex + 1).value;
                                if (typeof pVal === 'number') price = pVal;
                                else if (typeof pVal === 'object' && pVal?.result) price = pVal.result;
                            }

                            // Si no hay precio en el Excel, buscamos en nuestro mapa para no perder la verificación
                            if (price === 0) {
                                const cellTitle = String(row.getCell(titleColIndex + 1).value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                                if (flatProducts[cellTitle]) price = flatProducts[cellTitle].precio;
                            }

                            sheetTotal += (qty * price);
                        }
                    });

                    if (sheetTotal > 0) {
                        // Mapear nombre de hoja a editorial para el descuento
                        let edMatch = 'Otras';
                        const wsName = ws.name.toLowerCase();
                        if (wsName.includes('ivrea')) edMatch = 'Ivrea';
                        else if (wsName.includes('ovni')) edMatch = 'Ovnipress';
                        else if (wsName.includes('panini') || wsName.includes('utopia')) edMatch = 'Panini-Utopia';
                        else if (wsName.includes('penguin') || wsName.includes('rhm')) edMatch = 'Penguin';
                        else if (wsName.includes('planeta')) edMatch = 'Planeta';
                        else if (wsName.includes('pop') || wsName.includes('deux')) edMatch = 'Deux-PopFiction';
                        else if (wsName.includes('v&r')) edMatch = 'V&R';
                        else if (wsName.includes('hotel')) edMatch = 'Hotel de las Ideas';

                        const dto = EDITORIAL_DTOS[edMatch] || 35;
                        realExcelTotal += Math.round(sheetTotal * (1 - (dto / 100)));
                    }
                });

                const grandTotalSystem = Object.values(summaryData).reduce((sum, ed) => sum + ed.total, 0);
                const diff = totalQtyInDB - totalQtyFilledInExcel;
                const totalMatch = Math.abs(realExcelTotal - Math.round(grandTotalSystem)) < 5; // Tolerancia pequeña para redondeos
                const qtyMatch = diff === 0;

                setExportVerification({
                    success: qtyMatch && totalMatch,
                    msg: (qtyMatch && totalMatch) ? "¡Verificación Exitosa!" : "Discrepancia Detectada",
                    details: {
                        titlesMatched: matchedCount,
                        systemQty: totalQtyInDB,
                        excelQty: totalQtyFilledInExcel,
                        systemTotal: Math.round(grandTotalSystem),
                        excelTotal: realExcelTotal,
                        diff: diff
                    }
                });
            }

        } catch (err) {
            console.error("Error al exportar con formato:", err);
            alert("Error al procesar el Excel: " + err.message);
        } finally {
            setIsExportingWithFormat(false);
        }
    };

    const exportWholesaleCatalog = async () => {
        const semana = semanas.find(s => s.id === selectedSemana);
        if (!semana || !semana.archivo_url) return;

        setIsExportingWithFormat(true);
        try {
            // 1. Obtener configuraciones de precios (Dólar, Flete, Márgenes por Editorial)
            const settings = await catalogService.fetchPricingSettings();
            if (!settings) throw new Error("No se pudo cargar la configuración de precios.");

            const DEFAULTS = { flete: 6, tcf: 0.014, tca: 0.0068, dtoNiveles: [5, 10, 15], margen_venta: 0.40, margen_mayoreo: 0.30 };
            const EDITORIAL_DTOS_DEFAULT = {
                'Ivrea': 35, 'Ovnipress': 30, 'Panini-Utopia': 20,
                'Penguin': 35, 'Planeta': 35, 'Deux-PopFiction': 40,
                'Hotel de las Ideas': 40, 'V&R': 35, 'Otras': 35, 'Merchandising': 0
            };

            // 2. Cargar el Excel original
            const response = await fetch(semana.archivo_url);
            const arrayBuffer = await response.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);

            console.log("Transformando catálogo con fórmulas de Análisis de Precios...");

            workbook.eachSheet((ws) => {
                // --- DESVINCULAR FÓRMULAS COMPARTIDAS (ANTI-CRASH) ---
                // Convierte todas las fórmulas compartidas en fórmulas individuales.
                // Esto es la cura definitiva para el error "Shared Formula master must exist..."
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
                    // Mover la imagen lejos para que no se vea
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

                    // ELIMINACIÓN FÍSICA de filas (de abajo hacia arriba para mantener índices)
                    ws.spliceRows(22, 1);
                    ws.spliceRows(11, 1);
                    ws.spliceRows(1, 7); // Eliminar filas del 1 al 7

                    // Eliminar Merchandising
                    for (let i = ws.rowCount; i >= 1; i--) {
                        const val = String(ws.getRow(i).getCell(1).value || '').toLowerCase();
                        if (val.includes('merchandising')) {
                            ws.spliceRows(i, 1);
                        }
                    }

                    // ELIMINACIÓN FÍSICA de columnas C, E, F (derecha a izquierda)
                    ws.spliceColumns(6, 1); // F
                    ws.spliceColumns(5, 1); // E
                    ws.spliceColumns(3, 1); // C
                    
                    const cellF11 = ws.getCell('F11');
                    if (cellF11.value) cellF11.value = "TOTAL PEDIDO (Bs)";

                    // FORMATO Y SUMATORIA EN LA NUEVA COLUMNA C (Filas 5 a 14)
                    for (let r = 5; r <= 14; r++) {
                        const cellC = ws.getCell(`C${r}`);
                        cellC.numFmt = '#,##0.00';
                    }
                    // Forzar que la C14 sea la suma de C5 a C13
                    ws.getCell('C14').value = { formula: 'SUM(C5:C13)' };

                    return;
                }

                // --- PROCESAMIENTO DE HOJAS DE EDITORIALES ---
                const edName = ws.name.trim();
                const isVR = edName.toUpperCase().includes('V&R') || edName.toUpperCase().includes('V Y R');
                const isIvrea = edName.toLowerCase().includes('ivrea');
                const edConf = settings.pricing.editoriales[edName] || {};
                const global = settings.pricing.global || DEFAULTS;

                // MODO ESPÍA PARA V&R: Imprime las primeras 15 filas en consola
                if (isVR) {
                    console.log(`=== MODO DEBUG: PESTAÑA V&R (${ws.name}) ===`);
                    for (let r = 1; r <= 15; r++) {
                        const rowVals = [];
                        ws.getRow(r).eachCell((cell, colNumber) => {
                            rowVals.push(`[Col${colNumber}: ${cell.value}]`);
                        });
                        if (rowVals.length > 0) {
                            console.log(`Fila ${r}:`, rowVals.join(' '));
                        }
                    }
                    console.log(`=========================================`);
                }

                const dto = (edConf.descuento_proveedor != null ? edConf.descuento_proveedor : (EDITORIAL_DTOS_DEFAULT[edName] ?? 35)) / 100;
                const mmayo = edConf.margen_mayoreo ?? DEFAULTS.margen_mayoreo;
                const tca = global.tca ?? DEFAULTS.tca;
                const flete = global.flete ?? DEFAULTS.flete;

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

                // FIX ESPECÍFICO V&R y IVREA
                if (isVR) {
                    // V&R no tiene encabezados, la Fila 1 dice "NOVEDADES" y la Fila 2 ya son datos.
                    colTitle = 2;
                    colIsbn = 3;
                    colPrice = 4;
                    colSubtotal = 6;
                } else if (isIvrea) {
                    if (colTitle === -1) colTitle = 2; // Asumir Columna B
                    // Si no encuentra precio en Ivrea, buscar la primera columna con valores numéricos grandes (precios)
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

                // DETECCIÓN PRECISA DE LA FILA DE ENCABEZADOS
                let headerRowNum = 1;
                if (isVR) {
                    headerRowNum = 1; // Para V&R, la fila 1 es el falso encabezado ("NOVEDADES")
                } else {
                    // Buscar la fila exacta que contiene la palabra "TITULO" o similar
                    let foundHeader = false;
                    for (let i = 1; i <= Math.min(40, ws.rowCount); i++) {
                        const val = String(ws.getRow(i).getCell(colTitle).value || '').toLowerCase().trim();
                        if (titleKeywords.some(k => val === k || val.includes(k))) {
                            headerRowNum = i;
                            foundHeader = true;
                            break;
                        }
                    }
                    // Fallback si no encontró palabra clave
                    if (!foundHeader) {
                        for(let i=1; i<=40; i++) {
                            const val = ws.getRow(i).getCell(colTitle).value;
                            if (val && typeof val === 'string' && val.length > 3 && !val.includes('NOVEDADES')) { headerRowNum = i; break; }
                        }
                    }
                }

                // INSERCIÓN DE COLUMNA A LA DERECHA EXACTAMENTE DESPUÉS DEL SUBTOTAL
                const colSugerido = colSubtotal !== -1 ? colSubtotal + 1 : Math.max(colTitle, colIsbn, colPrice, 6) + 1;

                ws.getRow(headerRowNum).getCell(colPrice).value = "P. MAYOR";
                ws.getRow(headerRowNum).getCell(colSugerido).value = "PRECIO SUGERIDO";
                if (colSubtotal !== -1) {
                    ws.getRow(headerRowNum).getCell(colSubtotal).value = "TOTAL (Bs)";
                }

                // Procesar cada fila de datos
                ws.eachRow((row, rowNumber) => {
                    if (rowNumber <= headerRowNum) return;

                    const cellPrice = row.getCell(colPrice);
                    const ars = parseFloat(cellPrice.value);

                    if (!isNaN(ars) && ars > 0) {
                        const margenVenta = edConf.margen_venta ?? 0.40;
                        const costoReal = (ars * (1 - dto) * tca) + flete;
                        const pMayor = costoReal * (1 + mmayo);

                        // PV: Ivrea usa costoReal × (1+margen) redondeado al ENTERO superior
                        // Resto usa fórmula D → E × 0.65 → redondeo a múltiplo de 5
                        let pRetail;
                        if (isIvrea) {
                            pRetail = Math.ceil(costoReal * (1 + margenVenta));
                        } else {
                            const D = (ars * (1 - dto) * (global.tcf || 0.014) + flete) * (1 + margenVenta);
                            const E = Math.round(D / 5) * 5;
                            pRetail = Math.round((E * 0.65) / 5) * 5;
                        }

                        // PRECIO SUGERIDO = PVP con 10% de descuento (sin redondear)
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

            // 3. Descargar el nuevo Excel
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `CATALOGO_MAYORISTA_BS_${semana.nombre}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            alert(`¡Catálogo Mayorista generado! Se aplicaron márgenes específicos por editorial detectada.`);

        } catch (err) {
            console.error("Error al generar catálogo mayorista:", err);
            alert("Error: " + err.message);
        } finally {
            setIsExportingWithFormat(false);
        }
    };



    const toggleEditorial = (ed) => {
        setExpandedEditoriales(prev => ({ ...prev, [ed]: !prev[ed] }));
    };

    if (loading) return <div className="py-12 flex justify-center"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>;

    const grandTotal = EDITORIALES.reduce((sum, ed) => sum + (summaryData[ed]?.total || 0), 0);

    return (
        <div className="space-y-6">
            {/* NEW PREMIUM HEADER */}
            <div className="bg-text text-white p-6 rounded-2xl shadow-2xl overflow-hidden relative group border border-white/5">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full -mr-32 -mt-32 blur-3xl group-hover:bg-primary/20 transition-all duration-700"></div>
                <div className="relative flex flex-wrap items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 text-white/60 text-xs font-bold tracking-widest uppercase mb-1">
                            <Database size={14} className="text-primary" />
                            <span>GESTIÓN DE PEDIDOS</span>
                        </div>
                        <h3 className="text-3xl font-display uppercase tracking-tight">
                            MANGAS COMICS <span className="text-primary">—</span> GESTIÓN INTEGRAL
                        </h3>
                        <p className="text-white/40 text-xs mt-1 font-mono uppercase tracking-widest">
                            {vendors.length} Vendedores • {items.reduce((sum, i) => sum + i.cantidad, 0)} Items Cargados
                        </p>
                    </div>

                    <div className="flex flex-col lg:flex-row items-end lg:items-center gap-6">
                        {/* Comparación Master Confirmaciones */}
                        {!sellerIdFilter && masterData && (
                            <div className="bg-black/20 p-4 rounded-xl border border-white/10 flex items-center justify-between gap-6 w-full lg:w-auto">
                                <div className="flex flex-col">
                                    <div className="text-[10px] text-white/50 font-bold uppercase tracking-widest mb-1 flex items-center gap-1">
                                        <Database size={10} /> TOTAL PRODUCTOS (CONFIRMADO)
                                    </div>
                                    <div className="text-2xl font-display text-white">
                                        ${Math.round(masterData.total_productos).toLocaleString()}
                                    </div>
                                    {/* Comparación de Stock vs Pedido Neto (con Dto) */}
                                    <div className="text-xs font-mono font-bold mt-1 max-w-[150px]">
                                        {(() => {
                                            const diff = masterData.total_productos - grandTotal;
                                            if (Math.abs(diff) < 1) return <span className="text-green-400">Cuadra exacto con el pedido neto.</span>;
                                            if (diff > 0) return <span className="text-red-400">Aumentó +${Math.round(diff).toLocaleString()} vs Pedido.</span>;
                                            return <span className="text-green-400">Disminuyó ${Math.round(Math.abs(diff)).toLocaleString()} vs Pedido.</span>;
                                        })()}
                                    </div>
                                </div>
                                <div className="w-px h-12 bg-white/10 hidden md:block"></div>
                                <div className="flex flex-col items-end">
                                    <div className="text-[10px] text-primary/80 font-bold uppercase tracking-widest flex items-center gap-1">
                                        ENVÍO ({masterData.cajas_qty || 0} CAJAS)
                                    </div>
                                    <div className="text-lg font-black text-primary font-mono-numbers mt-1">
                                        + ${Math.round(masterData.costo_envio || 0).toLocaleString()}
                                    </div>
                                    <div className="text-[10px] text-accent mt-2 font-black uppercase tracking-widest bg-accent/20 px-2 py-0.5 rounded-full border border-accent/30">
                                        DEUDA A DISTRIBUIDOR
                                    </div>
                                    <div className="text-2xl font-display text-accent">
                                        ${Math.round(masterData.total_ars || 0).toLocaleString()}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Total Mío (Con Descuento) */}
                        <div className="flex flex-col items-end gap-1 shrink-0 ml-auto">
                            <div className="text-xs text-white/40 font-bold uppercase tracking-widest">PEDIDO CONSOLIDADO</div>
                            <div className="text-5xl font-display text-primary leading-none">
                                ${Math.round(grandTotal).toLocaleString()}
                            </div>
                        </div>
                    </div>
                </div>
                {!sellerIdFilter && masterData && (
                    <div className="absolute top-0 right-0 bg-accent text-white px-4 py-1 rounded-bl-xl font-bold text-xs uppercase tracking-widest flex items-center gap-1 shadow-lg">
                        <CheckCircle2 size={12} /> BASE MASTER ACTIVA
                    </div>
                )}
            </div>

            {/* ACTION BAR & STATUS CARDS */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                <div className="lg:col-span-1 space-y-4">
                    <div className="glass p-4 rounded-2xl border border-border/40 shadow-sm">
                        <h4 className="text-xs font-bold text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Filter size={12} className="text-primary" /> CONTROLES
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-muted/60 uppercase block mb-1">Semana Activa</label>
                                <select
                                    value={selectedSemana}
                                    onChange={e => setSelectedSemana(e.target.value)}
                                    className="w-full bg-background border border-border/60 p-2.5 rounded-xl text-xs font-semibold focus:border-primary outline-none transition-all"
                                >
                                    {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                </select>
                            </div>
                            {!sellerIdFilter && (
                                <button
                                    onClick={exportExcel}
                                    className="w-full flex items-center justify-center gap-2 bg-text text-white p-3 rounded-xl text-xs font-bold hover:bg-black transition-all shadow-lg active:scale-95"
                                >
                                    <Download size={16} className="text-primary" /> EXPORTAR CONSOLIDADO
                                </button>
                            )}
                            
                            {!sellerIdFilter && semanas.find(s => s.id === selectedSemana)?.archivo_url && (
                                <>
                                    <button
                                        onClick={exportWithFormat}
                                        disabled={isExportingWithFormat}
                                        className="w-full flex items-center justify-center gap-2 bg-primary text-navy p-3 rounded-xl text-xs font-black hover:bg-primary/80 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                                    >
                                        {isExportingWithFormat ? (
                                            <RefreshCw size={16} className="animate-spin" />
                                        ) : (
                                            <FileUp size={16} />
                                        )}
                                        EXPORTAR CON FORMATO DISTRIBUIDOR
                                    </button>

                                    <button
                                        onClick={() => exportWholesaleCatalog()}
                                        disabled={isExportingWithFormat}
                                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white p-3 rounded-xl text-xs font-black hover:bg-emerald-700 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                                    >
                                        <ShoppingBag size={16} />
                                        GENERAR CATÁLOGO MAYORISTA (Bs)
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-3">
                    <div className="glass p-5 rounded-2xl border border-border/40 shadow-sm relative overflow-hidden">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-xs font-bold text-muted uppercase tracking-widest flex items-center gap-2">
                                <FileText size={12} className="text-primary" /> Archivos en esta semana
                            </h4>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={showOnlyWithOrders}
                                        onChange={e => setShowOnlyWithOrders(e.target.checked)}
                                        className="accent-primary"
                                        id="onlyOrders"
                                    />
                                    <label htmlFor="onlyOrders" className="text-xs font-bold text-muted/60 cursor-pointer">Solo con pedidos</label>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                            {fileCards.map((card, idx) => (
                                <div key={idx} className="bg-white/5 border border-border/40 p-3 rounded-xl flex items-center justify-between group hover:border-primary/40 transition-all">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                            card.type === 'tienda' ? 'bg-secondary/20 text-secondary' : 
                                            card.type === 'mayorista' ? 'bg-[#E8891A]/20 text-[#E8891A]' : 
                                            'bg-primary/20 text-primary'
                                        }`}>
                                            {card.type === 'mayorista' ? <Store size={16} /> : <FileText size={16} />}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-0.5">
                                                {card.type === 'mayorista' && <span className="bg-[#E8891A] text-white text-[8px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded">MAYORISTA</span>}
                                                <div className="text-xs font-bold text-text truncate max-w-[200px]">{card.name}</div>
                                            </div>
                                            <div className="text-xs text-muted font-medium">{card.items} productos cargados</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-muted/50 font-bold uppercase tracking-widest leading-none mb-1">Total</div>
                                        <div className={`text-sm font-bold ${
                                            card.type === 'tienda' ? 'text-secondary' : 
                                            card.type === 'mayorista' ? 'text-[#E8891A]' : 
                                            'text-primary'
                                        }`}>
                                            ${card.total.toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* SECTION 1: RESUMEN POR EDITORIAL */}
            <section>
                <div className="overflow-hidden border border-border/40 rounded-2xl shadow-xl glass">
                    <div className="bg-text text-white p-4 flex items-center justify-between border-b border-white/10">
                        <div className="flex items-center gap-2">
                            <Plus size={16} className="text-primary" />
                            <h4 className="text-xs font-bold uppercase tracking-[0.2em] mb-0">Resumen por Editorial</h4>
                        </div>
                        <div className="flex items-center gap-2">
                            <Filter size={14} className="text-white/40" />
                            <select
                                value={editorialFilter}
                                onChange={e => setEditorialFilter(e.target.value)}
                                className="bg-transparent border-none text-xs font-bold uppercase tracking-widest text-white/60 focus:ring-0 outline-none cursor-pointer hover:text-primary transition-colors"
                            >
                                <option value="" className="bg-text text-white">Todas las editoriales</option>
                                {EDITORIALES.map(ed => <option key={ed} value={ed} className="bg-text text-white">{ed}</option>)}
                            </select>
                        </div>
                    </div>
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="text-xs uppercase tracking-widest bg-white/5">
                            <tr className="border-b border-border/40">
                                <th className="p-4 font-bold text-muted w-1/4">EDITORIAL</th>
                                {vendors.map(v => (
                                    <th key={v} className={`p-4 font-bold text-center ${mayoristasSet.has(v) ? 'text-[#E8891A]' : ''}`}>
                                        {mayoristasSet.has(v) ? (
                                            <div className="flex items-center justify-center gap-1">
                                                <Store size={14} /> {v}
                                            </div>
                                        ) : v}
                                    </th>
                                ))}
                                {tiendaVendors.map(v => <th key={`t-${v}`} className="p-4 font-bold text-center text-secondary">T. {v}</th>)}
                                <th className="p-4 font-bold text-center">SUBTOTAL</th>
                                <th className="p-4 font-bold text-center text-muted/40">DTO %</th>
                                <th className="p-4 font-bold text-center text-primary">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {EDITORIALES.filter(ed => !editorialFilter || ed === editorialFilter).map(ed => {
                                const s = summaryData[ed];
                                if (showOnlyWithOrders && s.subtotal === 0) return null;
                                return (
                                    <tr key={ed} className="border-b border-border hover:bg-primary/5 transition-colors text-[13px]">
                                        <td className="p-4 font-bold text-text">{ed}</td>
                                        {vendors.map(v => (
                                            <td key={v} className="p-4 text-center text-muted-2 font-medium">
                                                {s.vendors[v] ? `$${s.vendors[v].toLocaleString()}` : '—'}
                                            </td>
                                        ))}
                                        {tiendaVendors.map(v => (
                                            <td key={`t-${v}`} className="p-4 text-center text-secondary font-bold bg-secondary/5">
                                                {s.tiendaVendors[v] ? `$${s.tiendaVendors[v].toLocaleString()}` : '—'}
                                            </td>
                                        ))}
                                        <td className="p-4 text-center text-text font-semibold">${s.subtotal.toLocaleString()}</td>
                                        <td className="p-4 text-center text-muted/60">{s.dto}%</td>
                                        <td className="p-4 text-center font-bold text-primary bg-primary/5 border-l border-primary/10">${s.total.toLocaleString()}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-text text-white">
                            <tr className="font-bold text-[13px]">
                                <td className="p-6">TOTAL (C/DTO) <span className="text-[10px] text-primary block mt-1">Neto a pagar</span></td>
                                {vendors.map(v => {
                                    const totalV = EDITORIALES.reduce((sum, ed) => {
                                        const gross = summaryData[ed].vendors[v] || 0;
                                        const dto = summaryData[ed].dto / 100;
                                        return sum + (gross * (1 - dto));
                                    }, 0);
                                    return <td key={v} className="p-6 text-center text-primary-content">${Math.round(totalV).toLocaleString()}</td>;
                                })}
                                {tiendaVendors.map(v => {
                                    const totalTV = EDITORIALES.reduce((sum, ed) => {
                                        const gross = summaryData[ed].tiendaVendors[v] || 0;
                                        const dto = summaryData[ed].dto / 100;
                                        return sum + (gross * (1 - dto));
                                    }, 0);
                                    return <td key={`t-${v}`} className="p-6 text-center text-secondary bg-white/5 border-l border-secondary/10">${Math.round(totalTV).toLocaleString()}</td>;
                                })}
                                <td className="p-6 text-center border-l border-white/10">
                                    ${EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].subtotal, 0).toLocaleString()}
                                </td>
                                <td></td>
                                <td className="p-6 text-center text-3xl text-primary font-display tracking-tighter bg-white/5 border-l border-white/10">
                                    <span className="text-xs align-top mr-1 opacity-50">$</span>
                                    {Math.round(EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].total, 0)).toLocaleString()}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>

            {/* SECTION 2: DETALLE POR TITULO */}
            <section>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-1 bg-primary rounded-full"></div>
                        <h4 className="text-xs font-bold text-muted uppercase tracking-[0.3em] opacity-60">Detalle por Título</h4>
                    </div>

                    {!sellerIdFilter && (
                        <button
                            onClick={() => setShowOnlyDiscrepancies(!showOnlyDiscrepancies)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black transition-all shadow-md flex items-center gap-2 border-2 ${showOnlyDiscrepancies ? 'bg-error text-white border-error shadow-error/40' : 'bg-white border-navy/20 text-navy hover:border-error hover:text-error'}`}
                        >
                            <AlertCircle size={14} className={showOnlyDiscrepancies ? 'text-white' : 'text-error'} />
                            {showOnlyDiscrepancies ? 'MOSTRANDO SOLO DIFERENCIAS' : 'VER DIFERENCIAS / ROJOS'}
                        </button>
                    )}
                </div>
                <div className="space-y-4">
                    {EDITORIALES.filter(ed => !editorialFilter || ed === editorialFilter).map(ed => {
                        const products = Object.values(detailData[ed] || {});
                        let filteredProducts = showOnlyWithOrders ? products.filter(p => p.totalQty > 0 || p.isSpecial) : products;

                        // Aplicar filtro de discrepancias
                        if (showOnlyDiscrepancies) {
                            filteredProducts = filteredProducts.filter(p =>
                                p.isSpecial ||
                                (p.confirmado !== null && p.confirmado !== p.totalQty)
                            );
                        }

                        if (filteredProducts.length === 0) return null;

                        const isOpen = expandedEditoriales[ed];

                        return (
                            <div key={ed} className="glass rounded-2xl overflow-hidden border border-border/40 shadow-sm hover:border-primary/20 transition-all">
                                <button
                                    onClick={() => toggleEditorial(ed)}
                                    className={`w-full flex items-center justify-between p-4 transition-all ${isOpen ? 'bg-text text-white' : 'bg-surface/50 hover:bg-surface'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1 rounded-lg ${isOpen ? 'bg-primary/20 text-primary' : 'bg-border text-muted'}`}>
                                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </div>
                                        <span className={`font-bold uppercase tracking-widest text-xs ${isOpen ? 'text-white' : 'text-text'}`}>{ed}</span>
                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isOpen ? 'bg-white/10 text-white/60' : 'bg-border text-muted'}`}>
                                            {filteredProducts.length} PRODUCTOS
                                        </span>
                                    </div>
                                    <span className={`text-xs font-bold ${isOpen ? 'text-primary' : 'text-accent'}`}>
                                        ${summaryData[ed].subtotal.toLocaleString()}
                                    </span>
                                </button>

                                {isOpen && (
                                    <div className="overflow-x-auto border-t border-border/20">
                                        <table className="w-full text-left border-collapse text-[12px]">
                                            <thead className="bg-[#f8f9fa] border-b border-border/40">
                                                <tr className="text-[11px] font-bold uppercase tracking-widest text-muted/60">
                                                    <th className="p-3 w-1/3">TITULO</th>
                                                    <th className="p-3">EAN</th>
                                                    <th className="p-3 text-center">PRECIO</th>
                                                    {vendors.map(v => (
                                                        <th key={v} className={`p-3 text-center uppercase tracking-tighter ${mayoristasSet.has(v) ? 'text-[#E8891A]' : ''}`}>
                                                            {mayoristasSet.has(v) ? (
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <Store size={12} /> {v}
                                                                </div>
                                                            ) : v}
                                                        </th>
                                                    ))}
                                                    {tiendaVendors.map(v => <th key={`t-${v}`} className="p-3 text-center text-secondary uppercase tracking-tighter">T. {v}</th>)}
                                                    <th className="p-3 text-center">TOTAL <span className="text-[9px] block text-muted/60">PEDIDO</span></th>
                                                    {masterConf && <th className="p-3 text-center text-accent">CONFIR. <span className="text-[9px] block text-accent/60">DESPACHO</span></th>}
                                                    <th className="p-3 text-right text-primary">SUBTOTAL</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredProducts.map(p => (
                                                    <tr key={(p?.titulo || 'extra') + (p?.ean || 'nuevo')} className={`border-b border-border transition-colors ${p?.isSpecial ? 'bg-accent/5 hover:bg-accent/10' : 'hover:bg-primary/5'}`}>
                                                        <td className="p-3 font-semibold text-text">
                                                            {p?.titulo || 'Sin Título'}
                                                            {p?.isSpecial && <span className="ml-2 text-[8px] bg-accent text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-widest leading-none align-middle shadow-sm">PEDIDO EXTRA</span>}
                                                        </td>
                                                        <td className="p-3 text-muted font-mono text-xs">{p?.ean || '—'}</td>
                                                        <td className="p-3 text-center font-medium">${Math.round(p?.precio || 0).toLocaleString()}</td>
                                                        {vendors.map(v => (
                                                            <td key={v} className={`p-3 text-center ${p?.vendorQty?.[v] ? 'text-text font-bold' : 'text-muted/20'}`}>
                                                                {p?.vendorQty?.[v] || '—'}
                                                            </td>
                                                        ))}
                                                        {tiendaVendors.map(v => (
                                                            <td key={`t-${v}`} className={`p-3 text-center border-l border-secondary/10 ${p?.tiendaQty?.[v] ? 'text-secondary font-bold bg-secondary/5' : 'text-muted/20'}`}>
                                                                {p?.tiendaQty?.[v] || '—'}
                                                            </td>
                                                        ))}
                                                        <td className="p-3 text-center font-bold bg-background/30 border-l border-border">{p?.totalQty || 0}</td>
                                                        {masterConf && (
                                                            <td className="p-3 text-center font-bold bg-accent/5 border-l border-border">
                                                                <span className={
                                                                    p?.confirmado == null ? '' :
                                                                        (p?.confirmado === p?.totalQty ? 'text-green-600' :
                                                                            p?.confirmado < p?.totalQty ? 'text-red-500' : 'text-accent')
                                                                }>
                                                                    {p?.confirmado != null ? p.confirmado : '—'}
                                                                </span>
                                                            </td>
                                                        )}
                                                        <td className="p-3 text-right font-bold text-primary">${Math.round(p?.subtotal || 0).toLocaleString()}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>
            {/* MODAL DE VERIFICACIÓN DE EXPORTACIÓN */}
            {exportVerification && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy/60 backdrop-blur-md animate-in fade-in duration-300">
                    <div className="bg-white rounded-[2rem] w-full max-w-lg overflow-hidden shadow-2xl shadow-navy/40 border border-white/20 transform animate-in zoom-in-95 duration-300">
                        {/* Header con gradiente según éxito */}
                        <div className={`p-8 text-center relative overflow-hidden ${exportVerification.success ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-amber-500 to-orange-600'}`}>
                            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    <path d="M0 100 C 20 0 50 0 100 100 Z" fill="white" />
                                </svg>
                            </div>
                            
                            <div className="relative z-10 flex flex-col items-center gap-4">
                                <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-xl flex items-center justify-center shadow-inner border border-white/30 animate-bounce-slow">
                                    {exportVerification.success ? (
                                        <CheckCircle2 size={40} className="text-white drop-shadow-md" />
                                    ) : (
                                        <AlertCircle size={40} className="text-white drop-shadow-md" />
                                    )}
                                </div>
                                <div>
                                    <h3 className="text-2xl font-black text-white tracking-tight uppercase">{exportVerification.msg}</h3>
                                    <p className="text-white/80 text-sm font-medium mt-1">Se procesaron {exportVerification.details.titlesMatched} títulos correctamente</p>
                                </div>
                            </div>
                        </div>

                        {/* Cuerpo de detalles */}
                        <div className="p-8 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Unidades Totales</span>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-2xl font-black text-navy">{exportVerification.details.excelQty}</span>
                                        <span className="text-xs font-bold text-slate-400">/ {exportVerification.details.systemQty}</span>
                                    </div>
                                    {exportVerification.details.diff === 0 ? (
                                        <span className="text-[10px] font-bold text-emerald-500 mt-1 uppercase">✓ Coinciden</span>
                                    ) : (
                                        <span className="text-[10px] font-bold text-rose-500 mt-1 uppercase">⚠ Faltan {exportVerification.details.diff}</span>
                                    )}
                                </div>

                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center justify-center">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Monto (Neto)</span>
                                    <div className="flex flex-col items-center">
                                        <span className="text-xl font-black text-navy leading-none">${exportVerification.details.excelTotal.toLocaleString('es-AR')}</span>
                                        <span className="text-[10px] font-bold text-slate-400 mt-1">Sistema: ${exportVerification.details.systemTotal.toLocaleString('es-AR')}</span>
                                    </div>
                                    {Math.abs(exportVerification.details.excelTotal - exportVerification.details.systemTotal) < 5 ? (
                                        <span className="text-[10px] font-bold text-emerald-500 mt-1 uppercase">✓ Coinciden</span>
                                    ) : (
                                        <span className="text-[10px] font-bold text-amber-600 mt-1 uppercase">⚠ Dif. ${Math.abs(exportVerification.details.excelTotal - exportVerification.details.systemTotal).toLocaleString('es-AR')}</span>
                                    )}
                                </div>
                            </div>

                            <div className={`p-5 rounded-2xl flex items-start gap-4 ${exportVerification.success ? 'bg-emerald-50 border border-emerald-100' : 'bg-amber-50 border border-amber-100'}`}>
                                <div className={`p-2 rounded-xl mt-1 ${exportVerification.success ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                                    <ShoppingBag size={16} />
                                </div>
                                <div>
                                    <h4 className={`text-sm font-black uppercase tracking-tight ${exportVerification.success ? 'text-emerald-800' : 'text-amber-800'}`}>
                                        {exportVerification.success ? 'Listo para enviar' : 'Revisión recomendada'}
                                    </h4>
                                    <p className={`text-xs mt-1 leading-relaxed ${exportVerification.success ? 'text-emerald-700/80' : 'text-amber-700/80'}`}>
                                        {exportVerification.success 
                                            ? 'Los datos en el archivo Excel coinciden perfectamente con los pedidos en el sistema. El consolidado está verificado.' 
                                            : 'Se han detectado pequeñas diferencias en las unidades o montos. Revisa si hay títulos marcados en rojo en el Excel o con ISBNs duplicados.'}
                                    </p>
                                </div>
                            </div>

                            <button
                                onClick={() => setExportVerification(null)}
                                className={`w-full py-5 rounded-2xl font-black text-sm tracking-widest uppercase transition-all shadow-lg ${exportVerification.success ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/30' : 'bg-navy hover:bg-navy-light text-white shadow-navy/30'}`}
                            >
                                Entendido, Continuar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
