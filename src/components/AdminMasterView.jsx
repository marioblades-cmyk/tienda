import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useDropzone } from 'react-dropzone';
import * as xlsx from 'xlsx';
import { Upload, Database, CheckCircle2, AlertCircle, X, Loader2, Calendar, Trash2, Edit2, Check, RefreshCw, TrendingUp, DollarSign } from 'lucide-react';
import VerificadorConfirmaciones from './VerificadorConfirmaciones';

export default function AdminMasterView() {
    const [semanas, setSemanas] = useState([]);
    const [selectedSemana, setSelectedSemana] = useState('');
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    // Edit Title State
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [newTitleValue, setNewTitleValue] = useState('');

    // Preview Data
    const [previewData, setPreviewData] = useState(null);
    const [existingMaster, setExistingMaster] = useState(null);

    // Repricing
    const [showRepricing, setShowRepricing] = useState(false);
    const [repricingPreview, setRepricingPreview] = useState(null);
    const [repricingSeleccion, setRepricingSeleccion] = useState(new Set()); // títulos seleccionados para recotizar
    const [repricingProcessing, setRepricingProcessing] = useState(false);
    const [repricingSuccess, setRepricingSuccess] = useState('');

    useEffect(() => {
        fetchSemanas();
    }, []);

    useEffect(() => {
        if (selectedSemana) {
            checkExistingMaster(selectedSemana);
        } else {
            setExistingMaster(null);
            setPreviewData(null);
        }
    }, [selectedSemana]);

    const fetchSemanas = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('semanas')
            .select('*')
            .order('created_at', { ascending: false });

        if (data) setSemanas(data.filter(s => { const u = (s.nombre || '').toUpperCase(); return !(u.includes('VENTA') && u.includes('STOCK')); }));
        if (error) console.error("Error cargando semanas:", error);
        setLoading(false);
    };

    const checkExistingMaster = async (semanaId) => {
        const { data } = await supabase
            .from('master_confirmaciones')
            .select('*')
            .eq('semana_id', semanaId)
            .maybeSingle();

        setExistingMaster(data || null);
        if (data) setPreviewData(null); // Clear preview if we load an existing one
    };

    const processExcel = (file) => {
        setProcessing(true);
        setError('');
        setSuccess('');

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = xlsx.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

                const rows = xlsx.utils.sheet_to_json(firstSheet, { header: 1 });
                if (rows.length === 0) throw new Error("El archivo Excel está vacío.");

                // El usuario quiere el nombre del archivo si tiene el número (ej: "12...")
                // Intentamos extraerlo del nombre del archivo primero si la celda A1 parece incompleta
                let filenameClean = file.name.replace(/\.(xlsx|xls)$/i, '').trim().toUpperCase();
                let cellA1 = String(rows[0][0] || '').trim().toUpperCase();

                // Si el nombre del archivo tiene números al inicio y la celda no, preferimos el archivo
                const hasNumberPrefix = (str) => /^\d+/.test(str);
                let tituloDespacho = (hasNumberPrefix(filenameClean) && !hasNumberPrefix(cellA1))
                    ? filenameClean
                    : (cellA1 || filenameClean || 'DESPACHO SIN TÍTULO');

                let parsedItems = [];
                let extractedTotalProductos = 0;
                let extractedEnvioTexto = '';
                let extractedCajasQty = 0;
                let extractedCostoEnvio = 0;
                let extractedTotalArs = 0;
                // Acumula los "Total" por editorial (ya con descuento aplicado) para fallback preciso
                let editorialTotals = [];

                // Auto-detectar posición de columnas desde la fila de encabezados
                // Soporta formato viejo [Título, Precio, Cantidad, Total]
                // y formato nuevo Entelequia [TITULO, ISBN, PRECIO, CANT, SUBTOTAL ARS]
                let colTitulo = 0;
                let colPrecio = 1;
                let colCant = 2;
                let colTotal = 3;

                try {
                    for (let i = 0; i < Math.min(rows.length, 15); i++) {
                        const r = rows[i];
                        if (!r || r.length === 0) continue;
                        // Array.from crea array denso (sin huecos) — evita undefined en findIndex
                        const rn = Array.from({ length: r.length }, (_, k) => {
                            const v = r[k];
                            return (v == null ? '' : String(v)).trim().toLowerCase().replace(/\s+/g, ' ');
                        });

                        const iTitulo = rn.findIndex(c => typeof c === 'string' && (c.includes('titulo') || c.includes('título')));
                        const iPrecio = rn.findIndex(c => typeof c === 'string' && (c === 'precio' || c.startsWith('precio ')));
                        const iCant   = rn.findIndex(c => typeof c === 'string' && (c === 'cant' || c === 'cantidad' || c.startsWith('cant ') || c.startsWith('cantidad ')));
                        const iSub    = rn.findIndex(c => typeof c === 'string' && c.includes('subtotal'));
                        const iTot    = rn.findIndex(c => typeof c === 'string' && c.includes('total') && !c.includes('titulo') && !c.includes('subtotal'));

                        if (iTitulo !== -1 && iPrecio !== -1 && iCant !== -1) {
                            colTitulo = iTitulo;
                            colPrecio = iPrecio;
                            colCant   = iCant;
                            colTotal  = iSub !== -1 ? iSub : (iTot !== -1 ? iTot : iCant + 1);
                            break;
                        }
                    }
                } catch (_headerErr) {
                    // Si falla la detección, usar defaults [Título, Precio, Cantidad, Total]
                    console.warn('Header detection failed, using default columns:', _headerErr);
                }

                // Acumular subtotal por editorial para calcular descuentos
                let currentEditorialSubtotal = 0;
                let currentDiscountPct = 0;

                // Encontrar la primera fila de datos reales y totales
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    if (!r || r.length === 0) continue;

                    const col0 = String(r[0] || '').trim().toLowerCase();

                    // Buscar total global de productos
                    if (col0.includes('total productos') || col0.includes('total producto')) {
                        extractedTotalProductos = parseFloat(r[colTotal]) || 0;
                        continue;
                    }

                    // "Subtotal" por editorial — solo marcador, ignorar
                    if (col0 === 'subtotal') continue;

                    // "Descuento X%" — extraer porcentaje para aplicar al subtotal de la editorial
                    const matchDesc = col0.match(/^descuento\s+(\d+(?:\.\d+)?)%/i);
                    if (matchDesc) {
                        currentDiscountPct = parseFloat(matchDesc[1]);
                        continue;
                    }

                    // "Total" por editorial — intentar leer del Excel; si está vacío, calcular con descuento
                    if (col0 === 'total') {
                        const excelTotal = parseFloat(r[colTotal]);
                        if (excelTotal > 0) {
                            editorialTotals.push(excelTotal);
                        } else if (currentEditorialSubtotal > 0) {
                            // Aplicar descuento y redondear para evitar floating-point (ej: 239399.99...)
                            editorialTotals.push(Math.round(currentEditorialSubtotal * (1 - currentDiscountPct / 100)));
                        }
                        currentEditorialSubtotal = 0;
                        currentDiscountPct = 0;
                        continue;
                    }

                    if (col0.includes('envio') || col0.includes('envío') || col0.includes('cajas')) {
                        extractedEnvioTexto = String(r[0] || '').trim();
                        extractedCostoEnvio = parseFloat(r[colTotal]) || 0;

                        // Intentar extraer cantidad de cajas del texto (ej. "Envío (2 cajas)")
                        const matchCajas = extractedEnvioTexto.match(/(\d+)\s*caja/i);
                        if (matchCajas) extractedCajasQty = parseInt(matchCajas[1]);
                        continue;
                    }

                    // Solo incluir ítems con cantidad > 0
                    // (el distribuidor a veces lista títulos con cant=0 que NO fueron pedidos)
                    // Usar columnas detectadas dinámicamente
                    const vPrecio = parseFloat(r[colPrecio]);
                    const vCant   = parseInt(r[colCant]);
                    if (r.length > colCant && !isNaN(vPrecio) && !isNaN(vCant) && vCant > 0
                            && vPrecio < 10_000_000) { // sanidad: precio no puede ser un EAN de 13 dígitos
                        parsedItems.push({
                            titulo: r[colTitulo],
                            precio_unitario: vPrecio,
                            cantidad: vCant,
                            precio_total: parseFloat(r[colTotal]) || 0
                        });
                        // Acumular subtotal de la editorial actual (para calcular el descuento)
                        currentEditorialSubtotal += vPrecio * vCant;
                    }
                }

                if (parsedItems.length === 0) {
                    throw new Error("No se pudo detectar la estructura del Excel. Formatos soportados: [Título, Precio, Cantidad, Total] o [TITULO, ISBN, PRECIO, CANT, SUBTOTAL ARS]");
                }

                // Fallback 1: suma de totales por editorial (ya con descuento) — más preciso
                // Fallback 2: suma de precios de lista × cantidad (sin descuento) — último recurso
                const sumaEditorialTotals = editorialTotals.reduce((acc, v) => acc + v, 0);
                const sumaListaPrecios = parsedItems.reduce((acc, it) => acc + (it.precio_unitario * it.cantidad), 0);

                // Setear defaults si no se extrajeron bien del excel
                if (extractedTotalProductos === 0) {
                    extractedTotalProductos = sumaEditorialTotals > 0 ? sumaEditorialTotals : sumaListaPrecios;
                }

                // Ignoramos filas "Total" raras del excel y FORZAMOS el cálculo algebraico:
                extractedTotalArs = extractedTotalProductos + extractedCostoEnvio;

                setPreviewData({
                    titulo: tituloDespacho,
                    totalArs: extractedTotalArs,
                    totalProductos: extractedTotalProductos,
                    costoEnvio: extractedCostoEnvio,
                    envioTexto: extractedEnvioTexto,
                    cajasQty: extractedCajasQty,
                    items: parsedItems
                });
                setProcessing(false);

            } catch (err) {
                console.error(err);
                setError(err.message || 'Error procesando el archivo Excel.');
                setProcessing(false);
            }
        };
        reader.onerror = () => {
            setError('Error de lectura del archivo.');
            setProcessing(false);
        };
        reader.readAsArrayBuffer(file);
    };

    // Marca un pedido como CANCELADO: crea una confirmación VACÍA para esa semana.
    // Efecto: la semana deja de "buscar confirmación" y todos los títulos quedan
    // como recortados (confirmado = 0). No agrega nada a Gestión Integral.
    const handleCancelarPedido = async () => {
        if (!selectedSemana) return setError("Selecciona una semana primero.");
        if (existingMaster) return setError("Esta semana ya tiene un Master. Elimínalo primero.");
        const semObj = semanas.find(s => s.id === selectedSemana);
        const nombre = semObj?.nombre || 'esta semana';
        if (!confirm(`¿Marcar "${nombre}" como PEDIDO CANCELADO?\n\nTodos los títulos quedarán como RECORTADOS y la semana dejará de buscar confirmación.`)) return;
        setProcessing(true);
        setError('');
        try {
            const { error: dbError } = await supabase.from('master_confirmaciones').insert([{
                semana_id: selectedSemana,
                titulo_despacho: `PEDIDO CANCELADO (${nombre})`,
                total_ars: 0,
                total_productos: 0,
                costo_envio: 0,
                envio_texto: '',
                cajas_qty: 0,
                datos_json: []
            }]);
            if (dbError) throw dbError;
            setSuccess("Pedido marcado como cancelado: todos los títulos quedan recortados y ya no busca confirmación.");
            checkExistingMaster(selectedSemana);
        } catch (err) {
            console.error(err);
            setError("Error al cancelar el pedido: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const onDrop = useCallback(acceptedFiles => {
        if (!selectedSemana) return setError("Selecciona una semana primero.");
        if (existingMaster) return setError("Esta semana ya tiene un Master. Elimínalo primero para sobreescribir.");
        if (acceptedFiles?.length > 0) {
            processExcel(acceptedFiles[0]);
        }
    }, [selectedSemana, existingMaster]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls']
        },
        multiple: false
    });

    // Normaliza títulos para comparación robusta:
    // - Minúsculas, sin acentos, guiones → espacio, espacios múltiples → uno
    const normalizeTitle = (str) =>
        (str || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[-–—]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

    // Estados que NUNCA deben ser sobreescritos por una re-sincronización
    const ESTADOS_TERMINALES = new Set(['EN TIENDA', 'ENTREGADO', 'ADJUDICADO', 'DAÑADO', 'DESPACHADO']);

    const syncOrdersWithMaster = async (semanaId, masterItems) => {
        if (!semanaId || !masterItems) return;
        setProcessing(true);
        setError('');
        try {
            const semanaObj = semanas.find(s => s.id === semanaId);
            const wName = semanaObj ? semanaObj.nombre : '';

            // 1. Fetch ALL cliente_items for this week
            const { data: clientItems, error: itemsError } = await supabase
                .from('cliente_items')
                .select('*')
                .eq('semana_id', semanaId);

            if (itemsError) throw itemsError;

            // Fetch ALL pedido_items de mayoristas para esta semana (solo los pedidos a Entelequia)
            const { data: mayoristaItems, error: mayoristaError } = await supabase
                .from('pedido_items')
                .select('*, pedido:pedidos!inner(tipo, semana_id)')
                .eq('pedido.semana_id', semanaId)
                .eq('pedido.tipo', 'mayorista')
                .eq('fuente', 'entelequia');

            if (mayoristaError) console.error("Error fetching mayorista items:", mayoristaError);

            // 2. Map master titles — solo qty > 0, con normalización robusta
            const masterTitles = new Set(
                masterItems.filter(it => it.cantidad > 0).map(it => normalizeTitle(it.titulo))
            );

            let confirmedCount = 0;
            let cutCount = 0;
            let skippedCount = 0;

            const updateItems = async (itemsList, tableName) => {
                for (let item of itemsList) {
                    // 🔒 Nunca pisar estados terminales (libro ya llegó, entregado, etc.)
                    if (ESTADOS_TERMINALES.has(item.estado)) {
                        skippedCount++;
                        continue;
                    }

                    const itemTitle = normalizeTitle(item.titulo);
                    const isConfirmed = masterTitles.has(itemTitle);

                    let nuevoEstado = isConfirmed ? `CONFIRMADO ${wName}`.trim() : 'RECORTADO';

                    // Solo actualizar si el estado cambió
                    if (item.estado !== nuevoEstado) {
                        const { error: updateErr } = await supabase.from(tableName).update({ estado: nuevoEstado }).eq('id', item.id);
                        if (updateErr) console.error(`Error al actualizar ${tableName} item:`, item.id, updateErr);

                        if (isConfirmed) confirmedCount++;
                        else cutCount++;
                    }
                }
            };

            // 3. Batch Update statuses
            if (clientItems && clientItems.length > 0) {
                await updateItems(clientItems, 'cliente_items');
            }
            if (mayoristaItems && mayoristaItems.length > 0) {
                await updateItems(mayoristaItems, 'pedido_items');
            }
            
            const skipMsg = skippedCount > 0 ? `, ${skippedCount} sin tocar (ya en tienda/entregados)` : '';
            setSuccess(`Sincronización completa: ${confirmedCount} confirmados, ${cutCount} recortados${skipMsg}.`);
        } catch (e) {
            console.error("Error sincronizando pedidos:", e);
            setError("Error al sincronizar los estados de los pedidos de clientes y mayoristas.");
        } finally {
            setProcessing(false);
        }
    };

    const handleSaveMaster = async () => {
        if (!previewData || !selectedSemana) return;
        setProcessing(true);
        setError('');

        try {
            // 1. Save to master_confirmaciones
            const { error: dbError } = await supabase.from('master_confirmaciones').insert([{
                semana_id: selectedSemana,
                titulo_despacho: previewData.titulo,
                total_ars: previewData.totalArs,
                total_productos: previewData.totalProductos,
                costo_envio: previewData.costoEnvio,
                envio_texto: previewData.envioTexto,
                cajas_qty: previewData.cajasQty,
                datos_json: previewData.items
            }]);

            if (dbError) throw dbError;

            // 2. Automagically add to app_state for the Distribuidor (RemitosTable)
            const { data: appStateData } = await supabase
                .from('app_state')
                .select('data')
                .eq('id', 'distribuidor')
                .maybeSingle();

            let distData = appStateData?.data || { pedidos: [], pagos: [], saldoInicial: null, ajustes: [] };
            const semanaGuardada = semanas.find(s => s.id === selectedSemana);
            const nombreMostrar = semanaGuardada ? semanaGuardada.nombre : selectedSemana;
            const pedidoName = `${previewData.titulo} (${nombreMostrar})`;

            // ✅ Solo agregar si NO existe ya una entrada con el mismo nombre (evitar duplicados al re-subir)
            const existsInDist = (distData.pedidos || []).some(p => p.nombre === pedidoName);
            if (!existsInDist) {
                distData.pedidos.push({ nombre: pedidoName, monto: previewData.totalArs });
                await supabase.from('app_state').upsert({ id: 'distribuidor', data: distData });
            } else {
                // Si ya existe, actualizar el monto por si cambió (re-subida con corrección de monto)
                distData.pedidos = distData.pedidos.map(p =>
                    p.nombre === pedidoName ? { ...p, monto: previewData.totalArs } : p
                );
                await supabase.from('app_state').upsert({ id: 'distribuidor', data: distData });
            }
            
            // 3. Sincronizar fila en 'remitos' (Gestión Integral)
            // Buscar por sufijo de semana para tolerar cambios en el nombre del archivo
            const { data: remDataRes } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
            let remRows = Array.isArray(remDataRes?.data) ? remDataRes.data : (remDataRes?.data?.rows || []);
            const getSufijo = (n) => { const m = (n||'').match(/\(([^)]+)\)\s*$/); return m ? m[1].trim().toLowerCase() : ''; };
            const sufijoNuevo = getSufijo(pedidoName);
            const idxExistente = sufijoNuevo ? remRows.findIndex(r => getSufijo(r.pedido || '') === sufijoNuevo) : remRows.findIndex(r => r.pedido === pedidoName);

            if (idxExistente >= 0) {
                // ✅ Ya existe → solo actualizar nombre y monto, conservar todos los demás datos (cajas, TC, etc.)
                remRows = remRows.map((r, i) => i === idxExistente
                    ? { ...r, pedido: pedidoName, pago_aprox: previewData.totalArs }
                    : r
                );
            } else {
                // Nueva entrada
                const newId = remRows.length > 0 ? Math.max(...remRows.map(r => r.id || 0)) + 1 : 1;
                remRows = [...remRows, {
                    id: newId, nro: `${newId}`, fecha: new Date().toISOString().split('T')[0], cajas: '0',
                    kg: '0', precio_remito: '0', compre: '0', cambio: '0', cg: '0', cm: '0', cp: '0',
                    skg: '0', scaj: '0', smonto: '0', pedido: pedidoName, pago_aprox: previewData.totalArs,
                    pagos_dist: '0', tc_dist: '0', selected: false
                }];
            }
            await supabase.from('app_state').upsert({ id: 'remitos', data: remRows });

            // 4. NUEVO: Sincronización automática de pedidos de clientes tras guardar
            await syncOrdersWithMaster(selectedSemana, previewData.items);
            
            setSuccess("Base Maestra guardada y pedidos de clientes sincronizados.");
            setPreviewData(null);
            checkExistingMaster(selectedSemana);
        } catch (err) {
            console.error(err);
            setError(err.message || "Error al guardar el Master.");
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteMaster = async () => {
        if (!existingMaster || !confirm("¿Seguros que deseas eliminar esta base maestra?")) return;
        setProcessing(true);
        setError('');
        try {
            await supabase.from('master_confirmaciones').delete().eq('id', existingMaster.id);

            // ✅ También quitar la entrada correspondiente del distribuidor en app_state
            const semanaGuardada = semanas.find(s => s.id === selectedSemana);
            const nombreMostrar = semanaGuardada ? semanaGuardada.nombre : selectedSemana;
            const pedidoName = `${existingMaster.titulo_despacho} (${nombreMostrar})`;

            const { data: distRes } = await supabase.from('app_state').select('data').eq('id', 'distribuidor').maybeSingle();
            if (distRes?.data) {
                let distData = { ...distRes.data };
                const before = (distData.pedidos || []).length;
                distData.pedidos = (distData.pedidos || []).filter(p => p.nombre !== pedidoName);
                if (distData.pedidos.length !== before) {
                    await supabase.from('app_state').upsert({ id: 'distribuidor', data: distData });
                }
            }

            setExistingMaster(null);
            setSuccess("Base Maestra eliminada correctamente.");
        } catch (err) {
            console.error(err);
            setError("Error al eliminar la Base Maestra.");
        } finally {
            setProcessing(false);
        }
    };

    const handleUpdateTitle = async () => {
        if (!newTitleValue.trim() || !existingMaster || !selectedSemana) return;
        setProcessing(true);
        try {
            const oldTitle = existingMaster.titulo_despacho;
            const newTitle = newTitleValue.trim();
            const semanaObj = semanas.find(s => s.id === selectedSemana);
            const nombreMostrar = semanaObj ? semanaObj.nombre : selectedSemana;

            const oldPedidoName = `${oldTitle} (${nombreMostrar})`;
            const newPedidoName = `${newTitle} (${nombreMostrar})`;

            // 1. Update master_confirmaciones
            await supabase.from('master_confirmaciones').update({ titulo_despacho: newTitle }).eq('id', existingMaster.id);

            // 2. Propagate to app_state 'distribuidor'
            const { data: distDataRes } = await supabase.from('app_state').select('data').eq('id', 'distribuidor').maybeSingle();
            if (distDataRes?.data) {
                let distData = { ...distDataRes.data };
                let modifiedDist = false;
                const weekSuffix = `(${nombreMostrar.toLowerCase()})`;

                if (Array.isArray(distData.pedidos)) {
                    distData.pedidos = distData.pedidos.map(p => {
                        const curName = (p.nombre || '').trim().toLowerCase();
                        const oldFull = oldPedidoName.toLowerCase();
                        const oldBase = oldTitle.toLowerCase();

                        // Prioridad: 1. Sufijo de Semana coincidente (muy fiable) 2. Match exacto 3. Contención mutua
                        const isMatch = curName.endsWith(weekSuffix) || 
                                      curName === oldFull || 
                                      (oldBase && curName.includes(oldBase)) || 
                                      (curName.length > 5 && oldBase.includes(curName));

                        if (isMatch) {
                            modifiedDist = true;
                            return { ...p, nombre: newPedidoName };
                        }
                        return p;
                    });
                }
                if (modifiedDist) {
                    await supabase.from('app_state').update({ data: distData }).eq('id', 'distribuidor');
                }
            }

            // 3. Propagate to app_state 'remitos'
            const { data: remDataRes } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
            if (remDataRes?.data) {
                let remRows = Array.isArray(remDataRes.data) ? remDataRes.data : (remDataRes.data.rows || []);
                let modifiedRem = false;
                const weekSuffix = `(${nombreMostrar.toLowerCase()})`;

                const updatedRows = remRows.map(r => {
                    const curName = (r.pedido || '').trim().toLowerCase();
                    const oldFull = oldPedidoName.toLowerCase();
                    const oldBase = oldTitle.toLowerCase();

                    const isMatch = curName.endsWith(weekSuffix) || 
                                  curName === oldFull || 
                                  (oldBase && curName.includes(oldBase)) || 
                                  (curName.length > 5 && oldBase.includes(curName));

                    if (isMatch) {
                        modifiedRem = true;
                        return { ...r, pedido: newPedidoName };
                    }
                    return r;
                });
                if (modifiedRem) {
                    await supabase.from('app_state').update({ data: updatedRows }).eq('id', 'remitos');
                }
            }

            setExistingMaster({ ...existingMaster, titulo_despacho: newTitle });
            setSuccess("Título actualizado y sincronizado en Gestión Integral.");
            setIsEditingTitle(false);
        } catch (err) {
            console.error(err);
            setError("Error al actualizar y sincronizar el título.");
        } finally {
            setProcessing(false);
        }
    };

    // ── REPRICING: leer precios actualizados del catálogo y comparar ─────────
    const loadRepricingFromCatalog = async () => {
        if (!selectedSemana) return;
        setRepricingProcessing(true);
        setRepricingPreview(null);
        setError('');
        try {
            // 1. Pedido_items mayoristas de esta semana (no terminales)
            const { data: pedidosData } = await supabase
                .from('pedidos').select('id, vendedor_id')
                .eq('semana_id', selectedSemana).eq('tipo', 'mayorista');
            const pedidoIds = (pedidosData || []).map(p => p.id);

            const { data: mayoristaItems } = pedidoIds.length > 0
                ? await supabase.from('pedido_items')
                    .select('id, titulo, precio, catalog_id, estado')
                    .in('pedido_id', pedidoIds)
                    .not('estado', 'in', '("CANCELADO","EN TIENDA","ENTREGADO","DESPACHADO")')
                : { data: [] };

            // 2. Cliente_items de esta semana (no terminales)
            const { data: clienteItems } = await supabase
                .from('cliente_items')
                .select('id, titulo, precio_venta, catalog_id, estado')
                .eq('semana_id', selectedSemana)
                .not('estado', 'in', '("CANCELADO","EN TIENDA","ENTREGADO","ADJUDICADO")');

            const todosLosItems = [
                ...(mayoristaItems || []).map(it => ({ ...it, _tipo: 'mayorista', _precioActual: it.precio })),
                ...(clienteItems || []).map(it => ({ ...it, _tipo: 'cliente', _precioActual: it.precio_venta })),
            ];

            if (todosLosItems.length === 0) {
                setError('No hay ítems activos en esta semana para recotizar.');
                setRepricingProcessing(false);
                return;
            }

            // 3. Cargar precios actuales del catálogo para esos catalog_ids
            const catalogIds = [...new Set(todosLosItems.map(it => it.catalog_id).filter(Boolean))];
            const { data: catalogData } = catalogIds.length > 0
                ? await supabase.from('catalogo_productos')
                    .select('id, titulo, precio_venta_bs, precio_mayoreo_bs, precio_venta_bs_prox, precio_mayoreo_bs_prox')
                    .in('id', catalogIds)
                : { data: [] };

            const catalogMap = {};
            (catalogData || []).forEach(c => { catalogMap[c.id] = c; });

            // 4. Comparar precio actual del ítem vs precio actualizado del catálogo
            const cambios = {};
            const normalizar = (t) => (t || '').toUpperCase().trim().replace(/\s+/g, ' ');

            let sinCambio = 0, sinCatalogo = 0;

            for (const it of todosLosItems) {
                const cat = catalogMap[it.catalog_id];
                if (!cat) { sinCatalogo++; continue; }

                const precioViejo = parseFloat(it._precioActual) || 0;
                // Mayorista usa precio_mayoreo_bs, cliente usa precio_venta_bs
                // Usar precio próximo si existe, sino precio activo
                const precioNuevo = it._tipo === 'mayorista'
                    ? parseFloat(cat.precio_mayoreo_bs_prox || cat.precio_mayoreo_bs) || 0
                    : parseFloat(cat.precio_venta_bs_prox || cat.precio_venta_bs) || 0;

                if (Math.abs(precioNuevo - precioViejo) <= 0.01) { sinCambio++; continue; }

                const key = normalizar(it.titulo);
                if (!cambios[key]) {
                    cambios[key] = {
                        titulo: it.titulo,
                        precio_viejo: precioViejo,
                        precio_nuevo: precioNuevo,
                        diff: precioNuevo - precioViejo,
                        items_mayorista: [],
                        items_cliente: [],
                    };
                }
                if (it._tipo === 'mayorista') cambios[key].items_mayorista.push(it.id);
                else cambios[key].items_cliente.push(it.id);
            }

            const cambiosArray = Object.values(cambios);
            setRepricingPreview({
                cambios: cambiosArray,
                sinCambio,
                sinCatalogo,
                totalItems: todosLosItems.length,
            });
            // Pre-seleccionar todos por defecto
            setRepricingSeleccion(new Set(cambiosArray.map(c => c.titulo)));
        } catch (err) {
            setError('Error al leer catálogo: ' + err.message);
        } finally {
            setRepricingProcessing(false);
        }
    };

    // ── REPRICING: aplicar cambios de precios en BD ───────────────────────────
    const handleConfirmRepricing = async () => {
        const cambiosAplicar = repricingPreview.cambios.filter(c => repricingSeleccion.has(c.titulo));
        if (!repricingPreview || cambiosAplicar.length === 0) return;
        if (!confirm(`¿Confirmar repricing en ${cambiosAplicar.length} título(s) seleccionados?`)) return;
        setRepricingProcessing(true);
        setRepricingSuccess('');
        try {
            let totalActualizados = 0;

            for (const cambio of cambiosAplicar) {
                // Actualizar pedido_items (mayoristas)
                if (cambio.items_mayorista.length > 0) {
                    await supabase.from('pedido_items')
                        .update({
                            precio_original: cambio.precio_viejo,
                            precio: cambio.precio_nuevo,
                            estado: 'RECOTIZAR',
                        })
                        .in('id', cambio.items_mayorista);
                    totalActualizados += cambio.items_mayorista.length;
                }
                // Actualizar cliente_items (retail)
                if (cambio.items_cliente.length > 0) {
                    await supabase.from('cliente_items')
                        .update({
                            precio_original: cambio.precio_viejo,
                            precio_venta: cambio.precio_nuevo,
                            estado: 'RECOTIZAR',
                        })
                        .in('id', cambio.items_cliente);
                    totalActualizados += cambio.items_cliente.length;
                }
            }

            // Marcar la semana como en repricing
            await supabase.from('semanas')
                .update({ en_reprecio: true })
                .eq('id', selectedSemana);

            setRepricingSuccess(`✓ Repricing aplicado: ${cambiosAplicar.length} títulos, ${totalActualizados} ítems actualizados a RECOTIZAR.`);
            setRepricingPreview(null);
            fetchSemanas();
        } catch (err) {
            setError('Error al aplicar repricing: ' + err.message);
        } finally {
            setRepricingProcessing(false);
        }
    };

    // ── Activar precios próximos: copia _prox → activo en todo el catálogo ───
    const handleActivarPreciosProximos = async () => {
        if (!confirm('¿Activar los precios próximos? Esto reemplazará los precios activos del catálogo con los precios próximos y no se puede deshacer.')) return;
        setProcessing(true);
        setError('');
        try {
            // Leer todos los productos que tienen precio próximo definido
            let allProx = [], from = 0;
            while (true) {
                const { data, error } = await supabase
                    .from('catalogo_productos')
                    .select('id, precio_venta_bs_prox, precio_mayoreo_bs_prox')
                    .not('precio_mayoreo_bs_prox', 'is', null)
                    .range(from, from + 999);
                if (error) throw error;
                if (!data || data.length === 0) break;
                allProx = [...allProx, ...data];
                if (data.length < 1000) break;
                from += 1000;
            }

            if (allProx.length === 0) {
                setError('No hay precios próximos guardados en el catálogo.');
                setProcessing(false);
                return;
            }

            // Actualizar en chunks: precio activo = precio próximo, limpiar _prox
            const chunkSize = 500;
            for (let i = 0; i < allProx.length; i += chunkSize) {
                const chunk = allProx.slice(i, i + chunkSize).map(p => ({
                    id: p.id,
                    precio_venta_bs:        p.precio_venta_bs_prox,
                    precio_mayoreo_bs:      p.precio_mayoreo_bs_prox,
                    precio_venta_bs_prox:   null,
                    precio_mayoreo_bs_prox: null,
                    updated_at: new Date(),
                }));
                const { error: updErr } = await supabase
                    .from('catalogo_productos')
                    .upsert(chunk, { onConflict: 'id' });
                if (updErr) throw updErr;
            }

            window.dispatchEvent(new CustomEvent('catalog-prices-updated'));
            setSuccess(`✓ Precios activados: ${allProx.length} productos actualizados.`);
        } catch (err) {
            setError('Error al activar precios: ' + err.message);
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <div className="p-8 text-center animate-pulse"><Loader2 size={24} className="mx-auto animate-spin mb-4" /> Cargando...</div>;

    return (
        <div className="space-y-8 max-w-5xl mx-auto">
            <VerificadorConfirmaciones />
            {/* Cabecera */}
            <div className="bg-white p-6 rounded-2xl border border-border/40 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h3 className="text-xl font-bold text-navy flex items-center gap-2">
                        <Database className="text-accent" /> Base Maestro Maestranza
                    </h3>
                    <p className="text-sm text-sky mt-1 font-medium">Sincroniza tus preventas con la realidad del stock.</p>
                </div>

                {/* Botón Activar Precios Próximos */}
                <button
                    onClick={handleActivarPreciosProximos}
                    disabled={processing}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-black text-xs px-5 py-3 rounded-xl transition-all shadow-lg shadow-amber-500/20 whitespace-nowrap"
                    title="Copia los precios próximos al catálogo activo"
                >
                    {processing ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
                    Activar Precios Próximos
                </button>

                <div className="w-full md:w-64">
                    <label className="text-[10px] uppercase font-bold text-sky tracking-widest block mb-1">Semana Destino</label>
                    <select
                        value={selectedSemana}
                        onChange={(e) => setSelectedSemana(e.target.value)}
                        className="w-full px-4 py-2 border border-border/40 rounded-xl text-sm font-bold bg-background focus:ring-2 focus:ring-accent outline-none appearance-none"
                    >
                        <option value="">-- Seleccionar Semana --</option>
                        {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre} {!s.abierta ? '🔒' : ''}</option>)}
                    </select>
                </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in"><AlertCircle size={16} /> {error}</div>}
            {success && <div className="p-4 bg-green-50 text-green-600 border border-green-200 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in"><CheckCircle2 size={16} /> {success}</div>}

            {/* Dropzone */}
            {selectedSemana && !existingMaster && !previewData && (
                <div {...getRootProps()} className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer ${isDragActive ? 'border-accent bg-accent/5' : 'border-border/60 bg-white hover:border-sky/50'}`}>
                    <input {...getInputProps()} />
                    <Upload size={48} className="mx-auto mb-4 text-sky" />
                    <h4 className="text-lg font-bold text-navy">Carga el Excel de Confirmación aquí</h4>
                    <p className="text-sm text-muted">Asegúrate de que la primera columna sea el Título.</p>
                </div>
            )}

            {/* Opción: marcar el pedido como CANCELADO (todo recortado) */}
            {selectedSemana && !existingMaster && !previewData && (
                <div className="flex flex-wrap items-center justify-center gap-3 -mt-3">
                    <span className="text-xs text-muted font-medium">¿Este pedido se canceló y no vas a recibir nada?</span>
                    <button
                        onClick={handleCancelarPedido}
                        disabled={processing}
                        className="flex items-center gap-2 bg-red-50 hover:bg-red-100 disabled:opacity-40 text-red-600 font-black text-xs px-4 py-2 rounded-xl border border-red-200 transition-all"
                        title="Marca todos los títulos como recortados y deja de buscar confirmación"
                    >
                        {processing ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                        Marcar Pedido como Cancelado
                    </button>
                </div>
            )}

            {/* Existing Master State */}
            {existingMaster && (
                <div className="bg-green-50 border border-green-200 rounded-3xl p-8 flex items-center justify-between shadow-sm">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 text-green-700 font-bold mb-1"><CheckCircle2 size={24} /> Base Maestro Activada</div>
                        <p className="text-sm text-green-700/80">Stock constatado y deudas generadas para Gestión Integral.</p>
                        
                        <div className="mt-4 flex items-center gap-2">
                             {isEditingTitle ? (
                                <div className="flex items-center gap-1">
                                    <input type="text" value={newTitleValue} onChange={e => setNewTitleValue(e.target.value)} className="px-2 py-1 border rounded text-xs" />
                                    <button onClick={handleUpdateTitle} className="p-1 text-green-600"><Check size={14} /></button>
                                </div>
                             ) : (
                                <div className="flex items-center gap-2">
                                    <span className="text-navy font-bold text-lg">{existingMaster.titulo_despacho}</span>
                                    <button onClick={() => { setNewTitleValue(existingMaster.titulo_despacho); setIsEditingTitle(true); }} className="text-green-600 hover:text-green-800"><Edit2 size={14} /></button>
                                </div>
                             )}
                        </div>
                        <p className="text-xs font-mono text-green-800 mt-2 tracking-wider">MODO: CRUCE UNIVERSAL ACTIVADO</p>
                    </div>

                    <div className="flex flex-col gap-3 ml-4">
                        <button
                            onClick={() => syncOrdersWithMaster(selectedSemana, existingMaster.datos_json)}
                            disabled={processing}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-accent text-navy rounded-xl font-bold text-xs hover:bg-accent/80 transition-all shadow-md min-w-[180px]"
                        >
                            {processing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Sincronizar Pedidos
                        </button>
                        <button
                            onClick={handleDeleteMaster}
                            className="text-xs text-red-500 font-bold uppercase hover:underline text-center"
                        >
                            Eliminar Master
                        </button>
                    </div>
                </div>
            )}

            {/* Preview and Save */}
            {previewData && (
                <div className="bg-white rounded-3xl border border-border/40 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="bg-navy p-6 text-white flex justify-between items-center">
                        <div>
                            <h4 className="font-bold flex items-center gap-2">Confirmación Analizada</h4>
                            <p className="text-xs text-sky/60 mt-1 uppercase tracking-tighter">Verifica y cruza datos con las preventas</p>
                        </div>
                        <button onClick={() => setPreviewData(null)}><X size={20} /></button>
                    </div>

                    <div className="p-8 flex justify-between items-start bg-[#f8f9fa] border-b gap-6">
                        <div className="flex-1">
                            {/* Desglose financiero */}
                            <div className="flex items-center gap-6 flex-wrap mb-3">
                                <div>
                                    <p className="text-[9px] uppercase font-black text-sky tracking-widest mb-0.5">Productos ({previewData.items.length} títulos)</p>
                                    <p className="text-lg font-bold text-navy font-mono">ARS {previewData.totalProductos.toLocaleString()}</p>
                                </div>
                                {previewData.costoEnvio > 0 && (
                                    <>
                                        <span className="text-sky font-black text-xl">+</span>
                                        <div>
                                            <p className="text-[9px] uppercase font-black text-sky tracking-widest mb-0.5">{previewData.envioTexto || 'Envío'}</p>
                                            <p className="text-lg font-bold text-navy font-mono">ARS {previewData.costoEnvio.toLocaleString()}</p>
                                        </div>
                                        <span className="text-sky font-black text-xl">=</span>
                                    </>
                                )}
                                <div>
                                    <p className="text-[9px] uppercase font-black text-sky tracking-widest mb-0.5">Total a Pagar</p>
                                    <p className="text-3xl font-black text-navy font-display uppercase italic">ARS {previewData.totalArs.toLocaleString()}</p>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={handleSaveMaster}
                            disabled={processing}
                            className="bg-accent text-navy px-10 py-4 rounded-2xl font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-lg flex items-center gap-2 shrink-0"
                        >
                            {processing ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                            CONFIRMAR TODO
                        </button>
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-[#f8f9fa] sticky top-0 border-b">
                                <tr>
                                    <th className="p-4 font-bold text-sky">Título Producto</th>
                                    <th className="p-4 text-right">Cant.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {previewData.items.map((it, idx) => (
                                    <tr key={idx} className="hover:bg-accent/5">
                                        <td className="p-4 font-medium text-navy uppercase text-[10px]">{it.titulo}</td>
                                        <td className="p-4 text-right font-black text-navy">{it.cantidad}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ── SECCIÓN REPRICING ─────────────────────────────────────── */}
            {selectedSemana && (
                <div className="border-2 border-dashed border-orange-300 rounded-3xl overflow-hidden">
                    <button
                        onClick={() => { setShowRepricing(v => !v); setRepricingPreview(null); setRepricingSuccess(''); }}
                        className="w-full flex items-center justify-between px-8 py-5 bg-orange-50 hover:bg-orange-100 transition-colors"
                    >
                        <div className="flex items-center gap-3">
                            <TrendingUp size={20} className="text-orange-500" />
                            <div className="text-left">
                                <p className="font-black text-orange-700 text-sm uppercase tracking-wide">Actualización de Precios (Repricing)</p>
                                <p className="text-[10px] text-orange-500 mt-0.5">La editorial canceló el pedido y cambió precios — subí el nuevo Excel</p>
                            </div>
                        </div>
                        <span className="text-orange-400 font-black text-lg">{showRepricing ? '▲' : '▼'}</span>
                    </button>

                    {showRepricing && (
                        <div className="p-8 space-y-6 bg-white">
                            {/* Alerta informativa */}
                            <div className="bg-orange-50 border border-orange-200 rounded-2xl px-5 py-4 text-sm text-orange-700">
                                <p className="font-black mb-1">¿Qué hace esto?</p>
                                <ul className="text-[11px] space-y-1 list-disc list-inside text-orange-600">
                                    <li>Compara los nuevos precios del Excel contra los precios actuales de esa semana</li>
                                    <li>Solo modifica ítems de <strong>la semana seleccionada</strong> — el resto no se toca</li>
                                    <li>Cambia estado a <strong>RECOTIZAR</strong> para que veas quién debe decidir</li>
                                    <li>Guarda el precio original para referencia</li>
                                </ul>
                            </div>

                            {repricingSuccess && (
                                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3 text-emerald-700 font-bold text-sm">
                                    {repricingSuccess}
                                </div>
                            )}

                            {/* Botón para leer precios del catálogo */}
                            {!repricingPreview && (
                                <div className="flex flex-col items-center gap-4 py-6">
                                    <div className="bg-orange-50 border border-orange-100 rounded-2xl px-5 py-3 text-[11px] text-orange-600 text-center max-w-md">
                                        <p className="font-black mb-1">Antes de continuar:</p>
                                        <p>1. Subí el nuevo Excel en <strong>Gestión de Semanas</strong></p>
                                        <p>2. Actualizá los precios en <strong>Análisis de Precios</strong></p>
                                        <p>3. Volvé acá y presioná el botón</p>
                                    </div>
                                    <button
                                        onClick={loadRepricingFromCatalog}
                                        disabled={repricingProcessing}
                                        className="flex items-center gap-3 bg-orange-500 hover:bg-orange-600 text-white font-black px-8 py-4 rounded-2xl text-sm transition-all shadow-lg shadow-orange-500/20 disabled:opacity-40"
                                    >
                                        {repricingProcessing
                                            ? <><Loader2 size={18} className="animate-spin" /> Leyendo catálogo...</>
                                            : <><DollarSign size={18} /> Leer precios del catálogo actualizado</>
                                        }
                                    </button>
                                </div>
                            )}

                            {/* Preview de cambios */}
                            {repricingPreview && (
                                <div className="space-y-4">
                                    <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-[11px] text-amber-700">
                                        ⚠️ <strong>Revisá la lista</strong> — si un ítem muestra aumento pero no fue la editorial (ej: tenía descuento comercial), <strong>desmarcalo</strong> para excluirlo del repricing.
                                    </div>

                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="font-black text-navy text-sm">
                                                {repricingPreview.cambios.length} título(s) detectados · <span className="text-orange-500">{repricingSeleccion.size} seleccionados</span>
                                            </p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                                {repricingPreview.sinCambio} sin cambio · {repricingPreview.totalItems} ítems analizados
                                                {repricingPreview.sinCatalogo > 0 && ` · ${repricingPreview.sinCatalogo} sin catalog_id`}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => {
                                                    if (repricingSeleccion.size === repricingPreview.cambios.length) {
                                                        setRepricingSeleccion(new Set());
                                                    } else {
                                                        setRepricingSeleccion(new Set(repricingPreview.cambios.map(c => c.titulo)));
                                                    }
                                                }}
                                                className="text-[10px] font-black text-orange-500 hover:text-orange-700 border border-orange-200 px-2 py-1 rounded-lg transition-colors"
                                            >
                                                {repricingSeleccion.size === repricingPreview.cambios.length ? 'Desmarcar todo' : 'Marcar todo'}
                                            </button>
                                            <button onClick={() => setRepricingPreview(null)} className="text-slate-400 hover:text-navy transition-colors"><X size={18} /></button>
                                        </div>
                                    </div>

                                    {repricingPreview.cambios.length === 0 ? (
                                        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 text-emerald-700 font-bold text-sm text-center">
                                            ✓ No hay cambios de precio — todos los títulos tienen el mismo precio
                                        </div>
                                    ) : (
                                        <>
                                            <div className="rounded-2xl border border-orange-200 overflow-hidden">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-orange-50">
                                                        <tr className="text-[9px] font-black text-orange-500 uppercase tracking-widest">
                                                            <th className="px-3 py-3 text-center w-8">✓</th>
                                                            <th className="px-4 py-3 text-left">Título</th>
                                                            <th className="px-4 py-3 text-right">Precio viejo</th>
                                                            <th className="px-4 py-3 text-right">Precio nuevo</th>
                                                            <th className="px-4 py-3 text-right">Diferencia</th>
                                                            <th className="px-4 py-3 text-center">Ítems afectados</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-orange-100">
                                                        {repricingPreview.cambios.map((c, i) => {
                                                            const seleccionado = repricingSeleccion.has(c.titulo);
                                                            return (
                                                            <tr key={i}
                                                                onClick={() => {
                                                                    const next = new Set(repricingSeleccion);
                                                                    if (next.has(c.titulo)) next.delete(c.titulo);
                                                                    else next.add(c.titulo);
                                                                    setRepricingSeleccion(next);
                                                                }}
                                                                className={`cursor-pointer transition-colors ${seleccionado ? 'hover:bg-orange-50/50' : 'opacity-40 bg-slate-50 hover:opacity-60'}`}
                                                            >
                                                                <td className="px-3 py-3 text-center">
                                                                    <div className={`w-4 h-4 rounded border-2 mx-auto flex items-center justify-center transition-all ${seleccionado ? 'bg-orange-500 border-orange-500' : 'border-slate-300'}`}>
                                                                        {seleccionado && <Check size={10} className="text-white" />}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 font-bold text-navy">{c.titulo}</td>
                                                                <td className="px-4 py-3 text-right text-slate-400 line-through">Bs {c.precio_viejo.toFixed(2)}</td>
                                                                <td className="px-4 py-3 text-right font-black text-navy">Bs {c.precio_nuevo.toFixed(2)}</td>
                                                                <td className={`px-4 py-3 text-right font-black ${c.diff > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                                                                    {c.diff > 0 ? '+' : ''}Bs {c.diff.toFixed(2)}
                                                                </td>
                                                                <td className="px-4 py-3 text-center text-slate-500">
                                                                    {c.items_mayorista.length + c.items_cliente.length} ítem(s)
                                                                    {c.items_mayorista.length > 0 && <span className="ml-1 text-[8px] text-blue-400">({c.items_mayorista.length} may.)</span>}
                                                                    {c.items_cliente.length > 0 && <span className="ml-1 text-[8px] text-purple-400">({c.items_cliente.length} cli.)</span>}
                                                                </td>
                                                            </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>

                                            <div className="flex gap-3">
                                                <button
                                                    onClick={() => setRepricingPreview(null)}
                                                    className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 text-slate-500 font-black text-sm hover:bg-slate-50 transition-all"
                                                >Cancelar</button>
                                                <button
                                                    onClick={handleConfirmRepricing}
                                                    disabled={repricingProcessing}
                                                    className="flex-1 px-4 py-3 rounded-2xl bg-orange-500 text-white font-black text-sm hover:bg-orange-600 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
                                                >
                                                    {repricingProcessing
                                                        ? <><Loader2 size={16} className="animate-spin" /> Aplicando...</>
                                                        : <><TrendingUp size={16} /> Confirmar Repricing ({repricingSeleccion.size} títulos)</>
                                                    }
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
