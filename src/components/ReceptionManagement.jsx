import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { 
    Package, CheckCircle2, AlertCircle, Search, 
    ChevronRight, ChevronDown, Save, Loader2,
    Users, Info, Truck, ShieldAlert, Trash2
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

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
    const { isAdmin } = useAuth();

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
        const { data } = await supabase
            .from('semanas')
            .select('*')
            .order('created_at', { ascending: false });
        if (data) setSemanas(data);
    };

    const fetchReceptionData = async (semanaId) => {
        setLoading(true);
        try {
            // Todas las queries en paralelo
            const [masterRes, ordersRes, receptionRes, cItemsRes] = await Promise.all([
                supabase.from('master_confirmaciones').select('*').eq('semana_id', semanaId).maybeSingle(),
                supabase.from('pedido_items').select('*, pedido:pedidos!inner(vendedor_nombre, tipo)').eq('pedido.semana_id', semanaId),
                supabase.from('pedido_items_recepcion').select('*').eq('semana_id', semanaId),
                supabase.from('cliente_items').select('*, clientes(nombre, vendedor_id)').eq('semana_id', semanaId),
            ]);
            const master = masterRes.data;
            const orders = ordersRes.data;
            const currentReception = receptionRes.data;
            const cItems = cItemsRes.data;
            
            setClientItems(cItems || []);

            if (master && master.datos_json) {
                setMasterItems(master.datos_json);
                
                // Index current reception
                const receptionMap = {};
                (currentReception || []).forEach(r => {
                    const key = r.titulo.toLowerCase().trim();
                    receptionMap[key] = (receptionMap[key] || 0) + r.cantidad_recibida;
                });
                
                setAlreadyReceived(receptionMap);
                setReceivedCounts({});
            } else {
                setMasterItems([]);
                setAlreadyReceived({});
            }

            // Build breakdown
            const breakdown = {};
            (orders || []).forEach(item => {
                const key = item.titulo.toLowerCase().trim();
                if (!breakdown[key]) breakdown[key] = [];
                breakdown[key].push({
                    vendedor: item.pedido.vendedor_nombre,
                    cantidad: item.cantidad,
                    tipo: item.pedido.tipo
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

    const filteredItems = useMemo(() => {
        let result = masterItems;

        if (searchTerm) {
            result = result.filter(it => 
                it.titulo.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        if (vendorFilter) {
            result = result.filter(it => {
                const key = it.titulo.toLowerCase().trim();
                const bd = orderBreakdown[key] || [];
                if (vendorFilter === 'Tienda') {
                    return bd.some(b => b.tipo === 'tienda');
                }
                return bd.some(b => b.vendedor === vendorFilter);
            });
        }

        if (hideComplete) {
            result = result.filter(it => {
                const key = it.titulo.toLowerCase().trim();
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
            setReceivedCounts({...receivedCounts, [key]: ''});
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
                setReceivedCounts({...receivedCounts, [key]: numVal.toString()});
            } else {
                // Si cancela, volvemos al máximo sugerido (o lo que ya tenía si era válido)
                setReceivedCounts({...receivedCounts, [key]: maxAllowed.toString()});
            }
        } else {
            setReceivedCounts({...receivedCounts, [key]: numVal.toString()});
        }
    };

    const handleCancelReception = async () => {
        if (!selectedSemana) return;
        if (!isAdmin) return;

        const weekName = semanas.find(s => s.id === selectedSemana)?.nombre || 'esta semana';
        
        const firstConfirm = window.confirm(`⚠️ ¿ESTÁS SEGURO? Se borrará TODO el historial de recepción de:\n\n"${weekName}"\n\nEsto te permitirá empezar de nuevo la recepción desde cero.`);
        if (!firstConfirm) return;

        const secondConfirm = window.confirm(`❗ ÚLTIMA ADVERTENCIA: Esta acción es irreversible.\n¿Confirmas que quieres BORRAR TODO lo recibido hoy para esta semana?`);
        if (!secondConfirm) return;

        setSaving(true);
        try {
            // 1. Borrar registros de recepción
            const { error: delError } = await supabase
                .from('pedido_items_recepcion')
                .delete()
                .eq('semana_id', selectedSemana);

            if (delError) throw delError;

            // 2. Resetear estados de cliente_items de esa semana (de EN TIENDA a ADJUDICADO)
            const { error: updError } = await supabase
                .from('cliente_items')
                .update({ estado: 'ADJUDICADO' })
                .eq('semana_id', selectedSemana)
                .eq('estado', 'EN TIENDA');

            if (updError) throw updError;

            alert("✅ ÉXITO: La recepción de esta semana ha sido reiniciada. Puedes volver a procesarla.");
            setReceivedCounts({});
            fetchReceptionData(selectedSemana);
        } catch (err) {
            console.error("Error al cancelar recepción:", err);
            alert("❌ Error al cancelar: " + err.message);
        } finally {
            setSaving(false);
        }
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
            .filter(([_, qty]) => qty > 0)
            .map(([title, qty]) => {
                const originalItem = masterItems.find(it => it.titulo.toLowerCase().trim() === title);
                return {
                    semana_id: selectedSemana,
                    titulo: originalItem?.titulo || title.toUpperCase(),
                    cantidad_recibida: parseInt(qty),
                    cantidad_faltante: Math.max(0, (originalItem?.cantidad || 0) - parseInt(qty))
                };
            });

        if (itemsToSave.length === 0) return alert("No hay unidades pendientes para guardar.");

        setSaving(true);
        try {
            // 1. Insert into reception table
            const { error: insError } = await supabase
                .from('pedido_items_recepcion')
                .insert(itemsToSave);

            if (insError) throw insError;

            // 2. Update physical stock and client orders status
            if (!skipStockUpdate) {
                // Cargar catálogo UNA sola vez antes del loop
                const { data: allProds } = await supabase
                    .from('catalogo_productos')
                    .select('id, stock_fisico, titulo');
                const prodMap = {};
                (allProds || []).forEach(p => { prodMap[p.titulo.trim().toLowerCase()] = p; });

                // Calcular todos los cambios sin hacer queries por item
                const allPreAllocatedIds = [];
                const stockDeltas = {}; // prod.id → cantidad a sumar

                for (const item of itemsToSave) {
                    const key = item.titulo.toLowerCase().trim();
                    const qtyRec = item.cantidad_recibida;

                    const preAllocated = clientItems
                        .filter(ci => ci.titulo.toLowerCase().trim() === key && ci.estado === 'ADJUDICADO')
                        .slice(0, qtyRec);
                    const preAllocatedIds = preAllocated.map(p => p.id);
                    allPreAllocatedIds.push(...preAllocatedIds);

                    const breakdown = orderBreakdown[key] || [];
                    const tiendaOrdered = breakdown.filter(b => b.tipo === 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);
                    const totalVendorOrdered = breakdown.filter(b => b.tipo !== 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);
                    const estTiendaClients = preAllocatedIds.length * (tiendaOrdered / (tiendaOrdered + totalVendorOrdered || 1));
                    let calcForStore = Math.round(tiendaOrdered - estTiendaClients);
                    if (calcForStore < 0) calcForStore = 0;

                    if (calcForStore > 0) {
                        const prod = prodMap[key];
                        if (prod) {
                            stockDeltas[prod.id] = (stockDeltas[prod.id] || 0) + calcForStore;
                        }
                    }
                }

                // Un solo UPDATE para todos los cliente_items
                if (allPreAllocatedIds.length > 0) {
                    await supabase.from('cliente_items')
                        .update({ estado: 'EN TIENDA' })
                        .in('id', allPreAllocatedIds);
                }

                // Un solo UPSERT para todos los stocks
                const stockRows = Object.entries(stockDeltas).map(([id, delta]) => ({
                    id,
                    stock_fisico: (prodMap[Object.keys(prodMap).find(k => prodMap[k].id === id)] ?.stock_fisico || 0) + delta,
                }));
                if (stockRows.length > 0) {
                    await supabase.from('catalogo_productos')
                        .upsert(stockRows, { onConflict: 'id' });
                    // Actualizar caché local para que CatalogUpdatedView refleje los cambios
                    catalogService.patchStockInCache(Object.entries(stockDeltas).map(([id, delta]) => ({ id, delta })));
                }
            }

            alert(skipStockUpdate ? "✅ Recepción guardada en el historial (sin afectar stock)." : "✅ Recepción guardada con éxito y stock actualizado.");
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
        
        const itemsToSave = masterItems.map(it => ({
            semana_id: selectedSemana,
            titulo: it.titulo,
            cantidad_recibida: it.cantidad,
            cantidad_faltante: 0
        }));

        setSaving(true);
        try {
            // 1. Insert into reception table
            const { error: insError } = await supabase
                .from('pedido_items_recepcion')
                .insert(itemsToSave);

            if (insError) throw insError;

            // 2. Update physical stock in catalog and client orders status
            if (!skipStockUpdate) {
                const { data: allProds } = await supabase
                    .from('catalogo_productos')
                    .select('id, stock_fisico, titulo');
                const prodMap = {};
                (allProds || []).forEach(p => { prodMap[p.titulo.trim().toLowerCase()] = p; });

                const allPreAllocatedIds = [];
                const stockDeltas = {};

                for (const item of itemsToSave) {
                    const key = item.titulo.toLowerCase().trim();
                    const qtyRec = item.cantidad_recibida;

                    const preAllocated = clientItems
                        .filter(ci => ci.titulo.toLowerCase().trim() === key && ci.estado === 'ADJUDICADO')
                        .slice(0, qtyRec);
                    const preAllocatedIds = preAllocated.map(p => p.id);
                    allPreAllocatedIds.push(...preAllocatedIds);

                    const breakdown = orderBreakdown[key] || [];
                    const tiendaOrdered = breakdown.filter(b => b.tipo === 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);
                    const totalVendorOrdered = breakdown.filter(b => b.tipo !== 'tienda').reduce((s, b) => s + (b.cantidad || 0), 0);
                    const estTiendaClients = preAllocatedIds.length * (tiendaOrdered / (tiendaOrdered + totalVendorOrdered || 1));
                    let calcForStore = Math.round(tiendaOrdered - estTiendaClients);
                    if (calcForStore < 0) calcForStore = 0;

                    if (calcForStore > 0) {
                        const prod = prodMap[key];
                        if (prod) {
                            stockDeltas[prod.id] = (stockDeltas[prod.id] || 0) + calcForStore;
                        }
                    }
                }

                if (allPreAllocatedIds.length > 0) {
                    await supabase.from('cliente_items')
                        .update({ estado: 'EN TIENDA' })
                        .in('id', allPreAllocatedIds);
                }

                const stockRows = Object.entries(stockDeltas).map(([id, delta]) => ({
                    id,
                    stock_fisico: (prodMap[Object.keys(prodMap).find(k => prodMap[k].id === id)]?.stock_fisico || 0) + delta,
                }));
                if (stockRows.length > 0) {
                    await supabase.from('catalogo_productos')
                        .upsert(stockRows, { onConflict: 'id' });
                    catalogService.patchStockInCache(Object.entries(stockDeltas).map(([id, delta]) => ({ id, delta })));
                }
            }

            alert(skipStockUpdate ? "✅ Pedido archivado sin afectar el stock físico." : "✅ Semana marcada como recibida y stock actualizado.");
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
            const { error } = await supabase.from('cliente_items')
                .update({ estado: 'RECORTADO' })
                .eq('semana_id', selectedSemana)
                .in('estado', ['PEDIDO', 'CONFIRMADO', 'ADJUDICADO', 'PEDIDO (RE-PROG)']);

            if (error) throw error;
            
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
            // Cargar stock actual del catálogo para los títulos recibidos
            const titulos = Object.keys(alreadyReceived);
            const { data: prods } = await supabase
                .from('catalogo_productos')
                .select('id, titulo, stock_fisico, updated_at');
            const prodMap = {};
            (prods || []).forEach(p => { prodMap[p.titulo.trim().toLowerCase()] = p; });

            const rows = titulos.map(key => {
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

                    {isAdmin && (
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
                        {saving ? 'Guardando...' : `Guardar${Object.keys(receivedCounts).length > 0 ? ` (${Object.values(receivedCounts).reduce((a,b)=>a+parseInt(b),0)})` : ''}`}
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
                            
                            <select
                                value={vendorFilter}
                                onChange={(e) => setVendorFilter(e.target.value)}
                                className="bg-white border border-border/40 p-4 rounded-2xl text-sm font-bold focus:border-secondary outline-none transition-all md:w-64"
                            >
                                <option value="">Todos los destinos</option>
                                {allVendors.map(v => (
                                    <option key={v} value={v}>{v}</option>
                                ))}
                            </select>

                            <label className="flex items-center gap-3 bg-white border border-border/40 px-5 py-4 rounded-2xl cursor-pointer hover:border-secondary/50 transition-colors">
                                <input 
                                    type="checkbox" 
                                    checked={hideComplete}
                                    onChange={(e) => setHideComplete(e.target.checked)}
                                    className="accent-secondary w-5 h-5 rounded"
                                />
                                <span className="text-sm font-bold text-navy select-none">Ocultar completos</span>
                            </label>

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
                                        const key = (it.titulo || '').toLowerCase().trim();
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
                                                    <td className="p-4 text-center font-black text-navy text-lg">{confirmedQty}</td>
                                                    <td className="p-4">
                                                        <div className="flex flex-wrap gap-1">
                                                            {breakdown.map((b, bIdx) => (
                                                                <span key={bIdx} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${b.tipo === 'tienda' ? 'bg-navy/5 text-navy border-navy/10' : 'bg-secondary/5 text-secondary border-secondary/10'}`}>
                                                                    {b.tipo === 'tienda' ? '🏢' : '👤'} {b.vendedor}: {b.cantidad}
                                                                </span>
                                                            ))}
                                                        </div>
                                                        <div className="mt-1 text-[9px] font-bold text-secondary uppercase animate-pulse">
                                                            {clientItems.filter(ci => (ci.titulo || '').toLowerCase().trim() === key && ci.estado === 'ADJUDICADO').length} Adjudicados en plan
                                                        </div>
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
                                        <th className="text-center p-3 text-emerald-700">Stock antes<br/><span className="font-normal normal-case text-[10px]">(tu conteo)</span></th>
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
        </>
    );
}
