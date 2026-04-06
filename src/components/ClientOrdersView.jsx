import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { Search, Plus, ShoppingBag, CheckSquare, MessageCircle, ChevronDown, ChevronUp, Trash2, Edit2, Check, X, Box, RefreshCw, Info, Layers, Hash, Calendar, ArrowRight } from 'lucide-react';
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
    const [filterSemana, setFilterSemana] = useState('todos'); // 'todos' | semana_id
    const [expandedCliente, setExpandedCliente] = useState(new Set());
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
    const [reprogrammingItem, setReprogrammingItem] = useState(null);
    
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
        const isFloating = it.estado.startsWith('CONFIRMADO') || it.estado.startsWith('PEDIDO');
        let dateStr = null;
        if (isFloating && week) {
            const d = week.fecha_estimada_llegada ? new Date(week.fecha_estimada_llegada) : new Date(new Date(week.created_at).getTime() + (22*24*60*60*1000));
            dateStr = d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
        } else if (it.estado === 'PEDIDO (Siguiente)') {
            // Calcular fecha para el próximo pedido (Sábado más cercano + 22 días)
            const now = new Date();
            const nextSat = new Date(now);
            nextSat.setDate(now.getDate() + (6 - now.getDay() + 7) % 7);
            const arrival = new Date(nextSat);
            arrival.setDate(nextSat.getDate() + 22);
            dateStr = arrival.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
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
        const price = item.precio_venta_bs || item.precio_tapa || '';
        setAddForm({ 
            ...addForm, 
            titulo: item.titulo, 
            catalog_id: item.id,
            product_id: item.product_id,
            precio_venta: price,
            descuento: 0,
            precio_final: price,
            monto_pagado: ''
        });
        setShowSuggestions(false);
        
        // Analyze Stock inline to populate the row selector immediately
        const stock = await analyzeStockForItem(item.titulo);
        setStockAnalysis(stock);
        setSelectedStockSource(stock.defaultSource);
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
                    source: selectedStockSource,
                    stockOptions: stockAnalysis
                }]);

                // Reset item fields
                setAddForm({ ...addForm, titulo: '', catalog_id: '', product_id: '', precio_venta: '', descuento: '', precio_final: '', monto_pagado: '', nota_item: '' });
                setStockAnalysis(null);
                setSelectedStockSource('');
                setCatalogSuggestions([]);
            } else {
                // Batch addition
                const toAdd = bulkResults.filter(p => bulkSelected.has(p.id));
                if (toAdd.length === 0) return alert("No hay ítems seleccionados");

                const newCartItems = [];
                for (let p of toAdd) {
                    const stock = await analyzeStockForItem(p.titulo);
                    const price = p.precio_venta_bs || p.precio_tapa || 0;
                    newCartItems.push({
                        titulo: p.titulo,
                        catalog_id: p.id,
                        product_id: p.product_id,
                        precio_original: price,
                        descuento: 0,
                        precio_venta: price,
                        monto_pagado: 0,
                        nota: 'Pedido por lote',
                        source: stock.defaultSource,
                        stockOptions: stock
                    });
                }

                setCart([...cart, ...newCartItems]);
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

            // 4. Subtract stock
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
            
            if (typeof catalogService !== 'undefined') catalogService.clearCache();
            
            setShowAddModal(false);
            setCart([]);
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
            return true;
        });
    }, [items, filterEstado, filterSemana, search]);

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
                                            // Si no hay semana seleccionada, por defecto no mostramos los "Siguiente" para no ensuciar las semanas reales
                                            if (!selectedSemanaHoja && i.estado === 'PEDIDO (Siguiente)') return false;
                                        }

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
                                        <button onClick={async()=>{
                                            if(confirm('¿Eliminar este ítem del pedido?')) {
                                                // Restore stock if it was physically in store
                                                // Restore stock if it was physically in store or already ordered to provider
                                                let shouldRestore = false;
                                                // Solo devolvemos a Stock Físico si el ítem ya estaba realmente en el edificio (EN TIENDA)
                                                // Los ítems en tránsito (PEDIDO/ADJUDICADO) se liberan automáticamente en el stock flotante del catálogo
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
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}


            {/* ADD MODAL */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm overflow-hidden">
                    <div className="bg-surface w-full max-w-7xl rounded-2xl border border-border flex flex-col min-h-[85vh] max-h-[95vh] shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-5 border-b border-border flex justify-between items-center bg-background rounded-t-2xl shrink-0">
                            <h2 className="text-lg font-bold font-display text-text flex items-center gap-2">
                                <Plus className="text-primary"/> Nueva Venta / Pedido
                            </h2>
                            <div className="flex items-center gap-4">
                                {cart.length > 0 && <span className="bg-primary/20 text-primary border border-primary/30 px-3 py-1 rounded-full text-[10px] font-black animate-pulse uppercase tracking-widest">{cart.length} ITEMS EN CESTA</span>}
                                <button onClick={()=>{setShowAddModal(false); setCart([]);}} className="text-muted hover:text-text transition-colors p-2 hover:bg-muted/20 rounded-full"><X size={20}/></button>
                            </div>
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1 flex flex-col gap-8 custom-scrollbar pb-64">
                            {/* Cliente Bloque */}
                            <div className="bg-background/40 border border-border p-5 rounded-2xl flex flex-col gap-4 shadow-inner">
                                <h3 className="text-[10px] font-black uppercase text-muted tracking-[0.2em] flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary" /> Datos del Cliente
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                    <div className="md:col-span-1">
                                        <label className="block text-[10px] font-black uppercase mb-1.5 text-primary tracking-widest">Celular *</label>
                                        <input 
                                            type="text" 
                                            value={addForm.celular} 
                                            onChange={e=>{
                                                const val = e.target.value;
                                                const cli = clientes.find(c=>c.celular===val);
                                                if(cli) setAddForm({...addForm, celular:val, nombre:cli.nombre, ci:cli.ci||'', ciudad:cli.ciudad||'', sucursal:cli.sucursal||'', direccion:cli.direccion||'', notas_cliente:cli.notas||''});
                                                else setAddForm({...addForm, celular:val});
                                            }} 
                                            className="w-full bg-surface border-2 border-border/40 px-4 py-3 rounded-2xl text-sm font-bold text-text outline-none focus:border-primary focus:bg-surface transition-all placeholder:opacity-30"
                                            placeholder="73481501"
                                        />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-[10px] font-black uppercase mb-1.5 text-muted tracking-widest">Nombre</label>
                                        <input 
                                            type="text" 
                                            value={addForm.nombre} 
                                            onChange={e=>setAddForm({...addForm, nombre:e.target.value.toUpperCase()})} 
                                            className="w-full bg-surface border border-border px-4 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm transition-all" 
                                            placeholder="Opcional"
                                        />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-[10px] font-black uppercase mb-1.5 text-muted tracking-widest">CI / NIT</label>
                                        <input 
                                            type="text" 
                                            value={addForm.ci} 
                                            onChange={e=>setAddForm({...addForm, ci:e.target.value})} 
                                            className="w-full bg-surface border border-border px-4 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm transition-all" 
                                            placeholder="Opcional"
                                        />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-[10px] font-black uppercase mb-1.5 text-muted tracking-widest">Ciudad</label>
                                        <input 
                                            type="text" 
                                            value={addForm.ciudad} 
                                            onChange={e=>setAddForm({...addForm, ciudad:e.target.value.toUpperCase()})} 
                                            className="w-full bg-surface border border-border px-4 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm transition-all" 
                                            placeholder="Opcional"
                                        />
                                    </div>
                                    <div className="md:col-span-1">
                                        <label className="block text-[10px] font-black uppercase mb-1.5 text-muted tracking-widest">Sucursal</label>
                                        <input 
                                            type="text" 
                                            value={addForm.sucursal} 
                                            onChange={e=>setAddForm({...addForm, sucursal:e.target.value.toUpperCase()})} 
                                            className="w-full bg-surface border border-border px-4 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm transition-all" 
                                            placeholder="Opcional"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Buscador de Productos */}
                            <div className="bg-background/40 border border-border p-5 rounded-2xl flex flex-col gap-4 shadow-inner relative">
                                <div className="flex justify-between items-center">
                                    <h3 className="text-[10px] font-black uppercase text-muted tracking-[0.2em] flex items-center gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-secondary" /> Selección de Productos
                                    </h3>
                                    <div className="flex bg-surface rounded-xl p-1 border border-border shadow-sm">
                                        <button onClick={()=>setAddForm({...addForm, mode:'individual'})} className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-tighter rounded-lg transition-all ${addForm.mode==='individual'?'bg-primary text-background shadow-md':'text-muted hover:text-text'}`}>
                                            <Search size={14} className="inline mr-1.5" /> Individual
                                        </button>
                                        <button onClick={()=>setAddForm({...addForm, mode:'coleccion'})} className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-tighter rounded-lg transition-all ${addForm.mode==='coleccion'?'bg-primary text-background shadow-md':'text-muted hover:text-text'}`}>
                                            <Layers size={14} className="inline mr-1.5" /> Por Lote (Colección)
                                        </button>
                                    </div>
                                </div>

                                {addForm.mode === 'individual' ? (
                                    <div className="flex flex-col xl:flex-row gap-4 items-end">
                                        <div className="flex-[4] min-w-[400px] relative w-full">
                                            <label className="block text-[10px] font-black uppercase mb-1.5 text-primary tracking-widest">Buscar en Catálogo</label>
                                            <div className="relative">
                                                <input type="text" value={addForm.titulo} onChange={e=>handleSearchCatalog(e.target.value)} className="w-full bg-surface border-2 border-primary/30 px-4 py-2.5 rounded-xl text-xs text-text outline-none focus:border-primary shadow-sm transition-all font-bold" placeholder="Escribe el título para buscar..."/>
                                                {showSuggestions && catalogSuggestions.length > 0 && (
                                                    <div className="absolute top-full left-0 w-[550px] mt-2 bg-surface border border-border rounded-2xl shadow-2xl z-[100] max-h-60 overflow-y-auto p-1.5 border-t-4 border-t-primary animate-in fade-in slide-in-from-top-2">
                                                        {catalogSuggestions.map((sg, i) => (
                                                            <div key={i} onClick={()=>selectSuggestion(sg)} className="p-2 border-b border-border/20 last:border-0 hover:bg-primary/5 rounded-xl cursor-pointer transition-colors">
                                                                <div className="font-bold text-text text-[11px] leading-tight">{sg.titulo}</div>
                                                                <div className="text-[9px] text-muted flex items-center justify-between mt-0.5">
                                                                    <span>{sg.editorial} | Tapa: BS {sg.precio_tapa}</span>
                                                                    <span className="font-mono text-success font-black">STOCK: {sg.stock_fisico || 0}</span>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="w-24">
                                            <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest text-center">Precio</label>
                                            <input type="number" value={addForm.precio_venta} onChange={e=>{
                                                const base = e.target.value;
                                                const pct = Number(addForm.descuento)||0;
                                                const final = Number(base) - (Number(base) * pct / 100);
                                                setAddForm({...addForm, precio_venta: base, precio_final: final.toFixed(0)});
                                            }} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-xs text-text outline-none focus:border-primary font-mono text-center"/>
                                        </div>
                                        <div className="w-20">
                                            <label className="block text-[10px] font-black uppercase mb-1.5 text-error/80 tracking-widest text-center">Desc. %</label>
                                            <input type="number" value={addForm.descuento} onChange={e=>{
                                                const pct = e.target.value;
                                                const base = Number(addForm.precio_venta)||0;
                                                const final = base - (base * (Number(pct)||0) / 100);
                                                setAddForm({...addForm, descuento: pct, precio_final: final.toFixed(0)});
                                            }} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-xs text-error font-bold outline-none focus:border-error font-mono text-center" placeholder="%"/>
                                        </div>
                                        <div className="w-24">
                                            <label className="block text-[10px] font-black uppercase mb-1.5 text-primary/80 tracking-widest text-center">Final</label>
                                            <input 
                                                type="number" 
                                                value={addForm.precio_final} 
                                                onChange={e=>{
                                                    const final = e.target.value;
                                                    const base = Number(addForm.precio_venta)||0;
                                                    const pct = base > 0 ? ((1 - Number(final) / base) * 100).toFixed(1) : 0;
                                                    setAddForm({
                                                        ...addForm, 
                                                        precio_final: final, 
                                                        descuento: pct
                                                    });
                                                }}
                                                className="w-full bg-primary/5 border border-primary/20 px-3 py-2.5 rounded-xl text-xs text-primary font-black outline-none focus:border-primary font-mono text-center"
                                            />
                                        </div>
                                        <div className="w-24">
                                            <label className="block text-[10px] font-black uppercase mb-1.5 text-success/80 tracking-widest text-center">Pago Inicial</label>
                                            <input type="number" value={addForm.monto_pagado} onChange={e=>setAddForm({...addForm, monto_pagado:e.target.value})} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-xs text-success font-black outline-none focus:border-success font-mono text-center" placeholder="BS"/>
                                        </div>

                                        <div className="w-72 relative">
                                            <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 text-center tracking-[0.2em]">Asignar De:</label>
                                            <div 
                                                onClick={() => setDropdownOpen(!dropdownOpen)}
                                                className={`w-full bg-surface border-2 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase cursor-pointer flex items-center justify-between transition-all select-none hover:shadow-md ${
                                                    selectedStockSource === 'fisico' ? 'border-success text-success bg-success/5 shadow-sm' : 
                                                    selectedStockSource.includes('flotante_conf') ? 'border-primary text-primary bg-primary/5 shadow-sm' : 
                                                    selectedStockSource.includes('flotante_noc') ? 'border-orange-400 text-orange-400 bg-orange-400/5' : 
                                                    selectedStockSource === 'pedido_PENDIENTE' ? 'border-purple-500 text-purple-500 animate-pulse' :
                                                    'border-border text-muted hover:border-primary/40'
                                                }`}
                                            >
                                                <div className="truncate flex items-center gap-2">
                                                    {(() => {
                                                        if (selectedStockSource === 'fisico') return "✨ STOCK FÍSICO";
                                                        if (selectedStockSource === 'pedido_PENDIENTE') return "🚀 PRÓXIMO PEDIDO (Por Asignar)";
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
                                                <ChevronDown size={14} className={`transition-transform duration-300 ${dropdownOpen ? 'rotate-180' : ''}`} />
                                            </div>

                                            {dropdownOpen && (
                                                <div className="absolute bottom-full mb-2 left-0 w-full bg-surface border border-border rounded-2xl shadow-2xl z-[150] overflow-hidden animate-in slide-in-from-bottom-2 duration-200">
                                                    <div className="max-h-[300px] overflow-y-auto p-1.5 custom-scrollbar flex flex-col gap-1">
                                                        {/* STOCK FISICO */}
                                                        {stockAnalysis?.fisico > 0 && (
                                                            <div onClick={() => { setSelectedStockSource('fisico'); setDropdownOpen(false); }} className="p-2.5 rounded-xl hover:bg-success/10 border-2 border-transparent hover:border-success/30 cursor-pointer transition-all flex justify-between items-center bg-background/40">
                                                                <span className="text-success font-black text-[10px]">✨ STOCK FÍSICO</span>
                                                                <span className="bg-success text-background px-2 py-0.5 rounded-full text-[9px]">{stockAnalysis.fisico} U.</span>
                                                            </div>
                                                        )}

                                                        {/* STOCK FLOTANTE */}
                                                        {stockAnalysis?.flotantes.map(flot => {
                                                            const isConfirmed = flot.isConfirmed;
                                                            return (
                                                                <div key={flot.id} onClick={() => { setSelectedStockSource(isConfirmed ? `flotante_conf_${flot.id}` : `flotante_noc_${flot.id}`); setDropdownOpen(false); }} className={`p-2.5 rounded-xl cursor-pointer transition-all border-2 border-transparent ${isConfirmed ? 'bg-primary/5 hover:bg-primary/10 hover:border-primary/30' : 'bg-orange-400/5 hover:bg-orange-400/10 hover:border-orange-400/30'}`}>
                                                                    <div className="flex justify-between items-center">
                                                                        <span className={`font-black text-[10px] ${isConfirmed ? 'text-primary' : 'text-orange-400'}`}>
                                                                            {isConfirmed ? '✅ CONFIRMADO' : '⏳ POR CONFIRMAR'}
                                                                        </span>
                                                                        {flot.fechaArribo && (
                                                                            <span className="text-[9px] font-mono opacity-60">LLEGA: {new Date(flot.fechaArribo).toLocaleDateString()}</span>
                                                                        )}
                                                                    </div>
                                                                    <div className="text-[9px] font-bold mt-1 uppercase text-text truncate">{flot.nombre} - {flot.qty} U.</div>
                                                                </div>
                                                            );
                                                        })}

                                                        {/* ENCUESTAR EN SEMANAS ABIERTAS */}
                                                        {semanas.filter(s => {
                                                            // LOGICA DEL SABADO 12:00
                                                            const dateMatch = s.nombre.match(/(\d+)-(\d+)$/);
                                                            if (!dateMatch) return s.abierta;
                                                            const [_, d, m] = dateMatch;
                                                            const weekDate = new Date(new Date().getFullYear(), parseInt(m)-1, parseInt(d));
                                                            // Saturday is day 6. Calculate distance to next Saturday.
                                                            const diff = (6 - weekDate.getDay() + 7) % 7;
                                                            const deadline = new Date(weekDate);
                                                            deadline.setDate(weekDate.getDate() + (diff === 0 ? 0 : diff));
                                                            deadline.setHours(12, 0, 0);
                                                            
                                                            return s.abierta && new Date() < deadline;
                                                        }).slice(0,4).map(s => (
                                                            <div key={s.id} onClick={() => { setSelectedStockSource(`pedido_${s.id}`); setDropdownOpen(false); }} className="p-2.5 rounded-xl bg-background/60 hover:bg-muted/30 border border-border/50 cursor-pointer transition-all flex justify-between items-center group">
                                                                <span className="text-[10px] font-bold text-muted group-hover:text-text truncate pr-2">📂 {s.nombre}</span>
                                                                <ArrowRight size={10} className="text-muted opacity-0 group-hover:opacity-100 transition-all"/>
                                                            </div>
                                                        ))}

                                                        {/* PROXIMO PEDIDO (PENDIENTE) */}
                                                        {(() => {
                                                            const today = new Date();
                                                            const nextSat = new Date();
                                                            nextSat.setDate(today.getDate() + (6 - today.getDay() + 7) % 7);
                                                            const arrival = new Date(nextSat);
                                                            arrival.setDate(nextSat.getDate() + 22);
                                                            const dateStr = arrival.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });

                                                            return (
                                                                <div onClick={() => { setSelectedStockSource('pedido_PENDIENTE'); setDropdownOpen(false); }} className="mt-1 p-3 rounded-xl bg-purple-500/10 border-2 border-dashed border-purple-500/30 hover:bg-purple-500/20 hover:border-purple-500/60 cursor-pointer transition-all flex flex-col gap-1 items-center justify-center text-center group">
                                                                    <span className="text-purple-500 font-black text-[11px] flex items-center gap-2 group-hover:scale-110 transition-transform">🚀 PRÓXIMO PEDIDO</span>
                                                                    <span className="text-[9px] text-purple-400/80 font-bold uppercase italic">Arribo aprox: {dateStr}</span>
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="absolute top-[102%] left-0 w-full text-center">
                                                <p className="text-[8px] font-black text-muted-2 uppercase tracking-tighter opacity-70 leading-none">
                                                    * Corte de pedido: Sábados 12:00 PM. Pasada esta hora, se asigna a "Próximo Pedido" automáticamente.
                                                </p>
                                            </div>
                                        </div>

                                        <button onClick={()=>{
                                            if(!selectedStockSource) return alert("Selecciona origen de stock");
                                            addToCart();
                                            setDropdownOpen(false);
                                        }} disabled={!addForm.titulo || loading} className="h-[42px] px-6 bg-primary text-background font-black text-xs uppercase tracking-widest rounded-xl hover:scale-105 transition-all shadow-lg shadow-primary/20 disabled:opacity-50 shrink-0">
                                            Añadir
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80">Nombre de Colección (ej: Kingdom Hearts)</label>
                                                <input type="text" value={bulkSearch} onChange={e=>setBulkSearch(e.target.value)} onBlur={()=>searchBulkCatalog(bulkSearch)} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="Buscar título base..."/>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80">Rango de Tomos (ej: 1-5, 8, 10-12)</label>
                                                <div className="flex gap-2">
                                                    <input type="text" value={bulkRange} onChange={e=>setBulkRange(e.target.value)} className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm font-mono" placeholder="Definir rango..."/>
                                                    <button onClick={applyBulkRange} className="px-4 bg-muted hover:bg-muted/80 text-text font-black text-[10px] rounded-xl transition-all uppercase">Filtrar</button>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        {bulkResults.length > 0 && (
                                            <div className="bg-surface border border-border rounded-xl p-3 max-h-48 overflow-y-auto">
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                    {bulkResults.map(p => (
                                                        <label key={p.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${bulkSelected.has(p.id) ? 'bg-primary/10 border-primary shadow-sm' : 'border-border/50 hover:bg-muted/30'}`}>
                                                            <input type="checkbox" checked={bulkSelected.has(p.id)} onChange={()=>toggleBulkItem(p.id)} className="w-4 h-4 accent-primary" />
                                                            <span className="text-[11px] font-bold truncate flex-1">{p.titulo}</span>
                                                            <span className="text-[9px] text-muted font-mono shrink-0">BS {p.precio_venta_bs || p.precio_tapa}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex justify-between items-center mt-2 border-t border-border pt-4">
                                            <span className="text-[10px] font-black text-muted uppercase tracking-widest">{bulkSelected.size} Ítems seleccionados para añadir</span>
                                            <button onClick={addToCart} disabled={bulkSelected.size === 0 || loading} className="bg-secondary text-background font-black text-xs uppercase tracking-widest px-8 py-3 rounded-xl hover:scale-105 transition-all shadow-lg shadow-secondary/20">
                                                        Añadir Lote seleccionado a la tabla
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* TABLA DE ITEMS (CARRO) */}
                            {cart.length > 0 && (
                                <div className="flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
                                    <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-primary/10 border border-primary/20 p-4 rounded-2xl shadow-sm">
                                        <h3 className="text-[10px] font-black uppercase text-primary tracking-[0.2em] flex items-center gap-2">
                                            <ShoppingBag size={14} className="text-primary"/> Detalle del Pedido Actual
                                        </h3>
                                        
                                        <div className="flex flex-wrap items-center gap-3">
                                            <div className="flex items-center gap-2 bg-background/60 border border-border px-3 py-1.5 rounded-xl shadow-inner group focus-within:border-primary transition-all">
                                                <span className="text-[9px] font-black text-muted uppercase">Global Desc. %</span>
                                                <input 
                                                    type="number" 
                                                    placeholder="0"
                                                    className="w-12 bg-transparent text-xs font-bold text-error outline-none text-center"
                                                    onKeyDown={(e) => {
                                                        if(e.key === 'Enter') {
                                                            const pct = Number(e.target.value);
                                                            const next = cart.map(it => {
                                                                const base = Number(it.precio_original)||0;
                                                                const val = base * (pct/100);
                                                                return {...it, descuento: pct, precio_venta: (base - val).toFixed(0)};
                                                            });
                                                            setCart(next);
                                                        }
                                                    }}
                                                />
                                            </div>

                                            <div className="flex items-center gap-2 bg-background/60 border border-border px-3 py-1.5 rounded-xl shadow-inner group focus-within:border-success transition-all">
                                                <span className="text-[9px] font-black text-muted uppercase">Global Inicial BS</span>
                                                <input 
                                                    type="number" 
                                                    placeholder="0"
                                                    className="w-14 bg-transparent text-xs font-bold text-success outline-none text-center"
                                                    onKeyDown={(e) => {
                                                        if(e.key === 'Enter') {
                                                            const amt = Number(e.target.value);
                                                            const next = cart.map(it => ({...it, monto_pagado: amt}));
                                                            setCart(next);
                                                        }
                                                    }}
                                                />
                                            </div>

                                            <div className="flex items-center gap-2 bg-background/60 border border-border px-3 py-1.5 rounded-xl shadow-inner group focus-within:border-secondary transition-all">
                                                <span className="text-[9px] font-black text-muted uppercase tracking-tighter">Asignar Fuente Global</span>
                                                <select 
                                                    className="bg-transparent text-[9px] font-black uppercase outline-none cursor-pointer text-text"
                                                    onChange={(e) => {
                                                        const src = e.target.value;
                                                        if(!src) return;
                                                        const next = cart.map(it => ({...it, source: src}));
                                                        setCart(next);
                                                    }}
                                                >
                                                    <option value="">-- Elige --</option>
                                                    <option value="pedido_PENDIENTE">🚀 Próximo Pedido</option>
                                                    <option value="fisico">✨ Stock Físico</option>
                                                    {semanas.filter(s => s.abierta).slice(0,3).map(s => (
                                                        <option key={s.id} value={`pedido_${s.id}`}>📂 {s.nombre}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <button onClick={()=>setCart([])} className="p-2 text-muted-2 hover:text-error transition-colors hover:bg-error/5 rounded-lg" title="Limpiar todo el carrito">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="border border-border rounded-2xl overflow-hidden shadow-xl bg-surface/50 backdrop-blur-md">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="bg-background/80 text-[10px] font-black uppercase text-muted tracking-widest border-b border-border">
                                                    <th className="p-4 text-left">Título / Ítem</th>
                                                    <th className="p-4 text-center w-28">Precio Original</th>
                                                    <th className="p-4 text-center w-24">Desc. %</th>
                                                    <th className="p-4 text-center w-28 text-primary">Precio Final</th>
                                                    <th className="p-4 text-center w-28 text-success">Pago Inicial</th>
                                                    <th className="p-3 text-center w-[350px]">Asignación de Stock</th>
                                                    <th className="p-4 w-12 text-right"></th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border/30">
                                                {cart.map((c, i) => {
                                                    const finalPrice = Math.max(0, Number(c.precio_original) - (Number(c.descuento)||0));
                                                    
                                                    // Calculo de fecha para Proximo Pedido (Siguiente Sabado + 22 dias)
                                                    const todayDt = new Date();
                                                    const nextSatDt = new Date();
                                                    nextSatDt.setDate(todayDt.getDate() + (6 - todayDt.getDay() + 7) % 7);
                                                    const arrivalDt = new Date(nextSatDt);
                                                    arrivalDt.setDate(nextSatDt.getDate() + 22);
                                                    const dateStr = arrivalDt.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });

                                                    return (
                                                        <tr key={i} className="hover:bg-primary/5 transition-colors group">
                                                            <td className="p-4">
                                                                <div className="font-bold text-text leading-tight" title={c.titulo}>{c.titulo}</div>
                                                                <div className="text-[9px] text-muted uppercase font-mono mt-0.5">{c.product_id || 'ID Desconocido'}</div>
                                                            </td>
                                                            <td className="p-4">
                                                                <div className="flex items-center justify-center gap-1 border border-border rounded bg-surface px-2 py-1">
                                                                    <span className="text-[10px] text-muted font-bold">BS</span>
                                                                    <input type="number" value={c.precio_original} onChange={(e)=>{
                                                                        const base = Number(e.target.value);
                                                                        const pct = Number(c.descuento)||0;
                                                                        const final = base - (base * pct / 100);
                                                                        const next = [...cart];
                                                                        next[i] = {...c, precio_original: base, precio_venta: final.toFixed(0)};
                                                                        setCart(next);
                                                                    }} className="w-full bg-transparent text-center font-mono font-bold outline-none"/>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <div className="flex items-center justify-center gap-1 border border-border rounded bg-surface px-2 py-1">
                                                                    <span className="text-[10px] text-error font-bold">%</span>
                                                                    <input type="number" value={c.descuento} onChange={(e)=>{
                                                                        const pct = e.target.value;
                                                                        const base = Number(c.precio_original)||0;
                                                                        const final = base - (base * (Number(pct)||0) / 100);
                                                                        const next = [...cart];
                                                                        next[i] = {...c, descuento: pct, precio_venta: final.toFixed(0)};
                                                                        setCart(next);
                                                                    }} className="w-full bg-transparent text-center font-mono font-bold text-error outline-none"/>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <div className="flex items-center justify-center gap-1 border-2 border-primary/30 rounded-lg bg-primary/5 px-2 py-1">
                                                                    <span className="text-[10px] text-primary font-bold">BS</span>
                                                                    <input type="number" value={c.precio_venta} onChange={(e)=>{
                                                                        const final = e.target.value;
                                                                        const base = Number(c.precio_original)||0;
                                                                        const pct = base > 0 ? ((1 - Number(final) / base) * 100).toFixed(1) : 0;
                                                                        const next = [...cart];
                                                                        next[i] = {...c, precio_venta: final, descuento: pct};
                                                                        setCart(next);
                                                                    }} className="w-full bg-transparent text-center font-mono font-black text-primary outline-none"/>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <div className="flex items-center justify-center gap-1 border border-success/30 rounded bg-success/5 px-2 py-1">
                                                                    <span className="text-[10px] text-success">BS</span>
                                                                    <input type="number" value={c.monto_pagado} onChange={(e)=>{
                                                                        const v = Number(e.target.value);
                                                                        const next = [...cart];
                                                                        next[i] = {...c, monto_pagado: v};
                                                                        setCart(next);
                                                                    }} className="w-full bg-transparent text-center font-mono font-bold text-success outline-none"/>
                                                                </div>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <select 
                                                                    value={c.source} 
                                                                    onChange={(e) => {
                                                                        const next = [...cart];
                                                                        next[i] = {...c, source: e.target.value};
                                                                        setCart(next);
                                                                    }}
                                                                    className={`w-full bg-surface border-2 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase outline-none focus:border-primary shadow-sm transition-all ${
                                                                        c.source === 'fisico' ? 'border-success text-success bg-success/5' : 
                                                                        c.source === 'pedido_PENDIENTE' ? 'border-purple-500 text-purple-500 bg-purple-500/5' :
                                                                        c.source.includes('flotante_conf') ? 'border-primary text-primary bg-primary/5' :
                                                                        c.source.includes('flotante_noc') ? 'border-orange-400 text-orange-400 bg-orange-400/5' :
                                                                        'border-muted text-muted bg-muted/10'
                                                                    }`}
                                                                >
                                                                    <option value="pedido_PENDIENTE">🚀 PRÓXIMO PEDIDO (Arribo: {dateStr})</option>
                                                                    {c.stockOptions.fisico > 0 && <option value="fisico">✨ Stock Físico ({c.stockOptions.fisico} u.)</option>}
                                                                    {c.stockOptions.flotantes.map(flot => (
                                                                        <option key={flot.id} value={flot.isConfirmed ? `flotante_conf_${flot.id}` : `flotante_noc_${flot.id}`}>
                                                                            {flot.isConfirmed ? '🌍' : '⏳'} {flot.nombre} ({flot.qty} u.)
                                                                        </option>
                                                                    ))}
                                                                    {semanas.filter(s => {
                                                                            if (!s.abierta) return false;
                                                                            const dateMatch = s.nombre.match(/(\d+)-(\d+)$/);
                                                                            if (!dateMatch) return true;
                                                                            const [_, d, m] = dateMatch;
                                                                            const weekDate = new Date(new Date().getFullYear(), parseInt(m)-1, parseInt(d));
                                                                            const diff = (6 - weekDate.getDay() + 7) % 7;
                                                                            const deadline = new Date(weekDate);
                                                                            deadline.setDate(weekDate.getDate() + (diff === 0 ? 0 : diff));
                                                                            deadline.setHours(12, 0, 0);
                                                                            return new Date() < deadline;
                                                                        }).slice(0, 4).map(s => <option key={s.id} value={`pedido_${s.id}`}>Encargar p/ {s.nombre}</option>)}
                                                                </select>
                                                            </td>
                                                            <td className="p-4 text-right">
                                                                <button onClick={()=>removeFromCart(i)} className="text-muted/40 hover:text-error transition-colors p-1.5 hover:bg-error/10 rounded-lg">
                                                                    <Trash2 size={16}/>
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        <div className="bg-background/80 p-5 px-8 flex justify-between items-center border-t border-border">
                                            <div className="flex gap-8 text-[11px] font-black uppercase tracking-widest text-muted">
                                                <div>Items: <span className="text-text">{cart.length}</span></div>
                                                <div>Subtotal: <span className="text-text">BS {formatS(cart.reduce((s,i)=>s+Number(i.precio_original), 0))}</span></div>
                                                <div>Descuentos: <span className="text-error">BS {formatS(cart.reduce((s,i)=>s+Number(i.descuento), 0))}</span></div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className="text-[10px] font-black uppercase text-muted tracking-[0.2em]">Total Pedido</span>
                                                <span className="text-2xl font-mono font-black text-primary">BS {formatS(cart.reduce((s,i)=>s+Number(i.precio_venta), 0))}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-border flex justify-end gap-4 bg-background rounded-b-2xl shrink-0">
                            <button onClick={()=>{setShowAddModal(false); setCart([]);}} className="px-6 py-2.5 text-[11px] font-black uppercase tracking-widest text-muted hover:text-text transition-colors">Cancelar</button>
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
