import React, { useState, useMemo } from 'react';
import { X, Check, Eye, EyeOff, Zap, ZapOff, Trash2, Save, ShoppingBag, RefreshCw, Star, Info, Search, Plus, Filter } from 'lucide-react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';

export default function LanzamientosCurator({ isOpen, onClose, catalogData, onRefresh }) {
    const [items, setItems] = useState([]);
    const [activeTab, setActiveTab] = useState('novedades'); // 'novedades' | 'reimpresiones'
    const [isSaving, setIsSaving] = useState(false);
    const [searchManual, setSearchManual] = useState('');
    const [showManualResults, setShowManualResults] = useState(false);
    const [editorialFilter, setEditorialFilter] = useState('TODAS');

    // Inicializar datos cuando se abre el modal
    React.useEffect(() => {
        if (isOpen && catalogData) {
            const detected = catalogData
                .filter(item => 
                    (item.categoria || '').trim().toUpperCase() === 'NOVEDADES' || 
                    item.es_reimpresion === true ||
                    item.para_preventa === true ||
                    item.es_novedad_semana === true ||
                    item.visible_web === false // Si el usuario lo ocultó, también debe aparecer para poder revertirlo
                )
                .map(item => ({
                    ...item,
                    // Asegurar valores por defecto si son null
                    visible_web: item.visible_web ?? true,
                    para_preventa: item.para_preventa ?? false,
                    es_novedad_semana: item.es_novedad_semana ?? false,
                    _type: item.es_reimpresion === true ? 'reimpresion' : 'novedad'
                }));
            setItems(detected);
        }
    }, [isOpen, catalogData]);

    const editorialesList = useMemo(() => {
        const set = new Set(items.map(i => i.editorial).filter(Boolean));
        return ['TODAS', ...Array.from(set).sort()];
    }, [items]);

    const novedades = useMemo(() => items.filter(i => i._type === 'novedad'), [items]);
    const reimpresiones = useMemo(() => items.filter(i => i._type === 'reimpresion'), [items]);

    const manualResults = useMemo(() => {
        if (!searchManual.trim() || searchManual.length < 3) return [];
        const query = searchManual.toLowerCase();
        return catalogData.filter(item => 
            !items.find(i => i.id === item.id) && 
            (
                item.titulo?.toLowerCase().includes(query) ||
                item.product_id?.toLowerCase().includes(query) ||
                item.ean_oficial?.includes(query)
            )
        ).slice(0, 8);
    }, [searchManual, catalogData, items]);

    const addManualItem = (item) => {
        setItems(prev => [...prev, {
            ...item,
            visible_web: true,
            para_preventa: activeTab === 'novedades', // Por defecto preventa si es novedad
            es_novedad_semana: activeTab === 'novedades',
            _type: activeTab === 'novedades' ? 'novedad' : 'reimpresion'
        }]);
        setSearchManual('');
        setShowManualResults(false);
    };

    const toggleField = (id, field) => {
        setItems(prev => prev.map(item => {
            if (item.id !== id) return item;
            
            const newVal = !item[field];
            const nextItem = { ...item, [field]: newVal };
            
            // FIX: Sincronizar flags de estado con visibilidad WEB
            if (field === 'visible_web') {
                if (newVal) {
                    // Si activamos WEB, heredamos el tipo del Curador
                    if (item._type === 'novedad') nextItem.es_novedad = true;
                    if (item._type === 'reimpresion') nextItem.es_reimpresion = true;
                } else {
                    // Si quitamos de WEB, limpiamos estados para la tienda
                    nextItem.es_novedad = false;
                    nextItem.es_reimpresion = false;
                }
            }
            
            return nextItem;
        }));
    };

    const removeItem = (id) => {
        setItems(prev => prev.filter(item => item.id !== id));
    };

    const bulkAction = (type, field, value) => {
        setItems(prev => prev.map(item => {
            const matchesEditorial = editorialFilter === 'TODAS' || item.editorial === editorialFilter;
            const itemTypeMapped = item._type === 'novedad' ? 'novedades' : 'reimpresiones';
            
            if (itemTypeMapped === type && matchesEditorial) {
                const nextItem = { ...item, [field]: value };
                
                // FIX: Sincronización masiva
                if (field === 'visible_web') {
                    if (value) {
                        if (item._type === 'novedad') nextItem.es_novedad = true;
                        if (item._type === 'reimpresion') nextItem.es_reimpresion = true;
                    } else {
                        nextItem.es_novedad = false;
                        nextItem.es_reimpresion = false;
                    }
                }
                return nextItem;
            }
            return item;
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updates = items.map(item => {
                const isNov = item._type === 'novedad' && item.visible_web === true && item.es_novedad_semana === true;
                const isReimp = item._type === 'reimpresion' && item.visible_web === true && item.es_novedad_semana === true;

                // LOG DE AUDITORÍA CRÍTICA
                if (item.es_novedad_semana) {
                    console.log(`[AUDIT] Item: ${item.titulo} | Type: ${item._type} | Web: ${item.visible_web} | Star: ${item.es_novedad_semana} => IS_NOV: ${isNov}`);
                }

                return {
                    id: item.id,
                    product_id: item.product_id,
                    titulo: item.titulo,
                    editorial: item.editorial,
                    visible_web: item.visible_web,
                    para_preventa: item.para_preventa,
                    es_novedad_semana: item.es_novedad_semana,
                    es_novedad: isNov,
                    es_reimpresion: isReimp,
                    updated_at: new Date().toISOString()
                };
            });

            // DIAGNÓSTICO: Ver el primer objeto que se manda
            if (updates.length > 0) {
                console.log('SAVING (First Item):', JSON.stringify(updates[0], null, 2));
            }

            const { data, error } = await supabase
                .from('catalogo_productos')
                .upsert(updates, { onConflict: 'id' });

            // DIAGNÓSTICO: Resultado de Supabase
            console.log('UPSERT RESULT:', { error, data });

            if (error) {
                console.error('Detalle error Supabase:', error);
                throw new Error(error.message || 'Error desconocido en la base de datos');
            }

            alert('✅ Cambios guardados correctamente.');
            
            // LIMPIAR CACHÉ
            catalogService.clearCache();
            
            if (onRefresh) onRefresh(true);
            onClose();
        } catch (err) {
            console.error('Error al guardar curación:', err);
            alert(`❌ Error al guardar los cambios: ${err.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    const currentList = (activeTab === 'novedades' ? novedades : reimpresiones).filter(item => {
        if (editorialFilter !== 'TODAS' && item.editorial !== editorialFilter) return false;
        // El buscador también filtra entre los que ya están en la lista
        const q = searchManual.trim().toLowerCase();
        if (q.length >= 2) {
            const match = (item.titulo || '').toLowerCase().includes(q)
                || (item.product_id || '').toLowerCase().includes(q)
                || (item.ean_oficial || '').includes(q);
            if (!match) return false;
        }
        return true;
    });

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fadeIn">
            <div className="bg-white w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
                
                {/* Header */}
                <div className="bg-[#1a2d42] p-6 text-white flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="bg-amber-400 p-2 rounded-xl">
                            <Star className="text-[#1a2d42] fill-[#1a2d42]" size={24} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black tracking-tight">Curador de Lanzamientos</h2>
                            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-0.5">Control Editorial Semanal</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Main Toolbar */}
                <div className="px-6 py-4 border-b border-slate-100 flex flex-col lg:flex-row justify-between items-center gap-4 bg-slate-50/50">
                    <div className="flex bg-slate-200/50 p-1 rounded-2xl w-full lg:w-auto shrink-0">
                        <button
                            onClick={() => setActiveTab('novedades')}
                            className={`flex-1 lg:flex-none px-6 py-2 rounded-xl text-xs font-black transition-all ${activeTab === 'novedades' ? 'bg-white text-[#1a2d42] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            NOVEDADES ({novedades.length})
                        </button>
                        <button
                            onClick={() => setActiveTab('reimpresiones')}
                            className={`flex-1 lg:flex-none px-6 py-2 rounded-xl text-xs font-black transition-all ${activeTab === 'reimpresiones' ? 'bg-white text-[#1a2d42] shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            REIMPRESIONES ({reimpresiones.length})
                        </button>
                    </div>

                    <div className="flex items-center gap-2 w-full lg:w-auto">
                        <div className="relative group flex-1 lg:flex-none lg:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={16} />
                            <input 
                                type="text"
                                placeholder="Buscar en la lista o agregar del catálogo..."
                                value={searchManual}
                                onChange={(e) => {
                                    setSearchManual(e.target.value);
                                    setShowManualResults(true);
                                }}
                                className="w-full bg-white border-2 border-slate-200 rounded-xl py-2 pl-10 pr-4 text-xs font-bold focus:border-blue-500 outline-none transition-all shadow-sm"
                            />
                            {showManualResults && manualResults.length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[110] overflow-hidden">
                                    <div className="p-2 border-b border-slate-100 bg-slate-50 text-[9px] font-black text-slate-400 uppercase text-center">Resultados Catálogo</div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {manualResults.map(res => (
                                            <button key={res.id} onClick={() => addManualItem(res)} className="w-full p-3 flex items-center gap-3 hover:bg-blue-50 transition-colors text-left border-b border-slate-50 last:border-0">
                                                <div className="w-8 h-12 bg-slate-100 rounded shrink-0 overflow-hidden">{res.imagen_url && <img src={res.imagen_url} alt="" className="w-full h-full object-cover" />}</div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[10px] font-bold text-slate-700 truncate">{res.titulo}</p>
                                                    <p className="text-[8px] text-slate-400 uppercase">{res.editorial}</p>
                                                </div>
                                                <Plus size={14} className="text-blue-500" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Bulk Actions & Editorial Filter */}
                <div className="px-6 py-3 bg-white border-b border-slate-100 flex flex-wrap items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2 pr-4 border-r border-slate-100">
                        <Filter size={14} className="text-slate-400" />
                        <select 
                            value={editorialFilter}
                            onChange={(e) => setEditorialFilter(e.target.value)}
                            className="bg-slate-50 border-none rounded-lg py-1.5 px-3 text-[10px] font-black text-[#1a2d42] outline-none cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                            {editorialesList.map(ed => <option key={ed} value={ed}>{ed}</option>)}
                        </select>
                    </div>

                    <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
                        <button 
                            onClick={() => bulkAction(activeTab, 'visible_web', true)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black hover:bg-blue-700 transition-colors"
                        >
                            WEB
                        </button>
                        <button 
                            onClick={() => bulkAction(activeTab, 'visible_web', false)}
                            className="px-2 py-1.5 text-slate-400 hover:text-red-500 transition-colors"
                            title="Desmarcar todos de Web"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
                        <button 
                            onClick={() => bulkAction(activeTab, 'es_novedad_semana', true)}
                            className="px-3 py-1.5 bg-yellow-500 text-white rounded-lg text-[10px] font-black hover:bg-yellow-600 transition-colors"
                        >
                            DESTACAR
                        </button>
                        <button 
                            onClick={() => bulkAction(activeTab, 'es_novedad_semana', false)}
                            className="px-2 py-1.5 text-slate-400 hover:text-red-500 transition-colors"
                            title="Desmarcar todos de Destacar"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1">
                        <button 
                            onClick={() => bulkAction(activeTab, 'para_preventa', true)}
                            className="px-3 py-1.5 bg-orange-500 text-white rounded-lg text-[10px] font-black hover:bg-orange-600 transition-colors"
                        >
                            PREVENTA
                        </button>
                        <button 
                            onClick={() => bulkAction(activeTab, 'para_preventa', false)}
                            className="px-2 py-1.5 text-slate-400 hover:text-red-500 transition-colors"
                            title="Desmarcar todos de Preventa"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    <div className="flex-1" />
                    
                    <button 
                        onClick={() => {
                            if(confirm(`¿Desmarcar ABSOLUTAMENTE TODO para la editorial ${editorialFilter} en esta pestaña?`)) {
                                setItems(prev => prev.map(i => {
                                    const matchesEd = editorialFilter === 'TODAS' || i.editorial === editorialFilter;
                                    const itemTypeMapped = i._type === 'novedad' ? 'novedades' : 'reimpresiones';
                                    return (itemTypeMapped === activeTab && matchesEd) ? {...i, visible_web: false, para_preventa: false, es_novedad_semana: false} : i;
                                }));
                            }
                        }}
                        className="px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl text-[10px] font-black hover:bg-red-100 transition-all shadow-sm flex items-center gap-2"
                    >
                        <Trash2 size={14} /> DESMARCAR TODO
                    </button>
                </div>

                {/* List Container */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/30" onClick={() => setShowManualResults(false)}>
                    {currentList.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-4">
                            <Info size={48} className="opacity-20" />
                            <p className="font-medium text-center">
                                No hay productos en {activeTab} <br/> 
                                {editorialFilter !== 'TODAS' && <span className="text-[10px] text-slate-400">para la editorial {editorialFilter}</span>}
                            </p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {currentList.map((item) => (
                                <div 
                                    key={item.id} 
                                    className={`group relative p-4 rounded-2xl border transition-all duration-200 ${
                                        (item.visible_web || item.para_preventa || item.es_novedad_semana) 
                                        ? 'bg-white border-blue-100 shadow-md ring-1 ring-blue-50' 
                                        : 'bg-white border-slate-200 opacity-60 grayscale-[50%]'
                                    }`}
                                >
                                    <div className="flex gap-4">
                                        <div className="w-16 h-24 bg-slate-200 rounded-lg overflow-hidden shrink-0 shadow-sm border border-slate-100">
                                            {item.imagen_url ? (
                                                <img src={item.imagen_url} alt="" className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-400">
                                                    <ShoppingBag size={20} className="opacity-20" />
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex-1 flex flex-col justify-between min-w-0">
                                            <div>
                                                <h4 className="font-bold text-slate-800 text-[11px] leading-tight line-clamp-2 uppercase" title={item.titulo}>
                                                    {item.titulo}
                                                </h4>
                                                <span className="text-[9px] font-black text-blue-600/60 uppercase tracking-tighter block mt-1">
                                                    {item.editorial} • {item.categoria}
                                                </span>
                                            </div>

                                            <div className="flex flex-col gap-1.5 mt-2">
                                                <div className="flex gap-1.5">
                                                    <button
                                                        onClick={() => toggleField(item.id, 'visible_web')}
                                                        className={`flex-1 flex flex-col items-center justify-center py-1.5 rounded-lg transition-all border ${
                                                            item.visible_web 
                                                            ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-200' 
                                                            : 'bg-white text-slate-400 border-slate-200 hover:border-blue-400'
                                                        }`}
                                                        title="Mostrar u ocultar de la tienda virtual"
                                                    >
                                                        {item.visible_web ? <Eye size={14} /> : <EyeOff size={14} />}
                                                        <span className="text-[8px] font-black mt-0.5">WEB</span>
                                                    </button>
                                                    <button
                                                        onClick={() => toggleField(item.id, 'es_novedad_semana')}
                                                        className={`flex-1 flex flex-col items-center justify-center py-1.5 rounded-lg transition-all border ${
                                                            item.es_novedad_semana 
                                                            ? 'bg-yellow-500 text-white border-yellow-500 shadow-lg shadow-yellow-200' 
                                                            : 'bg-white text-slate-400 border-slate-200 hover:border-yellow-400'
                                                        }`}
                                                        title="Destacar en la sección de NOVEDADES de la tienda"
                                                    >
                                                        <Star size={14} className={item.es_novedad_semana ? 'fill-white' : ''} />
                                                        <span className="text-[8px] font-black mt-0.5">DESTACAR</span>
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={() => toggleField(item.id, 'para_preventa')}
                                                    className={`w-full flex items-center justify-center gap-2 py-2 rounded-lg transition-all border ${
                                                        item.para_preventa 
                                                        ? 'bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-200' 
                                                        : 'bg-white text-slate-400 border-slate-200 hover:border-orange-400'
                                                    }`}
                                                    title="Incluir en el generador automático de preventas"
                                                >
                                                    {item.para_preventa ? <Zap size={14} className="fill-white" /> : <ZapOff size={14} />}
                                                    <span className="text-[8px] font-black uppercase">Incluir en Preventa</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    <button 
                                        onClick={() => removeItem(item.id)}
                                        className="absolute -top-2 -right-2 w-7 h-7 bg-white border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 rounded-full flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-all scale-75 group-hover:scale-100 z-10"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Legend & Footer */}
                <div className="px-6 py-3 bg-blue-50/50 border-t border-slate-100 flex items-center gap-6 text-[9px] font-black text-blue-900/60 uppercase tracking-widest overflow-x-auto shrink-0">
                    <span className="flex items-center gap-1.5"><Eye size={12} /> WEB: Visible en tienda</span>
                    <span className="flex items-center gap-1.5"><Star size={12} /> NOVEDAD: Banner destacado</span>
                    <span className="flex items-center gap-1.5"><Zap size={12} /> PREVENTA: Para posters amarillos</span>
                </div>

                <div className="p-6 bg-white border-t border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 shrink-0">
                    <div className="flex flex-wrap gap-x-8 gap-y-4">
                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">En Tienda Virtual</span>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                                    <span className="text-[10px] font-black text-slate-700">{items.filter(i => i.visible_web && i._type === 'novedad').length} <span className="text-slate-400">NOV.</span></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
                                    <span className="text-[10px] font-black text-slate-700">{items.filter(i => i.visible_web && i._type === 'reimpresion').length} <span className="text-slate-400">REIMP.</span></span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">En Preventa</span>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-orange-600" />
                                    <span className="text-[10px] font-black text-slate-700">{items.filter(i => i.para_preventa && i._type === 'novedad').length} <span className="text-slate-400">NOV.</span></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-orange-400" />
                                    <span className="text-[10px] font-black text-slate-700">{items.filter(i => i.para_preventa && i._type === 'reimpresion').length} <span className="text-slate-400">REIMP.</span></span>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col gap-1">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Destacados</span>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                                    <span className="text-[10px] font-black text-slate-700">{items.filter(i => i.es_novedad_semana && i._type === 'novedad').length} <span className="text-slate-400">NOV.</span></span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-300" />
                                    <span className="text-[10px] font-black text-slate-700">{items.filter(i => i.es_novedad_semana && i._type === 'reimpresion').length} <span className="text-slate-400">REIMP.</span></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full md:w-auto">
                        <button onClick={onClose} className="flex-1 md:flex-none px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-2xl text-xs font-black hover:bg-slate-50 transition-all">
                            Cerrar
                        </button>
                        <button 
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex-1 md:flex-none px-8 py-3 bg-[#1a2d42] text-white rounded-2xl text-xs font-black shadow-xl shadow-[#1a2d42]/20 hover:bg-[#253d5a] transition-all flex items-center gap-2 disabled:opacity-50 justify-center"
                        >
                            {isSaving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18} />}
                            {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
