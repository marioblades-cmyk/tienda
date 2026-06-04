import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { ShieldAlert, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Trash2, Search, Filter, CheckCircle2, XCircle, Smartphone } from 'lucide-react';

// Formatea una hora ISO a HH:MM:SS.mmm
const fHora = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};
const fFecha = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
};

const ACCION_LABEL = {
    ABONAR: '💰 Abonar',
    NUEVO_PEDIDO: '🆕 Nuevo Pedido',
    DISTRIBUIR: '🔀 Distribuir',
    EDITAR_ITEM: '✏️ Editar ítem',
    EDITAR_CLIENTE: '✏️ Editar cliente',
    ELIMINAR_PAGO: '🗑️ Eliminar pago',
    ELIMINAR_CLIENTE: '🗑️ Eliminar cliente',
    ELIMINAR_ITEMS: '🗑️ Eliminar ítems',
};

export default function AuditLogView() {
    const [logs, setLogs] = useState([]);
    const [vendedores, setVendedores] = useState([]);
    const [anomalias, setAnomalias] = useState({ dobles: [], huerfanos: [] });
    const [loading, setLoading] = useState(true);
    const [filterVendedor, setFilterVendedor] = useState('todos');
    const [filterEstado, setFilterEstado] = useState('todos'); // todos | error
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState(new Set());

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [{ data: logsData }, { data: vends }] = await Promise.all([
                supabase.from('audit_log').select('*').order('client_ts', { ascending: false }).limit(3000),
                supabase.from('vendedores').select('id, nombre'),
            ]);
            setLogs(logsData || []);
            setVendedores(vends || []);
            await detectAnomalias();
        } catch (e) {
            console.error('Error cargando auditoría:', e);
        } finally {
            setLoading(false);
        }
    };

    // Detecta pagos dobles (mismo cliente+monto en <60s) y huérfanos (mov sin cliente_pago)
    const detectAnomalias = async () => {
        try {
            const { data: movs } = await supabase.from('caja_movimientos')
                .select('id, created_at, monto, concepto, vendedor_id')
                .eq('categoria', 'Cobro Pedido')
                .order('created_at', { ascending: false })
                .limit(800);
            const { data: pagos } = await supabase.from('cliente_pagos')
                .select('caja_mov_id').not('caja_mov_id', 'is', null);

            const pagoMovIds = new Set((pagos || []).map(p => p.caja_mov_id));
            const huerfanos = (movs || []).filter(m => !pagoMovIds.has(m.id));

            // dobles: mismo concepto + monto dentro de 60 seg
            const dobles = [];
            const sorted = [...(movs || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            for (let i = 0; i < sorted.length; i++) {
                for (let j = i + 1; j < sorted.length; j++) {
                    const dt = Math.abs(new Date(sorted[j].created_at) - new Date(sorted[i].created_at)) / 1000;
                    if (dt > 60) break;
                    if (sorted[i].concepto === sorted[j].concepto && Number(sorted[i].monto) === Number(sorted[j].monto)) {
                        dobles.push({ a: sorted[i], b: sorted[j], segundos: Math.round(dt * 10) / 10, sinPagoA: !pagoMovIds.has(sorted[i].id), sinPagoB: !pagoMovIds.has(sorted[j].id) });
                    }
                }
            }
            setAnomalias({ dobles, huerfanos });
        } catch (e) {
            console.error('Error detectando anomalías:', e);
        }
    };

    const borrarMovimiento = async (id, descripcion) => {
        if (!window.confirm(`¿Eliminar este movimiento de caja?\n\n${descripcion}\n\nEsta acción no se puede deshacer.`)) return;
        if (!window.confirm('Confirmá una vez más: se borrará el movimiento sobrante de la caja.')) return;
        try {
            // Solo borra si NO tiene cliente_pago vinculado (seguridad anti-error)
            const { data: pago } = await supabase.from('cliente_pagos').select('id').eq('caja_mov_id', id).limit(1);
            if (pago && pago.length > 0) {
                alert('Este movimiento SÍ tiene un pago vinculado. No se borra para no descuadrar la cuenta. Revisalo manualmente.');
                return;
            }
            await supabase.from('caja_movimientos').delete().eq('id', id);
            alert('✓ Movimiento sobrante eliminado.');
            await detectAnomalias();
        } catch (e) {
            alert('Error al eliminar: ' + e.message);
        }
    };

    // Agrupar logs por op_id
    const grupos = useMemo(() => {
        const byOp = {};
        logs.forEach(l => { (byOp[l.op_id] = byOp[l.op_id] || []).push(l); });
        return Object.entries(byOp).map(([opId, steps]) => {
            const ord = steps.sort((a, b) => new Date(a.client_ts) - new Date(b.client_ts));
            const inicio = ord.find(s => s.paso === 'INICIO') || ord[0];
            const hayError = ord.some(s => s.estado === 'error');
            const completo = ord.some(s => s.paso === 'FIN');
            return { opId, steps: ord, inicio, hayError, completo, ts: inicio.client_ts };
        }).sort((a, b) => new Date(b.ts) - new Date(a.ts));
    }, [logs]);

    // Detectar reintentos: mismo vendedor + cliente + acción dentro de 30s
    const gruposConReintento = useMemo(() => {
        const marcados = new Set();
        for (let i = 0; i < grupos.length; i++) {
            for (let j = i + 1; j < grupos.length; j++) {
                const dt = Math.abs(new Date(grupos[i].ts) - new Date(grupos[j].ts)) / 1000;
                if (dt > 30) continue;
                const a = grupos[i].inicio, b = grupos[j].inicio;
                if (a.vendedor_id === b.vendedor_id && a.cliente_id === b.cliente_id && a.accion === b.accion && a.cliente_id) {
                    marcados.add(grupos[i].opId); marcados.add(grupos[j].opId);
                }
            }
        }
        return marcados;
    }, [grupos]);

    const gruposFiltrados = useMemo(() => {
        return grupos.filter(g => {
            if (filterVendedor !== 'todos' && g.inicio.vendedor_id !== filterVendedor) return false;
            if (filterEstado === 'error' && !g.hayError) return false;
            if (search) {
                const s = search.toLowerCase();
                const txt = `${g.inicio.cliente_nombre || ''} ${g.inicio.vendedor_nombre || ''} ${g.inicio.accion || ''}`.toLowerCase();
                if (!txt.includes(s)) return false;
            }
            return true;
        });
    }, [grupos, filterVendedor, filterEstado, search]);

    const toggle = (opId) => setExpanded(prev => { const n = new Set(prev); n.has(opId) ? n.delete(opId) : n.add(opId); return n; });

    return (
        <div className="space-y-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-navy flex items-center gap-2">
                    <ShieldAlert className="text-orange-500" /> Auditoría de Acciones
                </h3>
                <button onClick={fetchAll} disabled={loading} className="flex items-center gap-2 bg-navy text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-navy/90 disabled:opacity-50">
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar
                </button>
            </div>

            {/* PANEL DE ANOMALÍAS */}
            {(anomalias.dobles.length > 0 || anomalias.huerfanos.length > 0) ? (
                <div className="bg-red-50 border-2 border-red-300 rounded-2xl overflow-hidden">
                    <div className="px-5 py-3 bg-red-100 flex items-center gap-2 border-b border-red-200">
                        <AlertTriangle size={18} className="text-red-600" />
                        <span className="font-black text-red-700 text-sm uppercase tracking-wide">
                            Anomalías detectadas ({anomalias.dobles.length + anomalias.huerfanos.length})
                        </span>
                    </div>
                    <div className="divide-y divide-red-100">
                        {anomalias.dobles.map((d, i) => (
                            <div key={`dob${i}`} className="px-5 py-3 flex items-center justify-between gap-4">
                                <div className="text-xs">
                                    <span className="font-black text-red-600">🔴 PAGO DOBLE</span>
                                    <span className="text-navy font-bold ml-2">{(d.a.concepto || '').replace('ABONO PEDIDO ', '').replace('Cobro Pedido', '')}</span>
                                    <span className="text-slate-500 ml-2">Bs {Number(d.a.monto).toFixed(2)} · 2 movimientos en {d.segundos}s</span>
                                    <span className="text-slate-400 ml-2">{fFecha(d.a.created_at)} {fHora(d.a.created_at)}</span>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                    {d.sinPagoA && <button onClick={() => borrarMovimiento(d.a.id, `Doble · Bs ${d.a.monto} · ${fHora(d.a.created_at)}`)} className="text-[10px] font-black text-red-600 border border-red-300 px-2 py-1 rounded hover:bg-red-500 hover:text-white">Limpiar 1°</button>}
                                    {d.sinPagoB && <button onClick={() => borrarMovimiento(d.b.id, `Doble · Bs ${d.b.monto} · ${fHora(d.b.created_at)}`)} className="text-[10px] font-black text-red-600 border border-red-300 px-2 py-1 rounded hover:bg-red-500 hover:text-white">Limpiar 2°</button>}
                                    {!d.sinPagoA && !d.sinPagoB && <span className="text-[9px] text-slate-400 italic">ambos con pago — revisar manual</span>}
                                </div>
                            </div>
                        ))}
                        {anomalias.huerfanos.map((h, i) => (
                            <div key={`huer${i}`} className="px-5 py-3 flex items-center justify-between gap-4">
                                <div className="text-xs">
                                    <span className="font-black text-orange-600">🟠 HUÉRFANO</span>
                                    <span className="text-navy font-bold ml-2">{(h.concepto || '').replace('ABONO PEDIDO ', '')}</span>
                                    <span className="text-slate-500 ml-2">Bs {Number(h.monto).toFixed(2)} · movimiento sin pago vinculado</span>
                                    <span className="text-slate-400 ml-2">{fFecha(h.created_at)} {fHora(h.created_at)}</span>
                                </div>
                                <button onClick={() => borrarMovimiento(h.id, `Huérfano · Bs ${h.monto} · ${fHora(h.created_at)}`)} className="text-[10px] font-black text-orange-600 border border-orange-300 px-2 py-1 rounded hover:bg-orange-500 hover:text-white shrink-0">Limpiar</button>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-3 text-emerald-700 font-bold text-sm flex items-center gap-2">
                    <CheckCircle2 size={16} /> Sin anomalías detectadas (ni pagos dobles ni huérfanos)
                </div>
            )}

            {/* FILTROS */}
            <div className="flex flex-wrap items-center gap-3 bg-white border border-border/40 rounded-2xl p-4">
                <Filter size={16} className="text-slate-400" />
                <select value={filterVendedor} onChange={e => setFilterVendedor(e.target.value)} className="px-3 py-1.5 border border-border/40 rounded-lg text-xs font-bold bg-background outline-none">
                    <option value="todos">Todos los vendedores</option>
                    {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                </select>
                <button onClick={() => setFilterEstado(filterEstado === 'error' ? 'todos' : 'error')} className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all ${filterEstado === 'error' ? 'bg-red-500 text-white' : 'bg-background border border-border/40 text-slate-500'}`}>
                    Solo errores
                </button>
                <div className="flex items-center gap-1.5 flex-1 min-w-[180px]">
                    <Search size={14} className="text-slate-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar cliente, vendedor, acción…" className="flex-1 px-2 py-1.5 border border-border/40 rounded-lg text-xs outline-none" />
                </div>
                <span className="text-[10px] text-slate-400 font-mono">{gruposFiltrados.length} acciones</span>
            </div>

            {/* LÍNEA DE TIEMPO */}
            {loading ? (
                <div className="text-center py-10 text-slate-400 animate-pulse">Cargando registros…</div>
            ) : gruposFiltrados.length === 0 ? (
                <div className="text-center py-10 text-slate-400">No hay acciones registradas todavía. Hacé un abono para probar.</div>
            ) : (
                <div className="space-y-2">
                    {gruposFiltrados.map(g => {
                        const esReintento = gruposConReintento.has(g.opId);
                        const isOpen = expanded.has(g.opId);
                        return (
                            <div key={g.opId} className={`bg-white border rounded-xl overflow-hidden transition-all ${g.hayError ? 'border-red-300' : esReintento ? 'border-amber-300' : 'border-border/40'}`}>
                                <button onClick={() => toggle(g.opId)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left">
                                    {isOpen ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                                    <span className="font-mono text-[11px] text-slate-500 shrink-0">{fFecha(g.ts)} {fHora(g.ts)}</span>
                                    <span className="text-xs font-black text-navy shrink-0">👤 {g.inicio.vendedor_nombre || '—'}</span>
                                    <span className="text-xs font-bold text-primary shrink-0">{ACCION_LABEL[g.inicio.accion] || g.inicio.accion}</span>
                                    <span className="text-xs text-slate-500 truncate flex-1">{g.inicio.cliente_nombre || ''}</span>
                                    {g.inicio.detalle?.monto != null && <span className="text-xs font-bold text-slate-600 shrink-0">Bs {Number(g.inicio.detalle.monto).toFixed(2)}</span>}
                                    {g.hayError ? <span className="text-[10px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-full shrink-0">✗ FALLÓ</span>
                                        : esReintento ? <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full shrink-0">⚠️ REINTENTO</span>
                                        : g.completo ? <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">✓ OK</span>
                                        : <span className="text-[10px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full shrink-0">…</span>}
                                </button>
                                {isOpen && (
                                    <div className="px-4 pb-3 pt-1 bg-slate-50/50 border-t border-border/20">
                                        <div className="font-mono text-[11px] space-y-1 pl-6">
                                            {g.steps.map((s, i) => (
                                                <div key={i} className={`flex items-start gap-2 ${s.estado === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
                                                    <span className="shrink-0">{s.estado === 'error' ? <XCircle size={12} className="mt-0.5" /> : s.paso === 'INICIO' ? '▶' : s.paso === 'FIN' ? '■' : '├─'}</span>
                                                    <span className="shrink-0 text-slate-400">{fHora(s.client_ts)}</span>
                                                    <span className="font-bold shrink-0">{s.paso}</span>
                                                    {s.estado === 'error' && <span className="text-red-500">✗ {s.error_msg}</span>}
                                                    {s.detalle && <span className="text-slate-500">{JSON.stringify(s.detalle)}</span>}
                                                </div>
                                            ))}
                                            {g.inicio.dispositivo && (
                                                <div className="flex items-center gap-1.5 text-slate-400 pt-1.5 mt-1.5 border-t border-border/20">
                                                    <Smartphone size={11} /> <span className="truncate">{g.inicio.dispositivo}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
