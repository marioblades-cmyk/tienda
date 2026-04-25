import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useAuth';
import { readExcelRaw } from '../services/excelProcessor';
import { Download, Upload, CheckCircle, Clock, AlertCircle, FileText, Trash2, Zap } from 'lucide-react';
import { translateError } from '../services/errorTranslations';
import AdminConsolidatedView from './AdminConsolidatedView';
import ExcelJS from 'exceljs';

export default function SellerDashboard({ isAdmin }) {
    const { user, profile } = useAuth();
    const [semanaActual, setSemanaActual] = useState(null);
    const [pedidosRealizados, setPedidosRealizados] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isDragging, setIsDragging] = useState({ personal: false, tienda: false });
    const [validationResult, setValidationResult] = useState(null); // { items, type, discrepancies, file }
    const [conflictState, setConflictState] = useState(null); // { missingItems, redItems, workbook, resolutions }

    // Modo simulación admin
    const [vendedoresList, setVendedoresList] = useState([]);
    const [simulatedVendorInput, setSimulatedVendorInput] = useState('');
    const [simulatedVendorId, setSimulatedVendorId] = useState('');
    const [simulatedVendorName, setSimulatedVendorName] = useState('');

    useEffect(() => {
        if (isAdmin) {
            const fetchVendedoresList = async () => {
                const { data } = await supabase.from('vendedores').select('*').order('nombre', { ascending: true });
                if (data) setVendedoresList(data);
            };
            fetchVendedoresList();
        }
    }, [isAdmin]);

    useEffect(() => {
        fetchSemanaYPedidos();
    }, [simulatedVendorId]);

    const fetchSemanaYPedidos = async () => {
        setLoading(true);
        try {
            const { data: semanadata, error: semanaError } = await supabase
                .from('semanas')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (semanaError) console.error('Error fetching week:', semanaError);
            setSemanaActual(semanadata);

            if (semanadata && user) {
                const currentVendorId = (isAdmin && simulatedVendorId)
                    ? simulatedVendorId
                    : user.id;

                const { data: pedidosdata, error: pedidosError } = await supabase
                    .from('pedidos')
                    .select('*')
                    .eq('semana_id', semanadata.id)
                    .eq('vendedor_id', currentVendorId);

                if (pedidosError) console.error('Error fetching orders:', pedidosError);
                setPedidosRealizados(pedidosdata || []);
            }
        } catch (err) {
            console.error('Crash in fetchSemanaYPedidos:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDownload = async () => {
        if (!semanaActual?.archivo_url) return;
        try {
            const response = await fetch(semanaActual.archivo_url);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const nombreVendedor = (profile?.nombre || user?.user_metadata?.nombre || 'Vendedor').split(' ')[0];
            let fecha = semanaActual.nombre || 'Semana';
            fecha = fecha.replace(/MANGAS COMICS BOLIVIA STORE/i, '').trim().replace(/\//g, '-');

            a.download = `MANGAS_COMICS_BOLIVIA_STORE_${fecha}_${nombreVendedor}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error descargando:', error);
            alert('Error: ' + translateError(error));
        }
    };

    const executeDownload = async (workbook, semana, nombreVendedor, matchedCount) => {
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        
        let fecha = semana.nombre || 'Semana';
        fecha = fecha.replace(/MANGAS COMICS BOLIVIA STORE/i, '').trim().replace(/\//g, '-');
        a.download = `PEDIDO_CLIENTES_${fecha}_${nombreVendedor}.xlsx`;
        
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        if (matchedCount > 0) {
            alert(`¡Éxito! Se generó tu Excel con ${matchedCount} títulos de tus clientes pre-llenados. Recuerda revisarlo antes de subirlo.`);
        }
    };

    const handleIntelligentDownload = async () => {
        if (!semanaActual?.archivo_url || !user) return;
        setIsExporting(true);
        try {
            const currentVendorId = (isAdmin && simulatedVendorId) ? simulatedVendorId : user.id;

            // 1. Fetch seller client_items
            const { data: dbItems, error: dbErr } = await supabase
                .from('cliente_items')
                .select('*, clientes(*)')
                .eq('semana_id', semanaActual.id)
                .eq('vendedor_id', currentVendorId);

            if (dbErr) throw dbErr;

            if (!dbItems || dbItems.length === 0) {
                alert("No tienes pedidos de clientes registrados para esta semana. El Excel se descargará en blanco.");
                await handleDownload();
                setIsExporting(false);
                return;
            }

            // Group db items by title/isbn
            const flatProducts = {};
            const isbnProducts = {};

            dbItems.forEach(p => {
                const normTitle = String(p.titulo || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const normIsbn = String(p.isbn || p.ean || '').replace(/[^0-9]/g, '');
                if (normTitle) {
                    if (!flatProducts[normTitle]) flatProducts[normTitle] = { qty: 0, original: p.titulo };
                    flatProducts[normTitle].qty += 1;
                }
                if (normIsbn && normIsbn.length > 5) {
                    isbnProducts[normIsbn] = (isbnProducts[normIsbn] || 0) + 1;
                }
            });

            // 2. Fetch the Base Excel
            const response = await fetch(semanaActual.archivo_url);
            const arrayBuffer = await response.arrayBuffer();

            const isLegacy = semanaActual.archivo_nombre?.toLowerCase().endsWith('.xls') || 
                             semanaActual.archivo_url.toLowerCase().includes('.xls?');
            
            if (isLegacy) {
                alert("Atención: El archivo base es formato .xls (antiguo). La preservación de formato podría fallar.");
            }

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);

            const productSheets = [];

            for (const ws of workbook.worksheets) {
                let foundTitle = -1;
                let foundQty = -1;
                let foundIsbn = -1;

                for (let i = 1; i <= Math.min(50, ws.rowCount); i++) {
                    const row = ws.getRow(i);
                    row.eachCell((cell, colNumber) => {
                        const val = String(cell.value || '').toLowerCase();
                        
                        if (foundTitle === -1 && (
                            val === 'título' || val === 'titulo' || val.includes('titulo') ||
                            val.includes('producto') || val.includes('detalle') || 
                            val === 'articulo' || val === 'artículo' || val.includes('articulo') ||
                            val === 'nombre' || val === 'tãtulo' || val.includes('descrip') ||
                            val === 'ejemplar' || val === 'item' || val === 'manga'
                        )) {
                            foundTitle = colNumber - 1;
                        }

                        if (foundQty === -1 && (
                            val.includes('cantidad') || val.includes('cant') || 
                            val.includes('unidades') || val.includes('pedido') ||
                            val === 'q' || val === 'qty'
                        ) && !val.includes('pag') && !val.includes('p\u00e1g')) {
                            if (colNumber - 1 !== foundTitle) {
                                foundQty = colNumber - 1;
                            }
                        }

                        if (foundIsbn === -1 && (
                            val.includes('isbn') || val.includes('ean') || 
                            val.includes('código') || val.includes('codigo') || 
                            val.includes('barra') || val.includes('ean13')
                        )) {
                            foundIsbn = colNumber - 1;
                        }
                    });

                    if (foundTitle !== -1 && foundQty !== -1 && foundTitle !== foundQty) break;
                }

                if (foundTitle !== -1 && (foundQty === -1 || foundQty === foundTitle)) {
                    foundQty = -1;
                    for (let j = 1; j <= Math.min(50, ws.rowCount); j++) {
                        const r = ws.getRow(j);
                        r.eachCell((cell, colNumber) => {
                            const v = String(cell.value || '').toLowerCase();
                            if (foundQty === -1 && (v.includes('cant') || v.includes('pedido') || v.includes('unid') || v === 'q' || v === 'qty')) {
                                if (colNumber - 1 !== foundTitle) {
                                    foundQty = colNumber - 1;
                                }
                            }
                        });
                        if (foundQty !== -1) break;
                    }
                }

                if (foundTitle !== -1 && foundQty !== -1) {
                    productSheets.push({ ws, titleColIndex: foundTitle, qtyColIndex: foundQty, isbnColIndex: foundIsbn });
                } else if (foundTitle !== -1 && foundQty === -1) {
                    const wsNameLower = ws.name.toLowerCase().replace(/\s/g, '');
                    let fallbackQty = -1;
                    if (wsNameLower.includes('ovni')) fallbackQty = 4;
                    if (fallbackQty !== -1) {
                        productSheets.push({ ws, titleColIndex: foundTitle, qtyColIndex: fallbackQty, isbnColIndex: foundIsbn });
                    }
                }
            }

            if (productSheets.length === 0) {
                alert("No se encontró formato compatible en el Excel base. Se descargará el archivo original.");
                await handleDownload();
                setIsExporting(false);
                return;
            }

            let matchedCount = 0;
            const filledProducts = new Set();
            const redItemsFound = [];

            productSheets.forEach(({ ws, titleColIndex, qtyColIndex, isbnColIndex }) => {
                ws.eachRow((row, rowNumber) => {
                    if (rowNumber <= 5) {
                        const val = String(row.getCell(titleColIndex + 1).value || '').toLowerCase();
                        if (val.includes('título') || val.includes('detalle') || val.includes('editorial')) return;
                    }

                    const titleCell = row.getCell(titleColIndex + 1);
                    const cellTitle = titleCell.value;
                    const cellIsbn = isbnColIndex !== -1 ? String(row.getCell(isbnColIndex + 1).value || '').replace(/[^0-9]/g, '') : null;
                    
                    if (!cellTitle && !cellIsbn) return;

                    let matchedQty = undefined;
                    let productKey = null;
                    let matchedDbItems = [];

                    if (cellIsbn && isbnProducts[cellIsbn] !== undefined) {
                        matchedQty = isbnProducts[cellIsbn];
                        productKey = `isbn:${cellIsbn}`;
                        dbItems.forEach(db => {
                            if (String(db.isbn || db.ean || '').replace(/[^0-9]/g, '') === cellIsbn) matchedDbItems.push(db);
                        });
                    } else if (cellTitle) {
                        const normCellTitle = String(cellTitle).toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (flatProducts[normCellTitle] !== undefined) {
                            matchedQty = flatProducts[normCellTitle].qty;
                            productKey = `title:${normCellTitle}`;
                            dbItems.forEach(db => {
                                if (String(db.titulo || '').toLowerCase().replace(/[^a-z0-9]/g, '') === normCellTitle) matchedDbItems.push(db);
                            });
                        }
                    }

                    const isRed = (cell) => {
                        const checkColor = (c) => c && typeof c === 'string' && (c.includes('FF0000') || c.includes('C00000'));
                        return (cell.font?.color?.argb && checkColor(cell.font.color.argb.toUpperCase())) ||
                               (cell.fill?.fgColor?.argb && checkColor(cell.fill.fgColor.argb.toUpperCase()));
                    };

                    if (matchedQty !== undefined && !filledProducts.has(productKey)) {
                        if (isRed(titleCell)) {
                            row.getCell(qtyColIndex + 1).value = 0;
                            filledProducts.add(productKey);
                            matchedDbItems.forEach(db => {
                                if (!redItemsFound.find(r => r.id === db.id)) redItemsFound.push(db);
                            });
                        } else {
                            row.getCell(qtyColIndex + 1).value = matchedQty;
                            matchedCount++;
                            filledProducts.add(productKey);
                        }
                    } else if (matchedQty !== undefined) {
                        row.getCell(qtyColIndex + 1).value = 0; // Avoid duplicating
                    }
                });
            });

            // Find missing items
            const missingItems = [];
            dbItems.forEach(db => {
                const normTitle = String(db.titulo || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                const normIsbn = String(db.isbn || db.ean || '').replace(/[^0-9]/g, '');
                let found = false;
                if (normIsbn && normIsbn.length > 5 && filledProducts.has(`isbn:${normIsbn}`)) found = true;
                if (normTitle && filledProducts.has(`title:${normTitle}`)) found = true;
                
                if (!found && !redItemsFound.find(r => r.id === db.id)) {
                    missingItems.push(db);
                }
            });

            const nombreVendedor = (profile?.nombre || user?.user_metadata?.nombre || 'Vendedor').split(' ')[0];

            if (missingItems.length > 0 || redItemsFound.length > 0) {
                setConflictState({
                    missingItems,
                    redItems: redItemsFound,
                    workbook,
                    matchedCount,
                    nombreVendedor,
                    semanaActual,
                    resolutions: {} // { id: action }
                });
                setIsExporting(false);
                return;
            }

            await executeDownload(workbook, semanaActual, nombreVendedor, matchedCount);

        } catch (error) {
            console.error('Error generando excel inteligente:', error);
            alert('Error generando Excel pre-llenado: ' + translateError(error) + '. Intentando descarga normal...');
            await handleDownload();
        } finally {
            setIsExporting(false);
        }
    };

    const applyConflictResolutions = async () => {
        if (!conflictState) return;
        setUploading(true);
        try {
            const { missingItems, redItems, resolutions, workbook, semanaActual, nombreVendedor, matchedCount } = conflictState;
            const allConflictItems = [...missingItems, ...redItems];

            for (const item of allConflictItems) {
                const action = resolutions[item.id] || 'MANTENER';
                if (action === 'PAUSAR') {
                    await supabase.from('cliente_items').update({ estado: 'EN PAUSA' }).eq('id', item.id);
                } else if (action === 'MOVER') {
                    await supabase.from('cliente_items').update({ 
                        semana_id: null, 
                        estado: 'PEDIDO (Siguiente)',
                        nota: (item.nota || '') + ` [CONFLICTO ${semanaActual.nombre}]`
                    }).eq('id', item.id);
                } else if (action === 'ELIMINAR') {
                    await supabase.from('cliente_items').delete().eq('id', item.id);
                }
            }

            await executeDownload(workbook, semanaActual, nombreVendedor, matchedCount);
            setConflictState(null);
            fetchSemanaYPedidos();
        } catch (error) {
            console.error('Error aplicando resoluciones:', error);
            alert('Error: ' + translateError(error));
        } finally {
            setUploading(false);
        }
    };

    const handleUpload = async (file, tipo) => {
        if (!semanaActual || !user) return;
        if (!file.name.match(/\.(xlsx|xls)$/)) {
            alert('Por favor, sube un archivo Excel válido (.xlsx o .xls)');
            return;
        }
        setUploading(true);

        try {
            const excelItems = await readExcelRaw(file);
            if (excelItems.length === 0) {
                alert('El archivo no contiene items con cantidades > 0 o el formato es incorrecto.');
                setUploading(false);
                return;
            }

            const currentVendorId = (isAdmin && simulatedVendorId) ? simulatedVendorId : user.id;

            // --- VALIDATION LOGIC ---
            // 1. Fetch DB Items for this week and seller
            const { data: dbItems, error: dbErr } = await supabase
                .from('cliente_items')
                .select('*')
                .eq('semana_id', semanaActual.id)
                .eq('vendedor_id', currentVendorId);

            if (dbErr) throw dbErr;

            // 2. Group DB items by title
            const dbGrouped = {};
            (dbItems || []).forEach(i => {
                const key = i.titulo.toLowerCase().trim();
                dbGrouped[key] = (dbGrouped[key] || 0) + 1;
            });

            // 3. Group Excel items by title
            const excelGrouped = {};
            excelItems.forEach(i => {
                const key = i.titulo.toLowerCase().trim();
                excelGrouped[key] = (excelGrouped[key] || 0) + i.cantidad;
            });

            // 4. Compare
            const discrepancies = [];
            const allTitles = new Set([...Object.keys(dbGrouped), ...Object.keys(excelGrouped)]);

            allTitles.forEach(key => {
                const dbQty = dbGrouped[key] || 0;
                const exQty = excelGrouped[key] || 0;
                const titleOrig = excelItems.find(i => i.titulo.toLowerCase().trim() === key)?.titulo 
                                 || dbItems.find(i => i.titulo.toLowerCase().trim() === key)?.titulo;

                if (dbQty > exQty) {
                    discrepancies.push({
                        titulo: titleOrig,
                        tipo: 'FALTANTE',
                        msg: `Faltan ${dbQty - exQty} unidades para cubrir pedidos de clientes.`,
                        severity: 'error',
                        dbQty, exQty
                    });
                } else if (exQty > dbQty) {
                    discrepancies.push({
                        titulo: titleOrig,
                        tipo: 'EXCESO',
                        msg: tipo === 'tienda' ? `Para Stock de Tienda.` : `Pidiendo ${exQty - dbQty} unidades extra para Stock.`,
                        severity: tipo === 'tienda' ? 'info' : 'warning',
                        dbQty, exQty
                    });
                }
            });

            setValidationResult({
                items: excelItems,
                tipo,
                discrepancies: discrepancies.sort((a,b) => (a.severity === 'error' ? -1 : 1)),
                fileInfo: { name: file.name, size: file.size }
            });

            // Si es pedido de tienda, saltar la verificación y cargar directo
            if (tipo === 'tienda') {
                await performCommit(excelItems, tipo, file.name, currentVendorId);
            }

        } catch (err) {
            console.error(err);
            alert('Error: ' + translateError(err));
        } finally {
            setUploading(false);
        }
    };

    const performCommit = async (items, tipo, fileName, vendorId) => {
        const finalVendorName = (isAdmin && simulatedVendorName) ? simulatedVendorName : (profile?.nombre || user?.user_metadata?.nombre);

        const { data: pedido, error: pedidoError } = await supabase
            .from('pedidos')
            .upsert({
                semana_id: semanaActual.id,
                vendedor_id: vendorId,
                vendedor_nombre: finalVendorName,
                archivo_nombre: fileName,
                tipo: tipo
            }, { onConflict: 'semana_id, vendedor_id, tipo' })
            .select()
            .maybeSingle();

        if (pedidoError) throw pedidoError;

        await supabase.from('pedido_items').delete().eq('pedido_id', pedido.id);

        const { error: itemsError } = await supabase
            .from('pedido_items')
            .insert(items.map(i => ({ ...i, pedido_id: pedido.id })));

        if (itemsError) throw itemsError;

        alert(`Pedido de tipo ${tipo.toUpperCase()} cargado con éxito (${items.length} items).`);
        setValidationResult(null);
        fetchSemanaYPedidos();
    };

    const commitUpload = async () => {
        if (!validationResult || !semanaActual || !user) return;
        setUploading(true);
        const { items, tipo, fileInfo } = validationResult;

        try {
            const finalVendorId = (isAdmin && simulatedVendorId) ? simulatedVendorId : user.id;
            await performCommit(items, tipo, fileInfo.name, finalVendorId);
        } catch (err) {
            console.error(err);
            alert('Error: ' + translateError(err));
        } finally {
            setUploading(false);
        }
    };

    const handleDeletePedido = async (pedidoId, tipo) => {
        if (!window.confirm(`¿Estás seguro de que deseas eliminar tu pedido de tipo ${tipo.toUpperCase()}? Esta acción no se puede deshacer.`)) {
            return;
        }
        setLoading(true);
        try {
            const { error } = await supabase.from('pedidos').delete().eq('id', pedidoId);
            if (error) throw error;
            alert(`Pedido de tipo ${tipo.toUpperCase()} eliminado correctamente.`);
            fetchSemanaYPedidos();
        } catch (err) {
            console.error(err);
            alert('Error al eliminar: ' + translateError(err));
        } finally {
            setLoading(false);
        }
    };

    const onDragOver = (e, tipo) => {
        e.preventDefault();
        setIsDragging(prev => ({ ...prev, [tipo]: true }));
    };

    const onDragLeave = (tipo) => {
        setIsDragging(prev => ({ ...prev, [tipo]: false }));
    };

    const onDrop = (e, tipo) => {
        e.preventDefault();
        setIsDragging(prev => ({ ...prev, [tipo]: false }));
        const file = e.dataTransfer.files[0];
        if (file) handleUpload(file, tipo);
    };

    if (loading) return <div className="py-12 flex justify-center"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>;

    const currentDisplayVendor = (isAdmin && simulatedVendorName) ? simulatedVendorName : (profile?.nombre || user.email);

    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            {isAdmin && (
                <div className="bg-text text-white p-6 rounded-2xl shadow-xl border border-primary/20 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div>
                        <h3 className="font-bold text-lg text-primary flex items-center gap-2"><Upload size={18} /> MODO SIMULACIÓN PARA ADMINISTRADOR</h3>
                        <p className="text-xs text-white/60">Escribe cualquier nombre de vendedor para previsualizar o subir pedidos a su nombre para probar el sistema.</p>
                    </div>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (!simulatedVendorInput) return;

                            if (simulatedVendorInput === 'sede_principal') {
                                setSimulatedVendorId('simulated_sede_principal');
                                setSimulatedVendorName('Sede Principal');
                            } else {
                                const vendor = vendedoresList.find(v => v.id === simulatedVendorInput);
                                if (vendor) {
                                    setSimulatedVendorId(vendor.id);
                                    setSimulatedVendorName(vendor.nombre);
                                }
                            }
                        }}
                        className="flex items-center gap-2 w-full md:w-auto"
                    >
                        <select
                            value={simulatedVendorInput}
                            onChange={e => {
                                const val = e.target.value;
                                setSimulatedVendorInput(val);
                                if (!val) {
                                    setSimulatedVendorId('');
                                    setSimulatedVendorName('');
                                } else if (val === 'sede_principal') {
                                    setSimulatedVendorId('simulated_sede_principal');
                                    setSimulatedVendorName('Sede Principal');
                                } else {
                                    const vendor = vendedoresList.find(v => v.id === val);
                                    if (vendor) {
                                        setSimulatedVendorId(vendor.id);
                                        setSimulatedVendorName(vendor.nombre);
                                    }
                                }
                            }}
                            className="px-4 py-2 rounded-xl bg-background text-text text-sm font-bold border-none outline-none focus:ring-2 focus:ring-primary w-full md:w-64 appearance-none hover:cursor-pointer"
                        >
                            <option value="">-- Cambiar Identidad (Admin) --</option>
                            {vendedoresList.map(v => (
                                <option key={v.id} value={v.id}>{v.nombre} ({v.email})</option>
                            ))}
                            <option value="sede_principal">Sede Principal (Genérico)</option>
                        </select>
                        {(simulatedVendorId) && (
                            <button type="button" onClick={() => { setSimulatedVendorInput(''); setSimulatedVendorId(''); setSimulatedVendorName(''); }} className="bg-error/20 text-error px-4 py-2 rounded-xl font-bold text-sm hover:bg-error/30 transition-colors">
                                SALIR
                            </button>
                        )}
                    </form>
                </div>
            )}

            {!semanaActual ? (
                <div className="glass p-12 text-center rounded-2xl border-dashed border-2">
                    <Clock size={48} className="mx-auto text-muted mb-4 opacity-20" />
                    <h2 className="text-xl font-bold mb-2 text-muted">Aún no hay semanas registradas</h2>
                    <p className="text-xs font-mono text-muted/60 max-w-sm mx-auto">
                        El administrador aún no ha creado ninguna semana en el sistema.
                    </p>
                </div>
            ) : (
                <div className="space-y-8">
                    {!semanaActual.abierta && (
                        <div className="bg-warning/10 border border-warning/20 text-warning p-4 rounded-xl flex items-center justify-center gap-2 mb-4">
                            <AlertCircle size={20} />
                            <span className="font-bold text-sm">La semana está CERRADA. Puedes ver tus pedidos, pero ya no puedes modificarlos ni subir nuevos.</span>
                        </div>
                    )}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        <div className="lg:col-span-1 space-y-6">
                            <div className="glass p-6 rounded-2xl bg-accent/5 border-accent/20">
                                <h3 className="text-xs font-mono text-accent uppercase tracking-widest mb-4">Semana actual</h3>
                                <h2 className="text-2xl font-bold mb-2">{semanaActual.nombre}</h2>
                                <p className="text-xs font-mono text-muted mb-6">Estado: {semanaActual.abierta ? 'ABIERTA PARA CARGA' : 'CERRADA'}</p>

                                {semanaActual.archivo_url ? (
                                    <div className="space-y-3">
                                        <button
                                            onClick={handleIntelligentDownload}
                                            disabled={isExporting}
                                            className="flex items-center justify-center gap-3 w-full bg-accent text-black font-black py-3 rounded-xl hover:bg-accent/90 transition-all shadow-lg hover:shadow-accent/20 hover:scale-[1.02] active:scale-95 disabled:opacity-50"
                                        >
                                            {isExporting ? (
                                                <div className="w-5 h-5 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                                            ) : (
                                                <Zap size={18} className="fill-black" />
                                            )}
                                            {isExporting ? 'PREPARANDO EXCEL...' : 'DESCARGAR MI PEDIDO PRE-LLENADO'}
                                        </button>
                                        <button
                                            onClick={handleDownload}
                                            className="flex items-center justify-center gap-2 w-full bg-surface border border-border text-xs font-bold py-2 rounded-xl hover:bg-background transition-colors opacity-70 hover:opacity-100"
                                        >
                                            <Download size={14} /> Descargar Formato en Blanco
                                        </button>
                                    </div>
                                ) : (
                                    <div className="bg-warning/10 text-warning p-4 rounded text-xs font-mono flex items-start gap-3">
                                        <AlertCircle size={16} className="shrink-0" />
                                        <span>El admin aún no ha subido el Excel base para esta semana.</span>
                                    </div>
                                )}
                            </div>

                            <div className="glass p-6 rounded-2xl">
                                <h3 className="text-xs font-mono text-muted uppercase tracking-widest mb-4">Estado de envío</h3>
                                <div className="space-y-4">
                                    {['personal', 'tienda'].map(tipo => {
                                        const pedido = pedidosRealizados.find(p => p.tipo === tipo);
                                        return (
                                            <div key={tipo} className="flex items-center justify-between p-3 border border-border rounded-lg bg-background/50">
                                                <div>
                                                    <span className="text-xs font-mono text-muted uppercase tracking-tighter block mb-1">TIPO: {tipo}</span>
                                                    <span className="text-xs font-bold">{pedido ? 'ENVIADO' : 'PENDIENTE'}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {pedido ? (
                                                        <>
                                                            {semanaActual.abierta && (
                                                                <button
                                                                    onClick={() => handleDeletePedido(pedido.id, tipo)}
                                                                    className="p-1.5 text-error/70 hover:text-error hover:bg-error/10 rounded-lg transition-colors"
                                                                    title={`Eliminar pedido ${tipo}`}
                                                                >
                                                                    <Trash2 size={18} />
                                                                </button>
                                                            )}
                                                            <CheckCircle size={20} className="text-success" />
                                                        </>
                                                    ) : (
                                                        <Clock size={20} className="text-muted" />
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {semanaActual.abierta && (
                            <div className="lg:col-span-2 space-y-6">
                                {conflictState ? (
                                    <div className="glass p-8 rounded-3xl border-2 border-error/50 bg-error/5 animate-in zoom-in-95 duration-300">
                                        <div className="flex justify-between items-start mb-6">
                                            <div>
                                                <h3 className="text-2xl font-black text-navy flex items-center gap-2">
                                                    <AlertCircle className="text-error" /> RESOLUCIÓN DE CONFLICTOS
                                                </h3>
                                                <p className="text-xs text-muted mt-1 uppercase font-mono tracking-tighter">
                                                    Se detectaron ítems faltantes o cancelados en el Excel del distribuidor.
                                                </p>
                                            </div>
                                            <button 
                                                onClick={() => setConflictState(null)}
                                                className="text-muted hover:text-error transition-colors px-4 py-2 text-xs font-black uppercase"
                                            >
                                                Cancelar
                                            </button>
                                        </div>

                                        <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                                            {[...conflictState.redItems, ...conflictState.missingItems].map((item, idx) => {
                                                const isRed = conflictState.redItems.find(r => r.id === item.id);
                                                return (
                                                    <div 
                                                        key={item.id} 
                                                        className={`p-4 rounded-xl border flex flex-col md:flex-row items-center justify-between gap-4 ${
                                                            isRed ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-200'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-3 w-full">
                                                            <div className={`p-2 rounded-lg ${isRed ? 'bg-red-200 text-red-700' : 'bg-orange-200 text-orange-700'}`}>
                                                                <AlertCircle size={16} />
                                                            </div>
                                                            <div className="flex-1">
                                                                <div className="text-[10px] font-black uppercase opacity-60 leading-none mb-1">
                                                                    {isRed ? 'CANCELADO (ROJO)' : 'FALTANTE EN EXCEL'}
                                                                </div>
                                                                <div className="font-bold text-sm leading-tight">{item.titulo}</div>
                                                                <div className="text-xs opacity-80">Cliente: {item.clientes?.nombre}</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2 w-full md:w-auto">
                                                            <select
                                                                value={conflictState.resolutions[item.id] || (isRed ? 'PAUSAR' : 'MANTENER')}
                                                                onChange={(e) => setConflictState({
                                                                    ...conflictState,
                                                                    resolutions: { ...conflictState.resolutions, [item.id]: e.target.value }
                                                                })}
                                                                className="flex-1 md:w-48 px-3 py-2 rounded-lg bg-white border border-border text-xs font-bold focus:ring-2 focus:ring-primary outline-none"
                                                            >
                                                                <option value="MANTENER">Mantener como Pedido</option>
                                                                <option value="PAUSAR">Pausar Pedido (EN PAUSA)</option>
                                                                <option value="MOVER">Pasar a Siguiente Semana</option>
                                                                <option value="ELIMINAR">Eliminar Pedido</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        <div className="mt-8 flex gap-4">
                                            <button 
                                                onClick={() => {
                                                    const res = {};
                                                    [...conflictState.redItems, ...conflictState.missingItems].forEach(it => {
                                                        res[it.id] = 'PAUSAR';
                                                    });
                                                    setConflictState({ ...conflictState, resolutions: res });
                                                }}
                                                className="px-6 py-4 rounded-2xl border border-border font-bold text-xs hover:bg-background transition-all"
                                            >
                                                PAUSAR TODOS
                                            </button>
                                            <button 
                                                onClick={applyConflictResolutions}
                                                disabled={uploading}
                                                className="flex-1 bg-navy text-white font-black py-4 rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all text-sm uppercase tracking-widest disabled:opacity-50"
                                            >
                                                {uploading ? 'PROCESANDO...' : 'CONFIRMAR Y DESCARGAR'}
                                            </button>
                                        </div>
                                    </div>
                                ) : validationResult ? (
                                    <div className="glass p-8 rounded-3xl border-2 border-secondary/50 bg-secondary/5 animate-in zoom-in-95 duration-300">
                                        <div className="flex justify-between items-start mb-6">
                                            <div>
                                                <h3 className="text-2xl font-black text-navy flex items-center gap-2">
                                                    <CheckCircle className="text-secondary" /> REVISIÓN DE EXCEL
                                                </h3>
                                                <p className="text-xs text-muted mt-1 uppercase font-mono tracking-tighter">
                                                    Archivo: {validationResult.fileInfo.name} ({validationResult.tipo})
                                                </p>
                                            </div>
                                            <button 
                                                onClick={() => setValidationResult(null)}
                                                className="text-muted hover:text-error transition-colors px-4 py-2 text-xs font-black uppercase"
                                            >
                                                Cancelar
                                            </button>
                                        </div>

                                        <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                                            {validationResult.discrepancies.length === 0 ? (
                                                <div className="bg-emerald-500/10 border border-emerald-500/20 p-6 rounded-2xl text-center">
                                                    <span className="text-3xl mb-2 block">✨</span>
                                                    <h4 className="text-emerald-700 font-bold">¡Todo perfecto!</h4>
                                                    <p className="text-xs text-emerald-600/70">Las cantidades del Excel coinciden exactamente con tus pedidos de clientes.</p>
                                                </div>
                                            ) : (
                                                validationResult.discrepancies.map((d, idx) => (
                                                    <div 
                                                        key={idx} 
                                                        className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${
                                                            d.severity === 'error' ? 'bg-red-50 border-red-100 text-red-700' : 
                                                            (d.severity === 'warning' ? 'bg-orange-50 border-orange-100 text-orange-700' : 'bg-blue-50 border-blue-100 text-blue-700')
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            <div className={`p-2 rounded-lg ${d.severity === 'error' ? 'bg-red-200' : (d.severity === 'warning' ? 'bg-orange-200' : 'bg-blue-200')}`}>
                                                                {d.severity === 'error' ? <AlertCircle size={14} /> : <FileText size={14} />}
                                                            </div>
                                                            <div>
                                                                <div className="text-[10px] font-black uppercase opacity-60 leading-none mb-1">{d.tipo}</div>
                                                                <div className="font-bold text-sm leading-tight">{d.titulo}</div>
                                                                <div className="text-xs opacity-80">{d.msg}</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <div className="text-[10px] uppercase font-bold opacity-40">Excel / Web</div>
                                                            <div className="text-lg font-black">{d.exQty} / {d.dbQty}</div>
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        <div className="mt-8 flex gap-4">
                                            <button 
                                                onClick={commitUpload}
                                                disabled={uploading}
                                                className="flex-1 bg-navy text-white font-black py-4 rounded-2xl shadow-xl hover:scale-[1.02] active:scale-95 transition-all text-sm uppercase tracking-widest disabled:opacity-50"
                                            >
                                                {uploading ? 'PROCESANDO...' : 'CONFIRMAR Y CARGAR PEDIDO'}
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {['personal', 'tienda'].map(tipo => (
                                            <div
                                                key={tipo}
                                                onDragOver={(e) => onDragOver(e, tipo)}
                                                onDragLeave={() => onDragLeave(tipo)}
                                                onDrop={(e) => onDrop(e, tipo)}
                                                className={`glass p-8 rounded-2xl border-2 border-dashed transition-all group relative overflow-hidden ${isDragging[tipo] ? 'border-accent bg-accent/5 scale-[1.02]' : 'border-border hover:border-accent'
                                                    }`}
                                            >
                                                {uploading && <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>}

                                                <div className="relative z-0">
                                                    <div className="text-3xl mb-4 group-hover:scale-110 transition-transform">
                                                        {tipo === 'personal' ? '👤' : '🏪'}
                                                    </div>
                                                    <h3 className="text-xl font-bold mb-1 uppercase tracking-tight">
                                                        PEDIDO {tipo === 'personal' ? 'MI PEDIDO' : 'DE TIENDA'}
                                                    </h3>
                                                    <p className="text-xs font-mono text-muted mb-6">
                                                        {tipo === 'personal' ? 'Tus unidades para clientes.' : 'Unidades para stock de tienda Física.'}
                                                    </p>

                                                    <label className="flex items-center justify-center gap-3 w-full bg-surface border border-border group-hover:border-accent group-hover:text-accent font-bold py-3 rounded cursor-pointer transition-all">
                                                        <Upload size={18} />
                                                        SUBIR O ARRASTRAR EXCEL
                                                        <input
                                                            type="file"
                                                            className="hidden"
                                                            accept=".xlsx,.xls"
                                                            onChange={(e) => e.target.files[0] && handleUpload(e.target.files[0], tipo)}
                                                        />
                                                    </label>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="glass p-6 rounded-2xl text-center">
                                    <h3 className="text-xs font-mono text-muted uppercase tracking-widest mb-2 italic">Instrucciones de carga</h3>
                                    <p className="text-xs font-mono text-muted/60 leading-relaxed max-w-md mx-auto">
                                        Puedes seleccionar el archivo o simplemente **arrastrarlo** sobre las zonas punteadas de arriba.
                                        Solo items con cantidades &gt; 0 serán procesados.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <section className="pt-8 border-t border-border">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center text-accent">
                                <FileText size={18} />
                            </div>
                            <div>
                                <h3 className="text-xl font-bold">Resumen de Carga: {currentDisplayVendor}</h3>
                                <p className="text-xs font-mono text-muted">Vista previa de lo que {isAdmin && simulatedVendorName ? 'has enviado bajo esta simulación' : 'has enviado esta semana'}</p>
                            </div>
                        </div>

                        <div className="glass rounded-2xl p-6">
                            <AdminConsolidatedView sellerIdFilter={(isAdmin && simulatedVendorId) ? simulatedVendorId : user?.id} />
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}
