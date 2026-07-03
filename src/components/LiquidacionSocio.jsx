import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Loader2, HandCoins, CheckCircle2, AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

// Reporte de liquidación al socio de cómics.
// Dinero del socio = Σ monto_pagado de los ítems marcados socio_comic (se calcula EN VIVO:
// marcar suma, desmarcar resta). Pendiente = cobrado − ya liquidado.
const CUENTAS = ['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)'];

export default function LiquidacionSocio() {
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState([]);
    const [liqs, setLiqs] = useState([]);
    const [monto, setMonto] = useState('');
    const [cuenta, setCuenta] = useState('Efectivo');
    const [nota, setNota] = useState('');
    const [saving, setSaving] = useState(false);

    const cargar = async () => {
        setLoading(true);
        const { data: its } = await supabase.from('cliente_items')
            .select('id, titulo, monto_pagado, precio_venta, estado, created_at, clientes(nombre)')
            .eq('socio_comic', true)
            .order('created_at', { ascending: false });
        setItems(its || []);
        const { data: ls } = await supabase.from('liquidaciones_socio').select('*').order('created_at', { ascending: false });
        setLiqs(ls || []);
        setLoading(false);
    };
    useEffect(() => { cargar(); }, []);

    const totalCobrado = items.reduce((s, i) => s + (Number(i.monto_pagado) || 0), 0);
    const totalVenta = items.reduce((s, i) => s + (Number(i.precio_venta) || 0), 0);
    const totalLiquidado = liqs.reduce((s, l) => s + (Number(l.monto) || 0), 0);
    const pendiente = totalCobrado - totalLiquidado;

    const registrar = async () => {
        const m = Number(monto) || 0;
        if (m <= 0) { alert('Poné un monto mayor a 0.'); return; }
        setSaving(true);
        try {
            await supabase.from('liquidaciones_socio').insert({ monto: m, cuenta, nota: nota || null });
            // Egreso en contabilidad (sale de la cuenta elegida)
            await supabase.from('caja_movimientos').insert({
                tipo: 'EGRESO', categoria: 'Pago a socio cómics',
                concepto: `Liquidación socio cómics${nota ? ' — ' + nota : ''}`,
                monto: m, metodo_pago: cuenta, origen: 'Socio', turno_id: null,
            });
            setMonto(''); setNota('');
            await cargar();
        } catch (e) { alert('Error al registrar: ' + (e.message || e)); }
        finally { setSaving(false); }
    };

    const borrarLiq = async (id) => {
        if (!confirm('¿Borrar esta liquidación? (también deberías borrar su egreso en Contabilidad a mano si ya no corresponde)')) return;
        await supabase.from('liquidaciones_socio').delete().eq('id', id);
        cargar();
    };

    const fmt = (n) => Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (loading) return <div className="flex items-center gap-2 text-muted p-8"><Loader2 className="animate-spin" size={18} /> Cargando…</div>;

    return (
        <div className="space-y-5">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-text flex items-center gap-2"><span className="text-xl">🦸</span> Liquidación Socio Cómics</h3>
                <button onClick={cargar} className="flex items-center gap-1.5 text-xs font-bold text-muted hover:text-primary"><RefreshCw size={13} /> Actualizar</button>
            </div>

            {/* Tarjetas resumen */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-surface border border-border/40 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest">Ítems marcados</p>
                    <p className="text-2xl font-black text-text">{items.length}</p>
                </div>
                <div className="bg-surface border border-border/40 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest">Cobrado (del socio)</p>
                    <p className="text-2xl font-black text-emerald-600 font-mono">Bs {fmt(totalCobrado)}</p>
                    <p className="text-[9px] text-muted mt-0.5">de Bs {fmt(totalVenta)} en ventas</p>
                </div>
                <div className="bg-surface border border-border/40 rounded-2xl p-4">
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest">Ya liquidado</p>
                    <p className="text-2xl font-black text-navy font-mono">Bs {fmt(totalLiquidado)}</p>
                </div>
                <div className={`rounded-2xl p-4 border ${pendiente < -0.005 ? 'bg-red-50 border-red-200' : pendiente > 0.005 ? 'bg-purple-500/10 border-purple-500/30' : 'bg-emerald-50 border-emerald-200'}`}>
                    <p className="text-[10px] font-black text-muted uppercase tracking-widest">{pendiente < -0.005 ? 'Le pagaste de más' : 'Pendiente de enviar'}</p>
                    <p className={`text-2xl font-black font-mono ${pendiente < -0.005 ? 'text-red-600' : pendiente > 0.005 ? 'text-purple-600' : 'text-emerald-600'}`}>Bs {fmt(Math.abs(pendiente))}</p>
                </div>
            </div>

            {pendiente < -0.005 && (
                <div className="flex items-center gap-2 text-red-600 text-xs font-bold bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <AlertTriangle size={14} /> Le liquidaste más de lo cobrado (quizá desmarcaste un ítem ya liquidado). El socio te debe Bs {fmt(Math.abs(pendiente))}.
                </div>
            )}

            {/* Registrar pago al socio */}
            <div className="bg-surface border border-border/40 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-black text-text uppercase tracking-widest flex items-center gap-1.5"><HandCoins size={14} className="text-purple-500" /> Registrar pago al socio</p>
                <div className="flex flex-wrap items-end gap-2">
                    <div>
                        <label className="block text-[10px] font-black text-muted uppercase mb-1">Monto Bs</label>
                        <input type="number" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" className="w-32 bg-background border border-border px-3 py-2 rounded-xl text-sm font-mono outline-none focus:border-purple-400" />
                    </div>
                    <div>
                        <label className="block text-[10px] font-black text-muted uppercase mb-1">Cuenta de salida</label>
                        <select value={cuenta} onChange={e => setCuenta(e.target.value)} className="bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-purple-400">
                            {CUENTAS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                        <label className="block text-[10px] font-black text-muted uppercase mb-1">Nota (opcional)</label>
                        <input type="text" value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: pago julio" className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-purple-400" />
                    </div>
                    <button onClick={registrar} disabled={saving} className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-black px-5 py-2.5 rounded-xl">
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Registrar
                    </button>
                </div>
                <p className="text-[10px] text-muted">Genera un egreso en Contabilidad desde la cuenta elegida.</p>
            </div>

            {/* Ítems marcados */}
            <div className="bg-surface border border-border/40 rounded-2xl overflow-hidden">
                <div className="px-4 py-2.5 bg-purple-500/5 border-b border-border/30 text-[11px] font-black text-purple-600 uppercase tracking-widest">Ítems del socio ({items.length})</div>
                <div className="max-h-96 overflow-y-auto divide-y divide-border/15">
                    {items.length === 0 ? (
                        <p className="text-xs text-muted p-4">Todavía no hay ítems marcados como del socio. Marcalos con el checkbox 🦸 en el pedido.</p>
                    ) : items.map(it => (
                        <div key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="min-w-0">
                                <p className="text-xs font-bold text-text truncate">{it.titulo}</p>
                                <p className="text-[10px] text-muted">{it.clientes?.nombre || '—'} · {it.estado}</p>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-xs font-black text-emerald-600 font-mono">Bs {fmt(it.monto_pagado)}</p>
                                <p className="text-[9px] text-muted">de Bs {fmt(it.precio_venta)}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Historial de liquidaciones */}
            {liqs.length > 0 && (
                <div className="bg-surface border border-border/40 rounded-2xl overflow-hidden">
                    <div className="px-4 py-2.5 bg-navy/5 border-b border-border/30 text-[11px] font-black text-navy uppercase tracking-widest">Pagos hechos al socio ({liqs.length})</div>
                    <div className="divide-y divide-border/15">
                        {liqs.map(l => (
                            <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                                <div className="min-w-0">
                                    <p className="text-xs font-bold text-text">Bs {fmt(l.monto)} <span className="text-muted font-normal">· {l.cuenta}</span></p>
                                    <p className="text-[10px] text-muted">{new Date(l.created_at).toLocaleString('es-BO')}{l.nota ? ' · ' + l.nota : ''}</p>
                                </div>
                                <button onClick={() => borrarLiq(l.id)} className="text-muted/40 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
