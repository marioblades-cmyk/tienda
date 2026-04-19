import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import {
    HandCoins, Plus, X, ChevronDown, ChevronUp,
    Pencil, Trash2, AlertCircle, CheckCircle2, Clock,
    Search, ListFilter, TrendingUp, TrendingDown, Wallet, User
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const METODOS = ['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Efectivo Personal', 'Otros'];

const formatS = (n) => Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split('T')[0];

// ── TOAST ────────────────────────────────────────────────────────────────────
function Toast({ toasts }) {
    return (
        <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
            <AnimatePresence>
                {toasts.map(t => (
                    <motion.div key={t.id}
                        initial={{ opacity: 0, x: 60 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 60 }}
                        className={`flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-sm font-bold border pointer-events-auto
                            ${t.type === 'success' ? 'bg-success/10 text-success border-success/20' : 'bg-error/10 text-error border-error/20'}`}>
                        {t.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                        {t.msg}
                    </motion.div>
                ))}
            </AnimatePresence>
        </div>
    );
}

// ── MODAL BASE ───────────────────────────────────────────────────────────────
function Modal({ title, icon: Icon, onClose, children }) {
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="bg-surface w-full max-w-md rounded-2xl border border-border shadow-2xl">
                <div className="p-5 border-b border-border flex justify-between items-center bg-background rounded-t-2xl">
                    <h2 className="text-base font-black text-text flex items-center gap-2">
                        {Icon && <Icon size={18} className="text-primary" />} {title}
                    </h2>
                    <button onClick={onClose} className="text-muted hover:text-text"><X size={20} /></button>
                </div>
                <div className="p-5">{children}</div>
            </motion.div>
        </div>
    );
}

// ── MODAL: NUEVO / EDITAR PRÉSTAMO ───────────────────────────────────────────
function PrestamoModal({ prestamo, deudoresExistentes, onClose, onDone }) {
    const [form, setForm] = useState({
        deudor_nombre: prestamo?.deudor_nombre || '',
        monto_original: prestamo?.monto_original || '',
        fecha_prestamo: prestamo?.fecha_prestamo || today(),
        concepto: prestamo?.concepto || '',
        fecha_vencimiento: prestamo?.fecha_vencimiento || '',
        notas: prestamo?.notas || '',
        metodo_origen: prestamo?.metodo_origen || 'Efectivo',
        es_preexistente: prestamo?.es_preexistente || false,
    });
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const isEdit = !!prestamo;

    const sugerencias = useMemo(() => {
        if (!form.deudor_nombre.trim()) return deudoresExistentes;
        return deudoresExistentes.filter(d =>
            d.toLowerCase().includes(form.deudor_nombre.toLowerCase())
        );
    }, [form.deudor_nombre, deudoresExistentes]);

    const handleSave = async () => {
        if (!form.deudor_nombre.trim()) return alert('Ingresa el nombre del deudor.');
        const monto = parseFloat(form.monto_original);
        if (!monto || monto <= 0) return alert('Ingresa un monto válido.');
        setSaving(true);
        try {
            const payload = {
                deudor_nombre: form.deudor_nombre.trim(),
                monto_original: monto,
                fecha_prestamo: form.fecha_prestamo,
                concepto: form.concepto.trim() || null,
                fecha_vencimiento: form.fecha_vencimiento || null,
                notas: form.notas.trim() || null,
                metodo_origen: form.es_preexistente ? null : form.metodo_origen,
                es_preexistente: form.es_preexistente,
            };

            if (isEdit) {
                const { error } = await supabase.from('prestamos').update(payload).eq('id', prestamo.id);
                if (error) throw error;
            } else {
                let caja_mov_id = null;
                if (!form.es_preexistente) {
                    const concepto = `Préstamo otorgado a ${form.deudor_nombre.trim()}${form.concepto.trim() ? ' — ' + form.concepto.trim() : ''}`;
                    const { data: movData, error: movError } = await supabase
                        .from('caja_movimientos')
                        .insert([{
                            turno_id: null,
                            tipo: 'EGRESO',
                            categoria: 'Préstamo Otorgado',
                            concepto,
                            monto,
                            metodo_pago: form.metodo_origen,
                            origen: 'Préstamos',
                        }])
                        .select('id')
                        .single();
                    if (movError) throw movError;
                    caja_mov_id = movData.id;
                }
                const { error } = await supabase.from('prestamos').insert([{
                    ...payload,
                    estado: 'ACTIVO',
                    caja_mov_id,
                }]);
                if (error) throw error;
            }
            onDone();
            onClose();
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={isEdit ? 'Editar Préstamo' : 'Nuevo Préstamo'} icon={HandCoins} onClose={onClose}>
            <div className="space-y-3">
                {/* Deudor con autocomplete */}
                <div className="relative">
                    <label className="text-[10px] font-black uppercase text-muted tracking-widest">Deudor *</label>
                    <input
                        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary mt-1"
                        placeholder="Nombre del deudor"
                        value={form.deudor_nombre}
                        onChange={e => { set('deudor_nombre', e.target.value); setShowSuggestions(true); }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                        autoComplete="off"
                    />
                    {showSuggestions && sugerencias.length > 0 && (
                        <div className="absolute top-full left-0 w-full z-10 mt-1 bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
                            {sugerencias.map(d => (
                                <button key={d} type="button"
                                    onMouseDown={() => { set('deudor_nombre', d); setShowSuggestions(false); }}
                                    className="w-full text-left px-4 py-2.5 text-sm font-bold text-text hover:bg-primary/10 flex items-center gap-2 border-b border-border/50 last:border-0">
                                    <User size={13} className="text-primary shrink-0" /> {d}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Monto (Bs) *</label>
                        <input type="number" min="0" step="0.01"
                            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary mt-1"
                            placeholder="0.00" value={form.monto_original} onChange={e => set('monto_original', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Fecha *</label>
                        <input type="date"
                            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary mt-1"
                            value={form.fecha_prestamo} onChange={e => set('fecha_prestamo', e.target.value)} />
                    </div>
                </div>

                <label className="flex items-start gap-3 bg-background border border-border rounded-xl px-3 py-3 cursor-pointer hover:border-primary transition-colors">
                    <input type="checkbox" className="mt-0.5 accent-primary shrink-0"
                        checked={form.es_preexistente} onChange={e => set('es_preexistente', e.target.checked)} />
                    <div>
                        <p className="text-sm font-bold text-text">Deuda preexistente</p>
                        <p className="text-xs text-muted">El dinero ya fue entregado antes. No genera movimiento en contabilidad.</p>
                    </div>
                </label>

                {!form.es_preexistente && !isEdit && (
                    <div>
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Sale de la cuenta *</label>
                        <select className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary mt-1 cursor-pointer"
                            value={form.metodo_origen} onChange={e => set('metodo_origen', e.target.value)}>
                            {METODOS.map(m => <option key={m}>{m}</option>)}
                        </select>
                        <p className="text-[10px] text-muted mt-1">Se registrará un EGRESO en contabilidad por este monto.</p>
                    </div>
                )}

                <div>
                    <label className="text-[10px] font-black uppercase text-muted tracking-widest">Concepto / Motivo</label>
                    <input className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary mt-1"
                        placeholder="Ej: Préstamo para arriendo..." value={form.concepto} onChange={e => set('concepto', e.target.value)} />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-muted tracking-widest">Fecha vencimiento (opcional)</label>
                    <input type="date"
                        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary mt-1"
                        value={form.fecha_vencimiento} onChange={e => set('fecha_vencimiento', e.target.value)} />
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-muted tracking-widest">Notas</label>
                    <textarea rows={2}
                        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary mt-1 resize-none"
                        placeholder="Notas adicionales..." value={form.notas} onChange={e => set('notas', e.target.value)} />
                </div>
                <div className="flex gap-2 pt-2">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-muted text-sm font-bold hover:bg-background">Cancelar</button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-black hover:opacity-90 disabled:opacity-50">
                        {saving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : 'Crear Préstamo'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ── MODAL: REGISTRAR PAGO ────────────────────────────────────────────────────
function PagoModal({ prestamo, saldoPendiente, onClose, onDone }) {
    const [form, setForm] = useState({ monto: '', fecha: today(), metodo_pago: 'Efectivo', nota: '' });
    const [saving, setSaving] = useState(false);
    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

    const handleSave = async () => {
        const monto = parseFloat(form.monto);
        if (!monto || monto <= 0) return alert('Ingresa un monto válido.');
        if (monto > saldoPendiente + 0.01) return alert(`El pago (Bs ${formatS(monto)}) supera el saldo pendiente (Bs ${formatS(saldoPendiente)}).`);
        setSaving(true);
        try {
            const concepto = `Cobro préstamo — ${prestamo.deudor_nombre}${form.nota ? ' — ' + form.nota : ''}`;
            const { data: movData, error: movError } = await supabase
                .from('caja_movimientos')
                .insert([{
                    turno_id: null,
                    tipo: 'INGRESO',
                    categoria: 'Cobro Préstamo',
                    concepto,
                    monto,
                    metodo_pago: form.metodo_pago,
                    origen: 'Préstamos',
                }])
                .select('id')
                .single();
            if (movError) throw movError;

            const { error: pagoError } = await supabase.from('prestamos_pagos').insert([{
                prestamo_id: prestamo.id,
                monto,
                fecha: form.fecha,
                metodo_pago: form.metodo_pago,
                nota: form.nota.trim() || null,
                caja_mov_id: movData.id,
            }]);
            if (pagoError) throw pagoError;

            const nuevoPagado = (prestamo.totalPagado || 0) + monto;
            if (nuevoPagado >= prestamo.monto_original - 0.01) {
                await supabase.from('prestamos').update({ estado: 'CERRADO' }).eq('id', prestamo.id);
            }
            onDone();
            onClose();
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal title={`Pago — ${prestamo.deudor_nombre}`} icon={Wallet} onClose={onClose}>
            <div className="space-y-3">
                <div className="bg-background border border-border rounded-xl p-3 flex justify-between items-center">
                    <span className="text-xs text-muted font-bold uppercase tracking-widest">Saldo pendiente</span>
                    <span className="text-lg font-black text-orange-500">Bs {formatS(saldoPendiente)}</span>
                </div>
                {prestamo.concepto && (
                    <div className="text-xs text-muted bg-background border border-border rounded-xl px-3 py-2">
                        Préstamo: <span className="font-bold text-text">{prestamo.concepto}</span>
                    </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Monto a pagar (Bs) *</label>
                        <input type="number" min="0" step="0.01"
                            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary mt-1"
                            placeholder="0.00" value={form.monto} onChange={e => set('monto', e.target.value)} />
                    </div>
                    <div>
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Fecha *</label>
                        <input type="date"
                            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary mt-1"
                            value={form.fecha} onChange={e => set('fecha', e.target.value)} />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-muted tracking-widest">Entra a la cuenta *</label>
                    <select className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary mt-1 cursor-pointer"
                        value={form.metodo_pago} onChange={e => set('metodo_pago', e.target.value)}>
                        {METODOS.map(m => <option key={m}>{m}</option>)}
                    </select>
                    <p className="text-[10px] text-muted mt-1">Se registrará un INGRESO en contabilidad por este monto.</p>
                </div>
                <div>
                    <label className="text-[10px] font-black uppercase text-muted tracking-widest">Nota</label>
                    <input className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary mt-1"
                        placeholder="Nota opcional..." value={form.nota} onChange={e => set('nota', e.target.value)} />
                </div>
                <div className="flex gap-2 pt-2">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-muted text-sm font-bold hover:bg-background">Cancelar</button>
                    <button onClick={handleSave} disabled={saving}
                        className="flex-1 py-2.5 rounded-xl bg-success text-white text-sm font-black hover:opacity-90 disabled:opacity-50">
                        {saving ? 'Guardando...' : 'Registrar Pago'}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

// ── FILA DE DEUDOR (agrupada) ────────────────────────────────────────────────
function DeudorRow({ grupo, onPago, onEdit, onDelete, onRefresh }) {
    const [expanded, setExpanded] = useState(false);
    const [pagosMap, setPagosMap] = useState({});
    const [expandedLoan, setExpandedLoan] = useState(null);
    const [loadingPagos, setLoadingPagos] = useState(false);
    const [deletingPago, setDeletingPago] = useState(null);

    const { deudor_nombre, prestamos, totalPrestado, totalPagado, saldoPendiente } = grupo;
    const porcentaje = Math.min(100, totalPrestado > 0 ? (totalPagado / totalPrestado) * 100 : 0);
    const tieneActivos = prestamos.some(p => p.estado === 'ACTIVO');
    const tieneVencidos = prestamos.some(p => p.estado === 'ACTIVO' && p.fecha_vencimiento && p.fecha_vencimiento < today());

    const handleExpand = async () => {
        if (!expanded) {
            setLoadingPagos(true);
            const ids = prestamos.map(p => p.id);
            const { data } = await supabase.from('prestamos_pagos')
                .select('*').in('prestamo_id', ids).order('fecha', { ascending: false });
            const map = {};
            (data || []).forEach(pg => {
                if (!map[pg.prestamo_id]) map[pg.prestamo_id] = [];
                map[pg.prestamo_id].push(pg);
            });
            setPagosMap(map);
            setLoadingPagos(false);
        }
        setExpanded(e => !e);
    };

    const handleDeletePago = async (pago, prestamo) => {
        if (!confirm(`¿Eliminar este pago de Bs ${formatS(pago.monto)}?`)) return;
        setDeletingPago(pago.id);
        if (pago.caja_mov_id) await supabase.from('caja_movimientos').delete().eq('id', pago.caja_mov_id);
        await supabase.from('prestamos_pagos').delete().eq('id', pago.id);
        if (prestamo.estado === 'CERRADO') {
            await supabase.from('prestamos').update({ estado: 'ACTIVO' }).eq('id', prestamo.id);
        }
        const { data } = await supabase.from('prestamos_pagos')
            .select('*').in('prestamo_id', prestamos.map(p => p.id)).order('fecha', { ascending: false });
        const map = {};
        (data || []).forEach(pg => {
            if (!map[pg.prestamo_id]) map[pg.prestamo_id] = [];
            map[pg.prestamo_id].push(pg);
        });
        setPagosMap(map);
        setDeletingPago(null);
        onRefresh();
    };

    const estadoBadge = saldoPendiente <= 0
        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-success/10 text-success border border-success/20">SALDADO</span>
        : tieneVencidos
        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-error/10 text-error border border-error/20">VENCIDO</span>
        : tieneActivos
        ? <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-primary/10 text-primary border border-primary/20">ACTIVO</span>
        : <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-success/10 text-success border border-success/20">CERRADO</span>;

    return (
        <>
            {/* Fila principal del deudor */}
            <tr className="border-b border-border hover:bg-background/60 transition-colors cursor-pointer" onClick={handleExpand}>
                <td className="px-4 py-3.5 w-8">
                    <span className="text-muted">
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </span>
                </td>
                <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            <User size={14} className="text-primary" />
                        </div>
                        <div>
                            <div className="font-black text-sm text-text">{deudor_nombre}</div>
                            <div className="text-[10px] text-muted">{prestamos.length} préstamo{prestamos.length !== 1 ? 's' : ''}</div>
                        </div>
                    </div>
                </td>
                <td className="px-4 py-3.5 text-sm font-bold text-right whitespace-nowrap">Bs {formatS(totalPrestado)}</td>
                <td className="px-4 py-3.5 text-sm text-success font-bold text-right whitespace-nowrap">Bs {formatS(totalPagado)}</td>
                <td className="px-4 py-3.5 text-sm font-black text-right whitespace-nowrap text-orange-500">
                    {saldoPendiente > 0 ? `Bs ${formatS(saldoPendiente)}` : '—'}
                </td>
                <td className="px-4 py-3.5 text-center">{estadoBadge}</td>
            </tr>
            {/* Barra de progreso */}
            <tr>
                <td colSpan={6} className="px-4 pb-1 pt-0">
                    <div className="h-1 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-success rounded-full transition-all" style={{ width: `${porcentaje}%` }} />
                    </div>
                </td>
            </tr>

            {/* Detalle expandido: préstamos individuales */}
            <AnimatePresence>
                {expanded && (
                    <tr>
                        <td colSpan={6} className="px-4 pb-4 pt-1">
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                                className="bg-background border border-border rounded-xl overflow-hidden">
                                <div className="px-4 py-2.5 border-b border-border bg-background">
                                    <span className="text-[10px] font-black uppercase text-muted tracking-widest">
                                        Historial de préstamos — {deudor_nombre}
                                    </span>
                                </div>
                                {loadingPagos ? (
                                    <div className="p-6 text-center text-xs text-muted">Cargando...</div>
                                ) : (
                                    <div className="divide-y divide-border/50">
                                        {prestamos.map(p => {
                                            const pPagos = pagosMap[p.id] || [];
                                            const pPagado = p.totalPagado || 0;
                                            const pPendiente = Math.max(0, p.monto_original - pPagado);
                                            const pPct = Math.min(100, p.monto_original > 0 ? (pPagado / p.monto_original) * 100 : 0);
                                            const isVencido = p.estado === 'ACTIVO' && p.fecha_vencimiento && p.fecha_vencimiento < today();
                                            const loanExpanded = expandedLoan === p.id;

                                            return (
                                                <div key={p.id} className="p-3">
                                                    {/* Cabecera del préstamo individual */}
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-xs font-black text-text">
                                                                    {new Date(p.fecha_prestamo + 'T12:00:00').toLocaleDateString('es-BO')}
                                                                </span>
                                                                {p.concepto && <span className="text-xs text-muted truncate">— {p.concepto}</span>}
                                                                {p.es_preexistente && (
                                                                    <span className="text-[9px] font-black bg-border text-muted/70 px-1.5 rounded uppercase">Preexistente</span>
                                                                )}
                                                                {p.metodo_origen && (
                                                                    <span className="text-[9px] text-muted">desde: {p.metodo_origen}</span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-4 mt-1">
                                                                <span className="text-xs text-muted">Prestado: <strong className="text-text">Bs {formatS(p.monto_original)}</strong></span>
                                                                <span className="text-xs text-success">Pagado: <strong>Bs {formatS(pPagado)}</strong></span>
                                                                {pPendiente > 0 && <span className="text-xs text-orange-500 font-black">Pendiente: Bs {formatS(pPendiente)}</span>}
                                                            </div>
                                                            <div className="h-1 bg-border rounded-full overflow-hidden mt-1.5 max-w-xs">
                                                                <div className="h-full bg-success rounded-full" style={{ width: `${pPct}%` }} />
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0">
                                                            {/* Estado chip */}
                                                            {p.estado === 'CERRADO'
                                                                ? <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-success/10 text-success border border-success/20">CERRADO</span>
                                                                : isVencido
                                                                ? <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-error/10 text-error border border-error/20">VENCIDO</span>
                                                                : <span className="px-2 py-0.5 rounded-full text-[9px] font-black bg-primary/10 text-primary border border-primary/20">ACTIVO</span>
                                                            }
                                                            {/* Ver pagos */}
                                                            <button
                                                                onClick={() => setExpandedLoan(loanExpanded ? null : p.id)}
                                                                className="p-1.5 rounded-lg hover:bg-border text-muted hover:text-text transition-colors">
                                                                {loanExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                                            </button>
                                                            {/* Registrar pago */}
                                                            {p.estado === 'ACTIVO' && (
                                                                <button onClick={() => onPago(p, pPendiente)}
                                                                    className="px-2 py-1 rounded-lg bg-success/10 text-success text-[10px] font-black hover:bg-success/20 transition-colors flex items-center gap-1">
                                                                    <Plus size={11} /> Pago
                                                                </button>
                                                            )}
                                                            {/* Editar */}
                                                            <button onClick={() => onEdit(p)}
                                                                className="p-1.5 rounded-lg hover:bg-background text-muted hover:text-primary transition-colors">
                                                                <Pencil size={13} />
                                                            </button>
                                                            {/* Eliminar */}
                                                            <button onClick={() => onDelete(p)}
                                                                className="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors">
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Historial de pagos del préstamo */}
                                                    <AnimatePresence>
                                                        {loanExpanded && (
                                                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                                                                className="mt-2 border border-border/50 rounded-lg overflow-hidden">
                                                                {pPagos.length === 0 ? (
                                                                    <div className="px-4 py-3 text-xs text-muted text-center">Sin pagos registrados.</div>
                                                                ) : (
                                                                    <table className="w-full text-xs">
                                                                        <thead>
                                                                            <tr className="bg-surface/50 text-muted border-b border-border/50">
                                                                                <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest">Fecha</th>
                                                                                <th className="text-right px-3 py-1.5 font-black uppercase tracking-widest">Monto</th>
                                                                                <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest">Cuenta</th>
                                                                                <th className="text-left px-3 py-1.5 font-black uppercase tracking-widest">Nota</th>
                                                                                <th className="px-3 py-1.5 w-8" />
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {pPagos.map(pg => (
                                                                                <tr key={pg.id} className="border-b border-border/30 hover:bg-surface/50">
                                                                                    <td className="px-3 py-1.5 text-muted">{new Date(pg.fecha + 'T12:00:00').toLocaleDateString('es-BO')}</td>
                                                                                    <td className="px-3 py-1.5 text-right font-bold text-success">Bs {formatS(pg.monto)}</td>
                                                                                    <td className="px-3 py-1.5 text-muted">{pg.metodo_pago || '—'}</td>
                                                                                    <td className="px-3 py-1.5 text-muted italic">{pg.nota || '—'}</td>
                                                                                    <td className="px-3 py-1.5 text-right">
                                                                                        <button onClick={() => handleDeletePago(pg, p)} disabled={deletingPago === pg.id}
                                                                                            className="p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-colors disabled:opacity-40">
                                                                                            <Trash2 size={11} />
                                                                                        </button>
                                                                                    </td>
                                                                                </tr>
                                                                            ))}
                                                                        </tbody>
                                                                    </table>
                                                                )}
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </motion.div>
                        </td>
                    </tr>
                )}
            </AnimatePresence>
        </>
    );
}

// ── VISTA PRINCIPAL ──────────────────────────────────────────────────────────
export default function PrestamosView() {
    const [prestamos, setPrestamos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [toasts, setToasts] = useState([]);
    const [busqueda, setBusqueda] = useState('');
    const [filtroEstado, setFiltroEstado] = useState('TODOS');
    const [modalNuevo, setModalNuevo] = useState(false);
    const [modalEditar, setModalEditar] = useState(null);
    const [modalPago, setModalPago] = useState(null);

    const toast = (msg, type = 'success') => {
        const id = Date.now();
        setToasts(t => [...t, { id, msg, type }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
    };

    const fetchPrestamos = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('prestamos')
                .select('*, prestamos_pagos(monto)')
                .order('fecha_prestamo', { ascending: false });
            if (error) throw error;
            setPrestamos((data || []).map(p => ({
                ...p,
                totalPagado: (p.prestamos_pagos || []).reduce((s, pp) => s + (pp.monto || 0), 0),
            })));
        } catch (e) {
            toast('Error al cargar préstamos: ' + e.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchPrestamos(); }, []);

    const handleDelete = async (prestamo) => {
        if (!confirm(`¿Eliminar el préstamo de ${prestamo.deudor_nombre}? Se eliminarán también sus pagos y movimientos contables.`)) return;
        if (prestamo.caja_mov_id) {
            await supabase.from('caja_movimientos').delete().eq('id', prestamo.caja_mov_id);
        }
        const { data: pagos } = await supabase.from('prestamos_pagos').select('caja_mov_id').eq('prestamo_id', prestamo.id);
        const movIds = (pagos || []).map(p => p.caja_mov_id).filter(Boolean);
        if (movIds.length > 0) await supabase.from('caja_movimientos').delete().in('id', movIds);
        const { error } = await supabase.from('prestamos').delete().eq('id', prestamo.id);
        if (error) { toast('Error al eliminar: ' + error.message, 'error'); return; }
        toast('Préstamo eliminado.');
        fetchPrestamos();
    };

    // Lista única de deudores para autocomplete
    const deudoresExistentes = useMemo(() => {
        const nombres = [...new Set(prestamos.map(p => p.deudor_nombre.trim()))].sort();
        return nombres;
    }, [prestamos]);

    // Filtrado plano
    const filtered = useMemo(() => prestamos.filter(p => {
        const matchBusqueda = !busqueda
            || p.deudor_nombre.toLowerCase().includes(busqueda.toLowerCase())
            || (p.concepto || '').toLowerCase().includes(busqueda.toLowerCase());
        const matchEstado = filtroEstado === 'TODOS' || p.estado === filtroEstado;
        return matchBusqueda && matchEstado;
    }), [prestamos, busqueda, filtroEstado]);

    // Agrupado por deudor
    const gruposPorDeudor = useMemo(() => {
        const map = {};
        filtered.forEach(p => {
            const key = p.deudor_nombre.trim().toLowerCase();
            if (!map[key]) map[key] = {
                deudor_nombre: p.deudor_nombre.trim(),
                prestamos: [],
                totalPrestado: 0,
                totalPagado: 0,
                saldoPendiente: 0,
            };
            map[key].prestamos.push(p);
            map[key].totalPrestado += p.monto_original;
            map[key].totalPagado += p.totalPagado;
            map[key].saldoPendiente += Math.max(0, p.monto_original - p.totalPagado);
        });
        return Object.values(map).sort((a, b) => b.saldoPendiente - a.saldoPendiente);
    }, [filtered]);

    const totalPrestado = prestamos.reduce((s, p) => s + p.monto_original, 0);
    const totalRecuperado = prestamos.reduce((s, p) => s + p.totalPagado, 0);
    const saldoPendiente = Math.max(0, totalPrestado - totalRecuperado);
    const activos = prestamos.filter(p => p.estado === 'ACTIVO').length;

    const kpis = [
        { label: 'Total Prestado',    value: `Bs ${formatS(totalPrestado)}`,    icon: TrendingUp,   color: 'text-primary',    bg: 'bg-primary/10' },
        { label: 'Total Recuperado',  value: `Bs ${formatS(totalRecuperado)}`,  icon: TrendingDown, color: 'text-success',    bg: 'bg-success/10' },
        { label: 'Saldo Pendiente',   value: `Bs ${formatS(saldoPendiente)}`,   icon: Wallet,       color: 'text-orange-500', bg: 'bg-orange-100' },
        { label: 'Préstamos Activos', value: activos,                           icon: Clock,        color: 'text-blue-500',   bg: 'bg-blue-50' },
    ];

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <Toast toasts={toasts} />

            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2.5 rounded-xl">
                        <HandCoins size={22} className="text-primary" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-text">Préstamos</h1>
                        <p className="text-xs text-muted">Seguimiento de préstamos otorgados</p>
                    </div>
                </div>
                <button onClick={() => setModalNuevo(true)}
                    className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-black hover:opacity-90 transition-opacity shadow-lg shadow-primary/20">
                    <Plus size={16} /> Nuevo Préstamo
                </button>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {kpis.map(k => (
                    <div key={k.label} className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-3 shadow-sm">
                        <div className={`${k.bg} p-2.5 rounded-xl shrink-0`}>
                            <k.icon size={20} className={k.color} />
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase text-muted tracking-widest">{k.label}</p>
                            <p className={`text-lg font-black ${k.color}`}>{k.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filtros */}
            <div className="bg-surface border border-border rounded-2xl p-4 flex flex-wrap gap-3 items-center shadow-sm">
                <div className="flex items-center gap-2 bg-background border border-border rounded-xl px-3 py-2 flex-1 min-w-[180px]">
                    <Search size={14} className="text-muted shrink-0" />
                    <input className="bg-transparent text-sm outline-none flex-1 text-text placeholder:text-muted"
                        placeholder="Buscar deudor o concepto..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                    <ListFilter size={14} className="text-muted" />
                    {['TODOS', 'ACTIVO', 'CERRADO'].map(e => (
                        <button key={e} onClick={() => setFiltroEstado(e)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-black border transition-all
                                ${filtroEstado === e
                                    ? 'bg-primary text-white border-primary'
                                    : 'bg-background text-muted border-border hover:border-primary hover:text-primary'}`}>
                            {e}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tabla agrupada */}
            <div className="bg-surface border border-border rounded-2xl shadow-sm overflow-hidden">
                {loading ? (
                    <div className="p-12 text-center text-muted text-sm">Cargando préstamos...</div>
                ) : gruposPorDeudor.length === 0 ? (
                    <div className="p-12 text-center">
                        <HandCoins size={40} className="text-muted/30 mx-auto mb-3" />
                        <p className="text-muted text-sm font-bold">
                            {prestamos.length === 0 ? 'Aún no hay préstamos registrados.' : 'Sin resultados para los filtros aplicados.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-border bg-background">
                                    <th className="px-4 py-3 w-8" />
                                    <th className="px-4 py-3 text-left text-[10px] font-black uppercase text-muted tracking-widest">Deudor</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-black uppercase text-muted tracking-widest">Total Prestado</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-black uppercase text-muted tracking-widest">Total Pagado</th>
                                    <th className="px-4 py-3 text-right text-[10px] font-black uppercase text-muted tracking-widest">Pendiente</th>
                                    <th className="px-4 py-3 text-center text-[10px] font-black uppercase text-muted tracking-widest">Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                {gruposPorDeudor.map(grupo => (
                                    <DeudorRow
                                        key={grupo.deudor_nombre}
                                        grupo={grupo}
                                        onPago={(pr, saldo) => setModalPago({ prestamo: pr, saldo })}
                                        onEdit={pr => setModalEditar(pr)}
                                        onDelete={handleDelete}
                                        onRefresh={fetchPrestamos}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <AnimatePresence>
                {modalNuevo && (
                    <PrestamoModal
                        deudoresExistentes={deudoresExistentes}
                        onClose={() => setModalNuevo(false)}
                        onDone={() => { fetchPrestamos(); toast('Préstamo creado.'); }}
                    />
                )}
                {modalEditar && (
                    <PrestamoModal
                        prestamo={modalEditar}
                        deudoresExistentes={deudoresExistentes}
                        onClose={() => setModalEditar(null)}
                        onDone={() => { fetchPrestamos(); toast('Préstamo actualizado.'); }}
                    />
                )}
                {modalPago && (
                    <PagoModal
                        prestamo={modalPago.prestamo}
                        saldoPendiente={modalPago.saldo}
                        onClose={() => setModalPago(null)}
                        onDone={() => { fetchPrestamos(); toast('Pago registrado. Ingreso registrado en contabilidad.'); }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
