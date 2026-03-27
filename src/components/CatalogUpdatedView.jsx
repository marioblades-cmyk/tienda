import React, { useState, useEffect, useMemo } from 'react';
import { Database, Search, Filter, RefreshCw, CheckCircle2, AlertCircle, Info, RotateCcw, ShoppingCart } from 'lucide-react';
import { catalogService } from '../services/catalogService';
import { useAuth } from '../hooks/useAuth';

const CatalogUpdatedView = () => {
    const { isAdmin } = useAuth();
    // ESTADOS
    const [catalogData, setCatalogData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [editorialFilter, setEditorialFilter] = useState('TODOS');
    const [categoryFilter, setCategoryFilter] = useState('TODOS');
    const [reprintsOnlyFilter, setReprintsOnlyFilter] = useState(false);
    const [editorialesList, setEditorialesList] = useState([]);
    const [itemsToShow, setItemsToShow] = useState(50);
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedForQuote, setSelectedForQuote] = useState(new Set());

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
        try {
            const results = await catalogService.fetchFullCatalog(force);
            setCatalogData(results);
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

            return true;
        });

        return {
            filteredItems: filtered,
            counts: {
                total: catalogData.length,
                visible: filtered.length
            }
        };
    }, [catalogData, editorialFilter, categoryFilter, debouncedSearch, reprintsOnlyFilter]);

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
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>Producto</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>EAN (Limpio)</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>Editorial</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9' }}>Categoría</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>Precio Tapa</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#f07d2a', fontWeight: 800, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>G PV (BS)</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#16a34a', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>N1 -10%</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#2563eb', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>N2 -15%</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#7c3aed', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>N3 -20%</th>
                                <th style={{ padding: '1.25rem 1rem', color: '#334155', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '2px solid #f1f5f9', textAlign: 'right' }}>Mayoreo</th>
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
                    <button
                        onClick={() => handleAddToQuote(catalogData.filter(i => selectedForQuote.has(i.product_id)))}
                        style={{ background: '#f07d2a', color: 'white', borderRadius: '999px', padding: '6px 18px', fontWeight: 800, fontSize: '13px', border: 'none', cursor: 'pointer' }}
                    >
                        Agregar a Cotización ➡
                    </button>
                    <button
                        onClick={() => setSelectedForQuote(new Set())}
                        style={{ opacity: 0.5, cursor: 'pointer', background: 'none', border: 'none', color: 'white', fontSize: '16px' }}
                        title="Deseleccionar todo"
                    >✕</button>
                </div>
            )}
        </div>
    );
};

export default CatalogUpdatedView;
