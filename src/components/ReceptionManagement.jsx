import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import {
    Package, CheckCircle2, AlertCircle, Search,
    ChevronRight, ChevronDown, Save, Loader2,
    Users, Info, Truck, ShieldAlert, Trash2
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

// Normaliza títulos para matching robusto: minúsculas, sin espacios extra internos ni bordes
const normalizeTitle = (str) => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();

export default function ReceptionManagement() {
    const [semanas, setSemanas] = useState([]);
    const [selectedSemana, setSelectedSemana] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [masterItems, setMasterItems] = useState([]);
    const [orderBreakdown, setOrderBreakdown] = useState({});
    const [receivedCounts, setReceivedCounts] = useState({});
    const [alreadyReceived, setAlreadyReceived] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [vendorFilter, setVendorFilter] = useState('');
    const [hideComplete, setHideComplete] = useState(false);
    const [skipStockUpdate, setSkipStockUpdate] = useState(false);
    const [clientItems, setClientItems] = useState([]);
    const [showVerify, setShowVerify] = useState(false);
    const [verifyData, setVerifyData] = useState([]);
    const [verifyLoading, setVerifyLoading] = useState(false);
    const [showDiag, setShowDiag] = useState(false);
    const [diagData, setDiagData] = useState([]);
    const [diagLoading, setDiagLoading] = useState(false);
    const [diagCatalogCount, setDiagCatalogCount] = useState(null);
    const [vendedoresList, setVendedoresList] = useState([]);
    const { isAdmin, isSocio } = useAuth();

    useEffect(() => {
        fetchSemanas();
    }, []);

    useEffect(() => {
        if (selectedSemana) {
            fetchReceptionData(selectedSemana);
        } else {
            setMasterItems([]);
            setOrderBreakdown({});
        }
    }, [selectedSemana]);

    const fetchSemanas = async () => {
        const { data: semData } = await supabase
            .from('semanas')
            .select('*')
            .order('created_at', { ascending: false });
        if (semData) setSemanas(semData);

        const { data: vendData } = await supabase
            .from('vendedores')
            .select('id, nombre');
        if (vendData) setVendedoresList(vendData);
    };

    const fetchReceptionData = async (semanaId) => {
        setLoading(true);
        try {
            // Obtener nombre de la semana para buscar por estado (CONFIRMADO {semana})
            const semanaName = semanas.find(s => s.id === semanaId)?.nombre || '';

            // Todas las queries en paralelo
            const [masterRes, ordersRes, receptionRes, cItemsByIdRes, cItemsConfirmadosRes, vendRes] = await Promise.all([
                supabase.from('master_confirmaciones').select('*').eq('semana_id', semanaId).maybeSingle(),
                supabase.from('pedido_items').select('*, pedido:pedidos!inner(vendedor_nombre, tipo)').eq('pedido.semana_id', semanaId),
                supabase.from('pedido_items_recepcion').select('*').eq('semana_id', semanaId),
                // Por semana_id (items ADJUDICADO asignados a esta semana)
                supabase.from('cliente_items').select('*, clientes(nombre, vendedor_id)').eq('semana_id', semanaId),
                // Todos los CONFIRMADO (filtramos por semana en JS para evitar problemas de acentos en ILIKE)
                supabase.from('cliente_items').select('*, clientes(nombre, vendedor_id)').ilike('estado', 'CONFIRMADO%'),
                supabase.from('vendedores').select('id, nombre'),
            ]);
            const master = masterRes.data;
            const orders = ordersRes.data;
            const currentReception = receptionRes.data;
            const vList = vendRes.data || [];
            setVendedoresList(vList);

            // Filtrar CONFIRMADO por semana en JS (maneja acentos correctamente)
            const semanaNameLower = semanaName.toLowerCase();
            const confirmadosDeSemana = (cItemsConfirmadosRes.data || []).filter(ci => {
                if (!semanaName) return false;
                const suffix = ci.estado.slice('CONFIRMADO '.length).trim().toLowerCase();
                return suffix === semanaNameLower || suffix.startsWith(semanaNameLower);
            });

            // Combinar y deduplicar clientItems (semana_id + CONFIRMADO de esta semana)
            const seenIds = new Set();
            const cItems = [...(cItemsByIdRes.data || []), ...confirmadosDeSemana].filter(ci => {
                if (seenIds.has(ci.id)) return false;
                seenIds.add(ci.id);
                return true;
            });

            // Index current reception
            const receptionMap = {};
            (currentReception || []).forEach(r => {
                const key = normalizeTitle(r.titulo);
                receptionMap[key] = (receptionMap[key] || 0) + r.cantidad_recibida;
            });

            // Auto-heal: si hay ítems ya recibidos pero sus cliente_items siguen en CONFIRMADO/ADJUDICADO,
            // actualizarlos a EN TIENDA (corrige recepciones anteriores hechas con código buggy)
            if (Object.keys(receptionMap).length > 0 && cItems.length > 0) {
                const toHeal = [];
                const healCount = {};
                for (const ci of cItems) {
                    const key = normalizeTitle(ci.titulo);
                    const received = receptionMap[key] || 0;
                    if (received > 0 && (ci.estado === 'ADJUDICADO' || ci.estado.startsWith('CONFIRMADO'))) {
                        const already = healCount[key] || 0;
                        if (already < received) {
                            toHeal.push(ci.id);
                            healCount[key] = already + 1;
                        }
                    }
                }
                if (toHeal.length > 0) {
                    console.log(`🔧 Auto-heal: marcando ${toHeal.length} cliente_items como EN TIENDA. IDs: ${toHeal.join(', ')}`); // FIX BUG #6: logging
                    await supabase.from('cliente_items').update({ estado: 'EN TIENDA' }).in('id', toHeal);
                    // Re-fetch cItems frescos después del heal
                    const [healed1, healed2] = await Promise.all([
                        supabase.from('cliente_items').select('*, clientes(nombre, vendedor_id)').eq('semana_id', semanaId),
                        semanaName
                            ? supabase.from('cliente_items').select('*, clientes(nombre, vendedor_id)').ilike('estado', `CONFIRMADO ${semanaName}%`)
                            : Promise.resolve({ data: [] }),
                    ]);
                    const seenIds2 = new Set();
                    const cItemsHealed = [...(healed1.data || []), ...(healed2.data || [])].filter(ci => {
                        if (seenIds2.has(ci.id)) return false;
                        seenIds2.add(ci.id);
                        return true;
                    });
                    setClientItems(cItemsHealed);
                } else {
                    setClientItems(cItems);
                }
            } else {
                setClientItems(cItems);
            }

            if (master && master.datos_json) {
                setMasterItems(master.datos_json);
                setAlreadyReceived(receptionMap);
                setReceivedCounts({});
            } else {
                setMasterItems([]);
                setAlreadyReceived({});
            }

            // Build breakdown
            const breakdown = {};
            // 1. Semanas / Pedidos directos
            (orders || []).forEach(item => {
                const key = normalizeTitle(item.titulo);
                if (!breakdown[key]) breakdown[key] = [];
                breakdown[key].push({
                    vendedor: item.pedido.vendedor_nombre,
                    cantidad: item.cantidad,
                    tipo: item.pedido.tipo
                });
            });
            // 2. Pedidos de Clientes (Manuales/Reservas)
            cItems.forEach(ci => {
                const key = normalizeTitle(ci.titulo);
                if (!breakdown[key]) breakdown[key] = [];
                
                // Buscar nombre del vendedor
                const vendName = vList.find(v => v.id === ci.clientes?.vendedor_id)?.nombre || 'Desconocido';
                
                breakdown[key].push({
                    vendedor: vendName,
                    cantidad: 1, // Cada registro en cliente_items es una unidad
                    tipo: 'cliente'
                });
            });

            setOrderBreakdown(breakdown);

        } catch (err) {
            console.error("Error fetching reception data:", err);
        } finally {
            setLoading(false);
        }
    };

    const allVendors = useMemo(() => {
        const vendors = new Set();
        Object.values(orderBreakdown).forEach(arr => {
            arr.forEach(item => {
                if (item.tipo === 'tienda') {
                    vendors.add('Tienda');
                } else if (item.vendedor) {
                    vendors.add(item.vendedor);
                }
            });
        });
        return Array.from(vendors).sort();
    }, [orderBreakdown]);

    const dashboardStats = useMemo(() => {
        if (!selectedSemana || masterItems.length === 0) return null;
        
        const stats = {
            tienda: 0,
            clientes: 0,
            total: 0,
            porVendedor: {}
        };

        Object.values(orderBreakdown).forEach(arr => {
            arr.forEach(item => {
                const qty = item.cantidad || 0;
                stats.total += qty;
                if (item.tipo === 'tienda') {
                    stats.tienda += qty;
                } else {
                    stats.clientes += qty;
                    const vName = item.vendedor || 'Socio';
                    stats.porVendedor[vName] = (stats.porVendedor[vName] || 0) + qty;
                }
            });
        });

        return stats;
    }, [orderBreakdown, selectedSemana, masterItems]);

    const filteredItems = useMemo(() => {
        let result = masterItems;

        if (searchTerm) {
            result = result.filter(it =>
                it.titulo.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        if (vendorFilter) {
            result = result.filter(it => {
                const key = normalizeTitle(it.titulo);
                const bd = orderBreakdown[key] || [];
                if (vendorFilter === 'Tienda') {
                    return bd.some(b => b.tipo === 'tienda');
                }
                return bd.some(b => b.vendedor === vendorFilter);
            });
        }

        if (hideComplete) {
            result = result.filter(it => {
                const key = normalizeTitle(it.titulo);
                const prevRec = alreadyReceived[key] || 0;
                const inputVal = receivedCounts[key] || '';
                const confirmedQty = it.cantidad || 0;
                const totalNum = prevRec + (parseInt(inputVal) || 0);
                const missingQty = Math.max(0, confirmedQty - totalNum);
                return missingQty > 0;
            });
        }

        return result;
    }, [masterItems, searchTerm, vendorFilter, hideComplete, receivedCounts, orderBreakdown, alreadyReceived]);

    const handleQuantityChange = (key, val, confirmedQty, prevReceived) => {
        if (val === '') {
            setReceivedCounts({ ...receivedCounts, [key]: '' });
            return;
        }

        const numVal = parseInt(val);
        if (isNaN(numVal)) return;

        const maxAllowed = Math.max(0, confirmedQty - prevReceived);

        if (numVal > maxAllowed) {
            const extra = numVal - maxAllowed;
            const message = `⚠️ ATENCIÓN: EXCESO DE UNIDADES ⚠️\n\n` +
                `Título: ${key.toUpperCase()}\n` +
                `Confirmados (Pendientes): ${maxAllowed}\n` +
                `Ingresando: ${numVal}\n\n` +
                `¿Estás SEGURO de que quieres recibir ${extra} unidades MÁS de lo que el proveedor confirmó?`;

            if (window.confirm(message)) {
                setReceivedCounts({ ...receivedCounts, [key]: numVal.toString() });
            } else {
                // Si cancela, volvemos al máximo sugerido (o lo que ya tenía si era válido)
                setReceivedCounts({ ...receivedCounts, [key]: maxAllowed.toString() });
            }
        } else {
            setReceivedCounts({ ...receivedCounts, [key]: numVal.toString() });
        }
    };

    const handleCancelReception = async () => {
        if (!selectedSemana) return;
        if (!isAdmin && !isSocio) return;

        const weekName = semanas.find(s => s.id === selectedSemana)?.nombre || 'esta semana';

        const firstConfirm = window.confirm(`⚠️ ¿ESTÁS SEGURO? Se borrará TODO el historial de recepción de:\n\n"${weekName}"\n\nEsto te permitirá empezar de nuevo la recepción desde cero.`);
        if (!firstConfirm) return;

        const secondConfirm = window.confirm(`❗ ÚLTIMA ADVERTENCIA: Esta acción es irreversible.\n¿Confirmas que quieres BORRAR TODO lo recibido hoy para esta semana?`);
        if (!secondConfirm) return;

        setSaving(true);
        try {
            // 1. Leer el delta de stock guardado al hacer la recepción
            const { data: deltaRow } = await supabase.from('app_state')
                .select('data').eq('id', `reception_delta_${selectedSemana}`).maybeSingle();
            const savedDeltas = deltaRow?.data || {};

            // 2. Revertir stock exactamente (usando el delta guardado, no cantidad_recibida)
            const prodIds = Object.keys(savedDeltas);
            if (prodIds.length > 0) {
                const { data: prods, error: prodErr } = await supabase
                    .from('catalogo_productos')
                    .select('id, stock_fisico, titulo')
                    .in('id', prodIds);
                if (prodErr) throw prodErr;

                const semanaNameCancel = semanas.find(s => s.id === selectedSemana)?.nombre || '';

                // Borrar los registros RECEPCIÓN de esta semana del historial (audit trail limpio para re-recepcionar)
                if (semanaNameCancel) {
                    await supabase.from('stock_movimientos')
                        .delete()
                        .eq('motivo', 'RECEPCIÓN')
                        .eq('detalle', semanaNameCancel);
                }

                for (const prod of (prods || [])) {
                    const delta = savedDeltas[prod.id] || 0;
                    const newStock = Math.max(0, (prod.stock_fisico || 0) - delta);
                    await supabase.from('catalogo_productos')
                        .update({ stock_fisico: newStock, updated_at: new Date().toISOString() })
                        .eq('id', prod.id);
                }
                catalogService.patchStockInCache((prods || []).map(p => ({ id: p.id, delta: -(savedDeltas[p.id] || 0) })));

                // Eliminar el registro de delta
                await supabase.from('app_state').delete().eq('id', `reception_delta_${selectedSemana}`);
            }

            // 3. Borrar registros de recepción
            const { error: delError } = await supabase
                .from('pedido_items_recepcion')
                .delete()
                .eq('semana_id', selectedSemana);
            if (delError) throw delError;

            // 4. Resetear estados de cliente_items de esa semana (EN TIENDA → ADJUDICADO)
            const { error: updError } = await supabase
                .from('cliente_items')
                .update({ estado: 'ADJUDICADO' })
                .eq('semana_id', selectedSemana)
                .eq('estado', 'EN TIENDA');
            if (updError) throw updError;

            // FIX BUG #5: También revertir items que llegaron por estado CONFIRMADO {semana}
            // (pueden tener semana_id diferente al seleccionado y no se revirtieron arriba)
            const semanaNameForCancel = semanas.find(s => s.id === selectedSemana)?.nombre || '';
            if (semanaNameForCancel) {
                const { data: confirmadosEnTienda } = await supabase
                    .from('cliente_items')
                    .select('id, semana_id, estado')
                    .ilike('estado', `CONFIRMADO ${semanaNameForCancel}%`);
                const extraIds = (confirmadosEnTienda || [])
                    .filter(ci => ci.semana_id !== selectedSemana && ci.estado === 'EN TIENDA')
                    .map(ci => ci.id);
                if (extraIds.length > 0) {
                    await supabase.from('cliente_items')
                        .update({ estado: 'ADJUDICADO' })
                        .in('id', extraIds);
                }
            }

            const stockMsg = prodIds.length > 0 ? ' El stock fue revertido.' : ' (No había delta de stock guardado — revisá el stock manualmente.)';
            alert(`✅ Recepción reiniciada.${stockMsg} Podés volver a procesarla.`);
            setReceivedCounts({});
            fetchReceptionData(selectedSemana);
        } catch (err) {
            console.error("Error al cancelar recepción:", err);
            alert("❌ Error al cancelar: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const performReceptionUpdates = async (itemsToSave) => {
        if (skipStockUpdate) return { missingFromCatalog: [] };

        const allProds = await catalogService.fetchFullCatalog(true);
        const prodMap = {};
        allProds.forEach(p => { prodMap[normalizeTitle(p.titulo)] = p; });
        const idToKey = {};
        allProds.forEach(p => { idToKey[p.id] = normalizeTitle(p.titulo); });

        const allPreAllocatedIds = [];
        const stockDeltas = {};
        const missingFromCatalog = [];

        for (const item of itemsToSave) {
            const key = normalizeTitle(item.titulo);
            const qtyRec = item.cantidad_recibida;

            const breakdown = orderBreakdown[key] || [];
            const tiendaOrdered = breakdown.filter(b => b.tipo === 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);
            const totalVendorOrdered = breakdown.filter(b => b.tipo !== 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);

            let calcForStore = Math.min(tiendaOrdered, qtyRec);
            if (calcForStore < 0) calcForStore = 0;
            const availableForClients = Math.max(0, qtyRec - calcForStore);
            const clientSliceLimit = Math.min(availableForClients, totalVendorOrdered);
            
            const preAllocated = clientItems
                .filter(ci => normalizeTitle(ci.titulo) === key && (ci.estado === 'ADJUDICADO' || ci.estado.startsWith('CONFIRMADO')))
                .slice(0, clientSliceLimit);
            allPreAllocatedIds.push(...preAllocated.map(p => p.id));

            if (calcForStore > 0) {
                const prod = prodMap[key];
                if (prod) {
                    stockDeltas[prod.id] = (stockDeltas[prod.id] || 0) + calcForStore;
                } else {
                    missingFromCatalog.push(item.titulo);
                }
            }
        }

        if (allPreAllocatedIds.length > 0) {
            await supabase.from('cliente_items').update({ estado: 'EN TIENDA' }).in('id', allPreAllocatedIds);
        }

        const stockRows = Object.entries(stockDeltas).map(([id, delta]) => ({
            id,
            stock_fisico: (prodMap[idToKey[id]]?.stock_fisico || 0) + delta,
        }));

        if (stockRows.length > 0) {
            const { error: upsertErr } = await supabase.from('catalogo_productos').upsert(stockRows, { onConflict: 'id' });
            if (upsertErr) throw new Error('Error al actualizar stock: ' + upsertErr.message);
            
            catalogService.patchStockInCache(Object.entries(stockDeltas).map(([id, delta]) => ({ id, delta })));

            const { data: prevDeltaRow } = await supabase.from('app_state').select('data').eq('id', `reception_delta_${selectedSemana}`).maybeSingle();
            const mergedDeltas = { ...(prevDeltaRow?.data || {}) };
            Object.entries(stockDeltas).forEach(([id, delta]) => {
                mergedDeltas[id] = (mergedDeltas[id] || 0) + delta;
            });
            await supabase.from('app_state').upsert({ id: `reception_delta_${selectedSemana}`, data: mergedDeltas });

            const semanaName = semanas.find(s => s.id === selectedSemana)?.nombre || '';
            for (const row of stockRows) {
                await catalogService.logStockMovement({
                    productoId: row.id, titulo: prodMap[idToKey[row.id]]?.titulo || '',
                    delta: stockDeltas[row.id], stockDespues: row.stock_fisico,
                    motivo: 'RECEPCIÓN', detalle: semanaName,
                });
            }
        }

        return { missingFromCatalog };
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const allInputs = Array.from(document.querySelectorAll('input[data-reception-input="true"]'));
            const currentIndex = allInputs.indexOf(e.target);

            setTimeout(() => {
                const newInputs = Array.from(document.querySelectorAll('input[data-reception-input="true"]'));
                let nextIndex = currentIndex + 1;

                const stillInDOM = newInputs.includes(e.target);
                if (!stillInDOM) {
                    nextIndex = currentIndex;
                }

                if (nextIndex < newInputs.length) {
                    newInputs[nextIndex].focus();
                    newInputs[nextIndex].select();
                }
            }, 50);
        }
    };

    const handleSaveReception = async () => {
        const itemsToSave = Object.entries(receivedCounts)
            .filter(([_, qty]) => parseInt(qty) > 0)
            .map(([titleKey, qty]) => {
                const originalItem = masterItems.find(it => normalizeTitle(it.titulo) === titleKey);
                return {
                    semana_id: selectedSemana,
                    titulo: originalItem?.titulo || titleKey.toUpperCase(),
                    cantidad_recibida: parseInt(qty),
                    cantidad_faltante: Math.max(0, (originalItem?.cantidad || 0) - parseInt(qty))
                };
            });

        if (itemsToSave.length === 0) return alert("No hay unidades pendientes para guardar.");

        setSaving(true);
        try {
            const { missingFromCatalog } = await performReceptionUpdates(itemsToSave);

            const { error: insError } = await supabase
                .from('pedido_items_recepcion')
                .insert(itemsToSave);
            if (insError) throw insError;

            const missingMsg = !skipStockUpdate && missingFromCatalog?.length > 0
                ? `\n⚠️ Sin match en catálogo: ${missingFromCatalog.join(', ')}` : '';
            alert(skipStockUpdate ? "✅ Recepción guardada en el historial (sin afectar stock)." : `✅ Recepción guardada con éxito y stock actualizado.${missingMsg}`);
            setReceivedCounts({});
            fetchReceptionData(selectedSemana);
        } catch (err) {
            console.error("Error saving reception:", err);
            alert("Error al guardar: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleFullReception = async () => {
        if (!confirm("¿Deseas marcar TODO el pedido como recibido físicamente? Esto actualizará el stock de todos los títulos confirmados.")) return;

        const itemsToSave = masterItems
            .filter(it => {
                const key = normalizeTitle(it.titulo);
                return (it.cantidad || 0) > (alreadyReceived[key] || 0);
            })
            .map(it => {
                const key = normalizeTitle(it.titulo);
                const prevRec = alreadyReceived[key] || 0;
                return {
                    semana_id: selectedSemana,
                    titulo: it.titulo,
                    cantidad_recibida: (it.cantidad || 0) - prevRec,
                    cantidad_faltante: 0
                };
            });

        if (itemsToSave.length === 0) {
            return alert("✅ Todo ya fue recibido en recepciones parciales previas.");
        }

        setSaving(true);
        try {
            const { missingFromCatalog } = await performReceptionUpdates(itemsToSave);

            const { error: insError } = await supabase
                .from('pedido_items_recepcion')
                .insert(itemsToSave);
            if (insError) throw insError;

            const missingMsgFull = !skipStockUpdate && missingFromCatalog.length > 0
                ? `\n⚠️ Sin match en catálogo: ${missingFromCatalog.join(', ')}` : '';
            alert(skipStockUpdate ? "✅ Pedido archivado sin afectar el stock físico." : `✅ Semana marcada como recibida y stock actualizado.${missingMsgFull}`);
            fetchReceptionData(selectedSemana);
        } catch (err) {
            console.error(err);
            alert("Error al procesar: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleFinalizeCuts = async () => {
        if (!confirm("¿Deseas dar por terminada la recepción de esta semana?\n\nLos pedidos que NO fueron adjudicados se marcarán como 'RECORTADO' para que el vendedor pueda gestionarlos.")) return;

        setSaving(true);
        try {
            // Mark remaining (PEDIDO/CONFIRMADO/ADJUDICADO) items for this week as RECORTADO
            // Using 2-step approach because PEDIDO and CONFIRMADO have semana suffixes (e.g. "CONFIRMADO ENTELEQUIA 15")
            const { data: itemsToMark, error: fetchErr } = await supabase.from('cliente_items')
                .select('id, estado')
                .eq('semana_id', selectedSemana);
            if (fetchErr) throw fetchErr;
            const idsToMark = (itemsToMark || [])
                .filter(ci => ci.estado === 'ADJUDICADO' || ci.estado.startsWith('CONFIRMADO') || ci.estado.startsWith('PEDIDO'))
                .map(ci => ci.id);
            if (idsToMark.length > 0) {
                const { error } = await supabase.from('cliente_items')
                    .update({ estado: 'RECORTADO' })
                    .in('id', idsToMark);
                if (error) throw error;
            }

            alert("✅ Despacho finalizado. Los ítems pendientes ahora figuran como 'RECORTADO'.");
            fetchReceptionData(selectedSemana);
        } catch (err) {
            console.error(err);
            alert("Error: " + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleVerifyStock = async () => {
        if (!selectedSemana || Object.keys(alreadyReceived).length === 0) return;
        setVerifyLoading(true);
        setShowVerify(true);
        try {
            const allProds = await catalogService.fetchFullCatalog(true);
            const prodMap = {};
            allProds.forEach(p => { prodMap[normalizeTitle(p.titulo)] = p; });

            const rows = Object.keys(alreadyReceived).map(key => {
                const prod = prodMap[key];
                const recibido = alreadyReceived[key] || 0;
                const stockActual = prod?.stock_fisico ?? null;
                const stockAntes = stockActual !== null ? stockActual - recibido : null;
                return {
                    titulo: prod?.titulo || key.toUpperCase(),
                    recibido,
                    stockActual,
                    stockAntes,
                    updatedAt: prod?.updated_at,
                };
            }).sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));

            setVerifyData(rows);
        } catch (e) {
            alert('Error al cargar verificación: ' + e.message);
        } finally {
            setVerifyLoading(false);
        }
    };

    const handleDiagnostico = async () => {
        if (!selectedSemana) return;
        setDiagLoading(true);
        setShowDiag(true);
        try {
            const allProds = await catalogService.fetchFullCatalog(true);
            setDiagCatalogCount(allProds.length);
            const prodMap = {};
            allProds.forEach(p => { prodMap[normalizeTitle(p.titulo)] = p; });

            const findNearest = (key) => {
                const words = key.split(/\s+/).filter(w => w.length > 2);
                if (words.length === 0) return null;
                let best = null, bestScore = 0;
                for (const t of Object.keys(prodMap)) {
                    const score = words.filter(w => t.includes(w)).length;
                    if (score > bestScore) { bestScore = score; best = prodMap[t].titulo; }
                }
                return bestScore > 0 ? best : null;
            };

            const rows = masterItems.map(item => {
                const key = normalizeTitle(item.titulo);
                const qtyRec = Number(receivedCounts[key]) || 0;
                const prod = prodMap[key];
                const nearest = !prod ? findNearest(key) : null;

                const breakdown = orderBreakdown[key] || [];
                const tiendaOrdered = breakdown.filter(b => b.tipo === 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);
                const totalVendorOrdered = breakdown.filter(b => b.tipo !== 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);
                
                let calcForStore = Math.min(tiendaOrdered, qtyRec);
                if (calcForStore < 0) calcForStore = 0;
                const availableForClients = Math.max(0, qtyRec - calcForStore);
                const clientSliceLimit = Math.min(availableForClients, totalVendorOrdered);

                const allForTitle = clientItems.filter(ci => normalizeTitle(ci.titulo) === key);
                const pendingClients = allForTitle.filter(ci => ci.estado === 'ADJUDICADO' || ci.estado.startsWith('CONFIRMADO'));
                const enTiendaClients = allForTitle.filter(ci => ci.estado === 'EN TIENDA');
                const clientsWillChange = pendingClients.slice(0, clientSliceLimit);
                const clientsWontChange = pendingClients.slice(clientSliceLimit);

                const getName = ci => ci.clientes?.nombre || `Cliente ${ci.cliente_id?.slice(-6) || '?'}`;

                return {
                    titulo: item.titulo, key, qtyRec, matchEnCatalogo: !!prod, nearest,
                    tiendaOrdered, totalVendorOrdered, calcForStore,
                    clientsWillChange: clientsWillChange.map(getName),
                    clientsWontChange: clientsWontChange.map(getName),
                    enTiendaCount: enTiendaClients.length,
                };
            });

            setDiagData(rows);
        } catch (e) {
            alert('Error en diagnóstico: ' + e.message);
        } finally {
            setDiagLoading(false);
        }
    };

    if (!semanas.length && !loading) return <div className="p-8 text-center text-muted">Cargando semanas...</div>;

    return (
        <>
            <div className="space-y-6 max-w-6xl mx-auto">
                {/* Header */}
                <div className="glass p-6 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-secondary/20 text-secondary rounded-xl">
                            <Truck size={24} />
                        </div>
                        <div>
                            <h3 className="text-xl font-bold uppercase tracking-tight">Recepción de Mercadería</h3>
                            <p className="text-xs text-muted-2 font-mono">Control de cajas y stock físico por despacho</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <select
                            value={selectedSemana}
                            onChange={(e) => setSelectedSemana(e.target.value)}
                            className="flex-1 md:w-64 bg-background border border-border/40 p-2.5 rounded-xl text-sm font-bold focus:ring-2 focus:ring-secondary outline-none transition-all"
                        >
                            <option value="">-- Seleccionar Semana --</option>
                            {semanas.map(s => (
                                <option key={s.id} value={s.id}>{s.nombre}</option>
                            ))}
                        </select>

                        {(isAdmin || isSocio) && (
                            <>
                                <label className="flex items-center gap-2 bg-white/50 px-3 py-2 rounded-xl cursor-pointer hover:bg-white transition-all border border-border/20 shadow-sm mr-2">
                                    <input
                                        type="checkbox"
                                        checked={skipStockUpdate}
                                        onChange={(e) => setSkipStockUpdate(e.target.checked)}
                                        className="accent-secondary w-4 h-4 rounded"
                                    />
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black text-navy leading-none">MODO ARCHIVADO</span>
                                        <span className="text-[9px] text-muted font-bold">No afecta stock físico</span>
                                    </div>
                                </label>

                                <button
                                    onClick={handleFullReception}
                                    disabled={saving || !selectedSemana}
                                    className={`p-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${saving ? 'bg-navy/50 text-white/50 cursor-not-allowed' : 'bg-navy text-white hover:bg-navy/90'}`}
                                    title="Marcar todo como recibido"
                                >
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                                    {saving ? 'Procesando...' : 'Todo Recibido'}
                                </button>

                                <button
                                    onClick={handleFinalizeCuts}
                                    disabled={saving || !selectedSemana}
                                    className={`p-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${saving ? 'bg-red-600/50 text-white/50 cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}
                                    title="Finalizar despacho y procesar recortes"
                                >
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} />}
                                    {saving ? 'Procesando...' : 'Finalizar Despacho'}
                                </button>

                                <button
                                    onClick={handleCancelReception}
                                    disabled={saving || !selectedSemana || loading}
                                    className={`p-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border shadow-lg ${saving ? 'bg-slate-900/50 border-slate-700/50 text-white/50 cursor-not-allowed' : 'bg-slate-900 border-slate-700 text-white hover:bg-slate-800'}`}
                                    title="REINICIAR TODA LA RECEPCIÓN (Borrar registros de esta semana)"
                                >
                                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                    {saving ? 'Cancelando...' : 'Cancelar Recepción'}
                                </button>

                            </>
                        )}

                        <button
                            onClick={handleSaveReception}
                            disabled={saving || !selectedSemana || Object.keys(receivedCounts).length === 0}
                            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all shadow-md ${saving ? 'bg-secondary/50 text-white/50 cursor-not-allowed' : 'bg-secondary text-white hover:bg-secondary/90'}`}
                            title="Guardar recepción actual"
                        >
                            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                            {saving ? 'Guardando...' : `Guardar${Object.keys(receivedCounts).length > 0 ? ` (${Object.values(receivedCounts).reduce((a, b) => a + parseInt(b), 0)})` : ''}`}
                        </button>
                    </div>
                </div>

                {selectedSemana ? (
                    loading ? (
                        <div className="py-20 flex justify-center"><Loader2 size={40} className="animate-spin text-secondary" /></div>
                    ) : masterItems.length === 0 ? (
                        <div className="glass p-12 text-center border-dashed border-2">
                            <AlertCircle size={48} className="mx-auto text-muted mb-4 opacity-20" />
                            <p className="text-muted font-bold">Esta semana no tiene una "Base Master" (Excel de confirmación) cargada.</p>
                            <p className="text-xs text-muted/60 mt-1">Primero sube el Excel en la pestaña 'Base Master'.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Filters */}
                            <div className="flex flex-col md:flex-row gap-4">
                                <div className="relative flex-1">
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Buscar título en la caja..."
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full bg-white border border-border/40 p-4 pl-12 rounded-2xl text-sm font-bold shadow-sm focus:border-secondary outline-none transition-all"
                                    />
                                </div>

                                <div className="relative md:w-64">
                                    <Users className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                                    <select
                                        value={vendorFilter}
                                        onChange={(e) => setVendorFilter(e.target.value)}
                                        className="w-full bg-white border border-border/40 p-4 pl-12 rounded-2xl text-sm font-bold focus:border-secondary outline-none transition-all appearance-none cursor-pointer shadow-sm"
                                    >
                                        <option value="">Todos los destinos</option>
                                        {allVendors.map(v => (
                                            <option key={v} value={v}>{v}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-muted pointer-events-none" size={16} />
                                </div>

                                <label className="flex items-center gap-3 bg-white border border-border/40 px-5 py-4 rounded-2xl cursor-pointer hover:border-secondary/50 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={hideComplete}
                                        onChange={(e) => setHideComplete(e.target.checked)}
                                        className="accent-secondary w-5 h-5 rounded"
                                    />
                                    <span className="text-sm font-bold text-navy select-none">Ocultar completos</span>
                                </label>

                                <button
                                    onClick={handleDiagnostico}
                                    disabled={diagLoading}
                                    className="flex items-center gap-2 bg-orange-500 text-white px-5 py-4 rounded-2xl text-sm font-bold hover:bg-orange-600 transition-all whitespace-nowrap"
                                    title="Ver qué pasará con cada título antes de guardar"
                                >
                                    <Search size={18} />
                                    {diagLoading ? 'Cargando...' : 'Diagnosticar'}
                                </button>
                                {Object.keys(alreadyReceived).length > 0 && (
                                    <button
                                        onClick={handleVerifyStock}
                                        disabled={verifyLoading}
                                        className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-4 rounded-2xl text-sm font-bold hover:bg-emerald-700 transition-all whitespace-nowrap"
                                        title="Ver stock antes y después de esta recepción"
                                    >
                                        <Package size={18} />
                                        Verificar Stock
                                    </button>
                                )}
                            </div>

                            {/* Dashboard Stats */}
                            {dashboardStats && (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                    <div className="bg-navy text-white p-4 rounded-2xl shadow-lg relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:scale-110 transition-transform">
                                            <Package size={48} />
                                        </div>
                                        <div className="relative">
                                            <div className="text-[10px] font-black uppercase tracking-widest opacity-60">Total Esperado</div>
                                            <div className="text-3xl font-black">{dashboardStats.total}</div>
                                            <div className="text-[10px] font-bold mt-1 opacity-80 uppercase tracking-tighter">Mangas en despacho</div>
                                        </div>
                                    </div>

                                    <div className="bg-white border border-navy/10 p-4 rounded-2xl shadow-sm relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 p-2 text-navy opacity-5 group-hover:scale-110 transition-transform">
                                            <Truck size={48} />
                                        </div>
                                        <div className="relative">
                                            <div className="text-[10px] font-black text-navy/40 uppercase tracking-widest">Tienda (Físico)</div>
                                            <div className="text-3xl font-black text-navy">{dashboardStats.tienda}</div>
                                            <div className="text-[10px] font-bold text-navy/60 mt-1 uppercase tracking-tighter">Para stock libre</div>
                                        </div>
                                    </div>

                                    {Object.entries(dashboardStats.porVendedor).sort((a, b) => b[1] - a[1]).map(([vName, qty]) => (
                                        <div key={vName} className="bg-white border border-border/40 p-4 rounded-2xl shadow-sm relative overflow-hidden group">
                                            <div className="absolute top-0 right-0 p-2 text-secondary opacity-5 group-hover:scale-110 transition-transform">
                                                <Users size={40} />
                                            </div>
                                            <div className="relative">
                                                <div className="text-[10px] font-black text-muted uppercase tracking-widest truncate pr-6">{vName}</div>
                                                <div className="text-3xl font-black text-secondary">{qty}</div>
                                                <div className="text-[10px] font-bold text-secondary/60 mt-1 uppercase tracking-tighter">Para clientes</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Items Table */}
                            <div className="glass rounded-2xl overflow-hidden border border-border/40">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-secondary/5 text-[10px] font-bold uppercase tracking-widest text-secondary">
                                        <tr>
                                            <th className="p-4 w-12"></th>
                                            <th className="p-4">TÍTULO CONFIRMADO</th>
                                            <th className="p-4 text-center">CONFIRMADO</th>
                                            <th className="p-4">DISTRIBUCIÓN (QUIÉN)</th>
                                            <th className="p-4 text-center">LLEGARON (HOY)</th>
                                            <th className="p-4 text-center">FALTANTES</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/20">
                                        {filteredItems.map((it, idx) => {
                                            const key = normalizeTitle(it.titulo);
                                            const breakdown = orderBreakdown[key] || [];

                                            const confirmedQty = it.cantidad || 0;
                                            const prevReceived = alreadyReceived[key] || 0;
                                            const inputVal = receivedCounts[key] || '';

                                            const isFullyReceivedBefore = prevReceived >= confirmedQty;

                                            const totalNow = prevReceived + (parseInt(inputVal) || 0);
                                            const missingQty = Math.max(0, confirmedQty - totalNow);

                                            let rowClass = 'transition-colors hover:bg-white/50 border-b border-border/10 ';
                                            if (isFullyReceivedBefore || (missingQty === 0 && confirmedQty > 0)) {
                                                rowClass += 'bg-green-50/50 hover:bg-green-50 ';
                                            } else if (missingQty < confirmedQty && parseInt(inputVal) > 0) {
                                                rowClass += 'bg-orange-50/50 hover:bg-orange-50 ';
                                            }

                                            return (
                                                <React.Fragment key={idx}>
                                                    <tr className={rowClass}>
                                                        <td className="p-4 w-12 text-center text-muted">
                                                            <Package size={18} opacity={0.3} />
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="font-bold text-navy flex items-center gap-2 text-sm">
                                                                {it.titulo}
                                                                {isFullyReceivedBefore && <CheckCircle2 size={14} className="text-green-500" />}
                                                            </div>
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <span className="font-black text-navy text-lg">{confirmedQty}</span>
                                                            {prevReceived > 0 && !isFullyReceivedBefore && (
                                                                <div className="text-[9px] font-bold text-orange-500 mt-0.5">
                                                                    Pendiente: {confirmedQty - prevReceived}
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="p-4">
                                                            <div className="flex flex-wrap gap-1">
                                                                {breakdown.map((b, bIdx) => (
                                                                    <span key={bIdx} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${b.tipo === 'tienda' ? 'bg-navy/5 text-navy border-navy/10' : 'bg-secondary/5 text-secondary border-secondary/10'}`}>
                                                                        {b.tipo === 'tienda' ? '🏢' : '👤'} {b.vendedor}: {b.cantidad}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                            {(() => {
                                                                const forTitle = clientItems.filter(ci => normalizeTitle(ci.titulo) === key);
                                                                const pending = forTitle.filter(ci => ci.estado === 'ADJUDICADO' || ci.estado.startsWith('CONFIRMADO')).length;
                                                                const inStore = forTitle.filter(ci => ci.estado === 'EN TIENDA').length;
                                                                const total = forTitle.length;
                                                                return (
                                                                    <div className="mt-1 text-[9px] font-bold uppercase">
                                                                        {total === 0
                                                                            ? <span className="text-red-400 animate-pulse">⚠ 0 clientes cargados</span>
                                                                            : <span className="text-secondary">{pending > 0 ? `${pending} pendientes` : ''}{pending > 0 && inStore > 0 ? ' · ' : ''}{inStore > 0 ? `${inStore} en tienda` : ''}</span>
                                                                        }
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            {isFullyReceivedBefore ? (
                                                                <div className="bg-green-100 text-green-700 font-bold px-3 py-2 rounded-xl text-xs flex items-center justify-center gap-1">
                                                                    <CheckCircle2 size={14} /> Ya Recibido ({prevReceived})
                                                                </div>
                                                            ) : (
                                                                <div className="flex items-center justify-center gap-1">
                                                                    {prevReceived > 0 && <span className="text-[10px] font-bold text-muted bg-white border border-border/40 px-1.5 py-1 rounded">Ya: {prevReceived}</span>}
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        data-reception-input="true"
                                                                        placeholder="0"
                                                                        value={inputVal}
                                                                        onChange={(e) => handleQuantityChange(key, e.target.value, confirmedQty, prevReceived)}
                                                                        onKeyDown={handleKeyDown}
                                                                        className={`w-16 p-2 text-center rounded-xl border-2 font-black text-lg transition-all outline-none 
                                                                        ${inputVal ? 'border-secondary bg-secondary/10 text-secondary' : 'border-border/40 bg-background focus:border-secondary'}`}
                                                                    />
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="p-4 text-center">
                                                            <span className={`font-bold px-3 py-1 rounded-full text-[10px] uppercase tracking-wider ${missingQty > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                                                                {missingQty > 0 ? `Faltan ${missingQty}` : 'Completo'}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                ) : (
                    <div className="glass p-20 text-center border-dashed border-2 animate-pulse">
                        <Truck size={64} className="mx-auto text-muted mb-4 opacity-10" />
                        <p className="text-muted font-display text-xl uppercase tracking-widest">Selecciona una semana para comenzar la recepción</p>
                    </div>
                )}
            </div>

            {/* Modal de verificación de stock */}
            {showVerify && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-border">
                            <div>
                                <h3 className="text-lg font-black uppercase tracking-tight">Verificación de Stock</h3>
                                <p className="text-xs text-muted mt-0.5">Stock antes = stock actual − cantidad recibida en esta semana</p>
                            </div>
                            <button onClick={() => setShowVerify(false)} className="text-muted hover:text-text p-1 rounded-lg hover:bg-border/30 transition-all text-xl font-bold">✕</button>
                        </div>
                        <div className="overflow-auto flex-1 p-4">
                            {verifyLoading ? (
                                <div className="py-16 flex justify-center"><Loader2 size={36} className="animate-spin text-secondary" /></div>
                            ) : (
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-surface border-b border-border text-xs uppercase text-muted font-black">
                                            <th className="text-left p-3">Título</th>
                                            <th className="text-center p-3 text-emerald-700">Stock antes<br /><span className="font-normal normal-case text-[10px]">(tu conteo)</span></th>
                                            <th className="text-center p-3 text-blue-600">+ Recibido</th>
                                            <th className="text-center p-3">= Stock ahora</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {verifyData.map((row, i) => (
                                            <tr key={i} className={`border-b border-border/40 ${row.stockAntes < 0 ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-surface/50'}`}>
                                                <td className="p-3 font-medium text-xs">{row.titulo}</td>
                                                <td className="p-3 text-center font-black font-mono text-emerald-700">
                                                    {row.stockAntes !== null ? row.stockAntes : '—'}
                                                    {row.stockAntes < 0 && <span className="ml-1 text-[9px] text-red-500 font-bold">⚠ revisar</span>}
                                                </td>
                                                <td className="p-3 text-center font-black font-mono text-blue-600">+{row.recibido}</td>
                                                <td className="p-3 text-center font-black font-mono">{row.stockActual !== null ? row.stockActual : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="p-4 border-t border-border flex justify-between items-center text-xs text-muted">
                            <span>{verifyData.length} títulos recibidos en esta semana</span>
                            <button onClick={() => setShowVerify(false)} className="btn-primary text-xs py-2 px-5">Cerrar</button>
                        </div>
                    </div>
                </div>
            )}
            {showDiag && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-border">
                            <div>
                                <h3 className="text-lg font-black uppercase tracking-tight text-orange-600">🔍 Diagnóstico Pre-Recepción</h3>
                                <p className="text-xs text-muted mt-0.5">Qué pasará con cada título cuando guardes. Verde = OK · Rojo = sin match en catálogo · Naranja = stock no subirá</p>
                            </div>
                            <button onClick={() => setShowDiag(false)} className="text-muted hover:text-text p-1 rounded-lg hover:bg-border/30 transition-all text-xl font-bold">✕</button>
                        </div>
                        <div className="overflow-auto flex-1 p-4">
                            {diagLoading ? (
                                <div className="py-16 flex justify-center"><Loader2 size={36} className="animate-spin text-orange-500" /></div>
                            ) : (
                                <table className="w-full text-xs border-collapse">
                                    <thead>
                                        <tr className="bg-surface border-b border-border text-[10px] uppercase text-muted font-black">
                                            <th className="text-left p-3">Título (en pedido)</th>
                                            <th className="text-center p-3">Cant.<br/>recibida</th>
                                            <th className="text-center p-3">Catálogo</th>
                                            <th className="text-center p-3">Tienda<br/>ordenó</th>
                                            <th className="text-center p-3">Vend.<br/>ordenaron</th>
                                            <th className="text-center p-3 text-emerald-700">Stock<br/>+</th>
                                            <th className="text-left p-3 text-blue-600">Clientes pendientes → EN TIENDA</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {diagData.map((row, i) => {
                                            const isNoMatch = !row.matchEnCatalogo && row.tiendaOrdered > 0;
                                            const isZeroUnexpected = row.matchEnCatalogo && row.calcForStore === 0 && row.tiendaOrdered > 0 && row.qtyRec > 0;
                                            const isOk = row.matchEnCatalogo && row.calcForStore > 0;
                                            const bg = isNoMatch ? 'bg-red-50' : isZeroUnexpected ? 'bg-orange-50' : isOk ? 'bg-emerald-50' : i % 2 === 0 ? 'bg-white' : 'bg-surface/40';
                                            const hasPending = row.clientsWillChange.length > 0 || row.clientsWontChange.length > 0;
                                            return (
                                                <tr key={i} className={`border-b border-border/30 ${bg}`}>
                                                    <td className="p-3 font-medium max-w-[220px]">
                                                        <div className="truncate" title={row.titulo}>{row.titulo}</div>
                                                        {isNoMatch && row.nearest && (
                                                            <div className="text-[10px] text-red-500 mt-0.5">⚠ ¿Quisiste decir: <span className="font-black">{row.nearest}</span>?</div>
                                                        )}
                                                        {isNoMatch && !row.nearest && (
                                                            <div className="text-[10px] text-red-500 mt-0.5">⚠ No encontrado en catálogo</div>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center font-mono font-black">{row.qtyRec || '—'}</td>
                                                    <td className="p-3 text-center">
                                                        {row.matchEnCatalogo
                                                            ? <span className="text-emerald-600 font-black">✓</span>
                                                            : <span className="text-red-500 font-black">✗</span>}
                                                    </td>
                                                    <td className="p-3 text-center font-mono">{row.tiendaOrdered || '—'}</td>
                                                    <td className="p-3 text-center font-mono">{row.totalVendorOrdered || '—'}</td>
                                                    <td className="p-3 text-center font-mono font-black text-emerald-700">
                                                        {row.calcForStore > 0 ? `+${row.calcForStore}` : row.tiendaOrdered > 0 ? <span className="text-orange-500">0</span> : '—'}
                                                    </td>
                                                    <td className="p-3 text-left text-[11px] min-w-[200px]">
                                                        {!hasPending && row.enTiendaCount === 0 && <span className="text-muted">—</span>}
                                                        {row.clientsWillChange.length > 0 && (
                                                            <div className="mb-1">
                                                                <span className="text-blue-600 font-black">→ EN TIENDA ({row.clientsWillChange.length}):</span>
                                                                <div className="text-blue-700 leading-tight mt-0.5">
                                                                    {row.clientsWillChange.map((n, j) => <div key={j} className="truncate">• {n}</div>)}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {row.clientsWontChange.length > 0 && (
                                                            <div className="mb-1">
                                                                <span className="text-orange-500 font-black">⚠ Sin stock ({row.clientsWontChange.length}):</span>
                                                                <div className="text-orange-600 leading-tight mt-0.5">
                                                                    {row.clientsWontChange.map((n, j) => <div key={j} className="truncate">• {n}</div>)}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {row.enTiendaCount > 0 && (
                                                            <div className="text-muted">{row.enTiendaCount} ya en tienda</div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="p-4 border-t border-border flex justify-between items-center text-xs text-muted">
                            <div className="flex gap-4 flex-wrap">
                                <span className="text-emerald-600 font-bold">✓ {diagData.filter(r => r.matchEnCatalogo && r.calcForStore > 0).length} OK</span>
                                <span className="text-red-500 font-bold">✗ {diagData.filter(r => !r.matchEnCatalogo && r.tiendaOrdered > 0).length} sin match</span>
                                <span className="text-orange-500 font-bold">⚠ {diagData.filter(r => r.matchEnCatalogo && r.calcForStore === 0 && r.tiendaOrdered > 0 && r.qtyRec > 0).length} stock 0 inesperado</span>
                                {diagCatalogCount !== null && (
                                    <span className={diagCatalogCount <= 1000 ? 'text-red-500 font-bold' : 'text-muted'}>
                                        {diagCatalogCount <= 1000 ? '⚠ ' : ''}Catálogo: {diagCatalogCount} productos{diagCatalogCount <= 1000 ? ' (¡límite alcanzado!)' : ''}
                                    </span>
                                )}
                            </div>
                            <button onClick={() => setShowDiag(false)} className="bg-orange-500 text-white font-bold text-xs py-2 px-5 rounded-xl hover:bg-orange-600 transition-all">Cerrar</button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
