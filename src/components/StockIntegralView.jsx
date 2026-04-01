import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { 
    Database, Package, Truck, Search, 
    Filter, Calendar, ChevronRight, Info,
    Image as ImageIcon, Loader2, TrendingUp
} from 'lucide-react';

export default function StockIntegralView() {
    const [loading, setLoading] = useState(true);
    const [catalog, setCatalog] = useState([]);
    const [activeWeeks, setActiveWeeks] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [onlyWithStock, setOnlyWithStock] = useState(false);

    useEffect(() => {
        loadIntegratedData();
    }, []);

    const loadIntegratedData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Weeks that might have floating stock
            const { data: weeks } = await supabase
                .from('semanas')
                .select('*')
                .order('created_at', { ascending: false });

            // 2. Fetch Master Confirmations and Receptions
            const [masters, receptions, products] = await Promise.all([
                supabase.from('master_confirmaciones').select('semana_id, datos_json'),
                supabase.from('pedido_items_recepcion').select('semana_id, titulo, cantidad_received:cantidad_recibida'),
                supabase.from('catalogo_productos').select('*').order('titulo', { ascending: true })
            ]);

            // 3. Process which weeks are actually "floating" (have units confirmed but not yet fully received)
            const weekStats = (weeks || []).map(w => {
                const master = masters.data?.find(m => m.semana_id === w.id);
                const weekReceptions = (receptions.data || []).filter(r => r.semana_id === w.id);
                
                const totalConfirmed = (master?.datos_json || []).reduce((sum, it) => sum + (it.cantidad || 0), 0);
                const totalReceived = weekReceptions.reduce((sum, r) => sum + (r.cantidad_received || 0), 0);
                
                const fechaArribo = w.fecha_estimada_llegada 
                    ? new Date(w.fecha_estimada_llegada)
                    : new Date(new Date(w.created_at).getTime() + (22 * 24 * 60 * 60 * 1000));

                return {
                    ...w,
                    masterData: master?.datos_json || [],
                    receptionData: weekReceptions,
                    floatingCount: Math.max(0, totalConfirmed - totalReceived),
                    fechaArribo
                };
            }).filter(w => w.floatingCount > 0);

            setActiveWeeks(weekStats);

            // 4. Build the Catalog + Floating mapping
            const integratedCatalog = (products.data || []).map(prod => {
                const prodTitle = (prod.titulo || '').toLowerCase().trim();
                
                // Calculate floating units for THIS product in each active week
                const floatingByWeek = {};
                let totalFlotante = 0;

                weekStats.forEach(week => {
                    const confirmedInWeek = week.masterData
                        .filter(it => (it.titulo || '').toLowerCase().trim() === prodTitle)
                        .reduce((sum, it) => sum + (it.cantidad || 0), 0);
                    
                    const receivedInWeek = week.receptionData
                        .filter(r => (r.titulo || '').toLowerCase().trim() === prodTitle)
                        .reduce((sum, r) => sum + (r.cantidad_received || 0), 0);
                    
                    const pending = Math.max(0, confirmedInWeek - receivedInWeek);
                    if (pending > 0) {
                        floatingByWeek[week.id] = pending;
                        totalFlotante += pending;
                    }
                });

                return {
                    ...prod,
                    floatingByWeek,
                    totalFlotante,
                    totalIntegral: (prod.stock_fisico || 0) + totalFlotante
                };
            });

            setCatalog(integratedCatalog);

        } catch (err) {
            console.error("Error loading integrated stock:", err);
        } finally {
            setLoading(false);
        }
    };

    const filteredCatalog = useMemo(() => {
        let result = catalog;
        if (searchTerm) {
            const lowSearch = searchTerm.toLowerCase();
            result = result.filter(p => 
                p.titulo?.toLowerCase().includes(lowSearch) || 
                p.ean?.includes(lowSearch)
            );
        }
        if (onlyWithStock) {
            result = result.filter(p => p.totalIntegral > 0);
        }
        return result;
    }, [catalog, searchTerm, onlyWithStock]);

    if (loading) return <div className="py-20 flex justify-center"><Loader2 size={40} className="animate-spin text-secondary" /></div>;

    return (
        <div className="space-y-6 max-w-[1600px] mx-auto px-4">
            {/* Header / Search */}
            <div className="glass p-6 rounded-3xl border border-border/40 shadow-xl flex flex-col md:flex-row justify-between items-center gap-6">
                <div className="flex items-center gap-4">
                    <div className="p-3 bg-navy text-white rounded-2xl shadow-lg">
                        <Database size={24} />
                    </div>
                    <div>
                        <h3 className="text-2xl font-bold tracking-tight text-navy uppercase">Stock Integral de Tienda</h3>
                        <p className="text-xs text-muted-2 font-mono flex items-center gap-1">
                            <TrendingUp size={12} className="text-secondary" /> Inventario Consolidado: Físico + Flotante (Confirmado)
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="relative flex-1 md:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                        <input 
                            type="text" 
                            placeholder="Buscar por título o EAN..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-white border border-border/40 p-4 pl-12 rounded-2xl text-sm font-bold shadow-sm focus:border-secondary outline-none transition-all"
                        />
                    </div>
                    <button 
                        onClick={() => setOnlyWithStock(!onlyWithStock)}
                        className={`flex items-center gap-2 px-5 py-4 rounded-2xl text-xs font-bold transition-all
                            ${onlyWithStock ? 'bg-secondary text-white shadow-lg' : 'bg-white text-muted-2 border border-border/40 hover:border-secondary/40'}`}
                    >
                        <Filter size={16} />
                        {onlyWithStock ? 'Solo con Stock' : 'Ver Todo'}
                    </button>
                </div>
            </div>

            {/* Main Grid Table */}
            <div className="glass rounded-3xl overflow-hidden border border-border/40 shadow-2xl bg-white/50 backdrop-blur-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[1000px]">
                        <thead>
                            <tr className="bg-navy text-white/90 text-xs font-bold uppercase tracking-widest text-[10px]">
                                <th className="p-5 pl-8 border-b border-white/10 w-24">Imagen</th>
                                <th className="p-5 border-b border-white/10">Título del Libro</th>
                                <th className="p-5 border-b border-white/10 text-right">Precio BS</th>
                                <th className="p-5 border-b border-white/10 text-center bg-white/5">Físico Real</th>
                                
                                {/* Dynamic Weeks Columns */}
                                {activeWeeks.map(w => (
                                    <th key={w.id} className="p-5 border-b border-white/10 text-center bg-secondary/5 border-l border-white/5">
                                        <div className="text-[9px] text-secondary/60 mb-1 leading-none">{w.nombre}</div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-[11px]">{w.fechaArribo.toLocaleDateString('es', { day: '2-digit', month: '2-digit' })}</span>
                                            <span className="text-[8px] opacity-40 font-mono">Arribo Est.</span>
                                        </div>
                                    </th>
                                ))}

                                <th className="p-5 border-b border-white/10 text-center bg-accent/20 border-l border-white/10">Stock Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/10">
                            {filteredCatalog.map((item) => (
                                <tr key={item.id} className="hover:bg-white/60 transition-colors group">
                                    <td className="p-4 pl-8">
                                        <div className="w-12 h-16 bg-navy/5 rounded-lg overflow-hidden border border-border/20 flex items-center justify-center relative shadow-sm group-hover:shadow-md transition-shadow">
                                            {item.imagen_url ? (
                                                <img src={item.imagen_url} alt="" className="w-full h-full object-cover" />
                                            ) : <ImageIcon className="text-muted/20" size={20} />}
                                        </div>
                                    </td>
                                    <td className="p-4">
                                        <div className="font-bold text-navy text-sm">{item.titulo}</div>
                                        <div className="text-[10px] font-mono text-muted uppercase mt-0.5">{item.ean || 'SIN EAN'}</div>
                                    </td>
                                    <td className="p-4 text-right font-mono font-bold text-navy/70 text-xs">
                                        {item.precio_lista ? `BS ${item.precio_lista.toFixed(2)}` : '--'}
                                    </td>
                                    
                                    {/* Physical Stock */}
                                    <td className="p-4 text-center bg-white/5">
                                        <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl font-black text-sm
                                            ${(item.stock_fisico || 0) > 0 ? 'bg-navy text-white shadow-lg shadow-navy/20' : 'bg-red-50 text-red-300 opacity-40'}`}>
                                            {item.stock_fisico || 0}
                                        </span>
                                    </td>

                                    {/* Dynamic Weeks Columns Values */}
                                    {activeWeeks.map(w => {
                                        const qty = item.floatingByWeek[w.id] || 0;
                                        return (
                                            <td key={w.id} className="p-4 text-center border-l border-border/10 bg-secondary/5">
                                                {qty > 0 ? (
                                                    <div className="flex flex-col items-center animate-in zoom-in-50 duration-300">
                                                        <span className="bg-secondary text-white text-[11px] font-black px-2 py-0.5 rounded-lg shadow-sm">
                                                            +{qty}
                                                        </span>
                                                        <span className="text-[8px] text-secondary font-bold mt-1 uppercase tracking-tighter">Flotante</span>
                                                    </div>
                                                ) : <span className="text-[10px] text-muted/20">-</span>}
                                            </td>
                                        );
                                    })}

                                    {/* Total Integral */}
                                    <td className="p-4 text-center bg-accent/10 border-l border-border/10">
                                        <div className="flex flex-col items-center">
                                            <span className={`text-lg font-black ${item.totalIntegral > 0 ? 'text-accent' : 'text-muted/20'}`}>
                                                {item.totalIntegral}
                                            </span>
                                            {item.totalFlotante > 0 && (
                                                <span className="text-[8px] font-bold text-muted uppercase leading-none mt-1">
                                                    ({item.stock_fisico || 0} + {item.totalFlotante} fl.)
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {filteredCatalog.length === 0 && (
                    <div className="p-20 text-center">
                        <Package size={48} className="mx-auto text-muted mb-4 opacity-10" />
                        <p className="text-muted font-bold">No se encontraron productos que coincidan con la búsqueda.</p>
                    </div>
                )}
            </div>

            {/* Legend */}
            <div className="p-5 bg-white/80 rounded-2xl border border-border/30 flex items-center gap-6 shadow-sm">
                <Info size={20} className="text-secondary shrink-0" />
                <div className="text-[11px] text-muted-2 leading-relaxed font-medium">
                    <b className="text-navy">¿Cómo interpretar esta tabla?</b> Las columnas resaltadas en <span className="text-secondary font-bold">naranja</span> representan unidades confirmadas por el distribuidor que están en tránsito. El <b className="text-accent">Stock Total</b> es la disponibilidad final proyectada. Al recibir físicamente una carga en la pestaña 'Recepción', las unidades se moverán automáticamente de la columna de fecha a la de <b className="text-navy">Físico Real</b>.
                </div>
            </div>
        </div>
    );
}

const AnimatePresence = ({ children }) => children;
