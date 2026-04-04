import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { Search, Plus, ShoppingBag, CheckSquare, MessageCircle, ChevronDown, ChevronUp, Trash2, Edit2, Check, X, Box, RefreshCw, Info } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function ClientOrdersView() {
    const { user, isAdmin } = useAuth();
    const [loading, setLoading] = useState(true);
    const [catalog, setCatalog] = useState([]);
    
    // Datos BD
    const [clientes, setClientes] = useState([]);
    const [items, setItems] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [semanas, setSemanas] = useState([]);

    // Controles vista
    const [view, setView] = useState('clientes'); // 'clientes' | 'items' | 'hoja'
    const [search, setSearch] = useState('');
    const [filterEstado, setFilterEstado] = useState('todos'); // 'todos' | 'PEDIDO' | 'CONFIRMADO' | 'EN TIENDA' | 'ENTREGADO'
    const [expandedCliente, setExpandedCliente] = useState(new Set());
    const [selectedSemanaHoja, setSelectedSemanaHoja] = useState('');

    // Modales
    const [showAddModal, setShowAddModal] = useState(false);
    const [showPayModal, setShowPayModal] = useState(null); // cliente_id
    const [showWhatsAppMenu, setShowWhatsAppMenu] = useState(null); // cliente_id

    // Formulario Nuevo Pedido
    const [addForm, setAddForm] = useState({
        celular: '', nombre: '', direccion: '', notas_cliente: '',
        semana_id: '', mode: 'individual',
        // individual
        titulo: '', product_id: '', precio_venta: '', monto_pagado: '', nota_item: '',
        // coleccion
        coleccion_nombre: '', tomos: '', precio_tomo: '', pago_inicial_total: ''
    });

    const [catalogSuggestions, setCatalogSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    
    // Asignación Dinámica
    const [stockAnalysis, setStockAnalysis] = useState(null); // { fisico: int, flotantes: [{semana_id, nombre, qty, fechaArribo}] }
    const [selectedStockSource, setSelectedStockSource] = useState(''); // 'fisico' | 'flotante_ID' | 'pedido_ID'
    
    // Carrito de la venta actual
    const [cart, setCart] = useState([]);

    // Formulario Pagos
    const [payMode, setPayMode] = useState('items'); // 'items' | 'general'
    const [selectedPayItems, setSelectedPayItems] = useState([]);
    const [payMonto, setPayMonto] = useState('');
    const [pagoConcepto, setPagoConcepto] = useState('');
    const [reprogrammingItem, setReprogrammingItem] = useState(null);

    useEffect(() => {
        fetchData();
        fetchCatalog();
    }, []);

    const fetchCatalog = async () => {
        try {
            const data = await catalogService.fetchFullCatalog();
            setCatalog(data || []);
        } catch (error) {
            console.error("Error loading catalog:", error);
        }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const [clientesRes, itemsRes, pagosRes, semanasRes] = await Promise.all([
                supabase.from('clientes').select('*').order('created_at', { ascending: false }),
                supabase.from('cliente_items').select('*, clientes(*)').order('created_at', { ascending: false }),
                supabase.from('cliente_pagos').select('*'),
                supabase.from('semanas').select('*').order('created_at', { ascending: false })
            ]);

            if (clientesRes.error) throw clientesRes.error;
            if (itemsRes.error) throw itemsRes.error;
            if (pagosRes.error) throw pagosRes.error;

            setClientes(clientesRes.data || []);
            setItems(itemsRes.data || []);
            setPagos(pagosRes.data || []);
            setSemanas(semanasRes.data || []);
        } catch (error) {
            console.error("Error fetching data:", error);
            alert("Error al cargar datos. Actualiza la página.");
        } finally {
            setLoading(false);
        }
    };

    // Helper: Parsear Tomos "1-5,7" -> [1,2,3,4,5,7]
    const parseTomos = (str) => {
        if (!str) return [];
        const result = new Set();
        const parts = str.split(',').map(s => s.trim());
        for (let part of parts) {
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(Number);
                if (!isNaN(start) && !isNaN(end) && start <= end) {
                    for (let i = start; i <= end; i++) result.add(i);
                }
            } else {
                const num = Number(part);
                if (!isNaN(num)) result.add(num);
            }
        }
        return Array.from(result).sort((a,b)=>a-b);
    };

    const handleSearchCatalog = (val) => {
        setAddForm({ ...addForm, titulo: val });
        if (val.length > 2) {
            const lower = val.toLowerCase();
            const matches = catalog.filter(c => c.titulo.toLowerCase().includes(lower)).slice(0, 8);
            setCatalogSuggestions(matches);
            setShowSuggestions(true);
        } else {
            setCatalogSuggestions([]);
            setShowSuggestions(false);
        }
    };

    const selectSuggestion = async (item) => {
        setAddForm({ 
            ...addForm, 
            titulo: item.titulo, 
            catalog_id: item.id,
            product_id: item.product_id,
            precio_venta: item.precio_venta_bs || item.precio_tapa || '' 
        });
        setShowSuggestions(false);
        setStockAnalysis(null);
        setSelectedStockSource('');
        
        // Analyze Stock dynamically
        try {
            const { data: masters } = await supabase.from('master_confirmaciones').select('semana_id, datos_json');
            const { data: recs } = await supabase.from('pedido_items_recepcion').select('semana_id, titulo, cantidad_recibida').eq('titulo', item.titulo);
            // Fetch unconfirmed store requests to calculate unconfirmed floating stock
            const { data: allOrders } = await supabase.from('pedido_items').select('cantidad, titulo, pedido:pedidos!inner(semana_id, tipo)').eq('titulo', item.titulo);
            
            const flotantes = [];
            const pTitle = item.titulo.toLowerCase().trim();
            
            semanas.forEach(w => {
                const master = masters?.find(m => m.semana_id === w.id);
                const isConfirmed = !!master;
                let qtyFlot = 0;

                if (isConfirmed) {
                    const totalConf = (master.datos_json || [])
                        .filter(i => (i.titulo||'').toLowerCase().trim() === pTitle)
                        .reduce((s,i) => s + (i.cantidad||0), 0);
                        
                    const sellerRequested = (allOrders || [])
                        .filter(p => (p.titulo||'').toLowerCase().trim() === pTitle && p.pedido.tipo === 'personal' && p.pedido.semana_id === w.id)
                        .reduce((s,p) => s + (p.cantidad||0), 0);

                    const totalRec = (recs || [])
                        .filter(r => r.semana_id === w.id)
                        .reduce((s,r) => s + (r.cantidad_recibida||0), 0);
                    
                    const clientReserved = items.filter(it => 
                        (it.titulo || '').toLowerCase().trim() === pTitle && 
                        it.semana_id === w.id && 
                        it.estado === `CONFIRMADO ${w.nombre}`
                    ).length;
                        
                    qtyFlot = Math.max(0, (totalConf - sellerRequested) - totalRec - clientReserved);
                } else {
                    // Not confirmed yet: show the full "Tienda" request for this item
                    const storeTotal = (allOrders || [])
                        .filter(p => (p.titulo||'').toLowerCase().trim() === pTitle && p.pedido.tipo === 'tienda' && p.pedido.semana_id === w.id)
                        .reduce((s,p) => s + (p.cantidad||0), 0);
                    
                    const clientWaitlist = items.filter(it => 
                        (it.titulo || '').toLowerCase().trim() === pTitle && 
                        it.semana_id === w.id && 
                        it.estado === `PEDIDO ${w.nombre}`
                    ).length;

                    qtyFlot = Math.max(0, storeTotal - clientWaitlist);
                }
                
                if (qtyFlot > 0) {
                    const d = w.fecha_estimada_llegada ? new Date(w.fecha_estimada_llegada) : new Date(new Date(w.created_at).getTime() + (22*24*60*60*1000));
                    flotantes.push({ semana_id: w.id, nombre: w.nombre, qty: qtyFlot, fechaArribo: d, isConfirmed });
                }
            });
            
            setStockAnalysis({ fisico: item.stock_fisico || 0, flotantes });
            
            // Auto-select logical default
            if (item.stock_fisico > 0) {
                setSelectedStockSource('fisico');
            } else if (flotantes.length > 0) {
                const first = flotantes[0];
                const sourceId = first.isConfirmed ? `flotante_conf_${first.semana_id}` : `flotante_noc_${first.semana_id}`;
                setSelectedStockSource(sourceId);
            }
        } catch (e) {
            console.error("Error analyzing stock:", e);
        }
    };

    const formatS = (num) => Number(num).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const renderStatus = (it) => {
        const week = semanas.find(s => s.id === it.semana_id);
        const isFloating = it.estado.startsWith('CONFIRMADO') || it.estado.startsWith('PEDIDO');
        let dateStr = null;
        if (isFloating && week) {
            const d = week.fecha_estimada_llegada ? new Date(week.fecha_estimada_llegada) : new Date(new Date(week.created_at).getTime() + (22*24*60*60*1000));
            dateStr = d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
        }

        return (
            <div className="flex flex-col items-center gap-0.5">
                <span 
                    onClick={()=>setEditingState(it.id)}
                    className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider cursor-pointer border transition-colors ${
                        it.estado === 'RECORTADO' ? 'bg-red-500/10 border-red-500/30 text-red-500 shadow-sm animate-pulse' :
                        it.estado === 'ENTREGADO' ? 'bg-background/50 border-border text-muted' : 
                        it.estado === 'EN TIENDA' ? 'bg-success/10 border-success/30 text-success shadow-sm shadow-success/20' :
                        it.estado === 'ADJUDICADO' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/20' :
                        it.estado.startsWith('CONFIRMADO') ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-sm shadow-blue-500/20' :
                        'bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/20'
                    }`}
                >
                    {it.estado}
                </span>
                {it.estado === 'RECORTADO' && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); setReprogrammingItem(it); }}
                        className="mt-1 text-[9px] font-black bg-navy text-white px-2 py-0.5 rounded hover:bg-secondary transition-colors"
                    >
                        RE-PROGRAMAR
                    </button>
                )}
                {dateStr && it.estado !== 'RECORTADO' && <span className="text-[9px] text-muted font-bold italic tracking-tight whitespace-nowrap opacity-80">Est. ~{dateStr}</span>}
            </div>
        );
    };

    const addToCart = () => {
        if (addForm.mode === 'individual') {
            if (!addForm.titulo) return alert("Título obligatorio");
            if (!selectedStockSource) return alert("Selecciona origen de stock");
            
            let targetSemanaId = null;
            let estadoTarget = 'PEDIDO';
            
            if (selectedStockSource === 'fisico') {
                estadoTarget = 'EN TIENDA';
            } else if (selectedStockSource.startsWith('flotante_conf_')) {
                targetSemanaId = selectedStockSource.replace('flotante_conf_', '');
                const wName = semanas.find(s=>s.id === targetSemanaId)?.nombre || '';
                estadoTarget = `CONFIRMADO ${wName}`;
            } else if (selectedStockSource.startsWith('flotante_noc_')) {
                targetSemanaId = selectedStockSource.replace('flotante_noc_', '');
                const wName = semanas.find(s=>s.id === targetSemanaId)?.nombre || '';
                estadoTarget = `PEDIDO ${wName}`;
            } else if (selectedStockSource.startsWith('pedido_')) {
                targetSemanaId = selectedStockSource.replace('pedido_', '');
                const wName = semanas.find(s=>s.id === targetSemanaId)?.nombre || '';
                estadoTarget = `PEDIDO ${wName}`;
            }

            setCart([...cart, {
                titulo: addForm.titulo,
                catalog_id: addForm.catalog_id,
                product_id: addForm.product_id,
                semana_id: targetSemanaId,
                precio_venta: Number(addForm.precio_venta) || 0,
                monto_pagado: Number(addForm.monto_pagado) || 0,
                estado: estadoTarget,
                nota: addForm.nota_item,
                source: selectedStockSource
            }]);

            // Reset only item fields
            setAddForm({ ...addForm, titulo: '', catalog_id: '', product_id: '', precio_venta: '', monto_pagado: '', nota_item: '' });
            setStockAnalysis(null);
            setSelectedStockSource('');
        } else {
            const tomosArr = parseTomos(addForm.tomos);
            if (tomosArr.length === 0) return alert("No se pudo parsear tomos");
            
            const activeSemana = addForm.semana_id || null;
            const estadoBase = activeSemana ? `PEDIDO ${semanas.find(s=>s.id===activeSemana)?.nombre || ''}` : 'PEDIDO'; 
            
            let abonoIndividual = 0;
            let abonoTotal = Number(addForm.pago_inicial_total) || 0;
            if (abonoTotal > 0) abonoIndividual = abonoTotal / tomosArr.length;

            const newItems = tomosArr.map(t => {
                const padTomo = t.toString().padStart(2, '0');
                const tituloGenerado = `${addForm.coleccion_nombre} ${padTomo}`.trim().toUpperCase();
                const catMatch = catalog.find(c => c.titulo.toUpperCase().trim() === tituloGenerado);
                
                return {
                    titulo: tituloGenerado,
                    catalog_id: catMatch ? catMatch.id : null,
                    product_id: catMatch ? catMatch.product_id : null,
                    semana_id: activeSemana,
                    precio_venta: Number(addForm.precio_tomo) || 0,
                    monto_pagado: abonoIndividual,
                    estado: estadoBase,
                    nota: `Colección autogenerada`,
                    source: 'pedido_' + activeSemana
                };
            });

            setCart([...cart, ...newItems]);
            setAddForm({ ...addForm, coleccion_nombre: '', tomos: '', precio_tomo: '', pago_inicial_total: '' });
        }
    };

    const removeFromCart = (index) => {
        setCart(cart.filter((_, i) => i !== index));
    };

    const handleSaveOrder = async () => {
        if (!addForm.celular) return alert("El celular es obligatorio");
        if (cart.length === 0) return alert("El carrito está vacío. Añade al menos un ítem.");

        try {
            setLoading(true);
            // 1. Check or Create Client
            let clienteId = null;
            let cliMatch = clientes.find(c => c.celular === addForm.celular);
            if (cliMatch) {
                clienteId = cliMatch.id;
            } else {
                if (!addForm.nombre) return alert("Para nuevo celular, ingrese un nombre");
                const { data: newCli, error: cliErr } = await supabase.from('clientes').insert([{
                    nombre: addForm.nombre,
                    celular: addForm.celular,
                    direccion: addForm.direccion,
                    notas: addForm.notas_cliente
                }]).select().single();
                if (cliErr) throw cliErr;
                clienteId = newCli.id;
            }

            // 2. Process Cart and Prepare Insert Items (Don't subtract stock yet!)
            const itemsToInsert = [];
            
            for (let cItem of cart) {
                itemsToInsert.push({
                    cliente_id: clienteId,
                    titulo: cItem.titulo,
                    product_id: cItem.product_id || null, 
                    catalog_id: cItem.catalog_id || null,
                    semana_id: cItem.semana_id,
                    precio_venta: cItem.precio_venta,
                    monto_pagado: cItem.monto_pagado,
                    estado: cItem.estado,
                    nota: cItem.nota,
                    vendedor_id: user?.id
                });
            }

            // 3. Insert Items FIRST
            const { error: insErr } = await supabase.from('cliente_items').insert(itemsToInsert);
            if (insErr) throw insErr;

            // 4. ONLY IF SUCCESSFUL, subtract physical stock
            for (let cItem of cart) {
                if (cItem.source === 'fisico') {
                    const lookupCol = cItem.catalog_id ? 'id' : (cItem.product_id ? 'product_id' : null);
                    const lookupVal = cItem.catalog_id || cItem.product_id;
                    
                    if (lookupCol && lookupVal) {
                        const { data: prod } = await supabase.from('catalogo_productos')
                            .select('id, stock_fisico')
                            .eq(lookupCol, lookupVal)
                            .maybeSingle();
                        
                        if (prod && (prod.stock_fisico || 0) > 0) {
                            await supabase.from('catalogo_productos')
                                .update({ stock_fisico: prod.stock_fisico - 1 })
                                .eq('id', prod.id);
                        }
                    }
                }
            }
            
            // Invalidar memoria caché del catálogo para que los cambios se vean de inmediato
            if (typeof catalogService !== 'undefined') catalogService.clearCache();
            
            setShowAddModal(false);
            setCart([]);
            setAddForm({
                celular: '', nombre: '', direccion: '', notas_cliente: '',
                semana_id: '', mode: 'individual',
                titulo: '', product_id: '', precio_venta: '', monto_pagado: '', nota_item: '',
                coleccion_nombre: '', tomos: '', precio_tomo: '', pago_inicial_total: ''
            });
            await fetchData();
            await fetchCatalog();
            
            // Invalidar memoria caché del catálogo para que los cambios se vean de inmediato
            if (typeof catalogService !== 'undefined') catalogService.clearCache();

        } catch (e) {
            console.error(e);
            alert("Error al guardar pedido: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSavePayment = async (clienteId) => {
        try {
            setLoading(true);
            const amt = Number(payMonto);
            if (amt <= 0) return alert("Monto inválido");

            if (payMode === 'general') {
                const { error: pErr } = await supabase.from('cliente_pagos').insert([{
                    cliente_id: clienteId,
                    monto: amt,
                    concepto: pagoConcepto || 'Abono general',
                    vendedor_id: user?.id
                }]);
                if (pErr) throw pErr;
            } else {
                if (selectedPayItems.length === 0) return alert("Seleccione al menos un ítem");
                const splitAmt = amt / selectedPayItems.length;
                
                // Fetch current state to increment
                const itemsToUpdate = items.filter(i => selectedPayItems.includes(i.id));
                for (let eq of itemsToUpdate) {
                    const nuevoMonto = (Number(eq.monto_pagado) || 0) + splitAmt;
                    let nuevoEstado = eq.estado;
                    // Auto-Lista si paga completo y estaba en PEDIDO/CONFIRMADO (Opcional, omitido por requerir Recepcion para "En Tienda")
                    // if (nuevoMonto >= eq.precio_venta && (eq.estado.startsWith('PEDIDO') || eq.estado.startsWith('CONFIRMADO'))) nuevoEstado = 'EN TIENDA';

                    await supabase.from('cliente_items').update({
                        monto_pagado: nuevoMonto,
                        estado: nuevoEstado
                    }).eq('id', eq.id);
                }
            }
            setShowPayModal(null);
            setPayMonto('');
            setPagoConcepto('');
            setSelectedPayItems([]);
            await fetchData();
        } catch (e) {
            console.error(e);
            alert("Error al registrar pago");
        } finally {
            setLoading(false);
        }
    };

    // Filtros y KPIs
    const displayItems = items.filter(it => {
        if (filterEstado !== 'todos' && !it.estado.startsWith(filterEstado)) return false;
        if (search) {
            const s = search.toLowerCase();
            return (it.titulo?.toLowerCase().includes(s) || it.clientes?.nombre?.toLowerCase().includes(s) || it.clientes?.celular?.includes(s));
        }
        return true;
    });

    const totalPedidos = items.filter(i => i.estado !== 'ENTREGADO').length;
    const ventasTotales = items.reduce((acc, i) => acc + (Number(i.precio_venta)||0), 0);
    const pagadoItems = items.reduce((acc, i) => acc + (Number(i.monto_pagado)||0), 0);
    const pagadoGral = pagos.reduce((acc, p) => acc + (Number(p.monto)||0), 0);
    const totalCobrado = pagadoItems + pagadoGral;
    const saldoPendiente = ventasTotales - totalCobrado;

    const [editingState, setEditingState] = useState(null);

    // Grouping by client
    const groupedData = useMemo(() => {
        const groups = {};
        clientes.forEach(c => {
            groups[c.id] = { client: c, items: [], pagos: 0 };
        });
        displayItems.forEach(it => {
            if(groups[it.cliente_id]) groups[it.cliente_id].items.push(it);
        });
        pagos.forEach(p => {
            if(groups[p.cliente_id]) groups[p.cliente_id].pagos += Number(p.monto);
        });
        
        // Remove empty groups if filtering
        Object.keys(groups).forEach(k => {
            if(groups[k].items.length === 0 && (filterEstado !== 'todos' || search)) {
                delete groups[k];
            }
        });
        
        return Object.values(groups);
    }, [clientes, displayItems, pagos, filterEstado, search]);

    const sendWhatsApp = (client, type) => {
        const cliItems = items.filter(i => i.cliente_id === client.id);
        const cliPagos = pagos.filter(p => p.cliente_id === client.id).reduce((s,p)=>s+Number(p.monto), 0);
        const vTot = cliItems.reduce((s,i)=>s+Number(i.precio_venta), 0);
        const pItm = cliItems.reduce((s,i)=>s+Number(i.monto_pagado), 0);
        const deuda = vTot - (pItm + cliPagos);

        let msg = `Hola *${client.nombre}*, te escribimos de *MANGAS COMICS BOLIVIA*\n\n`;

        if (type === 'entrega') {
            const listos = cliItems.filter(i => i.estado === 'EN TIENDA');
            if(listos.length === 0) return alert("No hay ítems 'EN TIENDA' para este cliente.");
            msg += `¡Buenas noticias! Los siguientes ítems ya han llegado a tienda y están listos para recojo/envío:\n`;
            listos.forEach(i => msg += `📦 ${i.titulo}\n`);
            if (deuda > 0) msg += `\n*Saldo general adeudado:* BS ${formatS(deuda)}\n`;
        } else if (type === 'pago') {
            msg += `Queremos confirmarte que hemos registrado exitosamente tu pago/abono.\n\n`;
            msg += `*Monto general en tu cuenta:* BS ${formatS(cliPagos)}\n*Monto abonado a ítems:* BS ${formatS(pItm)}\n*Ventas totales:* BS ${formatS(vTot)}\n---\n*Saldo actual adeudado:* BS ${formatS(deuda)}\n`;
        } else {
            msg += `Te compartimos el estado general de tus pedidos:\n\n`;
            cliItems.forEach(i => {
                let stat = i.estado;
                if(stat.startsWith('PEDIDO') || stat.startsWith('CONFIRMADO') || stat === 'ADJUDICADO') stat = '⏳ En tránsito';
                if(stat === 'EN TIENDA') stat = '✅ Listo para entrega';
                msg += `🔸 ${i.titulo} (${stat}) - Precio: BS ${formatS(i.precio_venta)}\n`;
            });
            msg += `\n*Saldo total adeudado:* BS ${formatS(deuda)}\n`;
            msg += `¡Gracias por tu preferencia!`;
        }

        const url = `https://wa.me/591${client.celular.replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`;
        window.open(url, '_blank');
        setShowWhatsAppMenu(null);
    };

    return (
        <div className="flex flex-col gap-6 animate-fade-in max-w-7xl mx-auto">
            {/* Header / KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex flex-col justify-center">
                    <span className="text-muted text-xs font-bold uppercase tracking-wider">Total Pedidos Activos</span>
                    <span className="text-2xl font-bold font-mono text-text">{totalPedidos}</span>
                </div>
                <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex flex-col justify-center">
                    <span className="text-muted text-xs font-bold uppercase tracking-wider">Proyección de Ventas</span>
                    <span className="text-2xl font-bold font-mono text-primary">BS {formatS(ventasTotales)}</span>
                </div>
                <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex flex-col justify-center">
                    <span className="text-muted text-xs font-bold uppercase tracking-wider">Cobrado / Asegurado</span>
                    <span className="text-2xl font-bold font-mono text-success">BS {formatS(totalCobrado)}</span>
                </div>
                <div className="bg-surface border border-border rounded-xl p-4 shadow-sm flex flex-col justify-center">
                    <span className="text-muted text-xs font-bold uppercase tracking-wider">Riesgo / Saldo Péndiente</span>
                    <span className="text-2xl font-bold font-mono text-error">BS {formatS(saldoPendiente)}</span>
                </div>
            </div>

            {/* Toolbox */}
            <div className="flex flex-col md:flex-row justify-between items-center bg-surface p-4 rounded-xl border border-border gap-4">
                <div className="flex bg-background rounded-lg p-1 border border-border">
                    <button onClick={()=>setView('clientes')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='clientes'?'bg-surface text-primary shadow-sm ring-1 ring-border/50':'text-muted hover:text-text'}`}>Por Cliente</button>
                    <button onClick={()=>setView('items')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='items'?'bg-surface text-primary shadow-sm ring-1 ring-border/50':'text-muted hover:text-text'}`}>Resumen Ítems</button>
                    <button onClick={()=>setView('hoja')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='hoja'?'bg-surface text-secondary shadow-sm ring-1 ring-border/50':'text-muted hover:text-text'}`}>📋 Hoja de Pedido</button>
                </div>
                
                <div className="flex-1 max-w-md w-full flex items-center bg-background border border-border rounded-lg px-3 py-2">
                    <Search size={18} className="text-muted mr-2" />
                    <input 
                        type="text" 
                        placeholder="Buscar cliente, celular o título..." 
                        className="bg-transparent border-none outline-none text-sm w-full text-text placeholder-muted"
                        value={search} onChange={e=>setSearch(e.target.value)}
                    />
                </div>

                <div className="flex items-center gap-3">
                    <select value={filterEstado} onChange={e=>setFilterEstado(e.target.value)} className="bg-background border border-border text-text text-sm rounded-lg px-3 py-2 outline-none">
                        <option value="todos">Todos los Estados</option>
                        <option value="PEDIDO">Pedidos (En Tránsito)</option>
                        <option value="CONFIRMADO">Confirmados</option>
                        <option value="ADJUDICADO">Adjudicados (Planificados)</option>
                        <option value="RECORTADO">Recortados (Sin Stock)</option>
                        <option value="EN TIENDA">En Tienda (Listos)</option>
                        <option value="ENTREGADO">Entregados</option>
                    </select>

                    <button onClick={() => setShowAddModal(true)} className="bg-primary text-primary-text font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20">
                        <Plus size={18} /> Nuevo Pedido
                    </button>
                </div>
            </div>

            {/* main list */}
            {loading ? (
                <div className="py-12 flex justify-center"><div className="animate-spin text-primary w-8 h-8 border-4 border-current border-t-transparent rounded-full" /></div>
            ) : view === 'clientes' ? (
                <div className="flex flex-col gap-4">
                    {groupedData.length === 0 && <div className="text-center py-10 text-muted">No se encontraron clientes o pedidos.</div>}
                    {groupedData.map(group => {
                        const isExp = expandedCliente.has(group.client.id);
                        const cVentas = group.items.reduce((s,i)=>s+Number(i.precio_venta), 0);
                        const cPagItems = group.items.reduce((s,i)=>s+Number(i.monto_pagado), 0);
                        const cDeuda = Math.max(0, cVentas - (cPagItems + group.pagos));

                        return (
                            <div key={group.client.id} className="bg-surface border border-border rounded-xl shadow-sm overflow-visible relative">
                                <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-white/5 transition-colors" onClick={()=> {
                                    const next = new Set(expandedCliente);
                                    if(isExp) next.delete(group.client.id); else next.add(group.client.id);
                                    setExpandedCliente(next);
                                }}>
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold font-display">
                                            {group.client.nombre[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-text mb-0.5">{group.client.nombre}</h3>
                                            <div className="text-xs text-muted font-mono">{group.client.celular} • {group.items.length} ítems</div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap lg:flex-nowrap items-center gap-4 lg:gap-8">
                                        <div className="text-right">
                                            <div className="text-[10px] uppercase font-bold text-muted">Total Ventas</div>
                                            <div className="font-mono text-sm font-bold text-text">BS {formatS(cVentas)}</div>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-[10px] uppercase font-bold text-muted">Pagado</div>
                                            <div className="font-mono text-sm font-bold text-success">BS {formatS(cPagItems + group.pagos)}</div>
                                        </div>
                                        <div className="text-right bg-error/10 px-3 py-1 rounded w-24">
                                            <div className="text-[10px] uppercase font-bold text-error">Saldo</div>
                                            <div className="font-mono text-sm font-bold text-error">BS {formatS(cDeuda)}</div>
                                        </div>

                                        <div className="flex items-center gap-2" onClick={e=>e.stopPropagation()}>
                                            <button onClick={()=>setShowPayModal(group.client.id)} className="bg-success text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-success/80 shadow-md">
                                                Abonar
                                            </button>
                                            
                                            <div className="relative">
                                                <button onClick={()=>setShowWhatsAppMenu(showWhatsAppMenu===group.client.id ? null : group.client.id)} className="bg-[#25D366] text-white px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1 hover:brightness-110 shadow-md">
                                                    <MessageCircle size={14} /> WhatsApp
                                                </button>
                                                {showWhatsAppMenu === group.client.id && (
                                                    <div className="absolute top-full right-0 mt-2 w-48 bg-surface border border-border rounded-lg shadow-xl py-1 z-50">
                                                        <button onClick={()=>sendWhatsApp(group.client, 'entrega')} className="w-full text-left px-3 py-2 text-xs hover:bg-background text-text">📦 Aviso de Entrega</button>
                                                        <button onClick={()=>sendWhatsApp(group.client, 'pago')} className="w-full text-left px-3 py-2 text-xs hover:bg-background text-text">💳 Confirmar Pago</button>
                                                        <button onClick={()=>sendWhatsApp(group.client, 'estado')} className="w-full text-left px-3 py-2 text-xs hover:bg-background text-text">📑 Estado General</button>
                                                    </div>
                                                )}
                                            </div>

                                            {isExp ? <ChevronUp size={20} className="text-muted ml-2" /> : <ChevronDown size={20} className="text-muted ml-2" />}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Table */}
                                {isExp && (
                                    <div className="border-t border-border bg-background p-4">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="text-left text-muted text-xs uppercase border-b border-border">
                                                        <th className="pb-2 pl-2">Título / Producto</th>
                                                        <th className="pb-2">P. Venta</th>
                                                        <th className="pb-2">Pagado</th>
                                                        <th className="pb-2">Saldo</th>
                                                        <th className="pb-2">Estado</th>
                                                        <th className="pb-2 min-w-[120px]">Nota</th>
                                                        <th className="pb-2"></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {group.items.map(it => {
                                                        const iDeuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                                        const isEd = editingState === it.id;
                                                        
                                                        return (
                                                            <tr key={it.id} className="border-b border-border/50 hover:bg-surface/50">
                                                                <td className="py-2 pl-2 font-medium text-text flex items-center gap-2">
                                                                    <Box size={14} className="text-primary opacity-50" />
                                                                    {it.titulo}
                                                                </td>
                                                                <td className="py-2 font-mono">BS {formatS(it.precio_venta)}</td>
                                                                <td className="py-2 font-mono text-success">BS {formatS(it.monto_pagado)}</td>
                                                                <td className="py-2 font-mono text-error font-bold">BS {formatS(iDeuda)}</td>
                                                                <td className="py-2">
                                                                    {isEd ? (
                                                                        <input 
                                                                            type="text" 
                                                                            className="bg-transparent border border-primary text-xs px-2 py-1 rounded w-32 outline-none" 
                                                                            defaultValue={it.estado}
                                                                            onKeyDown={async(e)=>{
                                                                                if(e.key === 'Enter') {
                                                                                    await supabase.from('cliente_items').update({estado: e.target.value.toUpperCase()}).eq('id', it.id);
                                                                                    setEditingState(null);
                                                                                    fetchData();
                                                                                } else if (e.key === 'Escape') setEditingState(null);
                                                                            }}
                                                                            autoFocus
                                                                            onBlur={()=>setEditingState(null)}
                                                                        />
                                                                    ) : (
                                                                        renderStatus(it)
                                                                    )}
                                                                </td>
                                                                <td className="py-2 text-[11px] text-muted max-w-[150px] truncate" title={it.nota}>{it.nota || '-'}</td>
                                                                <td className="py-2 text-right">
                                                                    <button onClick={async()=>{
                                                                        if(confirm('¿Eliminar este ítem del pedido?')) {
                                                                            // Restore stock if it was physically in store
                                                // Restore stock if it was physically in store or already ordered to provider
                                                let shouldRestore = false;
                                                if ((it.estado === 'EN TIENDA' || it.estado === 'ADJUDICADO') && (it.catalog_id || it.product_id)) {
                                                    shouldRestore = true;
                                                } else if (it.estado === 'RESERVA' && it.semana_id) {
                                                    // If reservation, check if week is already "Ordered" or "Received"
                                                    const { data: sem } = await supabase.from('semanas').select('estado').eq('id', it.semana_id).maybeSingle();
                                                    if (sem && (sem.estado === 'PEDIDA' || sem.estado === 'RECIBIDA')) {
                                                        shouldRestore = true;
                                                        console.log(`📦 Semana ${sem.estado}: devolviendo unidad a stock físico (era preventa consolidada).`);
                                                    }
                                                }

                                                if (shouldRestore && (it.catalog_id || it.product_id)) {
                                                    const lookupCol = it.catalog_id ? 'id' : 'product_id';
                                                    const lookupVal = it.catalog_id || it.product_id;
                                                    const { data: prod } = await supabase.from('catalogo_productos').select('id, stock_fisico').eq(lookupCol, lookupVal).maybeSingle();
                                                    if (prod) {
                                                        await supabase.from('catalogo_productos').update({ stock_fisico: (prod.stock_fisico || 0) + 1 }).eq('id', prod.id);
                                                        if (typeof catalogService !== 'undefined') catalogService.clearCache();
                                                    }
                                                }
                                                                            await supabase.from('cliente_items').delete().eq('id', it.id);
                                                                            await fetchData();
                                                                            await fetchCatalog();
                                                                        }
                                                                    }} className="text-muted hover:text-error p-1"><Trash2 size={14}/></button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            ) : view === 'hoja' ? (
                <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xl animate-in slide-in-from-bottom-4 duration-500">
                    <div className="p-6 border-b border-border bg-gradient-to-r from-secondary/5 to-transparent flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h3 className="text-xl font-bold text-text flex items-center gap-2">
                                <Box className="text-secondary" size={24} /> 
                                Hoja de Pedido Consolidada
                            </h3>
                            <p className="text-sm text-muted mt-1">Usa esta lista para llenar tu Excel de la semana de forma exacta.</p>
                        </div>
                        <div className="flex items-center gap-2 bg-background p-1.5 rounded-xl border border-border">
                            <span className="text-[10px] font-black uppercase text-muted px-2">Semana:</span>
                            <select 
                                value={selectedSemanaHoja} 
                                onChange={e => setSelectedSemanaHoja(e.target.value)}
                                className="bg-transparent text-sm font-bold outline-none pr-4"
                            >
                                <option value="">-- Seleccionar Semana --</option>
                                {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-muted/50 text-muted uppercase text-[10px] font-black tracking-widest border-b border-border">
                                    <th className="px-6 py-4">Título del Manga / Cómic</th>
                                    <th className="px-6 py-4 text-center">Unidades Pedidas</th>
                                    <th className="px-6 py-4 text-center">Estado sugerido</th>
                                    <th className="px-6 py-4">Vendedor Responsable</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {(() => {
                                    const filtered = items.filter(i => {
                                        if (selectedSemanaHoja && i.semana_id !== selectedSemanaHoja) return false;
                                        if (!isAdmin && i.vendedor_id !== user?.id) return false;
                                        if (!i.titulo) return false;
                                        const term = search.toLowerCase();
                                        return i.titulo.toLowerCase().includes(term);
                                    });

                                    // Agrupar con seguridad nula
                                    const grouped = {};
                                    filtered.forEach(i => {
                                        const title = i.titulo || 'Sin Título';
                                        const key = title.toLowerCase().trim();
                                        if (!grouped[key]) grouped[key] = { titulo: title, count: 0, vendedores: new Set() };
                                        grouped[key].count++;
                                        if (i.vendedor_id) grouped[key].vendedores.add(i.vendedor_id);
                                    });

                                    const sorted = Object.values(grouped).sort((a,b) => b.count - a.count);

                                    if (sorted.length === 0) {
                                      return <tr><td colSpan="4" className="py-20 text-center text-muted italic">No hay ítems registrados para los filtros seleccionados.</td></tr>
                                    }

                                    return sorted.map((row, idx) => (
                                        <tr key={idx} className="hover:bg-muted/30 transition-colors group">
                                            <td className="px-6 py-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-text group-hover:text-secondary transition-colors">{row.titulo}</span>
                                                    <span className="text-[10px] text-muted uppercase mt-0.5">Categoría detectada: General</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-secondary/10 text-secondary font-black text-lg border border-secondary/20 shadow-inner">
                                                    {row.count}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="px-2 py-1 rounded bg-secondary/10 text-secondary text-[10px] font-bold border border-secondary/20 uppercase tracking-tighter">Pedido Cliente</span>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {Array.from(row.vendedores).map(vid => (
                                                        <span key={vid} className="text-[10px] bg-muted px-2 py-0.5 rounded text-muted-2 font-mono uppercase">
                                                            {vid === user?.id ? 'TÚ' : 'SOCIO'}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ));
                                })()}
                            </tbody>
                        </table>
                    </div>
                    
                    <div className="p-6 bg-muted/20 border-t border-border flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-secondary/20 flex items-center justify-center text-secondary shrink-0">
                            <Info size={20} />
                        </div>
                        <p className="text-xs text-muted leading-relaxed">
                            <strong className="text-text">Consejo Pro:</strong> Esta hoja resume los libros exactos que tus clientes ya te confirmaron y pagaron (o reservaron). Asegúrate de que tu Excel final tenga **como mínimo** estas cantidades para no dejar a nadie sin su pedido.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="bg-surface border border-border rounded-xl shadow-sm overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-muted text-xs uppercase border-b border-border bg-background">
                                <th className="p-4">Cliente</th>
                                <th className="p-4">Título</th>
                                <th className="p-4">P. Venta</th>
                                <th className="p-4">Cobrado</th>
                                <th className="p-4">Estado</th>
                                <th className="p-4 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayItems.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted">No hay ítems</td></tr>}
                            {displayItems.map(it => (
                                <tr key={it.id} className="border-b border-border/50 hover:bg-white/5">
                                    <td className="p-4">
                                        <div className="font-bold text-text">{it.clientes?.nombre}</div>
                                        <div className="text-xs text-muted">{it.clientes?.celular}</div>
                                    </td>
                                    <td className="p-4 font-medium">{it.titulo}</td>
                                    <td className="p-4 font-mono font-bold">BS {formatS(it.precio_venta)}</td>
                                    <td className="p-4 font-mono text-success">BS {formatS(it.monto_pagado)}</td>
                                    <td className="p-4 flex justify-center">
                                        {renderStatus(it)}
                                    </td>
                                    <td className="p-4 text-right">
                                        <button onClick={async()=>{
                                            if(confirm('¿Eliminar este ítem del pedido?')) {
                                                // Restore stock if it was physically in store
                                                // Restore stock if it was physically in store or already ordered to provider
                                                let shouldRestore = false;
                                                if ((it.estado === 'EN TIENDA' || it.estado === 'ADJUDICADO') && (it.catalog_id || it.product_id)) {
                                                    shouldRestore = true;
                                                } else if (it.estado === 'RESERVA' && it.semana_id) {
                                                    // If reservation, check if week is already "Ordered" or "Received"
                                                    const { data: sem } = await supabase.from('semanas').select('estado').eq('id', it.semana_id).maybeSingle();
                                                    if (sem && (sem.estado === 'PEDIDA' || sem.estado === 'RECIBIDA')) {
                                                        shouldRestore = true;
                                                        console.log(`📦 Semana ${sem.estado}: devolviendo unidad a stock físico (era preventa consolidada).`);
                                                    }
                                                }

                                                if (shouldRestore && (it.catalog_id || it.product_id)) {
                                                    const lookupCol = it.catalog_id ? 'id' : 'product_id';
                                                    const lookupVal = it.catalog_id || it.product_id;
                                                    const { data: prod } = await supabase.from('catalogo_productos').select('id, stock_fisico').eq(lookupCol, lookupVal).maybeSingle();
                                                    if (prod) {
                                                        await supabase.from('catalogo_productos').update({ stock_fisico: (prod.stock_fisico || 0) + 1 }).eq('id', prod.id);
                                                        if (typeof catalogService !== 'undefined') catalogService.clearCache();
                                                    }
                                                }
                                                await supabase.from('cliente_items').delete().eq('id', it.id);
                                                await fetchData();
                                                await fetchCatalog();
                                            }
                                        }} className="text-muted hover:text-error p-1 rotate-0 hover:rotate-12 transition-transform">
                                            <Trash2 size={16}/>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}


            {/* ADD MODAL */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-surface w-full max-w-2xl rounded-2xl border border-border flex flex-col max-h-[90vh]">
                        <div className="p-5 border-b border-border flex justify-between items-center bg-background rounded-t-2xl shrink-0">
                            <h2 className="text-lg font-bold font-display text-text flex items-center gap-2">
                                <Plus className="text-primary"/> Nueva Venta / Pedido
                            </h2>
                            <div className="flex items-center gap-4">
                                {cart.length > 0 && <span className="bg-primary text-background px-2 py-0.5 rounded text-[10px] font-bold animate-pulse">{cart.length} ITEMS EN CESTA</span>}
                                <button onClick={()=>{setShowAddModal(false); setCart([]);}} className="text-muted hover:text-text"><X size={20}/></button>
                            </div>
                        </div>
                        
                        <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-5">
                            {/* Cliente Bloque */}
                            <div className="bg-background border border-border p-4 rounded-xl flex flex-col gap-3">
                                <h3 className="text-xs font-bold uppercase text-muted tracking-wider">Datos del Cliente</h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] mb-1 text-muted">Celular *</label>
                                        <input type="text" value={addForm.celular} onChange={e=>{
                                            const val = e.target.value;
                                            const cli = clientes.find(c=>c.celular===val);
                                            if(cli) setAddForm({...addForm, celular:val, nombre:cli.nombre, direccion:cli.direccion||'', notas_cliente:cli.notas||''});
                                            else setAddForm({...addForm, celular:val});
                                        }} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-text outline-none focus:border-primary" placeholder="Ej: 71234567"/>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] mb-1 text-muted">Nombre *</label>
                                        <input type="text" value={addForm.nombre} onChange={e=>setAddForm({...addForm, nombre:e.target.value})} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-text outline-none focus:border-primary"/>
                                    </div>
                                </div>
                            </div>

                            {/* Detalle Producto */}
                            <div className="bg-background border border-border p-4 rounded-xl flex flex-col gap-3">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-xs font-bold uppercase text-muted tracking-wider">Detalles del Pedido</h3>
                                    <div className="flex bg-surface rounded p-0.5 border border-border">
                                        <button onClick={()=>setAddForm({...addForm, mode:'individual'})} className={`px-3 py-1 text-[11px] font-bold rounded-sm ${addForm.mode==='individual'?'bg-primary text-background':'text-muted'}`}>INDIVIDUAL</button>
                                        <button onClick={()=>setAddForm({...addForm, mode:'coleccion'})} className={`px-3 py-1 text-[11px] font-bold rounded-sm ${addForm.mode==='coleccion'?'bg-primary text-background':'text-muted'}`}>COLECCIÓN</button>
                                    </div>
                                </div>

                                {addForm.mode === 'coleccion' && (
                                    <div className="mb-2">
                                        <label className="block text-[11px] mb-1 text-muted">Semana de Importación</label>
                                        <select value={addForm.semana_id} onChange={e=>setAddForm({...addForm, semana_id:e.target.value})} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-text outline-none focus:border-primary">
                                            <option value="">No asignar / Stock Local</option>
                                            {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre} - {s.estado}</option>)}
                                        </select>
                                    </div>
                                )}

                                {addForm.mode === 'individual' ? (
                                    <div className="grid border-t border-border/50 pt-3 grid-cols-2 gap-3 relative">
                                        <div className="col-span-2 relative">
                                            <label className="block text-[11px] mb-1 text-primary font-bold">Título del Catálogo *</label>
                                            <input type="text" value={addForm.titulo} onChange={e=>handleSearchCatalog(e.target.value)} className="w-full bg-surface border border-primary px-3 py-2 rounded-lg text-sm text-text outline-none focus:ring-1 focus:ring-primary shadow-inner" placeholder="Escribe para buscar..."/>
                                            
                                            {showSuggestions && catalogSuggestions.length > 0 && (
                                                <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                                                    {catalogSuggestions.map((sg, i) => (
                                                        <div key={i} onClick={()=>selectSuggestion(sg)} className="p-2 border-b border-border/50 hover:bg-background cursor-pointer text-sm">
                                                            <div className="font-bold text-text">{sg.titulo}</div>
                                                            <div className="text-[10px] text-muted">{sg.editorial} | BS {sg.precio_venta_bs || sg.precio_tapa}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        
                                        {stockAnalysis && (
                                            <div className="col-span-2 bg-background border border-border rounded-xl p-3 flex flex-col gap-2">
                                                <h4 className="text-[10px] font-bold uppercase text-muted tracking-wider">Asignación de Inventario</h4>
                                                
                                                {/* Card Fisico */}
                                                <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedStockSource === 'fisico' ? 'bg-success/10 border-success' : 'border-border opacity-60 hover:opacity-100'}`}>
                                                    <input type="radio" name="stock_source" checked={selectedStockSource==='fisico'} onChange={()=>setSelectedStockSource('fisico')} className="accent-success w-4 h-4" disabled={stockAnalysis.fisico <= 0} />
                                                    <div className="flex-1">
                                                        <div className="text-sm font-bold text-success">Tomar de Stock Físico (En Tienda)</div>
                                                        <div className="text-xs text-muted">Disponible: {stockAnalysis.fisico} u. — Se marcará listo para entregar.</div>
                                                    </div>
                                                </label>

                                                {/* Cards Flotantes */}
                                                {stockAnalysis.flotantes.map((flot, idx) => {
                                                    const sourceId = flot.isConfirmed ? `flotante_conf_${flot.semana_id}` : `flotante_noc_${flot.semana_id}`;
                                                    return (
                                                    <label key={idx} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedStockSource === sourceId ? (flot.isConfirmed ? 'bg-blue-500/10 border-blue-500' : 'bg-purple-500/10 border-purple-500') : 'border-border opacity-70 hover:opacity-100'}`}>
                                                        <input type="radio" name="stock_source" checked={selectedStockSource===sourceId} onChange={()=>setSelectedStockSource(sourceId)} className={`w-4 h-4 ${flot.isConfirmed ? 'accent-blue-500' : 'accent-purple-500'}`} />
                                                        <div className="flex-1">
                                                            <div className={`text-sm font-bold ${flot.isConfirmed ? 'text-blue-400' : 'text-purple-400'}`}>Tomar de Stock Flotante ({flot.nombre})</div>
                                                            <div className="text-xs text-muted">
                                                                Reservado en tránsito ({flot.qty} u.) {flot.isConfirmed ? '✅ Confirmado' : '⏳ Aún NO Confirmado'} - Llegada: {flot.fechaArribo.toLocaleDateString('es-BO', {day:'numeric', month:'short'})}
                                                            </div>
                                                        </div>
                                                    </label>
                                                )})}

                                                {/* Nuevo Pedido Base */}
                                                <div className="mt-2 border-t border-border/50 pt-2">
                                                    <label className="block text-[11px] mb-1 text-muted">Realizar Nueva Importación / Pedido futuro</label>
                                                    <select value={selectedStockSource.startsWith('pedido_') ? selectedStockSource : ''} onChange={e=>setSelectedStockSource(e.target.value)} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-text outline-none">
                                                        <option value="" disabled>Seleccione semana objetivo...</option>
                                                        {semanas.slice(0, 3).map(s => {
                                                            const d = s.fecha_estimada_llegada ? new Date(s.fecha_estimada_llegada) : new Date(new Date(s.created_at).getTime() + (22*24*60*60*1000));
                                                            return <option key={s.id} value={`pedido_${s.id}`}>Encargar en {s.nombre} (Llega ~{d.toLocaleDateString('es-BO', {day:'numeric', month:'short'})})</option>
                                                        })}
                                                    </select>
                                                </div>
                                            </div>
                                        )}

                                        <div>
                                            <label className="block text-[11px] mb-1 text-muted">Precio Venta (BS) *</label>
                                            <input type="number" value={addForm.precio_venta} onChange={e=>setAddForm({...addForm, precio_venta:e.target.value})} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-text outline-none"/>
                                        </div>
                                        <div>
                                            <label className="block text-[11px] mb-1 text-muted">Abono Inicial (BS)</label>
                                            <input type="number" value={addForm.monto_pagado} onChange={e=>setAddForm({...addForm, monto_pagado:e.target.value})} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-success font-bold outline-none"/>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid border-t border-border/50 pt-3 grid-cols-2 gap-3">
                                        <div className="col-span-2">
                                            <label className="block text-[11px] mb-1 text-primary font-bold">Nombre Colección (Prefijo Catálogo) *</label>
                                            <input type="text" value={addForm.coleccion_nombre} onChange={e=>setAddForm({...addForm, coleccion_nombre:e.target.value})} className="w-full bg-surface border border-primary px-3 py-2 rounded-lg text-sm text-text outline-none" placeholder="Ej: NARUTO IVREA"/>
                                            <p className="text-[10px] text-muted mt-1">El sistema anexará automáticamente ' 01', ' 02' e intentará emparejar con el catálogo maestro.</p>
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-[11px] mb-1 text-muted">Rango de Tomos *</label>
                                            <input type="text" value={addForm.tomos} onChange={e=>setAddForm({...addForm, tomos:e.target.value})} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-text outline-none" placeholder="Ej: 1-5, 7, 9-12"/>
                                            {addForm.tomos && (
                                                <div className="text-[10px] text-primary mt-1 font-mono">
                                                    Generará: {parseTomos(addForm.tomos).length} tomos ({parseTomos(addForm.tomos).join(', ')})
                                                </div>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-[11px] mb-1 text-muted">Precio x Tomo (BS) *</label>
                                            <input type="number" value={addForm.precio_tomo} onChange={e=>setAddForm({...addForm, precio_tomo:e.target.value})} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-text outline-none"/>
                                        </div>
                                        <div>
                                            <label className="block text-[11px] mb-1 text-muted">Abono Total (se divide)</label>
                                            <input type="number" value={addForm.pago_inicial_total} onChange={e=>setAddForm({...addForm, pago_inicial_total:e.target.value})} className="w-full bg-surface border border-border px-3 py-2 rounded-lg text-sm text-success font-bold outline-none"/>
                                        </div>
                                    </div>
                                )}
                                
                                <button 
                                    onClick={addToCart}
                                    className="w-full bg-background border-2 border-primary text-primary font-black py-3 rounded-xl hover:bg-primary hover:text-background transition-all flex items-center justify-center gap-2 mt-2 shadow-sm"
                                >
                                    <Plus size={18}/> AÑADIR A ESTA VENTA
                                </button>
                            </div>

                            {/* Carrito Temporal */}
                            {cart.length > 0 && (
                                <div className="bg-background border border-border p-4 rounded-xl flex flex-col gap-3">
                                    <h3 className="text-xs font-bold uppercase text-primary tracking-wider flex items-center gap-2">
                                        <ShoppingBag size={14}/> Cesta de la Venta Actual
                                    </h3>
                                    <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-2">
                                        {cart.map((c, i) => (
                                            <div key={i} className="flex items-center justify-between bg-surface p-3 rounded-lg border border-border/50 group">
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-bold text-text truncate">{c.titulo}</div>
                                                    <div className="text-[10px] text-muted flex items-center gap-2">
                                                        <span className={`font-bold ${c.estado === 'EN TIENDA' ? 'text-success' : 'text-blue-400'}`}>[{c.estado}]</span>
                                                        <span>• BS {formatS(c.precio_venta)}</span>
                                                        {c.nota && <span>• {c.nota}</span>}
                                                    </div>
                                                </div>
                                                <button onClick={()=>removeFromCart(i)} className="text-muted hover:text-error ml-3 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <Trash2 size={16}/>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="border-t border-border pt-2 flex justify-between items-center font-bold">
                                        <span className="text-xs text-muted">TOTAL VENTA:</span>
                                        <span className="text-lg font-mono text-primary">BS {formatS(cart.reduce((s,i)=>s+i.precio_venta, 0))}</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-5 border-t border-border flex justify-end gap-3 bg-background rounded-b-2xl shrink-0">
                            <button onClick={()=>{setShowAddModal(false); setCart([]);}} className="px-4 py-2 text-sm font-bold text-muted hover:text-text">Cancelar</button>
                            <button 
                                onClick={handleSaveOrder} 
                                disabled={cart.length === 0 || loading}
                                className={`px-8 py-3 rounded-xl text-sm font-black flex items-center gap-2 shadow-lg transition-all ${cart.length > 0 && !loading ? 'bg-primary text-background hover:scale-105 hover:shadow-primary/30' : 'bg-muted text-surface cursor-not-allowed'}`}
                            >
                                <Check size={18}/> PROCESAR VENTA COMPLETA ({cart.length})
                            </button>
                        </div>
                    </div>
                </div>
            )}


            {/* PAY MODAL */}
            {showPayModal && (() => {
                const cli = clientes.find(c => c.id === showPayModal);
                const pItems = items.filter(i => i.cliente_id === showPayModal);
                
                return (
                    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                        <div className="bg-surface w-full max-w-lg rounded-2xl border border-border flex flex-col">
                            <div className="p-5 border-b border-border flex justify-between items-center bg-background rounded-t-2xl">
                                <h2 className="text-lg font-bold font-display text-text flex items-center gap-2">
                                    💳 Registrar Pago / Abono
                                </h2>
                                <button onClick={()=>setShowPayModal(null)} className="text-muted"><X size={20}/></button>
                            </div>
                            
                            <div className="p-5">
                                <div className="mb-4 text-sm font-bold text-muted text-center uppercase">{cli?.nombre}</div>
                                
                                <div className="flex bg-background rounded p-1 mb-5 border border-border mx-auto max-w-xs">
                                    <button onClick={()=>setPayMode('items')} className={`flex-1 py-1 text-xs font-bold rounded ${payMode==='items'?'bg-surface text-primary shadow':'text-muted'}`}>Pagar Ítems</button>
                                    <button onClick={()=>setPayMode('general')} className={`flex-1 py-1 text-xs font-bold rounded ${payMode==='general'?'bg-surface text-primary shadow':'text-muted'}`}>Abono a Cuenta</button>
                                </div>

                                {payMode === 'items' ? (
                                    <div className="mb-4 border border-border rounded-lg p-3 bg-background max-h-48 overflow-y-auto">
                                        <div className="text-[10px] text-muted font-bold uppercase mb-2">Selecciona a qué ítems se destinará el pago:</div>
                                        {pItems.map(it => {
                                            const deuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                            if(deuda <= 0) return null;
                                            return (
                                                <label key={it.id} className="flex items-center gap-3 p-2 hover:bg-surface rounded cursor-pointer border-b border-border/50 last:border-0">
                                                    <input 
                                                        type="checkbox" 
                                                        checked={selectedPayItems.includes(it.id)}
                                                        onChange={(e)=>{
                                                            if(e.target.checked) setSelectedPayItems([...selectedPayItems, it.id]);
                                                            else setSelectedPayItems(selectedPayItems.filter(x=>x!==it.id));
                                                        }}
                                                        className="w-4 h-4 accent-primary"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-bold truncate text-text">{it.titulo}</div>
                                                        <div className="text-[10px] uppercase text-error">Deuda: BS {formatS(deuda)}</div>
                                                    </div>
                                                </label>
                                            )
                                        })}
                                        {pItems.filter(i=> (i.precio_venta - i.monto_pagado) > 0).length === 0 && (
                                            <div className="text-xs text-center text-success py-4">No hay ítems con deuda pendiente.</div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="mb-4">
                                        <label className="block text-xs mb-1 text-muted">Concepto (Opcional)</label>
                                        <input type="text" value={pagoConcepto} onChange={e=>setPagoConcepto(e.target.value)} className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary" placeholder="Ej: Depósito QR..."/>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs font-bold mb-1 text-success uppercase">Monto a Abonar (BS)</label>
                                    <input type="number" value={payMonto} onChange={e=>setPayMonto(e.target.value)} autoFocus className="w-full bg-background border-2 border-border focus:border-success px-4 py-3 rounded-lg text-xl text-center text-success font-bold font-mono outline-none shadow-inner"/>
                                    {payMode === 'items' && selectedPayItems.length > 0 && payMonto > 0 && (
                                        <div className="text-[10px] text-center mt-2 text-muted uppercase">
                                            Se distribuirán BS {formatS(payMonto / selectedPayItems.length)} por cada ({selectedPayItems.length}) ítem(s).
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="p-4 border-t border-border flex justify-end gap-3 bg-background rounded-b-2xl">
                                <button onClick={()=>setShowPayModal(null)} className="px-4 py-2 text-sm font-bold text-muted hover:text-text">Cancelar</button>
                                <button onClick={()=>handleSavePayment(cli.id)} className="bg-success text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-success/90 shadow-lg">Confirmar Pago</button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* REPROGRAM MODAL */}
            {reprogrammingItem && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', zIndex: 10005, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
                    <div className="bg-surface rounded-2xl shadow-2xl p-6 w-full max-w-md border border-border">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg uppercase text-text flex items-center gap-2">
                                <RefreshCw size={20} className="text-secondary" /> Re-programar Pedido
                            </h3>
                            <button onClick={() => setReprogrammingItem(null)} className="text-muted hover:text-text"><X size={24} /></button>
                        </div>
                        <p className="text-xs text-muted mb-6">Mueve el ítem <strong>{reprogrammingItem.titulo}</strong> a una nueva semana de despacho tras un recorte de stock.</p>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-black text-muted uppercase block mb-1">Nueva Semana de Despacho</label>
                                <select 
                                    className="w-full bg-background border border-border p-3 rounded-xl text-sm font-bold text-text"
                                    onChange={async (e) => {
                                        const newSem = e.target.value;
                                        if (!newSem) return;
                                        try {
                                            setLoading(true);
                                            const { error } = await supabase.from('cliente_items')
                                                .update({ semana_id: newSem, estado: 'PEDIDO (RE-PROG)' })
                                                .eq('id', reprogrammingItem.id);
                                            if (error) throw error;
                                            setReprogrammingItem(null);
                                            await fetchData();
                                        } catch (err) {
                                            alert("Error al reprogramar: " + err.message);
                                        } finally {
                                            setLoading(false);
                                        }
                                    }}
                                >
                                    <option value="">-- Seleccionar Próxima Semana --</option>
                                    {semanas.map(s => (
                                        <option key={s.id} value={s.id}>{s.nombre}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                        
                        <button 
                            onClick={() => setReprogrammingItem(null)}
                            className="w-full mt-6 py-3 border border-border text-muted font-bold rounded-xl text-xs hover:bg-background"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
