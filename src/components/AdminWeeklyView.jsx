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
    const [editingDateId, setEditingDateId] = useState(null);
    const [tempDate, setTempDate] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    useEffect(() => {
        fetchSemanas();
    }, []);

    const fetchSemanas = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('semanas')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) console.error('Error fetching semanas:', error);
        else setSemanas(data || []);
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

                    // 4. SINCRONIZACIÓN INTELIGENTE (FASE 3)
                    console.log('🚀 Iniciando sincronización automática con el Maestro...');
                    const syncResult = await catalogService.syncWithMaster(analysis, user.id, file.name, id);
                    if (syncResult && syncResult.count > 0) {
                        alert(`📖 CATÁLOGO ACTUALIZADO\nSe sincronizaron ${syncResult.count} productos con sus nuevos precios sugeridos.`);
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
                                    <h4 className="font-display text-2xl tracking-wide uppercase text-text">{s.nombre}</h4>
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
        </div>
    );
}
