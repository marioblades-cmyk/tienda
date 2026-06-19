import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Plus, FileUp, Lock, Unlock, Download, Trash2, XCircle, Calendar, RefreshCw } from 'lucide-react';
import { catalogService } from '../services/catalogService';
import { useAuth } from '../hooks/useAuth';

export default function AdminWeeklyView() {
    const { user } = useAuth();
    const [semanas, setSemanas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newSemanaName, setNewSemanaName] = useState('');
    const [draggingId, setDraggingId] = useState(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [pendingOrders, setPendingOrders] = useState(0);
    const [pendingList, setPendingList] = useState([]);
    const [showPendingModal, setShowPendingModal] = useState(false);
    const [editingDateId, setEditingDateId] = useState(null);
    const [tempDate, setTempDate] = useState('');
    const [editingNameId, setEditingNameId] = useState(null);
    const [tempName, setTempName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [selectedPending, setSelectedPending] = useState(new Set());

    useEffect(() => {
        fetchSemanas();
        fetchPending();
    }, []);

    const fetchPending = async () => {
        const { data, count, error } = await supabase
            .from('cliente_items')
            .select('*, clientes(nombre)', { count: 'exact' })
            .is('semana_id', null)
            .eq('estado', 'PEDIDO (Siguiente)');
        
        if (!error) {
            setPendingOrders(count || 0);
            setPendingList(data || []);
        }
    };

    const assignPending = async (semanaId, semanaNombre, ids = null) => {
        const targetIds = ids || pendingList.map(p => p.id);
        if (targetIds.length === 0) return;

        if (!confirm(`¿Quieres asignar ${targetIds.length} pedidos a la ${semanaNombre}?`)) return;
        setLoading(true);
        try {
            const { error } = await supabase
                .from('cliente_items')
                .update({ 
                    semana_id: semanaId, 
                    estado: `PEDIDO ${semanaNombre}` 
                })
                .in('id', targetIds);
            
            if (error) throw error;
            alert("¡Éxito! Pedidos asignados.");
            setShowPendingModal(false);
            setSelectedPending(new Set());
            await fetchPending();
        } catch (err) {
            alert("Error al asignar: " + err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchSemanas = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('semanas')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) console.error('Error fetching semanas:', error);
        // Excluir ventas desde stock (se gestionan desde Mayoristas, no son semanas de distribución)
        else setSemanas((data || []).filter(s => { const u = (s.nombre || '').toUpperCase(); return !(u.includes('VENTA') && u.includes('STOCK')); }));
        setLoading(false);
    };

    const createSemana = async (e) => {
        e.preventDefault();
        if (!newSemanaName) return;

        const { data, error } = await supabase
            .from('semanas')
            .insert([{ nombre: newSemanaName, abierta: true }])
            .select();

        if (error) alert(error.message);
        else {
            // Safety check: if data[0] is missing, refetch to be sure
            if (data?.[0]) {
                setSemanas([data[0], ...semanas]);
            } else {
                fetchSemanas();
            }
            setIsCreating(false);
            setNewSemanaName('');
        }
    };

    const toggleSemanaStatus = async (id, currentStatus) => {
        const { error } = await supabase
            .from('semanas')
            .update({ abierta: !currentStatus })
            .eq('id', id);

        if (error) alert(error.message);
        else fetchSemanas();
    };

    const handleDateUpdate = async (id) => {
        if (!tempDate) return;
        const { error } = await supabase
            .from('semanas')
            .update({ created_at: new Date(tempDate).toISOString() })
            .eq('id', id);

        if (error) alert(error.message);
        else {
            setEditingDateId(null);
            fetchSemanas();
        }
    };

    const handleNameUpdate = async (semana) => {
        const nuevoNombre = tempName.trim();
        if (!nuevoNombre || nuevoNombre === semana.nombre) {
            setEditingNameId(null);
            return;
        }
        setSavingName(true);
        try {
            // 1. Actualizar nombre en semanas
            const { error } = await supabase
                .from('semanas')
                .update({ nombre: nuevoNombre })
                .eq('id', semana.id);
            if (error) throw error;

            const oldNombre = semana.nombre;

            // 2. Cascade: actualizar pedido_items que tienen el nombre viejo en su estado
            // Ej: "CONFIRMADO ENTELEQUIA DISTRIBUCIÓN 24 22-5" → "CONFIRMADO NuevoNombre"
            const { data: pedidoItems } = await supabase
                .from('pedido_items')
                .select('id, estado')
                .like('estado', `%${oldNombre}%`);

            if (pedidoItems?.length > 0) {
                for (const it of pedidoItems) {
                    const nuevoEstado = it.estado.replaceAll(oldNombre, nuevoNombre);
                    await supabase.from('pedido_items').update({ estado: nuevoEstado }).eq('id', it.id);
                }
            }

            // 3. Cascade: actualizar cliente_items
            const { data: clienteItems } = await supabase
                .from('cliente_items')
                .select('id, estado')
                .like('estado', `%${oldNombre}%`);

            if (clienteItems?.length > 0) {
                for (const it of clienteItems) {
                    const nuevoEstado = it.estado.replaceAll(oldNombre, nuevoNombre);
                    await supabase.from('cliente_items').update({ estado: nuevoEstado }).eq('id', it.id);
                }
            }

            setEditingNameId(null);
            fetchSemanas();
        } catch (err) {
            alert('Error al renombrar: ' + err.message);
        } finally {
            setSavingName(false);
        }
    };

    const handleFileUpload = async (id, file) => {
        if (!file) return;
        if (!file.name.match(/\.(xlsx|xls)$/)) {
            alert('Por favor, sube un archivo Excel válido (.xlsx o .xls)');
            return;
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${id}_base.${fileExt}`;
        const filePath = `base_files/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('docs')
            .upload(filePath, file, { upsert: true });

        if (uploadError) {
            console.error('❌ Error en storage:', uploadError);
            return;
        }

        const { data: { publicUrl } } = supabase.storage
            .from('docs')
            .getPublicUrl(filePath);

        const { error: updateError } = await supabase
            .from('semanas')
            .update({
                archivo_nombre: file.name,
                archivo_url: `${publicUrl}?t=${Date.now()}` // Cache busting
            })
            .eq('id', id);

        if (updateError) {
            console.error('❌ Error actualizando base de datos:', updateError);
        } else {
            // PROCESAMIENTO AUTOMÁTICO (FASE 2)
            setIsAnalyzing(true);
            try {
                console.log('⚡ Iniciando procesamiento automático...');
                const analysis = await catalogService.processAndAnalyze(file);
                
                if (!analysis || Object.keys(analysis).length === 0) {
                    console.warn('⚠️ El análisis no devolvió ninguna pestaña válida.');
                } else {
                    console.log('⚡ PROCESAMIENTO EXITOSO. Subiendo a la nube...');

                    // 1. Subir el reporte completo a la nube (Supabase Storage)
                    console.log('☁️ Subiendo reporte a la nube...');
                    await catalogService.uploadAnalysisReport(id, analysis);
                    
                    // 2. Hacer espacio en localStorage si es necesario
                    catalogService.ensureStorageSpace();

                    // 3. Guardamos solo un PUNTERO mínimo en localStorage para avisar a la otra pestaña
                    try {
                        localStorage.setItem('mcb_last_processed_report', JSON.stringify({
                            semanaId: id,
                            timestamp: Date.now(),
                            filename: file.name,
                            source: 'cloud' // Indicamos que debe bajarse de la nube
                        }));
                        localStorage.setItem('mcb_last_filename', file.name); // Sincronización crucial
                        console.log('✅ Reporte guardado en la nube y puntero local actualizado.');
                    } catch (storageErr) {
                        console.error('❌ Error guardando puntero local (incluso tras limpieza):', storageErr);
                    }

                    // 3b. Guardar también el reporte completo para carga instantánea en Herramienta Editorial
                    try {
                        localStorage.setItem('mcb_stored_report', JSON.stringify({
                            data: analysis,
                            filename: file.name,
                            timestamp: Date.now()
                        }));
                    } catch (e) {
                        console.warn('⚠️ No se pudo guardar reporte completo en localStorage (excede 5MB). Se usará descarga desde nube.');
                    }

                    // 4. SINCRONIZACIÓN INTELIGENTE (FASE 3)
                    console.log('🚀 Iniciando sincronización automática con el Maestro...');
                    const syncResult = await catalogService.syncWithMaster(analysis, user.id, file.name, id);

                    // 5. AUTO-PRICING (FASE 4): aplica configs guardados para calcular precios Bs.
                    let pricingCount = 0;
                    try {
                        console.log('💰 Aplicando análisis de precios con configs guardados...');
                        const pricingResult = await catalogService.applyStoredPricing();
                        pricingCount = pricingResult?.count || 0;
                        if (pricingCount > 0) {
                            window.dispatchEvent(new CustomEvent('catalog-prices-updated'));
                        }
                    } catch (pricingErr) {
                        console.warn('⚠️ Auto-pricing falló (no crítico):', pricingErr);
                    }

                    if (syncResult && syncResult.count > 0) {
                        const pricingMsg = pricingCount > 0 ? `\n💰 Precios Bs. calculados: ${pricingCount} productos` : '';
                        alert(`📖 CATÁLOGO ACTUALIZADO\nSe sincronizaron ${syncResult.count} productos con sus nuevos precios sugeridos.${pricingMsg}`);
                    }
                }
            } catch (err) {
                console.error('❌ Error en análisis automático:', err);
                alert('Error al procesar el reporte de limpieza: ' + err.message);
            } finally {
                setIsAnalyzing(false);
                fetchSemanas();
                // Notificar que se subió un archivo para actualizar el indicador del Sidebar
                window.dispatchEvent(new CustomEvent('week-file-uploaded'));
            }
        }
    };

    const removeBaseFile = async (id, fileName) => {
        if (!confirm('¿Estás seguro de eliminar el archivo base? Esto no borrará los pedidos cargados por los vendedores.')) return;

        const { error: updateError } = await supabase
            .from('semanas')
            .update({
                archivo_nombre: null,
                archivo_url: null
            })
            .eq('id', id);

        if (updateError) alert(updateError.message);
        else fetchSemanas();
    };

    const deleteWeek = async (id) => {
        if (!confirm('¿ESTÁS SEGURO? Esto eliminará la semana y TODOS los pedidos e items asociados de forma permanente.')) return;

        const { error } = await supabase
            .from('semanas')
            .delete()
            .eq('id', id);

        if (error) alert(error.message);
        else fetchSemanas();
    };

    const onDragOver = (e, id) => {
        e.preventDefault();
        setDraggingId(id);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-text">Semanas Registradas</h3>
                <button
                    onClick={() => setIsCreating(true)}
                    className="btn-primary flex items-center gap-2"
                >
                    <Plus size={18} /> Nueva Semana
                </button>
            </div>

            {pendingOrders > 0 && (
                <div 
                    onClick={() => setShowPendingModal(true)}
                    className="bg-purple-500/10 border-2 border-purple-500/30 p-4 rounded-xl flex items-center justify-between animate-pulse cursor-pointer hover:bg-purple-500/20 transition-all"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-purple-500 text-white rounded-full flex items-center justify-center font-bold shadow-lg">
                            {pendingOrders}
                        </div>
                        <div>
                            <p className="text-sm font-black text-purple-500 uppercase tracking-widest">Pedidos en Espera</p>
                            <p className="text-[10px] text-muted-2">Hay {pendingOrders} ítems guardados como "Próximo Pedido". Haz clic para ver detalles.</p>
                        </div>
                    </div>
                    <span className="text-[10px] font-bold text-muted-2 italic">Ver lista de pendientes ↓</span>
                </div>
            )}

            {isCreating && (
                <form onSubmit={createSemana} className="card p-6 flex gap-4 items-end animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex-1">
                        <label className="block text-xs font-medium text-muted-2 mb-1.5 uppercase tracking-wider">Nombre de la Semana</label>
                        <input
                            type="text"
                            placeholder="Ej: Semana 10/03 - Distribución"
                            value={newSemanaName}
                            onChange={(e) => setNewSemanaName(e.target.value)}
                            className="input-field h-11"
                            autoFocus
                        />
                    </div>
                    <button type="submit" className="btn-primary h-11 px-8">Crear</button>
                    <button
                        type="button"
                        onClick={() => setIsCreating(false)}
                        className="bg-surface border border-border px-6 py-2.5 rounded font-medium text-sm h-11 hover:bg-surface-2 transition-colors"
                    >
                        Cancelar
                    </button>
                </form>
            )}

            {loading ? (
                <div className="py-12 flex justify-center"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>
            ) : (
                <div className="grid grid-cols-1 gap-4">
                    {semanas?.map((s) => s && (
                        <div
                            key={s.id}
                            onDragOver={(e) => onDragOver(e, s.id)}
                            onDragLeave={() => setDraggingId(null)}
                            onDrop={(e) => {
                                e.preventDefault();
                                setDraggingId(null);
                                const file = e.dataTransfer.files[0];
                                handleFileUpload(s.id, file);
                            }}
                            className={`glass p-6 rounded-xl flex items-center justify-between group transition-all duration-300 ${draggingId === s.id ? 'border-accent bg-accent/5 scale-[1.01]' : 'hover:border-accent/40'
                                }`}
                        >
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    {editingNameId === s.id ? (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={tempName}
                                                onChange={e => setTempName(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') handleNameUpdate(s); if (e.key === 'Escape') setEditingNameId(null); }}
                                                className="font-display text-xl tracking-wide uppercase bg-background border-2 border-accent px-3 py-1 rounded-lg outline-none text-text w-72"
                                                autoFocus
                                            />
                                            <button
                                                onClick={() => handleNameUpdate(s)}
                                                disabled={savingName}
                                                className="text-accent font-bold text-sm hover:text-accent/70 disabled:opacity-40"
                                            >{savingName ? '...' : 'Guardar'}</button>
                                            <button onClick={() => setEditingNameId(null)} className="text-muted text-sm">Cancelar</button>
                                        </div>
                                    ) : (
                                        <h4
                                            className="font-display text-2xl tracking-wide uppercase text-text cursor-pointer hover:text-accent transition-colors group/name flex items-center gap-2"
                                            onClick={() => { setEditingNameId(s.id); setTempName(s.nombre); }}
                                            title="Click para editar nombre"
                                        >
                                            {s.nombre}
                                            <span className="opacity-0 group-hover/name:opacity-100 text-accent text-sm font-sans font-bold transition-opacity">✎</span>
                                        </h4>
                                    )}
                                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${s.abierta ? 'bg-success/10 text-success border border-success/20' : 'bg-danger/10 text-danger border border-danger/20'}`}>
                                        {s.abierta ? 'ABIERTA' : 'CERRADA'}
                                    </span>
                                </div>
                                <div className="flex items-center gap-4 text-[11px] font-mono font-medium text-muted-2">
                                    {editingDateId === s.id ? (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="datetime-local"
                                                value={tempDate}
                                                onChange={(e) => setTempDate(e.target.value)}
                                                className="bg-background border border-border px-2 py-1 rounded"
                                            />
                                            <button onClick={() => handleDateUpdate(s.id)} className="text-accent font-bold">Guardar</button>
                                            <button onClick={() => setEditingDateId(null)} className="text-muted">Cancelar</button>
                                        </div>
                                    ) : (
                                        <span
                                            className="flex items-center gap-1.5 cursor-pointer hover:text-accent transition-colors"
                                            onClick={() => {
                                                setEditingDateId(s.id);
                                                // Format for datetime-local: YYYY-MM-DDThh:mm
                                                setTempDate(new Date(s.created_at).toISOString().slice(0, 16));
                                            }}
                                            title="Click para editar fecha"
                                        >
                                            <Calendar size={12} className="text-secondary" /> {new Date(s.created_at).toLocaleDateString()}
                                        </span>
                                    )}
                                    {s.archivo_nombre ? (
                                        <span className="flex items-center gap-1.5 text-primary bg-primary/5 px-2 py-0.5 rounded">
                                            <FileUp size={12} /> {s.archivo_nombre}
                                        </span>
                                    ) : (
                                        <span className="text-danger/70 bg-danger/5 px-2 py-0.5 rounded flex items-center gap-1.5">
                                            <XCircle size={12} /> Sin archivo base
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                {isAnalyzing ? (
                                    <div className="flex items-center gap-2 bg-accent/20 border-2 border-accent px-3 py-2 rounded text-[10px] font-bold text-accent">
                                        <RefreshCw size={14} className="animate-spin" /> PROCESANDO...
                                    </div>
                                ) : (
                                    <label className="cursor-pointer flex items-center gap-2 bg-surface border-2 border-dashed border-sky/30 px-3 py-2 rounded text-[10px] font-bold hover:border-accent transition-colors">
                                        <FileUp size={14} />
                                        {s.archivo_url ? 'ACTUALIZAR' : 'SUBIR BASE'}
                                        <input
                                            type="file"
                                            className="hidden"
                                            accept=".xlsx,.xls"
                                            onClick={(e) => e.target.value = null}
                                            onChange={(e) => e.target.files[0] && handleFileUpload(s.id, e.target.files[0])}
                                        />
                                    </label>
                                )}

                                <button
                                    onClick={() => toggleSemanaStatus(s.id, s.abierta)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-bold transition-colors ${s.abierta ? 'bg-error/10 text-error hover:bg-error/20' : 'bg-success/10 text-success hover:bg-success/20'
                                        }`}
                                >
                                    {s.abierta ? <Lock size={14} /> : <Unlock size={14} />}
                                    {s.abierta ? 'CERRAR' : 'ABRIR'}
                                </button>

                                {s.abierta && pendingOrders > 0 && (
                                    <button
                                        onClick={() => assignPending(s.id, s.nombre)}
                                        className="flex items-center gap-2 px-3 py-2 bg-purple-500 text-white rounded text-xs font-black shadow-lg shadow-purple-500/20 hover:scale-105 transition-all"
                                        title="Asignar pedidos pendientes de semana a esta carpeta"
                                    >
                                        <RefreshCw size={14} /> ASIGNAR {pendingOrders} PENDIENTES
                                    </button>
                                )}

                                {s.archivo_url && (
                                    <button
                                        onClick={() => removeBaseFile(s.id, s.archivo_nombre)}
                                        className="p-2 text-muted hover:text-error transition-colors"
                                        title="Eliminar archivo base"
                                    >
                                        <XCircle size={18} />
                                    </button>
                                )}

                                <button
                                    onClick={() => deleteWeek(s.id)}
                                    className="p-2 text-muted hover:text-error transition-colors"
                                    title="Eliminar semana completa"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {semanas?.length === 0 && (
                        <div className="text-center py-12 glass rounded-xl border-dashed border-2">
                            <p className="text-muted font-mono text-sm italic">No hay semanas creadas aún.</p>
                        </div>
                    )}
                </div>
            )}
            {showPendingModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-navy/60 backdrop-blur-sm animate-in fade-in duration-300">
                    <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
                        <div className="p-6 border-b border-border flex justify-between items-center bg-purple-500 text-white">
                            <div>
                                <h3 className="text-xl font-black uppercase italic">Pedidos en Espera ({pendingOrders})</h3>
                                <p className="text-[10px] opacity-80 font-bold">Estos ítems no tienen una semana asignada aún.</p>
                            </div>
                            <button onClick={() => setShowPendingModal(false)} className="hover:bg-white/20 p-2 rounded-full transition-colors">
                                <Plus size={24} className="rotate-45" />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-2 custom-scrollbar">
                            {pendingList.map(p => (
                                <div 
                                    key={p.id} 
                                    onClick={() => {
                                        const next = new Set(selectedPending);
                                        if (next.has(p.id)) next.delete(p.id);
                                        else next.add(p.id);
                                        setSelectedPending(next);
                                    }}
                                    className={`p-3 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-between ${
                                        selectedPending.has(p.id) ? 'border-purple-500 bg-purple-50' : 'border-border hover:border-purple-200'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${selectedPending.has(p.id) ? 'bg-purple-500 border-purple-500 text-white' : 'border-border'}`}>
                                            {selectedPending.has(p.id) && <Plus size={14} />}
                                        </div>
                                        <div>
                                            <div className="font-bold text-sm text-navy leading-tight">{p.titulo}</div>
                                            <div className="text-[10px] text-muted-2">Cliente: {p.clientes?.nombre}</div>
                                        </div>
                                    </div>
                                    {p.nota && (
                                        <div className="text-[9px] bg-background px-2 py-1 rounded border border-border italic text-muted max-w-[200px] truncate">
                                            {p.nota}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div className="p-6 border-t border-border bg-background flex flex-col md:flex-row gap-4">
                            <button 
                                onClick={() => {
                                    if (selectedPending.size === pendingList.length) setSelectedPending(new Set());
                                    else setSelectedPending(new Set(pendingList.map(p => p.id)));
                                }}
                                className="px-6 py-3 rounded-xl border-2 border-border font-bold text-xs hover:bg-white transition-all uppercase"
                            >
                                {selectedPending.size === pendingList.length ? 'Desmarcar Todos' : 'Marcar Todos'}
                            </button>
                            
                            <div className="flex-1 flex gap-2">
                                {semanas.filter(s => s.abierta).map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => assignPending(s.id, s.nombre, Array.from(selectedPending))}
                                        disabled={selectedPending.size === 0 || loading}
                                        className="flex-1 bg-purple-500 text-white font-black py-3 rounded-xl shadow-lg hover:scale-[1.02] active:scale-95 transition-all text-xs uppercase tracking-widest disabled:opacity-50"
                                    >
                                        Asignar a {s.nombre.split(' ')[2] || 'Semana'} ({selectedPending.size})
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
