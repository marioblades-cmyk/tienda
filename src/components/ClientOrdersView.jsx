import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { Search, Plus, ShoppingBag, CheckSquare, MessageCircle, ChevronDown, ChevronUp, Trash2, Edit2, Check, X, Box, RefreshCw, Info, Layers, Hash, Calendar, ArrowRight, Wallet, Lock, RotateCcw, AlertCircle, ShoppingCart } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { ffecha, fhora, ffechaLarga, fstamp } from '../utils/dateUtils';

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
    const [vendedores, setVendedores] = useState([]);

    // Controles vista
    const [view, setView] = useState('clientes'); // 'clientes' | 'items' | 'hoja' | 'especiales'
    const [search, setSearch] = useState('');
    const [filterEstado, setFilterEstado] = useState('todos'); // 'todos' | 'PEDIDO' | 'CONFIRMADO' | 'EN TIENDA' | 'ENTREGADO'
    const [filterSemana, setFilterSemana] = useState('todos'); // 'todos' | semana_id
    const [filterVendedor, setFilterVendedor] = useState('mine'); // 'mine' | 'todos' | vendedor_id
    const [expandedCliente, setExpandedCliente] = useState(new Set());
    const [compactClients, setCompactClients] = useState(new Set()); // IDs en modo compacto
    const [selectedSemanaHoja, setSelectedSemanaHoja] = useState('');
    const [selectedItems, setSelectedItems] = useState(new Set()); // IDs de ítems seleccionados para acciones masivas
    const [showEntregados, setShowEntregados] = useState(false); // Toggle para mostrar clientes totalmente entregados

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
    const [itemPayAmounts, setItemPayAmounts] = useState({}); // { [itemId]: monto }
    const [payMonto, setPayMonto] = useState('');
    const [pagoConcepto, setPagoConcepto] = useState('');
    const [payMethod, setPayMethod] = useState('Yasta (QR)'); // 'Efectivo' | 'Yasta (QR)' | 'Banco Unión (QR/Transf)' | 'BNB' | 'Otros'
    const [payReference, setPayReference] = useState(''); // No. operación para pagos digitales
    const [showAllPayMethods, setShowAllPayMethods] = useState(false);
    const [showHistorial, setShowHistorial] = useState(false);
    const [reprogrammingItem, setReprogrammingItem] = useState(null);
    const [batchDiscount, setBatchDiscount] = useState('');
    const [batchAbono, setBatchAbono] = useState('');
    const [orderMethod, setOrderMethod] = useState('Yasta (QR)'); // método del abono inicial al crear pedido
    const [orderPayAmt, setOrderPayAmt] = useState(''); // monto del pago inicial general
    const [orderPayMode, setOrderPayMode] = useState('items'); // 'items' | 'credit'
    
    // Helper para obtener abonos reales (excluyendo distribuciones/asignaciones)
    const getPagosRaiz = (list, cid) => (list || []).filter(p => p.cliente_id === cid && !p.concepto?.startsWith('Asignado a:'));
    const [editPago, setEditPago] = useState(null); // { id, concepto, monto, metodo_pago, caja_mov_id }
    const [modoHistorico, setModoHistorico] = useState(false);
    const [histSemana, setHistSemana] = useState(''); // semana_id para modo histórico
    const [editItem, setEditItem] = useState(null); // { id, titulo, precio_venta, estado, nota, semana_id }
    const [bulkEstadoTarget, setBulkEstadoTarget] = useState('ENTREGADO');
    const [bulkSemanaTarget, setBulkSemanaTarget] = useState('');
    const [historialOpen, setHistorialOpen] = useState(false);
    const [cartSelected, setCartSelected] = useState(new Set()); // índices seleccionados en el carrito histórico
    const [cartBulkSemana, setCartBulkSemana] = useState('');
    const [cartBulkEstado, setCartBulkEstado] = useState('ENTREGADO');
    const [sinContabilidad, setSinContabilidad] = useState(false); // registrar pago sin caja_movimientos
    const [expandedRoots, setExpandedRoots] = useState(new Set()); // IDs de raíces expandidas en historial
    const [showAllPagosHistory, setShowAllPagosHistory] = useState(new Set()); // cliente_ids que muestran historial completo
    const [clienteSugg, setClienteSugg] = useState([]); // Sugerencias autocomplete cliente
    const [clienteSuggField, setClienteSuggField] = useState(''); // 'celular' | 'nombre'
    const [editCliente, setEditCliente] = useState(null); // { id, nombre, celular, ci, ciudad, sucursal, direccion, notas_cliente }
    const [deleteCliente, setDeleteCliente] = useState(null); // { id, nombre } para confirmación
    const [showDamageModal, setShowDamageModal] = useState(false);
    const [damageTarget, setDamageTarget] = useState(null); // { item, client }
    const [damageStockAnalysis, setDamageStockAnalysis] = useState(null);
    const [resolvingDamage, setResolvingDamage] = useState(false);
    
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
                // Limpiar sub-entradas "Asignado a:" — el saldo vuelve al balance automáticamente
                if (Number(it.monto_pagado || 0) > 0) {
                    const { data: pagosAsignados } = await supabase
                        .from('cliente_pagos')
                        .select('id, monto, caja_mov_id')
                        .eq('cliente_id', it.cliente_id)
                        .eq('concepto', `Asignado a: ${it.titulo}`);

                    for (const sub of (pagosAsignados || [])) {
                        if (sub.caja_mov_id) {
                            const { data: rootPago } = await supabase
                                .from('cliente_pagos')
                                .select('id, monto, concepto')
                                .eq('caja_mov_id', sub.caja_mov_id)
                                .eq('cliente_id', it.cliente_id)
                                .not('concepto', 'ilike', 'Asignado a:%')
                                .maybeSingle();
                            if (rootPago && Number(rootPago.monto) === 0) {
                                const { data: cajaMov } = await supabase.from('caja_movimientos').select('monto').eq('id', sub.caja_mov_id).maybeSingle();
                                await supabase.from('cliente_pagos').update({
                                    monto: cajaMov ? Number(cajaMov.monto) : Number(sub.monto),
                                    concepto: rootPago.concepto?.replace(' (Totalmente Distribuido)', '') || rootPago.concepto
                                }).eq('id', rootPago.id);
                            }
                        }
                        await supabase.from('cliente_pagos').delete().eq('id', sub.id);
                    }
                }
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
                        .select('id, stock_fisico, titulo')
                        .eq(lookupCol, lookupVal)
                        .maybeSingle();
                    if (prod) {
                        await supabase.from('catalogo_productos')
                            .update({ stock_fisico: (prod.stock_fisico || 0) + 1 })
                            .eq('id', prod.id);
                        await catalogService.logStockMovement({
                            productoId: prod.id,
                            titulo: prod.titulo || it.titulo || '',
                            delta: 1,
                            stockDespues: (prod.stock_fisico || 0) + 1,
                            motivo: 'DEVOLUCIÓN',
                            detalle: 'Ítem eliminado del pedido (bulk)',
                        });
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

    const handleResolveDamage = async (method) => {
        if (!damageTarget || !user) return;
        setResolvingDamage(true);
        try {
            const { item, client } = damageTarget;
            const originalId = item.id;
            const originalMonto = item.monto_pagado || 0;

            // 1. Marcar original como DAÑADO y ANULAR DEUDA/PAGO (se transfiere al nuevo)
            const { error: err1 } = await supabase
                .from('cliente_items')
                .update({ 
                    estado: 'DAÑADO',
                    precio_venta: 0,
                    monto_pagado: 0,
                    nota: (item.nota || '') + ` [DAÑADO - Saldo $${originalMonto} transferido al nuevo]`
                })
                .eq('id', originalId);
            if (err1) throw err1;

            if (method === 'STOCK') {
                // Buscar producto en catálogo
                const { data: prod, error: pErr } = await supabase
                    .from('catalogo_productos')
                    .select('id, stock_fisico, titulo')
                    .eq('id', item.catalog_id || item.product_id)
                    .maybeSingle();
                
                if (pErr) throw pErr;
                if (!prod || (prod.stock_fisico || 0) <= 0) {
                    throw new Error("No hay stock físico suficiente para reponer de inmediato.");
                }

                // 2. Crear reposición como EN TIENDA con el saldo transferido
                const { error: err2 } = await supabase
                    .from('cliente_items')
                    .insert([{
                        cliente_id: item.cliente_id,
                        vendedor_id: item.vendedor_id,
                        titulo: item.titulo,
                        catalog_id: item.catalog_id,
                        product_id: item.product_id,
                        precio_venta: item.precio_venta,
                        monto_pagado: originalMonto,
                        estado: 'EN TIENDA',
                        semana_id: null,
                        nota: `Reposición de ítem #${originalId.slice(0,5)} (Saldo de original)`
                    }]);
                if (err2) throw err2;

                // 3. Descontar Stock
                const { error: err3 } = await supabase
                    .from('catalogo_productos')
                    .update({ stock_fisico: prod.stock_fisico - 1 })
                    .eq('id', prod.id);
                if (err3) throw err3;

                await catalogService.logStockMovement({
                    productoId: prod.id,
                    titulo: prod.titulo,
                    delta: -1,
                    stockDespues: prod.stock_fisico - 1,
                    motivo: 'CAMBIO/REPOSICIÓN',
                    detalle: `Reposición para cliente ${client?.nombre || 'Desconocido'}`
                });

            } else {
                // método === 'PEDIDO'
                const openWeek = semanas.find(s => s.abierta);
                if (!openWeek) throw new Error("No hay ninguna semana abierta para realizar el pedido de reposición.");

                // 2. Crear reposición como PEDIDO con el saldo transferido
                const { error: err2 } = await supabase
                    .from('cliente_items')
                    .insert([{
                        cliente_id: item.cliente_id,
                        vendedor_id: item.vendedor_id,
                        titulo: item.titulo,
                        catalog_id: item.catalog_id,
                        product_id: item.product_id,
                        precio_venta: item.precio_venta,
                        monto_pagado: originalMonto,
                        estado: `PEDIDO ${openWeek.nombre}`,
                        semana_id: openWeek.id,
                        nota: `Reposición de ítem #${originalId.slice(0,5)} (Saldo de original)`
                    }]);
                if (err2) throw err2;
            }

            alert("Reposición procesada con éxito y saldo transferido.");
            setShowDamageModal(false);
            setDamageTarget(null);
            fetchData();
        } catch (error) {
            console.error(error);
            alert("Error al procesar daño: " + error.message);
        } finally {
            setResolvingDamage(false);
        }
    };

    useEffect(() => {
        fetchData();
        fetchCatalog();
    }, [filterVendedor]);

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

            if (!isAdmin && user?.id) {
                // Si el filtro es 'todos', permitimos ver ítems de otros socios
                if (filterVendedor === 'todos') {
                    // No filtramos por vendedor_id en itemsQuery para que la búsqueda sea global
                } else {
                    itemsQuery = itemsQuery.or(`vendedor_id.eq.${user.id},vendedor_id.is.null,estado.eq.POR CONFIRMAR`);
                }

                
                // IMPORTANTE: Pagos siempre deben ser globales para el cliente para calcular deuda real,
                // pero por seguridad limitamos a los clientes que el vendedor puede ver.
                // Sin embargo, para simplificar y asegurar consistencia, cargaremos pagos sin filtrar por vendedor_id.
                // pagosQuery = siempre carga todos los abonos para que el saldo sea veraz.
                
                // Búsqueda de otros socios (para coordinación de envíos/entregas cuando no estamos en 'todos')
                if (filterVendedor !== 'todos') {
                    othersQuery = supabase.from('cliente_items')
                        .select('id, cliente_id, vendedor_id, titulo, precio_venta, monto_pagado, estado, semana_id')
                        .neq('vendedor_id', user.id)
                        .neq('estado', 'ENTREGADO');
                }
            }

            const [clientesRes, semanasRes, itemsRes, pagosRes, othersRes, vendedoresRes] = await Promise.all([
                supabase.from('clientes').select('*').order('created_at', { ascending: false }),
                supabase.from('semanas').select('*').order('created_at', { ascending: false }),
                itemsQuery.order('created_at', { ascending: false }),
                pagosQuery.order('created_at', { ascending: false }),
                othersQuery ? othersQuery : Promise.resolve({ data: [] }),
                supabase.from('vendedores').select('id, nombre, email').order('nombre')
            ]);

            if (clientesRes.error) throw clientesRes.error;

            setClientes(clientesRes.data || []);
            setItems(itemsRes.data || []);
            setOtherSellersItems(othersRes.data || []);
            setPagos(pagosRes.data || []);
            setSemanas(semanasRes.data || []);
            setVendedores(vendedoresRes.data || []);
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

    const getAuditNote = () => {
        const myName = vendedores.find(v => v.id === user?.id)?.nombre || user?.email || 'un socio';
        const now = fstamp(new Date());
        return `[✔ Entregado por ${myName} el ${now}]`;
    };

    const renderStatus = (it, compact = false) => {
        const week = semanas.find(s => s.id === it.semana_id);
        const isAdjudicado = it.estado === 'ADJUDICADO';
        const isFloating = isAdjudicado || it.estado.startsWith('CONFIRMADO') || it.estado.startsWith('PEDIDO');

        // Extraer número de semana del nombre, ej: "ENTELEQUIA DISTRIBUCIÓN 15 20-3" → "15"
        const weekNum = week ? (week.nombre.match(/\b(\d+)\b/) || [])[1] : null;

        let displayEstado;
        if (compact) {
            if (isAdjudicado) {
                displayEstado = weekNum ? `AD. CONF. sem.${weekNum}` : 'AD. CONF.';
            } else if (it.estado.startsWith('CONFIRMADO')) {
                displayEstado = weekNum ? `CONF. sem.${weekNum}` : 'CONF.';
            } else if (it.estado.startsWith('PEDIDO')) {
                displayEstado = weekNum ? `PED. sem.${weekNum}` : 'PEDIDO';
            } else {
                displayEstado = it.estado;
            }
        } else {
            displayEstado = isAdjudicado ? `AD. CONFIRMADO${week ? ' ' + week.nombre : ''}` : it.estado;
        }

        let dateStr = null;
        if (!compact) {
            if (isFloating && week) {
                const d = week.fecha_estimada_llegada ? new Date(week.fecha_estimada_llegada) : new Date(new Date(week.created_at).getTime() + (22*24*60*60*1000));
                dateStr = d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
            } else if (it.estado === 'PEDIDO (Siguiente)') {
                const now = new Date();
                const diff = (6 - now.getDay() + 7) % 7 || 7;
                const arrival = new Date(now.getTime() + ((diff + 22) * 24 * 60 * 60 * 1000));
                dateStr = arrival.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
            }
        }

        return (
            <div className={`flex flex-col ${compact ? 'items-start' : 'items-center'} gap-0.5`}>
                <div className="flex items-center gap-1">
                    <span
                        onClick={() => setEditItem({ id: it.id, titulo: it.titulo, precio_venta: it.precio_venta, estado: (it.estado || '').split(' ')[0], semana_id: it.semana_id || '', nota: it.nota || '', vendedor_id: it.vendedor_id })}
                        className={`px-2 py-0.5 rounded ${compact ? 'text-[9px]' : 'text-[10px]'} font-bold tracking-wide cursor-pointer border transition-colors whitespace-nowrap ${
                            it.estado === 'POR CONFIRMAR' ? 'bg-orange-500/20 border-orange-500 text-orange-400 animate-pulse font-black' :

                            it.estado === 'DAÑADO' ? 'bg-orange-500/10 border-orange-500/30 text-orange-500' :
                            it.estado === 'RECORTADO' ? 'bg-red-500/10 border-red-500/30 text-red-500 animate-pulse' :
                            it.estado === 'ENTREGADO' ? 'bg-background/50 border-border text-muted' :
                            it.estado === 'EN TIENDA' ? 'bg-success/10 border-success/30 text-success shadow-sm shadow-success/20' :
                            it.estado.includes('ESPAÑA') ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 shadow-sm shadow-purple-500/20' :
                            it.estado.includes('TRÁNSITO') ? 'bg-orange-400/10 border-orange-400/30 text-orange-400 shadow-sm shadow-orange-500/20' :
                            (isAdjudicado || it.estado.startsWith('CONFIRMADO')) ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 shadow-sm shadow-blue-500/20' :
                            'bg-primary/10 border-primary/30 text-primary shadow-sm shadow-primary/20'

                        }`}
                    >
                        {displayEstado}
                    </span>
                    {!compact && (it.estado === 'ENTREGADO' || it.estado === 'EN TIENDA' || it.estado === 'ADJUDICADO') && (
                        <button 
                            onClick={async (e) => {
                                e.stopPropagation();
                                const client = clientes.find(c => c.id === it.cliente_id);
                                setDamageTarget({ item: it, client });
                                setShowDamageModal(true);
                                setDamageStockAnalysis(null);
                                const analysis = await analyzeStockForItem(it.titulo);
                                setDamageStockAnalysis(analysis);
                            }}
                            className="p-1 text-orange-400 hover:text-orange-600 hover:bg-orange-500/10 rounded transition-colors"
                            title="Reportar daño / Cambio"
                        >
                            <AlertCircle size={14} />
                        </button>
                    )}
                </div>
                {!compact && it.estado === 'RECORTADO' && (
                    <button
                        onClick={(e) => { e.stopPropagation(); setReprogrammingItem(it); }}
                        className="mt-1 text-[9px] font-black bg-navy text-white px-2 py-0.5 rounded hover:bg-secondary transition-colors"
                    >
                        RE-PROGRAMAR
                    </button>
                )}
                {!compact && dateStr && it.estado !== 'RECORTADO' && <span className="text-[9px] text-muted font-bold italic tracking-tight whitespace-nowrap opacity-80">Est. ~{dateStr}</span>}
            </div>
        );
    };

    const handleSearchCatalog = (val) => {
        setAddForm({ ...addForm, titulo: val });
        if (val.length > 2) {
            const lower = val.toLowerCase();
            const matches = catalog.filter(c => c.titulo.toLowerCase().includes(lower)).slice(0, 50);
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
                    const personalTotal = (allOrders || [])
                        .filter(p => (p.titulo||'').toLowerCase().trim() === pTitle && p.pedido.tipo === 'personal' && p.pedido.semana_id === w.id)
                        .reduce((s,p) => s + (p.cantidad||0), 0);
                    const clientWaitlist = items.filter(it =>
                        (it.titulo||'').toLowerCase().trim() === pTitle &&
                        it.semana_id === w.id &&
                        it.estado.includes('PEDIDO')
                    ).length;
                    // Clientes de pedidos personales no consumen del stock de tienda
                    const storeClientWaitlist = Math.max(0, clientWaitlist - personalTotal);
                    qtyFlot = Math.max(0, storeTotal - storeClientWaitlist);
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

            // Sugerencia para España
            if (catProd?.editorial === 'Panini España') {
                defaultSource = 'pedido_ESPANA';
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
                    pagoIndividual: 0, // Nuevo campo para control de pago inicial por ítem
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
                            const personalTotal = allOrders2.filter(p => (p.titulo||'').toLowerCase().trim() === pTitle && p.pedido.tipo === 'personal' && p.pedido.semana_id === w.id).reduce((s,p) => s + (p.cantidad||0), 0);
                            const clientWaitlist = items.filter(it => (it.titulo||'').toLowerCase().trim() === pTitle && it.semana_id === w.id && it.estado.includes('PEDIDO')).length;
                            const storeClientWaitlist = Math.max(0, clientWaitlist - personalTotal);
                            qtyFlot = Math.max(0, storeTotal - storeClientWaitlist);
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
                        const sId = cItem.source.replace('pedido_', '');
                        if (sId === 'ESPANA') {
                            targetSemanaId = null;
                            estadoTarget = 'PRE-VENTA ESPAÑA';
                            cItem.nota = cItem.nota ? `[ESPAÑA] ${cItem.nota}` : '[ESPAÑA]';
                        } else {
                            targetSemanaId = sId;
                            const sFound = semanas.find(s=>s.id === targetSemanaId);
                            const wName = sFound?.nombre || '';
                            estadoTarget = `PEDIDO ${wName}`;
                        }
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

            // 3. Insert Items (Modificado para obtener los IDs generados)
            const { data: insertedItems, error: insErr } = await supabase.from('cliente_items').insert(itemsToInsert).select();
            if (insErr) throw insErr;

            // 4. Subtract stock (solo en modo normal, no histórico)
            for (let cItem of cart) {
                if (!modoHistorico && cItem.source === 'fisico') {
                    const lookupCol = cItem.catalog_id ? 'id' : (cItem.product_id ? 'product_id' : null);
                    const lookupVal = cItem.catalog_id || cItem.product_id;
                    
                    if (lookupCol && lookupVal) {
                        const { data: prod } = await supabase.from('catalogo_productos')
                            .select('id, stock_fisico, titulo')
                            .eq(lookupCol, lookupVal)
                            .maybeSingle();

                        if (prod && (prod.stock_fisico || 0) > 0) {
                            await supabase.from('catalogo_productos')
                                .update({ stock_fisico: prod.stock_fisico - 1 })
                                .eq('id', prod.id);
                            await catalogService.logStockMovement({
                                productoId: prod.id,
                                titulo: prod.titulo || cItem.titulo || '',
                                delta: -1,
                                stockDespues: prod.stock_fisico - 1,
                                motivo: 'VENTA',
                                detalle: `Cliente: ${clientes.find(c => c.id === clienteId)?.nombre || clienteId}`,
                            });
                        }
                    }
                }
            }
            
            if (typeof catalogService !== 'undefined') catalogService.clearCache();

            // 5. Registrar pago inicial (Refactorizado: Binario Items vs Crédito)
            const totalAbonoCalculado = orderPayMode === 'items' 
                ? cart.reduce((s, c) => s + (Number(c.pagoIndividual) || 0), 0)
                : (Number(orderPayAmt) || 0);

            if (totalAbonoCalculado > 0) {
                const clienteNombre = clientes.find(c => c.id === clienteId)?.nombre || addForm.nombre || clienteId;
                let cajaMovId = null;

                // 5.1 Crear Movimiento de Caja (Solo si no es modo histórico y hay dinero nuevo real)
                // montoNuevoRealOrder declarado aquí para que esté disponible en 5.2
                const cliItemsActuales = items.filter(i => i.cliente_id === clienteId);
                const cliPagActuales = getPagosRaiz(pagos, clienteId).reduce((s,p) => s + Number(p.monto), 0);
                const cliPagItemsActuales = cliItemsActuales.reduce((s,i) => s + Number(i.monto_pagado||0), 0);
                const creditoExistente = Math.max(0, cliPagActuales - cliPagItemsActuales);
                const montoNuevoRealOrder = Math.max(0, totalAbonoCalculado - creditoExistente);

                if (!modoHistorico) {

                    if (montoNuevoRealOrder > 0) {
                        let turnoId = null;
                        if (orderMethod === 'Efectivo') {
                            const { data: activeTurnoArr } = await supabase
                                .from('turnos_caja').select('id').eq('estado', 'ABIERTO')
                                .order('abierto_at', { ascending: false }).limit(1);

                            if (!activeTurnoArr || activeTurnoArr.length === 0) {
                                alert("No hay ningún turno abierto en el flujo de caja para recibir el dinero. Por favor, abre un turno en Contabilidad antes de continuar.");
                                setLoading(false);
                                return;
                            }
                            turnoId = activeTurnoArr[0].id;
                        }
                        const { data: cajaMov } = await supabase.from('caja_movimientos').insert([{
                            turno_id: turnoId,
                            tipo: 'INGRESO',
                            categoria: 'Cobro Pedido',
                            concepto: orderPayMode === 'items'
                                ? `ABONO PEDIDO [${clienteNombre}] · ${cart.length} ítem(s)`
                                : `ABONO INICIAL CRÉDITO [${clienteNombre}]`,
                            monto: montoNuevoRealOrder,
                            vendedor_id: user?.id,
                            metodo_pago: orderMethod,
                            origen: 'Pedidos'
                        }]).select('id').single();
                        cajaMovId = cajaMov?.id || null;
                    }
                }

                // 5.2 Lógica según Modo de Pago
                if (orderPayMode === 'items') {
                    // Crear registro RAÍZ en cliente_pagos
                    // monto = montoNuevoRealOrder para no inflar saldo cuando hay crédito existente
                    // En modo histórico siempre se registra el total (sin crédito previo)
                    const rootMontoOrder = modoHistorico ? totalAbonoCalculado : montoNuevoRealOrder;
                    if (rootMontoOrder > 0) {
                        await supabase.from('cliente_pagos').insert([{
                            cliente_id: clienteId,
                            monto: rootMontoOrder,
                            concepto: modoHistorico
                                ? `Pago inicial (histórico) · ${cart.length} ítem(s)`
                                : `Pago inicial · ${cart.length} ítem(s)`,
                            vendedor_id: user?.id,
                            metodo_pago: orderMethod,
                            referencia: null,
                            caja_mov_id: cajaMovId,
                        }]);
                    }

                    // Distribución manual basada en lo ingresado en el carrito
                    for (let idx = 0; idx < cart.length; idx++) {
                        const cItemInput = cart[idx];
                        const dbItem = (insertedItems || [])[idx];
                        const amt = Number(cItemInput.pagoIndividual) || 0;
                        
                        if (amt > 0 && dbItem) {
                            // Actualizar ítem en DB
                            await supabase.from('cliente_items')
                                .update({ monto_pagado: (Number(dbItem.monto_pagado) || 0) + amt })
                                .eq('id', dbItem.id);
                            
                            // Crear pago granular
                            await supabase.from('cliente_pagos').insert([{
                                cliente_id: clienteId,
                                monto: amt,
                                concepto: `Asignado a: ${dbItem.titulo}${modoHistorico ? ' (histórico)' : ''}`,
                                vendedor_id: user?.id,
                                metodo_pago: orderMethod,
                                caja_mov_id: cajaMovId,
                            }]);
                        }
                    }
                } else {
                    // Modo Crédito: Un solo registro de pago sin tocar ítems
                    await supabase.from('cliente_pagos').insert([{
                        cliente_id: clienteId,
                        monto: totalAbonoCalculado,
                        concepto: modoHistorico ? 'Abono inicial (histórico)' : 'Abono inicial',
                        vendedor_id: user?.id,
                        metodo_pago: orderMethod,
                        caja_mov_id: cajaMovId,
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
            window.dispatchEvent(new CustomEvent('contabilidad:refresh'));
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

            // [BLOQUE 5] Calcular dinero realmente nuevo (descontando saldo flotante)
            // Solo se cuenta como "balance" el dinero que pasó por caja (caja_mov_id != null).
            // Los pagos históricos/manuales (caja_mov_id=null) no se descuentan para evitar
            // que anulen nuevos pagos reales y dejen entradas de caja sin registrar.
            const pItemsParaBalance = items.filter(i => i.cliente_id === clienteId);
            const cPagItemsBal = pItemsParaBalance.reduce((s,i) => s + Number(i.monto_pagado||0), 0);
            const groupPagosBal = getPagosRaiz(pagos, clienteId)
                .filter(p => p.caja_mov_id != null)
                .reduce((s,p) => s + Number(p.monto), 0);
            const balanceExistente = Math.max(0, groupPagosBal - cPagItemsBal);
            const montoNuevoReal = Math.max(0, amt - balanceExistente);

            // --- LEDGER: Registrar en caja_movimientos PRIMERO para capturar el ID ---
            let turnoId = null;
            if (payMethod === 'Efectivo') {
                const { data: activeTurnoArr } = await supabase
                    .from('turnos_caja')
                    .select('id')
                    .eq('estado', 'ABIERTO')
                    .order('abierto_at', { ascending: false })
                    .limit(1);
                
                if (!sinContabilidad && montoNuevoReal > 0 && (!activeTurnoArr || activeTurnoArr.length === 0)) {
                    alert("No hay ningún turno abierto en el flujo de caja para recibir el dinero. Por favor, abre un turno en Contabilidad antes de continuar.");
                    setLoading(false);
                    return;
                }
                turnoId = activeTurnoArr?.[0]?.id || null;
            }

            let cajaMov = null;
            if (!sinContabilidad && montoNuevoReal > 0) {
                const concetoLedger = `ABONO PEDIDO [${cli?.nombre || clienteId}]${payReference ? ' · Ref: ' + payReference : ''}${pagoConcepto ? ' · ' + pagoConcepto : ''}`;
                const { data: cajaMovData, error: moveErr } = await supabase.from('caja_movimientos').insert([{
                    turno_id: turnoId,
                    tipo: 'INGRESO',
                    categoria: 'Cobro Pedido',
                    concepto: concetoLedger,
                    monto: montoNuevoReal, // ← solo el dinero nuevo
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
                
                // Determinar si todos los ítems seleccionados se pagaron por completo
                const todosCompletos = itemsToUpdate.every(eq => {
                    const deuda = Math.max(0, Number(eq.precio_venta) - Number(eq.monto_pagado || 0));
                    return Number(itemPayAmounts[eq.id] || 0) >= deuda;
                });

                // [NUEVO] Crear registro RAÍZ en cliente_pagos — solo si hay dinero nuevo real
                // monto = montoNuevoReal (no amt) para evitar inflar el saldo disponible cuando
                // parte del pago viene de crédito existente del cliente
                if (montoNuevoReal > 0) {
                    await supabase.from('cliente_pagos').insert([{
                        cliente_id: clienteId,
                        monto: montoNuevoReal,
                        concepto: todosCompletos
                            ? `Pago recibido · ${itemsToUpdate.length} ítem(s)`
                            : `Pago parcial · ${itemsToUpdate.length} ítem(s)`,
                        vendedor_id: user?.id,
                        metodo_pago: payMethod,
                        referencia: payReference || null,
                        caja_mov_id: cajaMov?.id || null,
                    }]);
                }

                for (let eq of itemsToUpdate) {
                    const aplicar = Number(itemPayAmounts[eq.id] || 0);
                    
                    if (aplicar > 0) {
                        const nuevoMonto = Number(eq.monto_pagado || 0) + aplicar;
                        await supabase.from('cliente_items').update({
                            monto_pagado: nuevoMonto,
                            estado: eq.estado
                        }).eq('id', eq.id);

                        // Crear un registro de pago específico para este ítem
                        await supabase.from('cliente_pagos').insert([{
                            cliente_id: clienteId,
                            monto: aplicar,
                            concepto: `Asignado a: ${eq.titulo}`,
                            vendedor_id: user?.id,
                            metodo_pago: payMethod,
                            referencia: payReference || null,
                            caja_mov_id: cajaMov?.id || null, // Mismo ID de caja para todos
                        }]);
                    }
                }
            }

            setShowPayModal(null);
            setPayMonto('');
            setPagoConcepto('');
            setPayReference('');
            setSelectedPayItems([]);
            setItemPayAmounts({});
            setPayMethod('Yasta (QR)');
            setSelectedPayItems([]);
            setSinContabilidad(false);

            await fetchData();
            window.dispatchEvent(new CustomEvent('contabilidad:refresh'));
            alert(sinContabilidad ? "✓ Pago registrado (sin movimiento en Contabilidad)." : "✓ Pago registrado y contabilizado correctamente.");
        } catch (e) {
            console.error(e);
            alert(e.message || "Error al registrar pago");
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePago = async (pago) => {
        const esAsignado = pago.concepto?.startsWith('Asignado a:');

        // Si es una sub-entrada "Asignado a:", usar la lógica de revertir asignación
        if (esAsignado) {
            return handleRevertirDistribucion(pago);
        }

        if (!confirm(
            `¿Eliminar este abono?\n${pago.concepto || 'Abono'} — BS ${Number(pago.monto).toLocaleString('es-BO', { minimumFractionDigits: 2 })}\n\n` +
            `⚠️ También se eliminarán todas las asignaciones vinculadas y se restarán de los ítems correspondientes.` +
            (pago.caja_mov_id ? '\n\nSe eliminará de Contabilidad.' : '')
        )) return;

        try {
            setLoading(true);

            // 1. Buscar y procesar todas las sub-entradas "Asignado a:" vinculadas
            if (pago.caja_mov_id) {
                const { data: subEntries } = await supabase
                    .from('cliente_pagos')
                    .select('id, monto, concepto, cliente_id')
                    .eq('caja_mov_id', pago.caja_mov_id)
                    .like('concepto', 'Asignado a:%');

                for (const sub of (subEntries || [])) {
                    const titulo = sub.concepto.replace('Asignado a: ', '').trim();

                    // Restar del ítem correspondiente
                    const { data: itFresh } = await supabase
                        .from('cliente_items')
                        .select('id, monto_pagado')
                        .eq('cliente_id', sub.cliente_id)
                        .eq('titulo', titulo)
                        .maybeSingle();

                    if (itFresh && Number(sub.monto) > 0) {
                        const nuevoMonto = Math.max(0, Number(itFresh.monto_pagado || 0) - Number(sub.monto));
                        await supabase.from('cliente_items').update({ monto_pagado: nuevoMonto }).eq('id', itFresh.id);
                    }

                    // Borrar la sub-entrada
                    await supabase.from('cliente_pagos').delete().eq('id', sub.id);
                }
            }

            // 2. Borrar el movimiento de contabilidad
            if (pago.caja_mov_id) {
                await supabase.from('caja_movimientos').delete().eq('id', pago.caja_mov_id);
            }

            // 3. Borrar el registro raíz
            await supabase.from('cliente_pagos').delete().eq('id', pago.id);

            await fetchData();
            window.dispatchEvent(new CustomEvent('contabilidad:refresh'));
        } catch (e) {
            console.error(e);
            alert('Error al eliminar el abono: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateCliente = async () => {
        if (!editCliente) return;
        if (!editCliente.nombre?.trim()) return alert('El nombre es requerido.');
        try {
            setLoading(true);
            const { error } = await supabase.from('clientes').update({
                nombre: editCliente.nombre.trim(),
                celular: editCliente.celular?.trim() || '',
                ci: editCliente.ci?.trim() || '',
                ciudad: editCliente.ciudad?.trim() || '',
                sucursal: editCliente.sucursal?.trim() || '',
                direccion: editCliente.direccion?.trim() || '',
            }).eq('id', editCliente.id);
            if (error) throw error;
            setEditCliente(null);
            await fetchData();
        } catch (e) {
            alert('Error al guardar: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteCliente = async () => {
        if (!deleteCliente) return;
        try {
            setLoading(true);
            const { error } = await supabase.from('clientes').delete().eq('id', deleteCliente.id);
            if (error) throw error;
            setDeleteCliente(null);
            await fetchData();
        } catch (e) {
            alert('Error al eliminar cliente: ' + e.message);
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
            window.dispatchEvent(new CustomEvent('contabilidad:refresh'));
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
            const itOriginal = items.find(i => i.id === editItem.id);
            // Calcular estado final: si estado base es PEDIDO o CONFIRMADO, concatenar nombre de semana
            let estadoFinal = editItem.estado;
            const semNombre = semanas.find(s => s.id === editItem.semana_id)?.nombre || '';
            if (editItem.estado === 'PEDIDO' && editItem.semana_id && semNombre) estadoFinal = `PEDIDO ${semNombre}`;
            else if (editItem.estado === 'CONFIRMADO' && editItem.semana_id && semNombre) estadoFinal = `CONFIRMADO ${semNombre}`;

            let finalNota = editItem.nota || null;
            if (estadoFinal === 'ENTREGADO' && itOriginal?.vendedor_id !== user?.id) {
                const auditNote = getAuditNote();
                finalNota = finalNota ? `${finalNota} ${auditNote}` : auditNote;
            }

            await supabase.from('cliente_items').update({
                titulo: editItem.titulo,
                precio_venta: Number(editItem.precio_venta) || 0,
                estado: estadoFinal,
                semana_id: editItem.semana_id || null,
                nota: finalNota,
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
        const entries = Object.entries(itemPayAmounts).filter(([, amt]) => Number(amt) > 0);
        if (entries.length === 0) return;
        const clienteId = showPayModal;
        if (!clienteId) return;

        try {
            setLoading(true);
            
            // 1. Obtener los abonos generales actuales del cliente (SOLO RAÍZ, ordenados por fecha)
            const cliPagos = getPagosRaiz(pagos, clienteId)
                .filter(p => Number(p.monto) > 0)
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            for (const [itemId, amt] of entries) {
                const it = items.find(i => i.id === itemId);
                if (!it) continue;
                
                let montoADistribuir = Number(amt);
                const appliedActual = Math.min(Number(it.precio_venta) - Number(it.monto_pagado || 0), montoADistribuir);
                
                if (appliedActual <= 0) continue;

                // 2. Descontar de los registros de pagos (cliente_pagos)
                let restanteXItem = appliedActual;
                for (const p of cliPagos) {
                    if (restanteXItem <= 0) break;
                    const availableInPago = Number(p.monto);
                    if (availableInPago <= 0) continue;

                    const take = Math.min(availableInPago, restanteXItem);

                    // Solo actualizar memoria local (para no sobrepasar el balance en la iteración
                    // de múltiples ítems). El ROOT en DB no se reduce: su monto representa el total
                    // recibido del cliente y la fórmula balance = pagos - allPagadoItems lo maneja.
                    p.monto = availableInPago - take;

                    // Crear el registro de "Dónde se fue el dinero" (Nuevo registro asignado)
                    // referencia = p.id vincula la sub-entrada al ROOT incluso cuando caja_mov_id es null
                    await supabase.from('cliente_pagos').insert([{
                        cliente_id: clienteId,
                        monto: take,
                        concepto: `Asignado a: ${it.titulo}`,
                        vendedor_id: user?.id,
                        metodo_pago: p.metodo_pago,
                        caja_mov_id: p.caja_mov_id, // Mantener vínculo para trazabilidad
                        referencia: p.id             // ← ID del abono raíz (permite link incluso sin caja_mov_id)
                    }]);

                    restanteXItem -= take;
                }

                // 3. Actualizar el ítem
                const nuevoMontoPagado = Number(it.monto_pagado || 0) + appliedActual;
                await supabase.from('cliente_items').update({ monto_pagado: nuevoMontoPagado }).eq('id', itemId);
            }

            setShowPayModal(null);
            setItemPayAmounts({});
            setPayMode('items');
            await fetchData();
            window.dispatchEvent(new CustomEvent('contabilidad:refresh'));
            alert("✓ Balance distribuido correctamente.");
        } catch (e) {
            console.error(e);
            alert('Error al distribuir balance: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleRevertirDistribucion = async (pago) => {
        const prefix = 'Asignado a: ';
        if (!pago.concepto?.startsWith(prefix)) return;
        const titulo = pago.concepto.replace(prefix, '').trim();
        if (!confirm(`¿Quitar asignación de BS ${formatS(pago.monto)} a "${titulo}"?\nEl dinero volverá al saldo disponible del cliente.`)) return;

        const clienteId = pago.cliente_id;

        try {
            setLoading(true);

            // 1. Restar del ítem correspondiente
            const { data: itFresh } = await supabase
                .from('cliente_items')
                .select('id, monto_pagado')
                .eq('cliente_id', clienteId)
                .eq('titulo', titulo)
                .maybeSingle();

            if (itFresh && Number(pago.monto) > 0) {
                const nuevoMonto = Math.max(0, Number(itFresh.monto_pagado || 0) - Number(pago.monto));
                await supabase.from('cliente_items').update({ monto_pagado: nuevoMonto }).eq('id', itFresh.id);
            }

            // 2. Restaurar el saldo en el abono raíz solo si fue reducido (datos viejos)
            // Si ROOT.monto > 0, el saldo ya está correctamente reflejado en getPagosRaiz
            // y el balance se ajusta automáticamente al reducir monto_pagado del ítem.
            // Si ROOT.monto === 0, fue reducido por el distribute viejo → hay que restaurarlo.
            let rootRestaurado = false;

            const tryRestoreRoot = async (rootPago) => {
                if (!rootPago) return false;
                if (Number(rootPago.monto) === 0) {
                    // Datos viejos: ROOT fue reducido a 0 → restaurar con el monto del caja original
                    const { data: cajaMov } = pago.caja_mov_id
                        ? await supabase.from('caja_movimientos').select('monto').eq('id', pago.caja_mov_id).maybeSingle()
                        : { data: null };
                    const montoOriginal = cajaMov ? Number(cajaMov.monto) : Number(pago.monto);
                    const nuevoConcRoot = rootPago.concepto?.replace(' (Totalmente Distribuido)', '') || rootPago.concepto;
                    await supabase.from('cliente_pagos').update({ monto: montoOriginal, concepto: nuevoConcRoot }).eq('id', rootPago.id);
                }
                // Si ROOT.monto > 0: el balance se ajusta solo al reducir el ítem → no tocar ROOT
                return true;
            };

            // Primero intentar por referencia (datos nuevos: sub-entrada tiene referencia = root.id)
            if (pago.referencia) {
                const { data: rootPago } = await supabase
                    .from('cliente_pagos')
                    .select('id, monto, concepto')
                    .eq('id', pago.referencia)
                    .maybeSingle();
                rootRestaurado = await tryRestoreRoot(rootPago);
            }

            // Si no encontró por referencia, intentar por caja_mov_id (datos existentes)
            if (!rootRestaurado && pago.caja_mov_id) {
                const { data: rootPago } = await supabase
                    .from('cliente_pagos')
                    .select('id, monto, concepto')
                    .eq('caja_mov_id', pago.caja_mov_id)
                    .eq('cliente_id', clienteId)
                    .not('concepto', 'ilike', 'Asignado a:%')
                    .maybeSingle();
                rootRestaurado = await tryRestoreRoot(rootPago);
            }

            // 3. Si no se encontró root (raíz eliminada o sin caja_mov_id),
            //    convertir la sub-entrada en un abono general para no perder el saldo
            if (!rootRestaurado) {
                await supabase.from('cliente_pagos').update({
                    concepto: `Saldo recuperado (asignación quitada de: ${titulo})`,
                    caja_mov_id: null
                }).eq('id', pago.id);
                await fetchData();
                alert('✓ Asignación quitada. (El abono raíz no se encontró, el saldo quedó como crédito general.)');
                return;
            }

            // 4. Eliminar la sub-entrada
            await supabase.from('cliente_pagos').delete().eq('id', pago.id);

            await fetchData();
            alert('✓ Asignación eliminada. El dinero volvió al saldo del cliente.');
        } catch (e) {
            console.error(e);
            alert('Error al quitar asignación: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleBulkEstado = async (itemIds, statusParam = null, semanaIdParam = null) => {
        if (!itemIds || itemIds.size === 0) return;
        const baseEstado = statusParam || bulkEstadoTarget;
        const estado = baseEstado === 'CONFIRMADO' ? 'ADJUDICADO' : baseEstado;
        const semanaId = semanaIdParam || bulkSemanaTarget;
        try {
            setLoading(true);
            
            if (estado === 'ENTREGADO') {
                // Si marcamos como entregado, debemos añadir auditoría a los que no son nuestros
                const auditNote = getAuditNote();
                const itemsToUpdate = items.filter(i => itemIds.has(i.id));
                
                for (const it of itemsToUpdate) {
                    let finalNota = it.nota;
                    if (it.vendedor_id !== user?.id) {
                        finalNota = it.nota ? `${it.nota} ${auditNote}` : auditNote;
                    }
                    const updateObj = { estado, nota: finalNota };
                    if (semanaId) updateObj.semana_id = semanaId;
                    await supabase.from('cliente_items').update(updateObj).eq('id', it.id);
                }
            } else if (estado === 'EN TIENDA') {
                const itemsToUpdate = items.filter(i => itemIds.has(i.id));
                for (const it of itemsToUpdate) {
                    const tag = `[ENTIENDA_AT:${new Date().toISOString()}]`;
                    let finalNota = it.nota ? `${it.nota} ${tag}` : tag;
                    const updateObj = { estado, nota: finalNota };
                    if (semanaId) updateObj.semana_id = semanaId;
                    await supabase.from('cliente_items').update(updateObj).eq('id', it.id);
                }
            } else {
                const updateObj = { estado };
                if (semanaId) updateObj.semana_id = semanaId;
                await supabase.from('cliente_items').update(updateObj).in('id', [...itemIds]);
            }
            
            setSelectedItems(new Set());
            await fetchData();
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleEntregarAjeno = async (oit) => {
        const auditNote = getAuditNote();
        
        if (!confirm(`¿Confirmas que estás entregando este pedido de otro socio?\nSe registrará: "${auditNote}"`)) return;

        try {
            setLoading(true);
            const nuevaNota = oit.nota ? `${oit.nota} ${auditNote}` : auditNote;
            const { error } = await supabase.from('cliente_items').update({ 
                estado: 'ENTREGADO',
                nota: nuevaNota
            }).eq('id', oit.id);
            
            if (error) throw error;
            await fetchData();
            alert("✓ Entrega registrada con trazabilidad.");
        } catch (e) {
            console.error(e);
            alert("Error al registrar entrega: " + e.message);
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

            // Filtro por vendedor
            const activeVId = filterVendedor === 'mine' ? user?.id : filterVendedor === 'todos' ? null : filterVendedor;
            if (activeVId && it.vendedor_id !== activeVId) return false;

            return true;
        });
    }, [items, filterEstado, filterSemana, search, isAdmin, user, filterVendedor]);

    const totalPedidos = items.filter(i => {
        const activeVId = filterVendedor === 'mine' ? user?.id : filterVendedor === 'todos' ? null : filterVendedor;
        if (activeVId && i.vendedor_id !== activeVId) return false;
        return i.estado !== 'ENTREGADO';
    }).length;

    const activeKPIVId = filterVendedor === 'mine' ? user?.id : filterVendedor === 'todos' ? null : filterVendedor;

    const ventasTotales = items.filter(i => !activeKPIVId || i.vendedor_id === activeKPIVId)
        .reduce((acc, i) => acc + (Number(i.precio_venta)||0), 0);
    const pagadoItems = items.filter(i => !activeKPIVId || i.vendedor_id === activeKPIVId)
        .reduce((acc, i) => acc + (Number(i.monto_pagado)||0), 0);
    const pagadoGral = pagos.filter(p => !activeKPIVId || p.vendedor_id === activeKPIVId)
        .reduce((acc, p) => acc + (Number(p.monto)||0), 0);
    const totalCobrado = pagadoItems + pagadoGral;
    const saldoPendiente = ventasTotales - totalCobrado;

    const [editingState, setEditingState] = useState(null);

    const groupedData = useMemo(() => {
        const groups = {};
        
        // 1. Determine which clients should be visible
        const searchLower = search ? search.toLowerCase().trim() : '';
        // Resolver qué vendedor_id filtrar
        const activeVendedorId = filterVendedor === 'mine' ? user?.id : filterVendedor === 'todos' ? null : filterVendedor;

        const visibleClients = clientes.filter(c => {
            // Todos los usuarios: solo mostrar clientes con al menos un pedido
            if (!items.some(i => i.cliente_id === c.id)) return false;
            // Filtro por vendedor (aplica a admin y no-admin)
            if (activeVendedorId) {
                if (!items.some(i => i.cliente_id === c.id && i.vendedor_id === activeVendedorId)) return false;
            }

            // Search filter: match client name/celular OR any item title
            if (searchLower) {
                const matchCliente = c.nombre.toLowerCase().includes(searchLower) || c.celular.includes(searchLower);
                const matchTitulo = items.some(i => i.cliente_id === c.id && (i.titulo || '').toLowerCase().includes(searchLower));
                if (!matchCliente && !matchTitulo) return false;
            }

            return true;
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
            const allMyItems = items.filter(i => i.cliente_id === c.id);
            const othersRaw = otherSellersItems.filter(i => i.cliente_id === c.id);

            const clientMatchesSearch = searchLower && (
                c.nombre.toLowerCase().includes(searchLower) || (c.celular || '').includes(searchLower)
            );

            // Filtro dinámico de ítems (Aplica búsqueda por título y estado)
            const filterItemLogic = (i) => {
                // 1. Si hay búsqueda por título, filtrar los que NO coincidan
                if (searchLower && !clientMatchesSearch) {
                    if (!(i.titulo || '').toLowerCase().includes(searchLower)) return false;
                }
                
                // 2. Si el filtro de estado no es 'todos', aplicar filtro de estado
                if (filterEstado !== 'todos') {
                    if (filterEstado === 'PEDIDO') {
                        // Pendientes = CONFIRMADO + PEDIDO + EN TIENDA. Solo ocultar ENTREGADO.
                        if (i.estado === 'ENTREGADO') return false;
                    } else {
                        if (!i.estado.startsWith(filterEstado)) return false;
                    }
                } else if (!showEntregados) {
                    // Si estamos en 'todos' pero el toggle 'Ocultar Entregados' está activo
                    if (i.estado === 'ENTREGADO') return false;
                }
                return true;
            };

            const myItems = allMyItems.filter(filterItemLogic);
            const others = othersRaw.filter(filterItemLogic);

            if (!isAdmin && myItems.length === 0 && !search) return;

            // KPIs solo de ítems no entregados (ENTREGADO se excluye de totales del header)
            const activeForKPI = allMyItems.filter(i => i.estado !== 'ENTREGADO');
            const cVentas = activeForKPI.reduce((s,i)=>s+Number(i.precio_venta||0), 0);
            const cPagItems = activeForKPI.reduce((s,i)=>s+Number(i.monto_pagado||0), 0);
            // Necesario para calcular balanceDisponible correctamente (todo el dinero recibido)
            const allPagItems = allMyItems.reduce((s,i)=>s+Number(i.monto_pagado||0), 0);

            // Ordenar ítems de visualización
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
                fullItems: allMyItems,
                totalVentas: cVentas,
                totalPagadoItems: cPagItems,
                allPagadoItems: allPagItems,
                pagos: getPagosRaiz(pagos, c.id).reduce((s,p) => s + Number(p.monto), 0)
            };
        });

        // Calcular completitud y ordenar grupos
        const groupsArr = Object.values(groups).map(g => {
            const nonDelivered = g.fullItems.filter(i => i.estado !== 'ENTREGADO');
            const inStore = g.fullItems.filter(i => i.estado === 'EN TIENDA');
            const hasRecortado = g.fullItems.some(i => i.estado === 'RECORTADO');
            const allDelivered = g.fullItems.length > 0 && g.fullItems.every(i => i.estado === 'ENTREGADO');
            const allInStore = nonDelivered.length > 0 && inStore.length === nonDelivered.length;
            const completitud = nonDelivered.length > 0 ? inStore.length / nonDelivered.length : (allDelivered ? 1 : 0);
            // readySince: fecha del ítem EN TIENDA más reciente (proxy de cuándo se completó)
            const readySince = allInStore && inStore.length > 0
                ? Math.max(...inStore.map(i => {
                    const match = (i.nota || '').match(/\[ENTIENDA_AT:(.+?)\]/);
                    if (match) return new Date(match[1]).getTime();
                    const weekObj = semanas.find(s => s.id === i.semana_id);
                    if (weekObj && weekObj.nombre.includes('18')) {
                        return Date.now();
                    }
                    return new Date(i.created_at).getTime();
                }))
                : null;
            return { ...g, nonDelivered, inStore, allDelivered, allInStore, completitud, readySince, hasRecortado };
        });

        // Ordenar: hasRecortado primero -> allInStore primero (más reciente completado arriba) → parciales por % desc → 0% → entregados al final
        groupsArr.sort((a, b) => {
            if (a.hasRecortado && !b.hasRecortado) return -1;
            if (!a.hasRecortado && b.hasRecortado) return 1;
            
            if (a.allDelivered && !b.allDelivered) return 1;
            if (!a.allDelivered && b.allDelivered) return -1;
            // Ambos allInStore: más recientemente completado primero (Opción B)
            if (a.allInStore && b.allInStore) {
                return (b.readySince || 0) - (a.readySince || 0);
            }
            if (a.allInStore && !b.allInStore) return -1;
            if (!a.allInStore && b.allInStore) return 1;
            return b.completitud - a.completitud;
        });

        return groupsArr;
    }, [clientes, items, otherSellersItems, pagos, filterEstado, search, isAdmin, user, filterVendedor, filterSemana, showEntregados]);

    const sendWhatsApp = (client, type, manualItems = null) => {
        const cliItems = items.filter(i => i.cliente_id === client.id);
        const cliPagos = getPagosRaiz(pagos, client.id).reduce((s,p) => s + Number(p.monto), 0);

        // Helper de ordenamiento por serie + número de volumen
        const sortByTitle = (arr) => [...arr].sort((a, b) => {
            const extractVol = t => { const m = (t||'').match(/\d+\s*$/); return m ? parseInt(m[0]) : 0; };
            const extractSeries = t => (t||'').replace(/\s*\d+\s*$/, '').trim().toLowerCase();
            const sA = extractSeries(a.titulo), sB = extractSeries(b.titulo);
            if (sA !== sB) return sA.localeCompare(sB, 'es');
            return extractVol(a.titulo) - extractVol(b.titulo);
        });

        const allActive = sortByTitle(cliItems.filter(i => i.estado !== 'ENTREGADO'));
        // Determinar qué ítems mostrar
        let activeItems;
        if (manualItems && (type === 'seleccion' || type === 'manual')) {
            activeItems = sortByTitle(manualItems);
        } else if (type === 'entrega') {
            activeItems = sortByTitle(cliItems.filter(i => i.estado === 'EN TIENDA'));
        } else {
            activeItems = allActive;
        }

        const vTot = activeItems.reduce((s,i) => s + Number(i.precio_venta), 0);
        // pItmActivo es el abono aplicado a los ítems que vamos a mostrar
        const pItmAsignadoSet = activeItems.reduce((s,i) => s + Number(i.monto_pagado), 0);
        
        // El verdadero abono general es lo que se recibió en caja menos lo que ya se asignó a TODOS los ítems
        const pItmTotalGlobal = cliItems.reduce((s,i) => s + Number(i.monto_pagado), 0);
        const saldoGralSinAsignar = Math.max(0, cliPagos - pItmTotalGlobal);

        // Cálculos de deuda según el tipo de mensaje
        let deuda;
        if (type === 'seleccion' || type === 'manual') {
            // En selección manual, mostramos sub-totales de esos ítems (el saldo general se asume 0 por restricción UI)
            deuda = Math.max(0, vTot - pItmAsignadoSet);
        } else {
            // En reportes globales (pago, entrega, estado), calculamos la deuda total real
            const vTotGlobal = allActive.reduce((s,i) => s + Number(i.precio_venta), 0);
            const pItmAsignadoGlobal = allActive.reduce((s,i) => s + Number(i.monto_pagado), 0);
            deuda = Math.max(0, vTotGlobal - (pItmAsignadoGlobal + saldoGralSinAsignar));
        }
        
        // Ayuda visual: cuánto de la deuda de los ítems a mostrar está cubierto por saldo general?
        const sumaSaldosItemsSet = activeItems.reduce((s,i) => s + Math.max(0, Number(i.precio_venta) - Number(i.monto_pagado)), 0);
        const cubiertoPorGral = (type === 'seleccion' || type === 'manual') ? 0 : Math.min(saldoGralSinAsignar, sumaSaldosItemsSet);

        // Saludo inteligente
        const hasRealName = client.nombre && !client.nombre.startsWith('Cliente ');
        const saludo = hasRealName ? `Hola *${client.nombre}*,` : 'Hola,';
        const TIENDA = 'MANGAS COMICS BOLIVIA STORE';
        const SEP = '─────────────────';

        // Fecha estimada de llegada para ítems en tránsito
        const getEstDate = (it) => {
            if (!it.semana_id) return null;
            const week = semanas.find(s => s.id === it.semana_id);
            if (!week) return null;
            const d = week.fecha_estimada_llegada
                ? new Date(week.fecha_estimada_llegada)
                : new Date(new Date(week.created_at).getTime() + 22 * 24 * 60 * 60 * 1000);
            return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });
        };

        const getStatLabel = (it) => {
            const e = it.estado;
            if (e === 'EN TIENDA') return 'LISTO EN TIENDA';
            if (e.startsWith('PEDIDO') || e.startsWith('CONFIRMADO') || e === 'ADJUDICADO') return 'EN CAMINO';
            return e;
        };

        let msg = `${saludo} te escribimos de *${TIENDA}*\n\n`;

        if (type === 'entrega') {
            if (activeItems.length === 0) return alert("No hay ítems 'EN TIENDA' para este cliente.");
            msg += `¡Buenas noticias! 🎉 Los siguientes pedidos ya están listos en tienda:\n\n`;
            activeItems.forEach(i => {
                const saldoItem = Math.max(0, Number(i.precio_venta) - Number(i.monto_pagado));
                msg += `📦 *${i.titulo}*\n`;
                msg += `   Precio: BS ${formatS(i.precio_venta)} | Abonado: BS ${formatS(i.monto_pagado)} | Saldo: BS ${formatS(saldoItem)} ${saldoItem > 0 ? '⚠️' : '✅'}\n\n`;
            });
            msg += SEP + '\n';
            if (saldoGralSinAsignar > 0) msg += `💳 Pagos generales en cuenta: +BS ${formatS(saldoGralSinAsignar)}\n`;
            msg += `*Saldo total pendiente: BS ${formatS(deuda)}*\n`;
            if (deuda <= 0) {
                msg += `*¡Cuenta al día!* ✅${cubiertoPorGral > 0 ? '\n_(Cubierto por tu saldo en cuenta)_' : ''}`;
            }
            msg += `\n\n¡Te esperamos para pasar a recoger o coordinar el envío! 😊`;

        } else if (type === 'pago') {
            msg += `¡Confirmamos el registro de tu pago/abono! 💳\n\n`;
            msg += `📋 *Detalle de tus pedidos:*\n\n`;
            activeItems.forEach(i => {
                const saldoItem = Math.max(0, Number(i.precio_venta) - Number(i.monto_pagado));
                const stat = getStatLabel(i);
                const estDate = i.estado !== 'EN TIENDA' ? getEstDate(i) : null;
                msg += `🔸 *${i.titulo}*\n`;
                msg += `   Estado: ${stat}${estDate ? ` (Est. ~${estDate})` : ''}\n`;
                msg += `   Precio: BS ${formatS(i.precio_venta)} | Abonado: BS ${formatS(i.monto_pagado)} | Saldo: BS ${formatS(saldoItem)}\n\n`;
            });
            msg += SEP + '\n';
            if (saldoGralSinAsignar > 0) msg += `💰 Pagos generales en cuenta: BS ${formatS(saldoGralSinAsignar)}\n`;
            msg += `📊 Total ventas activas: BS ${formatS(vTot)}\n`;
            msg += `*Saldo actual: BS ${formatS(deuda)}*\n`;
            if (deuda <= 0) {
                msg += `*¡Cuenta al día!* ✅${cubiertoPorGral > 0 ? '\n_(Cubierto por tu saldo en cuenta)_' : ''}`;
            }
            msg += `\n\n¡Gracias por tu preferencia! 😊`;

        } else if (type === 'seleccion' || type === 'manual') {
            msg += `Te compartimos el detalle de los pedidos seleccionados: 📑\n\n`;
            activeItems.forEach(i => {
                const saldoItem = Math.max(0, Number(i.precio_venta) - Number(i.monto_pagado));
                const stat = getStatLabel(i);
                const estDate = i.estado !== 'EN TIENDA' ? getEstDate(i) : null;
                msg += `📖 *${i.titulo}*\n`;
                msg += `   ${stat}${estDate ? ` (Est. ~${estDate})` : ''}\n`;
                msg += `   Precio: BS ${formatS(i.precio_venta)} | Abonado: BS ${formatS(i.monto_pagado)} | Saldo: BS ${formatS(saldoItem)}\n\n`;
            });
            msg += SEP + '\n';
            msg += `*Saldo pendiente de estos ítems: BS ${formatS(deuda)}*`;
            msg += `\n\n¡Quedamos atentos a cualquier duda! 😊`;

        } else {
            msg += `📋 Estado general de tus pedidos:\n\n`;
            activeItems.forEach(i => {
                const saldoItem = Math.max(0, Number(i.precio_venta) - Number(i.monto_pagado));
                const stat = getStatLabel(i);
                const estDate = i.estado !== 'EN TIENDA' ? getEstDate(i) : null;
                msg += `[${stat}] *${i.titulo}*${estDate ? ` (Est. ~${estDate})` : ''}\n`;
                msg += `   Precio: BS ${formatS(i.precio_venta)} | Abonado: BS ${formatS(i.monto_pagado)} | Saldo: BS ${formatS(saldoItem)}\n\n`;
            });
            msg += SEP + '\n';
            if (saldoGralSinAsignar > 0) msg += `💰 Pagos generales en cuenta: BS ${formatS(saldoGralSinAsignar)}\n`;
            msg += `*Saldo total adeudado: BS ${formatS(deuda)}*\n`;
            if (deuda <= 0) {
                msg += `*¡Cuenta al día!* ✅${cubiertoPorGral > 0 ? '\n_(Tu saldo en cuenta cubre los ítems pendientes)_' : ''}`;
            }
            msg += `\n\n¡Gracias por tu preferencia! 😊`;
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
                    <button onClick={()=>setView('especiales')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='especiales'?'bg-purple-500/10 text-purple-600 shadow-sm ring-1 ring-purple-500/50':'text-muted hover:text-text'}`}>🇪🇸 España</button>
                    <button onClick={()=>setView('lista')} className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${view==='lista'?'bg-surface text-muted shadow-sm ring-1 ring-border/50':'text-muted hover:text-text'}`}>Lista de Clientes</button>
                </div>
                <div className="text-[10px] font-black text-muted uppercase tracking-widest hidden md:block">Gestión de Cartera de Clientes</div>
            </div>
                
            {/* BARRA DE FILTROS MAESTROS - REDISEÑADA */}
            <div className="bg-surface border border-border p-6 rounded-2xl shadow-sm flex flex-col gap-6">
                {/* NIVEL 1: Búsqueda y Botón de Acción Principal */}
                <div className="flex flex-col md:flex-row gap-4 items-center">
                    <div className="relative flex-1 w-full group">
                        <Search className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${search ? 'text-primary' : 'text-muted/60'}`} size={20} />
                        <input 
                            type="text" 
                            placeholder="Buscar cliente, celular o título del tomo..." 
                            className="w-full bg-background border border-border/60 pl-12 pr-12 py-3.5 rounded-xl text-sm font-medium outline-none focus:border-primary focus:ring-4 focus:ring-primary/5 transition-all shadow-inner placeholder:text-muted/40"
                            value={search} onChange={e=>setSearch(e.target.value)}
                        />
                        {search && (
                            <button 
                                onClick={() => setSearch('')}
                                className="absolute right-4 top-1/2 -translate-y-1/2 p-1.5 hover:bg-muted/10 rounded-full text-muted transition-colors"
                                title="Limpiar búsqueda"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                    
                    <button onClick={() => setShowAddModal(true)} className="w-full md:w-auto bg-primary text-background font-black px-8 py-3.5 rounded-xl text-xs flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-primary/20 uppercase tracking-widest shrink-0">
                        <Plus size={18} /> Nuevo Pedido
                    </button>
                </div>

                {/* NIVEL 2: Filtros de Estado y Selectores */}
                <div className="flex flex-col xl:flex-row justify-between items-center gap-4 pt-4 border-t border-border/40">
                    <div className="flex flex-wrap items-center gap-2 justify-center lg:justify-start">
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

                            const isActive = filterEstado === btn.id;
                            return (
                                <button 
                                    key={btn.id}
                                    onClick={() => setFilterEstado(btn.id)}
                                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all font-black text-[10px] uppercase tracking-wider ${
                                        isActive ? btn.color + ' ring-4 ring-offset-2 ring-primary/5 border-current' : 'bg-transparent border-transparent text-muted hover:bg-muted/10'
                                    }`}
                                >
                                    <btn.icon size={14} />
                                    {btn.label}
                                    <span className={`ml-2 px-2 py-0.5 rounded-full text-[9px] ${isActive ? 'bg-black/10' : 'bg-muted/10'} opacity-70`}>{count}</span>
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-center lg:justify-end">
                         {selectedItems.size > 0 ? (
                            <div className="flex flex-wrap items-center gap-3 bg-primary/10 border border-primary/20 px-4 py-2 rounded-xl animate-in zoom-in-95">
                                <span className="text-[10px] font-black text-primary uppercase whitespace-nowrap">{selectedItems.size} SELECCIONADOS</span>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <select value={bulkEstadoTarget} onChange={e => setBulkEstadoTarget(e.target.value)}
                                        className="bg-background border border-primary/30 px-3 py-1.5 rounded-xl text-xs font-bold text-text outline-none focus:border-primary">
                                        <option value="PEDIDO">PEDIDO</option>
                                        <option value="CONFIRMADO">CONFIRMADO</option>
                                        <option value="EN TIENDA">EN TIENDA</option>
                                        <option value="ENTREGADO">ENTREGADO</option>
                                    </select>
                                    {bulkEstadoTarget === 'CONFIRMADO' && (
                                        <select value={bulkSemanaTarget} onChange={e => setBulkSemanaTarget(e.target.value)}
                                            className="bg-background border border-primary/30 px-3 py-1.5 rounded-xl text-xs font-bold text-text outline-none focus:border-primary">
                                            <option value="">(SIN CAMBIAR SEMANA)</option>
                                            {semanas.map(s => <option key={s.id} value={s.id}>Semana: {s.nombre}</option>)}
                                        </select>
                                    )}
                                    <button 
                                        onClick={() => handleBulkEstado(selectedItems)}
                                        className="bg-primary text-white px-3 py-2 rounded-xl text-xs font-black uppercase hover:bg-primary/80 transition-all flex items-center gap-2"
                                    >
                                        Cambiar Estado
                                    </button>
                                </div>
                                <div className="h-4 w-[1px] bg-border mx-1 hidden sm:block" />
                                <button 
                                    onClick={handleBulkDelete}
                                    className="bg-error text-white px-4 py-2 rounded-xl text-xs font-black uppercase hover:bg-error/80 transition-all flex items-center gap-2"
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
                                <div className="relative group w-full sm:w-48">
                                    <select
                                        value={filterSemana}
                                        onChange={e=>setFilterSemana(e.target.value)}
                                        className="w-full bg-background border border-border/60 pl-4 pr-10 py-2.5 rounded-xl text-xs font-bold uppercase outline-none focus:border-primary transition-all appearance-none cursor-pointer"
                                    >
                                        <option value="todos">📦 TODAS LAS SEMANAS</option>
                                        {semanas.map(s => <option key={s.id} value={s.id}>Semana: {s.nombre}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none group-focus-within:text-primary transition-colors" size={16} />
                                </div>

                                <div className="relative group w-full sm:w-44">
                                    <select
                                        value={filterVendedor}
                                        onChange={e => setFilterVendedor(e.target.value)}
                                        className={`w-full bg-background border pl-4 pr-10 py-2.5 rounded-xl text-xs font-bold uppercase outline-none focus:border-primary transition-all appearance-none cursor-pointer ${filterVendedor === 'mine' ? 'border-border/60 text-muted' : 'border-primary/30 text-primary'}`}
                                    >
                                        <option value="mine">👤 MIS PEDIDOS</option>
                                        <option value="todos">👥 BUSCAR EN TODOS</option>
                                        {isAdmin && vendedores.filter(v => v.id !== user?.id).map(v => (
                                            <option key={v.id} value={v.id}>{v.nombre || v.email}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none ${filterVendedor === 'mine' ? 'text-muted' : 'text-primary'}`} size={16} />
                                </div>

                                {/* Toggle mostrar entregados */}
                                {view === 'clientes' && (() => {
                                    const hiddenCount = groupedData.filter(g => g.allDelivered).length;
                                    return (
                                        <button
                                            onClick={() => setShowEntregados(prev => !prev)}
                                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 transition-all font-black text-[10px] uppercase tracking-wider shrink-0 ${showEntregados ? 'bg-muted/20 border-muted/40 text-muted' : 'bg-transparent border-dashed border-muted/30 text-muted/60 hover:border-muted/50 hover:text-muted'}`}
                                        >
                                            {showEntregados ? '🙈 Ocultar' : '👁 Mostrar'} Entregados
                                            {hiddenCount > 0 && <span className="bg-black/10 px-2 py-0.5 rounded-full text-[9px]">{hiddenCount}</span>}
                                        </button>
                                    );
                                })()}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* main list */}
            {loading ? (
                <div className="py-12 flex justify-center"><div className="animate-spin text-primary w-8 h-8 border-4 border-current border-t-transparent rounded-full" /></div>
            ) : view === 'clientes' ? (
                <div className="flex flex-col gap-4">
                    {groupedData.length === 0 && <div className="text-center py-10 text-muted">No se encontraron clientes o pedidos.</div>}
                    {groupedData
                        .filter(g => showEntregados || !g.allDelivered)
                        .map(group => {
                        const isExp = expandedCliente.has(group.client.id);
                        const isCompact = compactClients.has(group.client.id);
                        const toggleCompact = () => setCompactClients(prev => { const n = new Set(prev); isCompact ? n.delete(group.client.id) : n.add(group.client.id); return n; });
                        const estadoCount = group.fullItems.reduce((acc, it) => {
                            const key = it.estado === 'ADJUDICADO' ? 'CONFIRMADO' : it.estado === 'EN TIENDA' ? 'EN TIENDA' : it.estado === 'ENTREGADO' ? 'ENTREGADO' : 'PEDIDO';
                            acc[key] = (acc[key] || 0) + 1; return acc;
                        }, {});
                        const cVentas = group.totalVentas;
                        const cPagItems = group.totalPagadoItems;
                        // balanceDisponible usa allPagadoItems (todos los ítems) para no inflarse artificialmente
                        const balanceDisponible = Math.max(0, group.pagos - (group.allPagadoItems ?? cPagItems));
                        const totalPagado = cPagItems + balanceDisponible;
                        const cDeuda = Math.max(0, cVentas - totalPagado);

                        return (
                            <div key={group.client.id} className={`bg-surface border rounded-xl shadow-sm overflow-visible relative transition-all ${group.hasRecortado ? 'mt-3' : ''} ${
                                group.hasRecortado ? 'border-red-400 shadow-md shadow-red-500/10' :
                                group.allDelivered ? 'border-border/40 opacity-60' :
                                group.allInStore ? 'border-success/40 shadow-success/10' :
                                group.completitud > 0 ? 'border-primary/20' :
                                'border-border'
                            }`}>
                                {group.hasRecortado && (
                                    <div className="absolute -top-2.5 left-4 bg-red-500 text-white text-[9px] font-black uppercase px-3 py-0.5 rounded-full shadow-sm z-10 flex items-center gap-1 animate-pulse">
                                        <AlertCircle size={10} /> Necesitas acciones inmediatas por favor (Recorte)
                                    </div>
                                )}
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
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="font-bold text-text mb-0.5">{group.client.nombre}</h3>
                                                {/* Badge de completitud del pedido */}
                                                {group.allDelivered ? (
                                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-border/30 border-border text-muted uppercase tracking-wide">✔ Entregado</span>
                                                ) : group.allInStore ? (
                                                    <>
                                                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-success/15 border-success/40 text-success uppercase tracking-wide animate-pulse">✅ Listo p/ entrega</span>
                                                        {/* Badge "listo hace X días" */}
                                                        {group.readySince && (() => {
                                                            const days = Math.floor((Date.now() - group.readySince) / (1000 * 60 * 60 * 24));
                                                            const label = days === 0 ? 'Listo hoy' : days === 1 ? 'Listo hace 1 día' : `Listo hace ${days} días`;
                                                            const cls = days === 0
                                                                ? 'bg-success/10 border-success/20 text-success'
                                                                : days <= 3
                                                                    ? 'bg-orange-400/10 border-orange-400/20 text-orange-400'
                                                                    : 'bg-error/10 border-error/30 text-error animate-pulse';
                                                            return <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border uppercase tracking-wide ${cls}`}>🕐 {label}</span>;
                                                        })()}
                                                    </>
                                                ) : group.completitud > 0 ? (
                                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-yellow-500/10 border-yellow-500/30 text-yellow-500 uppercase tracking-wide">📦 {group.inStore.length}/{group.nonDelivered.length} en tienda</span>
                                                ) : (
                                                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full border bg-muted/10 border-muted/20 text-muted uppercase tracking-wide">⏳ Esperando stock</span>
                                                )}
                                                <button
                                                    onClick={e => { e.stopPropagation(); setEditCliente({ id: group.client.id, nombre: group.client.nombre, celular: group.client.celular || '', ci: group.client.ci || '', ciudad: group.client.ciudad || '', sucursal: group.client.sucursal || '', direccion: group.client.direccion || '', notas_cliente: group.client.notas_cliente || '' }); }}
                                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-semibold"
                                                    title="Editar datos del cliente"
                                                >
                                                    <Edit2 size={11}/> Editar
                                                </button>
                                                <button
                                                    onClick={e => { e.stopPropagation(); setDeleteCliente({ id: group.client.id, nombre: group.client.nombre }); }}
                                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors text-[11px] font-semibold"
                                                    title="Eliminar cliente"
                                                >
                                                    <Trash2 size={11}/> Eliminar
                                                </button>
                                            </div>
                                            {/* Mini barra de progreso */}
                                            {!group.allDelivered && group.items.length > 0 && (
                                                <div className="mt-1 flex items-center gap-2">
                                                    <div className="h-1 w-24 bg-border rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-500 ${
                                                                group.allInStore ? 'bg-success' :
                                                                group.completitud > 0 ? 'bg-yellow-400' :
                                                                'bg-muted/30'
                                                            }`}
                                                            style={{ width: `${Math.round(group.completitud * 100)}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[9px] text-muted font-mono">{Math.round(group.completitud * 100)}%</span>
                                                </div>
                                            )}
                                            <div className="text-xs text-muted font-mono mt-0.5">
                                                {group.client.celular} • {group.fullItems.length} ítems
                                                {group.items.length < group.fullItems.length && (
                                                    <span className="ml-1 text-[10px] text-primary">(Viendo {group.items.length})</span>
                                                )}
                                            </div>
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
                                                    <button onClick={() => setShowWhatsAppMenu(showWhatsAppMenu===group.client.id ? null : group.client.id)} className="bg-[#25D366] text-white px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1 hover:brightness-110 shadow-md">
                                                        <MessageCircle size={14} /> WhatsApp
                                                    </button>
                                                    {showWhatsAppMenu === group.client.id && (
                                                        <div className="absolute top-full right-0 mt-2 w-52 bg-surface border border-border rounded-lg shadow-xl py-1 z-50">
                                                            {/* Aviso de Entrega: solo disponible si TODOS los ítems no-entregados están EN TIENDA */}
                                                            {group.allInStore ? (
                                                                <button onClick={() => sendWhatsApp(group.client, 'entrega')} className="w-full text-left px-3 py-2 text-xs hover:bg-background text-text">📦 Aviso de Entrega</button>
                                                            ) : (
                                                                <div className="px-3 py-2 text-xs text-muted/50 cursor-not-allowed flex items-center gap-1" title={`Faltan ${group.nonDelivered.length - group.inStore.length} ítem(s) por llegar a tienda`}>
                                                                    <span>📦 Aviso de Entrega</span>
                                                                    <span className="text-[9px] bg-muted/10 px-1 rounded ml-auto">{group.inStore.length}/{group.nonDelivered.length} ✓</span>
                                                                </div>
                                                            )}
                                                            <button onClick={() => sendWhatsApp(group.client, 'pago')} className="w-full text-left px-3 py-2 text-xs hover:bg-background text-text">💳 Confirmar Pago</button>
                                                            <button onClick={() => sendWhatsApp(group.client, 'estado')} className="w-full text-left px-3 py-2 text-xs hover:bg-background text-text">📑 Estado General</button>
                                                            {(() => {
                                                                const selectedForThisCli = group.items.filter(it => selectedItems.has(it.id));
                                                                if (selectedForThisCli.length > 0 && balanceDisponible === 0) {
                                                                    return (
                                                                        <button 
                                                                            onClick={() => sendWhatsApp(group.client, 'seleccion', selectedForThisCli)}
                                                                            className="w-full text-left px-3 py-2 text-xs hover:bg-background text-secondary font-black border-t border-border/50 mt-1 pt-1"
                                                                        >
                                                                            📲 Reporte seleccionado ({selectedForThisCli.length})
                                                                        </button>
                                                                    );
                                                                }
                                                                return null;
                                                            })()}
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
                                                                    <div className="flex flex-col">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <Box size={isCompact ? 11 : 13} className="text-primary opacity-40 shrink-0" />
                                                                            <span className={isCompact ? 'text-xs' : ''}>{it.titulo}</span>
                                                                        </div>
                                                                        {it.estado === 'ENTREGADO' && it.nota?.includes('✔ Entregado por') && (
                                                                            <div className="flex flex-wrap items-center gap-1 text-[10px] font-black text-primary bg-primary/5 px-2 py-0.5 rounded-md mt-1 w-fit border border-primary/10">
                                                                                <span>🤝</span> 
                                                                                <span className="uppercase tracking-tighter">{it.nota.split('✔ ')[1]?.split(']')[0]}</span>
                                                                            </div>
                                                                        )}
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
                                                                                    const nextEstado = e.target.value.toUpperCase();
                                                                                    let finalNota = it.nota;
                                                                                    if (nextEstado === 'ENTREGADO' && it.vendedor_id !== user?.id) {
                                                                                        const auditNote = getAuditNote();
                                                                                        finalNota = it.nota ? `${it.nota} ${auditNote}` : auditNote;
                                                                                    }
                                                                                    await supabase.from('cliente_items').update({estado: nextEstado, nota: finalNota}).eq('id', it.id);
                                                                                    setEditingState(null);
                                                                                    fetchData();
                                                                                } else if (e.key === 'Escape') setEditingState(null);
                                                                            }}
                                                                            autoFocus
                                                                            onBlur={()=>setEditingState(null)}
                                                                        />
                                                                    ) : (
                                                                        renderStatus(it, isCompact)
                                                                    )}
                                                                </td>
                                                                {!isCompact && <td className="py-3 px-3 text-[11px] text-muted max-w-[120px] truncate" title={it.nota}>{it.nota || '–'}</td>}
                                                                <td className={`${isCompact ? 'py-1 px-1' : 'py-2 px-2'} text-right`}>
                                                                    <div className="flex items-center justify-end gap-0.5">
                                                                    <button onClick={() => setEditItem({ id: it.id, titulo: it.titulo, precio_venta: it.precio_venta, estado: (it.estado || '').split(' ')[0], semana_id: it.semana_id || '', nota: it.nota || '', vendedor_id: it.vendedor_id })}
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
                                                                                const { data: prod } = await supabase.from('catalogo_productos').select('id, stock_fisico, titulo').eq(lookupCol, lookupVal).maybeSingle();
                                                                                if (prod) {
                                                                                    await supabase.from('catalogo_productos').update({ stock_fisico: (prod.stock_fisico || 0) + 1 }).eq('id', prod.id);
                                                                                    await catalogService.logStockMovement({ productoId: prod.id, titulo: prod.titulo || it.titulo || '', delta: 1, stockDespues: (prod.stock_fisico || 0) + 1, motivo: 'DEVOLUCIÓN', detalle: 'Ítem eliminado del pedido' });
                                                                                    if (typeof catalogService !== 'undefined') catalogService.clearCache();
                                                                                }
                                                                            }
                                                                            // Limpiar sub-entradas "Asignado a:" del ítem eliminado
                                                                            // El saldo vuelve automáticamente al balance disponible
                                                                            // (getPagosRaiz - allPagadoItems sube porque allPaid baja)
                                                                            if (Number(it.monto_pagado || 0) > 0) {
                                                                                const { data: pagosAsignados } = await supabase
                                                                                    .from('cliente_pagos')
                                                                                    .select('id, monto, caja_mov_id')
                                                                                    .eq('cliente_id', it.cliente_id)
                                                                                    .eq('concepto', `Asignado a: ${it.titulo}`);

                                                                                for (const sub of (pagosAsignados || [])) {
                                                                                    // Si el ROOT fue reducido a 0 (datos viejos), restaurarlo
                                                                                    if (sub.caja_mov_id) {
                                                                                        const { data: rootPago } = await supabase
                                                                                            .from('cliente_pagos')
                                                                                            .select('id, monto, concepto')
                                                                                            .eq('caja_mov_id', sub.caja_mov_id)
                                                                                            .eq('cliente_id', it.cliente_id)
                                                                                            .not('concepto', 'ilike', 'Asignado a:%')
                                                                                            .maybeSingle();
                                                                                        if (rootPago && Number(rootPago.monto) === 0) {
                                                                                            const { data: cajaMov } = await supabase.from('caja_movimientos').select('monto').eq('id', sub.caja_mov_id).maybeSingle();
                                                                                            await supabase.from('cliente_pagos').update({
                                                                                                monto: cajaMov ? Number(cajaMov.monto) : Number(sub.monto),
                                                                                                concepto: rootPago.concepto?.replace(' (Totalmente Distribuido)', '') || rootPago.concepto
                                                                                            }).eq('id', rootPago.id);
                                                                                        }
                                                                                    }
                                                                                    await supabase.from('cliente_pagos').delete().eq('id', sub.id);
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
                                                                        <Layers size={12} className="animate-pulse" /> Pedidos de otros socios ({group.others.length})
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                            {group.others.map(oit => {
                                                                const owner = vendedores.find(v => v.id === oit.vendedor_id);
                                                                const ownerName = owner?.nombre || 'Otro Socio';
                                                                return (
                                                                <tr key={oit.id} className="bg-muted/5 border-b border-border/20 align-top hover:bg-primary/5 transition-colors group/others">
                                                                    <td className={`${isCompact ? 'py-1 px-2' : 'py-3 px-3'}`}></td>
                                                                    <td className={`${isCompact ? 'py-1 px-2' : 'py-3 px-3'} text-xs font-medium`}>
                                                                        <div className="flex flex-col">
                                                                            <span>{oit.titulo}</span>
                                                                            <span className="text-[9px] font-black text-primary uppercase mt-0.5">Socio: {ownerName}</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className={`${isCompact ? 'py-1 px-2' : 'py-3 px-3'} text-xs font-mono text-right whitespace-nowrap`}>BS {formatS(oit.precio_venta)}</td>
                                                                    <td className={`${isCompact ? 'py-1 px-2' : 'py-3 px-3'} text-xs font-mono text-right whitespace-nowrap text-success`}>BS {formatS(oit.monto_pagado)}</td>
                                                                    <td className={`${isCompact ? 'py-1 px-2' : 'py-3 px-3'} text-xs font-mono text-right whitespace-nowrap text-error`}>BS {formatS(oit.precio_venta - oit.monto_pagado)}</td>
                                                                    <td className={`${isCompact ? 'py-1 px-2' : 'py-3 px-3'}`}>
                                                                        {renderStatus(oit, isCompact)}
                                                                    </td>
                                                                    <td colSpan={2} className={`${isCompact ? 'py-1 px-2' : 'py-3 px-3'}`}>
                                                                        <div className="flex items-center justify-end">
                                                                            <button 
                                                                                onClick={() => handleEntregarAjeno(oit)}
                                                                                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary text-[10px] font-black uppercase transition-all hover:text-white"
                                                                            >
                                                                                <CheckSquare size={13}/> Entregar
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                                );
                                                            })}
                                                        </>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* HISTORIAL DE PAGOS — raíces con sub-entradas desplegables */}
                                        {(() => {
                                            const todosLosPagos = pagos.filter(p => p.cliente_id === group.client.id).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                                            if (todosLosPagos.length === 0) return null;
                                            const METHOD_ICON = { 'Efectivo': '💵', 'Yasta (QR)': '📲', 'Banco Unión (QR/Transf)': '🏦', 'BNB': '🏛️', 'Otros': '💳' };
                                            const raices = todosLosPagos.filter(p => !p.concepto?.startsWith('Asignado a:'));
                                            const subEntradas = todosLosPagos.filter(p => p.concepto?.startsWith('Asignado a:'));
                                            // Títulos de ítems ENTREGADOS para filtrar pagos históricos
                                            const entregadoConceptos = new Set(
                                                group.fullItems
                                                    .filter(i => i.estado === 'ENTREGADO')
                                                    .map(i => `Asignado a: ${i.titulo}`)
                                            );
                                            const showAll = showAllPagosHistory.has(group.client.id);
                                            const raicesOcultas = raices.filter(p => {
                                                const subs = subEntradas.filter(s => s.referencia === p.id || (s.caja_mov_id && s.caja_mov_id === p.caja_mov_id));
                                                const totalAsignado = subs.reduce((s, sub) => s + Number(sub.monto || 0), 0);
                                                const disp = Math.max(0, Number(p.monto) - totalAsignado);
                                                return disp === 0 && subs.length > 0 && subs.every(s => entregadoConceptos.has(s.concepto));
                                            });
                                            const raicesVisibles = showAll ? raices : raices.filter(p => !raicesOcultas.includes(p));
                                            return (
                                                <div className="mt-3 pt-3 border-t border-border/40">
                                                    <div className="text-[9px] font-black uppercase text-muted tracking-widest mb-2 flex items-center gap-2">
                                                        <span>Historial de Pagos</span>
                                                        <span className="text-primary font-black">({raicesVisibles.length}{raicesOcultas.length > 0 && !showAll ? `+${raicesOcultas.length}` : ''})</span>
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        {raicesVisibles.map(p => {
                                                            const subs = subEntradas.filter(s => s.referencia === p.id || (s.caja_mov_id && s.caja_mov_id === p.caja_mov_id));
                                                            const totalAsignado = subs.reduce((s, sub) => s + Number(sub.monto || 0), 0);
                                                            const disponible = Math.max(0, Number(p.monto) - totalAsignado);
                                                            const isExpanded = expandedRoots.has(p.id);
                                                            return (
                                                                <div key={p.id} className="rounded-xl border border-border/30 overflow-hidden">
                                                                    {/* Raíz */}
                                                                    <div className="flex items-center justify-between bg-background/60 px-3 py-1.5 group hover:border-border/60 transition-colors">
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <span className="text-sm leading-none">{METHOD_ICON[p.metodo_pago] || '💳'}</span>
                                                                            <div className="min-w-0">
                                                                                <div className="text-[10px] font-bold text-text truncate">{p.concepto || 'Abono'}</div>
                                                                                <div className="text-[9px] text-muted flex items-center gap-1">
                                                                                    <span>{p.metodo_pago || 'Efectivo'}</span>
                                                                                    <span>·</span>
                                                                                    <span>{ffecha(p.fecha || p.created_at)}</span>
                                                                                    <span>·</span>
                                                                                    <span className="font-black text-primary uppercase">{vendedores.find(v => v.id === p.vendedor_id)?.nombre?.split(' ')[0] || 'Socio'}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex items-center gap-1 ml-2 shrink-0">
                                                                            <div className="text-right">
                                                                                <div className="text-success font-black text-xs font-mono">+BS {formatS(p.monto)}</div>
                                                                                {disponible > 0 && (subs.length > 0 || balanceDisponible > 0) && (
                                                                                    <div className="text-[8px] font-bold text-orange-500">Disp: BS {formatS(disponible)}</div>
                                                                                )}
                                                                                {disponible > 0 && subs.length === 0 && balanceDisponible === 0 && (
                                                                                    <div className="text-[8px] text-muted">✓ Aplicado</div>
                                                                                )}
                                                                                {disponible === 0 && subs.length > 0 && (
                                                                                    <div className="text-[8px] text-muted">Asignado total</div>
                                                                                )}
                                                                            </div>
                                                                            {subs.length > 0 && (
                                                                                <button onClick={() => setExpandedRoots(prev => { const n = new Set(prev); isExpanded ? n.delete(p.id) : n.add(p.id); return n; })}
                                                                                    className="p-1 rounded hover:bg-primary/10 text-muted hover:text-primary transition-all"
                                                                                    title={isExpanded ? 'Ocultar distribuciones' : `Ver ${subs.length} distribución(es)`}>
                                                                                    {isExpanded ? <ChevronUp size={11}/> : <ChevronDown size={11}/>}
                                                                                </button>
                                                                            )}
                                                                            <button onClick={() => setEditPago({ id: p.id, concepto: p.concepto || '', monto: p.monto, metodo_pago: p.metodo_pago || 'Yasta (QR)', caja_mov_id: p.caja_mov_id })}
                                                                                title="Editar pago"
                                                                                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-primary/10 text-muted hover:text-primary transition-all">
                                                                                <Edit2 size={11} />
                                                                            </button>
                                                                            <button onClick={() => !loading && handleDeletePago(p)} title="Eliminar abono"
                                                                                className={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-error/10 text-muted hover:text-error transition-all ${loading ? 'cursor-not-allowed' : ''}`}>
                                                                                <Trash2 size={11} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    {/* Sub-entradas desplegables */}
                                                                    {isExpanded && subs.length > 0 && (
                                                                        <div className="border-t border-border/20 bg-primary/3 divide-y divide-border/10">
                                                                            {subs.map(s => (
                                                                                <div key={s.id} className="flex items-center justify-between px-3 py-1.5 group/sub hover:bg-primary/5 transition-colors">
                                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                                        <span className="text-muted text-xs pl-2">↳</span>
                                                                                        <div className="min-w-0">
                                                                                            <div className="text-[9px] font-bold text-muted truncate">{s.concepto.replace('Asignado a: ', '')}</div>
                                                                                            <div className="text-[8px] text-muted/70">{ffecha(s.fecha || s.created_at)}</div>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                                                        <span className="text-[9px] font-black font-mono text-muted">BS {formatS(s.monto)}</span>
                                                                                        <button onClick={() => !loading && handleRevertirDistribucion(s)}
                                                                                            title="Quitar asignación (devuelve al saldo)"
                                                                                            className="opacity-0 group-hover/sub:opacity-100 p-1 rounded bg-orange-500/10 text-orange-500 hover:bg-orange-500 hover:text-white transition-all">
                                                                                            <RotateCcw size={9} strokeWidth={3}/>
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                    {/* Toggle para pagos de ítems entregados */}
                                                    {raicesOcultas.length > 0 && (
                                                        <button
                                                            onClick={() => setShowAllPagosHistory(prev => {
                                                                const n = new Set(prev);
                                                                showAll ? n.delete(group.client.id) : n.add(group.client.id);
                                                                return n;
                                                            })}
                                                            className="mt-2 w-full text-center text-[9px] font-bold text-muted hover:text-primary transition-colors py-1 border border-dashed border-border/40 hover:border-primary/30 rounded-lg"
                                                        >
                                                            {showAll
                                                                ? `▲ Ocultar pagos de ítems entregados`
                                                                : `▼ Ver ${raicesOcultas.length} pago${raicesOcultas.length > 1 ? 's' : ''} de ítems entregados`}
                                                        </button>
                                                    )}
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
            ) : view === 'especiales' ? (
                <div className="bg-surface border border-border rounded-2xl overflow-hidden shadow-xl animate-in slide-in-from-bottom-4 duration-500">
                    <div className="p-6 border-b border-border bg-gradient-to-r from-purple-500/5 to-transparent flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div>
                            <h3 className="text-xl font-bold text-text flex items-center gap-2">
                                <ShoppingCart className="text-purple-500" size={24} /> 
                                Gestión de Importaciones (España)
                            </h3>
                            <p className="text-sm text-muted mt-1">Control de pedidos irregulares y pre-ventas directas.</p>
                        </div>
                        {isAdmin && selectedItems.size > 0 && (
                            <div className="flex items-center gap-3 bg-purple-500/10 p-2 rounded-xl border border-purple-500/20">
                                <span className="text-[10px] font-black text-purple-600 uppercase">{selectedItems.size} SELECCIONADOS</span>
                                <div className="flex gap-1">
                                    {['PRE-VENTA ESPAÑA', 'PEDIDO ESPAÑA', 'TRÁNSITO ESPAÑA', 'EN TIENDA'].map(est => (
                                        <button 
                                            key={est}
                                            onClick={() => handleBulkEstado(selectedItems, est)}
                                            className="px-2 py-1 bg-purple-500 text-white text-[9px] font-black rounded uppercase hover:bg-purple-600 transition-all"
                                        >
                                            {est.split(' ')[0]}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-muted/50 text-muted uppercase text-[10px] font-black tracking-widest border-b border-border">
                                    <th className="px-6 py-4 w-10 text-center">
                                        <input type="checkbox" className="w-4 h-4 accent-purple-500" onChange={e => {
                                            const espItems = items.filter(i => i.estado.includes('ESPAÑA') || i.estado.includes('TRÁNSITO') || i.nota?.includes('[ESPAÑA]'));
                                            setSelectedItems(prev => {
                                                const n = new Set(prev);
                                                espItems.forEach(i => e.target.checked ? n.add(i.id) : n.delete(i.id));
                                                return n;
                                            });
                                        }} />
                                    </th>
                                    <th className="px-6 py-4">Ítem / Producto</th>
                                    <th className="px-6 py-4">Cliente</th>
                                    <th className="px-6 py-4 text-center">Estado Actual</th>
                                    <th className="px-6 py-4 text-right">Saldo Pendiente</th>
                                    <th className="px-6 py-4 text-center">Acción</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {(() => {
                                    const espItems = items.filter(i => i.estado.includes('ESPAÑA') || i.estado.includes('TRÁNSITO') || i.nota?.includes('[ESPAÑA]'));
                                    if (espItems.length === 0) {
                                        return <tr><td colSpan="6" className="py-20 text-center text-muted italic">No hay pedidos de España pendientes.</td></tr>;
                                    }
                                    return espItems.map(it => {
                                        const cliente = clientes.find(c => c.id === it.cliente_id);
                                        const saldo = Math.max(0, it.precio_venta - it.monto_pagado);
                                        return (
                                            <tr key={it.id} className={`hover:bg-purple-500/5 transition-colors group ${selectedItems.has(it.id) ? 'bg-purple-500/5' : ''}`}>
                                                <td className="px-6 py-4 text-center">
                                                    <input type="checkbox" className="w-4 h-4 accent-purple-500" checked={selectedItems.has(it.id)} onChange={e => setSelectedItems(prev => { const n = new Set(prev); e.target.checked ? n.add(it.id) : n.delete(it.id); return n; })} />
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="font-bold text-text leading-tight">{it.titulo}</div>
                                                    <div className="text-[10px] text-muted font-mono mt-0.5">{it.product_id || 'ID MANUAL'}</div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="text-sm font-bold text-text">{cliente?.nombre || 'Desconocido'}</div>
                                                    <div className="text-[10px] text-muted font-mono">{cliente?.celular}</div>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    {renderStatus(it, true)}
                                                </td>
                                                <td className="px-6 py-4 text-right font-mono text-[10px]">
                                                    <div className="flex flex-col">
                                                        <span className="text-muted opacity-60">Venta: BS {formatS(it.precio_venta)}</span>
                                                        <span className="font-black text-xs" style={{ color: saldo > 0 ? 'var(--error)' : 'var(--success)' }}>
                                                            Saldo: BS {formatS(saldo)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button 
                                                            onClick={() => setEditItem({ id: it.id, titulo: it.titulo, precio_venta: it.precio_venta, estado: (it.estado || '').split(' ')[0], semana_id: it.semana_id || '', nota: it.nota || '', vendedor_id: it.vendedor_id })}
                                                            className="p-2 bg-primary/10 text-primary rounded-xl hover:bg-primary hover:text-white transition-all shadow-sm border border-primary/20"
                                                            title="Editar ítem"
                                                        >
                                                            <Edit2 size={16} />
                                                        </button>
                                                        <button 
                                                            onClick={() => handleBulkEstado(new Set([it.id]), 'EN TIENDA')}
                                                            className="p-2 bg-success/10 text-success rounded-xl hover:bg-success hover:text-white transition-all shadow-sm border border-success/20"
                                                            title="Marcar como Recibido (En Tienda)"
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    });
                                })()}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : view === 'lista' ? (() => {
                // Filtrar clientes según vendedor activo
                const listaVendedorId = !isAdmin ? user?.id :
                    filterVendedor === 'mine' ? user?.id :
                    filterVendedor === 'todos' ? null : filterVendedor;
                const searchLow = search.toLowerCase().trim();
                const listaClientes = clientes.filter(c => {
                    if (listaVendedorId && !items.some(i => i.cliente_id === c.id && i.vendedor_id === listaVendedorId)) return false;
                    if (searchLow && !c.nombre.toLowerCase().includes(searchLow) && !(c.celular||'').includes(searchLow)) return false;
                    return true;
                });
                return (
                <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-border bg-background flex items-center justify-between">
                        <span className="text-xs font-black uppercase text-muted tracking-widest">
                            {listaVendedorId ? 'Clientes de este vendedor' : 'Todos los clientes registrados'}
                        </span>
                        <span className="text-[10px] font-bold text-muted bg-muted/10 px-3 py-1 rounded-full">{listaClientes.length} clientes</span>
                    </div>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-muted text-[10px] uppercase border-b border-border bg-muted/20 font-black tracking-widest">
                                <th className="px-5 py-3">Nombre</th>
                                <th className="px-5 py-3">Celular</th>
                                <th className="px-5 py-3 text-center">Pedidos</th>
                                <th className="px-5 py-3 text-right">Saldo Deuda</th>
                                <th className="px-5 py-3 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {listaClientes.length === 0 && (
                                <tr><td colSpan={5} className="py-10 text-center text-muted italic">No hay clientes.</td></tr>
                            )}
                            {listaClientes.map(c => {
                                const cItems = items.filter(i => i.cliente_id === c.id);
                                const nPedidos = cItems.length;
                                const cVentas = cItems.reduce((s,i) => s + Number(i.precio_venta||0), 0);
                                const cPagado = cItems.reduce((s,i) => s + Number(i.monto_pagado||0), 0);
                                const deuda = Math.max(0, cVentas - cPagado);
                                
                                // [BLOQUE 9] Cálculo de saldo a favor sin asignar
                                const cPagosTotales = getPagosRaiz(pagos, c.id).reduce((s,p) => s + Number(p.monto||0), 0);
                                const saldoAbonado = Math.max(0, cPagosTotales - cPagado);

                                return (
                                    <tr key={c.id} className="hover:bg-white/5 transition-colors">
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                                                    {(c.nombre || '?')[0].toUpperCase()}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-text">{c.nombre}</span>
                                                    {saldoAbonado > 0 && (
                                                        <div className="mt-0.5 inline-flex items-center gap-1 bg-orange-500/10 text-orange-500 text-[9px] font-black uppercase px-1.5 py-0.5 rounded border border-orange-500/20 w-fit" title="Crédito sin asignar">
                                                            ⚠️ BS {formatS(saldoAbonado)}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-muted font-mono text-xs">{c.celular || '—'}</td>
                                        <td className="px-5 py-3 text-center">
                                            {nPedidos > 0
                                                ? <span className="bg-primary/10 text-primary font-black text-[10px] px-2.5 py-1 rounded-full border border-primary/20">{nPedidos}</span>
                                                : <span className="text-muted/40 text-[10px] font-bold">Sin pedidos</span>
                                            }
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono font-bold">
                                            {deuda > 0
                                                ? <span className="text-error">BS {formatS(deuda)}</span>
                                                : nPedidos > 0
                                                    ? <span className="text-success text-xs">Al día</span>
                                                    : <span className="text-muted/40 text-xs">—</span>
                                            }
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => setEditCliente({ id: c.id, nombre: c.nombre, celular: c.celular || '', ci: c.ci || '', ciudad: c.ciudad || '', sucursal: c.sucursal || '', direccion: c.direccion || '', notas_cliente: c.notas_cliente || '' })}
                                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-semibold"
                                                >
                                                    <Edit2 size={11}/> Editar
                                                </button>
                                                <button
                                                    onClick={() => setDeleteCliente({ id: c.id, nombre: c.nombre })}
                                                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors text-[11px] font-semibold"
                                                >
                                                    <Trash2 size={11}/> Eliminar
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                );
            })() : (
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
                                                    const { data: prod } = await supabase.from('catalogo_productos').select('id, stock_fisico, titulo').eq(lookupCol, lookupVal).maybeSingle();
                                                    if (prod) {
                                                        await supabase.from('catalogo_productos').update({ stock_fisico: (prod.stock_fisico || 0) + 1 }).eq('id', prod.id);
                                                        await catalogService.logStockMovement({ productoId: prod.id, titulo: prod.titulo || it.titulo || '', delta: 1, stockDespues: (prod.stock_fisico || 0) + 1, motivo: 'DEVOLUCIÓN', detalle: 'Ítem eliminado del pedido' });
                                                        if (typeof catalogService !== 'undefined') catalogService.clearCache();
                                                    }
                                                }
                                                // [BLOQUE 1] Rescate de dinero antes de borrar
                                                if (Number(it.monto_pagado || 0) > 0) {
                                                    const { data: pagosAsignados } = await supabase
                                                        .from('cliente_pagos')
                                                        .select('id, monto, caja_mov_id')
                                                        .eq('cliente_id', it.cliente_id)
                                                        .eq('concepto', `Asignado a: ${it.titulo}`);

                                                    for (const p of (pagosAsignados || [])) {
                                                        await supabase.from('cliente_pagos').update({
                                                            concepto: `Crédito recuperado (ítem eliminado: ${it.titulo})`,
                                                            referencia: null
                                                        }).eq('id', p.id);
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


            {/* MODAL: EDITAR CLIENTE */}
            {editCliente && (
                <div className="fixed inset-0 z-[10030] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-text flex items-center gap-2"><Edit2 size={16} className="text-primary"/> Editar Cliente</h3>
                            <button onClick={() => setEditCliente(null)} className="text-muted hover:text-text p-1"><X size={18}/></button>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Nombre *</label>
                                <input value={editCliente.nombre} onChange={e => setEditCliente({...editCliente, nombre: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary" autoFocus/>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Celular</label>
                                <input value={editCliente.celular} onChange={e => setEditCliente({...editCliente, celular: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary font-mono"/>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">CI</label>
                                <input value={editCliente.ci} onChange={e => setEditCliente({...editCliente, ci: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary font-mono"/>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Ciudad</label>
                                <input value={editCliente.ciudad} onChange={e => setEditCliente({...editCliente, ciudad: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary"/>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Sucursal</label>
                                <input value={editCliente.sucursal} onChange={e => setEditCliente({...editCliente, sucursal: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary"/>
                            </div>
                            <div className="col-span-2">
                                <label className="block text-[10px] font-black uppercase text-muted mb-1">Dirección</label>
                                <input value={editCliente.direccion} onChange={e => setEditCliente({...editCliente, direccion: e.target.value})}
                                    className="w-full bg-background border border-border px-3 py-2 rounded-lg text-sm outline-none focus:border-primary"/>
                            </div>
                        </div>
                        <div className="flex justify-end gap-3 pt-1">
                            <button onClick={() => setEditCliente(null)} className="px-4 py-2 text-sm font-bold text-muted hover:text-text">Cancelar</button>
                            <button onClick={handleUpdateCliente} disabled={loading} className="px-5 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:brightness-105 disabled:opacity-50">
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL: ELIMINAR CLIENTE */}
            {deleteCliente && (
                <div className="fixed inset-0 z-[10030] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-sm p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                                <Trash2 size={18} className="text-red-500"/>
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-text">Eliminar Cliente</h3>
                                <p className="text-xs text-muted">Esta acción no se puede deshacer</p>
                            </div>
                        </div>
                        <p className="text-sm text-text">
                            ¿Seguro que deseas eliminar a <span className="font-bold">{deleteCliente.nombre}</span>? Se eliminarán también todos sus pedidos y abonos.
                        </p>
                        <div className="flex justify-end gap-3 pt-1">
                            <button onClick={() => setDeleteCliente(null)} className="px-4 py-2 text-sm font-bold text-muted hover:text-text">Cancelar</button>
                            <button onClick={handleDeleteCliente} disabled={loading} className="px-5 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 disabled:opacity-50">
                                Eliminar
                            </button>
                        </div>
                    </div>
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
                                    <option value="POR CONFIRMAR">POR CONFIRMAR</option>
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
                            <button onClick={handleUpdateItem} disabled={loading} className="flex-1 py-2 rounded-xl text-sm font-black text-white bg-primary hover:brightness-105 shadow disabled:opacity-50">
                                {loading ? "Guardando..." : "Guardar"}
                            </button>
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
                                <div className="relative">
                                    <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest">Celular</label>
                                    <input type="text" value={addForm.celular} onChange={e=>{
                                        const val = e.target.value;
                                        setAddForm({...addForm, celular:val});
                                        if(val.length >= 1) {
                                            const sugg = clientes.filter(c=>(c.celular||'').includes(val)).slice(0,6);
                                            setClienteSugg(sugg); setClienteSuggField('celular');
                                        } else { setClienteSugg([]); }
                                    }} onBlur={()=>setTimeout(()=>setClienteSugg([]),150)}
                                    className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="6XXXXXXX..."/>
                                    {clienteSugg.length > 0 && clienteSuggField==='celular' && (
                                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
                                            {clienteSugg.map(c=>(
                                                <button key={c.id} onMouseDown={()=>{
                                                    setAddForm({...addForm, celular:c.celular, nombre:c.nombre, ci:c.ci||'', ciudad:c.ciudad||'', sucursal:c.sucursal||'', direccion:c.direccion||'', notas_cliente:c.notas||''});
                                                    setClienteSugg([]);
                                                }} className="w-full text-left px-3 py-2 hover:bg-primary/10 flex items-center gap-3 border-b border-border/40 last:border-0 transition-colors">
                                                    <span className="font-mono text-xs font-bold text-primary">{c.celular}</span>
                                                    <span className="text-xs text-text truncate">{c.nombre}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div className="relative">
                                    <label className="block text-[10px] font-black uppercase mb-1.5 text-muted/80 tracking-widest">Nombre Completo</label>
                                    <input type="text" value={addForm.nombre} onChange={e=>{
                                        const val = e.target.value.toUpperCase();
                                        setAddForm({...addForm, nombre:val});
                                        if(val.length >= 2) {
                                            const sugg = clientes.filter(c=>c.nombre.toUpperCase().includes(val)).slice(0,6);
                                            setClienteSugg(sugg); setClienteSuggField('nombre');
                                        } else { setClienteSugg([]); }
                                    }} onBlur={()=>setTimeout(()=>setClienteSugg([]),150)}
                                    className="w-full bg-surface border border-border px-3 py-2.5 rounded-xl text-sm text-text outline-none focus:border-primary shadow-sm" placeholder="Opcional..."/>
                                    {clienteSugg.length > 0 && clienteSuggField==='nombre' && (
                                        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-xl shadow-2xl overflow-hidden">
                                            {clienteSugg.map(c=>(
                                                <button key={c.id} onMouseDown={()=>{
                                                    setAddForm({...addForm, celular:c.celular, nombre:c.nombre, ci:c.ci||'', ciudad:c.ciudad||'', sucursal:c.sucursal||'', direccion:c.direccion||'', notas_cliente:c.notas||''});
                                                    setClienteSugg([]);
                                                }} className="w-full text-left px-3 py-2 hover:bg-primary/10 flex items-center gap-3 border-b border-border/40 last:border-0 transition-colors">
                                                    <span className="text-xs font-bold text-text truncate">{c.nombre}</span>
                                                    <span className="font-mono text-xs text-muted ml-auto">{c.celular}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
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
                                                        <div className="absolute top-full left-0 w-full mt-2 bg-surface border border-border rounded-xl shadow-2xl z-[200] max-h-80 overflow-y-auto p-1 animate-in slide-in-from-top-2">
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
                                                {modoHistorico && (
                                                    <div className="space-y-1">
                                                        <label className="block text-[10px] font-black uppercase text-center text-orange-500">Ya Pagado</label>
                                                        <input type="number" step="0.01" value={addForm.monto_pagado} onChange={e=>setAddForm({...addForm, monto_pagado: e.target.value})} className="w-full bg-orange-500/5 border border-orange-500/20 px-3 py-2.5 rounded-xl text-xs text-orange-600 font-black outline-none focus:border-orange-500 font-mono text-center shadow-inner"/>
                                                    </div>
                                                )}
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
                                                            if (selectedStockSource === 'pedido_ESPANA') return "🇪🇸 ESPAÑA / IMPORTACIÓN";
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
                                                            <div onClick={() => { setSelectedStockSource('pedido_ESPANA'); setDropdownOpen(false); }} className="p-3 rounded-xl bg-purple-500/5 hover:bg-purple-500/10 border border-dashed border-purple-500/20 cursor-pointer text-center">
                                                                <span className="text-purple-500 font-black text-[9px]">🇪🇸 IMPORTACIÓN ESPAÑA (Manual)</span>
                                                            </div>
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
                                                            {orderPayMode === 'items' && !modoHistorico && (
                                                                <th className="px-3 py-3 text-center w-24 bg-success/5 text-success">Pago (BS)</th>
                                                            )}
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

                                                                {orderPayMode === 'items' && !modoHistorico && (
                                                                    <td className="px-2 py-2.5 text-center bg-success/5">
                                                                        <input 
                                                                            type="number" 
                                                                            step="0.01" 
                                                                            value={c.pagoIndividual} 
                                                                            onChange={(e) => updateCartItem(i, 'pagoIndividual', e.target.value)}
                                                                            onFocus={e => e.target.select()}
                                                                            className="w-20 bg-background border border-success/40 rounded px-2 py-1.5 text-center font-mono font-bold text-success outline-none focus:border-success shadow-sm [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                                                            placeholder="0.00"
                                                                        />
                                                                    </td>
                                                                )}

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
                                                                                if (sId !== 'PENDIENTE' && sId !== 'ESPANA') semana_id = sId;
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
                                                                            <option value="pedido_ESPANA">🇪🇸 IMPORTACIÓN ESPAÑA</option>
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

                        <div className="p-5 border-t border-border bg-background rounded-b-2xl shrink-0 space-y-4">
                            {/* Toggle Binario de Pago Inicial */}
                            <div className="flex flex-col gap-4">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase text-muted tracking-widest">Configuración de Pago</span>
                                    <div className="flex bg-muted/20 p-1 rounded-xl border border-border/50">
                                        <button 
                                            type="button"
                                            onClick={() => setOrderPayMode('items')}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${orderPayMode === 'items' ? 'bg-surface text-primary shadow-md border border-primary/20' : 'text-muted-2 hover:text-muted'}`}
                                        >
                                            <ShoppingBag size={14}/> Distribuir en Ítems
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={() => setOrderPayMode('credit')}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${orderPayMode === 'credit' ? 'bg-surface text-secondary shadow-md border border-secondary/20' : 'text-muted-2 hover:text-muted'}`}
                                        >
                                            <Wallet size={14}/> Guardar como Crédito
                                        </button>
                                    </div>
                                </div>

                                <div className="flex items-center gap-4 p-4 bg-background/50 border border-border/40 rounded-2xl shadow-inner">
                                    <div className="flex flex-col gap-1">
                                        <span className="text-[9px] font-black uppercase text-muted tracking-widest">Monto Total a Pagar</span>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-success opacity-60">BS</span>
                                            <input 
                                                type="number" 
                                                step="0.01" 
                                                value={orderPayMode === 'items' ? cart.reduce((s,c)=>s+(Number(c.pagoIndividual)||0),0).toFixed(2) : orderPayAmt} 
                                                onChange={e => orderPayMode === 'credit' && setOrderPayAmt(e.target.value)} 
                                                onFocus={e=>e.target.select()}
                                                disabled={orderPayMode === 'items'}
                                                className={`w-32 bg-surface border ${orderPayMode === 'items' ? 'border-border text-muted cursor-not-allowed' : 'border-success/30 text-success'} pl-8 pr-2 py-2 rounded-xl text-sm font-mono font-black outline-none focus:border-success shadow-sm`}
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex flex-col gap-1 flex-1">
                                        <span className="text-[9px] font-black uppercase text-muted tracking-widest pl-1">Método de Pago</span>
                                        <div className="flex gap-1.5 flex-wrap">
                                            {[{id:'Efectivo',icon:'💵'},{id:'Yasta (QR)',icon:'📲'},{id:'Banco Unión (QR/Transf)',icon:'🏦'},{id:'BNB',icon:'🏛️'},{id:'Otros',icon:'💳'}].map(m => (
                                                <button key={m.id} type="button" onClick={() => setOrderMethod(m.id)}
                                                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-[9px] font-black border transition-all ${orderMethod === m.id ? 'bg-primary border-primary text-white shadow-lg' : 'bg-surface border-border text-muted hover:border-primary/40'}`}>
                                                    <span>{m.icon}</span>
                                                    <span>{m.id === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m.id}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
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
                const pItemsCli = items.filter(i => i.cliente_id === showPayModal);
                const totalDeuda = pItemsCli.reduce((s,i) => s + Number(i.precio_venta), 0);
                const totalPagado = pItemsCli.reduce((s,i) => s + Number(i.monto_pagado||0), 0);
                const totalAbonado = getPagosRaiz(pagos, showPayModal).reduce((s,p) => s + Number(p.monto), 0);
                const saldoDisponible = Math.max(0, totalAbonado - totalPagado);
                const deudaEfectiva = Math.max(0, totalDeuda - totalPagado - saldoDisponible);

                const sortedItems = [...pItemsCli].sort((a, b) => {
                    const getSerie = t => (t || '').replace(/\s\d+\s*$/, '').trim();
                    const getVol = t => { const m = (t || '').match(/\s(\d+)\s*$/); return m ? parseInt(m[1], 10) : null; };
                    const sA = getSerie(a.titulo), sB = getSerie(b.titulo);
                    if (sA !== sB) return sA.localeCompare(sB, 'es');
                    const nA = getVol(a.titulo), nB = getVol(b.titulo);
                    if (nA !== null && nB !== null) return nA - nB;
                    return (a.titulo || '').localeCompare(b.titulo || '', 'es');
                });

                const isDistribuir = payMode === 'distribute';
                const METHOD_ICON = { 'Efectivo': '💵', 'Yasta (QR)': '📲', 'Banco Unión (QR/Transf)': '🏦', 'BNB': '🏛️', 'Otros': '💳' };

                return (
                    <div className="fixed inset-0 bg-black/60 z-[10020] flex items-center justify-center p-4 backdrop-blur-sm">
                        <div className="bg-surface w-full max-w-lg rounded-3xl border border-border shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">

                            {/* Header */}
                            <div className="px-5 pt-4 pb-3 border-b border-border flex items-center justify-between gap-3">
                                <div className="flex items-center gap-3 min-w-0">
                                    <span className="text-xs font-black uppercase text-text truncate">{cli?.nombre}</span>
                                    <span className="text-[9px] text-muted">·</span>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] font-black font-mono text-secondary">↑ {formatS(saldoDisponible)}</span>
                                        <span className="text-[9px] text-muted">·</span>
                                        <span className="text-[10px] font-black font-mono text-error">↓ {formatS(deudaEfectiva)}</span>
                                    </div>
                                </div>
                                <button onClick={()=>{ setShowPayModal(null); setSelectedPayItems([]); setItemPayAmounts({}); setHistorialOpen(false); }} className="p-1.5 hover:bg-muted/20 rounded-lg transition-colors text-muted shrink-0"><X size={16}/></button>
                            </div>

                            <div className="p-4 overflow-y-auto max-h-[60vh] space-y-4 scrollbar-hide">
                                {/* Toggle 3 opciones */}
                                <div className="flex bg-muted/20 p-1 rounded-2xl border border-border gap-1">
                                    <button
                                        onClick={()=>setPayMode('items')}
                                        className={`flex-1 py-2 text-[9px] font-black uppercase rounded-xl transition-all flex items-center justify-center gap-1.5 ${payMode==='items' ? 'bg-surface text-primary shadow border border-primary/10' : 'text-muted hover:text-text'}`}
                                    >
                                        <ShoppingBag size={11}/> Pagar Ítems
                                    </button>
                                    <button
                                        onClick={()=>setPayMode('general')}
                                        className={`flex-1 py-2 text-[9px] font-black uppercase rounded-xl transition-all flex items-center justify-center gap-1.5 ${payMode==='general' ? 'bg-surface text-primary shadow border border-primary/10' : 'text-muted hover:text-text'}`}
                                    >
                                        <Wallet size={11}/> Guardar Crédito
                                    </button>
                                    <button
                                        onClick={()=>setPayMode('distribute')}
                                        disabled={saldoDisponible <= 0}
                                        className={`flex-1 py-2 text-[9px] font-black uppercase rounded-xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${payMode==='distribute' ? 'bg-surface text-secondary shadow border border-secondary/10' : 'text-muted hover:text-text'}`}
                                    >
                                        <Layers size={11}/> Distribuir BS {formatS(saldoDisponible)}
                                    </button>
                                </div>

                                {/* ── MODO DISTRIBUIR: panel con inputs directos y contador ── */}
                                {payMode === 'distribute' && (() => {
                                    const totalAsignadoDist = Object.values(itemPayAmounts).reduce((s,v) => s + Number(v||0), 0);
                                    const restanteDist = Math.max(0, saldoDisponible - totalAsignadoDist);
                                    const pendientesDist = sortedItems.filter(i => Math.max(0, i.precio_venta - i.monto_pagado) > 0);
                                    return (
                                        <div className="space-y-3 animate-in fade-in duration-200">
                                            {/* Contador disponible / asignado / restante */}
                                            <div className="flex items-stretch gap-2 bg-secondary/5 border border-secondary/20 rounded-2xl px-3 py-2.5">
                                                <div className="flex-1 text-center">
                                                    <div className="text-[8px] font-black text-muted uppercase tracking-widest mb-0.5">Disponible</div>
                                                    <div className="text-sm font-black font-mono text-secondary">BS {formatS(saldoDisponible)}</div>
                                                </div>
                                                <div className="w-px bg-border/50"/>
                                                <div className="flex-1 text-center">
                                                    <div className="text-[8px] font-black text-muted uppercase tracking-widest mb-0.5">Asignado</div>
                                                    <div className={`text-sm font-black font-mono ${totalAsignadoDist > 0 ? 'text-primary' : 'text-muted'}`}>BS {formatS(totalAsignadoDist)}</div>
                                                </div>
                                                <div className="w-px bg-border/50"/>
                                                <div className="flex-1 text-center">
                                                    <div className="text-[8px] font-black text-muted uppercase tracking-widest mb-0.5">Restante</div>
                                                    <div className={`text-sm font-black font-mono ${restanteDist > 0 ? 'text-success' : 'text-muted'}`}>BS {formatS(restanteDist)}</div>
                                                </div>
                                            </div>
                                            {/* Lista de ítems con input directo (sin checkbox) */}
                                            <div className="border border-border rounded-2xl bg-background overflow-hidden shadow-inner">
                                                <div className="flex items-center justify-between px-3 py-2 bg-muted/10 border-b border-border/50">
                                                    <span className="text-[9px] text-muted font-black uppercase tracking-widest">Asignar a ítems</span>
                                                    <button onClick={() => {
                                                        const newAmounts = {};
                                                        let restante = saldoDisponible;
                                                        for (const i of pendientesDist) {
                                                            const d = Math.max(0, i.precio_venta - i.monto_pagado);
                                                            const take = Math.min(d, restante);
                                                            if (take > 0) newAmounts[i.id] = take;
                                                            restante -= take;
                                                            if (restante <= 0) break;
                                                        }
                                                        setItemPayAmounts(newAmounts);
                                                    }} className="text-[9px] font-black uppercase text-secondary hover:text-primary transition-colors">
                                                        Auto-distribuir
                                                    </button>
                                                </div>
                                                <div className="max-h-44 overflow-y-auto divide-y divide-border/50">
                                                    {pendientesDist.length === 0 && (
                                                        <div className="py-8 text-center text-xs text-muted italic">No hay deudas pendientes</div>
                                                    )}
                                                    {pendientesDist.map(it => {
                                                        const deuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                                        const asignado = Number(itemPayAmounts[it.id] || 0);
                                                        return (
                                                            <div key={it.id} className={`flex items-center gap-3 px-3 py-2.5 transition-colors ${asignado > 0 ? 'bg-secondary/5' : 'hover:bg-muted/5'}`}>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="text-xs font-bold text-text leading-tight truncate">{it.titulo}</div>
                                                                    <div className="text-[9px] text-muted">Saldo deuda: BS {formatS(deuda)}</div>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                    <input
                                                                        type="number"
                                                                        min="0"
                                                                        max={deuda}
                                                                        step="0.1"
                                                                        placeholder="0"
                                                                        value={itemPayAmounts[it.id] ?? ''}
                                                                        onChange={(e) => {
                                                                            let val = e.target.value === '' ? '' : Number(e.target.value);
                                                                            if (val !== '') {
                                                                                if (val < 0) val = 0;
                                                                                if (val > deuda) val = deuda;
                                                                                // No exceder el saldo disponible total
                                                                                const otrosAsignados = Object.entries(itemPayAmounts)
                                                                                    .filter(([k]) => k !== it.id)
                                                                                    .reduce((s, [, v]) => s + Number(v||0), 0);
                                                                                const maxPara = Math.max(0, saldoDisponible - otrosAsignados);
                                                                                if (val > maxPara) val = maxPara;
                                                                            }
                                                                            setItemPayAmounts(prev => {
                                                                                const updated = { ...prev };
                                                                                if (val === '' || val === 0) delete updated[it.id];
                                                                                else updated[it.id] = val;
                                                                                return updated;
                                                                            });
                                                                        }}
                                                                        className={`w-20 bg-background border rounded-lg px-2 py-1.5 text-right text-xs font-black font-mono outline-none transition-colors ${asignado > 0 ? 'border-secondary text-secondary' : 'border-border text-text focus:border-secondary'}`}
                                                                    />
                                                                    <span className="text-[9px] font-black text-muted">BS</span>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ── MODO PAGAR ÍTEMS: lista con checkboxes ── */}
                                {payMode === 'items' && (
                                    <div className="border border-border rounded-2xl bg-background overflow-hidden shadow-inner animate-in fade-in duration-200">
                                        <div className="flex items-center justify-between px-3 py-2 bg-muted/10 border-b border-border/50">
                                            <span className="text-[9px] text-muted font-black uppercase tracking-widest">Selecciona ítems a pagar</span>
                                            {(() => {
                                                const pendientes = sortedItems.filter(i => (i.precio_venta - i.monto_pagado) > 0);
                                                const todosSel = pendientes.length > 0 && pendientes.every(i => selectedPayItems.includes(i.id));
                                                return (
                                                    <button onClick={() => {
                                                        if (todosSel) { setSelectedPayItems([]); setItemPayAmounts({}); setPayMonto(''); }
                                                        else {
                                                            const ids = pendientes.map(i => i.id);
                                                            setSelectedPayItems(ids);
                                                            const newAmounts = {};
                                                            pendientes.forEach(i => { newAmounts[i.id] = Math.max(0, i.precio_venta - i.monto_pagado); });
                                                            const total = Object.values(newAmounts).reduce((s,v) => s + Number(v||0), 0);
                                                            setPayMonto(total > 0 ? total : '');
                                                            setItemPayAmounts(newAmounts);
                                                        }
                                                    }} className="text-[9px] font-black uppercase text-primary hover:text-secondary transition-colors">
                                                        {todosSel ? 'Desel.' : 'Selec. Todo'}
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                        <div className="max-h-44 overflow-y-auto divide-y divide-border/50">
                                            {sortedItems.map(it => {
                                                const deuda = Math.max(0, it.precio_venta - it.monto_pagado);
                                                if(deuda <= 0) return null;
                                                const checked = selectedPayItems.includes(it.id);
                                                return (
                                                    <label key={it.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${checked ? 'bg-primary/5' : 'hover:bg-muted/5'}`}>
                                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all shrink-0 ${checked ? 'bg-primary border-primary text-white' : 'border-border'}`}>
                                                            {checked && <Check size={10} strokeWidth={4}/>}
                                                            <input type="checkbox" className="hidden" checked={checked} onChange={(e)=>{
                                                                let next = e.target.checked ? [...selectedPayItems, it.id] : selectedPayItems.filter(x=>x!==it.id);
                                                                setSelectedPayItems(next);
                                                                const newAmounts = { ...itemPayAmounts };
                                                                if (e.target.checked) { newAmounts[it.id] = deuda; }
                                                                else { delete newAmounts[it.id]; }
                                                                setItemPayAmounts(newAmounts);
                                                                const total = Object.values(newAmounts).reduce((s, val) => s + Number(val || 0), 0);
                                                                setPayMonto(total > 0 ? total : '');
                                                            }}/>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-xs font-bold text-text leading-tight truncate">{it.titulo}</div>
                                                            <div className="text-[9px] text-muted">BS {formatS(deuda)}</div>
                                                        </div>
                                                        {checked ? (
                                                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    max={deuda}
                                                                    step="0.1"
                                                                    value={itemPayAmounts[it.id] || ''}
                                                                    onChange={(e) => {
                                                                        let val = Number(e.target.value);
                                                                        if (val > deuda) val = deuda;
                                                                        if (val < 0) val = 0;
                                                                        const updated = { ...itemPayAmounts, [it.id]: e.target.value === '' ? '' : val };
                                                                        setItemPayAmounts(updated);
                                                                        const newTotal = Object.values(updated).reduce((s, v) => s + Number(v || 0), 0);
                                                                        setPayMonto(newTotal > 0 ? newTotal : '');
                                                                    }}
                                                                    className="w-16 bg-background border border-border focus:border-primary rounded-lg px-2 py-1 text-right text-xs font-black font-mono text-primary outline-none transition-colors"
                                                                />
                                                                <span className="text-[9px] font-black text-muted">BS</span>
                                                            </div>
                                                        ) : (
                                                            <div className="text-xs font-black font-mono text-error/60 shrink-0">BS {formatS(deuda)}</div>
                                                        )}
                                                    </label>
                                                );
                                            })}
                                            {sortedItems.filter(i => (i.precio_venta - i.monto_pagado) > 0).length === 0 && (
                                                <div className="py-8 text-center text-xs text-muted italic">No hay deudas pendientes</div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Concepto (solo mode general) */}
                                {payMode === 'general' && (
                                    <div className="space-y-1 animate-in fade-in duration-200">
                                        <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Concepto del Abono</label>
                                        <input
                                            type="text"
                                            value={pagoConcepto}
                                            onChange={e=>setPagoConcepto(e.target.value)}
                                            className="w-full bg-background border border-border px-3 py-2.5 rounded-xl text-sm outline-none focus:border-primary shadow-sm"
                                            placeholder="Ej: Pago adelantado, Reserva..."
                                        />
                                    </div>
                                )}

                                {/* Método de pago + monto (solo modes items y general) */}
                                {!isDistribuir && (
                                    <div className="space-y-3">
                                        <div className="space-y-1.5">
                                            <label className="text-[9px] font-black text-muted uppercase tracking-widest ml-1">Método de Pago</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {[
                                                    { id: 'Efectivo', icon: '💵', label: 'Efectivo' },
                                                    { id: 'Yasta (QR)', icon: '📲', label: 'Yasta' },
                                                    { id: 'Banco Unión (QR/Transf)', icon: '🏦', label: 'B. Unión' },
                                                    { id: 'BNB', icon: '🏛️', label: 'BNB' },
                                                    { id: 'Otros', icon: '💳', label: 'Otros' },
                                                ].map(m => (
                                                    <button
                                                        key={m.id}
                                                        onClick={() => setPayMethod(m.id)}
                                                        className={`px-2.5 py-1.5 flex items-center gap-1.5 text-[9px] font-black uppercase rounded-xl border transition-all ${payMethod === m.id ? 'bg-primary border-primary text-white shadow' : 'bg-surface border-border text-muted hover:border-primary/40'}`}
                                                    >
                                                        <span>{m.icon}</span><span>{m.label}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {payMethod !== 'Efectivo' && (
                                            <input
                                                type="text"
                                                value={payReference}
                                                onChange={e => setPayReference(e.target.value)}
                                                placeholder="Ref / No. Operación"
                                                className="w-full bg-background border border-border px-3 py-2 rounded-xl text-sm outline-none focus:border-primary font-mono shadow-sm"
                                            />
                                        )}

                                        <div className="bg-primary/5 border border-primary/20 px-4 py-3 rounded-2xl flex items-center gap-3">
                                            <label className="text-[9px] font-black text-primary uppercase tracking-widest shrink-0">Monto BS</label>
                                            <input
                                                type="number"
                                                value={payMonto}
                                                onChange={e=>setPayMonto(e.target.value)}
                                                className="flex-1 bg-transparent text-2xl text-right font-black font-mono text-primary outline-none placeholder:text-primary/20"
                                                placeholder="0.00"
                                                autoFocus
                                            />
                                        </div>
                                        {payMode === 'items' && selectedPayItems.length > 0 && payMonto > 0 && (
                                            <div className="text-[9px] font-bold text-muted uppercase tracking-widest text-right">
                                                {(() => {
                                                    const totalD = sortedItems.filter(i => selectedPayItems.includes(i.id)).reduce((s,i) => s + Math.max(0, i.precio_venta - i.monto_pagado), 0);
                                                    if (Number(payMonto) === totalD) return "Pago exacto";
                                                    if (Number(payMonto) < totalD) return `Parcial BS ${formatS(payMonto)}`;
                                                    return `Sobran BS ${formatS(Number(payMonto) - totalD)} → crédito`;
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Historial colapsado por defecto */}
                                {(() => {
                                    const historialFiltrado = pagos.filter(p => p.cliente_id === showPayModal && Number(p.monto) > 0).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
                                    if (historialFiltrado.length === 0) return null;
                                    const pagosRaiz = historialFiltrado.filter(p => !p.concepto?.startsWith('Asignado a:'));
                                    const pagosAsignados = historialFiltrado.filter(p => p.concepto?.startsWith('Asignado a:'));
                                    return (
                                        <div className="border-t border-border pt-3 space-y-2">
                                            <button onClick={() => setHistorialOpen(v => !v)} className="flex items-center gap-2 w-full text-left">
                                                <span className="text-[9px] font-black text-muted uppercase tracking-widest flex-1">Historial de Abonos ({pagosRaiz.length})</span>
                                                {historialOpen ? <ChevronUp size={12} className="text-muted"/> : <ChevronDown size={12} className="text-muted"/>}
                                            </button>
                                            {historialOpen && (
                                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1 scrollbar-hide animate-in fade-in duration-200">
                                                    {pagosRaiz.map(p => (
                                                        <div key={p.id} className="space-y-1">
                                                            <div className="flex items-center justify-between px-3 py-2 rounded-xl border bg-surface border-border/50 group hover:border-primary/30 transition-all">
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span className="text-base">{METHOD_ICON[p.metodo_pago] || '💳'}</span>
                                                                    <div className="min-w-0">
                                                                        <div className="text-[10px] font-bold truncate text-text">{p.concepto || 'Abono'}</div>
                                                                        <div className="text-[9px] text-muted">{p.metodo_pago} · {ffecha(p.created_at)}</div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-2 ml-3 shrink-0">
                                                                    <div className="text-xs font-black font-mono text-success">+ {formatS(p.monto)}</div>
                                                                    {isAdmin && (
                                                                        <button onClick={() => !loading && handleDeletePago(p)} className="opacity-0 group-hover:opacity-100 p-1.5 bg-error/10 text-error rounded-lg hover:bg-error hover:text-white transition-all">
                                                                            <Trash2 size={11} strokeWidth={3}/>
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {pagosAsignados
                                                                .filter(pa => pa.referencia === p.id || (pa.caja_mov_id && pa.caja_mov_id === p.caja_mov_id))
                                                                .map(pa => (
                                                                    <div key={pa.id} className="flex items-center justify-between py-1.5 pr-3 pl-10 bg-primary/5 rounded-lg border border-primary/5 group/sub">
                                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                                            <span className="text-muted text-xs">↳</span>
                                                                            <div className="text-[9px] font-bold text-muted truncate">{pa.concepto.replace('Asignado a: ', '')}</div>
                                                                        </div>
                                                                        <div className="flex items-center gap-2 shrink-0">
                                                                            <div className="text-[9px] font-black font-mono text-muted">BS {formatS(pa.monto)}</div>
                                                                            <button onClick={() => handleRevertirDistribucion(pa)} className="opacity-0 group-hover/sub:opacity-100 p-1 bg-orange-500/10 text-orange-500 rounded-lg hover:bg-orange-500 hover:text-white transition-all" title="Quitar Distribución">
                                                                                <RotateCcw size={9} strokeWidth={3}/>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            }
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Footer */}
                            <div className="px-4 py-3 bg-background border-t border-border flex items-center justify-between gap-3">
                                <div>
                                    {isAdmin && (
                                        <label className="flex items-center gap-2 cursor-pointer group select-none">
                                            <div className={`w-4 h-4 rounded border-2 transition-all flex items-center justify-center ${sinContabilidad ? 'bg-orange-500 border-orange-500' : 'border-muted group-hover:border-orange-500/50'}`}>
                                                {sinContabilidad && <Check size={10} strokeWidth={4} className="text-white"/>}
                                                <input type="checkbox" className="hidden" checked={sinContabilidad} onChange={e => setSinContabilidad(e.target.checked)}/>
                                            </div>
                                            <span className={`text-[9px] font-black uppercase tracking-widest ${sinContabilidad ? 'text-orange-500' : 'text-muted group-hover:text-text'}`}>Sin Contab.</span>
                                        </label>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={()=>{ setShowPayModal(null); setSinContabilidad(false); setSelectedPayItems([]); setItemPayAmounts({}); setHistorialOpen(false); }} className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted hover:text-text transition-colors">Cancelar</button>
                                    {isDistribuir ? (
                                        <button
                                            onClick={handleDistribuirBalance}
                                            disabled={loading || Object.values(itemPayAmounts).reduce((s,v)=>s+Number(v||0),0) <= 0}
                                            className="bg-secondary text-background px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 hover:shadow-lg hover:shadow-secondary/20 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {loading ? <div className="animate-spin w-3 h-3 border-2 border-background border-t-transparent rounded-full" /> : <Layers size={14} strokeWidth={3}/>}
                                            Distribuir
                                        </button>
                                    ) : (
                                        <button
                                            onClick={()=>handleSavePayment(cli.id)}
                                            disabled={loading || !payMonto || payMonto <= 0}
                                            className="bg-primary text-background px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:scale-105 hover:shadow-lg hover:shadow-primary/20 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {loading ? <div className="animate-spin w-3 h-3 border-2 border-background border-t-transparent rounded-full" /> : <Check size={14} strokeWidth={3}/>}
                                            Confirmar
                                        </button>
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
                            <button onClick={handleUpdatePago} disabled={loading} className="flex-1 py-2 rounded-xl text-sm font-black text-white bg-[var(--primary)] hover:brightness-105 shadow disabled:opacity-50">
                                {loading ? "Guardando..." : "Guardar"}
                            </button>
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
            {showDamageModal && damageTarget && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-navy/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="p-8 text-center">
                            <div className="w-16 h-16 bg-orange-100 text-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
                                <AlertCircle size={32} />
                            </div>
                            <h3 className="text-xl font-black text-navy mb-2 uppercase italic">Reportar Daño / Cambio</h3>
                            <p className="text-sm text-muted mb-6">
                                Estás reportando un problema con <strong>{damageTarget.item.titulo}</strong> para el cliente <strong>{damageTarget.client?.nombre}</strong>.
                                <br/><br/>
                                <span className="text-xs italic text-muted/60">El ítem actual se marcará como 'DAÑADO' y se creará una reposición.</span>
                            </p>

                            <div className="bg-background/50 p-4 rounded-2xl mb-6 text-left border border-border">
                                <h4 className="text-[10px] font-black uppercase text-muted mb-2 tracking-widest">Disponibilidad de Stock</h4>
                                {damageStockAnalysis ? (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-muted uppercase">Físico</span>
                                            <span className={`text-sm font-black ${damageStockAnalysis.fisico > 0 ? 'text-success' : 'text-error'}`}>
                                                {damageStockAnalysis.fisico} unidades
                                            </span>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] text-muted uppercase">Flotante Total</span>
                                            <span className="text-sm font-black text-navy">
                                                {damageStockAnalysis.flotantes.reduce((acc, f) => acc + f.qty, 0)} unidades
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 animate-pulse">
                                        <div className="w-2 h-2 bg-muted/20 rounded-full animate-bounce"></div>
                                        <span className="text-[10px] font-bold text-muted/40 uppercase">Consultando inventario...</span>
                                    </div>
                                )}

                                {damageStockAnalysis?.flotantes.length > 0 && (
                                    <div className="mt-4 pt-4 border-t border-border space-y-2">
                                        <span className="text-[9px] font-bold text-muted uppercase tracking-tighter block mb-1">Próximos Arribos:</span>
                                        <div className="grid grid-cols-1 gap-2">
                                            {damageStockAnalysis.flotantes.map((f, i) => (
                                                <div key={i} className="bg-white border border-border p-3 rounded-2xl flex items-center gap-4 shadow-sm hover:border-navy/20 transition-colors">
                                                    <div className="text-center shrink-0">
                                                        <div className={`text-xs font-black px-2 py-1 rounded-lg ${f.isConfirmed ? 'bg-orange-500 text-white shadow-sm shadow-orange-200' : 'bg-muted/20 text-muted'}`}>
                                                            +{f.qty}
                                                        </div>
                                                        <div className="text-[7px] font-black mt-1 uppercase tracking-tighter">{f.isConfirmed ? 'CONFIRMADO' : 'PENDIENTE'}</div>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-[10px] font-black uppercase text-navy leading-none mb-1">{f.nombre}</div>
                                                        <div className="text-[9px] text-muted font-bold italic">Arribo estimado: {f.fechaArribo.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' })}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => handleResolveDamage('STOCK')}
                                    disabled={resolvingDamage}
                                    className="w-full bg-navy text-white font-black py-4 rounded-2xl hover:bg-navy/90 transition-all flex items-center justify-center gap-3 group"
                                >
                                    <Box size={20} className="group-hover:scale-110 transition-transform" />
                                    REPONER DESDE STOCK FÍSICO
                                </button>
                                <button
                                    onClick={() => handleResolveDamage('PEDIDO')}
                                    disabled={resolvingDamage}
                                    className="w-full bg-surface border-2 border-navy text-navy font-black py-4 rounded-2xl hover:bg-navy/5 transition-all flex items-center justify-center gap-3 group"
                                >
                                    <RefreshCw size={20} className="group-hover:rotate-180 transition-transform duration-500" />
                                    PEDIR AL DISTRIBUIDOR
                                </button>
                            </div>
                        </div>
                        <div className="bg-background p-4 flex justify-center">
                            <button 
                                onClick={() => setShowDamageModal(false)}
                                className="text-muted hover:text-navy text-xs font-black uppercase tracking-widest"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
