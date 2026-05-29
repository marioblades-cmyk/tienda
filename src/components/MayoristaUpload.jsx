import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useDropzone } from 'react-dropzone';
import ExcelJS from 'exceljs';
import { SHEET_PROCESSORS } from '../utils/excelProcessors';
import { catalogService } from '../services/catalogService';
import { 
    Upload, Store, CheckCircle2, AlertCircle, X, 
    Loader2, Calendar, Package, ArrowRight, Save,
    Info, Database, RefreshCw, CreditCard, History,
    FileText, Plus, ExternalLink, ChevronDown, ChevronUp,
    TrendingUp, Wallet, ArrowDownRight, Printer, Trash2, FileDown
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

// Normalización exacta del proyecto para match robusto
const normalizeTitle = (str) => String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export default function MayoristaUpload() {
    // --- 1. ESTADOS NAVEGACIÓN Y CORE ---
    const [activeTab, setActiveTab] = useState('carga'); // 'carga', 'cuenta', 'historial'
    const [vendedores, setVendedores] = useState([]);
    const [semanas, setSemanas] = useState([]);
    const [selectedVendedor, setSelectedVendedor] = useState('');
    const [selectedSemana, setSelectedSemana] = useState('');
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showAddTienda, setShowAddTienda] = useState(false);
    const [newTiendaNombre, setNewTiendaNombre] = useState('');
    const [savingTienda, setSavingTienda] = useState(false);
    const [adjudicarModal, setAdjudicarModal] = useState(null); // { item, pedido }
    const [adjudicarSemanaId, setAdjudicarSemanaId] = useState('');
    const [adjudicarLoading, setAdjudicarLoading] = useState(false);

    // --- 2. ESTADOS TAB 1: CARGA DE PEDIDO ---
    const [previewData, setPreviewData] = useState(null);
    const [catalog, setCatalog] = useState({});
    const [existingOrder, setExistingOrder] = useState(null); 

    // --- 3. ESTADOS TAB 2: ESTADO DE CUENTA ---
    const [pagos, setPagos] = useState([]);
    const [balance, setBalance] = useState({ totalDeuda: 0, totalPagado: 0 });
    const [showPagoModal, setShowPagoModal] = useState(false);
    const [pagoForm, setPagoForm] = useState({
        monto: '',
        fecha: new Date().toISOString().split('T')[0],
        metodo: 'Efectivo',
        notas: ''
    });

    // --- 4. ESTADOS TAB 3: HISTORIAL ---
    const [pedidosWholesale, setPedidosWholesale] = useState([]);
    const [expandedPedido, setExpandedPedido] = useState(null);

    // --- 5. CALLBACKS Y HOOKS DE NIVEL SUPERIOR ---
    
    // Callback para Dropzone (Debe estar aquí, antes de cualquier return)
    const onDrop = useCallback(acceptedFiles => {
        if (!selectedVendedor || !selectedSemana) {
            return setError("Selecciona tienda y semana antes de subir el archivo.");
        }
        if (acceptedFiles?.length > 0) {
            processExcel(acceptedFiles[0]);
        }
    }, [selectedVendedor, selectedSemana, catalog]);

    // useDropzone es un Hook, DEBE estar aquí al nivel superior
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop,
        accept: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
            'application/vnd.ms-excel': ['.xls']
        },
        multiple: false
    });

    // --- 6. EFECTOS ---
    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        if (selectedVendedor) {
            fetchAccountData();
            if (selectedSemana && activeTab === 'carga') {
                checkExistingOrder();
            }
        } else {
            setExistingOrder(null);
            setPreviewData(null);
            setPagos([]);
            setPedidosWholesale([]);
        }
    }, [selectedVendedor, selectedSemana, activeTab]);

    // --- 7. FUNCIONES DE LOGICA ---

    const handleAddTienda = async () => {
        if (!newTiendaNombre.trim()) return;
        setSavingTienda(true);
        try {
            const { data, error } = await supabase.from('vendedores').insert([{
                nombre: newTiendaNombre.trim().toUpperCase(),
                es_mayorista: true,
                active: true
            }]).select().single();
            if (error) throw error;
            setVendedores(prev => [...prev, data]);
            setSelectedVendedor(data.id);
            setNewTiendaNombre('');
            setShowAddTienda(false);
        } catch (e) {
            alert('Error al agregar tienda: ' + e.message);
        } finally {
            setSavingTienda(false);
        }
    };

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [vendedoresRes, semanasRes, catalogData] = await Promise.all([
                supabase.from('vendedores').select('*').eq('es_mayorista', true).eq('active', true),
                supabase.from('semanas').select('*').eq('abierta', true).order('created_at', { ascending: false }),
                catalogService.fetchFullCatalog()
            ]);

            if (vendedoresRes.data) setVendedores(vendedoresRes.data);
            if (semanasRes.data) setSemanas(semanasRes.data);
            
            if (catalogData && catalogData.length > 0) {
                const catMap = {};
                catalogData.forEach(p => {
                    catMap[normalizeTitle(p.titulo)] = p;
                });
                setCatalog(catMap);
            }
        } catch (err) {
            console.error("Error cargando datos iniciales:", err);
            setError("Error al cargar datos necesarios.");
        } finally {
            setLoading(false);
        }
    };

    const fetchAccountData = async () => {
        if (!selectedVendedor) return;
        try {
            const { data: orders } = await supabase
                .from('pedidos')
                .select(`
                    *,
                    semana:semanas(nombre),
                    items:pedido_items(id, titulo, cantidad, precio, fuente, catalog_id, estado)
                `)
                .eq('vendedor_id', selectedVendedor)
                .eq('tipo', 'mayorista')
                .order('created_at', { ascending: false });

            const { data: payments } = await supabase
                .from('mayorista_pagos')
                .select('*')
                .eq('vendedor_id', selectedVendedor)
                .order('fecha', { ascending: false });

            let totalD = 0;
            const enrichedOrders = (orders || []).map(order => {
                let orderTotalBs = 0;
                order.items.forEach(it => {
                    if (it.estado?.includes('RECORTADO')) return; // EXCLUIR RECORTADOS DEL TOTAL
                    const prod = catalog[normalizeTitle(it.titulo)];
                    const unitPriceBs = prod?.precio_mayoreo_bs || prod?.precio_venta_bs || 0;
                    orderTotalBs += (unitPriceBs * it.cantidad);
                });
                totalD += orderTotalBs;
                return { ...order, totalBs: orderTotalBs };
            });

            const totalP = (payments || []).reduce((acc, p) => acc + Number(p.monto), 0);
            setPedidosWholesale(enrichedOrders);
            setPagos(payments || []);
            setBalance({ totalDeuda: totalD, totalPagado: totalP });
        } catch (err) {
            console.error("Error cargando cuenta corriente:", err);
        }
    };

    const checkExistingOrder = async () => {
        setLoading(true);
        try {
            const { data: existingPedido } = await supabase
                .from('pedidos')
                .select('id, vendedor_nombre, estado')
                .eq('semana_id', selectedSemana)
                .eq('vendedor_id', selectedVendedor)
                .eq('tipo', 'mayorista')
                .maybeSingle();
            
            if (existingPedido) {
                setExistingOrder(existingPedido);
                const { data: existingItems } = await supabase
                    .from('pedido_items')
                    .select('*, catalogo_productos(stock_fisico)')
                    .eq('pedido_id', existingPedido.id);
                
                const grouped = {};
                (existingItems || []).forEach(it => {
                    const norm = normalizeTitle(it.titulo);
                    if (!grouped[norm]) {
                        grouped[norm] = {
                            titulo: it.titulo,
                            editorial: it.editorial,
                            precio: it.precio,
                            precio_tapa: it.precio,
                            catalog_id: it.catalog_id,
                            stock_fisico: it.catalogo_productos?.stock_fisico || 0,
                            cantidad_entelequia: 0,
                            cantidad_stock: 0,
                            cantidad_stock_original: 0
                        };
                    }
                    if (it.fuente === 'entelequia') {
                        grouped[norm].cantidad_entelequia += it.cantidad;
                    } else if (it.fuente === 'stock') {
                        grouped[norm].cantidad_stock += it.cantidad;
                        grouped[norm].cantidad_stock_original += it.cantidad;
                    }
                });

                const preview = Object.values(grouped).map(g => {
                    g.cantidad = g.cantidad_entelequia + g.cantidad_stock;
                    g.subtotal = g.cantidad * g.precio;
                    return g;
                });
                setPreviewData(preview);
            } else {
                setExistingOrder(null);
                setPreviewData(null);
            }
        } catch (err) {
            console.error("Error comprobando pedido:", err);
            setError("Error al comprobar el estado del pedido.");
        } finally {
            setLoading(false);
        }
    };

    const processExcel = async (file) => {
        setProcessing(true);
        setError('');
        setSuccess('');

        try {
            const arrayBuffer = await file.arrayBuffer();
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(arrayBuffer);

            let allParsedItems = [];
            for (const ws of workbook.worksheets) {
                const sheetName = ws.name.trim();
                const sheetNameUpper = sheetName.toUpperCase();
                if (sheetNameUpper.includes('TOTAL') || sheetNameUpper.includes('RESUMEN')) continue;

                const processorKey = Object.keys(SHEET_PROCESSORS).find(k => k.trim().toUpperCase() === sheetNameUpper) || 'Otras';
                const processor = SHEET_PROCESSORS[processorKey];

                const rows = [];
                ws.eachRow({ includeEmpty: true }, (row) => {
                    const rowValues = [];
                    for (let c = 1; c <= 20; c++) {
                        const cell = row.getCell(c);
                        let val = cell.value;
                        if (val && typeof val === 'object') {
                            if (val.richText) val = val.richText.map(t => t.text).join('');
                            else if (val.text) val = val.text;
                            else if (val.result !== undefined) val = val.result;
                            else if (val.hyperlink) val = val.text || val.hyperlink;
                        }
                        rowValues[c - 1] = val;
                    }
                    rows.push(rowValues);
                });

                if (ws.name === 'Ivrea') rows.unshift(['NOVEDADES']);

                const result = processor(rows);
                if (result && result.items) {
                    const itemsWithQty = result.items
                        .filter(it => it.cantidad > 0)
                        .map(it => {
                            const norm = normalizeTitle(it.titulo);
                            const prod = catalog[norm];
                            const exactPrecio = it.precio_tapa || prod?.precio_tapa || 0;
                            return {
                                titulo: it.titulo,
                                cantidad: it.cantidad,
                                precio: exactPrecio,
                                precio_tapa: prod?.precio_tapa || exactPrecio,
                                subtotal: exactPrecio * it.cantidad,
                                editorial: sheetName,
                                stock_fisico: prod?.stock_fisico || 0,
                                catalog_id: prod?.id || null,
                                cantidad_entelequia: it.cantidad,
                                cantidad_stock: 0,
                                cantidad_stock_original: 0
                            };
                        });
                    allParsedItems = [...allParsedItems, ...itemsWithQty];
                }
            }
            if (allParsedItems.length === 0) throw new Error("No se detectaron ítems válidos.");
            setPreviewData(allParsedItems);
        } catch (err) {
            setError(err.message || 'Error procesando el archivo Excel.');
        } finally {
            setProcessing(false);
        }
    };

    const handleConfirmarPedido = async () => {
        if (!selectedVendedor || !selectedSemana || !previewData) return;
        setProcessing(true);
        setError('');

        try {
            const vendName = vendedores.find(v => v.id === selectedVendedor)?.nombre || 'Tienda Mayorista';
            const { data: pedido } = await supabase
                .from('pedidos')
                .upsert({
                    vendedor_id: selectedVendedor,
                    semana_id: selectedSemana,
                    tipo: 'mayorista',
                    estado: 'PENDIENTE',
                    vendedor_nombre: vendName
                }, {
                    onConflict: 'semana_id,vendedor_id,tipo',
                    ignoreDuplicates: false
                })
                .select().single();

            await supabase.from('pedido_items').delete().eq('pedido_id', pedido.id);

            const nombreSemana = semanas.find(s => s.id === selectedSemana)?.nombre || '';
            const itemsToSave = [];
            previewData.forEach(it => {
                if (it.cantidad_entelequia > 0) {
                    itemsToSave.push({
                        pedido_id: pedido.id,
                        titulo: it.titulo,
                        cantidad: it.cantidad_entelequia,
                        precio: it.precio_tapa,
                        fuente: 'entelequia',
                        catalog_id: it.catalog_id,
                        editorial: it.editorial,
                        estado: `PEDIDO ${nombreSemana}`
                    });
                }
                if (it.cantidad_stock > 0) {
                    itemsToSave.push({
                        pedido_id: pedido.id,
                        titulo: it.titulo,
                        cantidad: it.cantidad_stock,
                        precio: it.precio_tapa,
                        fuente: 'stock',
                        catalog_id: it.catalog_id,
                        editorial: it.editorial,
                        estado: 'EN TIENDA'
                    });
                }
            });

            if (itemsToSave.length > 0) {
                await supabase.from('pedido_items').insert(itemsToSave);
            }

            for (const item of previewData.filter(it => it.catalog_id)) {
                const diff = item.cantidad_stock - item.cantidad_stock_original;
                if (diff !== 0) {
                    const nuevoStock = item.stock_fisico - diff;
                    await supabase.from('catalogo_productos').update({ stock_fisico: nuevoStock }).eq('id', item.catalog_id);
                    await supabase.from('stock_movimientos').insert({
                        producto_id: item.catalog_id,
                        titulo: item.titulo,
                        delta: -diff,
                        stock_despues: nuevoStock,
                        motivo: existingOrder ? 'PEDIDO_MAYORISTA_AJUSTE' : 'PEDIDO_MAYORISTA',
                        detalle: `Ajuste para ${vendName}`
                    });
                }
            }

            setSuccess("¡Pedido mayorista registrado con éxito!");
            setPreviewData(null);
            setExistingOrder(null);
            fetchInitialData(); 
        } catch (err) {
            setError(err.message || "Error al confirmar el pedido.");
        } finally {
            setProcessing(false);
        }
    };

    const handleSavePago = async () => {
        if (!pagoForm.monto || Number(pagoForm.monto) <= 0) return alert("Monto inválido");
        setProcessing(true);
        try {
            const storeName = vendedores.find(v => v.id === selectedVendedor)?.nombre;
            const { data: cajaMov, error: cajError } = await supabase
                .from('caja_movimientos')
                .insert([{
                    tipo: 'INGRESO',
                    categoria: 'Cobro Mayorista',
                    origen: 'Pedidos',
                    monto: Number(pagoForm.monto),
                    metodo_pago: pagoForm.metodo,
                    concepto: `Cobro tienda mayorista: ${storeName}`,
                    vendedor_id: selectedVendedor
                }])
                .select().single();
            if (cajError) throw new Error('Error en contabilidad: ' + cajError.message);

            const { error: pagoError } = await supabase
                .from('mayorista_pagos')
                .insert([{
                    vendedor_id: selectedVendedor,
                    monto: Number(pagoForm.monto),
                    fecha: pagoForm.fecha,
                    metodo_pago: pagoForm.metodo,
                    notas: pagoForm.notas,
                    caja_mov_id: cajaMov.id
                }]);
            if (pagoError) throw new Error('Error al guardar en cuenta del mayorista: ' + pagoError.message);

            setSuccess("✓ Pago registrado y sincronizado con contabilidad.");
            setShowPagoModal(false);
            setPagoForm({ monto: '', fecha: new Date().toISOString().split('T')[0], metodo: 'Efectivo', notas: '' });
            fetchAccountData();
        } catch (err) {
            setError("Error al registrar pago: " + err.message);
        } finally {
            setProcessing(false);
        }
    };

    const handleUpdateOrderEstado = async (pedidoId, newEstado) => {
        try {
            const updateObj = { estado: newEstado };
            if (newEstado === 'DESPACHADO') updateObj.fecha_despacho = new Date().toISOString();
            await supabase.from('pedidos').update(updateObj).eq('id', pedidoId);
            fetchAccountData();
        } catch (err) {
            alert("Error: " + err.message);
        }
    };

    // Cambiar estado de un ítem individual (ej: "PEDIDO (Siguiente)" → "EN TIENDA")
    const handleUpdateItemEstado = async (itemId, newEstado) => {
        try {
            await supabase.from('pedido_items').update({ estado: newEstado }).eq('id', itemId);
            fetchAccountData();
        } catch (err) {
            alert("Error al actualizar ítem: " + err.message);
        }
    };

    // Mover ítem a la semana correcta y marcarlo como CONFIRMADO
    const handleAdjudicarEnSemana = async () => {
        if (!adjudicarModal || !adjudicarSemanaId) return;
        const { item, pedido: currentPedido } = adjudicarModal;
        setAdjudicarLoading(true);
        try {
            // 1. Buscar o crear pedido mayorista para este vendedor en la semana destino
            const { data: existingPedido } = await supabase
                .from('pedidos')
                .select('id')
                .eq('semana_id', adjudicarSemanaId)
                .eq('vendedor_id', currentPedido.vendedor_id)
                .eq('tipo', 'mayorista')
                .maybeSingle();

            let targetPedidoId;
            if (existingPedido) {
                targetPedidoId = existingPedido.id;
            } else {
                const { data: newPedido, error: pedErr } = await supabase
                    .from('pedidos')
                    .insert({
                        semana_id: adjudicarSemanaId,
                        tipo: 'mayorista',
                        vendedor_id: currentPedido.vendedor_id,
                        vendedor_nombre: currentPedido.vendedor_nombre,
                    })
                    .select('id')
                    .single();
                if (pedErr) throw pedErr;
                targetPedidoId = newPedido.id;
            }

            // 2. Mover ítem al pedido de la semana destino + marcar CONFIRMADO
            const semanaNombre = semanas.find(s => s.id === adjudicarSemanaId)?.nombre || '';
            const { error: updErr } = await supabase
                .from('pedido_items')
                .update({
                    pedido_id: targetPedidoId,
                    estado: `CONFIRMADO ${semanaNombre}`.trim()
                })
                .eq('id', item.id);
            if (updErr) throw updErr;

            setAdjudicarModal(null);
            setAdjudicarSemanaId('');
            fetchAccountData();
        } catch (err) {
            alert('Error al adjudicar: ' + err.message);
        } finally {
            setAdjudicarLoading(false);
        }
    };

    const generatePDF = () => {
        const storeName = vendedores.find(v => v.id === selectedVendedor)?.nombre || 'Socio Mayorista';
        const doc = new jsPDF();
        const navy = [30, 58, 95];
        const orange = [232, 137, 26];

        // Header
        doc.setFontSize(22);
        doc.setTextColor(navy[0], navy[1], navy[2]);
        doc.text("MANGAS COMICS BOLIVIA", 105, 20, { align: "center" });
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`REPORTE DE ESTADO DE CUENTA - ${new Date().toLocaleDateString()}`, 105, 28, { align: "center" });
        doc.text(`Cliente: ${storeName}`, 105, 34, { align: "center" });

        // Account Summary
        doc.setDrawColor(240);
        doc.setFillColor(250, 250, 250);
        doc.roundedRect(14, 45, 182, 35, 3, 3, 'FD');
        
        doc.setFontSize(9);
        doc.setTextColor(150);
        doc.text("TOTAL ACUMULADO PEDIDOS", 20, 55);
        doc.text("TOTAL PAGADO", 85, 55);
        doc.text("SALDO PENDIENTE", 150, 55);

        doc.setFontSize(14);
        doc.setTextColor(navy[0], navy[1], navy[2]);
        doc.text(`Bs ${balance.totalDeuda.toLocaleString()}`, 20, 65);
        doc.setTextColor(0, 150, 0);
        doc.text(`Bs ${balance.totalPagado.toLocaleString()}`, 85, 65);
        
        const saldoRaw = balance.totalDeuda - balance.totalPagado;
        // Absorber diferencias de redondeo menores a Bs 1
        const saldo = (saldoRaw < 0 && Math.abs(saldoRaw) < 1) ? 0 : saldoRaw;
        if (saldo > 0) doc.setTextColor(200, 0, 0);
        else doc.setTextColor(0, 150, 0);
        doc.text(`Bs ${saldo.toLocaleString()}`, 150, 65);

        let currentY = 90;

        // Pedidos
        pedidosWholesale.forEach((pedido, idx) => {
            if (currentY > 240) { doc.addPage(); currentY = 20; }
            
            const semana = pedido.semana;
            const eta = semana?.fecha_estimada_llegada 
                ? new Date(semana.fecha_estimada_llegada)
                : new Date(new Date(pedido.created_at).getTime() + (22*24*60*60*1000));

            doc.setFillColor(navy[0], navy[1], navy[2]);
            doc.rect(14, currentY, 182, 8, 'F');
            doc.setTextColor(255);
            doc.setFontSize(10);
            doc.text(`${semana?.nombre || 'Pedido s/n'} - ${new Date(pedido.created_at).toLocaleDateString()}`, 18, currentY + 5.5);
            
            currentY += 12;
            doc.setTextColor(100);
            doc.setFontSize(8);
            doc.text(`Estado: ${pedido.estado} | ETA: ${eta.toLocaleDateString()}`, 14, currentY);
            currentY += 5;

            let orderTotal = 0;
            let totalRecortes = 0;

            const tableRows = pedido.items.map(it => {
                const prod = catalog[normalizeTitle(it.titulo)];
                const pBs = prod?.precio_mayoreo_bs || prod?.precio_venta_bs || 0;
                const subtotal = pBs * it.cantidad;
                const isRecortado = it.estado?.includes('RECORTADO');

                if (isRecortado) totalRecortes += subtotal;
                else orderTotal += subtotal;

                let displayStatus = 'PENDIENTE';
                if (isRecortado) displayStatus = '❌ RECORTADO';
                else if (it.estado === 'DESPACHADO') displayStatus = '✅ DESPACHADO';

                return [
                    it.titulo,
                    it.cantidad,
                    `Bs ${pBs.toFixed(2)}`,
                    `Bs ${subtotal.toLocaleString()}`,
                    displayStatus
                ];
            });

            autoTable(doc, {
                startY: currentY,
                head: [['Título', 'Cant', 'Precio Bs', 'Subtotal', 'Estado']],
                body: tableRows,
                headStyles: { fillColor: navy },
                styles: { fontSize: 7 },
                margin: { left: 14, right: 14 },
                theme: 'striped'
            });

            currentY = doc.lastAutoTable.finalY + 5;
            doc.setFontSize(9);
            doc.setTextColor(navy[0], navy[1], navy[2]);
            doc.text(`Total Pedido: Bs ${orderTotal.toLocaleString()}`, 196, currentY, { align: "right" });
            
            if (totalRecortes > 0) {
                currentY += 4;
                doc.setFontSize(7);
                doc.setTextColor(200, 0, 0);
                doc.text(`(-Bs ${totalRecortes.toLocaleString()} en recortes)`, 196, currentY, { align: "right" });
            }
            currentY += 15;
        });

        // Pagos
        if (currentY > 220) { doc.addPage(); currentY = 20; }
        doc.setFontSize(12);
        doc.setTextColor(orange[0], orange[1], orange[2]);
        doc.text("HISTORIAL DE PAGOS", 14, currentY);
        currentY += 5;

        const pagoRows = pagos.map(p => [
            new Date(p.fecha).toLocaleDateString(),
            p.metodo_pago,
            `Bs ${Number(p.monto).toLocaleString()}`,
            p.notas || '-'
        ]);

        autoTable(doc, {
            startY: currentY,
            head: [['Fecha', 'Método', 'Monto', 'Notas']],
            body: pagoRows,
            headStyles: { fillColor: orange },
            styles: { fontSize: 8 },
            margin: { left: 14, right: 14 },
            theme: 'grid'
        });

        // Footer
        const finalY = doc.lastAutoTable.finalY + 20;
        doc.setFontSize(11);
        doc.setTextColor(navy[0], navy[1], navy[2]);
        doc.text(`Saldo Final Pendiente: Bs ${saldo.toLocaleString()}`, 105, finalY, { align: "center" });

        doc.save(`Reporte_Mayorista_${storeName.replace(/\s+/g, '_')}.pdf`);
    };

    // --- 8. RENDERIZADO ---
    if (loading) return <div className="py-20 flex flex-col items-center justify-center"><Loader2 className="animate-spin text-navy w-12 h-12" /><p className="mt-4 font-bold text-slate-400">Cargando Panel...</p></div>;

    return (
        <div className="space-y-6 max-w-5xl mx-auto pb-20">
            {/* Header Principal */}
            <div className="bg-white p-6 rounded-[2.5rem] border border-border/40 shadow-xl">
                <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
                    <div className="flex items-center gap-4">
                        <div className="bg-navy p-4 rounded-3xl text-orange-500 shadow-xl shadow-navy/20">
                            <Store size={32} />
                        </div>
                        <div>
                            <h3 className="text-2xl font-black text-navy uppercase tracking-tighter">Wholesale Hub</h3>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">{vendedores.find(v => v.id === selectedVendedor)?.nombre || 'Selección de Tienda'}</p>
                        </div>
                    </div>

                    <div className="flex gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200">
                        {[
                            { id: 'carga', icon: Upload, label: 'Carga' },
                            { id: 'cuenta', icon: Wallet, label: 'Cuenta' },
                            { id: 'historial', icon: History, label: 'Historial' }
                        ].map(tab => (
                            <button 
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-navy text-white shadow-lg' : 'text-slate-400 hover:text-navy hover:bg-white/50'}`}
                            >
                                <tab.icon size={14} /> {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-1">
                            <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Mayorista Seleccionado</label>
                            <button
                                onClick={() => { setShowAddTienda(v => !v); setNewTiendaNombre(''); }}
                                className="text-[9px] font-black uppercase tracking-widest text-navy hover:text-blue-600 flex items-center gap-1 transition-colors"
                            >
                                <Plus size={11} strokeWidth={3} />
                                {showAddTienda ? 'Cancelar' : 'Nueva tienda'}
                            </button>
                        </div>

                        {showAddTienda ? (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newTiendaNombre}
                                    onChange={e => setNewTiendaNombre(e.target.value.toUpperCase())}
                                    onKeyDown={e => e.key === 'Enter' && handleAddTienda()}
                                    placeholder="Nombre de la tienda..."
                                    autoFocus
                                    className="flex-1 px-4 py-3 border-2 border-navy/30 rounded-2xl text-xs font-black bg-white focus:border-navy outline-none transition-all"
                                />
                                <button
                                    onClick={handleAddTienda}
                                    disabled={savingTienda || !newTiendaNombre.trim()}
                                    className="px-5 py-3 bg-navy text-white text-xs font-black rounded-2xl hover:bg-blue-700 disabled:opacity-40 transition-all"
                                >
                                    {savingTienda ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                </button>
                            </div>
                        ) : (
                            <select
                                value={selectedVendedor}
                                onChange={(e) => setSelectedVendedor(e.target.value)}
                                className="w-full px-5 py-4 border-2 border-slate-50 rounded-2xl text-xs font-black bg-slate-50 focus:border-navy focus:bg-white outline-none transition-all"
                            >
                                <option value="">-- SELECCIONAR TIENDA --</option>
                                {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                            </select>
                        )}
                    </div>
                    {activeTab === 'carga' && (
                        <div className="space-y-1.5">
                            <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-3">Semana de Pedido</label>
                            <select
                                value={selectedSemana}
                                onChange={(e) => setSelectedSemana(e.target.value)}
                                className="w-full px-5 py-4 border-2 border-slate-50 rounded-2xl text-xs font-black bg-slate-50 focus:border-navy focus:bg-white outline-none transition-all"
                            >
                                <option value="">-- SELECCIONAR SEMANA --</option>
                                {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-2xl text-xs font-black flex items-center gap-3"><AlertCircle size={18} /> {error}</div>}
            {success && <div className="p-4 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-2xl text-xs font-black flex items-center gap-3"><CheckCircle2 size={18} /> {success}</div>}

            {selectedVendedor ? (
                <div className="animate-in fade-in duration-500">
                    {/* TAB 1: CARGA */}
                    {activeTab === 'carga' && (
                        <div className="space-y-6">
                            {existingOrder && (
                                <div className="bg-sky-50 border border-sky-100 rounded-3xl p-6 flex justify-between items-center shadow-sm">
                                    <div>
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="bg-sky-500 text-white text-[9px] font-black px-2 py-1 rounded-lg">EDICIÓN ACTIVA</span>
                                            <span className="bg-white border border-sky-200 text-sky-600 text-[9px] font-black px-2 py-1 rounded-lg">{existingOrder.estado}</span>
                                        </div>
                                        <h4 className="font-black text-navy">{existingOrder.vendedor_nombre}</h4>
                                    </div>
                                    <button onClick={() => { if(window.confirm("¿Resetear?")) setPreviewData(null); }} className="p-3 bg-white border border-red-100 text-red-500 rounded-2xl hover:bg-red-50 transition-all"><RefreshCw size={20} /></button>
                                </div>
                            )}

                            {!previewData ? (
                                <div {...getRootProps()} className={`border-4 border-dashed rounded-[3.5rem] p-24 text-center transition-all cursor-pointer group bg-white/40 ${isDragActive ? 'border-navy bg-slate-50' : 'border-slate-100'}`}>
                                    <input {...getInputProps()} />
                                    <div className="w-24 h-24 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-8 group-hover:scale-110 group-hover:bg-navy group-hover:text-white transition-all shadow-lg">
                                        <Upload size={40} />
                                    </div>
                                    <h4 className="text-2xl font-black text-navy uppercase tracking-tighter">Procesar Pedido Mayorista</h4>
                                    <p className="text-xs text-slate-400 mt-3 font-bold uppercase tracking-widest">Arrastra el Excel del Distribuidor aquí</p>
                                </div>
                            ) : (
                                <div className="bg-white rounded-[2.5rem] border border-border/40 shadow-2xl overflow-hidden">
                                    <div className="p-6 bg-navy text-white flex justify-between items-center">
                                        <div className="flex items-center gap-3"><Package className="text-orange-500" /> <h4 className="font-black text-sm uppercase tracking-widest">Resumen de Carga</h4></div>
                                        <button onClick={() => setPreviewData(null)} className="p-2 hover:bg-white/10 rounded-full"><X size={20} /></button>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-slate-50 border-b border-slate-100">
                                                <tr className="text-slate-400 font-black uppercase tracking-widest text-[9px]">
                                                    <th className="p-5">Producto / Editorial</th>
                                                    <th className="p-5 text-center">Unid.</th>
                                                    <th className="p-5 text-center">Stock Local</th>
                                                    <th className="p-5 text-right">Origen (Entelequia / Stock)</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {previewData.map((it, idx) => (
                                                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                                        <td className="p-5">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="bg-slate-100 text-slate-500 text-[8px] font-black px-1.5 py-0.5 rounded-md uppercase">{it.editorial}</span>
                                                                <span className="text-slate-400 font-mono text-[9px]">Bs {it.precio.toFixed(2)}</span>
                                                            </div>
                                                            <p className="font-black text-navy uppercase text-[10px] leading-tight">{it.titulo}</p>
                                                        </td>
                                                        <td className="p-5 text-center font-black text-navy text-sm">{it.cantidad}</td>
                                                        <td className="p-5 text-center">
                                                            <span className={`px-2 py-1 rounded-lg font-black text-[10px] ${it.stock_fisico > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>{it.stock_fisico}</span>
                                                        </td>
                                                        <td className="p-5">
                                                            <div className="flex justify-end gap-2">
                                                                <input 
                                                                    type="number" min="0" max={it.cantidad} value={it.cantidad_entelequia}
                                                                    onChange={(e) => {
                                                                        const newData = [...previewData];
                                                                        const val = Math.min(it.cantidad, Math.max(0, parseInt(e.target.value) || 0));
                                                                        newData[idx].cantidad_entelequia = val;
                                                                        newData[idx].cantidad_stock = it.cantidad - val;
                                                                        setPreviewData(newData);
                                                                    }}
                                                                    className="w-14 p-1.5 bg-slate-100 border-border/10 rounded-lg text-center font-black text-navy outline-none focus:border-navy border-2 transition-all"
                                                                />
                                                                <input 
                                                                    type="number" min="0" max={it.stock_fisico} value={it.cantidad_stock}
                                                                    onChange={(e) => {
                                                                        const newData = [...previewData];
                                                                        const val = Math.min(it.stock_fisico, it.cantidad, Math.max(0, parseInt(e.target.value) || 0));
                                                                        newData[idx].cantidad_stock = val;
                                                                        newData[idx].cantidad_entelequia = it.cantidad - val;
                                                                        setPreviewData(newData);
                                                                    }}
                                                                    className="w-14 p-1.5 bg-orange-50 border-orange-100 rounded-lg text-center font-black text-orange-600 outline-none focus:border-orange-500 border-2 transition-all"
                                                                />
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="p-8 bg-slate-50 border-t flex flex-col md:flex-row justify-between items-center gap-8">
                                        <div className="flex gap-8">
                                            <div className="text-center md:text-left">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Unidades</p>
                                                <p className="text-2xl font-black text-navy">{previewData.reduce((s,i)=>s+i.cantidad,0)}</p>
                                            </div>
                                            <div className="text-center md:text-left">
                                                <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest mb-1">Desde Stock</p>
                                                <p className="text-2xl font-black text-orange-600">{previewData.reduce((s,i)=>s+i.cantidad_stock,0)}</p>
                                            </div>
                                        </div>
                                        <button onClick={handleConfirmarPedido} disabled={processing} className="w-full md:w-auto px-12 py-5 bg-navy text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-3">
                                            {processing ? <Loader2 className="animate-spin" /> : <Save size={18} />} CONFIRMAR PEDIDO
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 2: CUENTA */}
                    {activeTab === 'cuenta' && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-8 rounded-[2rem] border border-border/40 shadow-sm">
                                    <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest mb-2">Total Pedidos</p>
                                    <p className="text-3xl font-black text-navy">Bs {balance.totalDeuda.toLocaleString()}</p>
                                </div>
                                <div className="bg-emerald-50 p-8 rounded-[2rem] border border-emerald-100 shadow-sm">
                                    <p className="text-[10px] uppercase font-black text-emerald-600 tracking-widest mb-2">Total Pagado</p>
                                    <p className="text-3xl font-black text-emerald-700">Bs {balance.totalPagado.toLocaleString()}</p>
                                </div>
                                <div className="bg-orange-50 p-8 rounded-[2rem] border border-orange-100 shadow-sm">
                                    <p className="text-[10px] uppercase font-black text-orange-600 tracking-widest mb-2">Saldo Deudor</p>
                                    {(() => {
                                        const saldoRaw = balance.totalDeuda - balance.totalPagado;
                                        // Absorber diferencias de redondeo menores a Bs 1
                                        const esRedondeo = saldoRaw < 0 && Math.abs(saldoRaw) < 1;
                                        const saldoDisplay = esRedondeo ? 0 : saldoRaw;
                                        return (
                                            <>
                                                <p className={`text-3xl font-black ${saldoDisplay > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                                                    Bs {saldoDisplay.toLocaleString()}
                                                </p>
                                                {esRedondeo && (
                                                    <p className="text-[9px] font-bold text-amber-600 mt-1">
                                                        ↳ Redondeo de Bs {Math.abs(saldoRaw).toFixed(2)} absorbido
                                                    </p>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div className="bg-white rounded-[2.5rem] border border-border/40 shadow-xl overflow-hidden">
                                <div className="p-8 bg-navy text-white flex justify-between items-center">
                                    <h4 className="text-sm font-black uppercase tracking-widest flex items-center gap-3"><CreditCard className="text-orange-500" /> Historial Financiero</h4>
                                    <button onClick={() => setShowPagoModal(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl shadow-orange-500/20 flex items-center gap-2"><Plus size={16} /> Registrar Pago</button>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-slate-50 border-b border-slate-100">
                                            <tr className="text-slate-400 font-black uppercase tracking-widest text-[9px]">
                                                <th className="p-6">Fecha</th>
                                                <th className="p-6">Método de Pago</th>
                                                <th className="p-6 text-right">Monto</th>
                                                <th className="p-6">Referencia</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {pagos.map(p => (
                                                <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="p-6 font-black text-navy">{new Date(p.fecha).toLocaleDateString()}</td>
                                                    <td className="p-6"><span className="bg-slate-100 text-slate-500 text-[9px] font-black px-2 py-1 rounded-lg uppercase">{p.metodo_pago}</span></td>
                                                    <td className="p-6 text-right font-black text-emerald-600 text-sm">Bs {Number(p.monto).toLocaleString()}</td>
                                                    <td className="p-6 text-slate-400 italic text-[10px]">{p.notas || 'Sin notas'}</td>
                                                </tr>
                                            ))}
                                            {pagos.length === 0 && <tr><td colSpan="4" className="p-12 text-center text-slate-300 font-black uppercase tracking-widest text-xs">No se registran cobros</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 3: HISTORIAL */}
                    {activeTab === 'historial' && (
                        <div className="space-y-4">
                            <div className="flex justify-end mb-4">
                                <button 
                                    onClick={generatePDF}
                                    className="flex items-center gap-2 bg-navy text-white px-6 py-3 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-navy/90 transition-all shadow-xl shadow-navy/20"
                                >
                                    <FileDown size={18} /> Generar Reporte PDF
                                </button>
                            </div>
                            {pedidosWholesale.map(pedido => (
                                <div key={pedido.id} className="bg-white rounded-[2rem] border border-border/40 shadow-sm overflow-hidden hover:border-navy/20 transition-all">
                                    <div className="p-6 flex flex-col md:flex-row justify-between items-center gap-6">
                                        <div className="flex items-center gap-4 flex-1">
                                            <div className="bg-slate-50 p-4 rounded-2xl text-navy border border-slate-100 shadow-inner"><Package size={24} /></div>
                                            <div>
                                                <h4 className="font-black text-navy uppercase text-sm tracking-tight">{pedido.semana?.nombre}</h4>
                                                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{new Date(pedido.created_at).toLocaleDateString()} • {pedido.items.length} Títulos</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-8 px-8 border-x border-slate-100">
                                            <div className="text-center">
                                                <p className="text-[8px] font-black text-slate-300 uppercase mb-1">Monto Pedido</p>
                                                <p className="font-black text-navy text-sm">Bs {pedido.totalBs.toLocaleString()}</p>
                                            </div>
                                            <select 
                                                value={pedido.estado}
                                                onChange={(e) => handleUpdateOrderEstado(pedido.id, e.target.value)}
                                                className={`text-[9px] font-black uppercase px-3 py-2 rounded-xl border-2 outline-none transition-all shadow-sm ${
                                                    pedido.estado === 'PENDIENTE' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                                    pedido.estado === 'EN TIENDA' ? 'bg-sky-50 text-sky-600 border-sky-200' :
                                                    pedido.estado === 'DESPACHADO' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                                    'bg-slate-50 text-slate-600 border-slate-200'
                                                }`}
                                            >
                                                <option value="PENDIENTE">PENDIENTE</option>
                                                <option value="EN TIENDA">EN TIENDA</option>
                                                <option value="DESPACHADO">DESPACHADO</option>
                                            </select>
                                        </div>
                                        <button onClick={() => setExpandedPedido(expandedPedido === pedido.id ? null : pedido.id)} className="p-3 hover:bg-slate-50 rounded-2xl text-slate-300 hover:text-navy transition-all">{expandedPedido === pedido.id ? <ChevronUp size={24} /> : <ChevronDown size={24} />}</button>
                                    </div>
                                    {expandedPedido === pedido.id && (
                                        <div className="bg-slate-50/50 border-t p-8 animate-in slide-in-from-top-4">
                                            <table className="w-full text-[10px]">
                                                <thead className="text-slate-400 font-black uppercase tracking-widest">
                                                    <tr>
                                                        <th className="pb-4 text-left">Título / Editorial</th>
                                                        <th className="pb-4 text-center">Cant.</th>
                                                        <th className="pb-4 text-center">Estado</th>
                                                        <th className="pb-4 text-right">Valuación Bs</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-200">
                                                    {pedido.items.map(it => {
                                                        const prod = catalog[normalizeTitle(it.titulo)];
                                                        const pBs = prod?.precio_mayoreo_bs || prod?.precio_venta_bs || 0;
                                                        return (
                                                            <tr key={it.id} className="group">
                                                                <td className="py-3"><p className="font-bold text-navy group-hover:text-orange-600 transition-colors">{it.titulo}</p></td>
                                                                <td className="py-3 text-center font-black">{it.cantidad}</td>
                                                                <td className="py-3 text-center">
                                                                    {(() => {
                                                                        const est = it.estado || 'PENDIENTE';
                                                                        const isFloating = est === 'PENDIENTE' || est.startsWith('CONFIRMADO') || est.startsWith('PEDIDO');
                                                                        const showETA = isFloating && est !== 'EN TIENDA' && est !== 'DESPACHADO' && est !== 'RECORTADO';

                                                                        let badgeClass = 'bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/20'; 
                                                                        if (it.fuente === 'stock') {
                                                                            badgeClass = 'bg-orange-500/10 border border-orange-500/30 text-orange-500 shadow-sm shadow-orange-500/10';
                                                                        } else if (est === 'RECORTADO') {
                                                                            badgeClass = 'bg-red-500/10 border-red-500/30 text-red-500 animate-pulse';
                                                                        } else if (est === 'EN TIENDA') {
                                                                            badgeClass = 'bg-success/10 border-success/30 text-success shadow-sm shadow-success/20';
                                                                        } else if (est === 'DESPACHADO' || est === 'ENTREGADO') {
                                                                            badgeClass = 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 shadow-sm shadow-emerald-500/20';
                                                                        } else if (est.includes('ESPAÑA')) {
                                                                            badgeClass = 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-sm shadow-purple-500/20';
                                                                        } else if (est.includes('TRÁNSITO')) {
                                                                            badgeClass = 'bg-orange-400/10 border-orange-400/30 text-orange-400 shadow-sm shadow-orange-500/20';
                                                                        } else if (est.startsWith('CONFIRMADO') || est.startsWith('ADJUDICADO')) {
                                                                            badgeClass = 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-sm shadow-blue-500/20';
                                                                        }

                                                                        let dateStr = null;
                                                                        if (showETA && pedido.semana) {
                                                                            const d = pedido.semana.fecha_estimada_llegada 
                                                                                ? new Date(pedido.semana.fecha_estimada_llegada) 
                                                                                : new Date(new Date(pedido.created_at).getTime() + (22*24*60*60*1000));
                                                                            dateStr = d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
                                                                        }

                                                                        return (
                                                                            <div className="flex flex-col items-center gap-0.5">
                                                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wide border transition-colors whitespace-nowrap ${badgeClass}`}>
                                                                                    {it.fuente === 'stock' ? '🏠 EN TIENDA (STOCK)' : est}
                                                                                </span>
                                                                                {dateStr && <span className="text-[8px] text-slate-400 font-bold italic opacity-70">Est. ~{dateStr}</span>}
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </td>
                                                                <td className="py-3 text-right font-black text-slate-600">
                                                    <div className="flex flex-col items-end gap-1">
                                                        <span>Bs {(pBs * it.cantidad).toLocaleString()}</span>
                                                        {/* Botón para mover item PEDIDO (Siguiente) a semana confirmada */}
                                                        {it.fuente !== 'stock' && (it.estado || '').startsWith('PEDIDO') && (
                                                            <button
                                                                onClick={() => { setAdjudicarModal({ item: it, pedido: pedido }); setAdjudicarSemanaId(''); }}
                                                                className="text-[8px] font-black text-blue-600 hover:text-white hover:bg-blue-500 border border-blue-300 hover:border-blue-500 px-2 py-0.5 rounded transition-all whitespace-nowrap"
                                                            >
                                                                📋 Adjudicar semana
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="py-32 text-center space-y-6">
                    <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mx-auto text-slate-200 shadow-inner"><Store size={48} /></div>
                    <p className="text-slate-300 font-black uppercase tracking-[0.3em] text-xs">Selecciona un Socio Mayorista</p>
                </div>
            )}

            {/* Modal Pago */}
            {showPagoModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-md p-6">
                    <div className="bg-white w-full max-w-md rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300 border border-white/20">
                        <div className="p-8 bg-navy text-white flex justify-between items-center shadow-lg">
                            <h4 className="text-xl font-black uppercase tracking-tighter">Registrar Ingreso</h4>
                            <button onClick={() => setShowPagoModal(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><X size={24} /></button>
                        </div>
                        <div className="p-10 space-y-8">
                            {/* Chip de saldo restante */}
                            {(() => {
                                const saldoRestante = balance.totalDeuda - balance.totalPagado;
                                if (saldoRestante <= 0) return null;
                                return (
                                    <div className="bg-orange-50 border border-orange-200 rounded-2xl px-5 py-3 flex items-center justify-between">
                                        <div>
                                            <p className="text-[9px] font-black text-orange-500 uppercase tracking-widest">Saldo pendiente del cliente</p>
                                            <p className="text-xl font-black text-orange-700 font-mono">Bs {saldoRestante.toLocaleString()}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => setPagoForm(f => ({ ...f, monto: saldoRestante.toFixed(2) }))}
                                            className="text-[9px] font-black text-orange-600 hover:text-white hover:bg-orange-500 uppercase tracking-widest border border-orange-300 hover:border-orange-500 px-3 py-1.5 rounded-xl transition-all whitespace-nowrap"
                                        >
                                            Saldar Cuenta
                                        </button>
                                    </div>
                                );
                            })()}
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-3">Monto de Cobro (Bs)</label>
                                <input type="number" value={pagoForm.monto} onChange={(e)=>setPagoForm({...pagoForm, monto: e.target.value})} placeholder="0.00" className="w-full px-6 py-5 bg-slate-50 border-2 border-slate-100 rounded-3xl text-2xl font-black text-navy focus:border-orange-500 focus:bg-white outline-none transition-all shadow-inner" />
                                {/* Chip informativo según el monto ingresado vs. la deuda */}
                                {(() => {
                                    const montoNum = Number(pagoForm.monto);
                                    const saldoRestante = balance.totalDeuda - balance.totalPagado;
                                    const exceso = montoNum - saldoRestante;
                                    if (montoNum <= 0 || saldoRestante <= 0) return null;

                                    // Redondeo menor a Bs 1 → verde, se absorbe, contabilidad recibe el monto real
                                    if (exceso > 0 && exceso < 1) {
                                        return (
                                            <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 mt-2">
                                                <span className="text-emerald-500 text-base flex-shrink-0">✓</span>
                                                <div>
                                                    <p className="text-[10px] font-black text-emerald-700">
                                                        Cubre la deuda completa — el saldo quedará en Bs 0
                                                    </p>
                                                    <p className="text-[9px] text-emerald-600 opacity-70">
                                                        Redondeo de Bs {exceso.toFixed(2)} absorbido · Contabilidad registra Bs {montoNum.toLocaleString()}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    }

                                    // Exceso real ≥ Bs 1 → naranja, genera saldo a favor
                                    if (exceso >= 1) {
                                        return (
                                            <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-2.5 mt-2">
                                                <span className="text-amber-500 text-base flex-shrink-0">⚠</span>
                                                <div>
                                                    <p className="text-[10px] font-black text-amber-700">
                                                        El pago genera un saldo a favor de Bs {exceso.toFixed(2)}
                                                    </p>
                                                    <p className="text-[9px] text-amber-600 opacity-70">
                                                        Si no querés generar crédito, usá el botón "Saldar Cuenta" de arriba.
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return null;
                                })()}
                            </div>
                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-3">Fecha</label>
                                    <input type="date" value={pagoForm.fecha} onChange={(e)=>setPagoForm({...pagoForm, fecha: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-[11px] font-black text-navy outline-none" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-3">Método</label>
                                    <select value={pagoForm.metodo} onChange={(e)=>setPagoForm({...pagoForm, metodo: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-[11px] font-black text-navy outline-none">
                                        <option value="Efectivo">Efectivo</option>
                                        <option value="Yasta (QR)">Yasta (QR)</option>
                                        <option value="Banco Unión (QR/Transf)">Banco Unión (QR/Transf)</option>
                                        <option value="BNB">BNB</option>
                                        <option value="Transferencia">Transferencia</option>
                                        <option value="Otros">Otros</option>
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-3">Observaciones</label>
                                <textarea value={pagoForm.notas} onChange={(e)=>setPagoForm({...pagoForm, notas: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border-2 border-slate-100 rounded-2xl text-xs font-bold outline-none h-24 resize-none" placeholder="Referencia de transferencia, etc..." />
                            </div>
                            <button onClick={handleSavePago} disabled={processing} className="w-full py-6 bg-navy text-white rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-navy/90 hover:scale-105 active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-4">
                                {processing ? <Loader2 className="animate-spin" /> : <Save size={20} />} REGISTRAR Y VINCULAR CAJA
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Modal: Adjudicar ítem en semana ── */}
            {adjudicarModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 flex flex-col gap-5">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-black text-navy">Adjudicar en Semana</h3>
                            <button onClick={() => setAdjudicarModal(null)} className="text-slate-400 hover:text-navy transition-colors">✕</button>
                        </div>

                        <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
                            <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-0.5">Ítem a adjudicar</p>
                            <p className="font-black text-navy text-sm">{adjudicarModal.item.titulo}</p>
                            <p className="text-[10px] text-slate-500">{adjudicarModal.item.cantidad} unid. · Estado actual: <span className="font-bold text-orange-500">{adjudicarModal.item.estado}</span></p>
                        </div>

                        <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">
                                Semana de entrega confirmada
                            </label>
                            <select
                                value={adjudicarSemanaId}
                                onChange={e => setAdjudicarSemanaId(e.target.value)}
                                className="w-full px-4 py-3 border-2 border-slate-200 rounded-2xl text-sm font-bold outline-none focus:border-blue-400 transition-colors"
                            >
                                <option value="">-- Seleccionar semana --</option>
                                {semanas.map(s => (
                                    <option key={s.id} value={s.id}>{s.nombre}</option>
                                ))}
                            </select>
                        </div>

                        {adjudicarSemanaId && (
                            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-2.5 text-[10px] text-emerald-700 font-bold">
                                ✓ El ítem se moverá al pedido de <strong>{semanas.find(s => s.id === adjudicarSemanaId)?.nombre}</strong> con estado <strong>CONFIRMADO</strong>
                            </div>
                        )}

                        <div className="flex gap-3 pt-1">
                            <button
                                onClick={() => setAdjudicarModal(null)}
                                className="flex-1 px-4 py-3 rounded-2xl border border-slate-200 text-slate-500 font-black text-sm hover:bg-slate-50 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAdjudicarEnSemana}
                                disabled={!adjudicarSemanaId || adjudicarLoading}
                                className="flex-1 px-4 py-3 rounded-2xl bg-blue-600 text-white font-black text-sm hover:bg-blue-700 disabled:opacity-40 transition-all"
                            >
                                {adjudicarLoading ? '...' : '✓ Confirmar Adjudicación'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
