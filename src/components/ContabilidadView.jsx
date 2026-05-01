import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import {
    TrendingUp, TrendingDown, Wallet, BarChart3,
    Search, X, CheckCircle2, AlertCircle, Clock,
    Save, History, ListFilter, ArrowRightLeft, Receipt,
    Settings, Pencil, Trash2, Plus, HandCoins
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Efectivo Personal = billetera del admin para pagos del negocio
const METODOS = ['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Efectivo Personal', 'Otros'];
const ORIGENES = ['Tienda', 'Pedidos', 'Préstamos', 'Envios', 'Proveedores', 'Transferencia'];
const METHOD_ICON  = { 'Efectivo': '💵', 'Yasta (QR)': '📲', 'Banco Unión (QR/Transf)': '🏦', 'BNB': '🏛️', 'Efectivo Personal': '👛', 'Otros': '💳' };
const METHOD_COLOR = {
    'Efectivo':                 'bg-success/10 text-success border-success/20',
    'Yasta (QR)':               'bg-blue-50 text-blue-600 border-blue-200',
    'Banco Unión (QR/Transf)':  'bg-indigo-50 text-indigo-600 border-indigo-200',
    'BNB':                      'bg-purple-50 text-purple-600 border-purple-200',
    'Efectivo Personal':        'bg-amber-50 text-amber-600 border-amber-200',
    'Otros':                    'bg-slate-100 text-slate-500 border-slate-200',
};
const ORIGEN_COLOR = {
    'Tienda':       'bg-primary/10 text-primary border-primary/20',
    'Pedidos':      'bg-secondary/10 text-secondary border-secondary/20',
    'Préstamos':    'bg-purple-50 text-purple-600 border-purple-200',
    'Envios':       'bg-orange-50 text-orange-500 border-orange-200',
    'Proveedores':  'bg-red-50 text-red-500 border-red-200',
};

const formatS = (n) => Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().split('T')[0];
const firstOfMonth = () => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; };

