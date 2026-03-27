import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useDropzone } from 'react-dropzone';
import * as xlsx from 'xlsx';
import { Upload, Database, CheckCircle2, AlertCircle, X, Loader2, Calendar, Trash2, Edit2, Check } from 'lucide-react';

export default function AdminMasterView() {
    const [semanas, setSemanas] = useState([]);
    const [selectedSemana, setSelectedSemana] = useState('');
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    
    // Edit Title State
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [newTitleValue, setNewTitleValue] = useState('');

    // Preview Data
    const [previewData, setPreviewData] = useState(null);
    const [existingMaster, setExistingMaster] = useState(null);

    useEffect(() => {
        fetchSemanas();
    }, []);

    useEffect(() => {
        if (selectedSemana) {
            checkExistingMaster(selectedSemana);
        } else {
            setExistingMaster(null);
            setPreviewData(null);
        }
    }, [selectedSemana]);

    const fetchSemanas = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('semanas')
            .select('*')
            .order('created_at', { ascending: false });

        if (data) setSemanas(data);
        if (error) console.error("Error cargando semanas:", error);
        setLoading(false);
    };

    const checkExistingMaster = async (semanaId) => {
        const { data } = await supabase
            .from('master_confirmaciones')
            .select('*')
            .eq('semana_id', semanaId)
            .maybeSingle();

        setExistingMaster(data || null);
        if (data) setPreviewData(null); // Clear preview if we load an existing one
    };

    const processExcel = (file) => {
        setProcessing(true);
        setError('');
        setSuccess('');

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = xlsx.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];

                const rows = xlsx.utils.sheet_to_json(firstSheet, { header: 1 });
                if (rows.length === 0) throw new Error("El archivo Excel está vacío.");

                // El usuario quiere el nombre del archivo si tiene el número (ej: "12...")
                // Intentamos extraerlo del nombre del archivo primero si la celda A1 parece incompleta
                let filenameClean = file.name.replace(/\.(xlsx|xls)$/i, '').trim().toUpperCase();
                let cellA1 = String(rows[0][0] || '').trim().toUpperCase();

                // Si el nombre del archivo tiene números al inicio y la celda no, preferimos el archivo
                const hasNumberPrefix = (str) => /^\d+/.test(str);
                let tituloDespacho = (hasNumberPrefix(filenameClean) && !hasNumberPrefix(cellA1))
                    ? filenameClean
                    : (cellA1 || filenameClean || 'DESPACHO SIN TÍTULO');

                let parsedItems = [];
                let totalArsText = '';

                let extractedTotalProductos = 0;
                let extractedEnvioTexto = '';
                let extractedCajasQty = 0;
                let extractedCostoEnvio = 0;
                let extractedTotalArs = 0;

                // Encontrar la primera fila de datos reales y totales
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    if (!r || r.length === 0) continue;

                    const col0 = String(r[0] || '').trim().toLowerCase();

                    // Buscar totales al final del archivo
                    if (col0.includes('total productos') || col0.includes('total producto')) {
                        extractedTotalProductos = parseFloat(r[3]) || 0;
                        continue;
                    }
                    if (col0.includes('envio') || col0.includes('envío') || col0.includes('cajas')) {
                        extractedEnvioTexto = String(r[0] || '').trim();
                        extractedCostoEnvio = parseFloat(r[3]) || 0;

                        // Intentar extraer cantidad de cajas del texto (ej. "Envío (2 cajas)")
                        const matchCajas = extractedEnvioTexto.match(/(\d+)\s*caja/i);
                        if (matchCajas) extractedCajasQty = parseInt(matchCajas[1]);
                        continue;
                    }

                    // Si la fila tiene al menos 3 columnas llenas y la segunda parece un precio/número (Es un ítem normal)
                    if (r.length >= 3 && !isNaN(parseFloat(r[1])) && !isNaN(parseFloat(r[2]))) {
                        parsedItems.push({
                            titulo: r[0],
                            precio_unitario: parseFloat(r[1]) || 0,
                            cantidad: parseInt(r[2]) || 0,
                            precio_total: parseFloat(r[3]) || 0
                        });
                    }
                }

                if (parsedItems.length === 0) {
                    throw new Error("No se pudo detectar la estructura esperada: [Título, Precio, Cantidad, Total]");
                }

                // Si no encontró un total final explícito, usamos la suma calculada
                const sumaCalculada = parsedItems.reduce((acc, it) => acc + (it.precio_unitario * it.cantidad), 0);

                // Setear defaults si no se extrajeron bien del excel
                if (extractedTotalProductos === 0) extractedTotalProductos = sumaCalculada;

                // Ignoramos filas "Total" raras del excel y FORZAMOS el cálculo algebraico:
                extractedTotalArs = extractedTotalProductos + extractedCostoEnvio;

                setPreviewData({
                    titulo: tituloDespacho,
                    totalArs: extractedTotalArs,
                    totalProductos: extractedTotalProductos,
                    costoEnvio: extractedCostoEnvio,
                    envioTexto: extractedEnvioTexto,
                    cajasQty: extractedCajasQty,
                    items: parsedItems
                });
                setProcessing(false);

            } catch (err) {
                console.error(err);
                setError(err.message || 'Error procesando el archivo Excel.');
                setProcessing(false);
            }
        };
        reader.onerror = () => {
            setError('Error de lectura del archivo.');
            setProcessing(false);
        };
        reader.readAsArrayBuffer(file);
    };

    const onDrop = useCallback(acceptedFiles => {
        if (!selectedSemana) return setError("Selecciona una semana primero.");
        if (existingMaster) return setError("Esta semana ya tiene un Master. Elimínalo primero para sobreescribir.");
        if (acceptedFiles?.length > 0) {
            processExcel(acceptedFiles[0]);
        }
    }, [selectedSemana, existingMaster]);

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls']
        },
        multiple: false
    });

    const handleSaveMaster = async () => {
        if (!previewData || !selectedSemana) return;
        setProcessing(true);
        setError('');

        try {
            // 1. Save to master_confirmaciones
            const { error: dbError } = await supabase.from('master_confirmaciones').insert([{
                semana_id: selectedSemana,
                titulo_despacho: previewData.titulo,
                total_ars: previewData.totalArs,
                total_productos: previewData.totalProductos,
                costo_envio: previewData.costoEnvio,
                envio_texto: previewData.envioTexto,
                cajas_qty: previewData.cajasQty,
                datos_json: previewData.items
            }]);

            if (dbError) throw dbError;

            // 2. Automagically add to app_state for the Distribuidor (RemitosTable)
            const { data: appStateData, error: stateFetchError } = await supabase
                .from('app_state')
                .select('data')
                .eq('id', 'distribuidor')
                .maybeSingle();

            if (stateFetchError && stateFetchError.code !== 'PGRST116') {
                console.error("Error fetching distribuidor state:", stateFetchError);
            }

            let distData = appStateData?.data || { pedidos: [], pagos: [], saldoInicial: null, ajustes: [] };

            // Generate the identical name to use for matching later
            const semanaGuardada = semanas.find(s => s.id === selectedSemana);
            const nombreMostrar = semanaGuardada ? semanaGuardada.nombre : selectedSemana;
            const pedidoName = `${previewData.titulo} (${nombreMostrar})`;

            // Add the new pedido
            distData.pedidos.push({
                nombre: pedidoName,
                monto: previewData.totalArs
            });

            const { error: stateUpdateError } = await supabase
                .from('app_state')
                .upsert({ id: 'distribuidor', data: distData });

            if (stateUpdateError) console.error("Error agregando deuda al Distribuidor:", stateUpdateError);
            
            // 3. SECRETO: Inject a placeholder row into 'remitos' if it doesn't exist for this pedido
            const { data: remDataRes } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
            let remRows = Array.isArray(remDataRes?.data) ? remDataRes.data : (remDataRes?.data?.rows || []);
            
            // Check if this pedido already has a row (by name)
            const existsInRemitos = remRows.some(r => r.pedido === pedidoName || r.pedido === previewData.titulo);
            
            if (!existsInRemitos) {
                const newId = remRows.length > 0 ? Math.max(...remRows.map(r => r.id || 0)) + 1 : 1;
                const newRow = {
                    id: newId,
                    nro: `${newId}`,
                    fecha: new Date().toISOString().split('T')[0],
                    cajas: '0',
                    kg: '0',
                    precio_remito: '0',
                    compre: '0',
                    cambio: '0',
                    cg: '0',
                    cm: '0',
                    cp: '0',
                    skg: '0',
                    scaj: '0',
                    smonto: '0',
                    pedido: pedidoName,
                    pago_aprox: previewData.totalArs,
                    pagos_dist: '0',
                    tc_dist: '0',
                    selected: false
                };
                const updatedRemRows = [...remRows, newRow];
                await supabase.from('app_state').upsert({ id: 'remitos', data: updatedRemRows });
            }

            setSuccess("Base Maestra guardada, deuda creada y fila de remito inyectada en Gestión Integral.");
            setPreviewData(null);
            checkExistingMaster(selectedSemana);

        } catch (err) {
            console.error(err);
            setError(err.message || "Ocurrió un error al guardar el Master en la base de datos.");
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteMaster = async () => {
        if (!existingMaster || !confirm("¿Seguros que deseas eliminar esta base maestra? También se eliminará automáticamente su registro de deuda en la Gestión Integral.")) return;
        setProcessing(true);
        setError('');
        setSuccess('');

        try {
            // 1. Intentar borrar del state del Distribuidor (app_state) por nombre
            const { data: appStateData } = await supabase
                .from('app_state')
                .select('data')
                .eq('id', 'distribuidor')
                .maybeSingle();

            if (appStateData && appStateData.data) {
                let distData = appStateData.data;
                const originalLength = distData.pedidos ? distData.pedidos.length : 0;

                // Filtramos el pedido de forma más segura usando 'includes' para atrapar tanto 
                // el formato antiguo (con ID) como el formato nuevo (con Nombre de semana)
                distData.pedidos = (distData.pedidos || []).filter(p => !p.nombre.includes(existingMaster.titulo_despacho));

                if (distData.pedidos.length !== originalLength) {
                    const { error: stateUpdateError } = await supabase
                        .from('app_state')
                        .upsert({ id: 'distribuidor', data: distData });

                    if (stateUpdateError) console.warn("Aviso: No se pudo actualizar el Distribuidor.", stateUpdateError);
                }
            }

            // 2. Borrar el master
            const { error: masterError } = await supabase.from('master_confirmaciones').delete().eq('id', existingMaster.id);
            if (masterError) throw masterError;

            setExistingMaster(null);
            setSuccess("Base Maestra y su registro de deuda vinculada han sido eliminados.");
        } catch (err) {
            console.error(err);
            setError("Error al eliminar la Base Maestra.");
        } finally {
            setProcessing(false);
        }
    };

    const handleUpdateTitle = async () => {
        if (!newTitleValue.trim() || !existingMaster) return;
        setProcessing(true);
        setError('');
        setSuccess('');

        const oldTitle = existingMaster.titulo_despacho;
        const newTitle = newTitleValue.trim();

        if (oldTitle === newTitle) {
            setIsEditingTitle(false);
            setProcessing(false);
            return;
        }

        try {
            // 1. Update master_confirmaciones
            const { error: masterError } = await supabase
                .from('master_confirmaciones')
                .update({ titulo_despacho: newTitle })
                .eq('id', existingMaster.id);

            if (masterError) throw masterError;

            // Get week name for full name pattern matching
            const semanaGuardada = semanas.find(s => s.id === selectedSemana);
            const nombreSemana = semanaGuardada ? semanaGuardada.nombre : selectedSemana;
            
            const oldPedidoName = `${oldTitle} (${nombreSemana})`;
            const newPedidoName = `${newTitle} (${nombreSemana})`;

            // 2. Update app_state - DISTRIBUIDOR
            const { data: distStateRes } = await supabase.from('app_state').select('data').eq('id', 'distribuidor').maybeSingle();
            if (distStateRes?.data) {
                let distData = distStateRes.data;
                let changedDist = false;
                
                if (distData.pedidos) {
                    distData.pedidos = distData.pedidos.map(p => {
                        if (p.nombre === oldPedidoName || p.nombre === oldTitle) {
                            changedDist = true;
                            return { ...p, nombre: newPedidoName };
                        }
                        return p;
                    });
                }
                
                if (changedDist) {
                    await supabase.from('app_state').upsert({ id: 'distribuidor', data: distData });
                }
            }

            // 3. Update app_state - REMITOS
            const { data: remStateRes } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
            if (remStateRes?.data) {
                let remData = Array.isArray(remStateRes.data) ? remStateRes.data : (remStateRes.data.rows || []);
                let changedRem = false;

                remData = remData.map(r => {
                    if (r.pedido === oldPedidoName || r.pedido === oldTitle) {
                        changedRem = true;
                        return { ...r, pedido: newPedidoName };
                    }
                    return r;
                });

                if (changedRem) {
                    await supabase.from('app_state').upsert({ id: 'remitos', data: remData });
                }
            }

            setExistingMaster({ ...existingMaster, titulo_despacho: newTitle });
            setSuccess("Título actualizado correctamente en Confirmaciones y Gestión Integral.");
            setIsEditingTitle(false);
        } catch (err) {
            console.error(err);
            setError("Error al actualizar el título.");
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <div className="p-8 text-center animate-pulse"><Loader2 className="mx-auto animate-spin mb-4" /> Cargando semanas...</div>;

    return (
        <div className="space-y-8 max-w-5xl mx-auto">
            {/* Header */}
            <div className="bg-white p-6 rounded-2xl border border-border/40 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h3 className="text-xl font-bold text-navy flex items-center gap-2">
                        <Database className="text-accent" /> Base Constatación Maestro
                    </h3>
                    <p className="text-sm text-sky mt-1">Sube el excel de confirmación del distribuidor para automatizar totales y deudas.</p>
                </div>

                <div className="w-full md:w-64">
                    <label className="text-[10px] uppercase font-bold text-sky tracking-widest block mb-1">Semana Destino</label>
                    <div className="relative">
                        <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <select
                            value={selectedSemana}
                            onChange={(e) => setSelectedSemana(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 border border-border/40 rounded-xl text-sm font-bold bg-background focus:ring-2 focus:ring-accent outline-none appearance-none"
                        >
                            <option value="">-- Seleccionar Semana --</option>
                            {semanas.map(s => (
                                <option key={s.id} value={s.id}>{s.nombre} {!s.abierta ? '🔒' : ''}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in"><AlertCircle size={16} /> {error}</div>}
            {success && <div className="p-4 bg-green-50 text-green-600 border border-green-200 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in"><CheckCircle2 size={16} /> {success}</div>}

            {/* Upload Area */}
            {selectedSemana && !existingMaster && !previewData && (
                <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer ${isDragActive ? 'border-accent bg-accent/5' : 'border-border/60 bg-white hover:border-sky/50'
                        }`}
                >
                    <input {...getInputProps()} />
                    <Database size={48} className={`mx-auto mb-4 ${isDragActive ? 'text-accent' : 'text-sky'}`} />
                    <h4 className="text-lg font-bold text-navy mb-2">Arrastra el Excel de Confirmación aquí</h4>
                    <p className="text-sm text-muted">Soporta formato .xlsx o .xls del distribuidor.</p>
                </div>
            )}

            {/* Existing Master state */}
            {existingMaster && (
                <div className="bg-green-50 border border-green-200 rounded-3xl p-8 flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-2 text-green-700 font-bold mb-1">
                            <CheckCircle2 size={24} /> Base Maestro Activada
                        </div>
                        <p className="text-sm text-green-700/80">Esta semana ya tiene un archivo de confirmación cargado.</p>
                        <ul className="mt-4 space-y-2 text-xs text-green-800 font-mono">
                            <li className="flex items-center gap-2">
                                <strong>Título Despacho:</strong> 
                                {isEditingTitle ? (
                                    <div className="flex items-center gap-1">
                                        <input 
                                            type="text" 
                                            value={newTitleValue} 
                                            onChange={(e) => setNewTitleValue(e.target.value)}
                                            className="px-2 py-0.5 border border-green-300 rounded bg-white text-navy font-bold outline-none focus:ring-1 focus:ring-green-500"
                                            autoFocus
                                        />
                                        <button 
                                            onClick={handleUpdateTitle}
                                            disabled={processing}
                                            className="p-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                                        >
                                            {processing ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                        </button>
                                        <button 
                                            onClick={() => setIsEditingTitle(false)}
                                            className="p-1 bg-gray-400 text-white rounded hover:bg-gray-500 transition-colors"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <span>{existingMaster.titulo_despacho}</span>
                                        <button 
                                            onClick={() => {
                                                setNewTitleValue(existingMaster.titulo_despacho);
                                                setIsEditingTitle(true);
                                            }}
                                            className="p-1 hover:bg-green-200 rounded transition-colors text-green-700"
                                            title="Editar título"
                                        >
                                            <Edit2 size={12} />
                                        </button>
                                    </>
                                )}
                            </li>
                            <li><strong>Total ARS (Final):</strong> $ {Number(parseFloat(existingMaster.total_ars || 0)).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</li>
                            <li><strong>Total Prod:</strong> $ {Number(parseFloat(existingMaster.total_productos || 0)).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</li>
                            {(existingMaster.costo_envio || 0) > 0 && (
                                <li><strong>Envío ({existingMaster.cajas_qty || 0} Cajas):</strong> $ {Number(parseFloat(existingMaster.costo_envio || 0)).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</li>
                            )}
                            <li><strong>Ítems analizados:</strong> {existingMaster.datos_json?.length || 0}</li>
                        </ul>
                    </div>
                    <button
                        onClick={handleDeleteMaster}
                        disabled={processing}
                        className="p-3 bg-red-100 text-red-600 rounded-xl hover:bg-red-200 transition-colors"
                        title="Eliminar Master actual"
                    >
                        <Trash2 size={20} />
                    </button>
                    {/* Placeholder imported icon in prev step... wait, we didn't import Trash2. Let's fix that! */}
                </div>
            )}

            {/* Preview Data before save */}
            {previewData && (
                <div className="bg-white rounded-3xl border border-border/40 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="bg-navy p-6 text-white flex justify-between items-center">
                        <div>
                            <h4 className="font-bold flex items-center gap-2"><CheckCircle2 className="text-green-400" /> Archivo Analizado con Éxito</h4>
                            <p className="text-[10px] text-sky uppercase tracking-widest mt-1">Verifica los datos antes de inyectarlos y crear deuda.</p>
                        </div>
                        <button onClick={() => setPreviewData(null)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={20} /></button>
                    </div>

                    <div className="p-6 grid grid-cols-1 md:grid-cols-4 gap-4 bg-[#f8f9fa] border-b border-border/40">
                        <div className="bg-white p-4 rounded-xl shadow-sm md:col-span-2">
                            <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Título Detectado</p>
                            <p className="font-bold text-navy truncate break-all">{previewData.titulo}</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm">
                            <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Total Productos</p>
                            <p className="text-lg font-black text-navy font-mono-numbers">ARS {Number(previewData.totalProductos).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-white p-4 rounded-xl shadow-sm">
                            <p className="text-[10px] font-bold text-sky uppercase tracking-widest mb-1">Costo Envío</p>
                            <p className="text-sm font-bold text-muted truncate">{previewData.envioTexto || 'Sin detalle de cajas'}</p>
                            <p className="text-lg font-black text-navy font-mono-numbers">ARS {Number(previewData.costoEnvio).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                        <div className="bg-accent/10 border border-accent/20 p-4 rounded-xl shadow-sm md:col-span-4 flex justify-between items-center">
                            <p className="text-xs font-bold text-accent uppercase tracking-widest">Deuda Total a crear (Distribuidor)</p>
                            <p className="text-2xl font-black text-accent font-display tracking-tight">ARS {Number(previewData.totalArs).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </div>
                    </div>

                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#f8f9fa] text-[10px] text-sky font-bold uppercase tracking-widest sticky top-0">
                                <tr>
                                    <th className="p-4 border-b border-border/40">Título Manga</th>
                                    <th className="p-4 border-b border-border/40 text-right">Precio PVP (Ref)</th>
                                    <th className="p-4 border-b border-border/40 text-center">Cant. Constatada</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/20 text-xs">
                                {previewData.items.map((it, idx) => (
                                    <tr key={idx} className="hover:bg-cream/30">
                                        <td className="p-3 text-navy font-bold">{it.titulo}</td>
                                        <td className="p-3 text-right font-mono text-muted">ARS {it.precio_unitario.toLocaleString()}</td>
                                        <td className="p-3 text-center font-black text-navy">{it.cantidad}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="p-6 bg-[#f8f9fa] flex flex-wrap justify-end items-center gap-4 border-t border-border/40">
                        <button
                            onClick={() => setPreviewData(null)}
                            className="bg-black text-white px-6 py-3 rounded-xl text-sm font-bold shadow-md hover:bg-neutral-800 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleSaveMaster}
                            disabled={processing}
                            className="bg-primary text-black px-6 py-3 rounded-xl text-sm font-black uppercase tracking-wider shadow-lg hover:scale-105 active:scale-95 transition-all flex items-center gap-2"
                        >
                            {processing ? <Loader2 className="animate-spin" size={18} /> : <Database size={18} />}
                            Confirmar y Crear Deuda
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
