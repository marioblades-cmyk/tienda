import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { History, Search, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

const MOTIVO_STYLES = {
    'RECEPCIÓN':          'text-success bg-success/10 border-success/20',
    'VENTA':              'text-error bg-error/10 border-error/20',
    'DEVOLUCIÓN':         'text-primary bg-primary/10 border-primary/20',
    'CANCELAR RECEPCIÓN': 'text-orange-400 bg-orange-400/10 border-orange-400/20',
    'EDICIÓN MANUAL':     'text-secondary bg-secondary/10 border-secondary/20',
    'RESET':              'text-muted bg-muted/10 border-muted/20',
};

const PAGE_SIZE = 50;

export default function StockHistorialView() {
    const [movimientos, setMovimientos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filterMotivo, setFilterMotivo] = useState('TODOS');
    const [filterRango, setFilterRango] = useState('todo');
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [total, setTotal] = useState(0);

    const fetchMovimientos = useCallback(async (reset = false) => {
        setLoading(true);
        try {
            const currentOffset = reset ? 0 : offset;

            let query = supabase
                .from('stock_movimientos')
                .select('*', { count: 'exact' })
                .order('created_at', { ascending: false })
                .range(currentOffset, currentOffset + PAGE_SIZE - 1);

            if (filterMotivo !== 'TODOS') {
                query = query.eq('motivo', filterMotivo);
            }
            if (search.trim()) {
                query = query.ilike('titulo', `%${search.trim()}%`);
            }
            if (filterRango === 'hoy') {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                query = query.gte('created_at', today.toISOString());
            } else if (filterRango === '7dias') {
                const d = new Date();
                d.setDate(d.getDate() - 7);
                query = query.gte('created_at', d.toISOString());
            }

            const { data, count, error } = await query;
            if (error) throw error;

            if (reset) {
                setMovimientos(data || []);
                setOffset(PAGE_SIZE);
            } else {
                setMovimientos(prev => [...prev, ...(data || [])]);
                setOffset(currentOffset + PAGE_SIZE);
            }
            setTotal(count || 0);
            setHasMore((count || 0) > currentOffset + PAGE_SIZE);
        } catch (err) {
            console.error('Error fetching stock_movimientos:', err);
        } finally {
            setLoading(false);
        }
    }, [filterMotivo, filterRango, search, offset]);

    // Carga inicial y cuando cambian los filtros
    useEffect(() => {
        setOffset(0);
        fetchMovimientos(true);
    }, [filterMotivo, filterRango]);

    // Búsqueda con debounce
    useEffect(() => {
        const t = setTimeout(() => {
            setOffset(0);
            fetchMovimientos(true);
        }, 350);
        return () => clearTimeout(t);
    }, [search]);

    // Realtime: nuevos movimientos aparecen al instante
    useEffect(() => {
        const channel = supabase
            .channel('stock_historial_realtime')
            .on('postgres_changes', {
                event: 'INSERT',
                schema: 'public',
                table: 'stock_movimientos',
            }, (payload) => {
                setMovimientos(prev => [payload.new, ...prev]);
                setTotal(prev => prev + 1);
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, []);

    const formatFecha = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: '2-digit' })
            + ' ' + d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="flex flex-col gap-6 p-4 md:p-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold font-display text-text flex items-center gap-3">
                        <History className="text-primary" size={28} />
                        Historial de Stock
                    </h1>
                    <p className="text-sm text-muted mt-1">
                        Todos los cambios de stock físico — <span className="font-bold text-text">{total}</span> movimientos registrados
                    </p>
                </div>
                <button
                    onClick={() => fetchMovimientos(true)}
                    disabled={loading}
                    className="flex items-center gap-2 bg-surface border border-border px-4 py-2 rounded-xl text-sm font-bold text-muted hover:text-text transition-all"
                >
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    Actualizar
                </button>
            </div>

            {/* Filtros */}
            <div className="bg-surface border border-border p-4 rounded-2xl flex flex-col md:flex-row gap-3 items-center">
                {/* Búsqueda */}
                <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
                    <input
                        type="text"
                        placeholder="Buscar por título..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full bg-background border border-border/40 pl-10 pr-4 py-2.5 rounded-xl text-sm outline-none focus:border-primary transition-all"
                    />
                </div>

                {/* Motivo */}
                <select
                    value={filterMotivo}
                    onChange={e => setFilterMotivo(e.target.value)}
                    className="bg-background border border-border/40 px-4 py-2.5 rounded-xl text-xs font-bold uppercase outline-none focus:border-primary transition-all cursor-pointer"
                >
                    <option value="TODOS">Todos los motivos</option>
                    <option value="RECEPCIÓN">Recepción</option>
                    <option value="VENTA">Venta</option>
                    <option value="DEVOLUCIÓN">Devolución</option>
                    <option value="CANCELAR RECEPCIÓN">Cancelar Recepción</option>
                    <option value="EDICIÓN MANUAL">Edición Manual</option>
                    <option value="RESET">Reset</option>
                </select>

                {/* Rango */}
                <select
                    value={filterRango}
                    onChange={e => setFilterRango(e.target.value)}
                    className="bg-background border border-border/40 px-4 py-2.5 rounded-xl text-xs font-bold uppercase outline-none focus:border-primary transition-all cursor-pointer"
                >
                    <option value="todo">Todo el historial</option>
                    <option value="hoy">Hoy</option>
                    <option value="7dias">Últimos 7 días</option>
                </select>
            </div>

            {/* Tabla */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-muted text-[10px] uppercase border-b border-border bg-background font-black tracking-widest">
                                <th className="px-5 py-3">Fecha / Hora</th>
                                <th className="px-5 py-3">Título</th>
                                <th className="px-5 py-3 text-center">Cambio</th>
                                <th className="px-5 py-3 text-center">Stock resultante</th>
                                <th className="px-5 py-3">Motivo</th>
                                <th className="px-5 py-3">Detalle</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {loading && movimientos.length === 0 && (
                                <tr><td colSpan={6} className="py-16 text-center">
                                    <div className="animate-spin w-6 h-6 border-4 border-primary border-t-transparent rounded-full mx-auto" />
                                </td></tr>
                            )}
                            {!loading && movimientos.length === 0 && (
                                <tr><td colSpan={6} className="py-16 text-center text-muted italic text-sm">
                                    No hay movimientos registrados aún.
                                </td></tr>
                            )}
                            {movimientos.map(m => (
                                <tr key={m.id} className="hover:bg-white/5 transition-colors">
                                    <td className="px-5 py-3 text-muted text-xs font-mono whitespace-nowrap">
                                        {formatFecha(m.created_at)}
                                    </td>
                                    <td className="px-5 py-3 font-medium text-text max-w-[220px] truncate" title={m.titulo}>
                                        {m.titulo}
                                    </td>
                                    <td className="px-5 py-3 text-center">
                                        <span className={`inline-flex items-center gap-1 font-black font-mono text-sm ${m.delta > 0 ? 'text-success' : 'text-error'}`}>
                                            {m.delta > 0
                                                ? <TrendingUp size={14} />
                                                : <TrendingDown size={14} />
                                            }
                                            {m.delta > 0 ? '+' : ''}{m.delta}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-center font-mono text-xs text-muted">
                                        {m.stock_despues != null ? m.stock_despues : '—'}
                                    </td>
                                    <td className="px-5 py-3">
                                        <span className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-full border ${MOTIVO_STYLES[m.motivo] || 'text-muted bg-muted/10 border-muted/20'}`}>
                                            {m.motivo}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3 text-xs text-muted max-w-[180px] truncate" title={m.detalle}>
                                        {m.detalle || '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {hasMore && (
                    <div className="p-4 border-t border-border text-center">
                        <button
                            onClick={() => fetchMovimientos(false)}
                            disabled={loading}
                            className="bg-primary/10 text-primary border border-primary/20 px-6 py-2 rounded-xl text-xs font-black uppercase hover:bg-primary/20 transition-all disabled:opacity-50"
                        >
                            {loading ? 'Cargando...' : 'Cargar más'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