// ─────────────────────────────────────────────
// MODAL: TRANSFERENCIA ENTRE CUENTAS
// ─────────────────────────────────────────────
function TransferenciaModal({ onClose, onDone }) {
    const [desde, setDesde] = useState('Efectivo');
    const [hacia, setHacia] = useState('BNB');
    const [monto, setMonto] = useState('');
    const [concepto, setConcepto] = useState('');
    const [saving, setSaving] = useState(false);
    const [turnoId, setTurnoId] = useState(null);
    const [turnoChecked, setTurnoChecked] = useState(false);

    // Detectar el turno activo al abrir el modal (misma lógica que FlujoCajaView)
    useEffect(() => {
        const detectarTurno = async () => {
            try {
                const { data, error } = await supabase
                    .from('turnos_caja')
                    .select('id')
                    .eq('estado', 'ABIERTO')
                    .order('abierto_at', { ascending: false })
                    .limit(1);
                if (error) console.error('[TransferenciaModal] error:', error);
                const tId = data?.[0]?.id || null;
                console.log('[TransferenciaModal] turno detectado:', tId, '| data:', data);
                setTurnoId(tId);
            } catch (e) {
                console.error('[TransferenciaModal] excepción:', e);
                setTurnoId(null);
            } finally {
                setTurnoChecked(true);
            }
        };
        detectarTurno();
    }, []);

    const handleConfirm = async () => {
        const amt = parseFloat(monto);
        if (!amt || amt <= 0) return alert('Ingresa un monto válido.');
        if (desde === hacia) return alert('La cuenta de origen y destino no pueden ser iguales.');
        setSaving(true);
        try {
            const label = concepto || `Transferencia ${desde} → ${hacia}`;
            const { error } = await supabase.from('caja_movimientos').insert([
                {
                    turno_id: desde !== 'Efectivo Personal' ? turnoId : null,
                    tipo: 'EGRESO',
                    categoria: 'Transferencia Interna',
                    concepto: `[SALIDA] ${label}`,
                    monto: amt,
                    metodo_pago: desde,
                    origen: 'Transferencia',
                },
                {
                    turno_id: hacia !== 'Efectivo Personal' ? turnoId : null,
                    tipo: 'INGRESO',
                    categoria: 'Transferencia Interna',
                    concepto: `[ENTRADA] ${label}`,
                    monto: amt,
                    metodo_pago: hacia,
                    origen: 'Transferencia',
                },
            ]);
            if (error) throw error;
            onDone();
            onClose();
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="bg-surface w-full max-w-md rounded-2xl border border-border shadow-2xl">
                <div className="p-5 border-b border-border flex justify-between items-center bg-background rounded-t-2xl">
                    <h2 className="text-base font-black text-text flex items-center gap-2">
                        <ArrowRightLeft size={18} className="text-primary" /> Transferencia entre Cuentas
                    </h2>
                    <button onClick={onClose} className="text-muted hover:text-text"><X size={20} /></button>
                </div>

                <div className="p-5 space-y-4">
                    <p className="text-xs text-muted bg-background border border-border rounded-lg p-3">
                        Una transferencia <strong>no cambia el balance total</strong> — solo mueve dinero de una cuenta a otra.
                        Se registra como egreso en origen e ingreso en destino.
                    </p>

                    {/* Desde → Hacia */}
                    <div className="flex items-center gap-3">
                        <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted tracking-widest">Desde</label>
                            <select value={desde} onChange={e => setDesde(e.target.value)}
                                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary cursor-pointer">
                                {METODOS.map(m => <option key={m} value={m}>{METHOD_ICON[m]} {m === 'Banco Unión (QR/Transf)' ? 'Banco Unión' : m}</option>)}
                            </select>
                        </div>
                        <div className="mt-5 flex flex-col items-center">
                            <ArrowRightLeft size={20} className="text-primary" />
                        </div>
                        <div className="flex-1 space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted tracking-widest">Hacia</label>
                            <select value={hacia} onChange={e => setHacia(e.target.value)}
                                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold outline-none focus:border-primary cursor-pointer">
                                {METODOS.map(m => <option key={m} value={m}>{METHOD_ICON[m]} {m === 'Banco Unión (QR/Transf)' ? 'Banco Unión' : m}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Resumen visual */}
                    {desde !== hacia && (
                        <div className="flex items-center justify-center gap-3 bg-background border border-border rounded-xl p-3">
                            <span className={`px-3 py-1.5 rounded-lg text-xs font-black border ${METHOD_COLOR[desde] || METHOD_COLOR['Otros']}`}>
                                {METHOD_ICON[desde]} {desde === 'Banco Unión (QR/Transf)' ? 'B. Unión' : desde}
                            </span>
                            <span className="text-muted font-black">→</span>
                            <span className={`px-3 py-1.5 rounded-lg text-xs font-black border ${METHOD_COLOR[hacia] || METHOD_COLOR['Otros']}`}>
                                {METHOD_ICON[hacia]} {hacia === 'Banco Unión (QR/Transf)' ? 'B. Unión' : hacia}
                            </span>
                        </div>
                    )}

                    {/* Monto */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Monto (BS)</label>
                        <input type="number" value={monto} onChange={e => setMonto(e.target.value)} placeholder="0.00" autoFocus
                            className="w-full bg-background border-2 border-border focus:border-primary px-4 py-3 rounded-xl text-2xl text-center font-black font-mono outline-none shadow-inner" />
                    </div>

                    {/* Concepto */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Concepto (opcional)</label>
                        <input type="text" value={concepto} onChange={e => setConcepto(e.target.value)}
                            placeholder="Ej: Depósito acumulado del mes"
                            className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary" />
                    </div>

                    {turnoChecked && !turnoId && (
                        <div className="flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-xl text-[10px] text-orange-700 font-bold leading-tight">
                            <AlertCircle size={14} />
                            AVISO: No hay turno de caja abierto. Esta transferencia no afectará el saldo del punto de venta actual.
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-border flex justify-end gap-3 bg-background rounded-b-2xl">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-muted hover:text-text">Cancelar</button>
                    <button onClick={handleConfirm} disabled={saving || !monto || desde === hacia}
                        className={`px-6 py-2 rounded-xl text-sm font-black flex items-center gap-2 transition-all ${monto && desde !== hacia ? 'bg-primary text-white hover:brightness-105 shadow-lg' : 'bg-muted/20 text-muted cursor-not-allowed'}`}>
                        <ArrowRightLeft size={14} /> {saving ? 'Registrando...' : 'Confirmar Transferencia'}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

// ─────────────────────────────────────────────
// TAB 1: MOVIMIENTOS
// ─────────────────────────────────────────────
function MovimientosTab({ turnoActivo }) {
    const [movimientos, setMovimientos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterMetodo, setFilterMetodo] = useState('todos');
    const [filterOrigen, setFilterOrigen] = useState('todos');
    const [filterTipo, setFilterTipo] = useState('todos');
    const [dateFrom, setDateFrom] = useState(firstOfMonth);
    const [dateTo, setDateTo] = useState(today);
    const [showTransferModal, setShowTransferModal] = useState(false);
    const [editMov, setEditMov] = useState(null); // { id, concepto, monto, metodo_pago, categoria }
    const [savingEdit, setSavingEdit] = useState(false);
    const [editToast, setEditToast] = useState(null);

    useEffect(() => { fetchMovimientos(); }, [dateFrom, dateTo]);

    const fetchMovimientos = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('caja_movimientos')
                .select('*')
                .gte('created_at', dateFrom + 'T00:00:00-04:00')
                .lte('created_at', dateTo + 'T23:59:59-04:00')
                .order('created_at', { ascending: false });
            if (error) throw error;
            setMovimientos(data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const showEditMsg = (msg, type = 'success') => { setEditToast({ msg, type }); setTimeout(() => setEditToast(null), 3000); };

    const handleDeleteMov = async (mov) => {
        const label = mov.concepto || mov.categoria || 'Movimiento';
        if (!confirm(`¿Eliminar este movimiento?\n${label} — BS ${formatS(mov.monto)}${mov.categoria === 'Cobro Pedido' ? '\n\nTambién se eliminará el abono en Pedidos Clientes.' : ''}`)) return;
        try {
            // Si es Cobro Pedido, eliminar también en cliente_pagos (por caja_mov_id)
            if (mov.categoria === 'Cobro Pedido') {
                await supabase.from('cliente_pagos').delete().eq('caja_mov_id', mov.id);
            }
            await supabase.from('caja_movimientos').delete().eq('id', mov.id);
            fetchMovimientos();
            showEditMsg('Movimiento eliminado.');
        } catch (e) {
            showEditMsg('Error: ' + e.message, 'error');
        }
    };

    const handleUpdateMov = async () => {
        if (!editMov) return;
        const amt = parseFloat(editMov.monto);
        if (!amt || amt <= 0) return showEditMsg('Monto inválido.', 'error');
        setSavingEdit(true);
        try {
            const { error } = await supabase.from('caja_movimientos').update({
                concepto: editMov.concepto,
                monto: amt,
                metodo_pago: editMov.metodo_pago,
            }).eq('id', editMov.id);
            if (error) throw error;
            // Si es un Cobro Pedido, sincronizar con cliente_pagos
            if (editMov.categoria === 'Cobro Pedido') {
                await supabase.from('cliente_pagos').update({
                    monto: amt,
                    concepto: editMov.concepto,
                    metodo_pago: editMov.metodo_pago,
                }).eq('caja_mov_id', editMov.id);
            }
            setEditMov(null);
            fetchMovimientos();
            showEditMsg('Movimiento actualizado.');
        } catch (e) {
            showEditMsg('Error: ' + e.message, 'error');
        } finally {
            setSavingEdit(false);
        }
    };

    const filtered = useMemo(() => movimientos.filter(m => {
        if (filterMetodo !== 'todos' && (m.metodo_pago || 'Efectivo') !== filterMetodo) return false;
        if (filterOrigen !== 'todos' && (m.origen || 'Tienda') !== filterOrigen) return false;
        if (filterTipo !== 'todos' && m.tipo !== filterTipo) return false;
        if (search) {
            const s = search.toLowerCase();
            if (!(m.concepto || '').toLowerCase().includes(s) && !(m.categoria || '').toLowerCase().includes(s)) return false;
        }
        return true;
    }), [movimientos, filterMetodo, filterOrigen, filterTipo, search]);

    const totalIngresos        = movimientos.filter(m => m.tipo === 'INGRESO' && m.origen !== 'Transferencia').reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
    const totalEgresos         = movimientos.filter(m => m.tipo === 'EGRESO' && m.categoria !== 'Préstamo Otorgado' && m.origen !== 'Transferencia').reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
    const totalPrestamosOtorg  = movimientos.filter(m => m.tipo === 'EGRESO' && m.categoria === 'Préstamo Otorgado').reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
    const balanceNeto          = totalIngresos - totalEgresos;

    const porMetodo = METODOS.map(met => ({
        metodo: met,
        total: movimientos
            .filter(m => m.tipo === 'INGRESO' && m.origen !== 'Transferencia' && (m.metodo_pago || 'Efectivo') === met)
            .reduce((s, m) => s + (parseFloat(m.monto) || 0), 0)
    })).filter(m => m.total > 0);

    const porOrigen = ORIGENES.filter(ori => ori !== 'Transferencia').map(ori => ({
        origen: ori,
        total: movimientos
            .filter(m => m.tipo === 'INGRESO' && m.origen !== 'Transferencia' && (m.origen || 'Tienda') === ori)
            .reduce((s, m) => s + (parseFloat(m.monto) || 0), 0)
    })).filter(o => o.total > 0);

    const maxMetodo = Math.max(...porMetodo.map(m => m.total), 1);
    const maxOrigen = Math.max(...porOrigen.map(o => o.total), 1);

    return (
        <div className="flex flex-col gap-6">

            {/* Toast edición */}
            <AnimatePresence>
                {editToast && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-bold text-sm text-white ${editToast.type === 'error' ? 'bg-error' : 'bg-success'}`}>
                        {editToast.msg}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal: Transferencia */}
            {showTransferModal && (
                <TransferenciaModal 
                    turnoActivo={turnoActivo}
                    onClose={() => setShowTransferModal(false)} 
                    onDone={fetchMovimientos} 
                />
            )}

            {/* Modal: Editar Movimiento */}
            <AnimatePresence>
                {editMov && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-sm p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black text-text flex items-center gap-2">
                                    <Pencil size={15} className="text-primary" /> Editar Movimiento
                                </h3>
                                <button onClick={() => setEditMov(null)} className="text-muted hover:text-text"><X size={18} /></button>
                            </div>
                            {editMov.categoria === 'Cobro Pedido' && (
                                <p className="text-[10px] text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 font-bold">
                                    📋 Cobro Pedido — los cambios también se sincronizarán en Pedidos Clientes.
                                </p>
                            )}
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-muted tracking-widest">Concepto</label>
                                <input type="text" value={editMov.concepto} onChange={e => setEditMov({ ...editMov, concepto: e.target.value })}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-muted tracking-widest">Monto (BS)</label>
                                <input type="number" value={editMov.monto} onChange={e => setEditMov({ ...editMov, monto: e.target.value })}
                                    className="w-full bg-background border-2 border-border focus:border-primary px-3 py-2.5 rounded-xl text-lg text-center font-black font-mono outline-none shadow-inner" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase text-muted tracking-widest">Método de Pago</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {METODOS.map(m => (
                                        <button key={m} onClick={() => setEditMov({ ...editMov, metodo_pago: m })}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-all ${editMov.metodo_pago === m ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow' : 'bg-background border-border text-muted hover:border-primary/40'}`}>
                                            <span>{METHOD_ICON[m]}</span>
                                            <span>{m === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button onClick={() => setEditMov(null)} className="flex-1 py-2 rounded-xl text-sm font-bold text-muted bg-background border border-border hover:border-primary/40 transition-all">Cancelar</button>
                                <button onClick={handleUpdateMov} disabled={savingEdit} className="flex-1 py-2 rounded-xl text-sm font-black text-white bg-primary hover:brightness-105 shadow transition-all disabled:opacity-50">
                                    {savingEdit ? 'Guardando...' : 'Guardar'}
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: 'Total Ingresos',      value: totalIngresos,       icon: TrendingUp,   textCls: 'text-success',   bgCls: 'bg-success/10' },
                    { label: 'Egresos Operativos',  value: totalEgresos,        icon: TrendingDown, textCls: 'text-error',     bgCls: 'bg-error/10' },
                    { label: 'Prestado (pendiente)',value: totalPrestamosOtorg, icon: HandCoins,    textCls: 'text-orange-500',bgCls: 'bg-orange-100' },
                    { label: 'Balance Neto',        value: balanceNeto,         icon: Wallet,       textCls: balanceNeto >= 0 ? 'text-success' : 'text-error', bgCls: balanceNeto >= 0 ? 'bg-success/10' : 'bg-error/10' },
                ].map((k, i) => (
                    <motion.div key={k.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                        className="bg-surface border border-border rounded-xl p-5 shadow-sm flex items-center gap-4">
                        <div className={`p-3 ${k.bgCls} rounded-xl`}>
                            <k.icon size={22} className={k.textCls} />
                        </div>
                        <div>
                            <div className="text-[10px] font-black uppercase text-muted tracking-widest">{k.label}</div>
                            <div className={`text-2xl font-black font-mono ${k.textCls}`}>BS {formatS(k.value)}</div>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Barras */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-surface border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 size={16} className="text-primary" />
                        <span className="text-[11px] font-black uppercase text-muted tracking-widest">Ingresos por Método</span>
                    </div>
                    {porMetodo.length === 0
                        ? <div className="text-xs text-muted text-center py-6">Sin datos en el período</div>
                        : <div className="space-y-3">
                            {porMetodo.sort((a, b) => b.total - a.total).map(m => (
                                <div key={m.metodo}>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[11px] font-bold text-text flex items-center gap-1.5">
                                            <span>{METHOD_ICON[m.metodo]}</span>
                                            {m.metodo === 'Banco Unión (QR/Transf)' ? 'Banco Unión' : m.metodo}
                                        </span>
                                        <span className="text-[11px] font-black font-mono text-success">BS {formatS(m.total)}</span>
                                    </div>
                                    <div className="h-2 bg-border rounded-full overflow-hidden">
                                        <div className="h-full bg-success rounded-full transition-all duration-500" style={{ width: `${(m.total / maxMetodo) * 100}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    }
                </div>
                <div className="bg-surface border border-border rounded-xl p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 size={16} className="text-secondary" />
                        <span className="text-[11px] font-black uppercase text-muted tracking-widest">Ingresos por Origen</span>
                    </div>
                    {porOrigen.length === 0
                        ? <div className="text-xs text-muted text-center py-6">Sin datos en el período</div>
                        : <div className="space-y-3">
                            {porOrigen.sort((a, b) => b.total - a.total).map(o => (
                                <div key={o.origen}>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-[11px] font-bold text-text">{o.origen}</span>
                                        <span className="text-[11px] font-black font-mono text-secondary">BS {formatS(o.total)}</span>
                                    </div>
                                    <div className="h-2 bg-border rounded-full overflow-hidden">
                                        <div className="h-full bg-secondary rounded-full transition-all duration-500" style={{ width: `${(o.total / maxOrigen) * 100}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    }
                </div>
            </div>

            <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border bg-background flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        {/* Grupo 1: Acción y Tiempo */}
                        <div className="flex items-center gap-3">
                            <button onClick={() => setShowTransferModal(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-xs font-black hover:brightness-105 shadow-lg shadow-primary/20 transition-all shrink-0">
                                <ArrowRightLeft size={14} /> Transferir
                            </button>
                            <div className="w-px h-6 bg-border mx-1" />
                            <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-2 py-1 shadow-sm">
                                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                                    className="bg-transparent text-[11px] font-bold outline-none focus:text-primary transition-colors cursor-pointer" />
                                <span className="text-muted text-[10px] font-black">→</span>
                                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                                    className="bg-transparent text-[11px] font-bold outline-none focus:text-primary transition-colors cursor-pointer" />
                            </div>
                        </div>

                        {/* Grupo 2: Búsqueda y Contador */}
                        <div className="flex items-center gap-3 flex-1 justify-end">
                            <div className="relative w-full max-w-xs">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por concepto o categoría..."
                                    className="w-full pl-9 pr-8 py-2 bg-surface border border-border rounded-xl text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all shadow-sm" />
                                {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-text"><X size={14} /></button>}
                            </div>
                            <div className="px-3 py-2 bg-muted/10 rounded-xl text-[10px] font-black text-muted uppercase tracking-wider whitespace-nowrap">
                                {filtered.length} REGISTROS
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 pt-1">
                        <span className="text-[10px] font-black text-muted uppercase tracking-widest mr-1">Filtrar por:</span>
                        
                        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
                            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-[11px] font-bold outline-none cursor-pointer hover:border-primary transition-colors min-w-[140px] shadow-sm">
                            <option value="todos">Ingresos + Egresos</option>
                            <option value="INGRESO">🟢 Solo Ingresos</option>
                            <option value="EGRESO">🔴 Solo Egresos</option>
                        </select>

                        <select value={filterMetodo} onChange={e => setFilterMetodo(e.target.value)}
                            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-[11px] font-bold outline-none cursor-pointer hover:border-primary transition-colors min-w-[150px] shadow-sm">
                            <option value="todos">Todos los métodos</option>
                            {METODOS.map(m => <option key={m} value={m}>{METHOD_ICON[m]} {m}</option>)}
                        </select>

                        <select value={filterOrigen} onChange={e => setFilterOrigen(e.target.value)}
                            className="bg-surface border border-border rounded-lg px-3 py-1.5 text-[11px] font-bold outline-none cursor-pointer hover:border-primary transition-colors min-w-[150px] shadow-sm">
                            <option value="todos">Todos los orígenes</option>
                            {ORIGENES.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs min-w-[900px]">
                        <thead className="bg-slate-50 border-b border-border text-[10px] font-black uppercase text-muted tracking-widest">
                            <tr>
                                <th className="px-5 py-3">Fecha / Hora</th>
                                <th className="px-5 py-3">Origen</th>
                                <th className="px-5 py-3">Método</th>
                                <th className="px-5 py-3">Categoría</th>
                                <th className="px-5 py-3">Concepto</th>
                                <th className="px-5 py-3 text-right">Monto</th>
                                <th className="px-3 py-3"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {loading
                                ? <tr><td colSpan="7" className="px-5 py-12 text-center text-muted text-xs">Cargando...</td></tr>
                                : filtered.length === 0
                                ? <tr><td colSpan="7" className="px-5 py-12 text-center text-muted text-xs uppercase font-black tracking-widest">Sin movimientos en el período</td></tr>
                                : filtered.map(m => {
                                    const metodo = m.metodo_pago || 'Efectivo';
                                    const origen = m.origen || 'Tienda';
                                    return (
                                        <tr key={m.id} className="hover:bg-slate-50/50 transition-colors group">
                                            <td className="px-5 py-3.5 font-mono text-muted">
                                                <div>{new Date(m.created_at).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                                                <div className="text-[10px] opacity-60">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black border ${ORIGEN_COLOR[origen] || 'bg-muted/10 text-muted border-border'}`}>{origen}</span>
                                            </td>
                                            <td className="px-5 py-3.5">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black border ${METHOD_COLOR[metodo] || METHOD_COLOR['Otros']}`}>
                                                    <span>{METHOD_ICON[metodo]}</span>
                                                    <span>{metodo === 'Banco Unión (QR/Transf)' ? 'B. Unión' : metodo}</span>
                                                </span>
                                            </td>
                                            <td className="px-5 py-3.5 font-bold text-text">{m.categoria || '—'}</td>
                                            <td className="px-5 py-3.5 text-muted max-w-xs truncate">{m.concepto || '—'}</td>
                                            <td className={`px-5 py-3.5 text-right font-black font-mono text-sm ${m.tipo === 'INGRESO' ? 'text-success' : 'text-error'}`}>
                                                {m.tipo === 'INGRESO' ? '+' : '-'} BS {formatS(m.monto)}
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                                                    <button title="Editar" onClick={() => setEditMov({ id: m.id, concepto: m.concepto || '', monto: m.monto, metodo_pago: m.metodo_pago || 'Efectivo', categoria: m.categoria })}
                                                        className="p-1.5 rounded-lg hover:bg-primary/10 text-muted hover:text-primary transition-all">
                                                        <Pencil size={13} />
                                                    </button>
                                                    <button title="Eliminar" onClick={() => handleDeleteMov(m)}
                                                        className="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-all">
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            }
                        </tbody>
                    </table>
                </div>
            </div>
            {showTransferModal && (
                <TransferenciaModal 
                    onClose={() => setShowTransferModal(false)} 
                    onDone={() => fetchMovimientos()} 
                />
            )}
        </div>
    );
}

// ─────────────────────────────────────────────
// TAB 2: CONCILIACIÓN
// ─────────────────────────────────────────────
function ConciliacionTab() {
    const [dateFrom, setDateFrom] = useState(firstOfMonth);
    const [dateTo, setDateTo] = useState(today);
    const [movimientos, setMovimientos] = useState([]);
    const [saldosIniciales, setSaldosIniciales] = useState({});   // { metodo: saldo_inicial }
    const [saldosReales, setSaldosReales] = useState({});          // { metodo: saldo_real ingresado manualmente }
    const [historial, setHistorial] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [toast, setToast] = useState(null);

    const showMsg = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3500);
    };

    useEffect(() => {
        fetchAll();
    }, [dateFrom, dateTo]);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [movsRes, configRes, histRes, turnosRes] = await Promise.all([
                supabase.from('caja_movimientos')
                    .select('tipo, monto, metodo_pago')
                    .gte('created_at', dateFrom + 'T00:00:00-04:00')
                    .lte('created_at', dateTo + 'T23:59:59-04:00'),
                supabase.from('conciliacion_config').select('*'),
                supabase.from('conciliacion_historial')
                    .select('*')
                    .gte('created_at', dateFrom + 'T00:00:00-04:00')
                    .lte('created_at', dateTo + 'T23:59:59-04:00')
                    .order('created_at', { ascending: false }),
                supabase.from('turnos_caja')
                    .select('monto_inicial, abierto_at')
                    .gte('abierto_at', dateFrom + 'T00:00:00-04:00')
                    .lte('abierto_at', dateTo + 'T23:59:59-04:00')
                    .order('abierto_at', { ascending: false })
                    .limit(1),
            ]);
            setMovimientos(movsRes.data || []);
            // Mapear config a { metodo: saldo_inicial }
            const cfg = {};
            (configRes.data || []).forEach(r => { cfg[r.metodo] = r.saldo_inicial; });
            // Si no hay saldo inicial guardado para Efectivo, usar monto_inicial del turno del período
            if (cfg['Efectivo'] == null || cfg['Efectivo'] === 0) {
                const turno = turnosRes.data?.[0];
                if (turno?.monto_inicial) cfg['Efectivo'] = turno.monto_inicial;
            }
            setSaldosIniciales(cfg);
            setHistorial(histRes.data || []);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const totalCalculadoHist = useMemo(() => historial.reduce((sum, h) => sum + (parseFloat(h.saldo_calculado) || 0), 0), [historial]);
    const totalRealHist = useMemo(() => historial.reduce((sum, h) => sum + (parseFloat(h.saldo_real) || 0), 0), [historial]);
    const totalDiferenciaHist = useMemo(() => historial.reduce((sum, h) => sum + (parseFloat(h.diferencia) || 0), 0), [historial]);

    // Calcular por método
    const resumen = useMemo(() => METODOS.map(met => {
        const ingresos = movimientos.filter(m => m.tipo === 'INGRESO' && (m.metodo_pago || 'Efectivo') === met)
            .reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
        const egresos = movimientos.filter(m => m.tipo === 'EGRESO' && (m.metodo_pago || 'Efectivo') === met)
            .reduce((s, m) => s + (parseFloat(m.monto) || 0), 0);
        const saldoInicial = parseFloat(saldosIniciales[met] || 0);
        const saldoCalculado = saldoInicial + ingresos - egresos;
        const saldoReal = parseFloat(saldosReales[met] || '');
        const diferencia = isNaN(saldoReal) ? null : saldoReal - saldoCalculado;
        return { met, ingresos, egresos, saldoInicial, saldoCalculado, saldoReal, diferencia };
    }), [movimientos, saldosIniciales, saldosReales]);

    const setSaldoInicial = (met, val) => setSaldosIniciales(prev => ({ ...prev, [met]: val }));
    const setSaldoReal = (met, val) => setSaldosReales(prev => ({ ...prev, [met]: val }));

    const handleGuardarSaldosIniciales = async () => {
        setSaving(true);
        try {
            for (const met of METODOS) {
                await supabase.from('conciliacion_config')
                    .upsert({ metodo: met, saldo_inicial: parseFloat(saldosIniciales[met] || 0), updated_at: new Date().toISOString() }, { onConflict: 'metodo' });
            }
            showMsg('Saldos iniciales guardados correctamente.');
        } catch (e) { showMsg('Error al guardar: ' + e.message, 'error'); }
        finally { setSaving(false); }
    };

    const handleGuardarConciliacion = async () => {
        const sinSaldoReal = resumen.filter(r => isNaN(parseFloat(saldosReales[r.met] || '')));
        if (sinSaldoReal.length > 0) {
            showMsg(`Ingresa el saldo real de: ${sinSaldoReal.map(r => r.met).join(', ')}`, 'error');
            return;
        }
        setSaving(true);
        try {
            const registros = resumen.map(r => ({
                metodo: r.met,
                fecha_desde: dateFrom,
                fecha_hasta: dateTo,
                saldo_inicial: r.saldoInicial,
                ingresos: r.ingresos,
                egresos: r.egresos,
                saldo_calculado: r.saldoCalculado,
                saldo_real: r.saldoReal,
                diferencia: r.diferencia,
                estado: Math.abs(r.diferencia) < 0.01 ? 'OK' : 'DIFERENCIA',
            }));
            const { error } = await supabase.from('conciliacion_historial').insert(registros);
            if (error) throw error;
            showMsg('Conciliación guardada en el historial.');
            setSaldosReales({});
            fetchAll();
        } catch (e) { showMsg('Error al guardar: ' + e.message, 'error'); }
        finally { setSaving(false); }
    };

    const todosVerificados = resumen.every(r => r.diferencia !== null);

    return (
        <div className="flex flex-col gap-6">
            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-bold text-sm text-white ${toast.type === 'error' ? 'bg-error' : 'bg-success'}`}>
                        {toast.msg}
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Cabecera */}
            <div className="bg-surface border border-border rounded-xl p-5 shadow-sm">
                <div className="flex flex-wrap items-end gap-4 justify-between">
                    <div>
                        <h3 className="text-base font-black text-text mb-1">Conciliación de Cuentas</h3>
                        <p className="text-xs text-muted">Compara el saldo calculado por el sistema con el saldo real de cada cuenta.</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                            className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:border-primary" />
                        <span className="text-muted text-xs">→</span>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                            className="bg-background border border-border rounded-lg px-3 py-1.5 text-xs font-bold outline-none focus:border-primary" />
                        <button onClick={() => setShowHistorial(!showHistorial)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black border transition-all ${showHistorial ? 'bg-primary border-primary text-white' : 'bg-surface border-border text-muted hover:border-primary'}`}>
                            <History size={14} /> Historial
                        </button>
                    </div>
                </div>
            </div>

            {/* Historial (colapsable) */}
            <AnimatePresence>
                {showHistorial && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                        className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden mb-4">
                        <div className="p-4 border-b border-border bg-background flex flex-wrap items-center justify-between gap-3">
                            <span className="text-[11px] font-black uppercase text-muted tracking-widest">Historial de Conciliaciones del período</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs min-w-[700px]">
                                <thead className="bg-slate-50 border-b border-border text-[10px] font-black uppercase text-muted tracking-widest">
                                    <tr>
                                        <th className="px-4 py-2">Fecha</th>
                                        <th className="px-4 py-2">Período</th>
                                        <th className="px-4 py-2">Método</th>
                                        <th className="px-4 py-2 text-right">Calculado</th>
                                        <th className="px-4 py-2 text-right">Real</th>
                                        <th className="px-4 py-2 text-right">Diferencia</th>
                                        <th className="px-4 py-2 text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {historial.length === 0
                                        ? <tr><td colSpan="7" className="px-4 py-8 text-center text-muted uppercase text-[10px] font-black">Sin conciliaciones guardadas</td></tr>
                                        : historial.map(h => (
                                            <tr key={h.id} className="hover:bg-slate-50/50">
                                                <td className="px-4 py-2.5 font-mono text-muted text-[10px]">{new Date(h.created_at).toLocaleDateString('es-BO')}</td>
                                                <td className="px-4 py-2.5 text-[10px] text-muted">{h.fecha_desde} → {h.fecha_hasta}</td>
                                                <td className="px-4 py-2.5">
                                                    <span className="flex items-center gap-1 text-[10px] font-bold">
                                                        {METHOD_ICON[h.metodo]} {h.metodo === 'Banco Unión (QR/Transf)' ? 'B. Unión' : h.metodo}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono font-bold">BS {formatS(h.saldo_calculado)}</td>
                                                <td className="px-4 py-2.5 text-right font-mono font-bold">BS {formatS(h.saldo_real)}</td>
                                                <td className={`px-4 py-2.5 text-right font-mono font-black ${Math.abs(h.diferencia) < 0.01 ? 'text-success' : 'text-error'}`}>
                                                    {h.diferencia >= 0 ? '+' : ''}{formatS(h.diferencia)}
                                                </td>
                                                <td className="px-4 py-2.5 text-center">
                                                    {h.estado === 'OK'
                                                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-success/10 text-success border border-success/20 rounded text-[9px] font-black"><CheckCircle2 size={10} /> OK</span>
                                                        : <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-error/10 text-error border border-error/20 rounded text-[9px] font-black"><AlertCircle size={10} /> DIFERENCIA</span>
                                                    }
                                                </td>
                                            </tr>
                                        ))
                                    }
                                </tbody>
                                {historial.length > 0 && (
                                    <tfoot className="bg-slate-50 border-t-2 border-border font-bold">
                                        <tr className="bg-slate-100/80">
                                            <td colSpan="3" className="px-4 py-3 text-right uppercase text-[10px] font-black tracking-widest text-muted">Totales Históricos</td>
                                            <td className="px-4 py-3 text-right font-mono font-black text-text">BS {formatS(totalCalculadoHist)}</td>
                                            <td className="px-4 py-3 text-right font-mono font-black text-text">BS {formatS(totalRealHist)}</td>
                                            <td className={`px-4 py-3 text-right font-mono font-black ${totalDiferenciaHist >= 0 ? 'text-success' : 'text-error'}`}>
                                                {totalDiferenciaHist >= 0 ? '+' : ''}{formatS(totalDiferenciaHist)}
                                            </td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Tarjetas de conciliación */}
            {loading ? (
                <div className="text-center py-16 text-muted text-xs uppercase font-black tracking-widest">Cargando movimientos...</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {resumen.map(({ met, ingresos, egresos, saldoInicial, saldoCalculado, saldoReal, diferencia }) => {
                        const tieneReal = !isNaN(parseFloat(saldosReales[met] || '')) && saldosReales[met] !== '';
                        const ok = tieneReal && Math.abs(diferencia) < 0.01;
                        const hayDif = tieneReal && Math.abs(diferencia) >= 0.01;

                        return (
                            <motion.div key={met} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                                className={`bg-surface rounded-xl border-2 shadow-sm p-5 flex flex-col gap-3 transition-all ${ok ? 'border-success/40' : hayDif ? 'border-error/40' : 'border-border'}`}>
                                {/* Header */}
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 font-black text-sm text-text">
                                        <span className="text-xl">{METHOD_ICON[met]}</span>
                                        <span>{met === 'Banco Unión (QR/Transf)' ? 'Banco Unión' : met}</span>
                                    </div>
                                    {ok && <span className="flex items-center gap-1 text-[9px] font-black text-success bg-success/10 px-2 py-0.5 rounded border border-success/20"><CheckCircle2 size={10} /> OK</span>}
                                    {hayDif && <span className="flex items-center gap-1 text-[9px] font-black text-error bg-error/10 px-2 py-0.5 rounded border border-error/20"><AlertCircle size={10} /> DIFERENCIA</span>}
                                    {!tieneReal && <span className="flex items-center gap-1 text-[9px] font-black text-muted bg-muted/10 px-2 py-0.5 rounded border border-border"><Clock size={10} /> Pendiente</span>}
                                </div>

                                {/* Desglose */}
                                <div className="bg-background rounded-lg p-3 space-y-1.5 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-muted">Saldo inicial</span>
                                        <input type="number" value={saldosIniciales[met] ?? 0}
                                            onChange={e => setSaldoInicial(met, e.target.value)}
                                            className="w-28 text-right font-mono font-bold text-text border-b border-dashed border-border outline-none bg-transparent focus:border-primary"
                                        />
                                    </div>
                                    <div className="flex justify-between text-success">
                                        <span>+ Ingresos</span>
                                        <span className="font-mono font-bold">BS {formatS(ingresos)}</span>
                                    </div>
                                    <div className="flex justify-between text-error">
                                        <span>- Egresos</span>
                                        <span className="font-mono font-bold">BS {formatS(egresos)}</span>
                                    </div>
                                    <div className="flex justify-between border-t border-border pt-1.5 font-black text-text">
                                        <span>= Saldo calculado</span>
                                        <span className="font-mono">BS {formatS(saldoCalculado)}</span>
                                    </div>
                                </div>

                                {/* Saldo real */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-[10px] font-black uppercase text-muted tracking-widest">Saldo real (verificar en app/banco)</label>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-muted">BS</span>
                                        <input type="number" value={saldosReales[met] ?? ''}
                                            onChange={e => setSaldoReal(met, e.target.value)}
                                            placeholder="0.00"
                                            className={`flex-1 border-b-2 outline-none text-lg font-black font-mono text-center pb-0.5 bg-transparent transition-all ${ok ? 'border-success text-success' : hayDif ? 'border-error text-error' : 'border-border text-text focus:border-primary'}`}
                                        />
                                    </div>
                                </div>

                                {/* Diferencia */}
                                {tieneReal && (
                                    <div className={`rounded-lg p-3 text-center ${ok ? 'bg-success/5 border border-success/20' : 'bg-error/5 border border-error/20'}`}>
                                        <div className="text-[9px] font-black uppercase tracking-widest mb-0.5 text-muted">Diferencia</div>
                                        <div className={`text-xl font-black font-mono ${ok ? 'text-success' : 'text-error'}`}>
                                            {diferencia >= 0 ? '+' : ''} BS {formatS(diferencia)}
                                        </div>
                                        {hayDif && (
                                            <div className="text-[10px] text-error mt-1">
                                                {diferencia > 0 ? '↑ Hay más dinero del esperado' : '↓ Falta dinero — revisar movimientos'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </div>
            )}

            {/* Acciones */}
            <div className="flex flex-wrap gap-3 justify-end pt-2">
                <button onClick={handleGuardarSaldosIniciales} disabled={saving}
                    className="flex items-center gap-2 px-4 py-2.5 bg-surface border border-border rounded-xl text-xs font-black hover:border-primary transition-all">
                    <Save size={14} /> Guardar saldos iniciales
                </button>
                <button onClick={handleGuardarConciliacion} disabled={saving || !todosVerificados}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-black transition-all ${todosVerificados ? 'bg-primary text-white shadow-lg hover:brightness-105' : 'bg-muted/20 text-muted cursor-not-allowed'}`}>
                    <CheckCircle2 size={14} /> {saving ? 'Guardando...' : 'Guardar Conciliación'}
                </button>
            </div>
            <p className="text-[10px] text-muted text-right -mt-2">
                Completa el "Saldo real" de todos los métodos para poder guardar la conciliación.
            </p>
        </div>
    );
}

// ─────────────────────────────────────────────
// TAB 3: EGRESOS / GASTOS
// ─────────────────────────────────────────────

// Colores cíclicos para categorías sin color asignado
const CAT_COLORS = [
    'bg-orange-50 border-orange-200 text-orange-700',
    'bg-yellow-50 border-yellow-200 text-yellow-700',
    'bg-blue-50 border-blue-200 text-blue-700',
    'bg-green-50 border-green-200 text-green-700',
    'bg-indigo-50 border-indigo-200 text-indigo-700',
    'bg-purple-50 border-purple-200 text-purple-700',
    'bg-pink-50 border-pink-200 text-pink-700',
    'bg-slate-100 border-slate-300 text-slate-700',
    'bg-gray-100 border-gray-300 text-gray-700',
    'bg-teal-50 border-teal-200 text-teal-700',
    'bg-rose-50 border-rose-200 text-rose-700',
    'bg-cyan-50 border-cyan-200 text-cyan-700',
];

// Emojis rápidos para nueva categoría
const EMOJI_QUICK = ['💼','🏠','⚡','🌐','✏️','📦','🚛','👤','🔧','🛒','📱','🎯','💡','🏷️','📋','🔑','🎁','💊','🍽️','🚗'];

// ─────────────────────────────────────────────
// MODAL: GESTIONAR CATEGORÍAS
// ─────────────────────────────────────────────
function CategoriasModal({ onClose, onRefresh }) {
    const [categorias, setCategorias] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editId, setEditId] = useState(null);
    const [editNombre, setEditNombre] = useState('');
    const [editIcono, setEditIcono] = useState('💼');
    const [newNombre, setNewNombre] = useState('');
    const [newIcono, setNewIcono] = useState('💼');
    const [saving, setSaving] = useState(false);
    const [toast, setToast] = useState(null);

    const showMsg = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 2500);
    };

    useEffect(() => { fetchCategorias(); }, []);

    const fetchCategorias = async () => {
        setLoading(true);
        const { data } = await supabase
            .from('categorias_caja')
            .select('*')
            .eq('tipo', 'EGRESO')
            .order('nombre', { ascending: true });
        setCategorias(data || []);
        setLoading(false);
    };

    const handleAdd = async () => {
        if (!newNombre.trim()) return showMsg('Ingresa un nombre.', 'error');
        setSaving(true);
        try {
            const { error } = await supabase.from('categorias_caja').insert([{
                nombre: newNombre.trim(),
                icono: newIcono,
                tipo: 'EGRESO',
            }]);
            if (error) throw error;
            setNewNombre('');
            setNewIcono('💼');
            showMsg('Categoría creada.');
            fetchCategorias();
            onRefresh();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleSaveEdit = async (id) => {
        if (!editNombre.trim()) return showMsg('El nombre no puede estar vacío.', 'error');
        setSaving(true);
        try {
            const { error } = await supabase.from('categorias_caja')
                .update({ nombre: editNombre.trim(), icono: editIcono })
                .eq('id', id);
            if (error) throw error;
            setEditId(null);
            showMsg('Categoría actualizada.');
            fetchCategorias();
            onRefresh();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id, nombre) => {
        if (!window.confirm(`¿Eliminar la categoría "${nombre}"? Los movimientos existentes no se verán afectados.`)) return;
        setSaving(true);
        try {
            const { error } = await supabase.from('categorias_caja').delete().eq('id', id);
            if (error) throw error;
            showMsg('Categoría eliminada.');
            fetchCategorias();
            onRefresh();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (cat) => {
        setEditId(cat.id);
        setEditNombre(cat.nombre);
        setEditIcono(cat.icono || '💼');
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
                    <div className="flex items-center gap-2">
                        <Settings size={16} className="text-primary" />
                        <span className="text-sm font-black text-text">Gestionar Categorías de Gastos</span>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-background rounded-lg transition-colors">
                        <X size={16} className="text-muted" />
                    </button>
                </div>

                {/* Toast */}
                <AnimatePresence>
                    {toast && (
                        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            className={`mx-5 mt-3 px-4 py-2.5 rounded-xl text-xs font-bold text-white ${toast.type === 'error' ? 'bg-error' : 'bg-success'}`}>
                            {toast.msg}
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Lista de categorías */}
                <div className="flex-1 overflow-y-auto p-5 space-y-2">
                    {loading
                        ? <div className="text-center py-10 text-xs text-muted font-bold">Cargando...</div>
                        : categorias.length === 0
                            ? <div className="text-center py-10 text-xs text-muted font-bold">Sin categorías. Agrega la primera abajo.</div>
                            : categorias.map((cat, idx) => (
                                <div key={cat.id} className="flex items-center gap-3 p-3 bg-background border border-border rounded-xl">
                                    {editId === cat.id ? (
                                        <>
                                            {/* Modo edición */}
                                            <div className="flex items-center gap-2 flex-1">
                                                <input value={editIcono} onChange={e => setEditIcono(e.target.value)}
                                                    className="w-10 text-center bg-surface border border-border rounded-lg px-1 py-1.5 text-base outline-none focus:border-primary"
                                                    maxLength={2} />
                                                <input value={editNombre} onChange={e => setEditNombre(e.target.value)}
                                                    onKeyDown={e => e.key === 'Enter' && handleSaveEdit(cat.id)}
                                                    className="flex-1 bg-surface border border-border rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:border-primary"
                                                    autoFocus />
                                            </div>
                                            <button onClick={() => handleSaveEdit(cat.id)} disabled={saving}
                                                className="p-1.5 bg-success/10 hover:bg-success/20 text-success rounded-lg transition-colors">
                                                <CheckCircle2 size={15} />
                                            </button>
                                            <button onClick={() => setEditId(null)}
                                                className="p-1.5 hover:bg-background rounded-lg transition-colors text-muted">
                                                <X size={15} />
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            {/* Modo lectura */}
                                            <span className="text-xl w-7 text-center shrink-0">{cat.icono || '💼'}</span>
                                            <span className="flex-1 text-sm font-bold text-text truncate">{cat.nombre}</span>
                                            <button onClick={() => startEdit(cat)}
                                                className="p-1.5 hover:bg-primary/10 text-muted hover:text-primary rounded-lg transition-colors">
                                                <Pencil size={14} />
                                            </button>
                                            <button onClick={() => handleDelete(cat.id, cat.nombre)}
                                                className="p-1.5 hover:bg-error/10 text-muted hover:text-error rounded-lg transition-colors">
                                                <Trash2 size={14} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            ))
                    }
                </div>

                {/* Agregar nueva */}
                <div className="p-5 border-t border-border space-y-3 shrink-0 bg-background/50">
                    <span className="text-[10px] font-black uppercase text-muted tracking-widest">Nueva Categoría</span>
                    {/* Emojis rápidos */}
                    <div className="flex flex-wrap gap-1">
                        {EMOJI_QUICK.map(e => (
                            <button key={e} onClick={() => setNewIcono(e)}
                                className={`w-8 h-8 rounded-lg text-base flex items-center justify-center transition-all border ${newIcono === e ? 'bg-primary/15 border-primary/40 ring-1 ring-primary/30' : 'bg-background border-border hover:border-primary/30'}`}>
                                {e}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <input value={newIcono} onChange={e => setNewIcono(e.target.value)}
                            className="w-12 text-center bg-surface border border-border rounded-xl px-1 py-2 text-lg outline-none focus:border-primary"
                            maxLength={2} placeholder="💼" />
                        <input value={newNombre} onChange={e => setNewNombre(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAdd()}
                            placeholder="Nombre de la categoría..."
                            className="flex-1 bg-surface border border-border rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-primary" />
                        <button onClick={handleAdd} disabled={saving || !newNombre.trim()}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-black transition-all ${newNombre.trim() ? 'bg-primary text-white hover:brightness-105 shadow' : 'bg-muted/20 text-muted cursor-not-allowed'}`}>
                            <Plus size={14} /> Agregar
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

// ─────────────────────────────────────────────
// TAB: INGRESOS (Manuales / Otros)
// ─────────────────────────────────────────────
function IngresosTab({ turnoActivo }) {
    const [categoria, setCategoria] = useState('Otro ingreso');
    const [monto, setMonto] = useState('');
    const [metodo, setMetodo] = useState('Efectivo');
    const [concepto, setConcepto] = useState('');
    const [fecha, setFecha] = useState(today());
    const [saving, setSaving] = useState(false);
    const [recientes, setRecientes] = useState([]);
    const [toast, setToast] = useState(null);

    const showMsg = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    useEffect(() => {
        fetchRecientes();
    }, []);

    const fetchRecientes = async () => {
        const { data } = await supabase
            .from('caja_movimientos')
            .select('*')
            .eq('tipo', 'INGRESO')
            .in('categoria', ['Otro ingreso', 'Transferencia recibida'])
            .order('created_at', { ascending: false })
            .limit(10);
        setRecientes(data || []);
    };

    const handleRegistrar = async () => {
        const amt = parseFloat(monto);
        if (!amt || amt <= 0) return showMsg('Ingresa un monto válido.', 'error');
        setSaving(true);
        try {
            const { data: currentTurno } = await supabase
                .from('turnos_caja')
                .select('id')
                .eq('estado', 'ABIERTO')
                .order('created_at', { ascending: false })
                .limit(1);
            const tId = currentTurno?.[0]?.id || null;

            const { error } = await supabase.from('caja_movimientos').insert([{
                turno_id: metodo !== 'Efectivo Personal' ? tId : null,
                tipo: 'INGRESO',
                categoria,
                concepto: concepto || categoria,
                monto: amt,
                metodo_pago: metodo,
                origen: 'Tienda',
            }]);
            if (error) throw error;
            showMsg('Ingreso registrado correctamente.');
            setMonto('');
            setConcepto('');
            setFecha(today());
            fetchRecientes();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (mov) => {
        if (!window.confirm(`¿Eliminar este ingreso?\n${mov.concepto || mov.categoria} — BS ${formatS(mov.monto)}`)) return;
        try {
            const { error } = await supabase.from('caja_movimientos').delete().eq('id', mov.id);
            if (error) throw error;
            showMsg('Ingreso eliminado.');
            fetchRecientes();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        }
    };

    const incomeCategories = [
        { nombre: 'Otro ingreso', icono: '💰' },
        { nombre: 'Transferencia recibida', icono: '🏦' }
    ];

    return (
        <div className="flex flex-col gap-6">
            <AnimatePresence>
                {toast && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-bold text-sm text-white ${toast.type === 'error' ? 'bg-error' : 'bg-success'}`}>
                        {toast.msg}
                    </motion.div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Formulario */}
                <div className="bg-surface border border-border rounded-xl p-5 shadow-sm space-y-4">
                    <h3 className="text-sm font-black text-text flex items-center gap-2">
                        <TrendingUp size={16} className="text-success" /> Registrar Otros Ingresos
                    </h3>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Categoría</label>
                        <div className="flex flex-wrap gap-2">
                            {incomeCategories.map(c => (
                                <button key={c.nombre} onClick={() => setCategoria(c.nombre)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black border transition-all ${categoria === c.nombre ? 'bg-success/10 border-success/40 text-success ring-2 ring-offset-1 ring-success/20' : 'bg-background border-border text-muted hover:border-success/40'}`}>
                                    <span>{c.icono}</span> {c.nombre}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted tracking-widest">Monto (BS)</label>
                            <input type="number" value={monto} onChange={e => setMonto(e.target.value)}
                                placeholder="0.00" autoFocus
                                className="w-full bg-background border-2 border-border focus:border-success px-3 py-2.5 rounded-xl text-lg text-center font-black font-mono outline-none shadow-inner" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted tracking-widest">Fecha</label>
                            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                                className="w-full bg-background border border-border px-3 py-2.5 rounded-xl text-sm font-bold outline-none focus:border-primary" />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Recibido en</label>
                        <div className="flex flex-wrap gap-1.5">
                            {METODOS.map(m => (
                                <button key={m} onClick={() => setMetodo(m)}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-all ${metodo === m ? 'bg-success border-success text-white shadow' : 'bg-background border-border text-muted hover:border-success/40'}`}>
                                    <span>{METHOD_ICON[m]}</span>
                                    <span>{m === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Detalle (opcional)</label>
                        <input type="text" value={concepto} onChange={e => setConcepto(e.target.value)}
                            placeholder={`Ej: ${categoria} — Concepto adicional`}
                            className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary" />
                    </div>

                    <button onClick={handleRegistrar} disabled={saving || !monto}
                        className={`w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all ${monto ? 'bg-success text-white hover:brightness-105 shadow-lg' : 'bg-muted/20 text-muted cursor-not-allowed'}`}>
                        <Plus size={16} /> {saving ? 'Registrando...' : `Registrar Ingreso · BS ${parseFloat(monto || 0).toLocaleString('es-BO', { minimumFractionDigits: 2 })}`}
                    </button>
                </div>

                {/* Recientes */}
                <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden min-h-[400px]">
                    <div className="p-4 border-b border-border bg-background">
                        <span className="text-[11px] font-black uppercase text-muted tracking-widest">Ingresos Recientes (Manuales)</span>
                    </div>
                    <div className="divide-y divide-border/30">
                        {recientes.length === 0
                            ? <div className="py-10 text-center text-muted text-xs uppercase font-black tracking-widest">Sin ingresos registrados</div>
                            : recientes.map(m => (
                                <div key={m.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors group">
                                    <span className="text-xl shrink-0">{m.categoria === 'Otro ingreso' ? '💰' : '🏦'}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold text-text truncate">{m.concepto || m.categoria}</div>
                                        <div className="text-[10px] text-muted flex items-center gap-2">
                                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-black ${METHOD_COLOR[m.metodo_pago || 'Efectivo'] || METHOD_COLOR['Otros']}`}>
                                                {METHOD_ICON[m.metodo_pago || 'Efectivo']} {m.metodo_pago === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m.metodo_pago}
                                            </span>
                                            <span>{new Date(m.created_at).toLocaleDateString('es-BO')}</span>
                                        </div>
                                    </div>
                                    <span className="text-success font-black font-mono text-sm shrink-0">+ BS {formatS(m.monto)}</span>
                                    <button onClick={() => handleDelete(m)} className="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100">
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}

function EgresosTab({ turnoActivo }) {
    const [categorias, setCategorias] = useState([]);
    const [categoria, setCategoria] = useState('');
    const [monto, setMonto] = useState('');
    const [metodo, setMetodo] = useState('Efectivo Personal');
    const [concepto, setConcepto] = useState('');
    const [fecha, setFecha] = useState(today());
    const [saving, setSaving] = useState(false);
    const [recientes, setRecientes] = useState([]);
    const [toast, setToast] = useState(null);
    const [showCatModal, setShowCatModal] = useState(false);
    const [editEgreso, setEditEgreso] = useState(null); // {id, concepto, monto, metodo_pago, categoria}

    const showMsg = (msg, type = 'success') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    };

    useEffect(() => {
        fetchCategorias();
        fetchRecientes();
    }, []);

    const fetchCategorias = async () => {
        const { data } = await supabase
            .from('categorias_caja')
            .select('*')
            .eq('tipo', 'EGRESO')
            .order('nombre', { ascending: true });
        const cats = data || [];
        setCategorias(cats);
        // Seleccionar la primera categoría si no hay ninguna seleccionada
        if (cats.length > 0) setCategoria(prev => prev || cats[0].nombre);
    };

    const fetchRecientes = async () => {
        const { data } = await supabase
            .from('caja_movimientos')
            .select('*')
            .eq('tipo', 'EGRESO')
            .neq('origen', 'Transferencia')
            .order('created_at', { ascending: false })
            .limit(15);
        setRecientes(data || []);
    };

    const handleRegistrar = async () => {
        const amt = parseFloat(monto);
        if (!amt || amt <= 0) return showMsg('Ingresa un monto válido.', 'error');
        if (!categoria) return showMsg('Selecciona una categoría.', 'error');
        setSaving(true);
        try {
            const { data: currentTurno } = await supabase
                .from('turnos_caja')
                .select('id')
                .eq('estado', 'ABIERTO')
                .order('created_at', { ascending: false })
                .limit(1);
            const tId = currentTurno?.[0]?.id || null;

            const { error } = await supabase.from('caja_movimientos').insert([{
                turno_id: metodo !== 'Efectivo Personal' ? tId : null,
                tipo: 'EGRESO',
                categoria,
                concepto: concepto || categoria,
                monto: amt,
                metodo_pago: metodo,
                origen: 'Proveedores',
            }]);
            if (error) throw error;
            showMsg('Gasto registrado correctamente.');
            setMonto('');
            setConcepto('');
            setFecha(today());
            fetchRecientes();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteEgreso = async (egreso) => {
        if (!window.confirm(`¿Eliminar este egreso?\n${egreso.concepto || egreso.categoria} — BS ${formatS(egreso.monto)}`)) return;
        try {
            const { error } = await supabase.from('caja_movimientos').delete().eq('id', egreso.id);
            if (error) throw error;
            // Si es Pago Distribuidor, sincronizar eliminando el pago del historial del distribuidor
            if (egreso.categoria === 'Pago Distribuidor') {
                const { data: stateRow } = await supabase.from('app_state').select('data').eq('id', 'distribuidor').maybeSingle();
                if (stateRow?.data) {
                    const distData = stateRow.data;
                    distData.pagos = (distData.pagos || []).filter(p => p.caja_id !== egreso.id);
                    await supabase.from('app_state').upsert({ id: 'distribuidor', data: distData });
                }
            } else if (egreso.categoria === 'Flete / Envío' || egreso.categoria === 'Envío Argentina') {
                const { data: remitosRow } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
                if (remitosRow?.data) {
                    const remitosData = Array.isArray(remitosRow.data) ? remitosRow.data : (remitosRow.data?.rows || []);
                    const updated = remitosData.map(r => {
                        let u = r;
                        if (r.flete_caja_id === egreso.id) u = { ...u, flete_caja_id: null };
                        if (r.costo_caja_id === egreso.id) u = { ...u, costo_caja_id: null };
                        return u;
                    });
                    await supabase.from('app_state').upsert({ id: 'remitos', data: updated });
                }
            }
            showMsg('Egreso eliminado.');
            fetchRecientes();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        }
    };

    const handleUpdateEgreso = async () => {
        if (!editEgreso) return;
        const amt = parseFloat(editEgreso.monto);
        if (!amt || amt <= 0) return showMsg('Monto inválido.', 'error');
        try {
            const { error } = await supabase.from('caja_movimientos').update({
                concepto: editEgreso.concepto,
                monto: amt,
                metodo_pago: editEgreso.metodo_pago,
            }).eq('id', editEgreso.id);
            if (error) throw error;
            setEditEgreso(null);
            showMsg('Egreso actualizado.');
            fetchRecientes();
        } catch (e) {
            showMsg('Error: ' + e.message, 'error');
        }
    };

    const catSelected = categorias.find(c => c.nombre === categoria);

    // Asignar color por índice para consistencia visual
    const getCatColor = (idx) => CAT_COLORS[idx % CAT_COLORS.length];

    return (
        <div className="flex flex-col gap-6">
            <AnimatePresence>
                {toast && (
                    <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-xl font-bold text-sm text-white ${toast.type === 'error' ? 'bg-error' : 'bg-success'}`}>
                        {toast.msg}
                    </motion.div>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showCatModal && (
                    <CategoriasModal
                        onClose={() => setShowCatModal(false)}
                        onRefresh={fetchCategorias}
                    />
                )}
            </AnimatePresence>

            {/* Modal: Editar Egreso */}
            <AnimatePresence>
                {editEgreso && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-sm p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-black text-text flex items-center gap-2"><Pencil size={15} className="text-primary" /> Editar Egreso</h3>
                                <button onClick={() => setEditEgreso(null)} className="text-muted hover:text-text"><X size={18} /></button>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-muted tracking-widest">Detalle / Concepto</label>
                                <input type="text" value={editEgreso.concepto} onChange={e => setEditEgreso({ ...editEgreso, concepto: e.target.value })}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black uppercase text-muted tracking-widest">Monto (BS)</label>
                                <input type="number" value={editEgreso.monto} onChange={e => setEditEgreso({ ...editEgreso, monto: e.target.value })}
                                    className="w-full bg-background border-2 border-border focus:border-error px-3 py-2.5 rounded-xl text-lg text-center font-black font-mono outline-none shadow-inner" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase text-muted tracking-widest">Pagado con</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {METODOS.map(m => (
                                        <button key={m} onClick={() => setEditEgreso({ ...editEgreso, metodo_pago: m })}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-all ${editEgreso.metodo_pago === m ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow' : 'bg-background border-border text-muted hover:border-primary/40'}`}>
                                            <span>{METHOD_ICON[m]}</span>
                                            <span>{m === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button onClick={() => setEditEgreso(null)} className="flex-1 py-2 rounded-xl text-sm font-bold text-muted bg-background border border-border hover:border-primary/40 transition-all">Cancelar</button>
                                <button onClick={handleUpdateEgreso} className="flex-1 py-2 rounded-xl text-sm font-black text-white bg-primary hover:brightness-105 shadow transition-all">Guardar</button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Formulario */}
                <div className="bg-surface border border-border rounded-xl p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-black text-text flex items-center gap-2">
                            <Receipt size={16} className="text-error" /> Registrar Gasto / Egreso
                        </h3>
                        <button onClick={() => setShowCatModal(true)}
                            title="Gestionar categorías"
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black border border-border text-muted hover:border-primary/40 hover:text-primary transition-all">
                            <Settings size={12} /> Categorías
                        </button>
                    </div>

                    {/* Categorías */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Categoría</label>
                        {categorias.length === 0
                            ? <p className="text-xs text-muted italic">Sin categorías. <button onClick={() => setShowCatModal(true)} className="text-primary underline font-bold">Agregar categorías</button></p>
                            : <div className="flex flex-wrap gap-2">
                                {categorias.map((c, idx) => {
                                    const color = getCatColor(idx);
                                    return (
                                        <button key={c.id} onClick={() => setCategoria(c.nombre)}
                                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-black border transition-all ${categoria === c.nombre ? color + ' ring-2 ring-offset-1 ring-current' : 'bg-background border-border text-muted hover:border-primary/40'}`}>
                                            <span>{c.icono || '💼'}</span> {c.nombre}
                                        </button>
                                    );
                                })}
                            </div>
                        }
                    </div>

                    {/* Monto + Fecha */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted tracking-widest">Monto (BS)</label>
                            <input type="number" value={monto} onChange={e => setMonto(e.target.value)}
                                placeholder="0.00" autoFocus
                                className="w-full bg-background border-2 border-border focus:border-error px-3 py-2.5 rounded-xl text-lg text-center font-black font-mono outline-none shadow-inner" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black uppercase text-muted tracking-widest">Fecha</label>
                            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                                className="w-full bg-background border border-border px-3 py-2.5 rounded-xl text-sm font-bold outline-none focus:border-primary" />
                        </div>
                    </div>

                    {/* Método */}
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Pagado con</label>
                        <div className="flex flex-wrap gap-1.5">
                            {METODOS.map(m => (
                                <button key={m} onClick={() => setMetodo(m)}
                                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-all ${metodo === m ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow' : 'bg-background border-border text-muted hover:border-primary/40'}`}>
                                    <span>{METHOD_ICON[m]}</span>
                                    <span>{m === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Concepto */}
                    <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-muted tracking-widest">Detalle (opcional)</label>
                        <input type="text" value={concepto} onChange={e => setConcepto(e.target.value)}
                            placeholder={`Ej: ${catSelected?.icono || '💼'} ${categoria || 'Categoría'} — Abril 2026`}
                            className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary" />
                    </div>

                    <button onClick={handleRegistrar} disabled={saving || !monto || !categoria}
                        className={`w-full py-3 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition-all ${monto && categoria ? 'bg-error text-white hover:brightness-105 shadow-lg' : 'bg-muted/20 text-muted cursor-not-allowed'}`}>
                        <TrendingDown size={16} /> {saving ? 'Registrando...' : `Registrar Egreso · BS ${parseFloat(monto || 0).toLocaleString('es-BO', { minimumFractionDigits: 2 })}`}
                    </button>
                </div>

                {/* Templates rápidos mensuales */}
                <div className="bg-surface border border-border rounded-xl p-5 shadow-sm space-y-4">
                    <h3 className="text-sm font-black text-text">⚡ Gastos Fijos Recurrentes</h3>
                    <p className="text-xs text-muted">Click para pre-rellenar el formulario de la izquierda.</p>
                    <div className="space-y-2">
                        {[
                            { cat: 'Alquiler',           icon: '🏠', label: 'Pago de Alquiler mensual',        met: 'Efectivo Personal' },
                            { cat: 'Luz / Electricidad', icon: '⚡', label: 'Pago de Luz mensual',             met: 'Efectivo Personal' },
                            { cat: 'Internet',           icon: '🌐', label: 'Pago de Internet mensual',        met: 'Efectivo Personal' },
                            { cat: 'Librería / Útiles',  icon: '✏️', label: 'Compra librería / útiles',        met: 'Efectivo Personal' },
                            { cat: 'Pago Distribuidor',  icon: '📦', label: 'Pago a distribuidor (en BS)',     met: 'Efectivo Personal' },
                            { cat: 'Flete / Envío',      icon: '🚛', label: 'Pago de flete / envío',          met: 'Efectivo Personal' },
                        ].map(t => (
                            <button key={t.cat + t.label} onClick={() => { setCategoria(t.cat); setMetodo(t.met); setConcepto(t.label + ' — ' + new Date().toLocaleDateString('es-BO', { month: 'long', year: 'numeric' })); }}
                                className="w-full flex items-center gap-3 p-3 bg-background border border-border rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all text-left group">
                                <span className="text-xl">{t.icon}</span>
                                <div className="flex-1 min-w-0">
                                    <div className="text-xs font-bold text-text">{t.label}</div>
                                    <div className="text-[10px] text-muted">{METHOD_ICON[t.met]} {t.met}</div>
                                </div>
                                <span className="text-[10px] font-black text-primary opacity-0 group-hover:opacity-100 transition-opacity">Usar →</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Egresos recientes */}
            <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="p-4 border-b border-border bg-background">
                    <span className="text-[11px] font-black uppercase text-muted tracking-widest">Egresos Recientes</span>
                </div>
                <div className="divide-y divide-border/30">
                    {recientes.length === 0
                        ? <div className="py-10 text-center text-muted text-xs uppercase font-black tracking-widest">Sin egresos registrados</div>
                        : recientes.map(e => {
                            const cat = categorias.find(c => c.nombre === e.categoria);
                            const metodo = e.metodo_pago || 'Efectivo';
                            return (
                                <div key={e.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/50 transition-colors group">
                                    <span className="text-xl shrink-0">{cat?.icono || '💼'}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-bold text-text truncate">{e.concepto || e.categoria}</div>
                                        <div className="text-[10px] text-muted flex items-center gap-2">
                                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-black ${METHOD_COLOR[metodo] || METHOD_COLOR['Otros']}`}>
                                                {METHOD_ICON[metodo]} {metodo === 'Banco Unión (QR/Transf)' ? 'B. Unión' : metodo}
                                            </span>
                                            <span>{new Date(e.created_at).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: '2-digit' })}</span>
                                        </div>
                                    </div>
                                    <span className="text-error font-black font-mono text-sm shrink-0">- BS {formatS(e.monto)}</span>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                        <button title="Editar" onClick={() => setEditEgreso({ id: e.id, concepto: e.concepto || '', monto: e.monto, metodo_pago: e.metodo_pago || 'Efectivo', categoria: e.categoria })}
                                            className="p-1.5 rounded-lg hover:bg-primary/10 text-muted hover:text-primary transition-colors">
                                            <Pencil size={13} />
                                        </button>
                                        <button title="Eliminar" onClick={() => handleDeleteEgreso(e)}
                                            className="p-1.5 rounded-lg hover:bg-error/10 text-muted hover:text-error transition-colors">
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    }
                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────
// MAIN VIEW
// ─────────────────────────────────────────────
export default function ContabilidadView() {
    const [tab, setTab] = useState('movimientos');
    const [turnoActivo, setTurnoActivo] = useState(null);

    useEffect(() => {
        fetchTurnoActivo();
    }, []);

    const fetchTurnoActivo = async () => {
        try {
            const { data, error } = await supabase
                .from('turnos_caja')
                .select('*')
                .eq('estado', 'ABIERTO')
                .order('abierto_at', { ascending: false })
                .limit(1);
            
            if (error) {
                console.error('Error supabase turnos_caja:', error);
                return;
            }
            const active = data?.[0] || null;
            setTurnoActivo(active);
        } catch (e) {
            console.error('Error fetching turno activo:', e);
        }
    };

    return (
        <div className="flex flex-col gap-6 max-w-7xl mx-auto animate-fade-in">
            {/* Tabs */}
            <div className="flex bg-background rounded-xl p-1 border border-border w-fit shadow-sm">
                <button onClick={() => setTab('movimientos')}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${tab === 'movimientos' ? 'bg-surface text-primary shadow-sm ring-1 ring-border/50' : 'text-muted hover:text-text'}`}>
                    <ListFilter size={14} /> Movimientos
                </button>
                <button onClick={() => setTab('ingresos')}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${tab === 'ingresos' ? 'bg-surface text-success shadow-sm ring-1 ring-border/50' : 'text-muted hover:text-text'}`}>
                    <TrendingUp size={14} /> Ingresos
                </button>
                <button onClick={() => setTab('egresos')}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${tab === 'egresos' ? 'bg-surface text-error shadow-sm ring-1 ring-border/50' : 'text-muted hover:text-text'}`}>
                    <Receipt size={14} /> Egresos
                </button>
                <button onClick={() => setTab('conciliacion')}
                    className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-all ${tab === 'conciliacion' ? 'bg-surface text-primary shadow-sm ring-1 ring-border/50' : 'text-muted hover:text-text'}`}>
                    <CheckCircle2 size={14} /> Conciliación
                </button>
            </div>

            <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
                    {tab === 'movimientos' ? <MovimientosTab turnoActivo={turnoActivo} /> :
                     tab === 'ingresos' ? <IngresosTab turnoActivo={turnoActivo} /> :
                     tab === 'egresos' ? <EgresosTab turnoActivo={turnoActivo} /> :
                     <ConciliacionTab />}
                </motion.div>
            </AnimatePresence>
        </div>
    );
}
