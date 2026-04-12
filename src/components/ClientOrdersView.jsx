import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { Search, Plus, ShoppingBag, CheckSquare, MessageCircle, ChevronDown, ChevronUp, Trash2, Edit2, Check, X, Box, RefreshCw, Info, Layers, Hash, Calendar, ArrowRight, Wallet, Lock } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

export default function ClientOrdersView() {
    const { user, isAdmin } = useAuth();
    const [loading, setLoading] = useState(true);
    const [catalog, setCatalog] = useState([]);
    
    // Datos BD
    const [clientes, setClientes] = useState([]);
    const [items, setItems] = useState([]);
    const [otherSellersItems, setOtherSellersItems] = useState([]);
    const [pagos, setPagos] = useState([]);
    const [semanas, setSemanas] = useState([]);

    // Controles vista
    const [view, setView] = useState('clientes'); // 'clientes' | 'items' | 'hoja'
    const [search, setSearch] = useState('');
    const [filterEstado, setFilterEstado] = useState('todos'); // 'todos' | 'PEDIDO' | 'CONFIRMADO' | 'EN TIENDA' | 'ENTREGADO'
    const [filterSemana, setFilterSemana] = useState('todos'); // 'todos' | semana_id
    const [expandedCliente, setExpandedCliente] = useState(new Set());
    const [compactClients, setCompactClients] = useState(new Set()); // IDs en modo compacto
    const [selectedSemanaHoja, setSelectedSemanaHoja] = useState('');
    const [selectedItems, setSelectedItems] = useState(new Set()); // IDs de ítems seleccionados para acciones masivas

    // Modales
    const [showAddModal, setShowAddModal] = useState(false);
    const [showPayModal, setShowPayModal] = useState(null); // cliente_id
    const [showWhatsAppMenu, setShowWhatsAppMenu] = useState(null); // cliente_id

    // Formulario Nuevo Pedido
    const [addForm, setAddForm] = useState({
        celular: '', nombre: '', ci: '', ciudad: '', sucursal: '', direccion: '', notas_cliente: '',
        semana_id: '', mode: 'individual',
        // individual
        titulo: '', product_id: '', precio_venta: '', descuento: '', precio_final: '', monto_pagado: '', nota_item: '',
        // coleccion
        coleccion_nombre: '', tomos: '', precio_tomo: '', pago_inicial_total: ''
    });

    // Bulk add modal state (integrated in AddModal)
    const [bulkSearch, setBulkSearch] = useState('');
    const [bulkRange, setBulkRange] = useState('');
    const [bulkResults, setBulkResults] = useState([]);
    const [bulkSelected, setBulkSelected] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);

    const [catalogSuggestions, setCatalogSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    
    // Asignación Dinámica
    const [stockAnalysis, setStockAnalysis] = useState(null); // { fisico: int, flotantes: [{semana_id, nombre, qty, fechaArribo}] }
    const [selectedStockSource, setSelectedStockSource] = useState(''); // 'fisico' | 'flotante_ID' | 'pedido_ID'
    
    // Carrito de la venta actual
    const [cart, setCart] = useState([]);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    // Formulario Pagos
    const [payMode, setPayMode] = useState('items'); // 'items' | 'general'
    const [selectedPayItems, setSelectedPayItems] = useState([]);
    const [payMonto, setPayMonto] = useState('');
    const [pagoConcepto, setPagoConcepto] = useState('');
    const [payMethod, setPayMethod] = useState('Yasta (QR)'); // 'Efectivo' | 'Yasta (QR)' | 'Banco Unión (QR/Transf)' | 'BNB' | 'Otros'
    const [payReference, setPayReference] = useState(''); // No. operación para pagos digitales
    const [reprogrammingItem, setReprogrammingItem] = useState(null);
    const [batchDiscount, setBatchDiscount] = useState('');
    const [batchAbono, setBatchAbono] = useState('');
    const [orderMethod, setOrderMethod] = useState('Yasta (QR)'); // método del abono inicial al crear pedido
    const [orderPayAmt, setOrderPayAmt] = useState(''); // monto del pago inicial general
    const [editPago, setEditPago] = useState(null); // { id, concepto, monto, metodo_pago, caja_mov_id }
    const [modoHistorico, setModoHistorico] = useState(false);
    const [histSemana, setHistSemana] = useState(''); // semana_id para modo histórico
    const [editItem, setEditItem] = useState(null); // { id, titulo, precio_venta, estado, nota, semana_id }
    const [bulkEstadoTarget, setBulkEstadoTarget] = useState('ENTREGADO');
    const [distribuirMontos, setDistribuirMontos] = useState({}); // { itemId: monto }
    const [cartSelected, setCartSelected] = useState(new Set()); // índices seleccionados en el carrito histórico
    const [cartBulkSemana, setCartBulkSemana] = useState('');
    const [cartBulkEstado, setCartBulkEstado] = useState('ENTREGADO');
    const [sinContabilidad, setSinContabilidad] = useState(false); // registrar pago sin caja_movimientos
    
    // RESET MODAL ON CLOSE/OPEN (Hoja en blanco)
    useEffect(() => {
        if (!showAddModal) {
            setAddForm({
                celular: '', nombre: '', ci: '', ciudad: '', sucursal: '', direccion: '', notas_cliente: '',
                semana_id: '', mode: 'individual',
                titulo: '', product_id: '', precio_venta: '', descuento: '', precio_final: '', monto_pagado: '', nota_item: '',
                coleccion_nombre: '', tomos: '', precio_tomo: '', pago_inicial_total: ''
            });
            setCart([]);
            setBulkSearch('');
            setBulkRange('');
            setBulkResults([]);
            setBulkSelected(new Set());
            setCatalogSuggestions([]);
            setShowSuggestions(false);
            setStockAnalysis(null);
            setSelectedStockSource('');
            setBatchDiscount('');
            setBatchAbono('');
            setOrderMethod('Yasta (QR)');
        }
    }, [showAddModal]);

    const handleBulkDelete = async () => {
        if (!selectedItems.size) return;
        if (!confirm(`¿Estás seguro de eliminar ${selectedItems.size} pedidos seleccionados? Esta acción no se puede deshacer.`)) return;

        setLoading(true);
        try {
            const list = Array.from(selectedItems);
            const itemsToDelete = items.filter(i => selectedItems.has(i.id));

            for (const it of itemsToDelete) {
                // Restore stock if it was physically in store
                let shouldRestore = false;
                if ((it.estado === 'EN TIENDA' || it.estado === 'ADJUDICADO') && (it.catalog_id || it.product_id)) {
                    shouldRestore = true;
                } else if (it.estado === 'RESERVA' && it.semana_id) {
                    const { data: sem } = await supabase.from('semanas')
                        .select('estado')
                        .eq('id', it.semana_id)
                        .maybeSingle();
                    if (sem && (sem.estado === 'PEDIDA' || sem.estado === 'RECIBIDA')) {
                        shouldRestore = true;
                    }
                }

                if (shouldRestore && (it.catalog_id || it.product_id)) {
                    const lookupCol = it.catalog_id ? 'id' : 'product_id';
                    const lookupVal = it.catalog_id || it.product_id;
                    const { data: prod } = await supabase.from('catalogo_productos')
                        .select('id, stock_fisico')
                        .eq(lookupCol, lookupVal)
                        .maybeSingle();
                    if (prod) {
                        await supabase.from('catalogo_productos')
                            .update({ stock_fisico: (prod.stock_fisico || 0) + 1 })
                            .eq('id', prod.id);
                    }
                }
            }

            // Perform bulk delete
            const { error } = await supabase.from('cliente_items').delete().in('id', list);
            if (error) throw error;

            setSelectedItems(new Set());
            if (typeof catalogService !== 'undefined') catalogService.clearCache();
            await fetchData();
            await fetchCatalog();
            alert(`${list.length} pedidos eliminados correctamente.`);
        } catch (err) {
            console.error(err);
            alert("Error al realizar borrado masivo: " + err.message);
        } finally {
            setLoading(false);
        }
    };

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
            // Define base queries
            let itemsQuery = supabase.from('cliente_items').select('*, clientes(*)');
            let pagosQuery = supabase.from('cliente_pagos').select('*');
            let othersQuery = null;

            // Apply seller isolation
            if (!isAdmin && user?.id) {
                itemsQuery = itemsQuery.eq('vendedor_id', user.id);
                pagosQuery = pagosQuery.eq('vendedor_id', user.id);
                // Detection query (only basics needed for coordination)
                othersQuery = supabase.from('cliente_items')
                    .select('id, cliente_id, vendedor_id, titulo, precio_venta, monto_pagado, estado, semana_id')
                    .neq('vendedor_id', user.id)
                    .neq('estado', 'ENTREGADO');
            }

            const [clientesRes, semanasRes, itemsRes, pagosRes, othersRes] = await Promise.all([
                supabase.from('clientes').select('*').order('created_at', { ascending: false }),
                supabase.from('semanas').select('*').order('created_at', { ascending: false }),
                itemsQuery.order('created_at', { ascending: false }),
                pagosQuery.order('created_at', { ascending: false }),
                othersQuery ? othersQuery : Promise.resolve({ data: [] })
            ]);

            if (clientesRes.error) throw clientesRes.error;

            setClientes(clientesRes.data || []);
            setItems(itemsRes.data || []);
            setOtherSellersItems(othersRes.data || []);
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
    const parseRange = (rangeStr) => {
        if (!rangeStr || !rangeStr.trim()) return null;
        const nums = new Set();
        for (const part of rangeStr.split(',')) {
            const trimmed = part.trim();
            if (trimmed.includes('-')) {
                const [a, b] = trimmed.split('-').map(n => parseInt(n.trim()));
                if (!isNaN(a) && !isNaN(b)) {
                    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) nums.add(i);
                }
            } else {
                const n = parseInt(trimmed);
                if (!isNaN(n)) nums.add(n);
            }
        }
        return nums.size > 0 ? nums : null;
    };

    const extractVolNum = (title) => {
        const matches = (title || "").match(/\d+/g);
        return matches ? parseInt(matches[matches.length - 1]) : null;
    };

    const searchBulkCatalog = async (term) => {
        if (!term || term.trim().length < 2) { setBulkResults([]); return; }
        setBulkLoading(true);
        try {
            const { data, error } = await supabase
                .from('catalogo_productos')
                .select('*')
                .ilike('titulo', `%${term.trim()}%`)
                .order('titulo', { ascending: true })
                .limit(100);
            if (error) throw error;
            const results = data || [];
            setBulkResults(results);
            
            // Auto-select based on range
            const rangeSet = parseRange(bulkRange);
            if (rangeSet) {
                setBulkSelected(new Set(
                    results.filter(p => {
                        const v = extractVolNum(p.titulo);
                        return p.titulo.toLowerCase().startsWith(term.trim().toLowerCase()) && v !== null && rangeSet.has(v);
                    }).map(p => p.id)
                ));
            } else {
                setBulkSelected(new Set());
            }
        } catch (err) {
            console.error('Error buscando catálogo:', err);
        } finally {
            setBulkLoading(false);
        }
    };

    const applyBulkRange = () => {
        const rangeSet = parseRange(bulkRange);
        if (!rangeSet) {
            setBulkSelected(new Set(
                bulkResults.filter(p => p.titulo.toLowerCase().startsWith(bulkSearch.trim().toLowerCase())).map(p => p.id)
            ));
            return;
        }
        setBulkSelected(new Set(
            bulkResults.filter(p => {
                const v = extractVolNum(p.titulo);
                return p.titulo.toLowerCase().startsWith(bulkSearch.trim().toLowerCase()) && v !== null && rangeSet.has(v);
            }).map(p => p.id)
        ));
    };

    const toggleBulkItem = (pid) => {
        setBulkSelected(prev => {
            const next = new Set(prev);
            next.has(pid) ? next.delete(pid) : next.add(pid);
            return next;
        });
    };

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

    const formatS = (num) => Number(num || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const renderStatus = (it) => {
        const week = semanas.find(s => s.id === it.semana_id);
        // ADJUDICADO = confirmado y reservado para este cliente, mostrar como CONFIRMADO + semana
        const isAdjudicado = it.estado === 'ADJUDICADO';
        const displayEstado = isAdjudicado
            ? `CONFIRMADO${week ? ' ' + week.nombre : ''}`
            : it.estado;
        const isFloating = isAdjudicado || it.estado.startsWith('CONFIRMADO') || it.estado.startsWith('PEDIDO');
        let dateStr = null;
        if (isFloating && week) {
            const d = week.fecha_estimada_llegada ? new Date(week.fecha_estimada_llegada) : new Date(new Date(week.created_at).getTime() + (22*24*60*60*1000));
            dateStr = d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
        } else if (it.estado === 'PEDIDO (Siguiente)') {
            const now = new Date();
            const day = now.getDay();
            const diff = (6 - day + 7) % 7 || 7;
            const nextSat = new Date(now.getTime() + (diff * 24 * 60 * 60 * 1000));
            const arrival = new Date(nextSat.getTime() + (22 * 24 * 60 * 60 * 1000));
            dateStr = arrival.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        }

        return (
            <div className="flex flex-col items-center gap-0.5">
                <span
                    onClick={()=>setEditingState(it.id)}
                    className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider cursor-pointer border transition-colors ${
                        it.estado === 'RECORTADO' ? 'bg-red-500/10 border-red-500/30 text-red-500 shadow-sm animate-pulse' :
                        it.estado === 'ENTREGADO' ? 'bg-background/50 border-border text-muted' :
                        it.estado === 'EN TIENDA' ? 'bg-success/10 border-success/30 text-success shadow-sm shadow-success/20' :
                        (isAdjudicado || it.estado.startsWith('CONFIRMADO')) ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-sm shadow-blue-500/20' :
                        'bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/20'
                    }`}
                >
                    {displayEstado}
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
        const price = item.precio_venta_bs || item.precio_tapa || 0;
        const formattedPrice = price ? Number(price).toFixed(2) : '';
        setAddForm({ 
            ...addForm, 
            titulo: item.titulo, 
            catalog_id: item.id,
            product_id: item.product_id,
            precio_venta: formattedPrice,
            descuento: "0.0",
            precio_final: formattedPrice,
            monto_pagado: ''
        });
        setShowSuggestions(false);
        
        // Analyze Stock inline (solo en modo normal)
        if (!modoHistorico) {
            const stock = await analyzeStockForItem(item.titulo);
            setStockAnalysis(stock);
            setSelectedStockSource(stock.defaultSource);
        }
    };

    const analyzeStockForItem = async (title) => {
        try {
            const { data: masters } = await supabase.from('master_confirmaciones').select('semana_id, datos_json');
            const { data: recs } = await supabase.from('pedido_items_recepcion').select('semana_id, titulo, cantidad_recibida').eq('titulo', title);
            const { data: allOrders } = await supabase.from('pedido_items').select('cantidad, titulo, pedido:pedidos!inner(semana_id, tipo)').eq('titulo', title);
            const { data: catProd } = await supabase.from('catalogo_productos').select('stock_fisico').eq('titulo', title).maybeSingle();

            const flotantes = [];
            const pTitle = title.toLowerCase().trim();
            
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
                        it.estado.includes('CONFIRMADO')
                    ).length;
                        
                    qtyFlot = Math.max(0, (totalConf - sellerRequested) - totalRec - clientReserved);
                } else {
                    const storeTotal = (allOrders || [])
                        .filter(p => (p.titulo||'').toLowerCase().trim() === pTitle && p.pedido.tipo === 'tienda' && p.pedido.semana_id === w.id)
                        .reduce((s,p) => s + (p.cantidad||0), 0);
                    const clientWaitlist = items.filter(it => 
                        (it.titulo || '').toLowerCase().trim() === pTitle && 
                        it.semana_id === w.id && 
                        it.estado.includes('PEDIDO')
                    ).length;
                    qtyFlot = Math.max(0, storeTotal - clientWaitlist);
                }
                
                if (qtyFlot > 0) {
                    const d = w.fecha_estimada_llegada ? new Date(w.fecha_estimada_llegada) : new Date(new Date(w.created_at).getTime() + (22*24*60*60*1000));
                    flotantes.push({ id: w.id, nombre: w.nombre, qty: qtyFlot, fechaArribo: d, isConfirmed });
                }
            });

            const fisico = catProd?.stock_fisico || 0;
            
            // Determinar fuente por defecto
            let defaultSource = 'pedido_PENDIENTE';
            if (fisico > 0) defaultSource = 'fisico';
            else if (flotantes.length > 0) {
                const bestFlot = flotantes.find(f => f.isConfirmed);
                if (bestFlot) defaultSource = bestFlot.isConfirmed ? `flotante_conf_${bestFlot.id}` : `flotante_noc_${bestFlot.id}`;
                else defaultSource = `flotante_noc_${flotantes[0].id}`;
            } else {
                const openWeek = semanas.find(s => s.abierta);
                if (openWeek) defaultSource = `pedido_${openWeek.id}`;
            }

            return { fisico, flotantes, defaultSource };
        } catch (e) {
            console.error("Error analyzing stock for item:", e);
            return { fisico: 0, flotantes: [], defaultSource: '' };
        }
    };

    const addToCart = async () => {
        setLoading(true);
        try {
            if (addForm.mode === 'individual') {
                if (!addForm.titulo) return alert("Título obligatorio");
                
                setCart([...cart, {
                    titulo: addForm.titulo,
                    catalog_id: addForm.catalog_id,
                    product_id: addForm.product_id,
                    precio_original: Number(addForm.precio_venta) || 0,
                    descuento: Number(addForm.descuento) || 0,
                    precio_venta: Number(addForm.precio_final) || Number(addForm.precio_venta) || 0,
                    monto_pagado: Number(addForm.monto_pagado) || 0,
                    nota: addForm.nota_item,
                    source: modoHistorico ? 'historico' : selectedStockSource,
                    hist_semana_id: modoHistorico ? (addForm.hist_semana_id || null) : undefined,
                    hist_estado: modoHistorico ? (addForm.hist_estado || 'PEDIDO') : undefined,
                    stockOptions: modoHistorico ? null : stockAnalysis
                }]);

                // Reset item fields
                setAddForm({ ...addForm, titulo: '', catalog_id: '', product_id: '', precio_venta: '', descuento: '', precio_final: '', monto_pagado: '', nota_item: '' });
                setStockAnalysis(null);
                setSelectedStockSource('');
                setCatalogSuggestions([]);
            } else {
                // Batch addition
                const toAdd = Array.from(bulkSelected).map(id => bulkResults.find(r => r.id === id)).filter(Boolean);
                if (toAdd.length === 0) return alert("No hay ítems seleccionados");

                if (modoHistorico) {
                    // Modo histórico: sin análisis de stock, usar semana/estado globales del carrito
                    const newItems = toAdd.map(it => ({
                        titulo: it.titulo,
                        catalog_id: it.id,
                        product_id: it.product_id || it.id,
                        precio_original: Number(it.precio_venta_bs || it.precio_tapa || 0),
                        descuento: 0,
                        precio_venta: Number(it.precio_venta_bs || it.precio_tapa || 0),
                        monto_pagado: 0,
                        source: 'historico',
                        hist_semana_id: histSemana || null,
                        hist_estado: 'PEDIDO',
                        stockOptions: null
                    }));
                    setCart([...cart, ...newItems]);
                    setBulkSelected(new Set());
                    setBulkSearch('');
                    setBulkRange('');
                    setBulkResults([]);
                    return;
                }

                // 1 sola ronda de queries para todos los títulos
                const titulos = toAdd.map(it => it.titulo);
                const [mastersRes2, recsRes, allOrdersRes, catProdsRes] = await Promise.all([
                    supabase.from('master_confirmaciones').select('semana_id, datos_json'),
                    supabase.from('pedido_items_recepcion').select('semana_id, titulo, cantidad_recibida').in('titulo', titulos),
                    supabase.from('pedido_items').select('cantidad, titulo, pedido:pedidos!inner(semana_id, tipo)').in('titulo', titulos),
                    supabase.from('catalogo_productos').select('titulo, stock_fisico').in('titulo', titulos),
                ]);
                const masters2 = mastersRes2.data || [];
                const recs2 = recsRes.data || [];
                const allOrders2 = allOrdersRes.data || [];
                const catProds2 = catProdsRes.data || [];

                const analyzeInMemory = (title) => {
                    const pTitle = title.toLowerCase().trim();
                    const catProd = catProds2.find(p => (p.titulo||'').toLowerCase().trim() === pTitle);
                    const fisico = catProd?.stock_fisico || 0;
                    const flotantes = [];

                    semanas.forEach(w => {
                        const master = masters2.find(m => m.semana_id === w.id);
                        const isConfirmed = !!master;
                        let qtyFlot = 0;
                        if (isConfirmed) {
                            const totalConf = (master.datos_json || []).filter(i => (i.titulo||'').toLowerCase().trim() === pTitle).reduce((s,i) => s + (i.cantidad||0), 0);
                            const sellerRequested = allOrders2.filter(p => (p.titulo||'').toLowerCase().trim() === pTitle && p.pedido.tipo === 'personal' && p.pedido.semana_id === w.id).reduce((s,p) => s + (p.cantidad||0), 0);
                            const totalRec = recs2.filter(r => r.semana_id === w.id && (r.titulo||'').toLowerCase().trim() === pTitle).reduce((s,r) => s + (r.cantidad_recibida||0), 0);
                            const clientReserved = items.filter(it => (it.titulo||'').toLowerCase().trim() === pTitle && it.semana_id === w.id && it.estado.includes('CONFIRMADO')).length;
                            qtyFlot = Math.max(0, (totalConf - sellerRequested) - totalRec - clientReserved);
                        } else {
                            const storeTotal = allOrders2.filter(p => (p.titulo||'').toLowerCase().trim() === pTitle && p.pedido.tipo === 'tienda' && p.pedido.semana_id === w.id).reduce((s,p) => s + (p.cantidad||0), 0);
                            const clientWaitlist = items.filter(it => (it.titulo||'').toLowerCase().trim() === pTitle && it.semana_id === w.id && it.estado.includes('PEDIDO')).length;
                            qtyFlot = Math.max(0, storeTotal - clientWaitlist);
                        }
                        if (qtyFlot > 0) {
                            const d = w.fecha_estimada_llegada ? new Date(w.fecha_estimada_llegada) : new Date(new Date(w.created_at).getTime() + (22*24*60*60*1000));
                            flotantes.push({ id: w.id, nombre: w.nombre, qty: qtyFlot, fechaArribo: d, isConfirmed });
                        }
                    });

                    let defaultSource = 'pedido_PENDIENTE';
                    if (fisico > 0) defaultSource = 'fisico';
                    else if (flotantes.length > 0) {
                        const bestFlot = flotantes.find(f => f.isConfirmed);
                        if (bestFlot) defaultSource = `flotante_conf_${bestFlot.id}`;
                        else defaultSource = `flotante_noc_${flotantes[0].id}`;
                    } else {
                        const openWeek = semanas.find(s => s.abierta);
                        if (openWeek) defaultSource = `pedido_${openWeek.id}`;
                    }
                    return { fisico, flotantes, defaultSource };
                };

                const newItems = toAdd.map(it => {
                    const analysis = analyzeInMemory(it.titulo);
                    return {
                        titulo: it.titulo,
                        catalog_id: it.id,
                        product_id: it.product_id || it.id,
                        precio_original: Number(it.precio_venta_bs || it.precio_tapa || 0),
                        descuento: 0,
                        precio_venta: Number(it.precio_venta_bs || it.precio_tapa || 0),
                        monto_pagado: 0,
                        source: analysis.defaultSource,
                        stockOptions: analysis
                    };
                });

                setCart([...cart, ...newItems]);
                setBulkSelected(new Set());
                setBulkSearch('');
                setBulkRange('');
                setBulkResults([]);
            }
        } catch (err) {
            console.error(err);
            alert("Error al añadir al carrito");
        } finally {
            setLoading(false);
        }
    };

    const applyBatchDiscount = () => {
        const pct = Number(batchDiscount);
        if (isNaN(pct) || pct < 0) return;
        setCart(cart.map(item => {
            const base = Number(item.precio_original) || Number(item.precio_venta) || 0;
            const final = base - (base * (pct / 100));
            return { 
                ...item, 
                precio_venta: final.toFixed(2), 
                descuento: pct.toFixed(1) 
            };
        }));
        setBatchDiscount('');
    };

    const applyBatchAbono = () => {
        const amt = Number(batchAbono);
        if (isNaN(amt) || amt < 0) return;
        setCart(cart.map(item => ({ 
            ...item, 
            monto_pagado: amt.toFixed(2) 
        })));
        setBatchAbono('');
    };

    const updateCartItem = (index, field, value) => {
        const next = [...cart];
        const item = { ...next[index], [field]: value };
        
        // Recalculación recíproca
        if (field === 'precio_original' || field === 'descuento') {
            const base = Number(item.precio_original) || 0;
            const pct = Number(item.descuento) || 0;
            item.precio_venta = (base - (base * (pct / 100))).toFixed(2);
        } else if (field === 'precio_venta' || field === 'precio_final') {
            const final = Number(value) || 0;
            const base = Number(item.precio_original) || 0;
            if (base > 0) {
                item.descuento = ((1 - (final / base)) * 100).toFixed(1);
            }
            item.precio_venta = final;
        }
        
        next[index] = item;
        setCart(next);
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
                // Update client data if something new was provided (optional but good)
                await supabase.from('clientes').update({
                    nombre: addForm.nombre || cliMatch.nombre,
                    ci: addForm.ci || cliMatch.ci,
                    ciudad: addForm.ciudad || cliMatch.ciudad,
                    sucursal: addForm.sucursal || cliMatch.sucursal,
                    direccion: addForm.direccion || cliMatch.direccion,
                    notas: addForm.notas_cliente || cliMatch.notas
                }).eq('id', clienteId);
            } else {
                // If no name provided, use "Cliente [Celular]"
                const finalNombre = addForm.nombre || `Cliente ${addForm.celular}`;
                const { data: newCli, error: cliErr } = await supabase.from('clientes').insert([{
                    nombre: finalNombre,
                    celular: addForm.celular,
                    ci: addForm.ci,
                    ciudad: addForm.ciudad,
                    sucursal: addForm.sucursal,
                    direccion: addForm.direccion,
                    notas: addForm.notas_cliente
                }]).select().single();
                if (cliErr) throw cliErr;
                clienteId = newCli.id;
            }

            // 2. Process Cart and Prepare Insert Items
            const itemsToInsert = [];
            
            for (let cItem of cart) {
                let targetSemanaId = null;
                let estadoTarget = 'PEDIDO';

                if (modoHistorico) {
                    // Modo histórico: usar estado y semana definidos manualmente
                    estadoTarget = cItem.hist_estado || 'PEDIDO';
                    targetSemanaId = cItem.hist_semana_id || null;
                    if (targetSemanaId) {
                        const wName = semanas.find(s => s.id === targetSemanaId)?.nombre || '';
                        // Prefijamos el nombre de semana solo en PEDIDO/CONFIRMADO
                        if (estadoTarget === 'PEDIDO' && wName) estadoTarget = `PEDIDO ${wName}`;
                        else if (estadoTarget === 'CONFIRMADO' && wName) estadoTarget = `CONFIRMADO ${wName}`;
                    }
                } else {
                    if (cItem.source === 'fisico') {
                        estadoTarget = 'EN TIENDA';
                    } else if (cItem.source.startsWith('flotante_conf_')) {
                        targetSemanaId = cItem.source.replace('flotante_conf_', '');
                        const wName = semanas.find(s=>s.id === targetSemanaId)?.nombre || '';
                        estadoTarget = `CONFIRMADO ${wName}`;
                    } else if (cItem.source.startsWith('flotante_noc_')) {
                        targetSemanaId = cItem.source.replace('flotante_noc_', '');
                        const wName = semanas.find(s=>s.id === targetSemanaId)?.nombre || '';
                        estadoTarget = `PEDIDO ${wName}`;
                    } else if (cItem.source === 'pedido_PENDIENTE') {
                        targetSemanaId = null;
                        estadoTarget = 'PEDIDO (Siguiente)';
                    } else if (cItem.source.startsWith('pedido_')) {
                        targetSemanaId = cItem.source.replace('pedido_', '');
                        const sFound = semanas.find(s=>s.id === targetSemanaId);
                        const wName = sFound?.nombre || '';
                        estadoTarget = `PEDIDO ${wName}`;
                    }
                }

                itemsToInsert.push({
                    cliente_id: clienteId,
                    titulo: cItem.titulo,
                    product_id: cItem.product_id || null,
                    catalog_id: cItem.catalog_id || null,
                    semana_id: targetSemanaId,
                    precio_venta: cItem.precio_venta,
                    descuento: cItem.descuento || 0,
                    monto_pagado: cItem.monto_pagado,
                    estado: estadoTarget,
                    nota: cItem.nota,
                    vendedor_id: user?.id
                });
            }

            // 3. Insert Items
            const { error: insErr } = await supabase.from('cliente_items').insert(itemsToInsert);
            if (insErr) throw insErr;

            // 4. Subtract stock (solo en modo normal, no histórico)
            for (let cItem of cart) {
                if (!modoHistorico && cItem.source === 'fisico') {
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
            
            if (typeof catalogService !== 'undefined') catalogService.clearCache();

            // 5. Registrar pago inicial
            const totalAbonoInicial = Number(orderPayAmt) || 0;
            if (totalAbonoInicial > 0) {
                const clienteNombre = clientes.find(c => c.id === clienteId)?.nombre || addForm.nombre || clienteId;
                if (modoHistorico) {
                    // Modo histórico: solo registrar en cliente_pagos, sin tocar caja_movimientos
                    await supabase.from('cliente_pagos').insert([{
                        cliente_id: clienteId,
                        monto: totalAbonoInicial,
                        concepto: 'Pago anterior (histórico)',
                        vendedor_id: user?.id,
                        metodo_pago: orderMethod,
                        caja_mov_id: null,
                    }]);
                } else {
                    let turnoId = null;
                    if (orderMethod === 'Efectivo') {
                        const { data: activeTurno } = await supabase
                            .from('turnos_caja').select('id').eq('estado', 'ABIERTO').maybeSingle();
                        if (!activeTurno) throw new Error("⚠️ BLOQUEO: No hay TURNO DE CAJA abierto para registrar el abono en efectivo.");
                        turnoId = activeTurno.id;
                    }
                    const { data: cajaMov } = await supabase.from('caja_movimientos').insert([{
                        turno_id: turnoId,
                        tipo: 'INGRESO',
                        categoria: 'Cobro Pedido',
                        concepto: `ABONO INICIAL [${clienteNombre}] · ${cart.length} ítem(s)`,
                        monto: totalAbonoInicial,
                        vendedor_id: user?.id,
                        metodo_pago: orderMethod,
                        origen: 'Pedidos'
                    }]).select('id').single();
                    await supabase.from('cliente_pagos').insert([{
                        cliente_id: clienteId,
                        monto: totalAbonoInicial,
                        concepto: 'Abono inicial',
                        vendedor_id: user?.id,
                        metodo_pago: orderMethod,
                        caja_mov_id: cajaMov?.id || null,
                    }]);
                }
            }

            setShowAddModal(false);
            setCart([]);
            setOrderPayAmt('');
            setOrderMethod('Yasta (QR)');
            setModoHistorico(false);
            setHistSemana('');
            setAddForm({
                celular: '', nombre: '', ci: '', ciudad: '', sucursal: '', direccion: '', notas_cliente: '',
                semana_id: '', mode: 'individual',
                titulo: '', product_id: '', precio_venta: '', descuento: '', precio_final: '', monto_pagado: '', nota_item: '',
                coleccion_nombre: '', tomos: '', precio_tomo: '', pago_inicial_total: ''
            });
            await fetchData();
            await fetchCatalog();

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

            const cli = clientes.find(c => c.id === clienteId);

            // --- LEDGER: Registrar en caja_movimientos PRIMERO para capturar el ID ---
            let turnoId = null;
            if (payMethod === 'Efectivo') {
                const { data: activeTurno, error: tErr } = await supabase
                    .from('turnos_caja')
                    .select('id')
                    .eq('estado', 'ABIERTO')
                    .maybeSingle();
                if (tErr) throw tErr;
                if (!activeTurno) {
                    throw new Error("⚠️ BLOQUEO: No hay TURNO DE CAJA abierto. Abre caja en 'OPERATIVA DIARIA' para recibir efectivo.");
                }
                turnoId = activeTurno.id;
            }

            let cajaMov = null;
            if (!sinContabilidad) {
                const concetoLedger = `ABONO PEDIDO [${cli?.nombre || clienteId}]${payReference ? ' · Ref: ' + payReference : ''}${pagoConcepto ? ' · ' + pagoConcepto : ''}`;
                const { data: cajaMovData, error: moveErr } = await supabase.from('caja_movimientos').insert([{
                    turno_id: turnoId,
                    tipo: 'INGRESO',
                    categoria: 'Cobro Pedido',
                    concepto: concetoLedger,
                    monto: amt,
                    vendedor_id: user?.id,
                    metodo_pago: payMethod,
                    origen: 'Pedidos'
                }]).select('id').single();
                if (moveErr) throw moveErr;
                cajaMov = cajaMovData;
            }

            if (payMode === 'general') {
                const { error: pErr } = await supabase.from('cliente_pagos').insert([{
                    cliente_id: clienteId,
                    monto: amt,
                    concepto: pagoConcepto || 'Abono general',
                    vendedor_id: user?.id,
                    metodo_pago: payMethod,
                    referencia: payReference || null,
                    caja_mov_id: cajaMov?.id || null,
                }]);
                if (pErr) throw pErr;
            } else {
                if (selectedPayItems.length === 0) return alert("Seleccione al menos un ítem");

                const itemsToUpdate = items.filter(i => selectedPayItems.includes(i.id));
                // Distribuir el monto cubriendo la deuda exacta de cada ítem en orden.
                // Si el monto es exactamente la suma de deudas, cada ítem queda en 0.
                // Si sobra/falta, se aplica en orden hasta agotar el monto.
                let restante = amt;
                for (let eq of itemsToUpdate) {
                    if (restante <= 0) break;
                    const deuda = Math.max(0, Number(eq.precio_venta) - Number(eq.monto_pagado || 0));
                    const aplicar = Math.min(deuda, restante);
                    const nuevoMonto = Number(eq.monto_pagado || 0) + aplicar;
                    await supabase.from('cliente_items').update({
                        monto_pagado: nuevoMonto,
                        estado: eq.estado
                    }).eq('id', eq.id);
                    restante -= aplicar;
                }
                // También crear cliente_pagos para que aparezca en el historial
                const { error: pErr } = await supabase.from('cliente_pagos').insert([{
                    cliente_id: clienteId,
                    monto: amt,
                    concepto: pagoConcepto || `Abono ${selectedPayItems.length} ítem(s)`,
                    vendedor_id: user?.id,
                    metodo_pago: payMethod,
                    referencia: payReference || null,
                    caja_mov_id: cajaMov?.id || null,
                }]);
                if (pErr) throw pErr;
            }

            setShowPayModal(null);
            setPayMonto('');
            setPagoConcepto('');
            setPayReference('');
            setPayMethod('Yasta (QR)');
            setSelectedPayItems([]);
            setSinContabilidad(false);

            await fetchData();
            alert(sinContabilidad ? "✓ Pago registrado (sin movimiento en Contabilidad)." : "✓ Pago registrado y contabilizado correctamente.");
        } catch (e) {
            console.error(e);
            alert(e.message || "Error al registrar pago");
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePago = async (pago) => {
        if (!confirm(`¿Eliminar este abono?\n${pago.concepto || 'Abono'} — BS ${Number(pago.monto).toLocaleString('es-BO', { minimumFractionDigits: 2 })}\n\nTambién se eliminará de Contabilidad.`)) return;
        try {
            setLoading(true);
            // Borrar el movimiento de caja si existe el vínculo
            if (pago.caja_mov_id) {
                await supabase.from('caja_movimientos').delete().eq('id', pago.caja_mov_id);
            }
            await supabase.from('cliente_pagos').delete().eq('id', pago.id);

            // Recalcular: si el total pagado restante < sum(monto_pagado en ítems), hay que revertir el exceso
            const clienteItems = items.filter(i => i.cliente_id === pago.cliente_id);
            const pagoRestantes = pagos.filter(p => p.cliente_id === pago.cliente_id && p.id !== pago.id);
            const newGroupPagos = pagoRestantes.reduce((s, p) => s + Number(p.monto), 0);
            const cPagItemsTotal = clienteItems.reduce((s, i) => s + Number(i.monto_pagado || 0), 0);
            let exceso = cPagItemsTotal - newGroupPagos;

            if (exceso > 0) {
                // Reducir monto_pagado de los ítems (de mayor a menor monto_pagado) hasta cubrir el exceso
                const itemsOrdenados = [...clienteItems].sort((a, b) => Number(b.monto_pagado || 0) - Number(a.monto_pagado || 0));
                for (const it of itemsOrdenados) {
                    if (exceso <= 0) break;
                    const mp = Number(it.monto_pagado || 0);
                    if (mp <= 0) continue;
                    const reducir = Math.min(mp, exceso);
                    const nuevoMonto = mp - reducir;
                    await supabase.from('cliente_items').update({ monto_pagado: nuevoMonto }).eq('id', it.id);
                    exceso -= reducir;
                }
            }

            await fetchData();
        } catch (e) {
            console.error(e);
            alert('Error al eliminar el abono: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdatePago = async () => {
        if (!editPago) return;
        const amt = Number(editPago.monto);
        if (!amt || amt <= 0) return alert('Monto inválido.');
        try {
            setLoading(true);
            await supabase.from('cliente_pagos').update({
                monto: amt,
                concepto: editPago.concepto,
                metodo_pago: editPago.metodo_pago,
            }).eq('id', editPago.id);
            // Sincronizar con caja_movimientos si existe el vínculo
            if (editPago.caja_mov_id) {
                await supabase.from('caja_movimientos').update({
                    monto: amt,
                    concepto: editPago.concepto,
                    metodo_pago: editPago.metodo_pago,
                }).eq('id', editPago.caja_mov_id);
            }
            setEditPago(null);
            await fetchData();
        } catch (e) {
            console.error(e);
            alert('Error al editar el abono: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateItem = async () => {
        if (!editItem) return;
        try {
            setLoading(true);
            // Calcular estado final: si estado base es PEDIDO o CONFIRMADO, concatenar nombre de semana
            let estadoFinal = editItem.estado;
            const semNombre = semanas.find(s => s.id === editItem.semana_id)?.nombre || '';
            if (editItem.estado === 'PEDIDO' && editItem.semana_id && semNombre) estadoFinal = `PEDIDO ${semNombre}`;
            else if (editItem.estado === 'CONFIRMADO' && editItem.semana_id && semNombre) estadoFinal = `CONFIRMADO ${semNombre}`;

            await supabase.from('cliente_items').update({
                titulo: editItem.titulo,
                precio_venta: Number(editItem.precio_venta) || 0,
                estado: estadoFinal,
                semana_id: editItem.semana_id || null,
                nota: editItem.nota || null,
            }).eq('id', editItem.id);
            setEditItem(null);
            await fetchData();
        } catch (e) {
            console.error(e);
            alert('Error al editar el ítem: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDistribuirBalance = async () => {
        const entries = Object.entries(distribuirMontos).filter(([, amt]) => Number(amt) > 0);
        if (entries.length === 0) return;
        try {
            setLoading(true);
            for (const [itemId, amt] of entries) {
                const it = items.find(i => i.id === itemId);
                if (!it) continue;
                const nuevoMonto = Math.min(Number(it.precio_venta), Number(it.monto_pagado || 0) + Number(amt));
                await supabase.from('cliente_items').update({ monto_pagado: nuevoMonto }).eq('id', itemId);
            }
            setShowPayModal(null);
            setDistribuirMontos({});
            setPayMode('items');
            await fetchData();
        } catch (e) {
            console.error(e);
            alert('Error al distribuir balance: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleBulkEstado = async (itemIds) => {
        if (!itemIds || itemIds.size === 0) return;
        const estado = bulkEstadoTarget === 'CONFIRMADO' ? 'ADJUDICADO' : bulkEstadoTarget;
        try {
            setLoading(true);
            await supabase.from('cliente_items').update({ estado }).in('id', [...itemIds]);
            setSelectedItems(new Set());
            await fetchData();
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    // Filtros y KPIs
    const displayItems = useMemo(() => {
        return items.filter(it => {
            // Filtro por Estado
            if (filterEstado !== 'todos') {
                if (filterEstado === 'PEDIDO') {
                    if (!it.estado.startsWith('PEDIDO') && !it.estado.startsWith('CONFIRMADO')) return false;
                    if (it.estado === 'EN TIENDA' || it.estado === 'ENTREGADO') return false;
                } else {
                    if (!it.estado.startsWith(filterEstado)) return false;
                }
            }

            // Filtro por Semana
            if (filterSemana !== 'todos' && it.semana_id !== filterSemana) return false;

            // Filtro por Busqueda (Nombre, Celular, Titulo)
            if (search) {
                const s = search.toLowerCase();
                const matchCliente = it.clientes?.nombre?.toLowerCase().includes(s) || it.clientes?.celular?.includes(s);
                const matchTitulo = it.titulo?.toLowerCase().includes(s);
                if (!matchCliente && !matchTitulo) return false;
            }

            // SEGURIDAD: Solo mis items si no soy admin
            if (!isAdmin && it.vendedor_id !== user?.id) return false;

            return true;
        });
    }, [items, filterEstado, filterSemana, search, isAdmin, user]);

    const totalPedidos = items.filter(i => {
        if (!isAdmin && i.vendedor_id !== user?.id) return false;
        return i.estado !== 'ENTREGADO';
    }).length;

    const ventasTotales = items.filter(i => isAdmin || i.vendedor_id === user?.id)
        .reduce((acc, i) => acc + (Number(i.precio_venta)||0), 0);
    const pagadoItems = items.filter(i => isAdmin || i.vendedor_id === user?.id)
        .reduce((acc, i) => acc + (Number(i.monto_pagado)||0), 0);
    const pagadoGral = pagos.filter(p => isAdmin || p.vendedor_id === user?.id)
        .reduce((acc, p) => acc + (Number(p.monto)||0), 0);
    const totalCobrado = pagadoItems + pagadoGral;
    const saldoPendiente = ventasTotales - totalCobrado;

    const [editingState, setEditingState] = useState(null);

    const groupedData = useMemo(() => {
        const groups = {};
        
        // 1. Determine which clients should be visible
        const visibleClients = clientes.filter(c => {
            if (isAdmin) return true;
            
            const hasMyItems = items.some(i => i.cliente_id === c.id);
            const matchesSearch = search && (c.nombre.toLowerCase().includes(search.toLowerCase()) || c.celular.includes(search));
            
            return hasMyItems || matchesSearch;
        });

        // Extrae el número de volumen al final del título, ej: "KUROSHITSUJI 21" → 21
        const extractVolNum = (titulo) => {
            const m = (titulo || '').match(/\s(\d+)\s*$/);
            return m ? parseInt(m[1], 10) : null;
        };
        // Extrae el prefijo sin número, ej: "KUROSHITSUJI 21" → "KUROSHITSUJI"
        const extractSerie = (titulo) => (titulo || '').replace(/\s\d+\s*$/, '').trim();

        const ESTADO_ORDER = { 'EN TIENDA': 0, 'ADJUDICADO': 1, 'CONFIRMADO': 1, 'PEDIDO': 2, 'ENTREGADO': 3 };
        const estadoOrder = (it) => {
            const e = it.estado || '';
            if (e === 'EN TIENDA') return 0;
            if (e === 'ADJUDICADO' || e.startsWith('CONFIRMADO')) return 1;
            if (e.startsWith('PEDIDO')) return 2;
            if (e === 'ENTREGADO') return 3;
            return 4;
        };

        visibleClients.forEach(c => {
            const myItems = items.filter(i => i.cliente_id === c.id);
            const others = otherSellersItems.filter(i => i.cliente_id === c.id);

            // If I am not admin and I have no items of my own AND I'm not searching for them, skip
            if (!isAdmin && myItems.length === 0 && !search) return;

            // Ordenar ítems: primero por estado (EN TIENDA > CONFIRMADO > PEDIDO > ENTREGADO),
            // luego por serie alfabética, luego por número de volumen ascendente
            const sortedItems = [...myItems].sort((a, b) => {
                const eA = estadoOrder(a), eB = estadoOrder(b);
                if (eA !== eB) return eA - eB;
                const sA = extractSerie(a.titulo), sB = extractSerie(b.titulo);
                if (sA !== sB) return sA.localeCompare(sB, 'es');
                const nA = extractVolNum(a.titulo), nB = extractVolNum(b.titulo);
                if (nA !== null && nB !== null) return nA - nB;
                return (a.titulo || '').localeCompare(b.titulo || '', 'es');
            });

            groups[c.id] = {
                client: c,
                items: sortedItems,
                others: others,
                pagos: pagos.filter(p => p.cliente_id === c.id).reduce((s,p) => s + Number(p.monto), 0)
            };
        });
        
        return Object.values(groups);
    }, [clientes, items, otherSellersItems, pagos, filterEstado, search, isAdmin, user]);

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

            {/* Toolbox: Tabs */}
            <div className="flex flex-col md:flex-row justify-between items-center bg-surface p-4 rounded-xl border border-border gap-4">
                <div className="flex bg-background rounded-lg p-1 border border-border">
                    <button onClick={()=>setView('clientes')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='clientes'?'bg-surface text-primary shadow-sm ring-1 ring-border/50':'text-muted hover:text-text'}`}>Por Cliente</button>
                    <button onClick={()=>setView('items')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='items'?'bg-surface text-primary shadow-sm ring-1 ring-border/50':'text-muted hover:text-text'}`}>Resumen Ítems</button>
                    <button onClick={()=>setView('hoja')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='hoja'?'bg-surface text-secondary shadow-sm ring-1 ring-border/50':'text-muted hover:text-text'}`}>📋 Hoja de Pedido</button>
                </div>
                <div className="text-[10px] font-black text-muted uppercase tracking-widest hidden md:block">Gestión de Cartera de Clientes</div>
            </div>
                
            {/* BARRA DE FILTROS MAESTROS */}
            <div className="bg-surface border border-primary/20 p-4 rounded-2xl shadow-sm flex flex-col xl:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full xl:max-w-md group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-primary transition-colors" size={18} />
                    <input 
                        type="text" 
                        placeholder="Buscar cliente, celular o título..." 
                        className="w-full bg-background border border-border/40 pl-12 pr-4 py-3 rounded-xl text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all shadow-inner"
                        value={search} onChange={e=>setSearch(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2 justify-center">
                    {[
                        { id: 'todos', label: 'TODOS', icon: Layers, color: 'text-text bg-muted/10 border-muted/20' },
                        { id: 'PEDIDO', label: 'PENDIENTES', icon: Calendar, color: 'text-primary bg-primary/10 border-primary/20' },
                        { id: 'EN TIENDA', label: 'EN TIENDA', icon: Box, color: 'text-success bg-success/10 border-success/20' },
                        { id: 'ENTREGADO', label: 'ENTREGADOS', icon: CheckSquare, color: 'text-muted bg-muted/5 border-border' },
                    ].map(btn => {
                        const count = btn.id === 'todos' ? items.length : items.filter(i => {
                            if (btn.id === 'PEDIDO') return i.estado.includes('PEDIDO') || i.estado.includes('CONFIRMADO');
                            return i.estado.startsWith(btn.id);
                        }).length;

                        return (
                            <button 
                                key={btn.id}
                                onClick={() => setFilterEstado(btn.id)}
                                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all font-black text-[10px] uppercase tracking-wider ${
                                    filterEstado === btn.id ? btn.color + ' ring-4 ring-offset-2 ring-primary/10' : 'bg-transparent border-transparent text-muted hover:bg-muted/10'
                                }`}
                            >
                                <btn.icon size={14} />
                                {btn.label}
                                <span className="ml-2 bg-black/10 px-2 py-0.5 rounded-full text-[9px] opacity-70">{count}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center gap-3 w-full xl:w-auto">
                    {selectedItems.size > 0 ? (
                        <div className="flex items-center gap-3 bg-error/10 border border-error/20 px-4 py-2 rounded-xl animate-in zoom-in-95">
                            <span className="text-[10px] font-black text-error uppercase whitespace-nowrap">{selectedItems.size} SELECCIONADOS</span>
                            <button 
                                onClick={handleBulkDelete}
                                className="bg-error text-white px-4 py-2 rounded-lg text-xs font-black uppercase hover:bg-error/80 transition-all flex items-center gap-2"
                            >
                                <Trash2 size={14} /> Eliminar Lote
                            </button>
                            <button 
                                onClick={() => setSelectedItems(new Set())}
                                className="text-muted hover:text-text p-2"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="relative group flex-1 xl:w-48">
                                <select 
                                    value={filterSemana} 
                                    onChange={e=>setFilterSemana(e.target.value)} 
                                    className="w-full bg-background border border-border/40 pl-4 pr-10 py-3 rounded-xl text-xs font-bold uppercase outline-none focus:border-primary transition-all appearance-none cursor-pointer"
                                >
                                    <option value="todos">📦 TODAS LAS SEMANAS</option>
                                    {semanas.map(s => <option key={s.id} value={s.id}>Semana: {s.nombre}</option>)}
                                </select>
                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none group-focus-within:text-primary transition-colors" size={16} />
                            </div>

                            <button onClick={() => setShowAddModal(true)} className="bg-primary text-background font-black px-6 py-3 rounded-xl text-xs flex items-center gap-2 hover:scale-105 transition-all shadow-xl shadow-primary/20 uppercase tracking-widest shrink-0">
                                <Plus size={18} /> Nuevo Pedido
                            </button>
                        </>
                    )}
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
                        const isCompact = compactClients.has(group.client.id);
                        const toggleCompact = () => setCompactClients(prev => { const n = new Set(prev); isCompact ? n.delete(group.client.id) : n.add(group.client.id); return n; });
                        const estadoCount = group.items.reduce((acc, it) => {
                            const key = it.estado === 'ADJUDICADO' ? 'CONFIRMADO' : it.estado === 'EN TIENDA' ? 'EN TIENDA' : it.estado === 'ENTREGADO' ? 'ENTREGADO' : 'PEDIDO';
                            acc[key] = (acc[key] || 0) + 1; return acc;
                        }, {});
                        const cVentas = group.items.reduce((s,i)=>s+Number(i.precio_venta||0), 0);
                        const cPagItems = group.items.reduce((s,i)=>s+Number(i.monto_pagado||0), 0);
                        const totalPagado = group.pagos > 0 ? group.pagos : cPagItems;
                        const balanceDisponible = Math.max(0, group.pagos - cPagItems);
                        const cDeuda = Math.max(0, cVentas - totalPagado);

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
                                            <div className="font-mono text-sm font-bold text-success">BS {formatS(totalPagado)}</div>
                                        </div>
                                        {balanceDisponible > 0 && (
                                            <div className="text-right">
                                                <div className="text-[10px] uppercase font-bold text-orange-500">Sin asignar</div>
                                                <div className="font-mono text-sm font-bold text-orange-500">BS {formatS(balanceDisponible)}</div>
                                            </div>
                                        )}
                                        <div className="text-right bg-error/10 px-3 py-1 rounded w-24">
                                            <div className="text-[10px] uppercase font-bold text-error">Saldo</div>
                                            <div className="font-mono text-sm font-bold text-error">BS {formatS(cDeuda)}</div>
                                        </div>

                                        <div className="flex items-center gap-2">
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
                                            </div>

                                            {isExp ? <ChevronUp size={20} className="text-muted ml-2 transition-transform" /> : <ChevronDown size={20} className="text-muted ml-2 transition-transform" />}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded Table */}
                                {isExp && (
                                    <div className="border-t border-border bg-background animate-in slide-in-from-top-2">
                                        {/* BARRA SUPERIOR: resumen + toggle compacto */}
                                        <div className="flex items-center justify-between gap-2 px-4 py-2 bg-surface/40 border-b border-border/40 flex-wrap">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {Object.entries(estadoCount).map(([estado, cnt]) => (
                                                    <span key={estado} className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                                                        estado === 'EN TIENDA' ? 'bg-success/10 border-success/30 text-success' :
                                                        estado === 'CONFIRMADO' ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
                                                        estado === 'ENTREGADO' ? 'bg-border/40 border-border text-muted' :
                                                        'bg-primary/10 border-primary/30 text-primary'
                                                    }`}>{estado}: {cnt}</span>
                                                ))}
                                                {cDeuda > 0 && <span className="text-[10px] font-black text-error font-mono">Saldo: BS {formatS(cDeuda)}</span>}
                                            </div>
                                            <button onClick={toggleCompact} className={`text-[10px] font-black uppercase px-2.5 py-1 rounded-lg border transition-all ${isCompact ? 'bg-primary text-white border-primary' : 'bg-transparent border-border text-muted hover:border-primary hover:text-primary'}`}>
                                                {isCompact ? '[ ] Normal' : '[=] Compacto'}
                                            </button>
                                        </div>
                                        <div className={`overflow-x-auto ${isCompact ? 'px-2 pb-2' : 'p-4'}`}>
                                            {/* BARRA DE ACCIÓN MASIVA */}
                                            {[...selectedItems].some(id => group.items.find(it => it.id === id)) && (() => {
                                                const groupSelected = new Set([...selectedItems].filter(id => group.items.find(it => it.id === id)));
                                                return (
                                                    <div className="flex items-center gap-3 mb-3 p-2.5 bg-primary/10 border border-primary/30 rounded-xl flex-wrap">
                                                        <span className="text-xs font-black text-primary">{groupSelected.size} ítem{groupSelected.size !== 1 ? 's' : ''} seleccionado{groupSelected.size !== 1 ? 's' : ''}</span>
                                                        <select value={bulkEstadoTarget} onChange={e => setBulkEstadoTarget(e.target.value)}
                                                            className="bg-background border border-primary/30 px-2 py-1 rounded-lg text-xs font-bold text-text outline-none focus:border-primary">
                                                            <option value="PEDIDO">PEDIDO</option>
                                                            <option value="CONFIRMADO">CONFIRMADO</option>
                                                            <option value="EN TIENDA">EN TIENDA</option>
                                                            <option value="ENTREGADO">ENTREGADO</option>
                                                        </select>
                                                        <button onClick={() => handleBulkEstado(groupSelected)}
                                                            className="px-3 py-1 bg-primary text-white text-xs font-black rounded-lg hover:brightness-105">
                                                            Aplicar
                                                        </button>
                                                        <button onClick={() => setSelectedItems(prev => { const n = new Set(prev); groupSelected.forEach(id => n.delete(id)); return n; })}
                                                            className="text-xs text-muted hover:text-error underline">
                                                            Limpiar
                                                        </button>
                                                    </div>
                                                );
                                            })()}
                                            <table className="w-full text-sm border-collapse">
                                                <thead>
                                                    <tr className="text-left text-muted text-[10px] uppercase bg-surface/60 border-b border-border">
                                                        <th className={`${isCompact ? 'py-1 px-2' : 'py-2 px-3'} w-8`}>
                                                            <input type="checkbox"
                                                                className="w-3.5 h-3.5 accent-primary cursor-pointer"
                                                                checked={group.items.length > 0 && group.items.every(it => selectedItems.has(it.id))}
                                                                onChange={e => setSelectedItems(prev => {
                                                                    const n = new Set(prev);
                                                                    group.items.forEach(it => e.target.checked ? n.add(it.id) : n.delete(it.id));
                                                                    return n;
                                                                })}
                                                            />
                                                        </th>
                                                        <th className={`${isCompact ? 'py-1 px-2' : 'py-2 px-3'}`}>Título / Producto</th>
                                                        <th className={`${isCompact ? 'py-1 px-2' : 'py-2 px-3'} text-right whitespace-nowrap`}>P. Venta</th>
                                                        <th className={`${isCompact ? 'py-1 px-2' : 'py-2 px-3'} text-right whitespace-nowrap`}>Pagado</th>
                                                        <th className={`${isCompact ? 'py-1 px-2' : 'py-2 px-3'} text-right whitespace-nowrap`}>Saldo</th>
                                                        <th className={`${isCompact ? 'py-1 px-2 w-36' : 'py-2 px-3 w-44'}`}>Estado</th>
                                                        {!isCompact && <th className="py-2 px-3 min-w-[100px]">Nota</th>}
                                                        <th className={`${isCompact ? 'py-1 px-1 w-10' : 'py-2 px-2 w-16'}`}></th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {/* PROPIOS ITEMS */}
                                                    {group.items.map(it => {
                                                        const iDeuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                                        const isEd = editingState === it.id;

                                                        const rp = isCompact ? 'py-1 px-2' : 'py-3 px-3';
                                                        return (
                                                            <tr key={it.id} className={`group border-b border-border/40 hover:bg-surface/50 align-middle ${selectedItems.has(it.id) ? 'bg-primary/5' : ''}`}>
                                                                <td className={`${rp} w-8`}>
                                                                    <input type="checkbox" className="w-3.5 h-3.5 accent-primary cursor-pointer"
                                                                        checked={selectedItems.has(it.id)}
                                                                        onChange={e => setSelectedItems(prev => { const n = new Set(prev); e.target.checked ? n.add(it.id) : n.delete(it.id); return n; })}
                                                                    />
                                                                </td>
                                                                <td className={`${rp} font-medium text-text`}>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Box size={isCompact ? 11 : 13} className="text-primary opacity-40 shrink-0" />
                                                                        <span className={isCompact ? 'text-xs' : ''}>{it.titulo}</span>
                                                                    </div>
                                                                </td>
                                                                <td className={`${rp} font-mono text-right whitespace-nowrap text-text ${isCompact ? 'text-[11px]' : 'text-xs'}`}>BS {formatS(it.precio_venta)}</td>
                                                                <td className={`${rp} font-mono text-right whitespace-nowrap text-success font-bold ${isCompact ? 'text-[11px]' : 'text-xs'}`}>BS {formatS(it.monto_pagado)}</td>
                                                                <td className={`${rp} font-mono text-right whitespace-nowrap font-bold ${isCompact ? 'text-[11px]' : 'text-xs'}`} style={{color: iDeuda > 0 ? 'var(--error)' : 'var(--success)'}}>BS {formatS(iDeuda)}</td>
                                                                <td className={`${rp} ${isCompact ? 'w-36' : 'w-44'}`}>
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
                                                                {!isCompact && <td className="py-3 px-3 text-[11px] text-muted max-w-[120px] truncate" title={it.nota}>{it.nota || '–'}</td>}
                                                                <td className={`${isCompact ? 'py-1 px-1' : 'py-2 px-2'} text-right`}>
                                                                    <div className="flex items-center justify-end gap-0.5">
                                                                    <button onClick={() => setEditItem({ id: it.id, titulo: it.titulo, precio_venta: it.precio_venta, estado: it.estado.split(' ')[0], semana_id: it.semana_id || '', nota: it.nota || '' })}
                                                                        className="text-muted hover:text-primary p-1 transition-colors opacity-0 group-hover:opacity-100">
                                                                        <Edit2 size={isCompact ? 12 : 14}/>
                                                                    </button>
                                                                    <button onClick={async()=>{
                                                                        if(!confirm('¿Eliminar este ítem del pedido?')) return;
                                                                        setLoading(true);
                                                                        try {
                                                                            let shouldRestore = false;
                                                                            if ((it.estado === 'EN TIENDA' || it.estado === 'ADJUDICADO') && (it.catalog_id || it.product_id)) {
                                                                                shouldRestore = true;
                                                                            } else if (it.estado === 'RESERVA' && it.semana_id) {
                                                                                const { data: sem } = await supabase.from('semanas').select('estado').eq('id', it.semana_id).maybeSingle();
                                                                                if (sem && (sem.estado === 'PEDIDA' || sem.estado === 'RECIBIDA')) {
                                                                                    shouldRestore = true;
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
                                                                            await fetchData(); await fetchCatalog();
                                                                        } catch(e){ console.error(e); }
                                                                        finally { setLoading(false); }
                                                                    }} className="text-muted hover:text-error p-1 transition-colors">
                                                                        <Trash2 size={isCompact ? 12 : 14}/>
                                                                    </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}

                                                    {/* ITEMS DE OTROS SOCIOS (Coordina envío) */}
                                                    {group.others?.length > 0 && (
                                                        <>
                                                            <tr className="bg-muted/5 border-t-2 border-primary/10">
                                                                <td colSpan={7} className="p-3">
                                                                    <div className="flex items-center gap-2 text-[10px] font-black text-primary uppercase tracking-widest">
                                                                        <RefreshCw size={12} className="animate-spin-slow" /> Pedidos de otros socios (Para envío conjunto)
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                            {group.others.map(oit => (
                                                                <tr key={oit.id} className="bg-muted/5 border-b border-border/20 opacity-70 align-top">
                                                                    <td className="py-3 px-3"></td>
                                                                    <td className="py-3 px-3 text-xs font-medium italic">{oit.titulo}</td>
                                                                    <td className="py-3 px-3 text-xs font-mono text-right whitespace-nowrap">BS {formatS(oit.precio_venta)}</td>
                                                                    <td className="py-3 px-3 text-xs font-mono text-right whitespace-nowrap text-success">BS {formatS(oit.monto_pagado)}</td>
                                                                    <td className="py-3 px-3 text-xs font-mono text-right whitespace-nowrap text-error">BS {formatS(oit.precio_venta - oit.monto_pagado)}</td>
                                                                    <td className="py-3 px-3">
                                                                        {renderStatus(oit)}
                                                                    </td>
                                                                    <td colSpan={2} className="py-3 px-3 text-[10px] text-muted italic">
                                                                        Vendido por otro socio
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* HISTORIAL DE PAGOS */}
                                        {(() => {
                                            const clientePagos = pagos.filter(p => p.cliente_id === group.client.id).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                                            if (clientePagos.length === 0) return null;
                                            const METHOD_ICON = { 'Efectivo': '💵', 'Yasta (QR)': '📲', 'Banco Unión (QR/Transf)': '🏦', 'BNB': '🏛️', 'Otros': '💳' };
                                            return (
                                                <div className="mt-3 pt-3 border-t border-border/40">
                                                    <div className="text-[9px] font-black uppercase text-muted tracking-widest mb-2 flex items-center gap-2">
                                                        <span>Historial de Pagos</span>
                                                        <span className="text-primary font-black">({clientePagos.length})</span>
                                                    </div>
                                                    <div className="space-y-1">
                                                        {clientePagos.map(p => (
                                                            <div key={p.id} className="flex items-center justify-between bg-background/60 rounded-lg px-3 py-1.5 border border-border/30 group hover:border-border/60 transition-colors">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span className="text-sm leading-none">{METHOD_ICON[p.metodo_pago] || '💳'}</span>
                                                                    <div className="min-w-0">
                                                                        <div className="text-[10px] font-bold text-text truncate">{p.concepto || 'Abono'}</div>
                                                                        <div className="text-[9px] text-muted">{p.metodo_pago || 'Efectivo'} · {new Date(p.fecha || p.created_at).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-1 ml-2 shrink-0">
                                                                    <span className="text-success font-black text-xs font-mono">+BS {formatS(p.monto)}</span>
                                                                    <button onClick={() => setEditPago({ id: p.id, concepto: p.concepto || '', monto: p.monto, metodo_pago: p.metodo_pago || 'Yasta (QR)', caja_mov_id: p.caja_mov_id })}
                                                                        title="Editar pago"
                                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/10 text-muted hover:text-primary transition-all">
                                                                        <Edit2 size={11} />
                                                                    </button>
                                                                    <button onClick={() => handleDeletePago(p)} title="Eliminar pago"
                                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-all">
                                                                        <Trash2 size={11} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })()}
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
                                <option value="SIGUIENTE">⭐️ PRÓXIMO PEDIDO (Siguiente)</option>
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
                                        if (selectedSemanaHoja === 'SIGUIENTE') {
                                            if (i.estado !== 'PEDIDO (Siguiente)') return false;
                                        } else {
                                            if (selectedSemanaHoja && i.semana_id !== selectedSemanaHoja) return false;
                                            if (!selectedSemanaHoja && i.estado === 'PEDIDO (Siguiente)') return false;
                                        }

                                        if (!isAdmin && i.vendedor_id !== user?.id) return false;
                                        if (!i.titulo) return false;
                                        const term = search.toLowerCase();
                                        return i.titulo.toLowerCase().includes(term);
                                    });

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
                                <th className="p-4 w-10 text-center">
                                    <input 
                                        type="checkbox" 
                                        className="w-4 h-4 accent-primary cursor-pointer"
                                        checked={displayItems.length > 0 && selectedItems.size === displayItems.length}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedItems(new Set(displayItems.map(i => i.id)));
                                            } else {
                                                setSelectedItems(new Set());
                                            }
                                        }}
                                    />
                                </th>
                                <th className="p-4">Cliente</th>
                                <th className="p-4">Título</th>
                                <th className="p-4">P. Venta</th>
                                <th className="p-4">Cobrado</th>
                                <th className="p-4 text-center">Estado</th>
                                <th className="p-4 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {displayItems.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-muted">No hay ítems</td></tr>}
                            {displayItems.map(it => (
                                <tr key={it.id} className={`border-b border-border/50 hover:bg-white/5 transition-colors ${selectedItems.has(it.id) ? 'bg-primary/5' : ''}`}>
                                    <td className="p-4 text-center">
                                        <input 
                                            type="checkbox" 
                                            className="w-4 h-4 accent-primary cursor-pointer"
                                            checked={selectedItems.has(it.id)}
                                            onChange={() => {
                                                const next = new Set(selectedItems);
                                                if (next.has(it.id)) next.delete(it.id);
                                                else next.add(it.id);
                                                setSelectedItems(next);
                                            }}
                                        />
                                    </td>
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
                                        <div className="flex items-center justify-end gap-1">
                                        <button onClick={() => setEditItem({ id: it.id, titulo: it.titulo, precio_venta: it.precio_venta, estado: it.estado.split(' ')[0], semana_id: it.semana_id || '', nota: it.nota || '' })}
                                            className="text-muted hover:text-primary p-1 transition-colors">
                                            <Edit2 size={14}/>
                                        </button>
                                        <button onClick={async()=>{
                                            if(confirm('¿Eliminar este ítem del pedido?')) {
                                                let shouldRestore = false;
                                                if (it.estado === 'EN TIENDA' && (it.catalog_id || it.product_id)) {
                                                    shouldRestore = true;
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
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}


            {/* MODAL: EDITAR ÍTEM */}
            {editItem && (
                <div className="fixed inset-0 z-[10020] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-sm p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-text flex items-center gap-2">
                                <Edit2 size={15} className="text-primary" /> Editar Ítem
                            </h3>
                            <button onClick={() => setEditItem(null)} className="text-muted hover:text-text"><X size={18}/></button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Título</label>
                                <input type="text" value={editItem.titulo} onChange={e => setEditItem({...editItem, titulo: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary"/>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Precio Venta BS</label>
                                <input type="number" value={editItem.precio_venta} onChange={e => setEditItem({...editItem, precio_venta: e.target.value})} onFocus={e => e.target.select()}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm font-mono outline-none focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"/>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Estado</label>
                                <select value={editItem.estado} onChange={e => setEditItem({...editItem, estado: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary">
                                    <option value="PEDIDO">PEDIDO</option>
                                    <option value="CONFIRMADO">CONFIRMADO</option>
                                    <option value="EN TIENDA">EN TIENDA</option>
                                    <option value="ENTREGADO">ENTREGADO</option>
                                </select>
                            </div>
                            {(editItem.estado === 'PEDIDO' || editItem.estado === 'CONFIRMADO') && (
                                <div>
                                    <label className="block text-[10px] font-black uppercase text-muted mb-1">Semana</label>
                                    <select value={editItem.semana_id || ''} onChange={e => setEditItem({...editItem, semana_id: e.target.value})}
                                        className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary">
                                        <option value="">Sin semana asignada</option>
                                        {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                    </select>
                                </div>
                            )}
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Nota</label>
                                <input type="text" value={editItem.nota} onChange={e => setEditItem({...editItem, nota: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary" placeholder="Opcional..."/>
                            </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button onClick={() => setEditItem(null)} className="flex-1 py-2 rounded-xl text-sm font-bold text-muted bg-background border border-border hover:border-primary/40">Cancelar</button>
                            <button onClick={handleUpdateItem} disabled={loading} className="flex-1 py-2 rounded-xl text-sm font-black text-white bg-primary hover:brightness-105 shadow disabled:opacity-50">Guardar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ADD MODAL */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-hidden text-[#222]">
                    <div className="bg-surface w-full max-w-[1700px] rounded-2xl border border-border flex flex-col min-h-[85vh] max-h-[95vh] shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-border flex justify-between items-center bg-background rounded-t-2xl shrink-0">
                            <h2 className="text-lg font-bold font-display text-text flex items-center gap-2">
                                <Plus className="text-primary"/> Nueva Venta / Pedido
                                {modoHistorico && <span className="bg-orange-400/20 text-orange-500 border border-orange-400/40 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest">MODO HISTÓRICO</span>}
                            </h2>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                    <input type="checkbox" checked={modoHistorico} onChange={e => { setModoHistorico(e.target.checked); setHistSemana(''); }} className="w-3.5 h-3.5 accent-orange-400"/>
                                    <span className="text-[9px] font-black uppercase text-muted tracking-widest">Histórico</span>
                                </label>
                                {cart.length > 0 && <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-[10px] font-black animate-pulse uppercase tracking-widest">{cart.length} ITEMS EN CESTA</span>}
                                <button onClick={()=>{setShowAddModal(false); setCart([]); setModoHistorico(false); setHistSemana('');}} className="text-muted hover:text-text transition-colors p-2 hover:bg-muted/20 rounded-full"><X size={20}/></button>
                            </div>
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-6 custom-scrollbar pb-64">
                            {/* DATOS CLIENTE (GRID RESPONSIVO) */}
                            <div className="p-4 bg-background/40 border border-border/60 rounded-2xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end shadow-inner mb-6">
                                <div>
                                    <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest">Celular</label>
                                    <input type="text" value={addForm.celular} onChange={e=>{
                                        const val = e.target.value;
                                        const cli = clientes.find(c=>c.celular===val);
                                        if(cli) setAddForm({...addForm, celular:val, nombre:cli.nombre, ci:cli.ci||'', ciudad:cli.ciudad||'', sucursal:cli.sucursal||'', direccion:cli.direccion||'', notas_cliente:cli.notas||''});
                                        else setAddForm({...addForm, celular:val});
                                    }} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="6XXXXXXX..."/>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest">Nombre Completo</label>
                                    <input type="text" value={addForm.nombre} onChange={e=>setAddForm({...addForm, nombre:e.target.value.toUpperCase()})} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="Opcional..."/>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest">Carnet (CI)</label>
                                    <input type="text" value={addForm.ci} onChange={e=>setAddForm({...addForm, ci:e.target.value})} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="Opcional..."/>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest">Ciudad</label>
                                    <input type="text" value={addForm.ciudad} onChange={e=>setAddForm({...addForm, ciudad:e.target.value.toUpperCase()})} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="Eje: Tarija..."/>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest">Sucursal/Dirección</label>
                                    <input type="text" value={addForm.sucursal} onChange={e=>setAddForm({...addForm, sucursal:e.target.value.toUpperCase()})} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="Opcional..."/>
                                </div>
                            </div>

                            <div className="flex flex-col lg:flex-row gap-6 items-start">
                                {/* SECCIÓN IZQUIERDA: SELECCIÓN DE PRODUCTOS */}
                                <div className="w-full lg:w-[400px] shrink-0 bg-surface border border-border/40 p-5 rounded-2xl shadow-xl flex flex-col gap-5">
                                    <div className="flex items-center justify-between border-b border-border/10 pb-4">
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase text-primary tracking-widest">
                                            <div className="w-2 h-2 rounded-full bg-primary animate-pulse"/> Selección
                                        </div>
                                        <div className="flex bg-background p-1 rounded-xl border border-border">
                                            <button onClick={()=>setAddForm({...addForm, mode:'individual'})} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${addForm.mode==='individual'?'bg-surface text-primary shadow-md':'text-muted-2'}`}>Individual</button>
                                            <button onClick={()=>setAddForm({...addForm, mode:'bulk'})} className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all ${addForm.mode!=='individual'?'bg-surface text-secondary shadow-md':'text-muted-2'}`}>Lote</button>
                                        </div>
                                    </div>

                                    {addForm.mode === 'individual' ? (
                                        <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-left-2 duration-300">
                                            <div>
                                                <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-[0.2em] pl-1">Buscar Manga / Cómic</label>
                                                <div className="relative group">
                                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted group-focus-within:text-primary transition-colors" size={16}/>
                                                    <input 
                                                        type="text" 
                                                        value={addForm.titulo} 
                                                        onChange={e=>handleSearchCatalog(e.target.value)}
                                                        className="w-full bg-background border-2 border-border/50 pl-10 pr-4 py-3 rounded-xl text-sm font-bold text-text outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all shadow-sm"
                                                        placeholder="Eje: Berserk 01..."
                                                    />
                                                    {showSuggestions && catalogSuggestions.length > 0 && (
                                                        <div className="absolute top-full left-0 w-full mt-2 bg-surface border border-border rounded-xl shadow-2xl z-[200] max-h-48 overflow-y-auto p-1 animate-in slide-in-from-top-2">
                                                            {catalogSuggestions.map(item => (
                                                                <div key={item.id} onClick={()=>selectSuggestion(item)} className="p-2.5 rounded-lg hover:bg-primary/5 cursor-pointer border border-transparent hover:border-primary/20 transition-all flex justify-between items-center group">
                                                                    <div className="flex flex-col">
                                                                        <span className="text-[11px] font-bold text-text/80 group-hover:text-primary leading-tight">{item.titulo}</span>
                                                                        <span className="text-[9px] text-muted-2 uppercase">{item.editorial}</span>
                                                                    </div>
                                                                    <span className="text-[9px] font-black text-muted opacity-60">BS {item.precio_venta_bs || item.precio_tapa}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-1">
                                                    <label className="block text-[10px] font-black uppercase text-center text-muted">Precio</label>
                                                    <input type="number" step="0.01" value={addForm.precio_venta} onChange={e=>{
                                                        const base = e.target.value;
                                                        const pct = Number(addForm.descuento)||0;
                                                        const final = Number(base) - (Number(base) * (pct/100));
                                                        setAddForm({...addForm, precio_venta: base, precio_final: final.toFixed(2)});
                                                    }} className="w-full bg-background border border-border px-3 py-2.5 rounded-xl text-xs text-text outline-none focus:border-primary font-mono text-center shadow-inner"/>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="block text-[10px] font-black uppercase text-center text-error/80">Desc. %</label>
                                                    <input type="number" step="0.1" value={addForm.descuento} onFocus={e=>e.target.select()} onChange={e=>{
                                                        const pct = e.target.value;
                                                        const base = Number(addForm.precio_venta)||0;
                                                        const final = base - (base * (Number(pct)||0) / 100);
                                                        setAddForm({...addForm, descuento: pct, precio_final: final.toFixed(2)});
                                                    }} className="w-full bg-background border border-border px-4 py-2.5 rounded-xl text-xs text-error font-bold outline-none focus:border-error font-mono text-center shadow-inner [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" placeholder="%"/>
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="block text-[10px] font-black uppercase text-center text-primary">Final BS</label>
                                                    <input type="number" step="0.01" value={addForm.precio_final} onChange={e=>{
                                                        const final = e.target.value;
                                                        const base = Number(addForm.precio_venta)||0;
                                                        const pct = base > 0 ? ((1 - Number(final) / base) * 100).toFixed(1) : "0.0";
                                                        setAddForm({...addForm, precio_final: final, descuento: pct});
                                                    }} className="w-full bg-primary/5 border border-primary/20 px-3 py-2.5 rounded-xl text-xs text-primary font-black outline-none focus:border-primary font-mono text-center shadow-inner"/>
                                                </div>
                                            </div>

                                            {modoHistorico ? (
                                                <div className="flex flex-col gap-3">
                                                    <div className="space-y-1">
                                                        <label className="block text-[10px] font-black uppercase text-center text-orange-500/80">Semana</label>
                                                        <select value={addForm.hist_semana_id || ''} onChange={e => setAddForm({...addForm, hist_semana_id: e.target.value})}
                                                            className="w-full bg-background border border-orange-400/30 px-3 py-2.5 rounded-xl text-xs font-bold text-text outline-none focus:border-orange-400">
                                                            <option value="">Sin semana asignada</option>
                                                            {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                                        </select>
                                                    </div>
                                                    <div className="space-y-1">
                                                        <label className="block text-[10px] font-black uppercase text-center text-orange-500/80">Estado</label>
                                                        <select value={addForm.hist_estado || 'PEDIDO'} onChange={e => setAddForm({...addForm, hist_estado: e.target.value})}
                                                            className="w-full bg-background border border-orange-400/30 px-3 py-2.5 rounded-xl text-xs font-bold text-text outline-none focus:border-orange-400">
                                                            <option value="PEDIDO">PEDIDO</option>
                                                            <option value="CONFIRMADO">CONFIRMADO</option>
                                                            <option value="EN TIENDA">EN TIENDA</option>
                                                            <option value="ENTREGADO">ENTREGADO</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            ) : (
                                            <div className="relative">
                                                <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 text-center tracking-widest">Asignar de:</label>
                                                <div
                                                    onClick={() => setDropdownOpen(!dropdownOpen)}
                                                    className={`w-full bg-background border-2 px-3 py-3 rounded-xl text-[10px] font-black uppercase cursor-pointer flex items-center justify-between transition-all select-none hover:shadow-md ${
                                                        selectedStockSource === 'fisico' ? 'border-success text-success bg-success/5' : 
                                                        selectedStockSource.includes('flotante_conf') ? 'border-primary text-primary bg-primary/5' : 
                                                        selectedStockSource.includes('flotante_noc') ? 'border-orange-400 text-orange-400 bg-orange-400/5' : 
                                                        selectedStockSource === 'pedido_PENDIENTE' ? 'border-purple-500 text-purple-500' :
                                                        'border-border text-muted'
                                                    }`}
                                                >
                                                    <div className="truncate flex items-center gap-2">
                                                        {(() => {
                                                            if (selectedStockSource === 'fisico') return "✨ STOCK FÍSICO";
                                                            if (selectedStockSource === 'pedido_PENDIENTE') return "🚀 PRÓXIMO PEDIDO";
                                                            if (selectedStockSource.includes('flotante')) {
                                                                const id = selectedStockSource.split('_').pop();
                                                                const fl = stockAnalysis?.flotantes.find(x => x.id == id);
                                                                return fl ? `${fl.isConfirmed?'✅':'⏳'} ${fl.nombre}` : "---";
                                                            }
                                                            if (selectedStockSource.includes('pedido_')) {
                                                                const id = selectedStockSource.split('_').pop();
                                                                const s = semanas.find(x => x.id == id);
                                                                return s ? `📂 P/ ${s.nombre}` : "---";
                                                            }
                                                            return "SELECCIONE ORIGEN";
                                                        })()}
                                                    </div>
                                                    <ChevronDown size={14} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                                                </div>

                                                {dropdownOpen && (
                                                    <div className="absolute bottom-full mb-2 left-0 w-full bg-surface border border-border rounded-xl shadow-2xl z-[200] overflow-hidden animate-in zoom-in-95 duration-200">
                                                        <div className="max-h-[200px] overflow-y-auto p-1.5 flex flex-col gap-1.5">
                                                            {stockAnalysis?.fisico > 0 && (
                                                                <div onClick={() => { setSelectedStockSource('fisico'); setDropdownOpen(false); }} className="p-2.5 rounded-lg hover:bg-success/10 border border-transparent hover:border-success/30 cursor-pointer transition-all flex justify-between items-center">
                                                                    <span className="text-success font-black text-[9px]">✨ STOCK FÍSICO</span>
                                                                    <span className="bg-success text-background px-2 py-0.5 rounded-full text-[8px] font-bold">{stockAnalysis.fisico} U.</span>
                                                                </div>
                                                            )}
                                                            {stockAnalysis?.flotantes.map(flot => (
                                                                <div key={flot.id} onClick={() => { setSelectedStockSource(flot.isConfirmed ? `flotante_conf_${flot.id}` : `flotante_noc_${flot.id}`); setDropdownOpen(false); }} className={`p-2.5 rounded-lg cursor-pointer transition-all border border-transparent ${flot.isConfirmed? 'hover:bg-primary/10 hover:border-primary/20 bg-primary/5':'hover:bg-orange-400/10 hover:border-orange-400/20 bg-orange-400/5'}`}>
                                                                    <div className="flex justify-between items-center">
                                                                        <span className={`font-black text-[9px] ${flot.isConfirmed ? 'text-primary' : 'text-orange-400'}`}>
                                                                            {flot.isConfirmed ? '✅' : '⏳'} {flot.nombre}
                                                                        </span>
                                                                        <span className="text-[8px] opacity-60 font-mono italic">{flot.qty} U.</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                            {semanas.filter(s => s.abierta).map(s => (
                                                                <div key={s.id} onClick={() => { setSelectedStockSource(`pedido_${s.id}`); setDropdownOpen(false); }} className="p-2.5 rounded-lg hover:bg-muted/30 cursor-pointer text-[9px] font-bold text-muted">
                                                                    📂 Encargar para {s.nombre}
                                                                </div>
                                                            ))}
                                                            <div onClick={() => { setSelectedStockSource('pedido_PENDIENTE'); setDropdownOpen(false); }} className="p-3 rounded-xl bg-purple-500/5 hover:bg-purple-500/10 border border-dashed border-purple-500/20 cursor-pointer text-center">
                                                                <span className="text-purple-500 font-black text-[9px]">🚀 PRÓXIMO PEDIDO (Automático)</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            )}

                                            <button onClick={()=>{
                                                if(!modoHistorico && !selectedStockSource) return alert("Selecciona origen de stock");
                                                addToCart();
                                                setDropdownOpen(false);
                                            }} disabled={!addForm.titulo || loading} className="w-full py-4 bg-primary text-background font-black text-xs uppercase tracking-widest rounded-xl hover:scale-[1.02] active:scale-95 transition-all shadow-lg shadow-primary/20 disabled:opacity-50">
                                                Añadir al Pedido
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-left-2 duration-300">
                                            <div className="space-y-1.5">
                                                <label className="block text-[10px] font-black uppercase text-muted/80 pl-1">Colección</label>
                                                <input type="text" value={bulkSearch} onChange={e=>setBulkSearch(e.target.value)} onBlur={()=>searchBulkCatalog(bulkSearch)} className="w-full bg-background border border-border px-3 py-3 rounded-xl text-sm font-bold text-text outline-none focus:border-secondary shadow-sm" placeholder="Ej: Dragon Ball Deluxe..."/>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="block text-[10px] font-black uppercase text-muted/80 pl-1">Rango de Tomos</label>
                                                <div className="flex gap-2">
                                                    <input type="text" value={bulkRange} onChange={e=>setBulkRange(e.target.value)} className="w-full bg-background border border-border px-3 py-3 rounded-xl text-sm font-mono font-bold" placeholder="Ej: 1-5, 8..."/>
                                                    <button onClick={applyBulkRange} className="px-4 bg-muted text-[10px] font-black uppercase rounded-xl border border-border hover:bg-muted/80 transition-colors">OK</button>
                                                </div>
                                            </div>
                                            {bulkResults.length > 0 && (
                                                <div className="bg-background border border-border rounded-xl p-2 max-h-40 overflow-y-auto flex flex-col gap-1 shadow-inner">
                                                    {bulkResults.map(p => (
                                                        <label key={p.id} className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all ${bulkSelected.has(p.id) ? 'bg-secondary/10 border-secondary shadow-sm':'border-transparent hover:bg-muted/20'}`}>
                                                            <input type="checkbox" checked={bulkSelected.has(p.id)} onChange={()=>toggleBulkItem(p.id)} className="w-4 h-4 accent-secondary" />
                                                            <span className="text-[10px] font-black text-text truncate uppercase flex-1">{p.titulo}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                            <button onClick={addToCart} disabled={bulkSelected.size === 0 || loading} className="w-full py-4 bg-secondary text-background font-black text-xs uppercase tracking-widest rounded-xl hover:scale-[1.02] transition-all">
                                                Añadir Lote ({bulkSelected.size})
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* SECCIÓN DERECHA: CARRITO Y RESUMEN */}
                                <div className="flex-1 min-w-0 bg-surface border border-border/40 p-5 rounded-2xl shadow-xl flex flex-col gap-5 min-h-[400px]">
                                    <div className="flex items-center justify-between border-b border-border/10 pb-4">
                                        <h3 className="text-[10px] font-black uppercase text-secondary tracking-widest flex items-center gap-2">
                                            <ShoppingBag size={14}/> Detalle del Pedido
                                        </h3>
                                        {cart.length > 0 && (
                                            <div className="flex gap-2">
                                                <button onClick={()=>setCart([])} className="p-1.5 text-muted hover:text-error transition-colors"><Trash2 size={16}/></button>
                                            </div>
                                        )}
                                    </div>

                                    {cart.length > 0 ? (
                                        <div className="flex flex-col gap-5 flex-1">
                                            {/* ACCIONES RÁPIDAS */}
                                            <div className="bg-background/50 border border-border/40 p-3 rounded-xl flex flex-wrap items-center gap-4 shadow-inner">
                                                <div className="text-[9px] font-black uppercase text-muted tracking-widest border-r border-border/40 pr-4 mr-2">Acciones Rápidas</div>
                                                
                                                <div className="flex items-center gap-2">
                                                    <div className="relative">
                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-error opacity-50">%</span>
                                                        <input 
                                                            type="number" 
                                                            value={batchDiscount} 
                                                            onChange={e => setBatchDiscount(e.target.value)}
                                                            className="w-20 bg-surface border border-error/20 pl-6 pr-2 py-1.5 rounded-lg text-xs font-mono font-bold text-error outline-none focus:border-error"
                                                            placeholder="0.0"
                                                        />
                                                    </div>
                                                    <button 
                                                        onClick={applyBatchDiscount}
                                                        className="bg-error/10 hover:bg-error text-error hover:text-white px-3 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all border border-error/20"
                                                    >
                                                        Desc. Todos
                                                    </button>
                                                </div>

                                            </div>

                                            {modoHistorico && (
                                                <div className="flex items-center gap-3 flex-wrap bg-orange-400/5 border border-orange-400/20 rounded-xl p-3">
                                                    <span className="text-[9px] font-black uppercase text-orange-500 tracking-widest">Asignar todos a semana:</span>
                                                    <select value={histSemana} onChange={e => {
                                                        setHistSemana(e.target.value);
                                                        setCart(cart.map(c => ({...c, hist_semana_id: e.target.value || null})));
                                                    }} className="bg-background border border-orange-400/30 px-3 py-1.5 rounded-lg text-xs font-bold text-text outline-none focus:border-orange-400">
                                                        <option value="">Sin semana asignada</option>
                                                        {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                                    </select>
                                                    {histSemana && (
                                                        <span className="text-[10px] text-orange-400/70 font-bold">← se aplica a todos los ítems</span>
                                                    )}
                                                </div>
                                            )}

                                            {/* BARRA BULK CARRITO HISTÓRICO */}
                                            {modoHistorico && cartSelected.size > 0 && (
                                                <div className="flex items-center gap-3 mb-2 p-2.5 bg-orange-400/10 border border-orange-400/30 rounded-xl flex-wrap">
                                                    <span className="text-xs font-black text-orange-500">{cartSelected.size} seleccionado{cartSelected.size !== 1 ? 's' : ''}</span>
                                                    <select value={cartBulkSemana} onChange={e => setCartBulkSemana(e.target.value)}
                                                        className="bg-background border border-orange-400/30 px-2 py-1 rounded-lg text-xs font-bold text-text outline-none focus:border-orange-400">
                                                        <option value="">Sin semana</option>
                                                        {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                                    </select>
                                                    <select value={cartBulkEstado} onChange={e => setCartBulkEstado(e.target.value)}
                                                        className="bg-background border border-orange-400/30 px-2 py-1 rounded-lg text-xs font-black uppercase text-orange-500 outline-none focus:border-orange-400">
                                                        <option value="PEDIDO">PEDIDO</option>
                                                        <option value="CONFIRMADO">CONFIRMADO</option>
                                                        <option value="EN TIENDA">EN TIENDA</option>
                                                        <option value="ENTREGADO">ENTREGADO</option>
                                                    </select>
                                                    <button onClick={() => {
                                                        setCart(cart.map((c, i) => cartSelected.has(i)
                                                            ? { ...c, hist_semana_id: cartBulkSemana || null, hist_estado: cartBulkEstado }
                                                            : c
                                                        ));
                                                        setCartSelected(new Set());
                                                    }} className="px-3 py-1 bg-orange-400 text-white text-xs font-black rounded-lg hover:brightness-105">
                                                        Aplicar
                                                    </button>
                                                    <button onClick={() => setCartSelected(new Set())} className="text-xs text-muted hover:text-error underline">Limpiar</button>
                                                </div>
                                            )}

                                            <div className="overflow-x-auto border border-border/30 rounded-xl bg-background/20 shadow-inner">
                                                <table className="w-full text-[11px] text-left">
                                                    <thead className="bg-background/80 text-[8px] font-black uppercase text-muted tracking-widest border-b border-border sticky top-0 z-10">
                                                        <tr>
                                                            {modoHistorico && (
                                                                <th className="px-2 py-3 w-8">
                                                                    <input type="checkbox" className="w-3.5 h-3.5 accent-orange-400 cursor-pointer"
                                                                        checked={cart.length > 0 && cartSelected.size === cart.length}
                                                                        onChange={e => setCartSelected(e.target.checked ? new Set(cart.map((_, i) => i)) : new Set())}
                                                                    />
                                                                </th>
                                                            )}
                                                            <th className="px-3 py-3">Título / Ítem</th>
                                                            <th className="px-3 py-3 text-center w-24">Precio</th>
                                                            <th className="px-3 py-3 text-center w-20">Desc%</th>
                                                            <th className="px-3 py-3 text-center w-24">Final BS</th>
                                                            {modoHistorico ? (<>
                                                                <th className="px-3 py-3 text-center w-40">Semana</th>
                                                                <th className="px-3 py-3 text-center w-32">Estado</th>
                                                            </>) : (<>
                                                                <th className="px-3 py-3 text-center w-64">Asignación</th>
                                                                <th className="px-3 py-3 text-center w-36">Llegada Aproximada</th>
                                                            </>)}
                                                            <th className="px-3 py-3 w-10"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-border/20">
                                                        {cart.map((c, i) => (
                                                            <tr key={i} className={`hover:bg-primary/5 transition-colors border-b border-border/5 ${cartSelected.has(i) ? 'bg-orange-400/5' : ''}`}>
                                                                {modoHistorico && (
                                                                    <td className="px-2 py-2.5 w-8">
                                                                        <input type="checkbox" className="w-3.5 h-3.5 accent-orange-400 cursor-pointer"
                                                                            checked={cartSelected.has(i)}
                                                                            onChange={e => setCartSelected(prev => { const n = new Set(prev); e.target.checked ? n.add(i) : n.delete(i); return n; })}
                                                                        />
                                                                    </td>
                                                                )}
                                                                <td className="px-3 py-2.5 max-w-[280px] font-bold text-text truncate" title={c.titulo}>{c.titulo}</td>
                                                                
                                                                <td className="px-2 py-2.5 text-center">
                                                                    <input type="number" step="0.01" value={c.precio_original} onChange={(e)=>updateCartItem(i, 'precio_original', e.target.value)}
                                                                        className="w-20 bg-background border border-border/40 rounded px-2 py-1.5 text-center font-mono text-muted outline-none focus:border-primary shadow-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"/>
                                                                </td>

                                                                <td className="px-2 py-2.5 text-center">
                                                                    <input type="number" step="0.1" value={c.descuento} onFocus={e=>e.target.select()} onChange={(e)=>updateCartItem(i, 'descuento', e.target.value)}
                                                                        className="w-16 bg-background border border-border/40 rounded px-2 py-1.5 text-center font-mono text-error outline-none focus:border-error shadow-sm font-bold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"/>
                                                                </td>

                                                                <td className="px-2 py-2.5 text-center">
                                                                    <input type="number" step="0.01" value={c.precio_venta} onChange={(e)=>updateCartItem(i, 'precio_venta', e.target.value)}
                                                                        className="w-20 bg-primary/5 border border-primary/20 rounded px-2 py-1.5 text-center font-mono font-black text-primary outline-none focus:border-primary shadow-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"/>
                                                                </td>

                                                                {modoHistorico ? (<>
                                                                    <td className="px-2 py-2.5 text-center">
                                                                        <select value={c.hist_semana_id || ''} onChange={e => {
                                                                            const next = [...cart];
                                                                            next[i] = {...c, hist_semana_id: e.target.value || null};
                                                                            setCart(next);
                                                                        }} className="bg-background border border-orange-400/30 px-2 py-1.5 rounded text-[9px] font-bold text-text outline-none focus:border-orange-400 max-w-[150px]">
                                                                            <option value="">Sin semana</option>
                                                                            {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                                                        </select>
                                                                    </td>
                                                                    <td className="px-2 py-2.5 text-center">
                                                                        <select value={c.hist_estado || 'PEDIDO'} onChange={e => {
                                                                            const next = [...cart];
                                                                            next[i] = {...c, hist_estado: e.target.value};
                                                                            setCart(next);
                                                                        }} className="bg-background border border-orange-400/30 px-2 py-1.5 rounded text-[9px] font-black uppercase text-orange-500 outline-none focus:border-orange-400">
                                                                            <option value="PEDIDO">PEDIDO</option>
                                                                            <option value="CONFIRMADO">CONFIRMADO</option>
                                                                            <option value="EN TIENDA">EN TIENDA</option>
                                                                            <option value="ENTREGADO">ENTREGADO</option>
                                                                        </select>
                                                                    </td>
                                                                </>) : (<>
                                                                <td className="px-2 py-2.5 text-center">
                                                                    <select
                                                                        value={c.source || 'pedido_PENDIENTE'}
                                                                        onChange={(e)=>{
                                                                            const next = [...cart];
                                                                            const source = e.target.value;
                                                                            let semana_id = null;
                                                                            if (source.startsWith('pedido_')) {
                                                                                const sId = source.split('_')[1];
                                                                                if (sId !== 'PENDIENTE') semana_id = sId;
                                                                            } else if (source.startsWith('flotante_')) {
                                                                                semana_id = source.split('_').pop();
                                                                            }
                                                                            next[i] = {...c, source, semana_id};
                                                                            setCart(next);
                                                                        }}
                                                                        className="w-full text-[9px] font-black uppercase bg-surface border-2 border-border/40 rounded px-2 py-2 outline-none text-muted-2 cursor-pointer hover:border-primary transition-all shadow-sm"
                                                                    >
                                                                        {/* 1. STOCK FÍSICO SI EXISTE */}
                                                                        {c.stockOptions?.fisico > 0 && (
                                                                            <optgroup label="✨ STOCK EN TIENDA" className="text-success font-black uppercase">
                                                                                <option value="fisico">✨ STOCK FÍSICO ({c.stockOptions.fisico})</option>
                                                                            </optgroup>
                                                                        )}
                                
                                                                        {/* 2. SEMANAS FLOTANTES (CONFIRMADAS O POR LLEGAR) */}
                                                                        {c.stockOptions?.flotantes && c.stockOptions.flotantes.length > 0 && (
                                                                            <optgroup label="🛳️ PRODUCTOS EN CAMINO" className="text-primary font-black uppercase">
                                                                                {c.stockOptions.flotantes.map(fl => (
                                                                                    <option key={fl.id} value={fl.isConfirmed ? `flotante_conf_${fl.id}` : `flotante_noc_${fl.id}`}>
                                                                                        {fl.isConfirmed ? '✅' : '⏳'} {fl.nombre} ({fl.qty} U.)
                                                                                    </option>
                                                                                ))}
                                                                            </optgroup>
                                                                        )}
                                                                        
                                                                        {/* 3. SEMANAS ABIERTAS PARA PEDIDOS */}
                                                                        <optgroup label="🚀 LANZAMIENTOS (W)" className="text-muted font-black uppercase">
                                                                            {semanas.filter(s => s.abierta).map(s => (
                                                                                <option key={s.id} value={`pedido_${s.id}`}>🚀 P/ {s.nombre}</option>
                                                                            ))}
                                                                            <option value="pedido_PENDIENTE">📂 PRÓXIMO PEDIDO (SIN FECHA)</option>
                                                                        </optgroup>
                                                                    </select>
                                                                </td>

                                                                <td className="px-2 py-2.5 text-center">
                                                                    <div className={`text-[9px] font-black uppercase px-2 py-1.5 rounded-lg border ${
                                                                        c.source === 'fisico' ? 'bg-success/5 border-success/20 text-success' :
                                                                        'bg-muted/5 border-border/30 text-muted-2'
                                                                    }`}>
                                                                        {(() => {
                                                                            if (c.source === 'fisico') return "✨ INMEDIATA";
                                                                            
                                                                            let date = null;
                                                                            const now = new Date();
                                                                            
                                                                            if (c.source === 'pedido_PENDIENTE') {
                                                                                // Unificado: 22 días después del PRÓXIMO SÁBADO de Hoy
                                                                                const day = now.getDay();
                                                                                const diff = (6 - day + 7) % 7 || 7;
                                                                                const nextSat = new Date(now.getTime() + (diff * 24 * 60 * 60 * 1000));
                                                                                date = new Date(nextSat.getTime() + (22 * 24 * 60 * 60 * 1000));
                                                                            } else if (c.source.startsWith('flotante_')) {
                                                                                const id = c.source.split('_').pop();
                                                                                const fl = c.stockOptions?.flotantes?.find(f => f.id == id);
                                                                                if (fl) date = fl.fechaArribo;
                                                                            } else if (c.source.startsWith('pedido_')) {
                                                                                const id = c.source.split('_')[1];
                                                                                const s = semanas.find(x => x.id == id);
                                                                                if (s) {
                                                                                    date = s.fecha_estimada_llegada ? new Date(s.fecha_estimada_llegada) : new Date(new Date(s.created_at).getTime() + (22 * 24 * 60 * 60 * 1000));
                                                                                }
                                                                            }
                                                                            
                                                                            if (!date) return "---";
                                                                            return new Date(date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }).toUpperCase();
                                                                        })()}
                                                                    </div>
                                                                </td>
                                                                </>)}

                                                                <td className="px-3 py-2.5 text-right">
                                                                    <button onClick={()=>removeFromCart(i)} className="p-2 text-muted/40 hover:text-error hover:bg-error/5 rounded-lg transition-all"><X size={16}/></button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            
                                            <div className="mt-auto bg-background/40 p-5 rounded-2xl border border-border flex justify-between items-center shadow-lg">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-black uppercase text-muted tracking-widest pb-1">Unidades: {cart.length}</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[10px] font-black uppercase text-primary tracking-[0.2em] pb-1">Total Pedido</span>
                                                    <span className="text-2xl font-mono font-black text-primary decoration-primary decoration-double underline underline-offset-4">BS {formatS(cart.reduce((s,i)=>s+Number(i.precio_venta), 0))}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1 flex flex-col items-center justify-center text-center opacity-20 py-20">
                                            <ShoppingBag size={64} />
                                            <div className="mt-2 text-xs font-black uppercase tracking-widest">Vacío</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="p-5 border-t border-border bg-background rounded-b-2xl shrink-0 space-y-3">
                            {/* Pago inicial opcional */}
                            <div className="flex items-center gap-3 flex-wrap">
                                <span className="text-[9px] font-black uppercase text-muted tracking-widest">Pago inicial (opcional)</span>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-success opacity-60">BS</span>
                                    <input type="number" step="0.01" value={orderPayAmt} onChange={e => setOrderPayAmt(e.target.value)} onFocus={e=>e.target.select()}
                                        className="w-28 bg-surface border border-success/30 pl-8 pr-2 py-1.5 rounded-lg text-xs font-mono font-bold text-success outline-none focus:border-success"
                                        placeholder="0.00"/>
                                </div>
                                <div className="flex gap-1.5 flex-wrap">
                                    {[{id:'Efectivo',icon:'💵'},{id:'Yasta (QR)',icon:'📲'},{id:'Banco Unión (QR/Transf)',icon:'🏦'},{id:'BNB',icon:'🏛️'},{id:'Otros',icon:'💳'}].map(m => (
                                        <button key={m.id} type="button" onClick={() => setOrderMethod(m.id)}
                                            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-black border transition-all ${orderMethod === m.id ? 'bg-primary border-primary text-white shadow' : 'bg-surface border-border text-muted hover:border-primary/40'}`}>
                                            <span>{m.icon}</span>
                                            <span>{m.id === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m.id}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex justify-end gap-4">
                            <button onClick={()=>{setShowAddModal(false); setCart([]);}} className="px-6 py-2.5 text-[11px] font-black uppercase tracking-widest text-muted hover:text-text">Cancelar</button>
                            <button
                                onClick={handleSaveOrder}
                                disabled={cart.length === 0 || loading}
                                className={`px-12 py-3.5 rounded-2xl text-xs font-black uppercase tracking-[0.2em] flex items-center gap-3 shadow-2xl transition-all ${cart.length > 0 && !loading ? 'bg-primary text-background hover:scale-105 hover:shadow-primary/40 active:scale-95' : 'bg-muted text-surface cursor-not-allowed'}`}
                            >
                                {loading ? <div className="animate-spin w-4 h-4 border-2 border-background border-t-transparent rounded-full" /> : <Check size={18}/>}
                                Procesar Pedido Completo
                            </button>
                            </div>
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
                                {(() => {
                                    const pItemsCli = items.filter(i => i.cliente_id === showPayModal);
                                    const cPagItemsCli = pItemsCli.reduce((s,i) => s + Number(i.monto_pagado||0), 0);
                                    const groupPagosCli = pagos.filter(p => p.cliente_id === showPayModal).reduce((s,p) => s + Number(p.monto), 0);
                                    const balanceDisponibleCli = Math.max(0, groupPagosCli - cPagItemsCli);
                                    return (
                                        <div className="flex bg-background rounded p-1 mb-5 border border-border mx-auto">
                                            <button onClick={()=>setPayMode('items')} className={`flex-1 py-1 text-xs font-bold rounded ${payMode==='items'?'bg-surface text-primary shadow':'text-muted'}`}>Pagar Ítems</button>
                                            <button onClick={()=>setPayMode('general')} className={`flex-1 py-1 text-xs font-bold rounded ${payMode==='general'?'bg-surface text-primary shadow':'text-muted'}`}>Abono a Cuenta</button>
                                            {balanceDisponibleCli > 0 && (
                                                <button onClick={()=>setPayMode('distribuir')} className={`flex-1 py-1 text-xs font-bold rounded whitespace-nowrap ${payMode==='distribuir'?'bg-orange-500 text-white shadow':'text-orange-500'}`}>
                                                    Distribuir BS {formatS(balanceDisponibleCli)}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })()}

                                {payMode === 'items' ? (
                                    <div className="mb-4">
                                        <div className="border border-border rounded-lg bg-background max-h-48 overflow-y-auto">
                                            <div className="flex items-center justify-between px-3 pt-3 pb-1">
                                                <span className="text-[10px] text-muted font-bold uppercase">Selecciona los ítems a pagar:</span>
                                                {(() => {
                                                    const pendientes = pItems.filter(i => Math.max(0, i.precio_venta - i.monto_pagado) > 0);
                                                    const todosSeleccionados = pendientes.length > 0 && pendientes.every(i => selectedPayItems.includes(i.id));
                                                    return (
                                                        <button onClick={() => {
                                                            if (todosSeleccionados) {
                                                                setSelectedPayItems([]);
                                                                setPayMonto('');
                                                            } else {
                                                                const ids = pendientes.map(i => i.id);
                                                                setSelectedPayItems(ids);
                                                                const total = pendientes.reduce((s,i) => s + Math.max(0, i.precio_venta - i.monto_pagado), 0);
                                                                setPayMonto(total);
                                                            }
                                                        }} className="text-[10px] font-black uppercase text-primary hover:underline">
                                                            {todosSeleccionados ? 'Deseleccionar' : 'Seleccionar todos'}
                                                        </button>
                                                    );
                                                })()}
                                            </div>
                                            {pItems.map(it => {
                                                const deuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                                if(deuda <= 0) return null;
                                                const checked = selectedPayItems.includes(it.id);
                                                return (
                                                    <label key={it.id} className={`flex items-center gap-3 px-3 py-2 hover:bg-surface cursor-pointer border-b border-border/50 last:border-0 ${checked ? 'bg-primary/5' : ''}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={(e)=>{
                                                                let next;
                                                                if(e.target.checked) next = [...selectedPayItems, it.id];
                                                                else next = selectedPayItems.filter(x=>x!==it.id);
                                                                setSelectedPayItems(next);
                                                                // Auto-llenar monto con la suma de deudas seleccionadas
                                                                const total = pItems.filter(i => next.includes(i.id)).reduce((s,i) => s + Math.max(0, i.precio_venta - i.monto_pagado), 0);
                                                                setPayMonto(total > 0 ? total : '');
                                                            }}
                                                            className="w-4 h-4 accent-primary shrink-0"
                                                        />
                                                        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                                            <div className="text-sm font-bold truncate text-text">{it.titulo}</div>
                                                            <div className={`text-xs font-black font-mono shrink-0 ${checked ? 'text-primary' : 'text-error'}`}>BS {formatS(deuda)}</div>
                                                        </div>
                                                    </label>
                                                )
                                            })}
                                            {pItems.filter(i=> (i.precio_venta - i.monto_pagado) > 0).length === 0 && (
                                                <div className="text-xs text-center text-success py-4">No hay ítems con deuda pendiente.</div>
                                            )}
                                        </div>
                                        {selectedPayItems.length > 0 && (() => {
                                            const selItems = pItems.filter(i => selectedPayItems.includes(i.id));
                                            const totalSel = selItems.reduce((s,i) => s + Math.max(0, i.precio_venta - i.monto_pagado), 0);
                                            return (
                                                <div className="mt-2 flex justify-between items-center px-2">
                                                    <span className="text-[10px] font-black uppercase text-muted">{selItems.length} ítem(s) seleccionado(s)</span>
                                                    <span className="text-sm font-black font-mono text-primary">BS {formatS(totalSel)}</span>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                ) : payMode === 'distribuir' ? (
                                    (() => {
                                        const pItemsCli2 = items.filter(i => i.cliente_id === showPayModal);
                                        const cPagItemsCli2 = pItemsCli2.reduce((s,i) => s + Number(i.monto_pagado||0), 0);
                                        const groupPagosCli2 = pagos.filter(p => p.cliente_id === showPayModal).reduce((s,p) => s + Number(p.monto), 0);
                                        const balCli = Math.max(0, groupPagosCli2 - cPagItemsCli2);
                                        return (
                                            <div className="mb-4">
                                                <div className="flex justify-between items-center mb-2 p-2 bg-orange-400/10 border border-orange-400/20 rounded-lg">
                                                    <span className="text-[10px] font-black uppercase text-orange-500">Balance disponible</span>
                                                    <span className="font-mono font-black text-orange-500">BS {formatS(balCli)}</span>
                                                </div>
                                                <div className="flex items-center justify-between mb-2">
                                                    <div className="text-[10px] text-muted font-bold uppercase">Asignar monto a cada ítem (máx. pendiente):</div>
                                                    <button
                                                        onClick={() => {
                                                            const pendientes = pItems.filter(i => Math.max(0, i.precio_venta - i.monto_pagado) > 0);
                                                            let restante = balCli;
                                                            const nuevos = {};
                                                            for (const it of pendientes) {
                                                                if (restante <= 0) break;
                                                                const deuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                                                const asignar = Math.min(deuda, restante);
                                                                nuevos[it.id] = asignar;
                                                                restante -= asignar;
                                                            }
                                                            setDistribuirMontos(nuevos);
                                                        }}
                                                        className="text-[10px] font-black uppercase px-2 py-1 rounded bg-orange-500/10 text-orange-500 hover:bg-orange-500/20"
                                                    >
                                                        Auto-distribuir
                                                    </button>
                                                </div>
                                                <div className="border border-border rounded-lg bg-background max-h-52 overflow-y-auto">
                                                    {pItems.filter(i => Math.max(0, i.precio_venta - i.monto_pagado) > 0).map(it => {
                                                        const deuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                                        const montoAsignado = Number(distribuirMontos[it.id] || 0);
                                                        return (
                                                            <div key={it.id} className="flex items-center gap-3 p-2 border-b border-border/50 last:border-0">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-sm font-bold truncate text-text">{it.titulo}</div>
                                                                    <div className="text-[10px] uppercase text-error">Pendiente: BS {formatS(deuda)}</div>
                                                                </div>
                                                                <input
                                                                    type="number" min="0" max={deuda} step="0.01"
                                                                    value={montoAsignado || ''}
                                                                    placeholder="0"
                                                                    onChange={e => {
                                                                        const val = Math.min(Number(e.target.value), deuda);
                                                                        setDistribuirMontos(prev => ({ ...prev, [it.id]: val < 0 ? 0 : val }));
                                                                    }}
                                                                    className="w-24 bg-background border border-border px-2 py-1 rounded-lg text-sm text-right font-mono outline-none focus:border-orange-500"
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                    {pItems.filter(i => (i.precio_venta - i.monto_pagado) > 0).length === 0 && (
                                                        <div className="text-xs text-center text-success py-4">Todos los ítems están cubiertos.</div>
                                                    )}
                                                </div>
                                                {(() => {
                                                    const totalAsignado = Object.values(distribuirMontos).reduce((s,v) => s + Number(v||0), 0);
                                                    if (totalAsignado === 0) return null;
                                                    const excedeDist = totalAsignado > balCli;
                                                    return (
                                                        <div className={`mt-2 text-center text-xs font-black ${excedeDist ? 'text-error' : 'text-success'}`}>
                                                            Asignado: BS {formatS(totalAsignado)} / BS {formatS(balCli)} disponible
                                                            {excedeDist && ' — Supera el balance'}
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        );
                                    })()
                                ) : (
                                    <div className="mb-4">
                                        <label className="block text-xs mb-1 text-muted">Concepto (Opcional)</label>
                                        <input type="text" value={pagoConcepto} onChange={e=>setPagoConcepto(e.target.value)} className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary" placeholder="Ej: Depósito QR..."/>
                                    </div>
                                )}

                                {payMode !== 'distribuir' && <>
                                    <div className="mb-4">
                                        <label className="text-[10px] font-black text-muted uppercase flex items-center gap-2 mb-3">
                                            <Wallet size={14} className="text-secondary"/> Método de Pago
                                        </label>
                                        <div className="grid grid-cols-5 gap-1.5 p-1 bg-background border border-border rounded-xl">
                                            {[
                                                { id: 'Efectivo', icon: '💵' },
                                                { id: 'Yasta (QR)', icon: '📲' },
                                                { id: 'Banco Unión (QR/Transf)', icon: '🏦' },
                                                { id: 'BNB', icon: '🏛️' },
                                                { id: 'Otros', icon: '💳' },
                                            ].map(m => (
                                                <button
                                                    key={m.id}
                                                    onClick={() => setPayMethod(m.id)}
                                                    className={`py-2 flex flex-col items-center gap-0.5 text-[8px] font-black uppercase rounded-lg transition-all leading-tight ${payMethod === m.id ? 'bg-[var(--primary)] text-white shadow-md' : 'text-muted hover:bg-surface'}`}
                                                >
                                                    <span className="text-base leading-none">{m.icon}</span>
                                                    {m.id === 'Banco Unión (QR/Transf)' ? <span>B. Unión</span> : <span>{m.id}</span>}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {payMethod !== 'Efectivo' && (
                                        <div className="mb-4">
                                            <label className="block text-[10px] font-black text-muted uppercase mb-1">No. Operación / Referencia</label>
                                            <input
                                                type="text"
                                                value={payReference}
                                                onChange={e => setPayReference(e.target.value)}
                                                placeholder="Ej: TXN-1234567"
                                                className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-[var(--primary)] font-mono"
                                            />
                                        </div>
                                    )}

                                    <div className="mb-4">
                                        <label className="block text-xs font-bold mb-1 text-success uppercase">Monto a Abonar (BS)</label>
                                        <input type="number" value={payMonto} onChange={e=>setPayMonto(e.target.value)} autoFocus className="w-full bg-background border-2 border-border focus:border-success px-4 py-3 rounded-lg text-xl text-center text-success font-bold font-mono outline-none shadow-inner"/>
                                        {payMode === 'items' && selectedPayItems.length > 0 && payMonto > 0 && (
                                            <div className="text-[10px] text-center mt-2 text-muted uppercase">
                                                {(() => {
                                                    const totalDeuda = pItems.filter(i => selectedPayItems.includes(i.id)).reduce((s,i) => s + Math.max(0, i.precio_venta - i.monto_pagado), 0);
                                                    if (Number(payMonto) === totalDeuda) return `Cubre la deuda exacta de ${selectedPayItems.length} ítem(s).`;
                                                    if (Number(payMonto) < totalDeuda) return `Monto parcial — se aplicará en orden hasta agotar BS ${formatS(payMonto)}.`;
                                                    return `Cubre todos los ítems y sobran BS ${formatS(Number(payMonto) - totalDeuda)}.`;
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                </>}

                                {/* Historial de Abonos */}
                                {(() => {
                                    const cli = clientes.find(c => c.id === showPayModal);
                                    const historial = pagos.filter(p => p.cliente_id === showPayModal).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                                    if (historial.length === 0) return null;
                                    const METHOD_ICON = { 'Efectivo': '💵', 'Yasta (QR)': '📲', 'Banco Unión (QR/Transf)': '🏦', 'BNB': '🏛️', 'Otros': '💳' };
                                    return (
                                        <div className="border-t border-border pt-3">
                                            <div className="text-[10px] font-black text-muted uppercase mb-2">Historial de Abonos Generales</div>
                                            <div className="max-h-32 overflow-y-auto space-y-1">
                                                {historial.map(p => (
                                                    <div key={p.id} className="flex items-center justify-between bg-background rounded-lg px-3 py-1.5 border border-border/50 group">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className="text-base leading-none">{METHOD_ICON[p.metodo_pago] || '💳'}</span>
                                                            <div className="min-w-0">
                                                                <div className="text-[10px] font-bold text-text truncate">{p.concepto || 'Abono'}</div>
                                                                {p.referencia && <div className="text-[9px] text-muted font-mono">Ref: {p.referencia}</div>}
                                                                <div className="text-[9px] text-muted">{p.metodo_pago || 'Efectivo'} · {new Date(p.fecha || p.created_at).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 ml-2 shrink-0">
                                                            <span className="text-success font-black text-xs font-mono whitespace-nowrap">+BS {formatS(p.monto)}</span>
                                                            {isAdmin && (
                                                                <>
                                                                    <button onClick={() => setEditPago({ id: p.id, concepto: p.concepto || '', monto: p.monto, metodo_pago: p.metodo_pago || 'Yasta (QR)', caja_mov_id: p.caja_mov_id })} title="Editar abono"
                                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/10 text-muted hover:text-primary transition-all">
                                                                        <Edit2 size={11} />
                                                                    </button>
                                                                    <button onClick={() => handleDeletePago(p)} title="Eliminar abono (también en Contabilidad)"
                                                                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-all">
                                                                        <Trash2 size={11} />
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            <div className="p-4 border-t border-border flex justify-between items-center gap-3 bg-background rounded-b-2xl">
                                <div className="flex items-center gap-2">
                                    {isAdmin && payMode !== 'distribuir' && (
                                        <label className="flex items-center gap-1.5 cursor-pointer select-none" title="No crea movimiento en Contabilidad/Caja. Útil para corregir pagos históricos.">
                                            <input type="checkbox" checked={sinContabilidad} onChange={e => setSinContabilidad(e.target.checked)} className="w-3.5 h-3.5 accent-orange-400"/>
                                            <span className={`text-[10px] font-black uppercase ${sinContabilidad ? 'text-orange-500' : 'text-muted'}`}>Sin contabilidad</span>
                                        </label>
                                    )}
                                </div>
                                <div className="flex gap-3">
                                <button onClick={()=>{ setShowPayModal(null); setSinContabilidad(false); }} className="px-4 py-2 text-sm font-bold text-muted hover:text-text">Cancelar</button>
                                {payMode === 'distribuir' ? (() => {
                                    const pItemsCli3 = items.filter(i => i.cliente_id === showPayModal);
                                    const cPagItemsCli3 = pItemsCli3.reduce((s,i) => s + Number(i.monto_pagado||0), 0);
                                    const groupPagosCli3 = pagos.filter(p => p.cliente_id === showPayModal).reduce((s,p) => s + Number(p.monto), 0);
                                    const balCli3 = Math.max(0, groupPagosCli3 - cPagItemsCli3);
                                    const totalAsignado3 = Object.values(distribuirMontos).reduce((s,v) => s + Number(v||0), 0);
                                    const excede3 = totalAsignado3 > balCli3;
                                    const sinMonto3 = totalAsignado3 === 0;
                                    return (
                                        <button onClick={()=>handleDistribuirBalance()} disabled={sinMonto3 || excede3 || loading}
                                            className="bg-orange-500 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
                                            Aplicar distribución
                                        </button>
                                    );
                                })() : (
                                    <button onClick={()=>handleSavePayment(cli.id)} className="bg-success text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-success/90 shadow-lg">Confirmar Pago</button>
                                )}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* MODAL: EDITAR ABONO */}
            {editPago && (
                <div className="fixed inset-0 z-[10010] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-sm p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-black text-text flex items-center gap-2">
                                <Edit2 size={15} className="text-primary" /> Editar Abono
                            </h3>
                            <button onClick={() => setEditPago(null)} className="text-muted hover:text-text"><X size={18} /></button>
                        </div>
                        {editPago.caja_mov_id && (
                            <p className="text-[10px] text-primary bg-primary/5 border border-primary/20 rounded-lg px-3 py-2 font-bold">
                                📋 Los cambios también se sincronizarán en Contabilidad.
                            </p>
                        )}
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black uppercase text-muted tracking-widest">Concepto</label>
                            <input type="text" value={editPago.concepto} onChange={e => setEditPago({ ...editPago, concepto: e.target.value })}
                                className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-[var(--primary)]" />
                        </div>
                        <div className="space-y-1">
                            <label className="block text-[10px] font-black uppercase text-muted tracking-widest">Monto (BS)</label>
                            <input type="number" value={editPago.monto} onChange={e => setEditPago({ ...editPago, monto: e.target.value })}
                                className="w-full bg-background border-2 border-border px-3 py-2.5 rounded-xl text-lg text-center font-black font-mono outline-none focus:border-success" />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-[10px] font-black uppercase text-muted tracking-widest">Método de Pago</label>
                            <div className="flex flex-wrap gap-1.5">
                                {['Efectivo', 'Yasta (QR)', 'Banco Unión (QR/Transf)', 'BNB', 'Otros'].map(m => (
                                    <button key={m} onClick={() => setEditPago({ ...editPago, metodo_pago: m })}
                                        className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black border transition-all ${editPago.metodo_pago === m ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'bg-background border-border text-muted hover:border-[var(--primary)]/40'}`}>
                                        {m === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                            <button onClick={() => setEditPago(null)} className="flex-1 py-2 rounded-xl text-sm font-bold text-muted bg-background border border-border">Cancelar</button>
                            <button onClick={handleUpdatePago} className="flex-1 py-2 rounded-xl text-sm font-black text-white bg-[var(--primary)] hover:brightness-105 shadow">Guardar</button>
                        </div>
                    </div>
                </div>
            )}

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
