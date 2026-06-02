import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../services/supabase';
import {
    Truck, Package, Calendar, Clock, ChevronRight,
    ChevronDown, AlertCircle, TrendingUp, ArrowUpRight,
    Info, Activity, Check, X, ShoppingBag
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Normalización robusta de títulos: sin acentos, guiones→espacio, espacios múltiples→uno
const normalizeTitle = (str) =>
    (str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[-–—]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

// Estados terminales: ítems ya cumplidos, no cuentan como demanda activa al distribuidor
const ESTADOS_TERMINALES = new Set(['EN TIENDA', 'ENTREGADO', 'ADJUDICADO', 'DAÑADO', 'DESPACHADO', 'CANCELADO']);

export default function ConfirmationInfoView() {
    const { isAdmin } = useAuth();
    const [semanaDetails, setSemanaDetails] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedWeek, setExpandedWeek] = useState(null);
    const [globalStats, setGlobalStats] = useState({ fisico: 0, confirmado: 0, pendiente: 0 });
    const [detailFilter, setDetailFilter] = useState('all'); // all, cuts, extras
    const [expandedTitle, setExpandedTitle] = useState(null); // {weekId, title}
    const [clientItems, setClientItems] = useState([]);
    const [saving, setSaving] = useState(false);
    const [actionLoading, setActionLoading] = useState(null); // id del titulo cargando
    const [reprogramModal, setReprogramModal] = useState(null); // { mi: pedido_item, weekId }
    const [reprogramQty, setReprogramQty] = useState(1);
    const [reprogramSemana, setReprogramSemana] = useState('');
    const [reprogramLoading, setReprogramLoading] = useState(false);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    // Realtime: actualizar Stock Físico Real al instante
    // Requiere: ALTER TABLE catalogo_productos REPLICA IDENTITY FULL + ADD TABLE a supabase_realtime
    useEffect(() => {
        const channel = supabase
            .channel('stock_fisico_realtime')
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'catalogo_productos',
            }, (payload) => {
                const oldStock = payload.old?.stock_fisico ?? null;
                const newStock = payload.new?.stock_fisico ?? null;
                if (oldStock !== null && newStock !== null && oldStock !== newStock) {
                    setGlobalStats(prev => ({ ...prev, fisico: prev.fisico + (newStock - oldStock) }));
                }
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const fetchDashboardData = async () => {
        setLoading(true);
        try {
            // Función helper para paginación
            const fetchAll = async (table, select = '*', filters = null) => {
                let all = [];
                let from = 0;
                while(true) {
                    let q = supabase.from(table).select(select).range(from, from + 999);
                    if (filters) q = filters(q);
                    const { data, error } = await q;
                    if (error) { console.error(`Error in fetchAll(${table}):`, error); throw error; }
                    if (!data || data.length === 0) break;
                    all = [...all, ...data];
                    if (data.length < 1000) break;
                    from += 1000;
                }
                return all;
            };

            // Todo en paralelo desde el inicio
            const [weeksRes, mastersRes, receptions, orders, cItems] = await Promise.all([
                supabase.from('semanas').select('*').order('created_at', { ascending: false }),
                supabase.from('master_confirmaciones').select('semana_id, datos_json'),
                fetchAll('pedido_items_recepcion', 'semana_id, cantidad_recibida, titulo'),
                fetchAll('pedido_items', 'id, cantidad, titulo, estado, precio, isbn_raw, editorial, pedido:pedidos(id, semana_id, tipo, vendedor_nombre, vendedor_id)'),
                fetchAll('cliente_items', '*, clientes(nombre), vendedores(nombre)')
            ]);

            // catalogo_productos puede tener miles de filas — paginar correctamente
            const totalFisico = await (async () => {
                let total = 0, from = 0;
                while (true) {
                    const { data } = await supabase.from('catalogo_productos').select('stock_fisico').range(from, from + 999);
                    if (!data || data.length === 0) break;
                    total += data.reduce((s, p) => s + (p.stock_fisico || 0), 0);
                    if (data.length < 1000) break;
                    from += 1000;
                }
                return total;
            })();
            const weeks = weeksRes.data || [];
            const masters = mastersRes.data || [];

            setClientItems(cItems || []);

            // Process stats per week
            const details = (weeks || []).map(w => {
                const master = masters.find(m => m.semana_id === w.id);
                const masterData = master?.datos_json || [];
                const weekReceptions = receptions.filter(r => r.semana_id === w.id) || [];
                const weekOrders = orders.filter(o => o.pedido.semana_id === w.id) || [];

                const totalOrdered = weekOrders.reduce((sum, o) => sum + (o.cantidad || 0), 0);
                const totalConfirmed = masterData.reduce((sum, it) => sum + (it.cantidad || 0), 0);
                const totalReceived = weekReceptions.reduce((sum, r) => sum + (r.cantidad_recibida || 0), 0);

                const pendiente = Math.max(0, totalOrdered - totalConfirmed);
                const confirmadoFlotante = Math.max(0, totalConfirmed - totalReceived);
                
                // --- Merge Titles (Original vs Master) for Discrepancy detection ---
                const allTitlesSet = new Set([
                    // Solo órdenes activas (excluir EN TIENDA, ENTREGADO, etc. ya cumplidos)
                    ...weekOrders.filter(o => !ESTADOS_TERMINALES.has(o.estado)).map(o => normalizeTitle(o.titulo)),
                    ...masterData.map(m => normalizeTitle(m.titulo))
                ]);

                const titleDetails = Array.from(allTitlesSet).map(itTitle => {
                    if (!itTitle) return null;

                    const ord = weekOrders.filter(o => normalizeTitle(o.titulo) === itTitle);
                    const mst = masterData.find(m => normalizeTitle(m.titulo) === itTitle);

                    // Solo órdenes activas: excluir EN TIENDA/ENTREGADO/ADJUDICADO (ya cumplidos, no son demanda nueva)
                    const activeOrd = ord.filter(o => !ESTADOS_TERMINALES.has(o.estado));
                    const qtyOrdered = activeOrd.reduce((s, x) => s + (x.cantidad || 0), 0);
                    const qtyConfirmed = mst?.cantidad || 0;

                    // Separar pedidos de mayoristas del resto (solo activos)
                    const mayoristaOrd = activeOrd.filter(o => o.pedido?.tipo === 'mayorista');
                    const qtyMayorista = mayoristaOrd.reduce((s, x) => s + (x.cantidad || 0), 0);

                    // Unidades disponibles para clientes retail (después de reservar para mayoristas)
                    const qtyAvailableForRetail = Math.max(0, qtyConfirmed - qtyMayorista);

                    // Clientes retail con pedido en esta semana
                    const titleCItems = cItems.filter(ci =>
                        ci.semana_id === w.id && normalizeTitle(ci.titulo) === itTitle
                    );
                    const qtyClientAllocated = titleCItems.filter(ci =>
                        ci.estado === 'ADJUDICADO' ||
                        ci.estado === 'EN TIENDA' ||
                        (ci.estado || '').startsWith('CONFIRMADO')
                    ).reduce((s, ci) => s + (Number(ci.cantidad) || 1), 0);

                    // Reparto total = retail adjudicado + todo lo que le toca al mayorista
                    const qtyTotalAllocated = qtyClientAllocated + qtyMayorista;

                    const rec = weekReceptions
                        .filter(r => normalizeTitle(r.titulo) === itTitle)
                        .reduce((sum, r) => sum + (r.cantidad_recibida || 0), 0);

                    return {
                        titulo: mst?.titulo || ord[0]?.titulo || itTitle.toUpperCase(),
                        pedido: qtyOrdered,
                        confirmado: qtyConfirmed,
                        received: rec,
                        allocated: qtyClientAllocated,       // solo retail (para auto-reparto)
                        qtyMayorista,                        // unidades reservadas para mayoristas
                        qtyAvailableForRetail,               // límite real para adjudicar a retail
                        qtyTotalAllocated,                   // retail + mayoristas (para badge visual)
                        mayoristaOrd,                        // items de mayoristas (para panel expandido)
                        pending: Math.max(0, qtyConfirmed - rec),
                        isExtra: qtyConfirmed > qtyOrdered,
                        isCut: qtyConfirmed < qtyOrdered && qtyOrdered > 0,
                        isMissing: qtyConfirmed === 0 && qtyOrdered > 0,
                        // needsAllocation: ¿quedan clientes retail sin adjudicar dentro del cupo disponible?
                        needsAllocation: qtyAvailableForRetail > qtyClientAllocated && titleCItems.length > qtyClientAllocated
                    };
                }).filter(Boolean).sort((a, b) => b.pedido - a.pedido);

                const totalUnitsCut = titleDetails.reduce((sum, t) => sum + Math.max(0, t.pedido - t.confirmado), 0);
                const totalUnitsExtra = titleDetails.reduce((sum, t) => sum + Math.max(0, t.confirmado - t.pedido), 0);

                const fechaLlegada = w.fecha_estimada_llegada 
                    ? new Date(w.fecha_estimada_llegada) 
                    : new Date(new Date(w.created_at).getTime() + (22 * 24 * 60 * 60 * 1000));

                const diasFaltantes = Math.ceil((fechaLlegada.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));

                return {
                    ...w,
                    ordered: totalOrdered,
                    confirmed: totalConfirmed,
                    received: totalReceived,
                    flotante: confirmadoFlotante,
                    pendiente,
                    titleDetails,
                    totalUnitsCut,
                    totalUnitsExtra,
                    fechaEstimada: fechaLlegada,
                    diasFaltantes,
                    isPending: !master
                };
            }).sort((a, b) => {
                // First by status (Pending first), then by date (Newest first)
                if (a.isPending === b.isPending) {
                    return new Date(b.created_at) - new Date(a.created_at);
                }
                return a.isPending ? -1 : 1;
            });

            // Auto-adjudicar títulos sin recorte (confirmado >= pedido retail)
            const toAutoAdjudicate = [];
            for (const week of details) {
                for (const t of week.titleDetails) {
                    if (t.isCut || t.isMissing || t.confirmado === 0) continue; // recorte o sin confirmación → manual
                    const key = normalizeTitle(t.titulo);
                    const pending = (cItems || []).filter(ci =>
                        ci.semana_id === week.id &&
                        normalizeTitle(ci.titulo) === key &&
                        ((ci.estado || '').startsWith('PEDIDO') || (ci.estado || '').startsWith('CONFIRMADO'))
                    ).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
                    const alreadyAllocated = (cItems || []).filter(ci =>
                        ci.semana_id === week.id &&
                        normalizeTitle(ci.titulo) === key &&
                        (ci.estado === 'ADJUDICADO' || ci.estado === 'EN TIENDA')
                    ).length;
                    // Límite = cupo disponible para retail (confirmado - reserva mayoristas)
                    const available = Math.max(0, t.qtyAvailableForRetail - alreadyAllocated);
                    const toUpdate = pending.slice(0, available);
                    toAutoAdjudicate.push(...toUpdate.map(ci => ci.id));
                }
            }
            if (toAutoAdjudicate.length > 0) {
                // Actualizar en lotes de 100
                for (let i = 0; i < toAutoAdjudicate.length; i += 100) {
                    const { error } = await supabase.from('cliente_items')
                        .update({ estado: 'ADJUDICADO' })
                        .in('id', toAutoAdjudicate.slice(i, i + 100));
                    if (error) console.error("Error en auto-adjudicación:", error);
                }
                // Refrescar cItems con el nuevo estado para que la UI quede correcta
                for (const ci of cItems) {
                    if (toAutoAdjudicate.includes(ci.id)) ci.estado = 'ADJUDICADO';
                }

                // Recalcular el reparto en details para que la interfaz se actualice inmediatamente
                for (const week of details) {
                    for (const t of week.titleDetails) {
                        const key = normalizeTitle(t.titulo);
                        const titleCItems = cItems.filter(ci =>
                            ci.semana_id === week.id && normalizeTitle(ci.titulo) === key
                        );
                        t.allocated = titleCItems.filter(ci =>
                            ci.estado === 'ADJUDICADO' ||
                            ci.estado === 'EN TIENDA' ||
                            (ci.estado || '').startsWith('CONFIRMADO')
                        ).reduce((s, ci) => s + (Number(ci.cantidad) || 1), 0);
                        t.qtyTotalAllocated = t.allocated + t.qtyMayorista;
                        t.needsAllocation = t.qtyAvailableForRetail > t.allocated && titleCItems.length > t.allocated;
                    }
                }
            }

            setSemanaDetails(details);
            setGlobalStats({
                fisico: totalFisico,
                confirmado: details.reduce((sum, d) => sum + d.flotante, 0),
                pendiente: details.reduce((sum, d) => sum + d.pendiente, 0)
            });

        } catch (err) {
            console.error("Error fetching dashboard data:", err);
            alert("⚠️ Error al cargar tablero: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    // ── Re-programar ítem mayorista recortado a otra semana ──────────────────
    const handleReProgramarMayorista = async () => {
        if (!reprogramModal || !reprogramSemana) return;
        const { mi } = reprogramModal;
        setReprogramLoading(true);
        try {
            // 1. Buscar pedido mayorista existente del mismo vendedor en la semana destino
            const { data: existingPedido } = await supabase
                .from('pedidos')
                .select('id')
                .eq('semana_id', reprogramSemana)
                .eq('tipo', 'mayorista')
                .eq('vendedor_id', mi.pedido.vendedor_id)
                .maybeSingle();

            let pedidoId;
            if (existingPedido) {
                pedidoId = existingPedido.id;
            } else {
                // Crear nuevo pedido mayorista para esa semana
                const { data: newPedido, error: pedErr } = await supabase
                    .from('pedidos')
                    .insert({
                        semana_id: reprogramSemana,
                        tipo: 'mayorista',
                        vendedor_nombre: mi.pedido.vendedor_nombre,
                        vendedor_id: mi.pedido.vendedor_id,
                    })
                    .select('id')
                    .single();
                if (pedErr) throw pedErr;
                pedidoId = newPedido.id;
            }

            // 2. Verificar que no exista ya el mismo título en ese pedido (evitar duplicado)
            const { data: dup } = await supabase
                .from('pedido_items')
                .select('id')
                .eq('pedido_id', pedidoId)
                .ilike('titulo', mi.titulo)
                .maybeSingle();

            if (dup) {
                alert(`"${mi.titulo}" ya existe en el pedido de esa semana. No se creó un duplicado.`);
                setReprogramModal(null);
                return;
            }

            // 3. Crear nuevo pedido_item en la semana destino
            const { error: insErr } = await supabase.from('pedido_items').insert({
                pedido_id: pedidoId,
                titulo: mi.titulo,
                cantidad: reprogramQty,
                precio: mi.precio || 0,
                isbn_raw: mi.isbn_raw || null,
                editorial: mi.editorial || null,
                estado: null,
            });
            if (insErr) throw insErr;

            // 4. Marcar el original como RECORTADO_REPEDIDO
            const { error: updErr } = await supabase
                .from('pedido_items')
                .update({ estado: 'RECORTADO_REPEDIDO' })
                .eq('id', mi.id);
            if (updErr) throw updErr;

            setReprogramModal(null);
            await fetchDashboardData();
        } catch (err) {
            alert('Error al re-programar: ' + err.message);
        } finally {
            setReprogramLoading(false);
        }
    };

    // ── Cancelar ítem mayorista recortado definitivamente ────────────────────
    const handleCancelarMayorista = async (itemId) => {
        if (!confirm('¿Cancelar definitivamente este ítem del pedido mayorista?')) return;
        setSaving(true);
        try {
            const { error } = await supabase
                .from('pedido_items')
                .update({ estado: 'CANCELADO' })
                .eq('id', itemId);
            if (error) throw error;
            await fetchDashboardData();
        } catch (err) {
            alert('Error al cancelar: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // ── Marcar como RECORTADO un ítem CONFIRMADO con recorte parcial ─────────
    // Divide el ítem: una fila RECORTADO (faltanteQty) + una fila CONFIRMADO (confirmadoQty)
    const handleMarcarRecortado = async (mi, confirmadoQty, faltanteQty, weekName) => {
        setSaving(true);
        try {
            // 1. Actualizar ítem original → solo la parte recortada
            const { error: updErr } = await supabase
                .from('pedido_items')
                .update({ cantidad: faltanteQty, estado: 'RECORTADO' })
                .eq('id', mi.id);
            if (updErr) throw updErr;

            // 2. Crear nuevo ítem para la parte confirmada (si hay confirmados)
            if (confirmadoQty > 0) {
                const { error: insErr } = await supabase.from('pedido_items').insert({
                    pedido_id: mi.pedido.id,
                    titulo: mi.titulo,
                    cantidad: confirmadoQty,
                    precio: mi.precio || 0,
                    fuente: mi.fuente || null,
                    estado: `CONFIRMADO ${weekName || ''}`.trim(),
                });
                if (insErr) throw insErr;
            }

            await fetchDashboardData();
        } catch (err) {
            alert('Error: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    const handleAutoAdjudicate = async (weekId, title, qtyAvailableForRetail) => {
        if (!isAdmin) return;
        const key = normalizeTitle(title);
        const pendingItems = clientItems
            .filter(ci => ci.semana_id === weekId && normalizeTitle(ci.titulo) === key)
            .filter(ci => (ci.estado || '').startsWith('PEDIDO') || (ci.estado || '').startsWith('CONFIRMADO'))
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        const currentlyAllocated = clientItems
            .filter(ci => ci.semana_id === weekId && normalizeTitle(ci.titulo) === key)
            .filter(ci => ci.estado === 'ADJUDICADO' || ci.estado === 'EN TIENDA').length;

        // Límite = cupo real para retail (ya descontada la reserva de mayoristas)
        const availableToAllocate = Math.max(0, qtyAvailableForRetail - currentlyAllocated);

        if (availableToAllocate <= 0) {
            alert("No hay unidades disponibles para clientes retail (todo el cupo está adjudicado o reservado para mayoristas).");
            return;
        }

        const itemsToUpdate = pendingItems.slice(0, availableToAllocate);

        if (itemsToUpdate.length === 0) {
            alert("No hay pedidos de clientes pendientes para este título en esta semana.");
            return;
        }

        setActionLoading(`${weekId}-${key}`);
        try {
            const { error } = await supabase
                .from('cliente_items')
                .update({ estado: 'ADJUDICADO' })
                .in('id', itemsToUpdate.map(i => i.id));

            if (error) throw error;
            await fetchDashboardData();
        } catch (err) {
            console.error(err);
            alert("Error al auto-adjudicar: " + err.message);
        } finally {
            setActionLoading(null);
        }
    };

    const handleClearAllocation = async (weekId, title) => {
        if (!isAdmin) return;
        if (!confirm("¿Estás seguro de limpiar TODO el reparto preventivo de este título? (Los ítems volverán a estado CONFIRMADO)")) return;

        const key = normalizeTitle(title);
        const itemsToReset = clientItems
            .filter(ci => ci.semana_id === weekId && normalizeTitle(ci.titulo) === key)
            .filter(ci => ci.estado === 'ADJUDICADO');

        if (itemsToReset.length === 0) return;

        setActionLoading(`${weekId}-${key}`);
        try {
            const { error } = await supabase
                .from('cliente_items')
                .update({ estado: 'CONFIRMADO' })
                .in('id', itemsToReset.map(i => i.id));

            if (error) throw error;
            await fetchDashboardData();
        } catch (err) {
            console.error(err);
            alert("Error al limpiar: " + err.message);
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
            <Activity className="text-secondary animate-spin" size={48} />
            <p className="text-xs font-black text-muted uppercase tracking-widest">Calculando Confirmaciones...</p>
        </div>
    );

    return (
        <div className="space-y-8 max-w-7xl mx-auto">
            <h3 className="text-xl font-bold uppercase tracking-tight">Información de Confirmaciones</h3>
            
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass p-8 rounded-3xl border border-border/40 shadow-xl relative overflow-hidden group">
                    <div className="absolute -right-8 -top-8 w-32 h-32 bg-navy/5 rounded-full group-hover:scale-125 transition-transform" />
                    <Package className="text-navy mb-4" size={32} />
                    <div className="text-[11px] font-bold text-muted uppercase tracking-[0.2em] mb-1">Stock Físico Real</div>
                    <div className="text-4xl font-display text-navy">{globalStats.fisico} <span className="text-sm font-mono text-muted uppercase">Uni</span></div>
                    <p className="text-xs text-muted-2 mt-2">Unidades disponibles en estantería</p>
                </div>

                <div className="glass p-8 rounded-3xl border border-secondary/30 shadow-xl relative overflow-hidden group">
                    <div className="absolute -right-8 -top-8 w-32 h-32 bg-secondary/5 rounded-full group-hover:scale-125 transition-transform" />
                    <Truck className="text-secondary mb-4" size={32} />
                    <div className="text-[11px] font-bold text-secondary uppercase tracking-[0.2em] mb-1">Flotante Confirmado</div>
                    <div className="text-4xl font-display text-secondary">{globalStats.confirmado} <span className="text-sm font-mono text-muted uppercase">Uni</span></div>
                    <p className="text-xs text-muted-2 mt-2">Confirmado por distribuidor y en tránsito</p>
                </div>

                <div className="glass p-8 rounded-3xl border border-accent/30 shadow-xl relative overflow-hidden group">
                    <div className="absolute -right-8 -top-8 w-32 h-32 bg-accent/5 rounded-full group-hover:scale-125 transition-transform" />
                    <Clock className="text-accent mb-4" size={32} />
                    <div className="text-[11px] font-bold text-accent uppercase tracking-[0.2em] mb-1">Flotante Pedido</div>
                    <div className="text-4xl font-display text-accent">{globalStats.pendiente} <span className="text-sm font-mono text-muted uppercase">Uni</span></div>
                    <p className="text-xs text-muted-2 mt-2">Pedidos realizados aún no confirmados</p>
                </div>
            </div>

            {/* Panel de Reconciliación por Semana */}
            {semanaDetails.filter(w => w.confirmed > 0).length > 0 && (
                <div className="glass rounded-3xl border border-border/40 overflow-hidden">
                    <div className="px-6 py-4 bg-navy/5 border-b border-border/20 flex items-center gap-2">
                        <Activity size={16} className="text-primary" />
                        <h4 className="text-xs font-bold text-navy uppercase tracking-[0.2em]">Reconciliación de Stock — Confirmaciones vs Comprometido</h4>
                        <span className="ml-auto text-[9px] text-muted font-mono uppercase tracking-widest">Estos números deberían cuadrar con el Catálogo Actualizado</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-navy/5 text-[9px] font-black text-muted uppercase tracking-widest">
                                <tr>
                                    <th className="px-4 py-3 text-left">Semana</th>
                                    <th className="px-3 py-3 text-center text-blue-500">Confirmado</th>
                                    <th className="px-3 py-3 text-center text-slate-400">Recibido</th>
                                    <th className="px-3 py-3 text-center text-slate-300">En tránsito</th>
                                    <th className="px-3 py-3 text-center text-purple-500">Mayoristas</th>
                                    <th className="px-3 py-3 text-center text-green-600">Clientes</th>
                                    <th className="px-3 py-3 text-center text-emerald-600">Disponible</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {semanaDetails.filter(w => w.confirmed > 0).map(w => {
                                    const totalMayoristas = w.titleDetails.reduce((s, t) => s + (t.qtyMayorista || 0), 0);
                                    const totalClientes   = w.titleDetails.reduce((s, t) => s + (t.allocated || 0), 0);
                                    const enTransito      = Math.max(0, w.confirmed - w.received);
                                    const netDisponible   = enTransito - totalMayoristas - totalClientes;
                                    const sobrevendido    = netDisponible < 0;

                                    return (
                                        <tr key={w.id} className="hover:bg-navy/5 transition-colors">
                                            <td className="px-4 py-3 font-bold text-navy text-[10px]">{w.nombre}</td>
                                            <td className="px-3 py-3 text-center font-black text-blue-600">{w.confirmed}</td>
                                            <td className="px-3 py-3 text-center text-slate-400">{w.received}</td>
                                            <td className="px-3 py-3 text-center text-slate-500 font-bold">{enTransito}</td>
                                            <td className="px-3 py-3 text-center text-purple-600 font-bold">{totalMayoristas}</td>
                                            <td className="px-3 py-3 text-center text-green-600 font-bold">{totalClientes}</td>
                                            <td className="px-3 py-3 text-center">
                                                <span className={`font-black px-2 py-0.5 rounded-full text-[10px] ${sobrevendido ? 'bg-red-100 text-red-600' : netDisponible === 0 ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                                                    {sobrevendido ? `−${Math.abs(netDisponible)} sobrevendido` : `${netDisponible} libres`}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot className="bg-navy/5">
                                {(() => {
                                    const ws = semanaDetails.filter(w => w.confirmed > 0);
                                    const totConf = ws.reduce((s,w)=>s+w.confirmed,0);
                                    const totRec  = ws.reduce((s,w)=>s+w.received,0);
                                    const totMay  = ws.reduce((s,w)=>s+w.titleDetails.reduce((x,t)=>x+(t.qtyMayorista||0),0),0);
                                    const totCli  = ws.reduce((s,w)=>s+w.titleDetails.reduce((x,t)=>x+(t.allocated||0),0),0);
                                    const totDisp = Math.max(0, totConf - totRec) - totMay - totCli;
                                    return (
                                        <tr className="font-black text-[10px]">
                                            <td className="px-4 py-3 text-navy uppercase">TOTAL</td>
                                            <td className="px-3 py-3 text-center text-blue-600">{totConf}</td>
                                            <td className="px-3 py-3 text-center text-slate-400">{totRec}</td>
                                            <td className="px-3 py-3 text-center text-slate-500">{Math.max(0,totConf-totRec)}</td>
                                            <td className="px-3 py-3 text-center text-purple-600">{totMay}</td>
                                            <td className="px-3 py-3 text-center text-green-600">{totCli}</td>
                                            <td className="px-3 py-3 text-center">
                                                <span className={`font-black px-2 py-0.5 rounded-full text-[10px] ${totDisp < 0 ? 'bg-red-100 text-red-600' : totDisp === 0 ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                                                    {totDisp < 0 ? `−${Math.abs(totDisp)} sobrevendido` : `${totDisp} libres`}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })()}
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* Timeline / Active Orders */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-muted uppercase tracking-[0.3em] flex items-center gap-2">
                        <Calendar size={16} className="text-primary" /> Próximos Arribos Estimados
                    </h4>
                    <span className="text-[10px] font-mono text-muted/60 uppercase tracking-widest bg-white/5 px-2 py-1 rounded">Basado en ciclo de 22 días</span>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    {semanaDetails.map((week, idx) => {
                        const isExpanded = expandedWeek === week.id;
                        return (
                            <div key={idx} className={`glass rounded-2xl border border-border/40 transition-all group ${isExpanded ? 'ring-2 ring-secondary/20 shadow-2xl' : 'hover:border-secondary/40'}`}>
                                <div 
                                    className="p-6 cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center gap-6"
                                    onClick={() => setExpandedWeek(isExpanded ? null : week.id)}
                                >
                                    <div className="flex items-center gap-6">
                                        <div className={`p-4 rounded-2xl flex flex-col items-center justify-center min-w-[70px] ${week.diasFaltantes <= 7 ? 'bg-orange-100 text-orange-600' : 'bg-secondary/10 text-secondary'}`}>
                                            <span className="text-xs font-black uppercase tracking-tighter leading-none">{week.fechaEstimada.toLocaleDateString('es', { month: 'short' })}</span>
                                            <span className="text-2xl font-black font-display">{week.fechaEstimada.getDate()}</span>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h5 className="text-lg font-bold text-navy uppercase tracking-tight">{week.nombre}</h5>
                                                {isExpanded ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
                                            </div>
                                            <div className="flex items-center gap-3 mt-1">
                                                {week.received > 0 ? (
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${week.received >= week.confirmed ? 'bg-emerald-500 text-white shadow-sm' : 'bg-green-100 text-green-600 border border-green-200'}`}>
                                                        {week.received >= week.confirmed ? 'MERCADERÍA RECIBIDA COMPLETA' : 'ARRIBANDO / EN RECEPCIÓN'}
                                                    </span>
                                                ) : (
                                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${week.diasFaltantes <= 0 ? 'bg-green-100 text-green-600' : (week.diasFaltantes <= 7 ? 'bg-orange-100 text-orange-600' : 'bg-sky/10 text-sky')}`}>
                                                        {week.diasFaltantes <= 0 ? 'LISTO PARA LLEGAR' : (week.diasFaltantes === 1 ? 'LLEGA MAÑANA' : `LLEGA EN ~${week.diasFaltantes} DÍAS`)}
                                                    </span>
                                                )}
                                                {week.isPending && (
                                                    <span className="text-[10px] font-black bg-accent text-white px-2 py-0.5 rounded-full flex items-center gap-1">
                                                        <Clock size={10} /> BUSCANDO CONFIRMACIÓN
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6 md:gap-10 w-full md:w-auto justify-between md:justify-end">
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Confirmado</div>
                                            <div className="text-xl font-bold text-secondary">{week.confirmed}</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Recortados</div>
                                            <div className="text-xl font-bold text-red-500">-{week.totalUnitsCut}</div>
                                        </div>
                                        <div className="text-center">
                                            <div className="text-[10px] font-bold text-muted uppercase tracking-widest mb-1">Extras</div>
                                            <div className="text-xl font-bold text-green-600">+{week.totalUnitsExtra}</div>
                                        </div>
                                        <div className="hidden md:block w-[120px] bg-white/10 h-2 rounded-full overflow-hidden relative border border-white/5">
                                        </div>
                                    </div>
                                </div>

                                <AnimatePresence>
                                    {isExpanded && (
                                        <motion.div 
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            className="border-t border-border/20 bg-secondary/5 overflow-hidden"
                                        >
                                            <div className="p-6">
                                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                                                    <h6 className="text-[10px] font-black text-secondary uppercase tracking-[0.2em] flex items-center gap-2">
                                                        <Package size={14} /> Títulos en este despacho
                                                    </h6>
                                                    
                                                    <div className="flex items-center gap-2 bg-white/50 p-1 rounded-xl border border-border/20 self-start">
                                                        <button 
                                                            onClick={() => setDetailFilter('all')}
                                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${detailFilter === 'all' ? 'bg-navy text-white shadow-md' : 'text-muted hover:bg-secondary/10'}`}
                                                        >
                                                            TODOS
                                                        </button>
                                                        <button 
                                                            onClick={() => setDetailFilter('cuts')}
                                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${detailFilter === 'cuts' ? 'bg-red-500 text-white shadow-md' : 'text-red-500 hover:bg-red-50'}`}
                                                        >
                                                            SOLO RECORTADOS
                                                        </button>
                                                        <button 
                                                            onClick={() => setDetailFilter('extras')}
                                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${detailFilter === 'extras' ? 'bg-green-600 text-white shadow-md' : 'text-green-600 hover:bg-green-50'}`}
                                                        >
                                                            SOLO EXTRAS
                                                        </button>
                                                    </div>
                                                </div>

                                                <div className="overflow-x-auto -mx-6 px-6 pb-4">
                                                    <table className="w-full text-[11px] md:text-sm border-separate border-spacing-0">
                                                        <thead>
                                                            <tr className="text-[10px] font-bold text-secondary uppercase tracking-widest border-b border-border/20">
                                                                <th className="sticky left-0 z-10 bg-secondary/5 px-4 py-3 text-left min-w-[180px] md:min-w-[320px] backdrop-blur-sm shadow-[2px_0_5px_rgba(0,0,0,0.02)]">Título</th>
                                                                <th className="px-2 md:px-4 py-3 text-center">Pedido</th>
                                                                <th className="px-2 md:px-4 py-3 text-center">Confirmado</th>
                                                                <th className="px-2 md:px-4 py-3 text-center">Reparto</th>
                                                                <th className="px-2 md:px-4 py-3 text-center">Recibido</th>
                                                                <th className="px-2 md:px-4 py-3 text-center">Diferencia</th>
                                                                <th className="px-4 py-3 text-right">Estado</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-border/10">
                                                            {week.titleDetails
                                                                .filter(t => {
                                                                    if (detailFilter === 'cuts') return t.isCut || t.isMissing;
                                                                    if (detailFilter === 'extras') return t.isExtra;
                                                                    return true;
                                                                })
                                                                .map((t, tIdx) => {
                                                                    const titleKey = `${week.id}-${(t.titulo || '').toLowerCase().trim()}`;
                                                                    const isTitleExp = expandedTitle?.weekId === week.id && expandedTitle?.title === (t.titulo || '').toLowerCase().trim();
                                                                    const titleOrders = clientItems.filter(ci => ci.semana_id === week.id && (ci.titulo || '').toLowerCase().trim() === (t.titulo || '').toLowerCase().trim());
                                                                    const allocatedCount = titleOrders.filter(ci => ci.estado === 'ADJUDICADO' || ci.estado === 'EN TIENDA').length;
                                                                    
                                                                    return (
                                                                        <React.Fragment key={titleKey}>
                                                                            <tr className={`hover:bg-white/40 transition-colors ${isTitleExp ? 'bg-secondary/5' : ''}`}>
                                                                                <td className="sticky left-0 z-20 bg-white px-4 py-3 min-w-[180px] md:min-w-[320px] shadow-[4px_0_10px_-4px_rgba(0,0,0,0.1)]">
                                                                                    <div className="flex items-start gap-2 py-0.5">
                                                                                        <button 
                                                                                            onClick={() => setExpandedTitle(isTitleExp ? null : { weekId: week.id, title: (t.titulo || '').toLowerCase().trim() })}
                                                                                            className="mt-0.5 p-1 hover:bg-secondary/10 rounded transition-colors text-secondary shrink-0"
                                                                                        >
                                                                                            {isTitleExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                                        </button>
                                                                                        <span className="font-bold text-navy leading-tight whitespace-normal break-words" title={t.titulo}>
                                                                                            {t.titulo}
                                                                                        </span>
                                                                                    </div>
                                                                                </td>
                                                                                <td className="px-2 md:px-4 py-3 text-center font-mono font-bold text-muted-2">{t.pedido || 0}</td>
                                                                                <td className="px-2 md:px-4 py-3 text-center font-black text-navy">{t.confirmado || 0}</td>
                                                                                <td className="px-2 md:px-4 py-3 text-center">
                                                                                    <div className="flex flex-col items-center gap-1">
                                                                                        {/* Badge total: retail adjudicado + mayoristas */}
                                                                                        <div className={`text-[9px] md:text-[10px] font-black px-2 py-0.5 rounded-full ${t.qtyTotalAllocated >= t.confirmado && t.confirmado > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                                                                                            {t.qtyTotalAllocated} / {t.confirmado}
                                                                                        </div>
                                                                                        {/* Indicador de reserva para mayoristas */}
                                                                                        {t.qtyMayorista > 0 && (
                                                                                            <span className="flex items-center gap-1 text-[8px] font-black text-blue-500">
                                                                                                <ShoppingBag size={8} /> {t.qtyMayorista} may.
                                                                                            </span>
                                                                                        )}
                                                                                        {t.needsAllocation && (
                                                                                            <span className="flex items-center gap-1 text-[8px] font-black text-orange-500 animate-pulse">
                                                                                                <AlertCircle size={8} /> PENDIENTE
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </td>
                                                                                <td className={`px-2 md:px-4 py-3 text-center font-black ${t.received > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
                                                                                    {t.received || 0}
                                                                                </td>
                                                                                <td className={`px-2 md:px-4 py-3 text-center font-bold ${t.pedido > t.confirmado ? 'text-red-500' : (t.confirmado > t.pedido ? 'text-green-600' : 'text-muted-2')}`}>
                                                                                    {t.pedido > t.confirmado ? `-${t.pedido - t.confirmado}` : (t.confirmado > t.pedido ? `+${t.confirmado - t.pedido}` : '-')}
                                                                                </td>
                                                                                <td className="px-4 py-3 text-right">
                                                                                    {t.received >= t.confirmado && t.confirmado > 0 ? (
                                                                                        <span className="bg-emerald-600 text-white text-[8px] md:text-[9px] font-black px-2 py-0.5 rounded shadow-[0_0_8px_rgba(16,185,129,0.4)] whitespace-nowrap">LLEGÓ COMPLETO</span>
                                                                                    ) : t.isMissing ? (
                                                                                        <span className="bg-red-500 text-white text-[8px] md:text-[9px] font-black px-2 py-0.5 rounded shadow-sm animate-pulse whitespace-nowrap">RECORTADO TOTAL</span>
                                                                                    ) : t.isCut ? (
                                                                                        <span className="bg-orange-500 text-white text-[8px] md:text-[9px] font-black px-2 py-0.5 rounded whitespace-nowrap">RECORTADO</span>
                                                                                    ) : t.isExtra ? (
                                                                                        <span className="bg-green-600 text-white text-[8px] md:text-[9px] font-black px-2 py-0.5 rounded shadow-[0_0_8px_rgba(22,163,74,0.4)] whitespace-nowrap">EXTRA</span>
                                                                                    ) : t.received > 0 ? (
                                                                                        <span className="bg-blue-500 text-white text-[8px] md:text-[9px] font-black px-2 py-0.5 rounded whitespace-nowrap">ARRIBANDO ({t.received})</span>
                                                                                    ) : (
                                                                                        <span className="bg-blue-600/10 text-blue-600 text-[8px] md:text-[9px] font-black px-2 py-0.5 rounded">EN CAMINO</span>
                                                                                    )}
                                                                                </td>
                                                                            </tr>
                                                                            {isTitleExp && (
                                                                                <tr className="bg-white/60">
                                                                                    <td colSpan="7" className="p-4 border-b border-secondary/10">
                                                                                        <div className="flex flex-col gap-4">

                                                                                            {/* ── Encabezado del panel ── */}
                                                                                            <div className="flex justify-between items-center">
                                                                                                <div className="text-[10px] font-black text-secondary uppercase tracking-widest flex items-center gap-2">
                                                                                                    <TrendingUp size={12} /> Adjudicación Preventiva (Planificar Reparto)
                                                                                                </div>
                                                                                                <div className="flex items-center gap-2">
                                                                                                    {isAdmin && (
                                                                                                        <>
                                                                                                            <button
                                                                                                                onClick={() => handleAutoAdjudicate(week.id, t.titulo, t.qtyAvailableForRetail)}
                                                                                                                disabled={actionLoading === titleKey || t.allocated >= t.qtyAvailableForRetail}
                                                                                                                className="bg-secondary text-white text-[9px] font-black px-3 py-1 rounded hover:bg-secondary/90 disabled:opacity-50 flex items-center gap-1 transition-all"
                                                                                                            >
                                                                                                                {actionLoading === titleKey ? '...' : <><Check size={10} /> AUTO-REPARTO</>}
                                                                                                            </button>
                                                                                                            <button
                                                                                                                onClick={() => handleClearAllocation(week.id, t.titulo)}
                                                                                                                className="bg-red-100 text-red-600 text-[9px] font-black px-3 py-1 rounded hover:bg-red-200 transition-all"
                                                                                                            >
                                                                                                                LIMPIAR
                                                                                                            </button>
                                                                                                        </>
                                                                                                    )}
                                                                                                    <div className="text-[10px] font-bold text-muted ml-2">
                                                                                                        Retail: {allocatedCount}/{t.qtyAvailableForRetail} · Total: {t.qtyTotalAllocated}/{t.confirmado}
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>

                                                                                            {/* ── Sección MAYORISTAS (si hay) ── */}
                                                                                            {t.mayoristaOrd && t.mayoristaOrd.length > 0 && (
                                                                                                <div>
                                                                                                    <div className="text-[9px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1 mb-2">
                                                                                                        <ShoppingBag size={10} /> Mayoristas — {t.qtyMayorista} unid. reservadas
                                                                                                    </div>
                                                                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                                                                                        {t.mayoristaOrd.map(mi => {
                                                                                                            const isConf       = (mi.estado || '').startsWith('CONFIRMADO') || mi.estado === 'EN TIENDA' || mi.estado === 'DESPACHADO';
                                                                                                            const isRec        = mi.estado === 'RECORTADO';
                                                                                                            const isRepedido   = mi.estado === 'RECORTADO_REPEDIDO';
                                                                                                            const isCancelado  = mi.estado === 'CANCELADO';
                                                                                                            const isDone       = isRepedido || isCancelado;
                                                                                                            // Recorte parcial: item CONFIRMADO pero el título tuvo corte
                                                                                                            const faltanteQty  = (t.pedido > t.confirmado && t.confirmado > 0) ? (t.pedido - t.confirmado) : 0;
                                                                                                            const isConfParcial = isConf && faltanteQty > 0;
                                                                                                            return (
                                                                                                                <div key={mi.id} className={`p-3 rounded-lg border flex flex-col gap-1.5 ${isConfParcial ? 'border-orange-200 bg-orange-50/50' : isConf ? 'border-blue-200 bg-blue-50/60' : isRec ? 'border-red-200 bg-red-50/50' : isDone ? 'border-gray-200 bg-gray-50/50 opacity-60' : 'border-border/40 bg-white/60'}`}>
                                                                                                                    <div className="flex items-center justify-between gap-2">
                                                                                                                        <div className="flex flex-col min-w-0">
                                                                                                                            <span className="text-[12px] font-black truncate text-navy">{mi.pedido?.vendedor_nombre || 'Mayorista'}</span>
                                                                                                                            <span className="text-[9px] text-muted">{mi.cantidad} unid.</span>
                                                                                                                            <span className={`text-[8px] font-black uppercase mt-0.5 ${isConfParcial ? 'text-orange-600' : isConf ? 'text-blue-600' : isRec ? 'text-red-500' : isRepedido ? 'text-emerald-600' : isCancelado ? 'text-gray-400' : 'text-orange-500'}`}>
                                                                                                                                {isConfParcial ? `⚠️ PARCIAL (${faltanteQty} FALTANTE${faltanteQty > 1 ? 'S' : ''})` : isConf ? '✓ CONFIRMADO' : isRec ? '✂️ RECORTADO' : isRepedido ? '↻ REPEDIDO' : isCancelado ? '✗ CANCELADO' : '⏳ PEDIDO'}
                                                                                                                            </span>
                                                                                                                        </div>
                                                                                                                        <ShoppingBag size={16} className={isConfParcial ? 'text-orange-400' : isConf ? 'text-blue-400' : 'text-muted/40'} />
                                                                                                                    </div>
                                                                                                                    {/* Acciones para ítems RECORTADO (solo admin) */}
                                                                                                                    {isAdmin && isRec && (
                                                                                                                        <div className="flex gap-1.5 pt-1 border-t border-red-100">
                                                                                                                            <button
                                                                                                                                onClick={() => { setReprogramModal({ mi, weekId: w.id }); setReprogramQty(mi.cantidad); setReprogramSemana(''); }}
                                                                                                                                className="flex-1 text-[9px] font-black text-white bg-blue-500 hover:bg-blue-600 rounded px-2 py-1 transition-colors"
                                                                                                                            >↻ Re-programar</button>
                                                                                                                            <button
                                                                                                                                onClick={() => handleCancelarMayorista(mi.id)}
                                                                                                                                disabled={saving}
                                                                                                                                className="text-[9px] font-black text-red-500 hover:bg-red-100 border border-red-200 rounded px-2 py-1 transition-colors disabled:opacity-40"
                                                                                                                            >✗ Cancelar</button>
                                                                                                                        </div>
                                                                                                                    )}
                                                                                                                    {/* Acciones para recorte parcial: CONFIRMADO pero con unidades faltantes */}
                                                                                                                    {isAdmin && isConfParcial && (
                                                                                                                        <div className="flex flex-col gap-1 pt-1 border-t border-orange-200">
                                                                                                                            <p className="text-[8px] text-orange-600 font-bold">
                                                                                                                                Entelequia entregó {t.confirmado}/{t.pedido} — ¿qué hacemos con {faltanteQty} unidad{faltanteQty > 1 ? 'es' : ''}?
                                                                                                                            </p>
                                                                                                                            <div className="flex gap-1.5">
                                                                                                                                <button
                                                                                                                                    onClick={() => { setReprogramModal({ mi: { ...mi, cantidad: faltanteQty }, weekId: w.id }); setReprogramQty(faltanteQty); setReprogramSemana(''); }}
                                                                                                                                    className="flex-1 text-[9px] font-black text-white bg-blue-500 hover:bg-blue-600 rounded px-2 py-1 transition-colors"
                                                                                                                                >↻ Re-prog. siguiente semana</button>
                                                                                                                                <button
                                                                                                                                    onClick={() => handleMarcarRecortado(mi, t.confirmado, faltanteQty, week.nombre)}
                                                                                                                                    disabled={saving}
                                                                                                                                    className="text-[9px] font-black text-red-500 hover:bg-red-100 border border-red-200 rounded px-2 py-1 transition-colors disabled:opacity-40"
                                                                                                                                >✗ Cancelar faltante</button>
                                                                                                                            </div>
                                                                                                                        </div>
                                                                                                                    )}
                                                                                                                </div>
                                                                                                            );
                                                                                                        })}
                                                                                                    </div>
                                                                                                </div>
                                                                                            )}

                                                                                            {/* ── Sección CLIENTES RETAIL ── */}
                                                                                            <div>
                                                                                                {t.mayoristaOrd?.length > 0 && (
                                                                                                    <div className="text-[9px] font-black text-secondary uppercase tracking-widest flex items-center gap-1 mb-2">
                                                                                                        <TrendingUp size={10} /> Clientes Retail — {allocatedCount}/{t.qtyAvailableForRetail} adjudicados
                                                                                                    </div>
                                                                                                )}
                                                                                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                                                                                    {titleOrders.map(ci => {
                                                                                                        const isAdjudicado = ci.estado === 'ADJUDICADO' || ci.estado === 'EN TIENDA';
                                                                                                        const isRecortado = ci.estado === 'RECORTADO';
                                                                                                        const canAdjudicate = allocatedCount < t.qtyAvailableForRetail || isAdjudicado;
                                                                                                        const vendedorNombre = ci.vendedores?.nombre || 'Sin vendedor';
                                                                                                        return (
                                                                                                            <div
                                                                                                                key={ci.id}
                                                                                                                onClick={async () => {
                                                                                                                    if (!isAdmin || saving || (!isAdjudicado && !canAdjudicate)) return;
                                                                                                                    setSaving(true);
                                                                                                                    try {
                                                                                                                        const newStatus = isAdjudicado ? 'CONFIRMADO' : 'ADJUDICADO';
                                                                                                                        const { error } = await supabase.from('cliente_items').update({ estado: newStatus }).eq('id', ci.id);
                                                                                                                        if (error) throw error;
                                                                                                                        await fetchDashboardData();
                                                                                                                    } catch (err) { alert(err.message); }
                                                                                                                    finally { setSaving(false); }
                                                                                                                }}
                                                                                                                className={`p-3 rounded-lg border flex items-center justify-between gap-2 transition-all ${isAdmin ? 'cursor-pointer' : ''} ${isAdjudicado ? 'border-secondary bg-secondary/5' : (isRecortado ? 'border-red-200 bg-red-50/50 opacity-60' : (canAdjudicate ? 'border-border/40 hover:border-secondary/30' : 'opacity-40 grayscale pointer-events-none'))}`}
                                                                                                            >
                                                                                                                <div className="flex flex-col min-w-0">
                                                                                                                    <span className={`text-[12px] font-black truncate ${isRecortado ? 'text-red-900/60 line-through' : 'text-navy'}`}>{ci.clientes?.nombre || 'Cliente desconocido'}</span>
                                                                                                                    <span className="text-[9px] text-muted truncate">{ci.clientes?.celular || ''}{vendedorNombre !== 'Sin vendedor' ? ` · ${vendedorNombre}` : ''}</span>
                                                                                                                    <span className={`text-[8px] font-black uppercase mt-0.5 ${isAdjudicado ? 'text-secondary' : (isRecortado ? 'text-red-500' : 'text-orange-500')}`}>{isAdjudicado ? '✓ ADJUDICADO' : (isRecortado ? '✂️ RECORTADO' : '⏳ PENDIENTE')}</span>
                                                                                                                </div>
                                                                                                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${isAdjudicado ? 'bg-secondary border-secondary text-white' : (isRecortado ? 'border-red-300 text-red-400' : 'border-border')}`}>
                                                                                                                    {isAdjudicado && <Check size={11} />}
                                                                                                                    {isRecortado && <X size={11} />}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                    {titleOrders.length === 0 && <div className="col-span-full py-2 text-center text-[10px] text-muted italic">No hay pedidos de clientes retail para este título.</div>}
                                                                                                </div>
                                                                                            </div>

                                                                                            {/* ── Botón procesar recortes ── */}
                                                                                            {isAdmin && t.isCut && titleOrders.some(ci => ci.estado !== 'ADJUDICADO' && ci.estado !== 'EN TIENDA' && ci.estado !== 'RECORTADO') && (
                                                                                                <div className="pt-2 border-t border-border/10">
                                                                                                    <button
                                                                                                        onClick={async () => {
                                                                                                            if (!confirm("¿Deseas marcar los pedidos no adjudicados como RECORTADOS?")) return;
                                                                                                            setSaving(true);
                                                                                                            try {
                                                                                                                const unallocatedIds = titleOrders.filter(ci => ci.estado !== 'ADJUDICADO' && ci.estado !== 'EN TIENDA' && ci.estado !== 'RECORTADO').map(ci => ci.id);
                                                                                                                const { error } = await supabase.from('cliente_items').update({ estado: 'RECORTADO' }).in('id', unallocatedIds);
                                                                                                                if (error) throw error;
                                                                                                                await fetchDashboardData();
                                                                                                            } catch (err) { alert(err.message); }
                                                                                                            finally { setSaving(false); }
                                                                                                        }}
                                                                                                        className="text-[9px] font-black text-red-500 uppercase hover:bg-red-50 px-2 py-1 rounded"
                                                                                                    >
                                                                                                        Procesar Recortes para este título
                                                                                                    </button>
                                                                                                </div>
                                                                                            )}

                                                                                        </div>
                                                                                    </td>
                                                                                </tr>
                                                                            )}
                                                                        </React.Fragment>
                                                                    );
                                                                })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* General Info / Legend */}
            <div className="p-6 bg-navy text-white/80 rounded-3xl border border-white/5 shadow-inner flex items-center gap-6">
                <Info className="text-primary shrink-0" size={24} />
                <div className="text-xs leading-relaxed">
                    <strong className="text-white">Auditando discrepancias</strong>: En esta vista, comparamos tus pedidos iniciales contra el Excel maestro. Los ítems marcados como <span className="text-red-400 font-bold">RECORTADOS</span> son aquellos que pediste pero el distribuidor no enviará. Los ítems <span className="text-green-400 font-bold">EXTRAS</span> son mangas que no pediste originalmente pero vienen en camino.
                </div>
            </div>

            {/* ── Modal Re-programar ítem mayorista ── */}
            {reprogramModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={e => { if (e.target === e.currentTarget) setReprogramModal(null); }}>
                    <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                        <h3 className="text-base font-black text-navy mb-1">↻ Re-programar ítem mayorista</h3>
                        <p className="text-[11px] text-muted mb-1 font-medium">Vendedor: <span className="font-black text-navy">{reprogramModal.mi.pedido?.vendedor_nombre}</span></p>
                        <p className="text-[12px] font-black text-navy truncate mb-4">{reprogramModal.mi.titulo}</p>

                        <div className="space-y-4">
                            {/* Cantidad */}
                            <div>
                                <label className="text-[10px] font-black text-muted uppercase tracking-wider block mb-1">Cantidad a re-pedir</label>
                                <div className="flex items-center gap-3">
                                    <button onClick={() => setReprogramQty(q => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-base font-bold hover:bg-gray-50 transition-colors">−</button>
                                    <span className="text-xl font-black w-8 text-center text-navy">{reprogramQty}</span>
                                    <button onClick={() => setReprogramQty(q => q + 1)} className="w-8 h-8 rounded-lg border border-border flex items-center justify-center text-base font-bold hover:bg-gray-50 transition-colors">+</button>
                                    <span className="text-[10px] text-muted ml-1">(original: {reprogramModal.mi.cantidad})</span>
                                </div>
                            </div>

                            {/* Semana destino */}
                            <div>
                                <label className="text-[10px] font-black text-muted uppercase tracking-wider block mb-1">Semana destino</label>
                                <select
                                    value={reprogramSemana}
                                    onChange={e => setReprogramSemana(e.target.value)}
                                    className="w-full text-[11px] border border-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                    <option value="">— Elegir semana —</option>
                                    {semanaDetails
                                        .filter(s => s.id !== reprogramModal.weekId)
                                        .map(s => (
                                            <option key={s.id} value={s.id}>{s.nombre}</option>
                                        ))
                                    }
                                </select>
                            </div>
                        </div>

                        <div className="flex gap-2 mt-5">
                            <button
                                onClick={handleReProgramarMayorista}
                                disabled={!reprogramSemana || reprogramLoading}
                                className="flex-1 bg-primary text-white text-[11px] font-black rounded-xl py-2.5 hover:bg-primary/90 disabled:opacity-40 transition-colors"
                            >
                                {reprogramLoading ? 'Guardando...' : '↻ Confirmar re-pedido'}
                            </button>
                            <button
                                onClick={() => setReprogramModal(null)}
                                className="px-4 text-[11px] font-black text-muted border border-border rounded-xl py-2.5 hover:bg-gray-50 transition-colors"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
