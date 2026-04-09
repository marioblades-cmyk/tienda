import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useDropzone } from 'react-dropzone';
import * as xlsx from 'xlsx';
import { Upload, Database, CheckCircle2, AlertCircle, X, Loader2, Calendar, Trash2, Edit2, Check, RefreshCw } from 'lucide-react';

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

    const syncOrdersWithMaster = async (semanaId, masterItems) => {
        if (!semanaId || !masterItems) return;
        setProcessing(true);
        setError('');
        try {
            const semanaObj = semanas.find(s => s.id === semanaId);
            const wName = semanaObj ? semanaObj.nombre : '';
            
            // 1. Fetch ALL cliente_items for this week
            const { data: clientItems, error: itemsError } = await supabase
                .from('cliente_items')
                .select('*')
                .eq('semana_id', semanaId);
            
            if (itemsError) throw itemsError;
            if (!clientItems || clientItems.length === 0) return;

            // 2. Map master titles for faster lookup - USAR SET PARA VELOCIDAD
            const masterTitles = new Set(masterItems.map(it => (it.titulo || '').toLowerCase().trim()));
            
            let confirmedCount = 0;
            let cutCount = 0;

            // 3. Batch Update statuses
            for (let item of clientItems) {
                const itemTitle = (item.titulo || '').toLowerCase().trim();
                const isConfirmed = masterTitles.has(itemTitle);
                
                let nuevoEstado = isConfirmed ? `CONFIRMADO ${wName}`.trim() : 'RECORTADO';
                
                // Only update if state changed
                if (item.estado !== nuevoEstado) {
                    const { error: updateErr } = await supabase.from('cliente_items').update({ estado: nuevoEstado }).eq('id', item.id);
                    if (updateErr) console.error("Error al actualizar item:", item.id, updateErr);
                    
                    if (isConfirmed) confirmedCount++;
                    else cutCount++;
                }
            }
            
            setSuccess(`Sincronización completa: ${confirmedCount} pedidos confirmados, ${cutCount} marcados como recortados.`);
        } catch (e) {
            console.error("Error sincronizando pedidos:", e);
            setError("Error al sincronizar los estados de los pedidos de clientes.");
        } finally {
            setProcessing(false);
        }
    };

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
            const { data: appStateData } = await supabase
                .from('app_state')
                .select('data')
                .eq('id', 'distribuidor')
                .maybeSingle();

            let distData = appStateData?.data || { pedidos: [], pagos: [], saldoInicial: null, ajustes: [] };
            const semanaGuardada = semanas.find(s => s.id === selectedSemana);
            const nombreMostrar = semanaGuardada ? semanaGuardada.nombre : selectedSemana;
            const pedidoName = `${previewData.titulo} (${nombreMostrar})`;

            distData.pedidos.push({ nombre: pedidoName, monto: previewData.totalArs });

            await supabase.from('app_state').upsert({ id: 'distribuidor', data: distData });
            
            // 3. Inject a placeholder row into 'remitos' (Gestión Integral)
            const { data: remDataRes } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
            let remRows = Array.isArray(remDataRes?.data) ? remDataRes.data : (remDataRes?.data?.rows || []);
            const existsInRemitos = remRows.some(r => r.pedido === pedidoName);
            
            if (!existsInRemitos) {
                const newId = remRows.length > 0 ? Math.max(...remRows.map(r => r.id || 0)) + 1 : 1;
                const newRow = {
                    id: newId, nro: `${newId}`, fecha: new Date().toISOString().split('T')[0], cajas: '0', 
                    kg: '0', precio_remito: '0', compre: '0', cambio: '0', cg: '0', cm: '0', cp: '0', 
                    skg: '0', scaj: '0', smonto: '0', pedido: pedidoName, pago_aprox: previewData.totalArs,
                    pagos_dist: '0', tc_dist: '0', selected: false
                };
                await supabase.from('app_state').upsert({ id: 'remitos', data: [...remRows, newRow] });
            }

            // 4. NUEVO: Sincronización automática de pedidos de clientes tras guardar
            await syncOrdersWithMaster(selectedSemana, previewData.items);
            
            setSuccess("Base Maestra guardada y pedidos de clientes sincronizados.");
            setPreviewData(null);
            checkExistingMaster(selectedSemana);
        } catch (err) {
            console.error(err);
            setError(err.message || "Error al guardar el Master.");
        } finally {
            setProcessing(false);
        }
    };

    const handleDeleteMaster = async () => {
        if (!existingMaster || !confirm("¿Seguros que deseas eliminar esta base maestra?")) return;
        setProcessing(true);
        setError('');
        try {
            await supabase.from('master_confirmaciones').delete().eq('id', existingMaster.id);
            setExistingMaster(null);
            setSuccess("Base Maestra eliminada correctamente.");
        } catch (err) {
            console.error(err);
            setError("Error al eliminar la Base Maestra.");
        } finally {
            setProcessing(false);
        }
    };

    const handleUpdateTitle = async () => {
        if (!newTitleValue.trim() || !existingMaster || !selectedSemana) return;
        setProcessing(true);
        try {
            const oldTitle = existingMaster.titulo_despacho;
            const newTitle = newTitleValue.trim();
            const semanaObj = semanas.find(s => s.id === selectedSemana);
            const nombreMostrar = semanaObj ? semanaObj.nombre : selectedSemana;

            const oldPedidoName = `${oldTitle} (${nombreMostrar})`;
            const newPedidoName = `${newTitle} (${nombreMostrar})`;

            // 1. Update master_confirmaciones
            await supabase.from('master_confirmaciones').update({ titulo_despacho: newTitle }).eq('id', existingMaster.id);

            // 2. Propagate to app_state 'distribuidor'
            const { data: distDataRes } = await supabase.from('app_state').select('data').eq('id', 'distribuidor').maybeSingle();
            if (distDataRes?.data) {
                let distData = { ...distDataRes.data };
                let modifiedDist = false;
                const weekSuffix = `(${nombreMostrar.toLowerCase()})`;

                if (Array.isArray(distData.pedidos)) {
                    distData.pedidos = distData.pedidos.map(p => {
                        const curName = (p.nombre || '').trim().toLowerCase();
                        const oldFull = oldPedidoName.toLowerCase();
                        const oldBase = oldTitle.toLowerCase();

                        // Prioridad: 1. Sufijo de Semana coincidente (muy fiable) 2. Match exacto 3. Contención mutua
                        const isMatch = curName.endsWith(weekSuffix) || 
                                      curName === oldFull || 
                                      (oldBase && curName.includes(oldBase)) || 
                                      (curName.length > 5 && oldBase.includes(curName));

                        if (isMatch) {
                            modifiedDist = true;
                            return { ...p, nombre: newPedidoName };
                        }
                        return p;
                    });
                }
                if (modifiedDist) {
                    await supabase.from('app_state').update({ data: distData }).eq('id', 'distribuidor');
                }
            }

            // 3. Propagate to app_state 'remitos'
            const { data: remDataRes } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
            if (remDataRes?.data) {
                let remRows = Array.isArray(remDataRes.data) ? remDataRes.data : (remDataRes.data.rows || []);
                let modifiedRem = false;
                const weekSuffix = `(${nombreMostrar.toLowerCase()})`;

                const updatedRows = remRows.map(r => {
                    const curName = (r.pedido || '').trim().toLowerCase();
                    const oldFull = oldPedidoName.toLowerCase();
                    const oldBase = oldTitle.toLowerCase();

                    const isMatch = curName.endsWith(weekSuffix) || 
                                  curName === oldFull || 
                                  (oldBase && curName.includes(oldBase)) || 
                                  (curName.length > 5 && oldBase.includes(curName));

                    if (isMatch) {
                        modifiedRem = true;
                        return { ...r, pedido: newPedidoName };
                    }
                    return r;
                });
                if (modifiedRem) {
                    await supabase.from('app_state').update({ data: updatedRows }).eq('id', 'remitos');
                }
            }

            setExistingMaster({ ...existingMaster, titulo_despacho: newTitle });
            setSuccess("Título actualizado y sincronizado en Gestión Integral.");
            setIsEditingTitle(false);
        } catch (err) {
            console.error(err);
            setError("Error al actualizar y sincronizar el título.");
        } finally {
            setProcessing(false);
        }
    };

    if (loading) return <div className="p-8 text-center animate-pulse"><Loader2 size={24} className="mx-auto animate-spin mb-4" /> Cargando...</div>;

    return (
        <div className="space-y-8 max-w-5xl mx-auto">
            {/* Cabecera */}
            <div className="bg-white p-6 rounded-2xl border border-border/40 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h3 className="text-xl font-bold text-navy flex items-center gap-2">
                        <Database className="text-accent" /> Base Maestro Maestranza
                    </h3>
                    <p className="text-sm text-sky mt-1 font-medium">Sincroniza tus preventas con la realidad del stock.</p>
                </div>

                <div className="w-full md:w-64">
                    <label className="text-[10px] uppercase font-bold text-sky tracking-widest block mb-1">Semana Destino</label>
                    <select
                        value={selectedSemana}
                        onChange={(e) => setSelectedSemana(e.target.value)}
                        className="w-full px-4 py-2 border border-border/40 rounded-xl text-sm font-bold bg-background focus:ring-2 focus:ring-accent outline-none appearance-none"
                    >
                        <option value="">-- Seleccionar Semana --</option>
                        {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre} {!s.abierta ? '🔒' : ''}</option>)}
                    </select>
                </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in"><AlertCircle size={16} /> {error}</div>}
            {success && <div className="p-4 bg-green-50 text-green-600 border border-green-200 rounded-xl text-sm font-bold flex items-center gap-2 animate-in fade-in"><CheckCircle2 size={16} /> {success}</div>}

            {/* Dropzone */}
            {selectedSemana && !existingMaster && !previewData && (
                <div {...getRootProps()} className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all cursor-pointer ${isDragActive ? 'border-accent bg-accent/5' : 'border-border/60 bg-white hover:border-sky/50'}`}>
                    <input {...getInputProps()} />
                    <Upload size={48} className="mx-auto mb-4 text-sky" />
                    <h4 className="text-lg font-bold text-navy">Carga el Excel de Confirmación aquí</h4>
                    <p className="text-sm text-muted">Asegúrate de que la primera columna sea el Título.</p>
                </div>
            )}

            {/* Existing Master State */}
            {existingMaster && (
                <div className="bg-green-50 border border-green-200 rounded-3xl p-8 flex items-center justify-between shadow-sm">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 text-green-700 font-bold mb-1"><CheckCircle2 size={24} /> Base Maestro Activada</div>
                        <p className="text-sm text-green-700/80">Stock constatado y deudas generadas para Gestión Integral.</p>
                        
                        <div className="mt-4 flex items-center gap-2">
                             {isEditingTitle ? (
                                <div className="flex items-center gap-1">
                                    <input type="text" value={newTitleValue} onChange={e => setNewTitleValue(e.target.value)} className="px-2 py-1 border rounded text-xs" />
                                    <button onClick={handleUpdateTitle} className="p-1 text-green-600"><Check size={14} /></button>
                                </div>
                             ) : (
                                <div className="flex items-center gap-2">
                                    <span className="text-navy font-bold text-lg">{existingMaster.titulo_despacho}</span>
                                    <button onClick={() => { setNewTitleValue(existingMaster.titulo_despacho); setIsEditingTitle(true); }} className="text-green-600 hover:text-green-800"><Edit2 size={14} /></button>
                                </div>
                             )}
                        </div>
                        <p className="text-xs font-mono text-green-800 mt-2 tracking-wider">MODO: CRUCE UNIVERSAL ACTIVADO</p>
                    </div>

                    <div className="flex flex-col gap-3 ml-4">
                        <button
                            onClick={() => syncOrdersWithMaster(selectedSemana, existingMaster.datos_json)}
                            disabled={processing}
                            className="flex items-center justify-center gap-2 px-6 py-3 bg-accent text-navy rounded-xl font-bold text-xs hover:bg-accent/80 transition-all shadow-md min-w-[180px]"
                        >
                            {processing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Sincronizar Pedidos
                        </button>
                        <button
                            onClick={handleDeleteMaster}
                            className="text-xs text-red-500 font-bold uppercase hover:underline text-center"
                        >
                            Eliminar Master
                        </button>
                    </div>
                </div>
            )}

            {/* Preview and Save */}
            {previewData && (
                <div className="bg-white rounded-3xl border border-border/40 shadow-2xl overflow-hidden animate-in slide-in-from-bottom-4">
                    <div className="bg-navy p-6 text-white flex justify-between items-center">
                        <div>
                            <h4 className="font-bold flex items-center gap-2">Confirmación Analizada</h4>
                            <p className="text-xs text-sky/60 mt-1 uppercase tracking-tighter">Verifica y cruza datos con las preventas</p>
                        </div>
                        <button onClick={() => setPreviewData(null)}><X size={20} /></button>
                    </div>

                    <div className="p-8 flex justify-between items-center bg-[#f8f9fa] border-b">
                        <div>
                            <p className="text-[10px] uppercase font-black text-sky tracking-widest mb-1">Total Constatado</p>
                            <p className="text-3xl font-black text-navy font-display uppercase italic">ARS {previewData.totalArs.toLocaleString()}</p>
                        </div>
                        <button
                            onClick={handleSaveMaster}
                            disabled={processing}
                            className="bg-accent text-navy px-10 py-4 rounded-2xl font-black text-sm hover:scale-105 active:scale-95 transition-all shadow-lg flex items-center gap-2"
                        >
                            {processing ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle2 size={18} />}
                            CONFIRMAR TODO
                        </button>
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="bg-[#f8f9fa] sticky top-0 border-b">
                                <tr>
                                    <th className="p-4 font-bold text-sky">Título Producto</th>
                                    <th className="p-4 text-right">Cant.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {previewData.items.map((it, idx) => (
                                    <tr key={idx} className="hover:bg-accent/5">
                                        <td className="p-4 font-medium text-navy uppercase text-[10px]">{it.titulo}</td>
                                        <td className="p-4 text-right font-black text-navy">{it.cantidad}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
