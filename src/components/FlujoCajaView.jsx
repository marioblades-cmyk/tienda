import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { 
    Wallet, Plus, Minus, Eye, History, User, 
    ArrowUpRight, ArrowDownLeft, Trash2, Edit3, 
    XCircle, CheckCircle2, AlertCircle, Clock, Search, LayoutDashboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function FlujoCajaView({ user, profile }) {
    const [loading, setLoading] = useState(true);
    const [turnoActivo, setTurnoActivo] = useState(null);
    const [historialTurnos, setHistorialTurnos] = useState([]);
    const [vendedores, setVendedores] = useState([]);
    const [movimientos, setMovimientos] = useState([]);
    
    // UI state
    const [showOpenModal, setShowOpenModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showDetailModal, setShowDetailModal] = useState(null);
    const [showEditModal, setShowEditModal] = useState(null); // { id, responsable, turno, monto_inicial, monto_final }
    const [ultimoTurno, setUltimoTurno] = useState(null);
    
    // Form states
    const [openForm, setOpenForm] = useState({ responsable: '', turno: 'MAÑANA', monto_inicial: '' });
    const [moveForm, setMoveForm] = useState({ tipo: 'INGRESO', categoria: 'Venta Stock', concepto: '', monto: '' });
    
    // View state
    const [currentView, setCurrentView] = useState('panel'); // 'panel' | 'historial'
    
    // Pagination, Search & Tabs
    const [searchTerm, setSearchTerm] = useState('');
    const [historyLimit, setHistoryLimit] = useState(20);
    const [historyTab, setHistoryTab] = useState('recientes'); // 'recientes' | 'completo'
    const [dateRange, setDateRange] = useState({ 
        from: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
        to: new Date().toISOString().split('T')[0] 
    });
    const [hasMore, setHasMore] = useState(true);
    
    useEffect(() => {
        init();
    }, []);

    useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            fetchHistorial();
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, historyLimit, currentView, dateRange]);

    const init = async () => {
        setLoading(true);
        await Promise.all([
            fetchVendedores(),
            fetchTurnoStatus(),
            fetchHistorial()
        ]);
        setLoading(false);
    };

    const fetchVendedores = async () => {
        // Ya no es necesario cargar todos los vendedores para el selector manual
        // Pero guardamos la lista por si se necesitara en reportes (opcional)
        const { data } = await supabase.from('vendedores').select('id, nombre').eq('active', true);
        setVendedores(data || []);
    };

    const fetchTurnoStatus = async () => {
        const { data: active } = await supabase
            .from('turnos_caja')
            .select('*')
            .eq('estado', 'ABIERTO')
            .maybeSingle();
            
        if (active) {
            setTurnoActivo(active);
            await fetchMovimientos(active.id);
        } else {
            setTurnoActivo(null);
            // Si no hay turno abierto, buscamos el último cerrado para el balance inicial
            const { data: last } = await supabase
                .from('turnos_caja')
                .select('*')
                .eq('estado', 'CERRADO')
                .order('cerrado_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            setUltimoTurno(last);
        }
    };

    const fetchMovimientos = async (turnoId) => {
        const { data } = await supabase
            .from('caja_movimientos')
            .select('*')
            .eq('turno_id', turnoId)
            .order('created_at', { ascending: false });
        setMovimientos(data || []);
    };

    const fetchHistorial = async () => {
        let query = supabase
            .from('turnos_caja')
            .select('*')
            .eq('estado', 'CERRADO')
            .order('cerrado_at', { ascending: false });
            
        if (currentView === 'panel') {
            const tenDaysAgo = new Date();
            tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
            query = query.gte('fecha', tenDaysAgo.toISOString().split('T')[0]);
        } else {
            // Historial Completo con filtros en el apartado de de Historial
            if (dateRange.from) query = query.gte('fecha', dateRange.from);
            if (dateRange.to) query = query.lte('fecha', dateRange.to);
            if (searchTerm) query = query.ilike('responsable', `%${searchTerm}%`);
        }
            
        const { data } = await query.limit(historyLimit + 1);
        
        if (data && data.length > historyLimit) {
            setHasMore(true);
            setHistorialTurnos(data.slice(0, historyLimit));
        } else {
            setHasMore(false);
            setHistorialTurnos(data || []);
        }
    };

    const handleOpenCaja = async () => {
        const responsable = profile?.nombre || user?.email || 'Desconocido';
        if (!openForm.monto_inicial) return alert('Ingresa el monto inicial');
        
        const { data, error } = await supabase.from('turnos_caja').insert([{
            responsable: responsable,
            vendedor_id: user?.id,
            turno: openForm.turno,
            monto_inicial: parseFloat(openForm.monto_inicial) || 0,
            estado: 'ABIERTO'
        }]).select().single();
        
        if (error) return alert('Error al abrir caja: ' + error.message);
        setTurnoActivo(data);
        setMovimientos([]);
        setShowOpenModal(false);
    };

    const handleAddMovement = async () => {
        if (!moveForm.monto) return;
        
        const { data, error } = await supabase.from('caja_movimientos').insert([{
            turno_id: turnoActivo.id,
            tipo: moveForm.tipo,
            categoria: moveForm.categoria,
            concepto: moveForm.concepto,
            monto: parseFloat(moveForm.monto) || 0,
            vendedor_id: user?.id
        }]).select().single();
        
        if (error) return alert('Error al registrar movimiento: ' + error.message);
        setMovimientos([data, ...movimientos]);
        setMoveForm({ ...moveForm, concepto: '', monto: '' });
    };

    const deleteMovement = async (id) => {
        if (!confirm('¿Eliminar este movimiento?')) return;
        const { error } = await supabase.from('caja_movimientos').delete().eq('id', id);
        if (error) return alert('Error: ' + error.message);
        setMovimientos(movimientos.filter(m => m.id !== id));
    };

    const handleCloseCaja = async () => {
        const totals = calculateTotals();
        const { error } = await supabase
            .from('turnos_caja')
            .update({
                estado: 'CERRADO',
                monto_final: totals.saldoActual,
                cerrado_at: new Date().toISOString()
            })
            .eq('id', turnoActivo.id);
            
        if (error) return alert('Error al cerrar caja');
        setShowCloseModal(false);
        init();
    };

    const handleDeleteTurno = async (id) => {
        if (!confirm('¿Seguro que deseas ELIMINAR este turno? (Se borrarán todos sus movimientos asociados)')) return;
        const { error } = await supabase.from('turnos_caja').delete().eq('id', id);
        if (error) return alert('Error al eliminar: ' + error.message);
        setTurnoActivo(null);
        init();
    };

    const handleSaveEditTurno = async (newData) => {
        const { error } = await supabase
            .from('turnos_caja')
            .update({
                responsable: newData.responsable,
                turno: newData.turno,
                monto_inicial: parseFloat(newData.monto_inicial) || 0,
                monto_final: parseFloat(newData.monto_final) || 0,
                fecha: newData.fecha
            })
            .eq('id', newData.id);
            
        if (error) return alert('Error al actualizar turno: ' + error.message);
        setShowEditModal(null);
        init();
    };

    const calculateTotals = () => {
        const ingresos = movimientos.filter(m => m.tipo === 'INGRESO').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0);
        const egresos = movimientos.filter(m => m.tipo === 'EGRESO').reduce((acc, m) => acc + (parseFloat(m.monto) || 0), 0);
        const saldoActual = (parseFloat(turnoActivo?.monto_inicial) || 0) + ingresos - egresos;
        return { ingresos, egresos, saldoActual };
    };

    if (loading) return <div className="py-20 flex justify-center items-center"><div className="animate-spin text-primary w-10 h-10 border-4 border-current border-t-transparent rounded-full" /></div>;

    const totals = turnoActivo ? calculateTotals() : { ingresos: 0, egresos: 0, saldoActual: 0 };

    return (
        <div className="space-y-6 max-w-[1440px] mx-auto animate-in fade-in duration-700 pb-20 px-4">
            {/* --- TOP NAVIGATION BAR --- */}
            <div className="flex gap-4 p-2 bg-surface/40 border border-border/20 rounded-[2rem] w-fit shadow-lg shadow-navy/5 backdrop-blur-xl sticky top-4 z-40 mx-auto transition-all">
                <button 
                    onClick={() => setCurrentView('panel')}
                    className={`flex items-center gap-3 px-10 py-4 rounded-[1.5rem] text-[10px] font-black transition-all uppercase tracking-[0.2em] ${currentView === 'panel' ? 'bg-navy text-white shadow-2xl shadow-navy/20 scale-105' : 'text-muted hover:bg-white/80'}`}
                >
                    <LayoutDashboard size={16} className={currentView === 'panel' ? 'text-primary' : ''} /> Operativa Diaria
                </button>
                <button 
                    onClick={() => setCurrentView('historial')}
                    className={`flex items-center gap-3 px-10 py-4 rounded-[1.5rem] text-[10px] font-black transition-all uppercase tracking-[0.2em] ${currentView === 'historial' ? 'bg-navy text-white shadow-2xl shadow-navy/20 scale-105' : 'text-muted hover:bg-white/80'}`}
                >
                    <History size={16} className={currentView === 'historial' ? 'text-primary' : ''} /> Auditoría Histórica
                </button>
            </div>

            {currentView === 'panel' ? (
                <div className="space-y-8">
                    {/* --- HEADER: PANEL DE CONTROL --- */}
                    <motion.div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-8 bg-navy text-white p-10 rounded-[3.5rem] shadow-[0_32px_80px_-20px_rgba(0,0,0,0.4)] relative overflow-hidden group border border-white/5"
                    >
                        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-primary/10 rounded-full -mr-48 -mt-48 blur-[120px] transition-all duration-1000 group-hover:bg-primary/20" />
                        <div className="relative">
                            <div className="flex items-center gap-4 text-white/50 text-[10px] font-black tracking-[0.4em] uppercase mb-3">
                                <span className="w-8 h-[1px] bg-primary/40 block" /> Gestión de Efectivo en Sucursal
                            </div>
                            <h2 className="text-5xl font-display uppercase tracking-tight leading-none text-white font-black">
                                {turnoActivo ? `Caja: ${turnoActivo.responsable}` : 'Caja Cerrada'}
                            </h2>
                            <div className="flex items-center gap-6 mt-6">
                                <div className="flex items-center gap-3 px-4 py-2 bg-white/5 rounded-full border border-white/10">
                                    <div className={`w-2 h-2 rounded-full ${turnoActivo ? 'bg-success animate-pulse' : 'bg-white/40'}`} />
                                    <span className="text-[10px] font-black tracking-widest uppercase">{turnoActivo ? 'En Línea' : 'Turno Cerrado'}</span>
                                </div>
                                {turnoActivo && (
                                    <span className="text-[11px] font-mono text-white/40 font-medium tracking-wide">
                                        Turno {turnoActivo.turno} • Apertura: {new Date(turnoActivo.abierto_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="relative flex items-center gap-4">
                            {turnoActivo ? (
                                <>
                                    <button 
                                        onClick={() => handleDeleteTurno(turnoActivo.id)} 
                                        className="p-5 bg-white/5 text-white/60 rounded-[1.5rem] hover:bg-error/20 hover:text-error transition-all group border border-white/10 backdrop-blur-md"
                                        title="Anular Apertura (Error)"
                                    >
                                        <Trash2 size={24} className="group-hover:rotate-12 transition-transform" />
                                    </button>
                                    <button 
                                        onClick={() => setShowCloseModal(true)} 
                                        className="bg-error text-white px-12 py-5 rounded-[1.5rem] text-sm font-black uppercase tracking-[0.2em] hover:brightness-110 active:scale-95 transition-all shadow-2xl shadow-error/30 hover:shadow-error/50 border border-error/30"
                                    >
                                        Cierre de Caja
                                    </button>
                                </>
                            ) : (
                                <button 
                                    onClick={() => setShowOpenModal(true)} 
                                    className="bg-primary text-navy px-12 py-5 rounded-[1.5rem] text-sm font-black uppercase tracking-[0.2em] hover:brightness-110 active:scale-95 transition-all shadow-2xl shadow-primary/40 hover:shadow-primary/60 border border-primary/40"
                                >
                                    Iniciar Nuevo Turno
                                </button>
                            )}
                        </div>
                    </motion.div>

                    {turnoActivo ? (
                        /* --- DASHBOARD ACTIVO --- */
                        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                            {/* Panel Lateral: Saldo */}
                            <motion.div 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="space-y-6"
                            >
                                <div className="bg-white p-8 rounded-[3rem] border border-border/40 shadow-sm transition-all hover:shadow-md">
                                    <p className="text-[10px] font-black text-muted uppercase tracking-widest mb-3 opacity-60 px-1">Fondo Inicial</p>
                                    <p className="text-3xl font-black font-mono text-navy tracking-tighter">Bs {turnoActivo.monto_inicial.toLocaleString()}</p>
                                </div>
                                <div className="bg-success/5 p-8 rounded-[3rem] border border-success/20 transition-all hover:bg-success/10 group">
                                    <p className="text-[10px] font-black text-success uppercase tracking-widest mb-3 px-1 flex items-center gap-2">
                                        <ArrowDownLeft size={14} className="group-hover:-translate-x-1 group-hover:translate-y-1 transition-transform" /> Flujo Ingresos
                                    </p>
                                    <p className="text-3xl font-black font-mono text-success tracking-tighter">+ {totals.ingresos.toLocaleString()}</p>
                                </div>
                                <div className="bg-error/5 p-8 rounded-[3rem] border border-error/20 transition-all hover:bg-error/10 group">
                                    <p className="text-[10px] font-black text-error uppercase tracking-widest mb-3 px-1 flex items-center gap-2">
                                        <ArrowUpRight size={14} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" /> Flujo Egresos
                                    </p>
                                    <p className="text-3xl font-black font-mono text-error tracking-tighter">- {totals.egresos.toLocaleString()}</p>
                                </div>
                                <div className="bg-text p-10 rounded-[3.5rem] shadow-[0_24px_60px_-15px_rgba(0,0,0,0.3)] relative overflow-hidden group">
                                     <div className="absolute -bottom-10 -right-10 w-48 h-48 bg-primary/20 blur-[60px] rounded-full transition-all duration-700 group-hover:bg-primary/40 group-hover:scale-125" />
                                     <p className="text-[10px] font-black text-primary uppercase tracking-[0.3em] mb-3 px-1">Saldo Líquido</p>
                                     <p className="text-5xl font-black font-mono text-white tracking-tighter relative z-10">Bs {totals.saldoActual.toLocaleString()}</p>
                                </div>
                            </motion.div>

                            {/* Panel Central: Operaciones */}
                            <div className="xl:col-span-3 space-y-8">
                                <motion.div 
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-white p-10 rounded-[3.5rem] border border-border/40 shadow-xl"
                                >
                                    <div className="flex items-center gap-4 mb-8 border-b border-border/20 pb-4">
                                        <div className="w-3 h-3 bg-primary rounded-full animate-pulse shadow-md shadow-primary/40" />
                                        <h4 className="text-[11px] font-black text-navy uppercase tracking-[0.3em]">Registro de Operación Inmediata</h4>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                                        <div className="space-y-3">
                                            <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] block px-2">Naturaleza</label>
                                            <select 
                                                value={moveForm.tipo}
                                                onChange={e => setMoveForm({...moveForm, tipo: e.target.value})}
                                                className="w-full bg-background border-2 border-border/10 p-4 rounded-2xl text-[11px] font-black uppercase outline-none focus:border-primary/50 transition-all cursor-pointer"
                                            >
                                                <option value="INGRESO">INGRESO (+)</option>
                                                <option value="EGRESO">EGRESO (-)</option>
                                            </select>
                                        </div>
                                        <div className="space-y-3">
                                            <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] block px-2">Clasificación</label>
                                            <select 
                                                value={moveForm.categoria}
                                                onChange={e => setMoveForm({...moveForm, categoria: e.target.value})}
                                                className="w-full bg-background border-2 border-border/10 p-4 rounded-2xl text-[11px] font-black uppercase outline-none focus:border-primary/50 transition-all cursor-pointer"
                                            >
                                                {moveForm.tipo === 'INGRESO' ? (
                                                    <>
                                                        <option>Venta Stock</option>
                                                        <option>Cobro Pedido</option>
                                                        <option>Cobro Seña</option>
                                                        <option>Otro Ingreso</option>
                                                    </>
                                                ) : (
                                                    <>
                                                        <option>Compra/Gasto</option>
                                                        <option>Retiro</option>
                                                        <option>Pago Proveedor</option>
                                                        <option>Otro Egreso</option>
                                                    </>
                                                )}
                                            </select>
                                        </div>
                                        <div className="space-y-3">
                                            <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] block px-2">Importe (BS)</label>
                                            <input 
                                                type="number" 
                                                placeholder="0.00"
                                                value={moveForm.monto}
                                                onChange={e => setMoveForm({...moveForm, monto: e.target.value})}
                                                className="w-full bg-background border-2 border-border/10 p-4 rounded-2xl font-mono font-black text-navy focus:border-primary/50 outline-none text-lg transition-all text-center tracking-tighter"
                                            />
                                        </div>
                                        <button 
                                            onClick={handleAddMovement} 
                                            className="bg-navy text-white h-[60px] rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-xl shadow-navy/30 flex items-center justify-center gap-3 text-[11px] font-black uppercase tracking-[0.3em] font-display"
                                        >
                                            <Plus size={20} className="text-primary" /> Validar
                                        </button>
                                        <div className="md:col-span-4 mt-2 space-y-3">
                                            <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] block px-2">Referencia / Observaciones</label>
                                            <input 
                                                type="text" 
                                                placeholder="Detalle de la transacción para auditoría rápida..."
                                                value={moveForm.concepto}
                                                onChange={e => setMoveForm({...moveForm, concepto: e.target.value})}
                                                className="w-full bg-background border-2 border-border/10 p-4 rounded-2xl text-[11px] font-bold outline-none focus:border-primary/50 transition-all px-6"
                                            />
                                        </div>
                                    </div>
                                </motion.div>

                                <div className="glass rounded-[4rem] border border-border/40 overflow-hidden shadow-2xl bg-white/40 backdrop-blur-md">
                                    <div className="p-8 border-b border-border/20 flex items-center justify-between bg-white/20">
                                        <h4 className="text-[10px] font-black text-navy uppercase tracking-[0.4em]">Libro de Movimientos — Sesión Activa</h4>
                                        <div className="flex items-center gap-6">
                                            <span className="text-[9px] font-black text-muted/60 uppercase tracking-widest">{movimientos.length} OPERACIONES</span>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
                                        <table className="w-full text-left border-collapse">
                                            <thead className="bg-[#fcfdfe]/60 border-b border-border/40 text-[9px] font-black text-muted/50 uppercase tracking-[0.2em]">
                                                <tr>
                                                    <th className="p-6">Cronología</th>
                                                    <th className="p-6">Categoría de Flujo</th>
                                                    <th className="p-6">Concepto Operativo</th>
                                                    <th className="p-6 text-right">Efecto Neto</th>
                                                    <th className="p-6"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/10">
                                                <AnimatePresence initial={false}>
                                                    {movimientos.map(m => (
                                                        <motion.tr 
                                                            key={m.id}
                                                            initial={{ opacity: 0, x: -15 }}
                                                            animate={{ opacity: 1, x: 0 }}
                                                            exit={{ opacity: 0, x: 15 }}
                                                            className="hover:bg-white/60 transition-all group"
                                                        >
                                                            <td className="p-6 font-mono text-muted/60 text-[10px] font-bold italic">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
                                                            <td className="p-6">
                                                                <span className={`px-4 py-1.5 rounded-full font-black text-[8px] uppercase tracking-[0.15em] border-2 shadow-sm ${m.tipo === 'INGRESO' ? 'bg-success/5 text-success border-success/10' : 'bg-error/5 text-error border-error/10'}`}>
                                                                    {m.categoria}
                                                                </span>
                                                            </td>
                                                            <td className="p-6 text-navy font-black text-[12px] uppercase tracking-tighter truncate max-w-[250px]">{m.concepto || '—'}</td>
                                                            <td className={`p-6 text-right font-black font-mono text-lg tracking-tighter ${m.tipo === 'INGRESO' ? 'text-success' : 'text-error'}`}>
                                                                {m.tipo === 'INGRESO' ? '+' : '-'} {m.monto.toLocaleString()}
                                                            </td>
                                                            <td className="p-6 text-right w-20">
                                                                <button 
                                                                    onClick={() => deleteMovement(m.id)} 
                                                                    className="p-3 text-muted hover:text-error transition-all opacity-0 group-hover:opacity-100 hover:bg-error/10 rounded-xl"
                                                                    title="Eliminar Movimiento"
                                                                >
                                                                    <Trash2 size={18} />
                                                                </button>
                                                            </td>
                                                        </motion.tr>
                                                    ))}
                                                </AnimatePresence>
                                                {movimientos.length === 0 && (
                                                    <tr>
                                                        <td colSpan="5" className="p-32 text-center text-muted uppercase font-black tracking-[0.5em] italic opacity-20 text-xs">Aún no se registran movimientos en este turno</td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* --- STANDBY: ÚLTIMAS 10 SESIONES --- */
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
                            <motion.div 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="space-y-8"
                            >
                                <div className="flex items-center gap-4 px-6">
                                    <History size={18} className="text-primary" />
                                    <h4 className="text-[11px] font-black text-navy uppercase tracking-[0.3em]">Cierre Reciente del Módulo</h4>
                                </div>
                                {ultimoTurno ? (
                                    <div className="bg-white p-12 rounded-[4.5rem] border border-border/40 shadow-2xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -mr-32 -mt-32 blur-[80px] transition-transform duration-1000 group-hover:scale-150" />
                                        <div className="grid grid-cols-2 gap-12 relative">
                                            <div>
                                                <p className="text-[10px] font-black text-navy/50 uppercase tracking-widest mb-3">Responsable de Caja</p>
                                                <p className="text-3xl font-black text-navy mb-8 uppercase tracking-tight leading-tight">{ultimoTurno.responsable}</p>
                                                <div className="space-y-4">
                                                    <div>
                                                        <p className="text-[9px] font-black text-navy/50 uppercase tracking-widest mb-1">Finalización el</p>
                                                        <p className="text-xs font-bold text-navy">{new Date(ultimoTurno.cerrado_at).toLocaleString(undefined, { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>
                                                    </div>
                                                    <div className="inline-flex bg-navy text-white px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.3em] shadow-lg shadow-navy/30">
                                                        Turno {ultimoTurno.turno}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col justify-between">
                                                <div>
                                                    <p className="text-[10px] font-black text-navy/50 uppercase tracking-widest mb-3">Total en Efectivo</p>
                                                    <p className="text-6xl font-black text-navy font-mono tracking-tighter leading-none">Bs {ultimoTurno.monto_final.toLocaleString()}</p>
                                                </div>
                                                <div className="pt-1 or-8">
                                                     <button 
                                                        onClick={() => setShowDetailModal(ultimoTurno)} 
                                                        className="group text-[10px] font-black text-primary uppercase tracking-[0.3em] flex items-center gap-3 justify-end hover:underline transition-all"
                                                     >
                                                        Detalles Auditoría <Eye size={18} className="group-hover:scale-125 transition-transform" />
                                                     </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-32 text-center glass rounded-[4.5rem] border-4 border-dashed border-border/40">
                                        <Wallet size={64} className="mx-auto text-navy/20 mb-6" />
                                        <p className="text-xs text-navy/60 font-black uppercase tracking-[0.3em]">No existen registros previos para visualización rápida</p>
                                    </div>
                                )}

                            </motion.div>

                            <motion.div 
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="space-y-8"
                            >
                                <div className="flex items-center gap-4 px-6">
                                    <Clock size={18} className="text-primary" />
                                    <h4 className="text-[11px] font-black text-navy uppercase tracking-[0.3em]">Resumen Actividad (Últimas 10 Sesiones)</h4>
                                </div>
                                <div className="glass rounded-[4.5rem] border border-border/40 overflow-hidden shadow-2xl bg-white/50 backdrop-blur-md">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-[#fcfdfe]/80 border-b border-border/40">
                                            <tr className="text-[9px] font-black text-navy/50 uppercase tracking-[0.3em]">
                                                <th className="p-8">Calendario / Turno</th>
                                                <th className="p-8">Auditor Responsable</th>
                                                <th className="p-8 text-right">Saldo Finalizado</th>
                                                <th className="p-8 text-center">Acceso</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/10">
                                            {historialTurnos.map(h => (
                                                <tr key={h.id} className="hover:bg-white transition-all group">
                                                    <td className="p-8">
                                                        <div className="font-mono font-black text-text text-sm tracking-tighter">{new Date(h.fecha).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })}</div>
                                                        <div className="text-[8px] font-black uppercase text-primary mt-1 tracking-widest">{h.turno}</div>
                                                    </td>
                                                    <td className="p-8 font-black text-navy text-xs uppercase tracking-tighter leading-tight">{h.responsable}</td>
                                                    <td className="p-8 text-right font-black font-mono text-lg text-navy tracking-tighter">Bs {h.monto_final?.toLocaleString()}</td>
                                                    <td className="p-8 text-center">
                                                        <button 
                                                            onClick={() => setShowDetailModal(h)} 
                                                            className="p-4 bg-white rounded-2xl text-muted hover:text-primary shadow-sm hover:shadow-xl transition-all active:scale-90 border border-border/20" 
                                                            title="Ver Auditoría"
                                                        >
                                                            <Eye size={20} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {historialTurnos.length === 0 && (
                                                <tr>
                                                <td colSpan="4" className="p-32 text-center text-navy/60 uppercase font-black text-xs tracking-[0.5em] italic">Historial de sesiones vacío</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </div>
            ) : (
                /* --- VISTA: ARCHIVO HISTÓRICO (ADMINISTRATIVO) --- */
                <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-10"
                >
                    {/* Barra de Auditoría */}
                    <div className="bg-navy text-white p-12 rounded-[5rem] shadow-[0_48px_120px_-20px_rgba(0,0,0,0.5)] flex flex-col xl:flex-row justify-between items-center gap-10 border border-white/5 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-primary/10 blur-[150px] rounded-full -ml-40 -mt-40 transition-all duration-1000 group-hover:scale-125" />
                        <div className="relative shrink-0 text-center xl:text-left">
                           <h2 className="text-5xl font-display uppercase tracking-tight leading-none text-white font-black">Caja Maestra</h2>
                           <p className="text-white/60 text-[11px] font-mono uppercase tracking-[0.6em] mt-5">Inteligencia y Auditoría de Flujos Históricos</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-6 relative">
                            <div className="flex items-center gap-5 bg-white/5 border border-white/10 rounded-[2.5rem] px-10 py-5 backdrop-blur-2xl shadow-inner group hover:bg-white/10 transition-all">
                                <Clock size={20} className="text-primary" />
                                <div className="flex items-center gap-4">
                                    <input 
                                        type="date" 
                                        value={dateRange.from}
                                        onChange={e => setDateRange({...dateRange, from: e.target.value})}
                                        className="bg-transparent text-[11px] font-black font-mono outline-none text-white w-32 uppercase opacity-80 focus:opacity-100 transition-opacity"
                                    />
                                    <span className="text-white/20 select-none font-black text-[10px] tracking-widest">— AL —</span>
                                    <input 
                                        type="date" 
                                        value={dateRange.to}
                                        onChange={e => setDateRange({...dateRange, to: e.target.value})}
                                        className="bg-transparent text-[11px] font-black font-mono outline-none text-white w-32 uppercase opacity-80 focus:opacity-100 transition-opacity"
                                    />
                                </div>
                            </div>
                            <div className="relative group">
                                <input 
                                    type="text" 
                                    placeholder="Auditar por responsable..." 
                                    className="bg-white/5 border border-white/10 rounded-[2.5rem] px-12 py-5 text-xs font-black outline-none focus:border-primary/50 w-96 text-white placeholder-white/20 transition-all focus:bg-white/10 focus:shadow-[0_0_40px_rgba(245,168,0,0.1)] shadow-inner"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                                <Search className="absolute right-8 top-5.5 text-white/40 group-focus-within:text-primary transition-all duration-300 group-hover:scale-110" size={20} />
                            </div>
                        </div>
                    </div>

                    {/* Tabla Maestra */}
                    <div className="glass rounded-[5rem] border border-border/40 shadow-[0_60px_150px_-30px_rgba(0,0,0,0.2)] overflow-hidden bg-white/60 backdrop-blur-xl">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#fcfdfe]/80 border-b border-border/40">
                                <tr className="text-[10px] font-black uppercase tracking-[0.3em] text-navy/60">
                                    <th className="p-10">Referencia de Sesión</th>
                                    <th className="p-10">Responsable Auditor</th>
                                    <th className="p-10">Turno</th>
                                    <th className="p-10 text-right">Saldo Apertura</th>
                                    <th className="p-10 text-right">Cierre Efectivo</th>
                                    <th className="p-10 text-right">Gestión Administrativa</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {historialTurnos.map(h => (
                                    <tr key={h.id} className="hover:bg-primary/5 transition-all group">
                                        <td className="p-10">
                                            <div className="font-black text-navy text-sm uppercase tracking-tighter leading-none mb-2">{new Date(h.fecha).toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                                            <div className="text-[9px] opacity-40 font-mono tracking-widest font-black">REF_ID: {h.id.slice(0,10).toUpperCase()}</div>
                                        </td>
                                        <td className="p-10 font-black text-navy text-sm uppercase tracking-tight leading-tight">{h.responsable}</td>
                                        <td className="p-10">
                                            <span className="text-[10px] font-black uppercase bg-navy text-white px-6 py-2.5 rounded-full shadow-2xl shadow-navy/40 border border-white/5">{h.turno}</span>
                                        </td>
                                        <td className="p-10 text-right font-bold text-navy/30 font-mono italic text-xs">Bs {h.monto_inicial.toLocaleString()}</td>
                                        <td className="p-10 text-right">
                                            <div className="font-black text-navy font-mono text-3xl tracking-tighter shadow-primary leading-none">Bs {h.monto_final?.toLocaleString()}</div>
                                            <div className="text-[9px] font-black text-success mt-1 tracking-widest opacity-60 uppercase">Cerrado Correctamente</div>
                                        </td>
                                        <td className="p-10">
                                            <div className="flex items-center justify-end gap-3 translate-x-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500">
                                                <button onClick={() => setShowDetailModal(h)} className="p-5 bg-white rounded-3xl text-navy/60 hover:text-primary shadow-sm hover:shadow-2xl transition-all active:scale-90 border border-border/20 group/btn" title="Informe Detallado">
                                                    <Eye size={22} className="group-hover/btn:scale-110 transition-transform" />
                                                </button>
                                                <button onClick={() => setShowEditModal(h)} className="p-5 bg-white rounded-3xl text-navy/60 hover:text-accent shadow-sm hover:shadow-2xl transition-all active:scale-90 border border-border/20 group/btn" title="Modificar Registro">
                                                    <Edit3 size={22} className="group-hover/btn:rotate-12 transition-transform" />
                                                </button>
                                                <button onClick={() => handleDeleteTurno(h.id)} className="p-5 bg-white rounded-3xl text-navy/60 hover:text-error shadow-sm hover:shadow-2xl transition-all active:scale-90 border border-border/20 group/btn" title="Anular Registro Maestro">
                                                    <Trash2 size={22} className="group-hover/btn:-rotate-12 transition-transform" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {historialTurnos.length === 0 && (
                                    <tr>
                                        <td colSpan="6" className="p-52 text-center">
                                            <div className="flex flex-col items-center gap-8 text-muted/30">
                                                <Search size={80} className="stroke-[1px] opacity-60 text-primary" />
                                                <p className="text-[11px] uppercase font-black tracking-[0.6em] italic leading-relaxed text-navy/70">No se encontraron registros que satisfagan la auditoría actual</p>
                                                <button 
                                                    onClick={() => {setDateRange({from: '', to: ''}); setSearchTerm('');}}
                                                    className="text-[9px] font-black text-primary border-b border-primary/40 pb-1 hover:text-navy hover:border-navy transition-all"
                                                >
                                                    RESETEAR SISTEMA DE FILTRO
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {hasMore && (
                        <div className="flex justify-center pb-32">
                            <button 
                                onClick={() => setHistoryLimit(prev => prev + 20)}
                                className="bg-navy text-white px-20 py-8 rounded-[2.5rem] text-[11px] font-black uppercase tracking-[0.5em] shadow-[0_30px_90px_-15px_rgba(0,0,0,0.5)] hover:bg-black active:scale-95 transition-all flex items-center gap-8 border border-white/5"
                            >
                                <Plus size={24} className="text-primary" /> Sincronizar Registros de Archivo Profundo
                            </button>
                        </div>
                    )}
                </motion.div>
            )}

            {/* --- MODAL ABRIR CAJA --- */}
            <AnimatePresence>
                {showOpenModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-md">
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20"
                        >
                            <div className="bg-navy p-6 text-white text-center relative">
                                <button onClick={() => setShowOpenModal(false)} className="absolute right-6 top-6 text-white/40 hover:text-white transition-colors">
                                    <XCircle size={24} />
                                </button>
                                <div className="w-16 h-16 bg-primary text-background rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-primary/20">
                                    <Wallet size={32} className="stroke-[2.5px]" />
                                </div>
                                <h3 className="text-2xl font-display uppercase tracking-tight">Apertura de Turno</h3>
                                <p className="text-white/40 text-[10px] font-mono uppercase tracking-[0.3em] mt-1">Configuración inicial de caja</p>
                            </div>
                            
                            <div className="p-10 space-y-6">
                                <div className="grid grid-cols-1 gap-4">
                                    <div>
                                        <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Turno</label>
                                        <select 
                                            value={openForm.turno}
                                            onChange={e => setOpenForm({...openForm, turno: e.target.value})}
                                            className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                                        >
                                            <option>MAÑANA</option>
                                            <option>TARDE</option>
                                            <option>DÍA</option>
                                        </select>
                                    </div>
                                    <div className="bg-background/50 p-4 rounded-2xl border border-border/40">
                                         <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-1 px-1">Responsable Detectado</label>
                                         <div className="flex items-center gap-2 text-navy">
                                             <User size={14} className="text-primary" />
                                             <span className="text-sm font-bold">{profile?.nombre || user?.email}</span>
                                         </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Monto Inicial en Efectivo (BS)</label>
                                    <div className="relative">
                                        <input 
                                            type="number"
                                            value={openForm.monto_inicial}
                                            onChange={e => setOpenForm({...openForm, monto_inicial: e.target.value})}
                                            className="w-full bg-background border-2 border-border/80 p-4 rounded-2xl text-2xl font-black font-mono outline-none focus:border-primary transition-all text-center tracking-tighter"
                                            placeholder="0.00"
                                        />
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-bold text-xs uppercase">Bs</div>
                                    </div>
                                </div>

                                {ultimoTurno && openForm.monto_inicial && parseFloat(openForm.monto_inicial) !== ultimoTurno.monto_final && (
                                    <div className="bg-error/5 border border-error/20 p-4 rounded-2xl flex gap-3 items-center">
                                        <AlertCircle size={20} className="text-error shrink-0" />
                                        <p className="text-[10px] font-bold text-error leading-relaxed uppercase">
                                            Diferencia detectada: el turno anterior cerró con <span className="underline">Bs {ultimoTurno.monto_final.toLocaleString()}</span>. 
                                            Faltan/Sobran Bs {(parseFloat(openForm.monto_inicial) - ultimoTurno.monto_final).toLocaleString()}.
                                        </p>
                                    </div>
                                )}

                                {ultimoTurno && openForm.monto_inicial && parseFloat(openForm.monto_inicial) === ultimoTurno.monto_final && (
                                    <div className="bg-success/5 border border-success/20 p-4 rounded-2xl flex gap-3 items-center">
                                        <CheckCircle2 size={20} className="text-success shrink-0" />
                                        <p className="text-[10px] font-bold text-success leading-relaxed uppercase tracking-wider">
                                            ¡El monto coincide perfectamente con el cierre anterior! Saldo verificado.
                                        </p>
                                    </div>
                                )}

                                <button 
                                    onClick={handleOpenCaja}
                                    className="w-full bg-text text-white py-5 rounded-3xl text-sm font-black uppercase tracking-[0.3em] hover:bg-black transition-all shadow-2xl active:scale-95"
                                >
                                    Abrir Turno Ahora
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* --- MODAL CERRAR CAJA --- */}
            <AnimatePresence>
                {showCloseModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-md">
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20"
                        >
                            <div className="p-8 text-center space-y-6">
                                <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto shadow-inner">
                                    <AlertCircle size={32} className="stroke-[2.5px]" />
                                </div>
                                <div>
                                    <h3 className="text-2xl font-display uppercase tracking-tight text-navy">¿Cerrar Turno Actual?</h3>
                                    <p className="text-xs text-muted font-medium mt-2">Se registrarán los totales finales y la caja dejará de recibir movimientos.</p>
                                </div>

                                <div className="bg-background/50 rounded-3xl p-6 border border-border divide-y divide-border/40">
                                    <div className="flex justify-between py-2 items-center">
                                        <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Inicio</span>
                                        <span className="font-mono font-black text-navy">Bs {turnoActivo.monto_inicial.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between py-2 items-center">
                                        <span className="text-[10px] font-bold text-success uppercase tracking-widest">+ Ingresos</span>
                                        <span className="font-mono font-black text-success">Bs {totals.ingresos.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between py-2 items-center">
                                        <span className="text-[10px] font-bold text-error uppercase tracking-widest">- Egresos</span>
                                        <span className="font-mono font-black text-error">Bs {totals.egresos.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between py-4 items-center">
                                        <span className="text-[11px] font-black text-navy uppercase tracking-[0.2em]">Cierre Estimado</span>
                                        <span className="text-2xl font-black font-mono text-primary">Bs {totals.saldoActual.toLocaleString()}</span>
                                    </div>
                                </div>

                                <div className="flex gap-4">
                                    <button onClick={() => setShowCloseModal(false)} className="flex-1 bg-surface py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-navy border border-border hover:bg-white transition-all">Cancelar</button>
                                    <button onClick={handleCloseCaja} className="flex-1 bg-error text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-error/20 hover:brightness-110 active:scale-95 transition-all">Confirmar Cierre</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* --- MODAL EDITAR TURNO --- */}
            <AnimatePresence>
                {showEditModal && (
                    <EditTurnoModal 
                        turno={showEditModal} 
                        vendedores={vendedores}
                        onSave={handleSaveEditTurno} 
                        onClose={() => setShowEditModal(null)} 
                    />
                )}
            </AnimatePresence>

            {/* --- MODAL DETALLE TURNO HISTORIAL --- */}
            <AnimatePresence>
                {showDetailModal && (
                   <TurnoDetailModal 
                        turno={showDetailModal} 
                        onClose={() => setShowDetailModal(null)} 
                   />
                )}
            </AnimatePresence>
        </div>
    );
}

function EditTurnoModal({ turno, vendedores, onSave, onClose }) {
    const [formData, setFormData] = useState({ ...turno });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-md">
            <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20"
            >
                <div className="bg-navy p-6 text-white text-center relative">
                    <button onClick={onClose} className="absolute right-6 top-6 text-white/40 hover:text-white transition-colors">
                        <XCircle size={24} />
                    </button>
                    <h3 className="text-2xl font-display uppercase tracking-tight">Editar Turno Cerrado</h3>
                    <p className="text-white/40 text-[10px] font-mono uppercase tracking-[0.2em] mt-1">ID: {turno.id.slice(0,8)}</p>
                </div>
                
                <div className="p-10 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Fecha</label>
                            <input 
                                type="date"
                                value={formData.fecha}
                                onChange={e => setFormData({...formData, fecha: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Turno</label>
                            <select 
                                value={formData.turno}
                                onChange={e => setFormData({...formData, turno: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                            >
                                <option>MAÑANA</option>
                                <option>TARDE</option>
                                <option>DÍA</option>
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Responsable</label>
                            <input 
                                type="text"
                                value={formData.responsable}
                                onChange={e => setFormData({...formData, responsable: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Saldo Inicial (BS)</label>
                            <input 
                                type="number"
                                value={formData.monto_inicial}
                                onChange={e => setFormData({...formData, monto_inicial: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-lg font-black font-mono focus:border-primary outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Saldo Final (BS)</label>
                            <input 
                                type="number"
                                value={formData.monto_final}
                                onChange={e => setFormData({...formData, monto_final: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-lg font-black font-mono focus:border-primary outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="flex gap-4 mt-4">
                        <button onClick={onClose} className="flex-1 bg-surface py-4 rounded-3xl text-[10px] font-black uppercase tracking-widest text-navy border border-border">Cancelar</button>
                        <button onClick={() => onSave(formData)} className="flex-1 bg-primary text-navy py-4 rounded-3xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 transition-all">Guardar Cambios</button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

function TurnoDetailModal({ turno, onClose }) {
    const [movs, setMovs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchMovs();
    }, [turno.id]);

    const fetchMovs = async () => {
        setLoading(true);
        const { data } = await supabase.from('caja_movimientos').select('*').eq('turno_id', turno.id).order('created_at', { ascending: true });
        setMovs(data || []);
        setLoading(false);
    };

    const ingresos = movs.filter(m => m.tipo === 'INGRESO').reduce((acc, m) => acc + m.monto, 0);
    const egresos = movs.filter(m => m.tipo === 'EGRESO').reduce((acc, m) => acc + m.monto, 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-lg">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[3rem] shadow-[0_32px_120px_-20px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
            >
                {/* Header Compacto Detalle */}
                <div className="bg-navy p-8 text-white flex justify-between items-start shrink-0 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full -mr-32 -mt-32 blur-3xl opacity-30" />
                    <div className="relative">
                        <div className="flex items-center gap-3 text-sky font-bold text-[10px] uppercase tracking-widest mb-2">
                            <History size={14} /> DETALLE DE TURNO — #{turno.id.slice(0,8)}
                        </div>
                        <h3 className="text-3xl font-display uppercase tracking-tight tracking-tighter">{turno.responsable}</h3>
                        <p className="text-xs text-white/50 font-medium mt-1">Cerrado el {new Date(turno.cerrado_at).toLocaleString()} • Turno {turno.turno}</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-white/40 hover:text-white transition-all bg-white/5 rounded-full relative z-10">
                        <XCircle size={28} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {loading ? (
                       <div className="py-20 flex justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent animate-spin rounded-full" /></div>
                    ) : (
                        <div className="space-y-8">
                            {/* Resumen Numeros */}
                            <div className="grid grid-cols-4 gap-4">
                                <div className="p-4 rounded-2xl bg-background border border-border/40 text-center">
                                    <p className="text-[9px] font-bold text-muted uppercase tracking-widest mb-1">Inicial</p>
                                    <p className="text-lg font-black font-mono">Bs {turno.monto_inicial.toLocaleString()}</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-success/5 border border-success/20 text-center">
                                    <p className="text-[9px] font-bold text-success uppercase tracking-widest mb-1">Ingresos</p>
                                    <p className="text-lg font-black font-mono text-success">+ {ingresos.toLocaleString()}</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-error/5 border border-error/20 text-center">
                                    <p className="text-[9px] font-bold text-error uppercase tracking-widest mb-1">Egresos</p>
                                    <p className="text-lg font-black font-mono text-error">- {egresos.toLocaleString()}</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-navy text-white text-center shadow-lg">
                                    <p className="text-[9px] font-bold text-sky uppercase tracking-widest mb-1">Final</p>
                                    <p className="text-lg font-black font-mono text-primary">Bs {turno.monto_final?.toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Categorización */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <h5 className="text-[10px] font-black text-success uppercase tracking-[0.2em] flex items-center gap-2">
                                        <ArrowDownLeft size={14} /> Desglose de Ingresos
                                    </h5>
                                    <div className="divide-y divide-border/20 border border-border/20 rounded-2xl overflow-hidden shadow-sm">
                                        {['Venta Stock', 'Cobro Pedido', 'Cobro Seña', 'Otro Ingreso'].map(cat => {
                                            const amt = movs.filter(m => m.categoria === cat).reduce((acc, m) => acc + m.monto, 0);
                                            return (
                                                <div key={cat} className="p-4 flex justify-between items-center bg-white hover:bg-success/5 transition-all">
                                                    <span className="text-[11px] font-bold text-text uppercase tracking-wide">{cat}</span>
                                                    <span className="text-sm font-black font-mono text-success">Bs {amt.toLocaleString()}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h5 className="text-[10px] font-black text-error uppercase tracking-[0.2em] flex items-center gap-2">
                                        <ArrowUpRight size={14} /> Desglose de Egresos
                                    </h5>
                                    <div className="divide-y divide-border/20 border border-border/20 rounded-2xl overflow-hidden shadow-sm">
                                        {['Compra/Gasto', 'Retiro', 'Pago Proveedor', 'Otro Egreso'].map(cat => {
                                            const amt = movs.filter(m => m.categoria === cat).reduce((acc, m) => acc + m.monto, 0);
                                            return (
                                                <div key={cat} className="p-4 flex justify-between items-center bg-white hover:bg-error/5 transition-all">
                                                    <span className="text-[11px] font-bold text-text uppercase tracking-wide">{cat}</span>
                                                    <span className="text-sm font-black font-mono text-error">Bs {amt.toLocaleString()}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* Tabla Completa (Scrollable) */}
                            <div className="space-y-4">
                                <h5 className="text-[10px] font-black text-navy uppercase tracking-[0.2em] flex items-center gap-2">
                                    <Clock size={14} /> Auditoría de Movimientos
                                </h5>
                                <div className="border border-border/40 rounded-2xl overflow-hidden">
                                    <table className="w-full text-[11px] border-collapse">
                                        <thead className="bg-[#f8f9fa] border-b border-border/40 text-muted/60 uppercase font-bold tracking-tighter">
                                            <tr>
                                                <th className="p-3 text-left">Hora</th>
                                                <th className="p-3 text-left">Categoría</th>
                                                <th className="p-3 text-left">Detalle</th>
                                                <th className="p-3 text-right">Monto</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/10 text-navy/80">
                                            {movs.map(m => (
                                                <tr key={m.id} className="hover:bg-background transition-all">
                                                    <td className="p-3 border-r border-border/5 font-mono opacity-60">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td className="p-3 font-black">{m.categoria}</td>
                                                    <td className="p-3 italic opacity-80">{m.concepto || '—'}</td>
                                                    <td className={`p-3 text-right font-black font-mono ${m.tipo === 'INGRESO' ? 'text-success' : 'text-error'}`}>
                                                        {m.tipo === 'INGRESO' ? '+' : '-'} {m.monto.toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 bg-navy/5 border-t border-border/40 text-center shrink-0">
                    <p className="text-[10px] font-mono text-navy/30 uppercase tracking-[0.4em]">Fin del Reporte Auditado</p>
                </div>
            </motion.div>
        </div>
    );
}
