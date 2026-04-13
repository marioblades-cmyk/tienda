import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Database, Search, Filter, RefreshCw, CheckCircle2, AlertCircle, Info, RotateCcw, ShoppingCart, Image as ImageIcon, X, Truck, Clock, Trash2, Zap } from 'lucide-react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { useAuth } from '../hooks/useAuth';

const CatalogUpdatedView = () => {
    const { isAdmin } = useAuth();
    // ESTADOS
    const [catalogData, setCatalogData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedSyncEditorial, setSelectedSyncEditorial] = useState('TODOS');
    const [searchQuery, setSearchQuery] = useState('');
    const [editorialFilter, setEditorialFilter] = useState('TODOS');
    const [categoryFilter, setCategoryFilter] = useState('TODOS');
    const [reprintsOnlyFilter, setReprintsOnlyFilter] = useState(false);
    const [editorialesList, setEditorialesList] = useState([]);
    const [itemsToShow, setItemsToShow] = useState(50);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedForQuote, setSelectedForQuote] = useState(new Set());
    const [previewItem, setPreviewItem] = useState(null);
    const [editingImageItem, setEditingImageItem] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isBulkEditing, setIsBulkEditing] = useState(false);
    const [bulkItems, setBulkItems] = useState([]);
    const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, active: false, stop: false });
    
    // Estados para el Detector y Sincronización Inteligente
    const [foundImages, setFoundImages] = useState([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanningForItem, setScanningForItem] = useState(null);
    const [isSmartSyncOpen, setIsSmartSyncOpen] = useState(false);
    const [smartMatches, setSmartMatches] = useState([]);
    const [isSmartProcessing, setIsSmartProcessing] = useState(false);
    const [rawHtmlInput, setRawHtmlInput] = useState('');
    const [showExpertMode, setShowExpertMode] = useState(false);
    const [manualSearchIdx, setManualSearchIdx] = useState(null);
    const [manualSearchQuery, setManualSearchQuery] = useState('');
    const [editingStock, setEditingStock] = useState(null); // {productId, value}
    const [editingMinStock, setEditingMinStock] = useState(null); // {productId, value}
    const [isUpdatingStock, setIsUpdatingStock] = useState(false);
    const [bulkStockValue, setBulkStockValue] = useState('');
    const [bulkMinValue, setBulkMinValue] = useState('');
    const [bulkStockSaving, setBulkStockSaving] = useState(false);
    const [activeWeeks, setActiveWeeks] = useState([]);
    const [showOnlyWithStock, setShowOnlyWithStock] = useState(false);
    const [weekFilter, setWeekFilter] = useState('TODAS');
    const [isResetting, setIsResetting] = useState(false);

    // RESET GLOBAL DE STOCK (Admin Only)
    const handleGlobalStockReset = async () => {
        if (!isAdmin) return;
        
        const firstConfirm = window.confirm('⚠️ ¿ESTÁS SEGURO? Esta acción pondrá el STOCK FÍSICO de TODOS los productos en 0.');
        if (!firstConfirm) return;
        
        const secondConfirm = window.confirm('❗ ÚLTIMA ADVERTENCIA: Esta acción no se puede deshacer. ¿Realmente quieres vaciar todo el inventario físico?');
        if (!secondConfirm) return;

        setIsResetting(true);
        try {
            const { error } = await supabase
                .from('catalogo_productos')
                .update({ stock_fisico: 0 })
                .neq('id', '00000000-0000-0000-0000-000000000000'); // Dummy filter for matching all

            if (error) throw error;

            console.log('🧹 Limpiando caché tras reset global...');
            localStorage.removeItem('mcb_catalog_full_cache');
            localStorage.removeItem('mcb_catalog_cache_time');
            
            alert('✅ ÉXITO: Todo el stock físico ha sido reseteado a 0.');
            loadCatalog(true);
        } catch (err) {
            console.error('Error en reset global:', err);
            alert('❌ ERROR: No se pudo resetear el stock: ' + err.message);
        } finally {
            setIsResetting(false);
        }
    };


    // CARGA DE DATOS
    useEffect(() => {
        loadCatalog();
    }, []);

    // Escuchar eventos de actualización de precios para auto-refrescar
    useEffect(() => {
        const handler = () => loadCatalog(true);
        window.addEventListener('catalog-prices-updated', handler);
        window.addEventListener('catalog-status-changed', handler);
        return () => {
            window.removeEventListener('catalog-prices-updated', handler);
            window.removeEventListener('catalog-status-changed', handler);
        };
    }, []);

    const loadCatalog = async (force = false) => {
        setIsLoading(true);
        if (force) {
            console.log('🧹 Limpiando caché local por solicitud forzosa...');
            localStorage.removeItem('mcb_catalog_full_cache');
            localStorage.removeItem('mcb_catalog_cache_time');
        }
        try {
            const results = await catalogService.fetchFullCatalog(force);
            
            // --- NEW: Load Integrated Stock Data ---
            const { data: weeks } = await supabase.from('semanas').select('*').order('created_at', { ascending: false });
            const [masters, receptions, allOrders, { data: floatingSummary }] = await Promise.all([
                supabase.from('master_confirmaciones').select('semana_id, datos_json'),
                supabase.from('pedido_items_recepcion').select('semana_id, titulo, cantidad_recibida'),
                supabase.from('pedido_items').select('cantidad, titulo, pedido:pedidos!inner(semana_id, tipo)'),
                supabase.rpc('get_floating_stock_summary')
            ]);

            const weekStats = (weeks || []).map(w => {
                const master = masters.data?.find(m => m.semana_id === w.id);
                const weekReceptions = (receptions.data || []).filter(r => r.semana_id === w.id);
                const weekAllOrders = (allOrders.data || []).filter(o => o.pedido.semana_id === w.id);
                const weekFloatingSummary = (floatingSummary || []).filter(c => c.semana_id === w.id);
                
                const totalConfirmed = (master?.datos_json || []).reduce((sum, it) => sum + (it.cantidad || 0), 0);
                const totalReceived = weekReceptions.reduce((sum, r) => sum + (r.cantidad_recibida || 0), 0);
                const totalRequestedStore = weekAllOrders.filter(o => o.pedido.tipo === 'tienda').reduce((sum, o) => sum + (o.cantidad || 0), 0);

                const fechaArribo = w.fecha_estimada_llegada 
                    ? new Date(w.fecha_estimada_llegada)
                    : new Date(new Date(w.created_at).getTime() + (22 * 24 * 60 * 60 * 1000));

                return {
                    ...w,
                    masterData: master?.datos_json || [],
                    receptionData: weekReceptions,
                    allOrdersData: weekAllOrders,
                    floatingSummary: weekFloatingSummary,
                    isConfirmed: !!master,
                    floatingCount: master ? Math.max(0, totalConfirmed - totalReceived) : totalRequestedStore,
                    fechaArribo
                };
            }).filter(w => w.floatingCount > 0);

            setActiveWeeks(weekStats);

            // Enrich catalog items with floating data
            const enrichedResults = results.map(prod => {
                const prodTitle = (prod.titulo || '').toLowerCase().trim();
                const floatingByWeek = {};
                
                weekStats.forEach(week => {
                    let qty = 0;
                    
                    if (week.isConfirmed) {
                        // 1. Total confirmed by distributor (Total)
                        const totalConfirmedForTitle = week.masterData
                            .filter(it => (it.titulo || '').toLowerCase().trim() === prodTitle)
                            .reduce((s, i) => s + (i.cantidad || 0), 0);
                        
                        // 2. Units requested by Sellers (Personal) - These are NOT store stock
                        const sellerRequestedQty = week.allOrdersData
                            .filter(p => (p.titulo || '').toLowerCase().trim() === prodTitle && p.pedido.tipo === 'personal')
                            .reduce((s, p) => s + (p.cantidad || 0), 0);
                        
                        // 3. What we already received specifically for this week
                        const received = week.receptionData
                            .filter(r => (r.titulo || '').toLowerCase().trim() === prodTitle)
                            .reduce((s, r) => s + (r.cantidad_recibida || 0), 0);
                        
                        // 4. Client Reservations (Floating confirmed/allocated bounds) - From Anonymous RPC
                        const clientReserved = week.floatingSummary
                            .filter(c => (c.titulo || '').toLowerCase().trim() === prodTitle)
                            .reduce((s, c) => s + (c.reservado || 0), 0);
                        
                        // Store stock is ALL confirmed units MINUS what was for sellers, MINUS what arrived, MINUS CLIENT ASSIGNED.
                        // This naturally handles "Extras" (unrequested items in Master) flowing to Store.
                        qty = Math.max(0, (totalConfirmedForTitle - sellerRequestedQty) - received - clientReserved);
                    } else {
                        // Not confirmed yet: Show full TIENDA request Baseline
                        const storeTotal = week.allOrdersData
                            .filter(p => (p.titulo || '').toLowerCase().trim() === prodTitle && p.pedido.tipo === 'tienda')
                            .reduce((s, p) => s + (p.cantidad || 0), 0);

                        // Pending Client Waitlist for this unconfirmed week - From Anonymous RPC
                        const clientWaitlist = week.floatingSummary
                            .filter(c => (c.titulo || '').toLowerCase().trim() === prodTitle)
                            .reduce((s, c) => s + (c.reservado || 0), 0);
                        
                        qty = Math.max(0, storeTotal - clientWaitlist);
                    }
                    if (qty > 0) floatingByWeek[week.id] = { qty, isConfirmed: week.isConfirmed };
                });

                // Calculate TOTAL STOCK (Physical + All Floating)
                const totalFloating = Object.values(floatingByWeek).reduce((sum, d) => sum + d.qty, 0);
                const stockTotal = (prod.stock_fisico || 0) + totalFloating;

                return { ...prod, floatingByWeek, stock_total: stockTotal };
            });

            setCatalogData(enrichedResults);
            // --- END NEW ---

            const eds = [...new Set(results.map(i => i.editorial))].filter(Boolean).sort();
            setEditorialesList(eds);
        } catch (err) {
            console.error('Error cargando catálogo:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClearReprints = async () => {
        if (!window.confirm('¿Estás seguro de que deseas limpiar TODAS las etiquetas de reimpresión del catálogo maestro? Esta acción no se puede deshacer.')) return;
        
        setIsLoading(true);
        try {
            await catalogService.clearAllReprintLabels();
            alert('✅ Etiquetas de reimpresión limpiadas correctamente.');
            await loadCatalog(true); // Forzar recarga tras limpiar
        } catch (err) {
            console.error('Error al limpiar etiquetas:', err);
            alert('❌ No se pudieron limpiar las etiquetas. Verifica tu conexión o permisos.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAddToQuote = (itemsToAdd) => {
        try {
            const existing = JSON.parse(localStorage.getItem('mcb_quote_cart') || '[]');
            const existingIds = new Set(existing.map(i => i.product_id));
            const newItems = itemsToAdd.filter(i => i && i.product_id && !existingIds.has(i.product_id));
            localStorage.setItem('mcb_quote_cart', JSON.stringify([...existing, ...newItems]));
            setSelectedForQuote(new Set());
            alert(`✅ ${newItems.length} producto(s) agregado(s). Andá a "Cotizaciones" en el menú.`);
        } catch (e) {
            alert('Error: ' + e.message);
        }
    };

    const toggleSelectForQuote = (productId) => {
        setSelectedForQuote(prev => {
            const next = new Set(prev);
            if (next.has(productId)) next.delete(productId);
            else next.add(productId);
            return next;
        });
    };

    const handleImagePersist = async (item, urlOrFile) => {
        if (!item || !urlOrFile) return;
        setIsUploading(true);
        try {
            await catalogService.persistProductImage(item.product_id, urlOrFile);
            setEditingImageItem(null);
            await loadCatalog(true); // Recargar para ver los cambios
        } catch (err) {
            console.error('Error al persistir imagen:', err);
            alert('❌ No se pudo guardar la imagen: ' + err.message);
        } finally {
            setIsUploading(false);
        }
    };

    const handleUpdateStock = async (id, newStock, field = 'stock_fisico') => {
        if (id === undefined || id === null) return;
        const val = parseInt(newStock);
        if (isNaN(val)) return;

        setIsUpdatingStock(true);
        try {
            if (field === 'stock_fisico') {
                await catalogService.updateProductStock(id, val);
            } else {
                const updates = { [field]: val };
                const { error } = await supabase.from('catalogo_productos').update(updates).eq('id', id);
                if (error) throw error;
                catalogService.clearCache();
            }
            
            // Update local state
            setCatalogData(prev => prev.map(item => {
                if (item.id === id) {
                    const nextItem = { ...item, [field]: val };
                    const totalFlotante = Object.values(nextItem.floatingByWeek || {}).reduce((s, d) => s + d.qty, 0);
                    nextItem.stock_total = (nextItem.stock_fisico || 0) + totalFlotante;
                    return nextItem;
                }
                return item;
            }));

            // CERRAR EDICIÓN SOLO TRAS ÉXITO
            setEditingStock(null);
            setEditingMinStock(null);
        } catch (err) {
            console.error('Error al actualizar inventario:', err);
            alert('❌ No se pudo actualizar el valor.');
        } finally {
            setIsUpdatingStock(false);
        }
    };

    const handleBulkUpdateStock = async (field) => {
        const val = field === 'stock_fisico' ? Number(bulkStockValue) : Number(bulkMinValue);
        if (isNaN(val) || val < 0) return;
        setBulkStockSaving(true);
        try {
            const ids = [...selectedForQuote];
            for (const productId of ids) {
                const item = catalogData.find(i => i.product_id === productId);
                if (!item) continue;
                if (field === 'stock_fisico') {
                    await catalogService.updateProductStock(item.id, val);
                } else {
                    await supabase.from('catalogo_productos').update({ stock_minimo: val }).eq('id', item.id);
                }
            }
            if (field === 'stock_fisico') setBulkStockValue('');
            else setBulkMinValue('');
            await loadCatalog();
        } catch (err) {
            console.error('Error en edición masiva:', err);
            alert('❌ Error al actualizar: ' + err.message);
        } finally {
            setBulkStockSaving(false);
        }
    };

    const handleOpenBulkEdit = () => {
        const selected = catalogData.filter(i => selectedForQuote.has(i.product_id));
        setBulkItems(selected.map(item => ({
            ...item,
            newUrl: '',
            newFile: null,
            status: 'pending' // pending, syncing, success, error
        })));
        setIsBulkEditing(true);
    };

    // --- MOTOR DE COLA EN SEGUNDO PLANO (WORKER) ---
    const isWorkerRunning = useRef(false);
    const bulkItemsRef = useRef([]);
    const stopRef = useRef(false);

    // Sincronizamos la referencia cada vez que el estado cambia
    useEffect(() => {
        bulkItemsRef.current = bulkItems;
    }, [bulkItems]);

    const startQueueWorker = async () => {
        if (isWorkerRunning.current) return;
        isWorkerRunning.current = true;
        stopRef.current = false; // Resetear bandera al empezar
        
        console.log('🚀 Worker iniciado con', bulkItemsRef.current.length, 'ítems');

        while (true) {
            // Buscamos el siguiente pendiente directamente desde la referencia (evita stale closure)
            const items = bulkItemsRef.current;
            const nextItem = items.find(item => item.status === 'pending');
            
            if (!nextItem || stopRef.current) {
                console.log(stopRef.current ? '🛑 Worker detenido por el usuario' : '✅ Worker finalizado');
                break;
            }

            // Marcamos como syncing en el estado de React para la UI
            setBulkItems(prev => prev.map(bi => bi.product_id === nextItem.product_id ? { ...bi, status: 'syncing' } : bi));

            try {
                // Sincronización real con el método correcto persistProductImage
                console.log(`📡 Sincronizando: ${nextItem.titulo}...`);
                await catalogService.persistProductImage(nextItem.product_id, nextItem.newFile || nextItem.newUrl);
                
                // Actualizamos a éxito
                setBulkItems(prev => {
                    const updated = prev.map(bi => bi.product_id === nextItem.product_id ? { ...bi, status: 'success' } : bi);
                    const completed = updated.filter(i => i.status === 'success' || i.status === 'error').length;
                    setBulkProgress(p => ({ ...p, current: completed, total: updated.length, active: updated.some(i => i.status === 'pending' || i.status === 'syncing') }));
                    return updated;
                });
            } catch (err) {
                console.error(`❌ Error en worker para ${nextItem.titulo}:`, err);
                setBulkItems(prev => {
                    const updated = prev.map(bi => bi.product_id === nextItem.product_id ? { ...bi, status: 'error' } : bi);
                    const completed = updated.filter(i => i.status === 'success' || i.status === 'error').length;
                    setBulkProgress(p => ({ ...p, current: completed, total: updated.length, active: updated.some(i => i.status === 'pending' || i.status === 'syncing') }));
                    return updated;
                });
            }

            // Pequeña pausa para no saturar y dejar que React respire
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        isWorkerRunning.current = false;
        if (stopRef.current) setBulkProgress(p => ({ ...p, active: false }));
        // Solo desactivamos el visor si todo terminó hace unos segundos o si el usuario lo prefiere
        // Por ahora, lo mantenemos activo para que vea el 100%
        loadCatalog(true);
    };

    const handleBulkPersist = () => {
        const toProcess = bulkItems.filter(item => (item.newUrl || item.newFile) && item.status === 'pending');
        if (toProcess.length === 0) {
            alert('No hay cambios pendientes para sincronizar.');
            return;
        }

        setBulkProgress(prev => ({ ...prev, active: true, total: bulkItems.length }));
        startQueueWorker();
    };

    const processRawHtml = (html) => {
        if (!html) return;
        setIsScanning(true); // Reusamos para un pequeño delay visual
        setIsSmartSyncOpen(true);
        setSmartMatches([]);
        
        try {
            const htmlLower = html.toLowerCase();
            let editorialToUse = selectedSyncEditorial;

            // Auto-detección de Ivrea si está en "TODOS"
            if (editorialToUse === 'TODOS' && (htmlLower.includes('ivrea') || htmlLower.includes('editorialivrea'))) {
                editorialToUse = 'Ivrea';
                setSelectedSyncEditorial('Ivrea');
            }

            const externalDocs = catalogService.extractFromRawHTML(html);
            
            if (externalDocs.length === 0) {
                alert('No encontramos imágenes en este código. Asegúrate de haber copiado todo el contenido (Ctrl+A).');
                setIsScanning(false);
                return;
            }

            // Filtrar catálogo por editorial si es necesario
            const filteredCatalog = editorialToUse === 'TODOS' 
                ? catalogData 
                : catalogData.filter(i => (i.editorial || '').toUpperCase() === editorialToUse.toUpperCase());

            // Realizar Fuzzy Match con el catálogo filtrado
            const matches = externalDocs.map(ext => {
                let bestMatch = null;
                let topScore = 0;

                filteredCatalog.forEach(item => {
                    const score = catalogService.calculateMatchScore(ext.label, item.titulo);
                    if (score > topScore) {
                        topScore = score;
                        bestMatch = item;
                    }
                });

                let confidence = 'none';
                if (topScore > 75) confidence = 'high';
                else if (topScore > 35) confidence = 'medium';

                return {
                    extUrl: ext.url,
                    extLabel: ext.label,
                    catalogItem: bestMatch,
                    score: topScore,
                    confidence,
                    selected: confidence === 'high' && !bestMatch.imagen_url
                };
            });

            setSmartMatches(matches);
            setShowExpertMode(false);
            setRawHtmlInput(''); // Limpiar tras procesar
        } catch (err) {
            console.error('Error procesando HTML:', err);
            alert('Error al procesar el código fuente.');
        } finally {
            setIsScanning(false);
        }
    };

    const handleToggleMatch = (index) => {
        const newMatches = [...smartMatches];
        newMatches[index].selected = !newMatches[index].selected;
        setSmartMatches(newMatches);
    };

    const handleBulkSelect = (type) => {
        const newMatches = [...smartMatches];
        newMatches.forEach(m => {
            if (type === 'ALL') m.selected = true;
            else if (type === 'NONE') m.selected = false;
            else if (type === 'HIGH_CONFIDENCE') m.selected = (m.score >= 80);
        });
        setSmartMatches(newMatches);
    };

    const handleSmartPersist = () => {
        const toSync = smartMatches.filter(m => m.selected && m.catalogItem);
        if (toSync.length === 0) {
            alert('No hay coincidencias seleccionadas para sincronizar.');
            return;
        }

        // MODO APILAR (Append): Sumamos los nuevos a la cola existente
        const newBulkEntries = toSync.map(m => ({
            ...m.catalogItem,
            newUrl: m.extUrl,
            newFile: null,
            status: 'pending'
        }));

        setBulkItems(prev => {
            const combined = [...prev, ...newBulkEntries];
            const completed = combined.filter(i => i.status === 'success' || i.status === 'error').length;
            setBulkProgress({
                current: completed,
                total: combined.length,
                active: true,
                stop: false
            });
            return combined;
        });

        setIsSmartSyncOpen(false);
        // Iniciamos el worker si no está corriendo
        setTimeout(startQueueWorker, 100);
    };

    // CATEGORÍAS SEGÚN EDITORIAL
    const dynamicCategories = useMemo(() => {
        const edMatch = editorialFilter.trim().toUpperCase();
        const base = edMatch === 'TODOS' 
            ? catalogData 
            : catalogData.filter(i => (i.editorial || '').trim().toUpperCase() === edMatch);
        return [...new Set(base.map(i => i.categoria))].filter(Boolean).sort();
    }, [catalogData, editorialFilter]);

    // RESET CATEGORÍA AL CAMBIAR EDITORIAL
    useEffect(() => {
        setCategoryFilter('TODOS');
    }, [editorialFilter]);

    // FILTRADO ROBUSTO (v5 Final)
    const { filteredItems, counts } = useMemo(() => {
        const edSearch = editorialFilter.trim().toUpperCase();
        const catSearch = categoryFilter.trim().toUpperCase();
        const queryText = debouncedSearch.trim().toLowerCase();

        const filtered = catalogData.filter(item => {
            // 1. Editorial
            const valEd = (item.editorial || '').trim().toUpperCase();
            if (edSearch !== 'TODOS' && valEd !== edSearch) return false;

            // 2. Categoría
                                    const valCat = (item.categoria || '').trim().replace(/\s+/g, ' ').toUpperCase();
                                    const catSearchMatch = catSearch.replace(/\s+/g, ' ');
                                    if (catSearch !== 'TODOS' && valCat !== catSearchMatch) return false;

            // 3. Reimpresiones
            if (reprintsOnlyFilter && !item.es_reimpresion) return false;

            // 4. Búsqueda de Texto
            if (queryText) {
                const searchScope = [
                    item.titulo,
                    item.ean_oficial,
                    item.ean_interno,
                    item.product_id
                ].map(v => (v || '').toLowerCase());
                
                if (!searchScope.some(v => v.includes(queryText))) return false;
            }

            // 5. Filtro de Stock (Físico o Flotante)
            if (showOnlyWithStock) {
                if ((item.stock_fisico || 0) <= 0) return false;
            }

            // 6. Filtro por Semana Específica
            if (weekFilter !== 'TODAS' && !item.floatingByWeek?.[weekFilter]) return false;

            return true;
        });

        return {
            filteredItems: filtered,
            counts: {
                total: catalogData.length,
                visible: filtered.length
            }
        };
    }, [catalogData, editorialFilter, categoryFilter, debouncedSearch, reprintsOnlyFilter, showOnlyWithStock, weekFilter]);

    // EFECTO DEBOUNCE PARA BÚSQUEDA
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
            setItemsToShow(50); // Resetear paginación al buscar
        }, 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    return (
        <div className="animate-in fade-in duration-700" style={{ padding: '1rem' }}>
            {/* Header y Filtros */}
            <div style={{ 
                background: 'white', 
                padding: '1.5rem', 
                borderRadius: '16px', 
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.05)',
                marginBottom: '1.5rem',
                border: '1px solid #eef2f6'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ background: 'linear-gradient(135deg, #f07d2a 0%, #ed6a10 100%)', color: 'white', padding: '0.75rem', borderRadius: '12px', boxShadow: '0 4px 12px rgba(240, 125, 42, 0.3)' }}>
                        <Database size={24} />
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: 0, color: '#1e293b', letterSpacing: '-0.025em' }}>
                            Catálogo Maestro Actualizado
                            <span style={{ fontSize: '0.875rem', color: '#f07d2a', background: 'rgba(240, 125, 42, 0.1)', padding: '2px 10px', borderRadius: '20px', marginLeft: '12px', fontWeight: 600 }}>
                                {counts.visible} de {counts.total} items
                            </span>
                        </h2>
                        <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>Gestión detallada de productos, precios en BS y etiquetas de reimpresión.</p>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                        <button 
                            onClick={() => loadCatalog(false)}
                            disabled={isLoading}
                            title="Actualizar vista (usa caché si existe)"
                            style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '0.5rem', 
                                padding: '0.625rem 1rem', 
                                borderRadius: '12px', 
                                border: '1px solid #e2e8f0', 
                                background: 'white', 
                                cursor: 'pointer', 
                                fontWeight: 700, 
                                fontSize: '0.875rem',
                                transition: 'all 0.2s ease',
                                color: '#475569'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                        >
                            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                            Refrescar
                        </button>

                        {isAdmin && (
                            <button 
                                onClick={() => loadCatalog(true)}
                                disabled={isLoading}
                                title="Forzar descarga completa desde el servidor"
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.5rem', 
                                    padding: '0.625rem 1rem', 
                                    borderRadius: '12px', 
                                    border: '1px solid #fee2e2', 
                                    background: '#fef2f2', 
                                    cursor: 'pointer', 
                                    fontWeight: 700, 
                                    fontSize: '0.875rem',
                                    transition: 'all 0.2s ease',
                                    color: '#ef4444'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                                onMouseLeave={(e) => e.currentTarget.style.background = '#fef2f2'}
                            >
                                <RotateCcw size={16} className={isLoading ? 'animate-spin' : ''} />
                                Forzar Recarga
                            </button>
                        )}

                        {isAdmin && (
                            <button 
                                onClick={handleGlobalStockReset}
                                disabled={isLoading || isResetting}
                                title="RESETEAR TODO EL STOCK A 0 (Acción Crítica)"
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.5rem', 
                                    padding: '0.625rem 1rem', 
                                    borderRadius: '12px', 
                                    border: '1px solid #fee2e2', 
                                    background: '#7f1d1d', 
                                    cursor: 'pointer', 
                                    fontWeight: 700, 
                                    fontSize: '0.875rem',
                                    transition: 'all 0.2s ease',
                                    color: 'white',
                                    boxShadow: '0 4px 12px rgba(127, 29, 29, 0.2)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = '#991b1b'}
                                onMouseLeave={(e) => e.currentTarget.style.background = '#7f1d1d'}
                            >
                                <Zap size={16} style={{ fill: 'currentColor' }} />
                                Reset Stock 0
                            </button>
                        )}

                        {isAdmin && (
                            <button 
                                onClick={handleClearReprints}
                                disabled={isLoading}
                                title="Borrar todas las marcas de reimpresión del catálogo"
                                style={{ 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    gap: '0.5rem', 
                                    padding: '0.625rem 1rem', 
                                    borderRadius: '12px', 
                                    border: '1px solid #ddd', 
                                    background: '#f8fafc', 
                                    cursor: 'pointer', 
                                    fontWeight: 700, 
                                    fontSize: '0.875rem',
                                    transition: 'all 0.2s ease',
                                    color: '#64748b'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#1e293b'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.color = '#64748b'; }}
                            >
                                <RotateCcw size={16} />
                                Limpiar Filtro Semanal
                            </button>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: '300px', position: 'relative' }}>
                        <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <input 
                            type="text"
                            placeholder="Buscar por título, EAN o ID..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ 
                                width: '100%', 
                                padding: '0.75rem 1rem 0.75rem 2.75rem', 
                                borderRadius: '12px', 
                                border: '2px solid #f1f5f9', 
                                outline: 'none', 
                                fontSize: '0.9rem',
                                transition: 'border-color 0.2s ease',
                                fontWeight: 500
                            }}
                            onFocus={(e) => e.currentTarget.style.borderColor = '#f07d2a'}
                            onBlur={(e) => e.currentTarget.style.borderColor = '#f1f5f9'}
                        />
                    </div>

                    <button 
                        onClick={() => { setIsSmartSyncOpen(true); setShowExpertMode(true); }}
                        className="bg-[#1b3a57] text-[#f5a800] px-6 py-3 rounded-xl font-black text-xs flex items-center gap-3 hover:bg-[#132a41] transition-all shadow-md group"
                    >
                        <ImageIcon size={16} className="group-hover:scale-110 transition-transform" />
                        🚀 Sincronizador Experto (Bulk)
                    </button>
                    
                    <select 
                        value={editorialFilter}
                        onChange={(e) => setEditorialFilter(e.target.value)}
                        style={{ padding: '0.75rem 1rem', borderRadius: '12px', border: '2px solid #f1f5f9', outline: 'none', fontSize: '0.9rem', background: 'white', fontWeight: 600, color: '#334155', minWidth: '180px' }}
                    >
                        <option value="TODOS">Todas las Editoriales</option>
                        {editorialesList.map(ed => (
                            <option key={ed} value={ed}>{ed}</option>
                        ))}
                    </select>

                    <select 
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        style={{ padding: '0.75rem 1rem', borderRadius: '12px', border: '2px solid #f1f5f9', outline: 'none', fontSize: '0.9rem', background: 'white', fontWeight: 600, color: '#334155', minWidth: '220px' }}
                    >
                        <option value="TODOS">Todas las Categorías</option>
                        {dynamicCategories.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>

                    <label style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.75rem', 
                        padding: '0.75rem 1.25rem', 
                        background: reprintsOnlyFilter ? 'rgba(240, 125, 42, 0.05)' : '#f8fafc',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        border: reprintsOnlyFilter ? '2px solid rgba(240, 125, 42, 0.2)' : '2px solid transparent',
                        transition: 'all 0.2s ease'
                    }}>
                        <input 
                            type="checkbox"
                            checked={reprintsOnlyFilter}
                            onChange={(e) => setReprintsOnlyFilter(e.target.checked)}
                            style={{ width: '1.25rem', height: '1.25rem', accentColor: '#f07d2a', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: reprintsOnlyFilter ? '#f07d2a' : '#64748b' }}>Solo Reimpresiones</span>
                    </label>

                    <label style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '0.75rem', 
                        padding: '0.75rem 1.25rem', 
                        background: showOnlyWithStock ? 'rgba(22, 163, 74, 0.05)' : '#f8fafc',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        border: showOnlyWithStock ? '2px solid rgba(22, 163, 74, 0.2)' : '2px solid transparent',
                        transition: 'all 0.2s ease'
                    }}>
                        <input 
                            type="checkbox"
                            checked={showOnlyWithStock}
                            onChange={(e) => setShowOnlyWithStock(e.target.checked)}
                            style={{ width: '1.25rem', height: '1.25rem', accentColor: '#16a34a', cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.875rem', fontWeight: 700, color: showOnlyWithStock ? '#16a34a' : '#64748b' }}>Solo con Stock</span>
                    </label>

                    <select 
                        value={weekFilter}
                        onChange={(e) => setWeekFilter(e.target.value)}
                        style={{ padding: '0.75rem 1rem', borderRadius: '12px', border: '2px solid #f1f5f9', outline: 'none', fontSize: '0.9rem', background: 'white', fontWeight: 600, color: '#0f172a', minWidth: '220px' }}
                    >
                        <option value="TODAS">Ver Todas las Semanas</option>
                        {activeWeeks.map(w => (
                            <option key={w.id} value={w.id}>{w.nombre} (~{w.fechaArribo.toLocaleDateString('es', { day: 'numeric', month: 'short' })})</option>
                        ))}
                    </select>

                </div>
            </div>

            {/* Tabla Premium */}
            <div style={{ 
                background: 'white', 
                borderRadius: '20px', 
                overflow: 'hidden', 
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.05), 0 10px 10px -5px rgba(0,0,0,0.04)',
                border: '1px solid #eef2f6'
            }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, textAlign: 'left' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc' }}>
                                <th style={{ padding: '1.25rem 0.75rem', borderBottom: '2px solid #f1f5f9', width: '40px' }}>
                                    <input
                                        type="checkbox"
                                        title="Seleccionar todos"
                                        style={{ width: '1.1rem', height: '1.1rem', accentColor: '#f07d2a', cursor: 'pointer' }}
                                        checked={filteredItems.slice(0, itemsToShow).length > 0 && filteredItems.slice(0, itemsToShow).every(i => selectedForQuote.has(i.product_id))}
                                        onChange={(e) => {
                                            const visible = filteredItems.slice(0, itemsToShow);
                                            if (e.target.checked) {
                                                setSelectedForQuote(prev => { const n = new Set(prev); visible.forEach(i => n.add(i.product_id)); return n; });
                                            } else {
                                                setSelectedForQuote(prev => { const n = new Set(prev); visible.forEach(i => n.delete(i.product_id)); return n; });
                                            }
                                        }}
                                    />
                                </th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', borderBottom: '2px solid #f1f5f9', width: '60px' }}>Imagen</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>Producto</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>EAN (Limpio)</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>Editorial</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>Categoría</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>Precio Tapa</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#f07d2a', fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>G PV (BS)</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#16a34a', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>N1 -10%</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#2563eb', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>N2 -15%</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#7c3aed', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>N3 -20%</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>Mayoreo</th>
                                
                                {/* DYNAMIC STOCK COLUMNS */}
                                {activeWeeks.map(w => (
                                    <th key={w.id} style={{ padding: '1.25rem 0.5rem', borderBottom: '2px solid #f1f5f9', textAlign: 'center', background: w.isConfirmed ? 'rgba(240, 125, 42, 0.03)' : 'rgba(37, 99, 235, 0.03)' }}>
                                        <div style={{ fontSize: '0.6rem', color: w.isConfirmed ? '#f07d2a' : '#2563eb', fontWeight: 800 }}>{w.nombre}</div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#1e293b' }}>{w.fechaArribo.toLocaleDateString('es', { day: 'numeric', month: 'long' })}</div>
                                    </th>
                                ))}

                                <th style={{ padding: '1.25rem 1rem', color: '#0f172a', fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'center' }}>Stock Físico</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'center' }}>Min.</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#16a34a', fontWeight: 900, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'center', background: 'rgba(22, 163, 74, 0.05)' }}>TOTAL</th>
                                <th style={{ padding: '1.25rem 1rem', borderBottom: '2px solid #f1f5f9' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading ? (
                                <tr>
                                    <td colSpan="11" style={{ padding: '6rem 2rem', textAlign: 'center' }}>
                                        <div className="animate-spin" style={{ width: '40px', height: '40px', border: '4px solid #f1f5f9', borderTopColor: '#f07d2a', borderRadius: '50%', margin: '0 auto 1.5rem' }}></div>
                                        <span style={{ color: '#64748b', fontWeight: 600, fontSize: '1rem' }}>Sincronizando catálogo...</span>
                                    </td>
                                </tr>
                            ) : filteredItems.length === 0 ? (
                                <tr>
                                    <td colSpan="11" style={{ padding: '6rem 2rem', textAlign: 'center' }}>
                                        <div style={{ opacity: 0.2, marginBottom: '1rem' }}><Database size={48} style={{ margin: '0 auto' }} /></div>
                                        <span style={{ color: '#94a3b8', fontSize: '1.125rem', fontWeight: 500 }}>No se encontraron coincidencias para los filtros aplicados.</span>
                                    </td>
                                </tr>
                            ) : filteredItems.slice(0, itemsToShow).map((item, idx) => (
                                <tr key={`${item.product_id}-${idx}`} style={{ 
                                    borderBottom: '1px solid #f1f5f9',
                                    transition: 'background 0.2s ease',
                                    background: selectedForQuote.has(item.product_id) ? 'rgba(240, 125, 42, 0.04)' : 'transparent'
                                }}
                                onMouseEnter={(e) => { if (!selectedForQuote.has(item.product_id)) e.currentTarget.style.background = '#fcfdfe'; }}
                                onMouseLeave={(e) => { if (!selectedForQuote.has(item.product_id)) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <td style={{ padding: '1.25rem 0.75rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={selectedForQuote.has(item.product_id)}
                                            onChange={() => toggleSelectForQuote(item.product_id)}
                                            style={{ width: '1.1rem', height: '1.1rem', accentColor: '#f07d2a', cursor: 'pointer' }}
                                        />
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem' }}>
                                        <div 
                                            onClick={() => setPreviewItem(item)}
                                            style={{ 
                                                width: '44px', 
                                                height: '44px', 
                                                borderRadius: '8px', 
                                                background: '#f1f5f9', 
                                                overflow: 'hidden', 
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                border: '2px solid #e2e8f0',
                                                transition: 'transform 0.2s, background 0.2s',
                                                boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                                            }}
                                            className="hover:bg-slate-200"
                                            onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
                                            onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                                        >
                                            {item.imagen_url ? (
                                            <img 
                                                src={item.imagen_url.includes('supabase.co') 
                                                    ? item.imagen_url 
                                                    : `https://images.weserv.nl/?url=${encodeURIComponent(item.imagen_url.replace(/^https?:\/\//, ''))}&w=100&h=100&fit=cover`} 
                                                alt="" 
                                                className="w-full h-full object-cover" 
                                            />
                                            ) : (
                                                <div className="flex flex-col items-center">
                                                    <ImageIcon size={18} className="text-slate-300" />
                                                </div>
                                            )}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <div style={{ color: '#94a3b8', fontSize: '0.65rem', fontWeight: 600, fontFamily: 'monospace', width: '20px' }}>{idx + 1}</div>
                                            <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem' }}>{item.titulo}</div>
                                            {item.es_reimpresion && (
                                                <span style={{ 
                                                    background: '#fff1f2', 
                                                    color: '#e11d48', 
                                                    fontSize: '0.625rem', 
                                                    fontWeight: 900, 
                                                    padding: '2px 8px', 
                                                    borderRadius: '6px',
                                                    border: '1px solid #ffe4e6',
                                                    textTransform: 'uppercase'
                                                }}>REIMPRESIÓN</span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px', fontFamily: 'monospace' }}>ID: {item.product_id}</div>
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace', color: '#475569', fontWeight: 600, fontSize: '0.85rem' }}>
                                        {item.ean_oficial || item.ean_interno || 'S/EAN'}
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem' }}>
                                        <span style={{ background: '#f1f5f9', padding: '0.25rem 0.625rem', borderRadius: '8px', fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>{item.editorial}</span>
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem' }}>
                                        <span style={{ color: '#64748b', fontWeight: 500 }}>{item.categoria || '--'}</span>
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right' }}>
                                        <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>${Number(item.precio_tapa || 0).toLocaleString('es-BO')}</div>
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right' }}>
                                        <div style={{ 
                                            background: 'rgba(240, 125, 42, 0.08)', 
                                            color: '#f07d2a', 
                                            padding: '0.5rem 0.75rem', 
                                            borderRadius: '10px', 
                                            display: 'inline-block',
                                            fontWeight: 800,
                                            fontSize: '1rem',
                                            minWidth: '90px'
                                        }}>
                                            {item.precio_venta_bs ? `BS ${item.precio_venta_bs.toFixed(2)}` : '--'}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>
                                        {item.precio_n1_bs 
                                            ? `BS ${item.precio_n1_bs.toFixed(2)}` 
                                            : item.precio_venta_bs 
                                                ? `BS ${(item.precio_venta_bs * 0.90).toFixed(2)}` 
                                                : '--'}
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right', fontWeight: 700, color: '#2563eb' }}>
                                        {item.precio_n2_bs 
                                            ? `BS ${item.precio_n2_bs.toFixed(2)}` 
                                            : item.precio_venta_bs 
                                                ? `BS ${(item.precio_venta_bs * 0.85).toFixed(2)}` 
                                                : '--'}
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right', fontWeight: 700, color: '#7c3aed' }}>
                                        {item.precio_n3_bs 
                                            ? `BS ${item.precio_n3_bs.toFixed(2)}` 
                                            : item.precio_venta_bs 
                                                ? `BS ${(item.precio_venta_bs * 0.80).toFixed(2)}` 
                                                : '--'}
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'right', fontWeight: 600, color: '#334155' }}>
                                        {item.precio_mayoreo_bs ? `BS ${item.precio_mayoreo_bs.toFixed(2)}` : '--'}
                                    </td>

                                    {/* DYNAMIC STOCK DATA */}
                                    {activeWeeks.map(w => {
                                        const weekData = item.floatingByWeek?.[w.id];
                                        return (
                                            <td key={w.id} style={{ padding: '0.75rem 0.5rem', textAlign: 'center', background: 'transparent' }}>
                                                {weekData ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                                        <span style={{ 
                                                            background: weekData.isConfirmed ? '#f07d2a' : '#2563eb', 
                                                            color: 'white', 
                                                            fontSize: '0.75rem', 
                                                            fontWeight: 900, 
                                                            padding: '2px 6px', 
                                                            borderRadius: '6px',
                                                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                        }}>
                                                            {weekData.isConfirmed ? '+' : '?'}{weekData.qty}
                                                        </span>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, color: weekData.isConfirmed ? '#f07d2a' : '#2563eb', marginTop: '2px' }}>
                                                            {weekData.isConfirmed ? 'CONF' : 'PEDIDO'}
                                                        </span>
                                                    </div>
                                                ) : <span style={{ opacity: 0.1 }}>-</span>}
                                            </td>
                                        );
                                    })}

                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'center' }}>
                                        {isAdmin ? (
                                            editingStock?.productId === item.product_id ? (
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                                    <input 
                                                        type="number" 
                                                        autoFocus
                                                        defaultValue={item.stock_fisico || 0}
                                                        onFocus={(e) => e.target.select()}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.preventDefault();
                                                                handleUpdateStock(item.id, e.target.value);
                                                            }
                                                            if (e.key === 'Escape') setEditingStock(null);
                                                        }}
                                                        onBlur={(e) => {
                                                            // Only update if we didn't just close it via Enter/Escape
                                                            if (editingStock?.productId === item.product_id) {
                                                                handleUpdateStock(item.id, e.target.value);
                                                            }
                                                        }}
                                                        style={{ width: '60px', padding: '4px', borderRadius: '4px', border: '2px solid #f07d2a', textAlign: 'center', fontWeight: 800, outline: 'none' }}
                                                    />
                                                </div>
                                            ) : (
                                                <div 
                                                    onClick={() => setEditingStock({ productId: item.product_id, value: item.stock_fisico || 0 })}
                                                    style={{ 
                                                        background: (item.stock_fisico || 0) > 0 ? 'rgba(15, 23, 42, 0.05)' : 'rgba(239, 68, 68, 0.1)', 
                                                        color: (item.stock_fisico || 0) > 0 ? '#0f172a' : '#ef4444',
                                                        padding: '0.4rem 0.8rem', 
                                                        borderRadius: '8px', 
                                                        cursor: 'pointer',
                                                        fontWeight: 800,
                                                        fontSize: '0.9rem',
                                                        display: 'inline-block',
                                                        minWidth: '40px',
                                                        border: '1px dashed transparent'
                                                    }}
                                                    onMouseEnter={e => e.currentTarget.style.borderColor = '#f07d2a'}
                                                    onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                                                >
                                                    {item.stock_fisico || 0}
                                                </div>
                                            )
                                        ) : (
                                            <div style={{ fontWeight: 800, color: '#0f172a' }}>{item.stock_fisico || 0}</div>
                                        )}
                                    </td>
                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'center' }}>
                                        {isAdmin ? (
                                            editingMinStock?.productId === item.product_id ? (
                                                <input 
                                                    type="number" 
                                                    autoFocus
                                                    defaultValue={item.stock_minimo || 0}
                                                    onFocus={(e) => e.target.select()}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleUpdateStock(item.id, e.target.value, 'stock_minimo');
                                                        }
                                                        if (e.key === 'Escape') setEditingMinStock(null);
                                                    }}
                                                    onBlur={(e) => {
                                                        if (editingMinStock?.productId === item.product_id) {
                                                            handleUpdateStock(item.id, e.target.value, 'stock_minimo');
                                                        }
                                                    }}
                                                    style={{ width: '60px', padding: '4px', borderRadius: '4px', border: '2px solid #64748b', textAlign: 'center', fontWeight: 800, outline: 'none' }}
                                                />
                                            ) : (
                                                <div 
                                                    onClick={() => setEditingMinStock({ productId: item.product_id, value: item.stock_minimo || 0 })}
                                                    style={{ color: '#64748b', opacity: 0.5, cursor: 'pointer', fontSize: '0.8rem' }}
                                                >
                                                    {item.stock_minimo || 0}
                                                </div>
                                            )
                                        ) : (
                                            <span style={{ color: '#64748b', opacity: 0.5 }}>{item.stock_minimo || 0}</span>
                                        )}
                                    </td>

                                    <td style={{ padding: '1.25rem 1rem', textAlign: 'center', background: 'rgba(22, 163, 74, 0.02)' }}>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 900, color: '#16a34a' }}>
                                            {(item.stock_fisico || 0) + Object.values(item.floatingByWeek || {}).reduce((sum, f) => sum + (f.qty || 0), 0)}
                                        </div>
                                    </td>

                                    <td style={{ padding: '1.25rem 0.75rem' }}>
                                        <button
                                            title="Agregar a Cotización"
                                            onClick={() => handleAddToQuote([item])}
                                            style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(22,163,74,0.1)', color: '#16a34a', fontWeight: 800, fontSize: '0.7rem', padding: '4px 8px', borderRadius: '6px', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                        >
                                            <ShoppingCart size={11} /> +Cot.
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* BOTÓN VER MÁS */}
                {filteredItems.length > itemsToShow && (
                    <div style={{ padding: '2rem', textAlign: 'center', borderTop: '1px solid #f1f5f9' }}>
                        <button 
                            onClick={() => setItemsToShow(prev => prev + 100)}
                            style={{ 
                                padding: '0.75rem 2rem', 
                                borderRadius: '12px', 
                                border: '1px solid #f07d2a', 
                                background: 'white', 
                                color: '#f07d2a', 
                                fontWeight: 700, 
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#f07d2a'; e.currentTarget.style.color = 'white'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.color = '#f07d2a'; }}
                        >
                            Ver más productos ({filteredItems.length - itemsToShow} restantes)
                        </button>
                    </div>
                )}
            </div>

            {/* Floating Quote Bar */}
            {selectedForQuote.size > 0 && (
                <div style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: '#1a2d42', color: 'white', borderRadius: '999px', padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 9999, border: '2px solid #f07d2a' }}>
                    <ShoppingCart size={18} style={{ color: '#f07d2a' }} />
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>{selectedForQuote.size} producto(s) seleccionado(s)</span>
                    
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        {/* Stock Físico masivo */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                                type="number" min="0" placeholder="Stock"
                                value={bulkStockValue}
                                onChange={e => setBulkStockValue(e.target.value)}
                                style={{ width: '64px', padding: '4px 8px', borderRadius: '8px', border: '1.5px solid #f07d2a', background: 'rgba(240,125,42,0.15)', color: 'white', fontWeight: 800, fontSize: '13px', textAlign: 'center', outline: 'none' }}
                            />
                            <button
                                onClick={() => handleBulkUpdateStock('stock_fisico')}
                                disabled={bulkStockValue === '' || bulkStockSaving}
                                style={{ background: '#f07d2a', color: 'white', borderRadius: '999px', padding: '5px 14px', fontWeight: 800, fontSize: '12px', border: 'none', cursor: bulkStockValue === '' ? 'not-allowed' : 'pointer', opacity: bulkStockValue === '' ? 0.5 : 1 }}
                            >
                                Stock
                            </button>
                        </div>
                        {/* Stock Mínimo masivo */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <input
                                type="number" min="0" placeholder="Mín"
                                value={bulkMinValue}
                                onChange={e => setBulkMinValue(e.target.value)}
                                style={{ width: '54px', padding: '4px 8px', borderRadius: '8px', border: '1.5px solid #94a3b8', background: 'rgba(148,163,184,0.15)', color: 'white', fontWeight: 800, fontSize: '13px', textAlign: 'center', outline: 'none' }}
                            />
                            <button
                                onClick={() => handleBulkUpdateStock('stock_minimo')}
                                disabled={bulkMinValue === '' || bulkStockSaving}
                                style={{ background: '#64748b', color: 'white', borderRadius: '999px', padding: '5px 14px', fontWeight: 800, fontSize: '12px', border: 'none', cursor: bulkMinValue === '' ? 'not-allowed' : 'pointer', opacity: bulkMinValue === '' ? 0.5 : 1 }}
                            >
                                Mín
                            </button>
                        </div>
                        <button
                            onClick={handleOpenBulkEdit}
                            style={{ background: 'rgba(245, 168, 0, 0.2)', color: '#f5a800', borderRadius: '999px', padding: '6px 18px', fontWeight: 800, fontSize: '13px', border: '1.5px solid #f5a800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <ImageIcon size={14} /> Subir Imágenes
                        </button>

                        <button
                            onClick={() => handleAddToQuote(catalogData.filter(i => selectedForQuote.has(i.product_id)))}
                            style={{ background: '#f07d2a', color: 'white', borderRadius: '999px', padding: '6px 18px', fontWeight: 800, fontSize: '13px', border: 'none', cursor: 'pointer' }}
                        >
                            Agregar a Cotización ➡
                        </button>
                    </div>

                    <button
                        onClick={() => setSelectedForQuote(new Set())}
                        style={{ opacity: 0.5, cursor: 'pointer', background: 'none', border: 'none', color: 'white', fontSize: '16px' }}
                        title="Deseleccionar todo"
                    >✕</button>
                </div>
            )}

            {/* Modal de Vista Previa de Imagen (Restaurado) */}
            {previewItem && (
                <div 
                    style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
                    onClick={() => setPreviewItem(null)}
                >
                    <div className="animate-in zoom-in duration-300" style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
                        <button 
                            style={{ position: 'absolute', top: '-12px', right: '-12px', background: '#f07d2a', color: 'white', border: 'none', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', zIndex: 101 }}
                            onClick={(e) => { e.stopPropagation(); setPreviewItem(null); }}
                        >
                            <X size={18} />
                        </button>
                        
                        <div style={{ position: 'relative' }}>
                            <img 
                                src={previewItem.imagen_url?.includes('supabase.co') 
                                    ? previewItem.imagen_url 
                                    : `https://images.weserv.nl/?url=${encodeURIComponent((previewItem.imagen_url || '').replace(/^https?:\/\//, ''))}&w=800&fit=cover`} 
                                style={{ maxWidth: '100%', maxHeight: '75vh', borderRadius: '16px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', border: '4px solid white' }}
                                alt="Vista previa"
                                onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src = previewItem.imagen_url;
                                }}
                            />
                            {!previewItem.imagen_url && (
                                <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', textAlign: 'center' }}>
                                    <ImageIcon size={48} className="text-slate-200 mx-auto mb-2" />
                                    <p className="text-slate-500 font-bold">Sin imagen asignada</p>
                                </div>
                            )}
                        </div>

                        <button 
                            onClick={(e) => { e.stopPropagation(); setEditingImageItem(previewItem); setPreviewItem(null); }}
                            style={{ 
                                background: '#f07d2a', 
                                color: 'white', 
                                padding: '12px 24px', 
                                borderRadius: '12px', 
                                fontWeight: 800, 
                                fontSize: '14px', 
                                border: 'none', 
                                cursor: 'pointer', 
                                boxShadow: '0 8px 16px rgba(240,125,42,0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                        >
                            <RefreshCw size={18} /> {previewItem.imagen_url ? 'Cambiar Imagen' : 'Agregar Imagen'}
                        </button>
                    </div>
                </div>
            )}

            {/* Modal de Carga de Imagen */}
            {editingImageItem && (
                <div 
                    style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                    onClick={() => !isUploading && setEditingImageItem(null)}
                >
                    <div 
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="bg-[#1b3a57] p-4 text-[#f5a800] flex justify-between items-center">
                            <h3 className="font-black uppercase text-sm flex items-center gap-2">
                                <ImageIcon size={18} /> Actualizar Imagen
                            </h3>
                            <button onClick={() => setEditingImageItem(null)} disabled={isUploading} className="text-white/50 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-4">
                            <div className="text-center">
                                <p className="text-[#1b3a57] font-bold text-base leading-tight mb-1">{editingImageItem.titulo}</p>
                                <p className="text-slate-400 text-[10px] font-mono">{editingImageItem.product_id}</p>
                            </div>
                            
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black uppercase text-slate-500 block">Opción 1: Pegar Enlace (URL)</label>
                                    <div className="flex gap-2">
                                        <div className="relative flex-1">
                                            <input 
                                                type="text" 
                                                placeholder="https://ejemplo.com/manga.jpg"
                                                className="w-full text-xs border border-slate-200 rounded-lg pl-3 pr-10 py-2 bg-slate-50 focus:ring-2 focus:ring-[#f5a800] outline-none"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && e.target.value) {
                                                        const val = e.target.value;
                                                        if (val.includes('.jpg') || val.includes('.png') || val.includes('.webp')) {
                                                            handleImagePersist(editingImageItem, val);
                                                        } else {
                                                            handleScanUrl('single', val);
                                                        }
                                                    }
                                                }}
                                                id="url-input"
                                            />
                                            <button 
                                                onClick={() => {
                                                    const val = document.getElementById('url-input').value;
                                                    if (val) handleScanUrl('single', val);
                                                }}
                                                disabled={isScanning}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#f5a800] transition-colors"
                                                title="Escanear fotos en el link"
                                            >
                                                {isScanning ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                                            </button>
                                        </div>
                                        <button 
                                            disabled={isUploading}
                                            onClick={() => {
                                                const val = document.getElementById('url-input').value;
                                                if (val) handleImagePersist(editingImageItem, val);
                                            }}
                                            className="bg-[#f5a800] text-[#1b3a57] px-4 py-2 rounded-lg font-black text-xs hover:bg-[#e09a00] transition-colors disabled:opacity-30 flex items-center gap-2"
                                        >
                                            {isUploading ? <RefreshCw size={14} className="animate-spin" /> : 'Sincronizar'}
                                        </button>
                                    </div>
                                </div>
                                
                                <div className="relative border-t border-slate-100 pt-4 text-center">
                                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3 text-[10px] font-bold text-slate-300">O TAMBIÉN</span>
                                    
                                    <label className="flex flex-col items-center gap-3 p-6 border-2 border-dashed border-slate-200 rounded-xl hover:border-[#f5a800] hover:bg-orange-50 transition-all cursor-pointer group">
                                        <div className="bg-slate-100 p-3 rounded-full group-hover:bg-[#f5a800]/20 transition-colors">
                                            <ImageIcon size={24} className="text-slate-400 group-hover:text-[#f5a800]" />
                                        </div>
                                        <div className="text-center">
                                            <p className="text-xs font-black text-[#1b3a57]">Subir imagen desde PC</p>
                                            <p className="text-[10px] text-slate-400">JPG, PNG, WEBP (Máx 5MB)</p>
                                        </div>
                                        <input 
                                            type="file" 
                                            accept="image/*" 
                                            className="hidden" 
                                            onChange={(e) => {
                                                const file = e.target.files[0];
                                                if (file) handleImagePersist(editingImageItem, file);
                                            }}
                                            disabled={isUploading}
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>

                        {isUploading && (
                            <div className="bg-blue-600 p-3 text-center animate-pulse">
                                <p className="text-white text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2">
                                    <RefreshCw size={12} className="animate-spin" /> Procesando y subiendo a la nube...
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal de Carga de Imagen en Lote */}
            {isBulkEditing && (
                <div 
                    style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.8)', backdropFilter: 'blur(8px)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
                    onClick={() => !bulkProgress.active && setIsBulkEditing(false)}
                >
                    <div 
                        className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="bg-[#1b3a57] p-6 text-white flex justify-between items-center">
                            <div>
                                <h3 className="font-black uppercase text-xl flex items-center gap-3">
                                    <ImageIcon size={24} className="text-[#f5a800]" /> Actualización Masiva de Imágenes
                                </h3>
                                <p className="text-white/60 text-xs mt-1 font-bold tracking-wider uppercase">Procesando {bulkItems.length} productos seleccionados</p>
                            </div>
                            <button onClick={() => setIsBulkEditing(false)} disabled={bulkProgress.active} className="text-white/40 hover:text-white transition-colors p-2 hover:bg-white/10 rounded-full">
                                <X size={28} />
                            </button>
                        </div>

                        {bulkProgress.active && (
                            <div className="bg-[#f07d2a] p-4 text-white">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="font-black text-xs uppercase tracking-widest flex items-center gap-2">
                                        <RefreshCw size={14} className="animate-spin" /> 
                                        Sincronizando con la nube... ({bulkProgress.current} de {bulkProgress.total})
                                    </span>
                                    <span className="font-black text-sm">{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
                                </div>
                                <div className="w-full bg-black/20 h-2 rounded-full overflow-hidden">
                                    <div className="bg-white h-full transition-all duration-300" style={{ width: `${(bulkProgress.current / (bulkProgress.total || 1)) * 100}%` }}></div>
                                </div>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto p-0 custom-scrollbar bg-slate-50">
                            <table className="w-full border-collapse text-left">
                                <thead className="sticky top-0 bg-white shadow-sm z-20">
                                    <tr>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b">Manga / Producto</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b">Configuración de Imagen</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b w-[120px] text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {bulkItems.map((item, bIdx) => (
                                        <tr key={item.product_id} className="border-b border-slate-100 hover:bg-white transition-colors">
                                            <td className="px-6 py-6">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 rounded-lg bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
                                                        {item.imagen_url ? (
                                                            <img src={item.imagen_url} className="w-full h-full object-cover" />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-slate-300"><ImageIcon size={20} /></div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="font-black text-[#1b3a57] text-sm leading-tight mb-1">{item.titulo}</p>
                                                        <p className="text-[10px] text-slate-400 font-mono tracking-tighter uppercase">{item.editorial} • {item.product_id}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-6">
                                                <div className="flex flex-col gap-2">
                                                    <div className="flex gap-2">
                                                        <div className="relative flex-1">
                                                            <input 
                                                                type="text" 
                                                                placeholder="Pegar URL de la imagen aquí..."
                                                                value={item.newUrl}
                                                                onChange={(e) => setBulkItems(prev => prev.map(bi => bi.product_id === item.product_id ? { ...bi, newUrl: e.target.value, newFile: null } : bi))}
                                                                disabled={bulkProgress.active || item.status === 'success'}
                                                                className="w-full text-xs border border-slate-200 rounded-xl pl-4 pr-10 py-2.5 bg-white outline-none focus:ring-2 focus:ring-[#f5a800] disabled:opacity-50"
                                                            />
                                                            {item.newUrl && item.status !== 'success' && (
                                                                <button 
                                                                    onClick={() => handleScanUrl(item, item.newUrl)}
                                                                    disabled={isScanning}
                                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#f5a800] transition-colors"
                                                                    title="Escanear fotos en este link"
                                                                >
                                                                    {isScanning && scanningForItem?.product_id === item.product_id ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                                                                </button>
                                                            )}
                                                        </div>
                                                        <label className={`px-4 py-2 rounded-xl text-xs font-black cursor-pointer transition-all flex items-center gap-2 ${item.newFile ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'} ${ (bulkProgress.active || item.status === 'success') ? 'opacity-30 cursor-default' : ''}`}>
                                                            {item.newFile ? '✓ Archivo' : 'Subir Archivo'}
                                                            <input 
                                                                type="file" 
                                                                className="hidden" 
                                                                accept="image/*"
                                                                disabled={bulkProgress.active || item.status === 'success'}
                                                                onChange={(e) => {
                                                                    const f = e.target.files[0];
                                                                    if (f) setBulkItems(prev => prev.map(bi => bi.product_id === item.product_id ? { ...bi, newFile: f, newUrl: '' } : bi));
                                                                }}
                                                            />
                                                        </label>
                                                    </div>
                                                    {(item.newUrl || item.newFile) && item.status !== 'success' && (
                                                        <div className="text-[10px] text-[#f07d2a] font-bold flex items-center gap-1 ml-1 animate-pulse">
                                                            <Info size={10} /> Pendiente de sincronización
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-6 text-center">
                                                {item.status === 'pending' && <div className="text-slate-300 text-xs font-bold">---</div>}
                                                {item.status === 'syncing' && <RefreshCw size={18} className="animate-spin text-blue-500 mx-auto" />}
                                                {item.status === 'success' && <div className="bg-green-100 text-green-600 p-2 rounded-full inline-flex"><CheckCircle2 size={18} /></div>}
                                                {item.status === 'error' && <div className="bg-red-100 text-red-600 p-2 rounded-full inline-flex" title="Intenta de nuevo"><AlertCircle size={18} /></div>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="bg-white p-6 border-t flex justify-end gap-3 shadow-2xl">
                            <button 
                                onClick={() => setIsBulkEditing(false)}
                                className="px-6 py-3 rounded-2xl font-black text-sm text-slate-500 hover:bg-slate-100 transition-colors"
                            >
                                {bulkProgress.active ? 'Minimizar y Continuar' : 'Cancelar'}
                            </button>
                            {!bulkProgress.active && (
                                <button 
                                    onClick={handleBulkPersist}
                                    disabled={!bulkItems.some(i => (i.newUrl || i.newFile) && i.status === 'pending')}
                                    className="bg-[#1b3a57] text-[#f5a800] px-10 py-3 rounded-2xl font-black text-sm flex items-center gap-3 hover:bg-[#132a41] transition-all shadow-lg hover:shadow-xl disabled:opacity-30"
                                >
                                    <ImageIcon size={18} /> 🚀 Sincronizar Todo al Catálogo
                                </button>
                            )}
                            {bulkProgress.active && (
                                <div className="flex items-center gap-2 bg-emerald-50 text-emerald-600 px-6 py-3 rounded-2xl font-black text-xs uppercase animate-pulse border border-emerald-100">
                                    <RefreshCw size={14} className="animate-spin" /> Procesando en segundo plano...
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* BARRA DE PROGRESO FLOTANTE (SEGUNDO PLANO) */}
            {bulkProgress.active && (
                <div 
                    style={{ position: 'fixed', bottom: '100px', right: '24px', width: '300px', background: 'white', borderRadius: '16px', padding: '16px', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)', zIndex: 10002, border: '1px solid #eef2f6' }}
                    className="animate-in slide-in-from-right duration-300"
                >
                    <div className="flex justify-between items-center mb-3">
                        <span className="font-black text-[10px] uppercase text-[#1b3a57] tracking-widest flex items-center gap-2">
                            <RefreshCw size={12} className="animate-spin text-[#f07d2a]" /> En segundo plano
                        </span>
                        <button 
                            onClick={() => {
                                stopRef.current = true;
                                setBulkProgress(prev => ({ ...prev, active: false }));
                            }}
                            className="bg-red-50 text-red-500 p-1.5 rounded-full hover:bg-red-100 transition-colors"
                            title="Detener sincronización"
                        >
                            <X size={14} />
                        </button>
                    </div>
                    
                    <div className="flex justify-between items-center mb-2">
                        <span className="font-bold text-xs text-slate-600">Sincronizando: {bulkProgress.current}/{bulkProgress.total}</span>
                        <span className="font-black text-[11px] text-[#f07d2a]">{Math.round((bulkProgress.current / (bulkProgress.total || 1)) * 100)}%</span>
                    </div>

                    <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div className="bg-[#f07d2a] h-full transition-all duration-300" style={{ width: `${(bulkProgress.current / (bulkProgress.total || 1)) * 100}%` }}></div>
                    </div>
                    
                    <div className="flex gap-2 mt-4">
                        <button 
                            onClick={() => setIsBulkEditing(true)}
                            className="flex-1 py-2 border border-slate-100 hover:bg-slate-50 rounded-xl text-[10px] font-black uppercase text-slate-400 transition-colors"
                        >
                            Ver detalle
                        </button>
                        {bulkItems.some(i => i.status === 'success') && (
                            <button 
                                onClick={() => {
                                    const remaining = bulkItems.filter(i => i.status !== 'success');
                                    setBulkItems(remaining);
                                    setBulkProgress(prev => ({
                                        ...prev,
                                        current: remaining.filter(i => i.status === 'error').length,
                                        total: remaining.length,
                                        active: remaining.length > 0
                                    }));
                                }}
                                className="px-3 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-100 transition-colors"
                                title="Limpiar ítems terminados"
                            >
                                Limpiar
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* DETECTOR DE IMÁGENES (Image Picker) */}
            {foundImages.length > 0 && (
                <div 
                    style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.75)', backdropFilter: 'blur(4px)', zIndex: 10005, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
                    onClick={() => setFoundImages([])}
                >
                    <div 
                        className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in duration-200"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="bg-[#1b3a57] p-6 text-white flex justify-between items-center">
                            <div>
                                <h3 className="font-black uppercase text-lg flex items-center gap-3">
                                    <ImageIcon size={20} className="text-[#f5a800]" /> ¿Cuál de estas imágenes deseas usar?
                                </h3>
                                <p className="text-white/60 text-[10px] uppercase font-bold mt-1">Hemos detectado {foundImages.length} imágenes en el link proporcionado</p>
                            </div>
                            <button onClick={() => setFoundImages([])} className="text-white/40 hover:text-white p-2">
                                <X size={24} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto bg-slate-50 flex-1">
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '16px' }}>
                                {foundImages.map((u, i) => (
                                    <div 
                                        key={i}
                                        onClick={() => {
                                            if (scanningForItem === 'single') {
                                                handleImagePersist(editingImageItem, u);
                                            } else {
                                                setBulkItems(prev => prev.map(bi => bi.product_id === scanningForItem.product_id ? { ...bi, newUrl: u, newFile: null } : bi));
                                            }
                                            setFoundImages([]);
                                        }}
                                        className="bg-white p-2 rounded-xl shadow-sm border-2 border-transparent hover:border-[#f5a800] hover:scale-105 transition-all cursor-pointer group flex flex-col"
                                    >
                                        <div className="aspect-[3/4] bg-slate-100 rounded-lg overflow-hidden mb-2 relative">
                                            <img src={u} alt="" className="w-full h-full object-cover" loading="lazy" />
                                            <div className="absolute inset-0 bg-[#1b3a57]/0 group-hover:bg-[#1b3a57]/20 transition-all flex items-center justify-center">
                                                <div className="bg-[#f5a800] text-[#1b3a57] font-black text-[9px] px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-lg">ELEGIR</div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* SMART SYNC MODAL */}
            {isSmartSyncOpen && (
                <div 
                    style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.85)', backdropFilter: 'blur(8px)', zIndex: 10100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}
                >
                    <div 
                        className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[90vh]"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="bg-[#1b3a57] p-6 text-white flex justify-between items-center">
                            <div>
                                <h3 className="font-black uppercase text-xl flex items-center gap-3">
                                    <RotateCcw size={24} className="text-[#f5a800]" /> Sincronizador Experto
                                </h3>
                                <p className="text-white/60 text-xs mt-1 font-bold tracking-wider uppercase">Extracción masiva mediante código fuente (Ctrl+U)</p>
                            </div>
                            <button onClick={() => { setIsSmartSyncOpen(false); setShowExpertMode(false); }} className="text-white/40 hover:text-white p-2">
                                <X size={28} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto bg-slate-50 relative min-h-[400px]">
                            {smartMatches.length === 0 && !isScanning && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center bg-slate-50 z-10">
                                    <div className="max-w-2xl mx-auto flex flex-col items-center">
                                        <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 mb-6 w-full flex flex-col gap-4">
                                            <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="bg-amber-100 text-amber-600 p-2 rounded-xl">
                                                        <RotateCcw size={18} />
                                                    </div>
                                                    <h4 className="font-black text-[#1b3a57] text-sm uppercase tracking-tight">Filtro de Editorial para Match</h4>
                                                </div>
                                                <select 
                                                    value={selectedSyncEditorial}
                                                    onChange={(e) => setSelectedSyncEditorial(e.target.value)}
                                                    className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-xs font-black text-[#1b3a57] outline-none focus:ring-2 focus:ring-[#f5a800] transition-all"
                                                >
                                                    <option value="TODOS">🔍 Todas las Editoriales</option>
                                                    {editorialesList.map(ed => (
                                                        <option key={ed} value={ed}>{ed}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase">Paso 1</span>
                                                    <p className="text-[11px] font-bold text-slate-600 leading-tight">Abre la web (ej: Ivrea)</p>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase">Paso 2</span>
                                                    <p className="text-[11px] font-bold text-slate-600 leading-tight">Pulsa <code className="bg-slate-100 px-1 rounded text-[#f07d2a]">Ctrl+U</code></p>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase">Paso 3</span>
                                                    <p className="text-[11px] font-bold text-slate-600 leading-tight"><code className="bg-slate-100 px-1 rounded text-[#f07d2a]">Ctrl+A</code> y <code className="bg-slate-100 px-1 rounded text-[#f07d2a]">Ctrl+C</code></p>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <span className="text-[10px] font-black text-slate-400 uppercase">Paso 4</span>
                                                    <p className="text-[11px] font-bold text-slate-600 leading-tight">Pega abajo y procesa</p>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <textarea 
                                            className="w-full bg-white border-2 border-slate-200 rounded-3xl p-6 font-mono text-[11px] outline-none focus:border-[#f5a800] transition-colors resize-none shadow-inner mb-6 min-h-[180px]"
                                            placeholder="Pega aquí el código fuente (HTML)..."
                                            value={rawHtmlInput}
                                            onChange={(e) => setRawHtmlInput(e.target.value)}
                                        ></textarea>
                                        
                                        <button 
                                            onClick={() => processRawHtml(rawHtmlInput)}
                                            disabled={!rawHtmlInput.trim() || isScanning}
                                            className="bg-[#f5a800] text-[#1b3a57] px-12 py-4 rounded-2xl font-black uppercase text-sm shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all disabled:opacity-30 flex items-center gap-3"
                                        >
                                            {isScanning ? <RefreshCw size={18} className="animate-spin" /> : <RotateCcw size={18} />}
                                            Procesar Código y Sincronizar
                                        </button>
                                    </div>
                                </div>
                            )}

                            {isScanning && (
                                <div className="absolute inset-0 flex flex-col items-center justify-center p-20 text-center bg-white/80 backdrop-blur-sm z-20">
                                    <RefreshCw size={48} className="animate-spin text-[#f5a800] mb-4" />
                                    <h4 className="text-xl font-black text-[#1b3a57]">Procesando código localmente...</h4>
                                    <p className="text-slate-400 max-w-md mx-auto mt-2">Estamos identificando las imágenes y buscando mejores coincidencias. Esto es instantáneo.</p>
                                </div>
                            )}

                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {smartMatches.map((match, idx) => (
                                    <div key={idx} className={`bg-white rounded-2xl p-4 shadow-sm border-2 transition-all flex flex-col gap-4 ${match.selected ? 'border-[#f5a800] ring-4 ring-[#f5a800]/10' : 'border-transparent'}`}>
                                        <div className="flex gap-4">
                                            <div className="w-24 h-32 rounded-lg overflow-hidden bg-slate-100 shrink-0 border border-slate-200">
                                                <img 
                                                    src={`https://images.weserv.nl/?url=${encodeURIComponent(match.extUrl.replace(/^https?:\/\//, ''))}&w=200&h=300&fit=cover`} 
                                                    className="w-full h-full object-cover" 
                                                    alt="" 
                                                />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-center mb-1">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Extraído:</p>
                                                    <div className="flex gap-1">
                                                        {match.confidence === 'high' && <span className="text-[9px] font-black text-emerald-500 bg-emerald-50 px-2 py-0.5 rounded-full">MUY SEGURO</span>}
                                                        {match.confidence === 'medium' && <span className="text-[9px] font-black text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full">POSIBLE</span>}
                                                        {match.confidence === 'none' && <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">BAJA COINCIDENCIA</span>}
                                                        <button 
                                                            onClick={() => {
                                                                setManualSearchIdx(idx);
                                                                setManualSearchQuery('');
                                                            }}
                                                            className="text-[9px] font-black bg-[#1b3a57] text-white px-2 py-0.5 rounded-full hover:bg-[#f5a800] transition-colors flex items-center gap-1"
                                                            title="Vincular manualmente otro producto"
                                                        >
                                                            <Search size={10} /> BUSCAR
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="font-bold text-xs text-[#1b3a57] leading-tight line-clamp-2 mb-3">{match.extLabel}</p>
                                                
                                                {manualSearchIdx === idx ? (
                                                    <div className="bg-slate-100 p-2 rounded-xl border border-[#1b3a57]/10 animate-in fade-in zoom-in duration-200">
                                                        <div className="flex gap-2 mb-2">
                                                            <input 
                                                                autoFocus
                                                                type="text" 
                                                                placeholder="Escribe título o ID..."
                                                                value={manualSearchQuery}
                                                                onChange={(e) => setManualSearchQuery(e.target.value)}
                                                                className="flex-1 text-[10px] bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-[#f5a800]"
                                                            />
                                                            <button 
                                                                onClick={() => setManualSearchIdx(null)}
                                                                className="text-[10px] font-black text-red-500 p-1"
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                        {manualSearchQuery.length >= 3 && (
                                                            <div className="max-h-32 overflow-y-auto flex flex-col gap-1">
                                                                {catalogData
                                                                    .filter(p => (p.titulo || '').toLowerCase().includes(manualSearchQuery.toLowerCase()) || (p.product_id || '').toLowerCase().includes(manualSearchQuery.toLowerCase()))
                                                                    .slice(0, 10)
                                                                    .map(p => (
                                                                        <button 
                                                                            key={p.product_id}
                                                                            onClick={() => {
                                                                                setSmartMatches(prev => prev.map((m, mIdx) => mIdx === idx ? { 
                                                                                    ...m, 
                                                                                    catalogItem: p, 
                                                                                    score: 100, 
                                                                                    confidence: 'high',
                                                                                    selected: true 
                                                                                } : m));
                                                                                setManualSearchIdx(null);
                                                                            }}
                                                                            className="text-left py-1.5 px-2 hover:bg-white rounded-lg text-[9px] font-bold text-slate-600 transition-colors border border-transparent hover:border-slate-200"
                                                                        >
                                                                            {p.titulo} <span className="text-[8px] text-slate-300">({p.product_id})</span>
                                                                        </button>
                                                                    ))
                                                                }
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <>
                                                        {match.catalogItem ? (
                                                            <div className={`p-3 rounded-xl border ${match.confidence === 'high' ? 'bg-emerald-50 border-emerald-100' : 'bg-amber-50 border-amber-100'}`}>
                                                                <p className={`text-[10px] font-black uppercase mb-1 ${match.confidence === 'high' ? 'text-emerald-400' : 'text-amber-400'}`}>Match ({Math.round(match.score)}%):</p>
                                                                <p className="font-black text-[11px] text-[#1b3a57] line-clamp-2">{match.catalogItem.titulo}</p>
                                                            </div>
                                                        ) : (
                                                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 italic text-[10px] text-slate-400 font-bold">
                                                                Sin recomendación ({Math.round(match.score)}%)
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="mt-auto flex items-center justify-between pt-2 border-t border-slate-50">
                                            <button 
                                                onClick={() => {
                                                    setSmartMatches(prev => prev.map((m, i) => i === idx ? { ...m, selected: !m.selected } : m));
                                                }}
                                                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${match.selected ? 'bg-[#f5a800] text-[#1b3a57]' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                            >
                                                {match.selected ? '✓ Seleccionado' : 'Vincular Foto'}
                                            </button>
                                            {match.catalogItem?.imagen_url && (
                                                <span className="text-[9px] font-black text-amber-600 bg-transparent border border-amber-200 px-2 py-1 rounded-md">YA TIENE IMAGEN</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="p-6 bg-white border-t flex justify-between items-center shadow-2xl">
                            <div className="flex flex-col gap-2">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                    {smartMatches.filter(m => m.selected).length} de {smartMatches.length} SELECCIONADOS
                                </p>
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => handleBulkSelect('ALL')} 
                                        className="text-[9px] font-black uppercase text-[#1b3a57] border border-slate-200 px-2 py-1 rounded-md hover:bg-slate-50 transition-colors shadow-sm"
                                    >
                                        Seleccionar Todo
                                    </button>
                                    <button 
                                        onClick={() => handleBulkSelect('NONE')} 
                                        className="text-[9px] font-black uppercase text-slate-400 border border-slate-100 px-2 py-1 rounded-md hover:bg-slate-50 transition-colors"
                                    >
                                        Deseleccionar
                                    </button>
                                    <button 
                                        onClick={() => handleBulkSelect('HIGH_CONFIDENCE')} 
                                        className="text-[9px] font-black uppercase text-emerald-600 border border-emerald-100 bg-emerald-50 px-2 py-1 rounded-md hover:bg-emerald-100 transition-all shadow-sm"
                                    >
                                        Solo Confianza Alta
                                    </button>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <button 
                                    onClick={() => {
                                        if (smartMatches.length > 0) {
                                            setSmartMatches([]);
                                            setShowExpertMode(true);
                                        } else {
                                            setIsSmartSyncOpen(false);
                                        }
                                    }} 
                                    className="px-6 py-3 font-black text-sm text-slate-400 hover:bg-slate-50 rounded-2xl transition-colors"
                                >
                                    {smartMatches.length > 0 ? 'Limpiar y Volver' : 'Cancelar'}
                                </button>
                                <button 
                                    onClick={handleSmartPersist}
                                    disabled={smartMatches.filter(m => m.selected).length === 0}
                                    className="bg-[#1b3a57] text-[#f5a800] px-10 py-3 rounded-2xl font-black text-sm flex items-center gap-3 hover:bg-[#132a41] transition-all shadow-lg disabled:opacity-30"
                                >
                                    <RotateCcw size={18} /> Sincronizar Seleccionados
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CatalogUpdatedView;
