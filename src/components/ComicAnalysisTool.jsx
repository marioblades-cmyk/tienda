import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { Download, RefreshCw, CheckCircle, AlertTriangle, XCircle, Database, ArrowUpCircle, Trash2, FileUp, Clock, FileSpreadsheet } from 'lucide-react';
import { SHEET_PROCESSORS } from '../utils/excelProcessors';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { useAuth } from '../hooks/useAuth';
import './ComicAnalysisTool.css';

const ComicAnalysisTool = () => {
    const { user, profile, isAdmin } = useAuth();
    const [viewMode, setViewMode] = useState('upload'); // 'upload', 'results', 'catalog'
    const [sheetsData, setSheetsData] = useState({});
    const [dbCatalog, setDbCatalog] = useState({}); // Indexed by product_id
    const [dbEanIndex, setDbEanIndex] = useState({}); // Indexed by EAN for fast lookup
    const [activeTab, setActiveTab] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [error, setError] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [itemsPerPage] = useState(200);
    const [historialSemanas, setHistorialSemanas] = useState([]);
    const [loadingHistorial, setLoadingHistorial] = useState(false);
    const [catalogReady, setCatalogReady] = useState(false);
    const [expandedSheets, setExpandedSheets] = useState({}); // Tracking expanded detail rows
    const [filterCategory, setFilterCategory] = useState('TODOS');
    const [filterEanStatus, setFilterEanStatus] = useState('TODOS');
    const [filterReimpresion, setFilterReimpresion] = useState(false);
    const [filterCatEditorial, setFilterCatEditorial] = useState('TODOS');
    const [filterCatCategory, setFilterCatCategory] = useState('TODOS');
    const [itemsAusentes, setItemsAusentes] = useState({}); // { editorialName: [items] }
    const [selectedItem, setSelectedItem] = useState(null);
    const [isIdModalOpen, setIsIdModalOpen] = useState(false);
    const fileInputRef = useRef(null);

    // ── FUNCIONES DE CARGA INICIAL ──
    const fetchCatalog = async () => {
        setCatalogReady(false);
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
                    if (data.length < step) hasMore = false;
                } else {
                    hasMore = false;
                }
            }

            const indexed = {};
            const eanIndex = {};
            allData.forEach(item => {
                const pid = item.product_id || item.productId;
                if (pid) indexed[pid] = item;
                if (item.ean_oficial) eanIndex[item.ean_oficial] = item;
                if (item.ean_interno) eanIndex[item.ean_interno] = item;
            });
            setDbCatalog(indexed);
            setDbEanIndex(eanIndex);
            setCatalogReady(true);
            return { indexed, eanIndex };
        } catch (err) {
            console.error('Error cargando catálogo:', err);
            setError('Error al cargar el catálogo completo. Verifica tu conexión.');
            setCatalogReady(false);
            throw err;
        }
    };

    const fetchHistorial = async () => {
        setLoadingHistorial(true);
        try {
            const { data, error } = await supabase
                .from('semanas')
                .select('*')
                .not('archivo_url', 'is', null)
                .order('created_at', { ascending: false })
                .limit(5);

            if (error) throw error;
            setHistorialSemanas(data || []);
        } catch (err) {
            console.error('Error cargando historial:', err);
        } finally {
            setLoadingHistorial(false);
        }
    };

    const calculateMissingItems = (data, currentCatalog) => {
        const allProcessedEans = new Set();
        Object.values(data).forEach(sheet => {
            sheet.items.forEach(item => {
                if (item.ean_final) allProcessedEans.add(item.ean_final);
                if (item.ean_oficial) allProcessedEans.add(item.ean_oficial);
                if (item.ean_interno) allProcessedEans.add(item.ean_interno);
                if (item.product_id) allProcessedEans.add(item.product_id);
            });
        });

        const newItemsAusentes = {};
        const activeEditoriales = new Set(Object.keys(data));

        const catalogToUse = currentCatalog || dbCatalog;

        if (catalogToUse && Object.keys(catalogToUse).length > 0) {
            Object.values(catalogToUse).forEach(dbItem => {
                if (!dbItem) return;
                if (activeEditoriales.has(dbItem.editorial)) {
                    const itemIdentifiers = [dbItem.ean_oficial, dbItem.ean_interno, dbItem.product_id].filter(Boolean);
                    const isPresent = itemIdentifiers.some(id => allProcessedEans.has(id));

                    if (!isPresent) {
                        if (!newItemsAusentes[dbItem.editorial]) newItemsAusentes[dbItem.editorial] = [];
                        newItemsAusentes[dbItem.editorial].push(dbItem);
                    }
                }
            });
        }
        setItemsAusentes(newItemsAusentes);
    };

    const checkForAutoReport = async (currentCatalog) => {
        try {
            console.log('🔍 Buscando reporte automático...');
            let semanaId = null;
            let source = null;

            // 1. Intentar desde localStorage (Puntero rápido)
            const stored = localStorage.getItem('mcb_last_processed_report');
            if (stored) {
                const parsed = JSON.parse(stored);
                if (Date.now() - parsed.timestamp < 1000 * 60 * 60 * 24) {
                    semanaId = parsed.semanaId;
                    source = parsed.source;
                    console.log(`📄 Puntero local hallado para semana: ${semanaId}`);
                }
            }

            // 2. Si no hay puntero, buscar la semana más reciente en la DB (Abierta o Cerrada)
            if (!semanaId) {
                console.log('☁️ Buscando última semana en la base de datos...');
                const { data: weeks, error } = await supabase
                    .from('semanas')
                    .select('id, nombre')
                    .order('created_at', { ascending: false })
                    .limit(1);

                if (weeks?.[0]) {
                    semanaId = weeks[0].id;
                    source = 'cloud';
                    console.log(`📌 Seleccionada automáticamente semana: ${weeks[0].nombre}`);
                }
            }

            if (semanaId) {
                let reportData = null;

                // Descargar siempre si es cloud o si no tenemos data local
                if (source === 'cloud' || !stored) {
                    console.log('☁️ Iniciando descarga del reporte desde la nube para ID: ' + semanaId);
                    setIsProcessing(true);
                    try {
                        reportData = await catalogService.downloadAnalysisReport(semanaId);
                        if (reportData) {
                            console.log('✅ Descarga exitosa. ' + Object.keys(reportData).length + ' pestañas recuperadas.');
                        } else {
                            console.log('⚠️ El archivo existe en la nube pero es nulo o no se pudo leer.');
                        }
                    } catch (err) {
                        console.error('❌ Error fatal en descarga: ' + err.message);
                    } finally {
                        setIsProcessing(false);
                    }
                } else if (stored) {
                    reportData = JSON.parse(stored).data;
                }

                if (reportData) {
                    console.log('✅ Cargando datos al visor...');
                    setSheetsData(reportData);
                    const firstAvailable = Object.keys(reportData)[0];
                    setActiveTab(firstAvailable);
                    setViewMode('results');
                    calculateMissingItems(reportData, currentCatalog);
                } else {
                    console.log('⚠️ No hay reporte guardado en la nube para esta semana.');
                }
            } else {
                console.log('❌ No hay semanas activas ni reportes locales.');
            }
        } catch (e) {
            console.warn('⚠️ Error en búsqueda automática de reporte:', e);
        }
    };

    // ── EFFECT PRINCIPAL ──
    useEffect(() => {
        const init = async () => {
            const result = await fetchCatalog();
            await fetchHistorial();
            checkForAutoReport(result.indexed);
        };
        init();

        // Escuchar evento de subida en la sección de Semanas
        const handleWeekUpload = async () => {
            console.log('🔄 Detectada nueva subida en Semanas. Recargando reporte...');
            const result = await fetchCatalog();
            checkForAutoReport(result.indexed);
        };
        
        window.addEventListener('week-file-uploaded', handleWeekUpload);
        return () => window.removeEventListener('week-file-uploaded', handleWeekUpload);
    }, []);

    const handleSelectHistorial = async (semana) => {
        if (!semana.archivo_url) return;
        
        setIsProcessing(true);
        setError(null);

        try {
            const response = await fetch(semana.archivo_url);
            if (!response.ok) throw new Error('No se pudo descargar el archivo del servidor.');
            
            const blob = await response.blob();
            const file = new File([blob], semana.archivo_nombre || 'historial.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            
            handleFileUpload(file);
        } catch (err) {
            setError('Error al cargar archivo histórico: ' + err.message);
            setIsProcessing(false);
        }
    };

    const handleFileUpload = async (file) => {
        if (!file) return;
        setIsProcessing(true);
        setError(null);

        // GUARDA DE SEGURIDAD: Asegurar que el catálogo esté cargado
        let currentCatalog = dbCatalog;
        let currentEanIndex = dbEanIndex;

        if (!catalogReady || Object.keys(dbCatalog).length === 0) {
            console.log('Catálogo no listo, cargando antes de procesar...');
            try {
                const result = await fetchCatalog();
                currentCatalog = result.indexed;
                currentEanIndex = result.eanIndex;
            } catch (err) {
                setError('No se pudo cargar el catálogo maestro. No se puede comparar el archivo.');
                setIsProcessing(false);
                return;
            }
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            setTimeout(() => {
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

                        if (result.items && Array.isArray(result.items)) {
                            result.items = result.items.map(item => {
                                if (!item) return null;
                                const dbMatch = currentCatalog[item.product_id] || (item.ean_final ? currentEanIndex[item.ean_final] : null);
                                let comparison = 'sin_cambios';
                                if (!dbMatch) {
                                    comparison = 'nuevo';
                                } else {
                                    const priceChanged = item.precio_tapa != null && dbMatch.precio_tapa != null && Number(item.precio_tapa) !== Number(dbMatch.precio_tapa);
                                    
                                    // Cambio de EAN: si el EAN actual es distinto al oficial Y distinto al interno guardado
                                    const currentDbEan = dbMatch.ean_oficial || dbMatch.ean_interno;
                                    const eanChanged = item.ean_final && item.ean_final !== currentDbEan;
                                    
                                    const catChanged = item.categoria_principal && dbMatch.categoria && item.categoria_principal !== dbMatch.categoria;

                                    if (priceChanged || eanChanged || catChanged) {
                                        if (priceChanged) comparison = 'cambio_precio';
                                        else if (eanChanged) comparison = 'cambio_ean';
                                        else comparison = 'cambio_categoria';
                                    }
                                }
                                return {
                                    ...item,
                                    editorial: sheetName,
                                    comparison,
                                    db_price: dbMatch?.precio_tapa,
                                    db_ean: dbMatch?.ean_oficial || dbMatch?.ean_interno,
                                    db_category: dbMatch?.categoria
                                };
                            }).filter(Boolean);
                        }

                        // Asegurar que existe el objeto report
                        if (!result.report) {
                            result.report = {
                                total_filas_crudas: (result.items || []).length,
                                titulos_unicos: (result.items || []).length,
                                eliminados: []
                            };
                        }

                        // Recalcular resumen de cambios (Separando Precios de EANs)
                        result.report.cambios = {
                            nuevos: (result.items || []).filter(i => i.comparison === 'nuevo').length,
                            precios: (result.items || []).filter(i => i.comparison === 'cambio_precio').length,
                            eans: (result.items || []).filter(i => i.comparison === 'cambio_ean').length,
                            categorias: (result.items || []).filter(i => i.comparison === 'cambio_categoria').length
                        };

                        result.filename = file.name;
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

                    if (dbCatalog && Object.keys(dbCatalog).length > 0) {
                        Object.values(dbCatalog).forEach(dbItem => {
                            if (!dbItem) return;
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
                    }

                    setItemsAusentes(newItemsAusentes);
                    setSheetsData(newSheetsData);
                    const firstAvailable = Object.keys(newSheetsData)[0];
                    setActiveTab(firstAvailable);
                    setPage(1);
                    setViewMode('results');
                    setIsProcessing(false);
                } catch (err) {
                    console.error('Error detallado procesando archivo:', err);
                    setError(`Error al procesar el archivo: ${err.message}. Revisa el formato y las pestañas.`);
                    setIsProcessing(false);
                }
            }, 100);
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
            // Usar la nueva sincronización inteligente que calcula precios automáticos
            const result = await catalogService.syncWithMaster(sheetsData, user.id);
            
            if (result.count === 0) {
                alert('No hay cambios pendientes para sincronizar.');
                return;
            }

            await fetchCatalog(); // Recargar base local

            // Marcar items como sincronizados localmente para limpiar los badges de la UI
            const updatedSheets = { ...sheetsData };
            Object.keys(updatedSheets).forEach(k => {
                updatedSheets[k].items = updatedSheets[k].items.map(i => ({ ...i, comparison: 'sin_cambios' }));
                if (updatedSheets[k].report) {
                    updatedSheets[k].report.cambios = { nuevos: 0, precios: 0, eans: 0, categorias: 0 };
                }
            });
            setSheetsData(updatedSheets);

            // Notificar que se sincronizó el catálogo para actualizar el indicador del Sidebar
            window.dispatchEvent(new CustomEvent('catalog-status-changed'));

            alert(`Catálogo sincronizado exitosamente (${result.count} productos actualizados con precios inteligentes).`);
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

    const handleWipeCatalog = async () => {
        if (!isAdmin) {
            alert("Solo los administradores pueden realizar esta acción.");
            return;
        }

        const confirm1 = confirm("⚠️ ¿ESTÁS SEGURO? Estás a punto de borrar TODO EL CATÁLOGO MAESTRO.");
        if (!confirm1) return;

        const confirm2 = confirm("🚨 ESTA ACCIÓN NO SE PUEDE DESHACER. ¿Realmente quieres eliminar todos los registros de la base de datos?");
        if (!confirm2) return;

        setIsSyncing(true);
        try {
            // Borramos todas las filas. Usamos un filtro que siempre sea verdadero (e.g., id no nulo o product_id no vacío)
            const { error } = await supabase
                .from('catalogo_productos')
                .delete()
                .neq('product_id', '_empty_registry_'); // Borra todo excepto (teóricamente) un id inexistente

            if (error) throw error;

            setDbCatalog({});
            setDbEanIndex({});
            alert("El catálogo ha sido vaciado completamente.");
            
            if (Object.keys(sheetsData).length > 0) {
                // Si hay datos cargados, podríamos querer re-comparar, pero lo más limpio es volver al inicio
                reset();
            }
        } catch (err) {
            console.error("Error al vaciar catálogo:", err);
            alert("Error al vaciar el catálogo: " + err.message);
        } finally {
            setIsSyncing(false);
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
        XLSX.writeFile(wb, 'mangas_comics_bolivia_limpio.xlsx');
    };

    // Función para abrir modal
    const openProductModal = (item) => {
        setSelectedItem({ ...item });
        setIsIdModalOpen(true);
    };

    // Función para guardar cambios desde el modal
    const handleSaveFromModal = async () => {
        if (!selectedItem) return;

        try {
            const { error } = await supabase
                .from('catalogo_productos')
                .update({
                    precio_tapa: selectedItem.precio_tapa,
                    categoria: selectedItem.categoria,
                    titulo: selectedItem.titulo
                })
                .eq('product_id', selectedItem.product_id);

            if (error) throw error;

            // Refrescar catálogo local
            await fetchCatalog();
            setIsIdModalOpen(false);
            setSelectedItem(null);
            alert('Producto actualizado correctamente en la base master.');
        } catch (err) {
            console.error('Error al guardar:', err);
            alert('Error al guardar los cambios.');
        }
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

        try {
            return pool.filter(item => {
                if (!item) return false;
                const matchSearch = (item.titulo || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (item.ean_final || '').includes(searchTerm);
                const matchCat = filterCategory === 'TODOS' || item.categoria_principal === filterCategory;
                const matchEan = filterEanStatus === 'TODOS' || item.ean_razon === filterEanStatus;
                const matchReimpr = !filterReimpresion || item.subetiquetas?.reimpresionSemana;

                return matchSearch && matchCat && matchEan && matchReimpr;
            });
        } catch (err) {
            console.error("Error en filtrado:", err);
            return [];
        }
    };

    const allFilteredItems = React.useMemo(() => getFilteredItems(), [sheetsData, activeTab, searchTerm, filterCategory, filterEanStatus, filterReimpresion]);
    const displayItems = React.useMemo(() => allFilteredItems.slice((page - 1) * itemsPerPage, page * itemsPerPage), [allFilteredItems, page, itemsPerPage]);
    const totalPages = Math.ceil(allFilteredItems.length / itemsPerPage);

    // Obtener categorías únicas del pool actual
    const availableCategories = activeTab === 'TODOS_RESUMEN'
        ? [...new Set(Object.values(sheetsData).flatMap(d => (d?.items || []).map(i => i.categoria_principal)))]
        : (currentSheet?.items ? [...new Set(currentSheet.items.map(i => i.categoria_principal))] : []);

    return (
        <div className="comic-tool-container animate-in fade-in duration-500">
            {/* ── HEADER ── */}
            <header className="comic-header">
                <div className="comic-logo-badge">MANGAS COMICS BOLIVIA</div>
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
                        <div className="ml-auto flex gap-2">
                            {isAdmin && (
                                <button 
                                    className="comic-btn-destructive" 
                                    style={{  
                                        background: 'var(--comic-destructive)', 
                                        color: 'white', 
                                        padding: '0.5rem 1rem',
                                        borderRadius: '0.5rem',
                                        fontWeight: 'bold',
                                        fontSize: '0.7rem'
                                    }}
                                    onClick={handleWipeCatalog}
                                    disabled={isSyncing}
                                >
                                    <Trash2 size={14} className="inline mr-1" /> {isSyncing ? 'BORRANDO...' : 'BORRAR TODO EL CATÁLOGO'}
                                </button>
                            )}
                            <button className="comic-btn-ghost" onClick={reset}>
                                ↩ VOLVER AL INICIO
                            </button>
                        </div>
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
                                                <th style={{ textAlign: 'right' }}>MASTER</th>
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
                                                        <button
                                                            className="text-secondary underline font-bold"
                                                            style={{ fontSize: '0.75rem' }}
                                                            onClick={() => openProductModal(item)}
                                                        >
                                                            VER FICHA
                                                        </button>
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
            ) : Object.keys(sheetsData).length > 0 ? (
                /* ── RESULTS VIEW (Prioritaria si hay datos) ── */
                <div className="animate-in slide-in-from-bottom-4 duration-500">
                    {/* ── SUMMARY BAR (Global) ── */}
                    {/* ── SUMMARY BAR (Global Redesigned) ── */}
                    <div className="mb-4 flex items-center gap-3 bg-[#1a2d42] p-3 rounded-t-lg border-b border-white/10 shadow-lg">
                        <Database size={20} className="text-[#f07d2a]" />
                        <h2 className="text-xl font-bold tracking-widest text-[#f5f1e4] m-0 uppercase flex-1">RESUMEN DE LIMPIEZA</h2>

                    </div>
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
                                    if (!d || !d.report) return null;
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
                                                        {r.cambios?.eans > 0 && <span className="comic-badge bg-comic-blue/20 text-comic-blue border-comic-blue/30 font-mono">{r.cambios.eans} Δ EAN</span>}
                                                        {(!r.cambios?.nuevos && !r.cambios?.precios && !r.cambios?.eans) && (
                                                            <div className="flex gap-1">
                                                                {r.duplicados_exactos_eliminados > 0 && <span className="comic-badge opacity-40 font-mono" style={{ background: 'rgba(255,100,0,0.1)' }}>{r.duplicados_exactos_eliminados} repetidos</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="animate-in fade-in duration-300">
                                                    <td colSpan="7" className="p-0 border-none">
                                                        <div className="comic-expanded-audit-panel">
                                                            <div className="comic-audit-grid">
                                                                {/* SECCIÓN NOVEDADES */}
                                                                {d.items.filter(i => i.comparison === 'nuevo').length > 0 && (
                                                                    <div className="comic-audit-section">
                                                                        <div className="comic-audit-section-title flex items-center gap-2">
                                                                            <ArrowUpCircle size={12} /> NOVEDADES DETECTADAS ({d.items.filter(i => i.comparison === 'nuevo').length})
                                                                        </div>
                                                                        <div className="comic-mini-table">
                                                                            {d.items.filter(i => i.comparison === 'nuevo').slice(0, 10).map((i, idx) => (
                                                                                <div key={idx} className="comic-mini-table-row">
                                                                                    <span className="title" title={i.titulo}>{i.titulo}</span>
                                                                                    <span className="comic-badge-new-v3">NUEVO</span>
                                                                                    <span className="detail comic-price-tech">${i.precio_tapa}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* SECCIÓN PRECIOS */}
                                                                {d.items.filter(i => i.comparison === 'cambio_precio').length > 0 && (
                                                                    <div className="comic-audit-section">
                                                                        <div className="comic-audit-section-title flex items-center gap-2">
                                                                            <RefreshCw size={12} /> ACTUALIZACIÓN DE PRECIOS ({d.items.filter(i => i.comparison === 'cambio_precio').length})
                                                                        </div>
                                                                        <div className="comic-mini-table">
                                                                            {d.items.filter(i => i.comparison === 'cambio_precio').slice(0, 10).map((i, idx) => (
                                                                                <div key={idx} className="comic-mini-table-row">
                                                                                    <span className="title" title={i.titulo}>{i.titulo}</span>
                                                                                    <span className="detail comic-price-tech">${i.db_price} ➔ ${i.precio_tapa}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* SECCIÓN ISBN/EAN */}
                                                                {d.items.filter(i => i.comparison === 'cambio_ean').length > 0 && (
                                                                    <div className="comic-audit-section">
                                                                        <div className="comic-audit-section-title flex items-center gap-2">
                                                                            <Database size={12} /> ISBN/EAN ACTUALIZADOS ({d.items.filter(i => i.comparison === 'cambio_ean').length})
                                                                        </div>
                                                                        <div className="comic-mini-table">
                                                                            {d.items.filter(i => i.comparison === 'cambio_ean').slice(0, 10).map((i, idx) => (
                                                                                <div key={idx} className="comic-mini-table-row">
                                                                                    <span className="title" title={i.titulo}>{i.titulo}</span>
                                                                                    <span className="detail" style={{ fontSize: '11px', fontFamily: 'var(--font-comic-mono)', fontWeight: 700 }}>
                                                                                        {i.db_ean || 'S/C'} ➔ {i.ean_final}
                                                                                    </span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* SECCIÓN ELIMINADOS */}
                                                                {r.eliminados?.length > 0 && (
                                                                    <div className="comic-audit-section">
                                                                        <div className="comic-audit-section-title flex items-center gap-2">
                                                                            <XCircle size={12} /> FILTRADOS POR LIMPIEZA ({r.eliminados.length})
                                                                        </div>
                                                                        <div className="comic-mini-table">
                                                                            {r.eliminados.slice(0, 15).map((e, idx) => (
                                                                                <div key={idx} className="comic-mini-table-row">
                                                                                    <div className="flex flex-col max-w-[200px]">
                                                                                        <span className="title" title={e.titulo}>{e.titulo}</span>
                                                                                        <span className="reason">{e.motivo}</span>
                                                                                    </div>
                                                                                    <span className="detail opacity-60" style={{ fontFamily: 'var(--font-comic-mono)' }}>{e.ean || 'S/EAN'}</span>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>


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
                                        {Object.values(sheetsData).reduce((sum, d) => sum + (d.report?.cambios?.nuevos || 0) + (d.report?.cambios?.precios || 0) + (d.report?.cambios?.eans || 0) + (d.report?.cambios?.categorias || 0), 0)} cambios
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
                                                    {item.comparison === 'cambio_ean' && <span className="comic-badge bg-comic-blue/20 text-comic-blue border-comic-blue/30" title="Cambio de código EAN detectado">Δ EAN</span>}
                                                    {item.comparison === 'cambio_categoria' && <span className="comic-badge bg-purple-500/20 text-purple-600 border-purple-500/30" title="Cambio de categoría detectado">Δ CATEGORÍA</span>}
                                                    {item.subetiquetas?.reimpresionSemana && <span className="comic-badge bg-comic-orange/20 text-comic-orange border-comic-orange/30">REIMPRESIÓN</span>}
                                                </div>
                                                <div className="flex gap-2 items-center italic opacity-70 mt-1" style={{ fontSize: '0.65rem' }}>
                                                    <span className="font-bold text-comic-primary/60">{item.editorial}</span>
                                                    {item.categoria_principal && <span>• {item.categoria_principal}</span>}
                                                </div>
                                                
                                                {/* Visualización de Cambios (Anterior ➔ Nuevo) */}
                                                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                                                    {item.comparison === 'cambio_precio' && (
                                                        <div className="comic-change-indicator price">
                                                            <span className="label">PRECIO:</span>
                                                            <span className="old">${item.db_price?.toLocaleString()}</span>
                                                            <span className="arrow">➔</span>
                                                            <span className="new">${item.precio_tapa?.toLocaleString()}</span>
                                                        </div>
                                                    )}
                                                    {item.comparison === 'cambio_ean' && (
                                                        <div className="comic-change-indicator ean">
                                                            <span className="label">EAN:</span>
                                                            <span className="old">{item.db_ean || 'SIN EAN'}</span>
                                                            <span className="arrow">➔</span>
                                                            <span className="new">{item.ean_final}</span>
                                                        </div>
                                                    )}
                                                    {item.comparison === 'cambio_categoria' && (
                                                        <div className="comic-change-indicator category">
                                                            <span className="label">CAT:</span>
                                                            <span className="old">{item.db_category || 'S/C'}</span>
                                                            <span className="arrow">➔</span>
                                                            <span className="new">{item.categoria_principal}</span>
                                                        </div>
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
                                            <button
                                                className="text-secondary underline font-bold"
                                                style={{ fontSize: '0.75rem' }}
                                                onClick={() => openProductModal(item)}
                                            >
                                                EDITAR
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* PAGINATION CONTROLS */}
                    {totalPages > 1 && (
                        <div className="flex justify-center items-center gap-4 mt-4 bg-comic-muted/20 p-4 rounded-xl border-2 border-comic-border">
                            <button
                                className="comic-btn-ghost"
                                disabled={page === 1}
                                onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo(0, 400); }}
                                style={{ padding: '4px 12px', fontSize: '0.7rem' }}
                            >
                                ◀ ANTERIOR
                            </button>
                            <span className="font-comic-mono text-xs font-bold">
                                PÁGINA {page} DE {totalPages}
                            </span>
                            <button
                                className="comic-btn-ghost"
                                disabled={page === totalPages}
                                onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo(0, 400); }}
                                style={{ padding: '4px 12px', fontSize: '0.7rem' }}
                            >
                                SIGUIENTE ▶
                            </button>
                        </div>
                    )}

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
                                        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                                            <table className="w-full text-[11px]">
                                                <tbody className="divide-y divide-comic-border">
                                                    {items.slice(0, 20).map(it => (
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
                                            {items.length > 20 && (
                                                <div className="p-3 text-center bg-comic-muted/10 border-t border-comic-border text-[10px] uppercase font-bold text-muted">
                                                    Y {items.length - 20} productos más...
                                                </div>
                                            )}
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
            ) : (
                /* ── ESTADO DE ESPERA SIMPLIFICADO (FALLBACK) ── */
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="comic-empty-state card py-20 text-center border-dashed border-2 border-comic-border bg-white/50 rounded-2xl shadow-xl">
                        <div className="mb-6 relative inline-block">
                            <Clock size={80} className="text-comic-primary opacity-20" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <FileUp size={32} className="text-comic-primary opacity-40" />
                            </div>
                        </div>
                        <h3 className="text-2xl font-display text-comic-primary mb-3 uppercase tracking-tight">Reporte No Detectado</h3>
                        <p className="text-sm text-comic-muted max-w-md mx-auto font-medium">
                            Sube un archivo Excel en la pestaña de <span className="text-comic-accent font-bold">Semanas</span>. El reporte aparecerá aquí automáticamente.
                        </p>
                        <div className="mt-10 flex justify-center gap-4">
                            <button
                                className="comic-btn-primary flex items-center gap-2"
                                onClick={async () => {
                                    const result = await fetchCatalog();
                                    checkForAutoReport(result.indexed);
                                }}
                            >
                                <RefreshCw size={18} /> BUSCAR REPORTE AHORA
                            </button>
                            <button
                                className="comic-btn-secondary flex items-center gap-2"
                                onClick={() => { setViewMode('catalog'); fetchCatalog(); }}
                            >
                                <Database size={18} /> VER CATÁLOGO MAESTRO
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── MODAL DE FICHA / EDICIÓN ── */}
            {isIdModalOpen && selectedItem && (
                <div className="comic-modal-overlay" onClick={() => setIsIdModalOpen(false)}>
                    <div className="comic-modal-content" onClick={e => e.stopPropagation()}>
                        <div className="comic-modal-header">
                            <h3>Ficha del <span>Producto</span></h3>
                            <button onClick={() => setIsIdModalOpen(false)} className="text-white hover:text-comic-accent">
                                <XCircle size={24} />
                            </button>
                        </div>
                        <div className="comic-modal-body">
                            <div className="comic-form-group">
                                <label>Título del Manga / Comic</label>
                                <input
                                    type="text"
                                    className="comic-form-input"
                                    value={selectedItem.titulo || ''}
                                    onChange={e => setSelectedItem({ ...selectedItem, titulo: e.target.value })}
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="comic-form-group">
                                    <label>EAN / ISBN</label>
                                    <input
                                        type="text"
                                        className="comic-form-input bg-comic-muted/30"
                                        value={selectedItem.ean_oficial || selectedItem.ean_interno || selectedItem.product_id || ''}
                                        readOnly
                                    />
                                </div>
                                <div className="comic-form-group">
                                    <label>Precio PVP ($)</label>
                                    <input
                                        type="number"
                                        className="comic-form-input"
                                        value={selectedItem.precio_tapa || 0}
                                        onChange={e => setSelectedItem({ ...selectedItem, precio_tapa: Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                            <div className="comic-form-group">
                                <label>Categoría</label>
                                <input
                                    type="text"
                                    className="comic-form-input"
                                    value={selectedItem.categoria || selectedItem.categoria_principal || ''}
                                    onChange={e => setSelectedItem({ ...selectedItem, categoria: e.target.value })}
                                />
                            </div>
                            <div className="mt-4 p-3 bg-comic-primary/5 rounded-lg border border-comic-primary/10 grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-[10px] uppercase font-bold text-comic-primary opacity-60 mb-1">Editorial</p>
                                    <p className="text-xs font-bold">{selectedItem.editorial || 'No especificada'}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-[10px] uppercase font-bold text-comic-primary opacity-60 mb-1">Precio N2 (-10%)</p>
                                    <p className="text-xs font-bold text-comic-accent">BS {selectedItem.precio_n2_bs?.toLocaleString() || '-'}</p>
                                </div>
                            </div>
                        </div>
                        <div className="comic-modal-footer">
                            <button className="comic-btn-ghost" onClick={() => setIsIdModalOpen(false)}>CANCELAR</button>
                            <button className="comic-btn-primary" onClick={handleSaveFromModal}>GUARDAR CAMBIOS</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ComicAnalysisTool;
