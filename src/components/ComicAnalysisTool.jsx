import React, { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { Download, RefreshCw, CheckCircle, AlertTriangle, XCircle, Database, ArrowUpCircle } from 'lucide-react';
import { SHEET_PROCESSORS } from '../utils/excelProcessors';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useAuth';
import './ComicAnalysisTool.css';

const ComicAnalysisTool = () => {
    const { user, profile, isAdmin } = useAuth();
    const [viewMode, setViewMode] = useState('upload'); // 'upload', 'results', 'catalog'
    const [sheetsData, setSheetsData] = useState({});
    const [dbCatalog, setDbCatalog] = useState({}); // Indexed by product_id
    const [activeTab, setActiveTab] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedSheets, setExpandedSheets] = useState({}); // Tracking expanded detail rows
    const [filterCategory, setFilterCategory] = useState('TODOS');
    const [filterEanStatus, setFilterEanStatus] = useState('TODOS');
    const [filterReimpresion, setFilterReimpresion] = useState(false);
    const [filterCatEditorial, setFilterCatEditorial] = useState('TODOS');
    const [filterCatCategory, setFilterCatCategory] = useState('TODOS');
    const [itemsAusentes, setItemsAusentes] = useState({}); // { editorialName: [items] }
    const fileInputRef = useRef(null);

    // Cargar catálogo existente al iniciar
    React.useEffect(() => {
        fetchCatalog();
    }, []);

    const fetchCatalog = async () => {
        try {
            let allData = [];
            let from = 0;
            const step = 1000;
            let hasMore = true;

            while (hasMore) {
                const { data, error } = await supabase
                    .from('catalogo_productos')
                    .select('*')
                    .range(from, from + step - 1);

                if (error) throw error;

                if (data && data.length > 0) {
                    allData = [...allData, ...data];
                    from += step;
                    // If we got less than the step, we reached the end
                    if (data.length < step) hasMore = false;
                } else {
                    hasMore = false;
                }
            }

            // Indexar por product_id para búsqueda rápida O(1)
            const indexed = {};
            allData.forEach(item => {
                indexed[item.product_id] = item;
            });
            setDbCatalog(indexed);
        } catch (err) {
            console.error('Error cargando catálogo:', err);
            setError('Error al cargar el catálogo completo. Verifica tu conexión.');
        }
    };

    const handleFileUpload = (file) => {
        if (!file) return;
        setIsProcessing(true);
        setError(null);

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const wb = XLSX.read(data, { type: 'array' });

                const available = Object.keys(SHEET_PROCESSORS).filter(s => wb.SheetNames.includes(s));
                if (!available.length) {
                    throw new Error('No se encontró ninguna pestaña compatible (Ivrea, Ovnipress, Panini, etc.).');
                }

                const newSheetsData = {};
                for (const sheetName of available) {
                    const ws = wb.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
                    const result = SHEET_PROCESSORS[sheetName](rows);

                    // Comparación con BD
                    result.items = result.items.map(item => {
                        const dbMatch = dbCatalog[item.product_id];
                        let comparison = 'sin_cambios';
                        if (!dbMatch) {
                            comparison = 'nuevo';
                        } else if (Number(item.precio_tapa) !== Number(dbMatch.precio_tapa)) {
                            comparison = 'cambio_precio';
                        }
                        return { ...item, editorial: sheetName, comparison, db_price: dbMatch?.precio_tapa };
                    });

                    // Recalcular rersumen de cambios
                    result.report.cambios = {
                        nuevos: result.items.filter(i => i.comparison === 'nuevo').length,
                        precios: result.items.filter(i => i.comparison === 'cambio_precio').length
                    };

                    newSheetsData[sheetName] = result;
                }

                // DETECTAR AUSENCIAS (Items en catálogo que no están en el Excel actual)
                const allProcessedEans = new Set();
                Object.values(newSheetsData).forEach(sheet => {
                    sheet.items.forEach(item => {
                        if (item.ean_final) allProcessedEans.add(item.ean_final);
                        if (item.ean_oficial) allProcessedEans.add(item.ean_oficial);
                        if (item.ean_interno) allProcessedEans.add(item.ean_interno);
                        if (item.product_id) allProcessedEans.add(item.product_id); // Also check product_id
                    });
                });

                const newItemsAusentes = {};
                const activeEditoriales = new Set(Object.keys(newSheetsData));

                Object.values(dbCatalog).forEach(dbItem => {
                    // Solo comparamos ausentes de las editoriales que SÍ vienen en el excel actual
                    if (activeEditoriales.has(dbItem.editorial)) {
                        const itemIdentifiers = [dbItem.ean_oficial, dbItem.ean_interno, dbItem.product_id].filter(Boolean);
                        const isPresent = itemIdentifiers.some(id => allProcessedEans.has(id));

                        if (!isPresent) {
                            if (!newItemsAusentes[dbItem.editorial]) newItemsAusentes[dbItem.editorial] = [];
                            newItemsAusentes[dbItem.editorial].push(dbItem);
                        }
                    }
                });

                setItemsAusentes(newItemsAusentes);
                setSheetsData(newSheetsData);
                const firstAvailable = Object.keys(newSheetsData)[0];
                setActiveTab(firstAvailable);
                setViewMode('results');
                setIsProcessing(false);
            } catch (err) {
                console.error('Error procesando archivo:', err);
                setError(err.message);
                setIsProcessing(false);
            }
        };
        reader.onerror = () => {
            setError('Error al leer el archivo.');
            setIsProcessing(false);
        };
        reader.readAsArrayBuffer(file);
    };

    const handleSync = async () => {
        if (!isAdmin) {
            alert('Solo los administradores pueden sincronizar el catálogo.');
            return;
        }

        setIsSyncing(true);
        try {
            // Consolidar todos los items que tienen cambios (nuevos o precio distinto)
            const itemsToSync = [];
            const seenIds = new Set();
            let totalProcesados = 0;
            let nuevosDetectados = 0;
            let preciosActualizados = 0;

            Object.entries(sheetsData).forEach(([sheetName, data]) => {
                totalProcesados += data.items.length;
                data.items.forEach(item => {
                    if (item.comparison === 'nuevo') nuevosDetectados++;
                    if (item.comparison === 'cambio_precio') preciosActualizados++;

                    if (item.comparison !== 'sin_cambios' && !seenIds.has(item.product_id)) {
                        seenIds.add(item.product_id);
                        itemsToSync.push({
                            ...item,
                            editorial: item.editorial || sheetName
                        });
                    }
                });
            });

            if (itemsToSync.length === 0) {
                alert('No hay cambios pendientes para sincronizar.');
                return;
            }

            // Mapear al formato de la tabla SQL
            const payload = itemsToSync.map(i => ({
                product_id: i.product_id,
                titulo: i.titulo,
                ean_oficial: i.ean_oficial,
                ean_interno: i.ean_interno,
                precio_tapa: i.precio_tapa || 0,
                editorial: i.editorial,
                categoria: i.categoria_principal,
                updated_at: new Date().toISOString()
            }));

            // Supabase upsert por product_id
            const { error: syncErr } = await supabase
                .from('catalogo_productos')
                .upsert(payload, { onConflict: 'product_id' });

            if (syncErr) throw syncErr;

            // Log de la sincronización
            await supabase.from('catalogo_sync_logs').insert([{
                vendedor_id: user.id,
                total_procesados: totalProcesados,
                nuevos_detectados: nuevosDetectados,
                precios_actualizados: preciosActualizados
            }]);

            await fetchCatalog(); // Recargar base local

            // Marcar items como sincronizados localmente
            const updatedSheets = { ...sheetsData };
            Object.keys(updatedSheets).forEach(k => {
                updatedSheets[k].items = updatedSheets[k].items.map(i => ({ ...i, comparison: 'sin_cambios' }));
                updatedSheets[k].report.cambios = { nuevos: 0, precios: 0 };
            });
            setSheetsData(updatedSheets);

            alert('Catálogo sincronizado exitosamente.');
        } catch (err) {
            console.error('Error sincronizando:', err);
            alert('Error al sincronizar: ' + err.message);
        } finally {
            setIsSyncing(false);
        }
    };

    const handleDeleteFromMaster = async (itemId, editorial) => {
        if (!confirm("¿Seguro que deseas eliminar este item del Catálogo Maestro? Esta acción no se puede deshacer.")) return;

        try {
            const { error } = await supabase
                .from('catalogo_productos')
                .delete()
                .eq('product_id', itemId);

            if (error) throw error;

            // Actualizar estado local
            setDbCatalog(prev => {
                const next = { ...prev };
                delete next[itemId];
                return next;
            });

            setItemsAusentes(prev => ({
                ...prev,
                [editorial]: prev[editorial].filter(it => it.product_id !== itemId)
            }));

        } catch (err) {
            console.error("Error al borrar item:", err);
            alert("Error al borrar el item del maestro.");
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        handleFileUpload(file);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };

    const reset = () => {
        setSheetsData({});
        setActiveTab(null);
        setError(null);
        setViewMode('upload');
        setSearchTerm('');
        setFilterCategory('TODOS');
        setFilterEanStatus('TODOS');
        setFilterReimpresion(false);
        setFilterCatEditorial('TODOS');
        setFilterCatCategory('TODOS');
        setItemsAusentes({});
    };

    const exportCSV = () => {
        const d = sheetsData[activeTab];
        if (!d) return;
        const headers = ['product_id', 'titulo', 'categoria_principal', 'reimpresion_semana', 'ean_oficial', 'ean_interno', 'ean_final', 'ean_razon', 'precio_tapa', 'cantidad'];
        const rows = [headers.join(',')];
        for (const i of d.items) {
            rows.push([
                i.product_id, `"${(i.titulo || '').replace(/"/g, '""')}"`,
                i.categoria_principal || '',
                i.subetiquetas?.reimpresionSemana ? 1 : 0,
                i.ean_oficial || '', i.ean_interno || '', i.ean_final || '',
                i.ean_razon, i.precio_tapa ?? '', i.cantidad ?? ''
            ].join(','));
        }
        const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = activeTab + '_limpio.csv'; a.click();
        URL.revokeObjectURL(url);
    };

    const exportExcel = () => {
        const wb = XLSX.utils.book_new();
        // Iteramos sobre todas las pestañas procesadas
        for (const [sheetName, d] of Object.entries(sheetsData)) {
            const headers = ['Product ID', 'Título', 'Categoría', 'Reimpr. Semana', 'EAN Oficial', 'EAN Interno', 'EAN Final', 'Estado EAN', 'Precio Tapa', 'Cantidad'];
            const data = [headers, ...d.items.map(i => [
                i.product_id, i.titulo, i.categoria_principal || '',
                i.subetiquetas?.reimpresionSemana ? 'SÍ' : 'NO',
                i.ean_oficial || '', i.ean_interno || '', i.ean_final || '',
                i.ean_razon, i.precio_tapa, i.cantidad
            ])];
            const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!cols'] = [15, 50, 25, 8, 15, 15, 15, 20, 12, 8].map(w => ({ wch: w }));
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
        XLSX.writeFile(wb, 'entelequia_limpio.xlsx');
    };

    const currentSheet = activeTab ? sheetsData[activeTab] : null;

    // Consolidar items para filtrado
    const getFilteredItems = () => {
        let pool = [];
        if (activeTab === 'TODOS_RESUMEN') {
            Object.values(sheetsData).forEach(d => {
                pool = [...pool, ...d.items];
            });
        } else if (activeTab && sheetsData[activeTab]) {
            pool = sheetsData[activeTab].items;
        }

        return pool.filter(item => {
            const matchSearch = (item.titulo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (item.ean_final || '').includes(searchTerm);
            const matchCat = filterCategory === 'TODOS' || item.categoria_principal === filterCategory;
            const matchEan = filterEanStatus === 'TODOS' || item.ean_razon === filterEanStatus;
            const matchReimpr = !filterReimpresion || item.subetiquetas?.reimpresionSemana;

            return matchSearch && matchCat && matchEan && matchReimpr;
        });
    };

    const displayItems = getFilteredItems();

    // Obtener categorías únicas del pool actual
    const availableCategories = activeTab === 'TODOS_RESUMEN'
        ? [...new Set(Object.values(sheetsData).flatMap(d => d.items.map(i => i.categoria_principal)))]
        : (currentSheet ? [...new Set(currentSheet.items.map(i => i.categoria_principal))] : []);

    return (
        <div className="comic-tool-container animate-in fade-in duration-500">
            {/* ── HEADER ── */}
            <header className="comic-header">
                <div className="comic-logo-badge">ENTELEQUIA</div>
                <h1>Resumen de <span>Limpieza</span></h1>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    {Object.keys(sheetsData).length > 0 && viewMode === 'results' && (
                        <button
                            className="comic-btn-ghost"
                            style={{ borderColor: 'white', color: 'white', fontSize: '0.7rem' }}
                            onClick={() => { setViewMode('catalog'); fetchCatalog(); }}
                        >
                            <Database size={14} className="inline mr-1" /> VER CATÁLOGO MAESTRO
                        </button>
                    )}
                    {viewMode === 'catalog' && (
                        <button
                            className="comic-btn-ghost"
                            style={{ borderColor: 'white', color: 'white', fontSize: '0.7rem' }}
                            onClick={() => setViewMode(Object.keys(sheetsData).length > 0 ? 'results' : 'upload')}
                        >
                            ↩ VOLVER AL RESUMEN
                        </button>
                    )}
                    <div style={{ opacity: 0.6, fontSize: '0.8rem', fontFamily: 'var(--font-comic-mono)' }}>
                        v2.1 · Multi-Editorial
                    </div>
                </div>
            </header>

            {isProcessing ? (
                <div className="flex flex-col items-center justify-center py-20">
                    <div className="w-12 h-12 border-4 border-comic-primary border-t-comic-accent rounded-full animate-spin"></div>
                    <p className="mt-4 font-comic-body font-bold text-comic-primary">PROCESANDO EXCEL...</p>
                </div>
            ) : viewMode === 'catalog' ? (
                /* ── CATALOG VIEWER ── */
                <div className="animate-in fade-in duration-500">
                    <div className="comic-header" style={{ marginBottom: '1.5rem', background: 'var(--comic-background)', color: 'var(--comic-primary)', border: '2px solid var(--comic-primary)', padding: '1rem 2rem' }}>
                        <Database size={32} />
                        <div>
                            <h2 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-comic-display)' }}>Visor de Catálogo Maestro</h2>
                            <p style={{ fontSize: '0.8rem', opacity: 0.7 }}>Explora los productos guardados en tu base de datos</p>
                        </div>
                        <button className="comic-btn-ghost ml-auto" onClick={reset}>
                            ↩ VOLVER AL INICIO
                        </button>
                    </div>

                    {error && (
                        <div className="mb-6 p-4 bg-comic-destructive/10 border border-comic-destructive text-comic-destructive rounded-lg font-comic-body font-bold flex items-center gap-3">
                            <AlertTriangle size={20} /> {error}
                        </div>
                    )}

                    {/* UNIFIED FILTERS BAR */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 bg-comic-muted/20 p-4 rounded-xl border-2 border-comic-border">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold opacity-50 ml-1 uppercase">Búsqueda rápida</label>
                            <input
                                type="text"
                                className="p-2 bg-white border-2 border-comic-border rounded-lg font-comic-mono text-xs focus:border-comic-accent outline-none"
                                placeholder="Título o EAN..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold opacity-50 ml-1 uppercase">Editorial</label>
                            <select
                                className="p-2 bg-white border-2 border-comic-border rounded-lg font-comic-mono text-xs focus:border-comic-accent outline-none"
                                value={filterCatEditorial}
                                onChange={(e) => {
                                    setFilterCatEditorial(e.target.value);
                                    setFilterCatCategory('TODOS');
                                }}
                            >
                                <option value="TODOS">Todas las Editoriales</option>
                                {[...new Set(Object.values(dbCatalog).map(i => i.editorial))].filter(Boolean).sort().map(ed => (
                                    <option key={ed} value={ed}>{ed}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold opacity-50 ml-1 uppercase">Categoría</label>
                            <select
                                className="p-2 bg-white border-2 border-comic-border rounded-lg font-comic-mono text-xs focus:border-comic-accent outline-none"
                                value={filterCatCategory}
                                onChange={(e) => setFilterCatCategory(e.target.value)}
                            >
                                <option value="TODOS">Todas las Categorías</option>
                                {[...new Set(Object.values(dbCatalog)
                                    .filter(item => filterCatEditorial === 'TODOS' || item.editorial === filterCatEditorial)
                                    .map(i => i.categoria))]
                                    .filter(Boolean).sort().map(cat => (
                                        <option key={cat} value={cat}>{cat}</option>
                                    ))}
                            </select>
                        </div>
                    </div>

                    <div className="p-2 flex justify-end">
                        <div className="font-comic-mono text-xs opacity-60">
                            {Object.values(dbCatalog).length.toLocaleString()} items totales en base de datos
                        </div>
                    </div>

                    {/* DB TABLE */}
                    <div className="comic-table-container">
                        {(() => {
                            const filtered = Object.values(dbCatalog).filter(item => {
                                const matchEd = filterCatEditorial === 'TODOS' || item.editorial === filterCatEditorial;
                                const matchCat = filterCatCategory === 'TODOS' || item.categoria === filterCatCategory;
                                const matchSearch = (item.titulo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                                    (item.product_id || '').includes(searchTerm) ||
                                    (item.ean_oficial || '').includes(searchTerm) ||
                                    (item.ean_interno || '').includes(searchTerm);
                                return matchEd && matchCat && matchSearch;
                            });

                            const displayItems = filtered.slice(0, 500);

                            return (
                                <>
                                    <table className="comic-table">
                                        <thead>
                                            <tr>
                                                <th>EDITORIAL</th>
                                                <th>TÍTULO / MANGA</th>
                                                <th>EAN FINAL</th>
                                                <th style={{ textAlign: 'right' }}>PRECIO MASTER</th>
                                                <th style={{ textAlign: 'right' }}>ACCIONES</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {displayItems.map((item) => (
                                                <tr key={item.product_id}>
                                                    <td style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.6 }}>{item.editorial}</td>
                                                    <td style={{ fontWeight: '700' }}>{item.titulo}</td>
                                                    <td className="font-mono">{item.ean_oficial || item.ean_interno}</td>
                                                    <td className="font-mono" style={{ textAlign: 'right', fontWeight: '800', color: 'var(--comic-accent)' }}>
                                                        ${item.precio_tapa?.toLocaleString()}
                                                    </td>
                                                    <td style={{ textAlign: 'right' }}>
                                                        <button className="text-secondary underline font-bold" style={{ fontSize: '0.75rem' }}>VER FICHA</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <div className="p-4 bg-comic-muted text-center text-xs font-comic-body border-t-2 border-comic-border">
                                        {filtered.length > 500 ? (
                                            <span className="text-comic-accent font-bold">
                                                Mostrando 500 de {filtered.length.toLocaleString()} resultados encontrados.
                                                Usa la búsqueda para refinar.
                                            </span>
                                        ) : (
                                            <span>Mostrando {filtered.length.toLocaleString()} resultados.</span>
                                        )}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            ) : viewMode === 'upload' || !Object.keys(sheetsData).length ? (
                /* ── DROP ZONE ── */
                <>
                    {error && (
                        <div className="mb-6 p-4 bg-comic-destructive/10 border border-comic-destructive text-comic-destructive rounded-lg font-comic-body font-bold flex items-center gap-3">
                            <XCircle size={20} /> {error}
                        </div>
                    )}
                    <div
                        className="comic-drop-zone"
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <span className="comic-drop-icon">📂</span>
                        <h2>Subí el Excel del distribuidor</h2>
                        <p>Arrastrá el archivo acá o hacé clic para buscarlo</p>
                        <div style={{ marginTop: '1.5rem' }}>
                            <span className="highlight-word">Procesa 10+ editoriales en segundos</span>
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={(e) => handleFileUpload(e.target.files[0])}
                            accept=".xlsx, .xls"
                            className="hidden"
                        />
                        <div className="flex justify-center gap-4" style={{ marginTop: '2rem' }}>
                            <button className="comic-btn-primary" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                                📁 SELECCIONAR ARCHIVO
                            </button>
                            <button
                                className="comic-btn-ghost"
                                style={{ borderColor: 'var(--comic-primary)', color: 'var(--comic-primary)' }}
                                onClick={(e) => { e.stopPropagation(); setViewMode('catalog'); fetchCatalog(); }}
                            >
                                <Database size={18} className="inline mr-2" /> EXPLORAR CATÁLOGO MAESTRO
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                /* ── RESULTS VIEW ── */
                <div className="animate-in slide-in-from-bottom-4 duration-500">
                    {/* ── SUMMARY BAR (Global) ── */}
                    {/* ── SUMMARY BAR (Global Redesigned) ── */}
                    <div className="comic-summary-section">
                        <table className="comic-resumen-table high-fidelity">
                            <thead>
                                <tr>
                                    <th>EDITORIAL</th>
                                    <th className="num">EN EXCEL</th>
                                    <th className="num">PROCESADOS</th>
                                    <th className="num">ELIMINADOS</th>
                                    <th className="num">EAN VÁLIDOS</th>
                                    <th className="num">EAN INTERNOS</th>
                                    <th>CAMBIOS</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(sheetsData).map(([name, d]) => {
                                    const r = d.report;
                                    const isExpanded = expandedSheets[name];
                                    const eanValidos = (r.titulos_unicos || 0) - (r.ean_creados_total || 0);
                                    const eliminadosCount = r.eliminados?.length || 0;

                                    // Semaforo logic (High Fidelity Colors)
                                    let semaforoClass = 'bg-comic-green'; // Default
                                    if (r.ean_creados_total > 0) semaforoClass = 'bg-comic-yellow';
                                    if (r.cambios?.precios > 0) semaforoClass = 'bg-comic-orange';
                                    if (r.cambios?.nuevos > 0) semaforoClass = 'bg-comic-blue';
                                    if (r.ean_creados_por_razon?.ean_invalido > 0) semaforoClass = 'bg-comic-destructive';

                                    return (
                                        <React.Fragment key={name}>
                                            <tr
                                                className={`cursor-pointer hover:bg-comic-cream/20 ${activeTab === name ? 'active-row' : ''}`}
                                                onClick={() => {
                                                    setActiveTab(name);
                                                    setExpandedSheets(prev => ({ ...prev, [name]: !prev[name] }));
                                                }}
                                            >
                                                <td>
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-3 h-3 rounded-full shadow-sm ${semaforoClass}`}></div>
                                                        <span className="font-bold">{name}</span>
                                                        <span className="text-[10px] opacity-40 ml-1">
                                                            {isExpanded ? '▼' : '▶'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="num opacity-60">{(r.total_filas_crudas || 0).toLocaleString()}</td>
                                                <td className="num font-bold">{(r.titulos_unicos || 0).toLocaleString()}</td>
                                                <td className="num font-bold text-comic-destructive">
                                                    {eliminadosCount > 0 ? `-${eliminadosCount}` : '—'}
                                                </td>
                                                <td className="num text-comic-green font-bold">{eanValidos.toLocaleString()}</td>
                                                <td className="num text-comic-yellow font-bold">{(r.ean_creados_total || 0).toLocaleString()}</td>
                                                <td>
                                                    <div className="flex gap-1 justify-end flex-wrap">
                                                        {r.cambios?.nuevos > 0 && <span className="comic-badge comic-badge-new font-mono">{r.cambios.nuevos} nuevos</span>}
                                                        {r.cambios?.precios > 0 && <span className="comic-badge comic-badge-price font-mono">{r.cambios.precios} Δ precio</span>}
                                                        {(!r.cambios?.nuevos && !r.cambios?.precios) && (
                                                            <div className="flex gap-1">
                                                                {r.duplicados_exactos_eliminados > 0 && <span className="comic-badge opacity-40 font-mono" style={{ background: 'rgba(255,100,0,0.1)' }}>{r.duplicados_exactos_eliminados} repetidos</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && r.eliminados?.length > 0 && (
                                                <tr className="bg-black/5">
                                                    <td colSpan="7" className="p-0 border-none">
                                                        <div className="p-4 bg-comic-dark/40 border-l-4 border-comic-accent">
                                                            {/* Group by Reason */}
                                                            {Array.from(new Set(r.eliminados.map(e => e.motivo))).map(motivo => (
                                                                <div key={motivo} className="mb-3 last:mb-0">
                                                                    <div className="text-[10px] uppercase font-bold text-comic-accent/60 mb-2 flex items-center gap-2">
                                                                        <div className="h-[2px] w-2 bg-comic-accent/40"></div>
                                                                        {motivo} ({r.eliminados.filter(e => e.motivo === motivo).length})
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                                                        {r.eliminados.filter(e => e.motivo === motivo).slice(0, 10).map((e, idx) => (
                                                                            <div key={idx} className="flex justify-between text-[11px] font-comic-mono opacity-80 border-b border-white/5 pb-1">
                                                                                <span className="truncate max-w-[200px]">{e.titulo}</span>
                                                                                <span className="text-[10px] opacity-40">{e.ean || 'S/D'}</span>
                                                                            </div>
                                                                        ))}
                                                                        {r.eliminados.filter(e => e.motivo === motivo).length > 10 && (
                                                                            <div className="text-[10px] italic opacity-40 mt-1">... y {r.eliminados.filter(e => e.motivo === motivo).length - 10} más</div>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                            {/* TOTAL ROW */}
                            <tfoot className="bg-comic-primary/10 font-bold border-t-2 border-comic-border">
                                <tr>
                                    <td>TOTAL ({Object.keys(sheetsData).length})</td>
                                    <td className="num">
                                        {Object.values(sheetsData).reduce((sum, d) => sum + (d.report?.total_filas_crudas || 0), 0).toLocaleString()}
                                    </td>
                                    <td className="num">
                                        {Object.values(sheetsData).reduce((sum, d) => sum + (d.report?.titulos_unicos || 0), 0).toLocaleString()}
                                    </td>
                                    <td className="num text-comic-destructive">
                                        -{Object.values(sheetsData).reduce((sum, d) => sum + (d.report?.eliminados?.length || 0), 0).toLocaleString()}
                                    </td>
                                    <td className="num text-comic-green">
                                        {Object.values(sheetsData).reduce((sum, d) => {
                                            const r = d.report;
                                            return sum + ((r?.titulos_unicos || 0) - (r?.ean_creados_total || 0));
                                        }, 0).toLocaleString()}
                                    </td>
                                    <td className="num text-comic-yellow">
                                        {Object.values(sheetsData).reduce((sum, d) => sum + (d.report?.ean_creados_total || 0), 0).toLocaleString()}
                                    </td>
                                    <td className="num">
                                        {Object.values(sheetsData).reduce((sum, d) => sum + (d.report?.cambios?.nuevos || 0) + (d.report?.cambios?.precios || 0), 0)} cambios
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    {/* STATS SUMMARY (Current Tab) */}
                    <div className="comic-report-grid">
                        <div className="comic-stat-card featured">
                            <div className="comic-stat-label">Títulos Únicos</div>
                            <div className="comic-stat-value">
                                {currentSheet?.report?.titulos_unicos || 0}
                            </div>
                            <div className="comic-stat-sub">De {currentSheet?.report?.total_filas_crudas || 0} filas brutas</div>
                        </div>
                        <div className="comic-stat-card">
                            <div className="comic-stat-label">EAN Oficiales</div>
                            <div className="comic-stat-value">
                                {(currentSheet?.report?.titulos_unicos || 0) - (currentSheet?.report?.ean_creados_total || 0)}
                            </div>
                            <div className="comic-stat-sub">Válidos y únicos</div>
                        </div>
                        <div className="comic-stat-card">
                            <div className="comic-stat-label">EAN Internos</div>
                            <div className="comic-stat-value text-comic-yellow">
                                {currentSheet?.report?.ean_creados_total || 0}
                            </div>
                            <div className="comic-stat-sub">Códigos generados</div>
                        </div>
                        <div className="comic-stat-card">
                            <div className="comic-stat-label">Duplicados</div>
                            <div className="comic-stat-value text-comic-destructive">
                                {currentSheet?.report?.duplicados_exactos_eliminados || 0}
                            </div>
                            <div className="comic-stat-sub">Eliminados en limpieza</div>
                        </div>
                    </div>

                    {/* TABS (Available Sheets) */}
                    <div className="comic-tabs">
                        <button
                            className={`comic-tab-btn ${activeTab === 'TODOS_RESUMEN' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveTab('TODOS_RESUMEN');
                                setFilterCategory('TODOS');
                            }}
                        >
                            🌎 TODOS
                        </button>
                        {Object.keys(sheetsData).map(sheetName => (
                            <button
                                key={sheetName}
                                className={`comic-tab-btn ${activeTab === sheetName ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveTab(sheetName);
                                    setFilterCategory('TODOS');
                                }}
                            >
                                {sheetName}
                            </button>
                        ))}
                    </div>

                    {/* TOOLBAR */}
                    <div className="comic-toolbar">
                        <h2>
                            {activeTab === 'TODOS_RESUMEN' ? 'Vista Global de Resultados' : `Catálogo de ${activeTab}`}
                        </h2>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                className="comic-btn-ghost flex items-center gap-2"
                                onClick={exportCSV}
                                disabled={activeTab === 'TODOS_RESUMEN'}
                                title={activeTab === 'TODOS_RESUMEN' ? "Exporta por editorial individual" : ""}
                            >
                                <Download size={16} /> CSV
                            </button>
                            <button
                                className="comic-btn-ghost flex items-center gap-2"
                                onClick={exportExcel}
                            >
                                <RefreshCw size={16} /> EXCEL COMPLETO
                            </button>
                            <button
                                className="comic-btn-primary flex items-center gap-2"
                                style={{ background: 'var(--comic-primary)', padding: '0.5rem 1rem' }}
                                onClick={handleSync}
                                disabled={isSyncing}
                            >
                                <ArrowUpCircle size={16} className={isSyncing ? 'animate-bounce' : ''} />
                                {isSyncing ? 'SINCRONIZANDO...' : 'SINCRONIZAR BASE'}
                            </button>
                        </div>
                    </div>

                    {/* ADVANCED FILTERS */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 bg-comic-muted/30 p-4 rounded-xl border-2 border-comic-border">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold opacity-50 ml-1 uppercase">Buscador</label>
                            <input
                                type="text"
                                className="p-2 bg-white border-2 border-comic-border rounded-lg font-comic-mono text-xs focus:border-comic-accent outline-none"
                                placeholder="Título o EAN..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold opacity-50 ml-1 uppercase">Categoría</label>
                            <select
                                className="p-2 bg-white border-2 border-comic-border rounded-lg font-comic-mono text-xs focus:border-comic-accent outline-none"
                                value={filterCategory}
                                onChange={(e) => setFilterCategory(e.target.value)}
                            >
                                <option value="TODOS">Todas las categorías</option>
                                {availableCategories.filter(Boolean).sort().map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold opacity-50 ml-1 uppercase">Estado EAN/ISBN</label>
                            <select
                                className="p-2 bg-white border-2 border-comic-border rounded-lg font-comic-mono text-xs focus:border-comic-accent outline-none"
                                value={filterEanStatus}
                                onChange={(e) => setFilterEanStatus(e.target.value)}
                            >
                                <option value="TODOS">Todos los estados</option>
                                <option value="ok">EAN Válidos (Verde)</option>
                                <option value="en_blanco_o_por_confirmar">Sin EAN (Generado)</option>
                                <option value="ean_repetido_en_varios_titulos">EAN Duplicado</option>
                                <option value="ean_invalido">EAN Inválido</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-1 justify-center">
                            <label className="flex items-center gap-2 cursor-pointer p-2 hover:bg-white/50 rounded-lg transition-colors">
                                <input
                                    type="checkbox"
                                    checked={filterReimpresion}
                                    onChange={(e) => setFilterReimpresion(e.target.checked)}
                                    className="w-4 h-4 accent-comic-accent"
                                />
                                <span className="text-xs font-bold text-comic-primary uppercase">Solo Reimpresiones</span>
                            </label>
                        </div>
                    </div>

                    {/* DESGLOSE POR CATEGORÍAS (Current Tab) */}
                    <div className="comic-breakdown-section animate-in fade-in slide-in-from-right-4 duration-700">
                        <h3 className="comic-breakdown-title">Distribución por Categorías</h3>
                        <div className="comic-category-list">
                            {Object.entries(currentSheet?.report?.items_por_categoria || {}).sort((a, b) => b[1] - a[1]).map(([cat, count]) => {
                                const total = currentSheet?.report?.titulos_unicos || 1;
                                const pct = (count / total) * 100;
                                return (
                                    <div key={cat} className="comic-category-row">
                                        <div className="comic-category-name" title={cat}>{cat}</div>
                                        <div className="comic-category-bar-bg">
                                            <div
                                                className="comic-category-bar-fill"
                                                style={{ width: `${pct}%` }}
                                            ></div>
                                        </div>
                                        <div className="comic-category-count">{count}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>


                    {/* TABLE */}
                    <div className="comic-table-container">
                        <table className="comic-table">
                            <thead>
                                <tr>
                                    <th>Título / Manga</th>
                                    <th>EAN / ISBN</th>
                                    <th style={{ textAlign: 'right' }}>Precio PVP</th>
                                    <th style={{ textAlign: 'center' }}>Estado</th>
                                    <th style={{ textAlign: 'right' }}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayItems.map((item, idx) => (
                                    <tr key={item.product_id + idx}>
                                        <td>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontWeight: '700' }}>{item.titulo}</span>
                                                    {item.comparison === 'nuevo' && <span className="comic-badge comic-badge-new">NUEVO</span>}
                                                    {item.comparison === 'cambio_precio' && <span className="comic-badge comic-badge-price">Δ PRECIO</span>}
                                                    {item.subetiquetas?.reimpresionSemana && <span className="comic-badge bg-comic-orange/20 text-comic-orange border-comic-orange/30">REIMPRESIÓN</span>}
                                                </div>
                                                <div className="flex gap-2 items-center italic opacity-50" style={{ fontSize: '0.65rem' }}>
                                                    <span>{item.editorial}</span>
                                                    {item.categoria_principal && <span>• {item.categoria_principal}</span>}
                                                    {item.comparison === 'cambio_precio' && (
                                                        <span className="text-comic-accent font-bold">
                                                            (Antes: ${item.db_price?.toLocaleString()})
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="font-mono">
                                            {item.ean_final}
                                            {item.ean_razon !== 'ok' && (
                                                <span className="ml-2 opacity-50 text-[10px]">({item.ean_razon})</span>
                                            )}
                                        </td>
                                        <td className="font-mono" style={{ textAlign: 'right' }}>
                                            <span className="highlight-word">
                                                ${(item.precio_tapa || 0).toLocaleString()}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            {item.ean_razon === 'ok' ? (
                                                <CheckCircle size={18} color="var(--success)" style={{ margin: '0 auto' }} />
                                            ) : (
                                                <AlertTriangle size={18} color="var(--comic-yellow)" style={{ margin: '0 auto' }} />
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button className="text-secondary underline font-bold" style={{ fontSize: '0.75rem' }}>EDITAR</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* ALERTAS DE CATÁLOGO (Items Ausentes) */}
                    {Object.keys(itemsAusentes).some(ed => itemsAusentes[ed]?.length > 0) && (
                        <div className="mt-8 animate-in fade-in slide-in-from-top-4 duration-700">
                            <div className="flex items-center gap-3 mb-4 p-3 bg-comic-destructive/10 border-l-4 border-comic-destructive rounded-r-lg">
                                <AlertTriangle size={24} className="text-comic-destructive" />
                                <div>
                                    <h3 className="font-comic-display text-lg text-comic-destructive uppercase leading-none">Alertas de Catálogo Maestro</h3>
                                    <p className="text-xs font-bold opacity-60">Estos ítems están en tu base de datos pero NO aparecen en el Excel actual de la editorial.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {Object.entries(itemsAusentes).map(([ed, items]) => items.length > 0 && (
                                    <div key={ed} className="bg-white border-2 border-comic-border rounded-xl overflow-hidden shadow-sm">
                                        <div className="bg-comic-muted p-2 px-4 border-b-2 border-comic-border flex justify-between items-center">
                                            <span className="font-bold text-xs uppercase">{ed}</span>
                                            <span className="comic-badge bg-comic-destructive/20 text-comic-destructive border-none">{items.length} AUSENTES</span>
                                        </div>
                                        <div className="max-h-[250px] overflow-y-auto custom-scrollbar">
                                            <table className="w-full text-[11px]">
                                                <tbody className="divide-y divide-comic-border">
                                                    {items.map(it => (
                                                        <tr key={it.product_id} className="hover:bg-comic-muted/30">
                                                            <td className="p-2 font-bold">{it.titulo}</td>
                                                            <td className="p-2 font-comic-mono opacity-50">{it.product_id}</td>
                                                            <td className="p-2 text-right">
                                                                <button
                                                                    onClick={() => handleDeleteFromMaster(it.product_id, ed)}
                                                                    className="text-comic-destructive hover:scale-110 transition-transform p-1"
                                                                    title="Borrar del Catálogo Maestro"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center' }}>
                        <button
                            className="comic-btn-ghost"
                            onClick={reset}
                        >
                            ↩ PROCESAR OTRO ARCHIVO
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ComicAnalysisTool;
