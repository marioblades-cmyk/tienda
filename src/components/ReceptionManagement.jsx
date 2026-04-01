import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { 
    Package, CheckCircle2, AlertCircle, Search, 
    ChevronRight, ChevronDown, Save, Loader2,
    Users, Info, Truck
} from 'lucide-react';

export default function ReceptionManagement() {
    const [semanas, setSemanas] = useState([]);
    const [selectedSemana, setSelectedSemana] = useState('');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [masterItems, setMasterItems] = useState([]);
    const [orderBreakdown, setOrderBreakdown] = useState({});
    const [receivedCounts, setReceivedCounts] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedItem, setExpandedItem] = useState(null);
    const [skipStockUpdate, setSkipStockUpdate] = useState(false);

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
            // 1. Fetch Master Confirmation
            const { data: master } = await supabase
                .from('master_confirmaciones')
                .select('*')
                .eq('semana_id', semanaId)
                .maybeSingle();

            // 2. Fetch Seller Orders for breakdown
            const { data: orders } = await supabase
                .from('pedido_items')
                .select('*, pedido:pedidos!inner(vendedor_nombre, tipo)')
                .eq('pedido.semana_id', semanaId);

            // 3. Fetch current reception status
            const { data: currentReception } = await supabase
                .from('pedido_items_recepcion')
                .select('*')
                .eq('semana_id', semanaId);

            if (master && master.datos_json) {
                setMasterItems(master.datos_json);
                
                // Index current reception
                const receptionMap = {};
                (currentReception || []).forEach(r => {
                    const key = r.titulo.toLowerCase().trim();
                    receptionMap[key] = (receptionMap[key] || 0) + r.cantidad_recibida;
                });
                
                // Initialize counts with 0 (or delta if we want to add to existing)
                // Actually, let's just initialize the inputs as empty
                setReceivedCounts({});
            } else {
                setMasterItems([]);
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

    const filteredItems = useMemo(() => {
        if (!searchTerm) return masterItems;
        return masterItems.filter(it => 
            it.titulo.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [masterItems, searchTerm]);

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

            // 2. Update physical stock in catalog
            // We need to match by title (fuzzy) or EAN if available. 
            // In master_confirmaciones we usually only have Title.
            for (const item of itemsToSave) {
                // This is a simplified stock update by title - might need EAN for precision
                const { data: prod } = await supabase
                    .from('catalogo_productos')
                    .select('id, stock_fisico')
                    .ilike('titulo', item.titulo)
                    .maybeSingle();
                
                if (prod) {
                    await supabase
                        .from('catalogo_productos')
                        .update({ stock_fisico: (prod.stock_fisico || 0) + item.cantidad_recibida })
                        .eq('id', prod.id);
                }
            }

            alert("✅ Recepción guardada con éxito y stock actualizado.");
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

            // 2. Update physical stock in catalog (SKIP IF CHECKED)
            if (!skipStockUpdate) {
                for (const item of itemsToSave) {
                    const { data: prod } = await supabase
                        .from('catalogo_productos')
                        .select('id, stock_fisico')
                        .ilike('titulo', item.titulo)
                        .maybeSingle();
                    
                    if (prod) {
                        await supabase
                            .from('catalogo_productos')
                            .update({ stock_fisico: (prod.stock_fisico || 0) + item.cantidad_recibida })
                            .eq('id', prod.id);
                    }
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

    if (!semanas.length && !loading) return <div className="p-8 text-center text-muted">Cargando semanas...</div>;

    return (
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

                    <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border/40 rounded-xl">
                        <input 
                            type="checkbox" 
                            id="skipStock" 
                            checked={skipStockUpdate}
                            onChange={(e) => setSkipStockUpdate(e.target.checked)}
                            className="accent-secondary h-4 w-4"
                        />
                        <label htmlFor="skipStock" className="text-[10px] font-bold text-muted-2 cursor-pointer select-none">
                            SOLO ARCHIVAR (NO SUMAR A STOCK)
                        </label>
                    </div>
                    
                    <button
                        onClick={handleFullReception}
                        disabled={saving || !selectedSemana}
                        className="p-2.5 px-4 bg-navy text-white rounded-xl text-xs font-bold hover:bg-navy/90 transition-all flex items-center gap-2"
                        title="Marcar todo como recibido"
                    >
                        <CheckCircle2 size={16} /> Todo Recibido
                    </button>

                    <button
                        onClick={handleSaveReception}
                        disabled={saving || !selectedSemana || Object.keys(receivedCounts).length === 0}
                        className="btn-primary flex items-center gap-2 bg-secondary text-white hover:bg-secondary/90 disabled:opacity-50"
                    >
                        {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                        Guardar{Object.keys(receivedCounts).length > 0 ? ` (${Object.values(receivedCounts).reduce((a,b)=>a+parseInt(b),0)})` : ''}
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
                        {/* Search Bar */}
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                            <input 
                                type="text" 
                                placeholder="Buscar título en la caja..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full bg-white border border-border/40 p-4 pl-12 rounded-2xl text-sm font-bold shadow-sm focus:border-secondary outline-none transition-all"
                            />
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
                                        const key = it.titulo.toLowerCase().trim();
                                        const breakdown = orderBreakdown[key] || [];
                                        const isExpanded = expandedItem === key;
                                        const inputVal = receivedCounts[key] || '';
                                        const confirmedQty = it.cantidad || 0;
                                        const missingQty = Math.max(0, confirmedQty - (parseInt(inputVal) || 0));

                                        return (
                                            <React.Fragment key={idx}>
                                                <tr className={`transition-colors ${isExpanded ? 'bg-secondary/5' : 'hover:bg-white/50'}`}>
                                                    <td className="p-4">
                                                        <button 
                                                            onClick={() => setExpandedItem(isExpanded ? null : key)}
                                                            className="p-1 hover:bg-secondary/10 rounded transition-colors text-secondary"
                                                        >
                                                            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                        </button>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold text-navy">{it.titulo}</div>
                                                        <div className="text-[10px] font-mono text-muted uppercase">Despacho ARS {it.precio_unitario?.toLocaleString()}</div>
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
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <input 
                                                            type="number" 
                                                            min="0"
                                                            placeholder="0"
                                                            value={inputVal}
                                                            onChange={(e) => setReceivedCounts({...receivedCounts, [key]: e.target.value})}
                                                            className={`w-20 p-2 text-center rounded-xl border-2 font-black text-lg transition-all outline-none 
                                                                ${inputVal ? 'border-secondary bg-secondary/10 text-secondary' : 'border-border/40 bg-background focus:border-secondary'}`}
                                                        />
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <span className={`font-bold px-3 py-1 rounded-full text-xs ${missingQty > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                                                            {missingQty > 0 ? `-${missingQty}` : 'Completo'}
                                                        </span>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-secondary/5 animate-in slide-in-from-top-2">
                                                        <td colSpan="5" className="p-6 pt-0">
                                                            <div className="flex flex-wrap gap-4 items-center">
                                                                <div className="flex items-center gap-2 text-[10px] font-bold text-secondary uppercase tracking-widest border-r border-secondary/20 pr-4">
                                                                    <Users size={14} /> Distribución:
                                                                </div>
                                                                {breakdown.length > 0 ? breakdown.map((b, bIdx) => (
                                                                    <div key={bIdx} className="bg-white px-3 py-1.5 rounded-lg border border-secondary/10 shadow-sm flex items-center gap-3">
                                                                        <span className="text-[11px] font-bold text-navy truncate max-w-[120px]">
                                                                            {b.tipo === 'tienda' ? '🏢 TIENDA' : b.vendedor}
                                                                        </span>
                                                                        <span className="bg-secondary text-white text-xs font-black px-2 py-0.5 rounded-md min-w-[24px] text-center">
                                                                            {b.cantidad}
                                                                        </span>
                                                                    </div>
                                                                )) : (
                                                                    <div className="text-xs text-muted italic flex items-center gap-1">
                                                                        <Info size={12} /> Título no encontrado en los pedidos iniciales (Extra)
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
                )
            ) : (
                <div className="glass p-20 text-center border-dashed border-2 animate-pulse">
                    <Truck size={64} className="mx-auto text-muted mb-4 opacity-10" />
                    <p className="text-muted font-display text-xl uppercase tracking-widest">Selecciona una semana para comenzar la recepción</p>
                </div>
            )}
        </div>
    );
}
