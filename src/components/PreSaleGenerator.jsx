import React, { useState, useEffect, useMemo } from 'react';
import { catalogService } from '../services/catalogService';
import { Search, Download, Trash2, Image as ImageIcon, CheckCircle2, AlertCircle, Loader2, Zap, Smartphone, MapPin, Facebook, Book, Save, Cloud, Star, RefreshCw } from 'lucide-react';
import html2canvas from 'html2canvas';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useAuth';

export default function PreSaleGenerator() {
    const { user, profile, isAdmin } = useAuth();
    const skipTemplateDateRef = React.useRef(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoadingProjects, setIsLoadingProjects] = useState(true);
    const [dbError, setDbError] = useState(null);
    const [userTemplates, setUserTemplates] = useState({});
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [savedProjects, setSavedProjects] = useState({}); // { id: { name, config, items, date, owner_id, owner_name } }
    const [selectedProjectId, setSelectedProjectId] = useState('');




    // Carga inicial de proyectos y plantillas desde Supabase
    useEffect(() => {
        if (!user) return;
        
        const fetchData = async () => {
            console.log("Iniciando sincronización con Supabase...");
            setIsLoadingProjects(true);
            try {


                // --- CARGA NORMAL DE SUPABASE ---
                // Seleccionar proyectos uniendo con el perfil para ver el dueño
                const { data: projectsData, error: projError } = await supabase
                    .from('presale_projects')
                    .select(`
                        *,
                        owner:vendedores(nombre)
                    `)
                    .order('updated_at', { ascending: false });
                
                if (projError) throw projError;
                const projsMap = {};
                projectsData?.forEach(p => {
                    const ownerName = Array.isArray(p.owner) ? p.owner[0]?.nombre : p.owner?.nombre;
                    projsMap[p.id] = { 
                        id: p.id,
                        name: p.name || 'Proyecto sin nombre', 
                        config: p.config, 
                        items: p.items, 
                        date: p.updated_at, 
                        user_id: p.user_id,
                        owner_name: ownerName || 'Desconocido'
                    };
                });
                setSavedProjects(projsMap);

                // Seleccionar plantillas uniendo con el perfil
                const { data: templatesData, error: tempError } = await supabase
                    .from('presale_templates')
                    .select(`
                        *,
                        owner:vendedores(nombre)
                    `)
                    .order('name', { ascending: true });
                
                if (tempError) throw tempError;
                
                const tempsMap = {};
                templatesData?.forEach(t => {
                    const ownerName = Array.isArray(t.owner) ? t.owner[0]?.nombre : t.owner?.nombre;
                    tempsMap[t.id] = { 
                        id: t.id,
                        name: t.name || 'Plantilla sin nombre', 
                        config: t.config, 
                        user_id: t.user_id,
                        owner_name: ownerName || 'Desconocido'
                    };
                });
                setUserTemplates(tempsMap);
                console.log("Sincronización completada.");
            } catch (err) {
                console.error("Error al cargar datos de Supabase:", err);
                setDbError(err.message || 'No se pudo conectar con la base de datos');
                setUserTemplates({});
            } finally {
                setIsLoadingProjects(false);
            }
        };

        fetchData();
    }, [user]);

    const saveProject = async () => {
        if (!user) { alert("Debes iniciar sesión para guardar proyectos."); return; }
        
        const currentProj = savedProjects[selectedProjectId];
        const isOwner = currentProj ? (currentProj.user_id === user.id) : true;
        
        let initialName = selectedProjectId ? savedProjects[selectedProjectId].name : `Proyecto ${new Date().toLocaleDateString()}`;
        
        // Si no es el dueño, forzamos un nombre nuevo para crear una copia
        if (!isOwner) {
            initialName = `${initialName} (Copia)`;
        }

        const name = prompt(isOwner ? "Nombre del proyecto:" : "Guardar como copia propia (Nuevo Nombre):", initialName);
        if (!name) return;

        setIsSaving(true);
        try {
            // Siempre usamos upsert con user.id y name. Si es un nombre nuevo, creará uno nuevo.
            // Si es el dueño y es el mismo nombre, sobrescribirá.
            const { data, error } = await supabase
                .from('presale_projects')
                .upsert({
                    user_id: user.id,
                    name: name,
                    config: config,
                    items: selectedItems,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'user_id,name' })
                .select();

            if (error) throw error;
            
            const savedItem = data[0];
            const newProj = { 
                id: savedItem.id,
                name: savedItem.name, 
                config: savedItem.config, 
                items: savedItem.items, 
                date: savedItem.updated_at, 
                user_id: savedItem.user_id,
                owner_name: profile?.nombre || 'Yo'
            };

            setSavedProjects(prev => ({
                ...prev,
                [savedItem.id]: newProj
            }));
            setSelectedProjectId(savedItem.id);
            alert('Proyecto guardado exitosamente.');
        } catch (err) {
            alert('Error al guardar: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };



    const deleteProject = async () => {
        if (!selectedProjectId || !user) return;
        const proj = savedProjects[selectedProjectId];
        
        if (proj.user_id !== user.id && !isAdmin) {
            alert("No tienes permisos para borrar proyectos de otras personas.");
            return;
        }

        if (!window.confirm(`¿Seguro que deseas eliminar el proyecto "${proj.name}"?`)) return;
        
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('presale_projects')
                .delete()
                .eq('id', selectedProjectId);

            if (error) throw error;

            setSavedProjects(prev => {
                const next = { ...prev };
                delete next[selectedProjectId];
                return next;
            });
            setSelectedProjectId('');
            alert('Proyecto eliminado.');
        } catch (err) {
            alert('Error al eliminar: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const saveCurrentAsTemplate = async () => {
        if (!user) return;
        
        const currentTpl = userTemplates[selectedTemplateId];
        const isOwner = currentTpl ? (currentTpl.user_id === user.id) : true;
        const isDefault = currentTpl?.isDefault;

        let initialName = selectedTemplateId && !isDefault ? userTemplates[selectedTemplateId].name : "Mi Nueva Plantilla";
        if (selectedTemplateId && (isDefault || (!isOwner && !isAdmin))) initialName = `${initialName} (Copia)`;

        const name = prompt((isOwner || isAdmin) && !isDefault ? "Nombre de la plantilla:" : "Guardar como copia propia (Nuevo Nombre):", initialName);
        if (!name) return;

        setIsSaving(true);
        try {
            const { data, error } = await supabase
                .from('presale_templates')
                .upsert({
                    user_id: user.id,
                    name: name,
                    config: config
                }, { onConflict: 'user_id,name' })
                .select();

            if (error) throw error;
            
            const savedItem = data[0];
            const newTpl = { 
                id: savedItem.id,
                name: savedItem.name, 
                config: savedItem.config, 
                user_id: savedItem.user_id,
                owner_name: profile?.nombre || 'Yo'
            };

            setUserTemplates(prev => ({
                ...prev,
                [savedItem.id]: newTpl
            }));
            setSelectedTemplateId(savedItem.id);
            alert('Plantilla guardada exitosamente.');
        } catch (err) {
            alert('Error al guardar plantilla: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const deleteTemplate = async () => {
        if (!selectedTemplateId || !user) return;
        const tpl = userTemplates[selectedTemplateId];

        if (tpl.isDefault && !isAdmin) {
            alert("No se pueden eliminar las plantillas básicas del sistema.");
            return;
        }
        if (tpl.user_id !== user.id && !isAdmin) {
            alert("No tienes permisos para borrar plantillas de otras personas.");
            return;
        }

        if (!window.confirm(`¿Seguro que deseas eliminar la plantilla "${tpl.name}"?`)) return;
        
        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('presale_templates')
                .delete()
                .eq('id', selectedTemplateId);

            if (error) throw error;
            
            setUserTemplates(prev => {
                const next = { ...prev };
                delete next[selectedTemplateId];
                return next;
            });
            setSelectedTemplateId('');
            alert('Plantilla eliminada.');
        } catch (err) {
            alert('Error al eliminar plantilla: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const renameTemplate = async () => {
        if (!selectedTemplateId || !user) return;
        const tpl = userTemplates[selectedTemplateId];
        if (tpl.isDefault && !isAdmin) return;
        if (tpl.user_id !== user.id && !isAdmin) return;

        const newName = prompt("Nuevo nombre para la plantilla:", tpl.name);
        if (!newName || newName === tpl.name) return;
        
        setIsSaving(true);
        try {
            const { error: upsertError } = await supabase
                .from('presale_templates')
                .update({ name: newName })
                .eq('id', selectedTemplateId);

            if (upsertError) throw upsertError;

            setUserTemplates(prev => ({
                ...prev,
                [selectedTemplateId]: { ...prev[selectedTemplateId], name: newName }
            }));
            alert('Plantilla renombrada.');
        } catch (err) {
            alert('Error al renombrar plantilla: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const calcularProximoSabado = () => {
        const today = new Date();
        const dayOfWeek = today.getDay(); // 0 (Sun) to 6 (Sat)
        let daysToAdd = (6 - dayOfWeek + 7) % 7;
        if (daysToAdd === 0) daysToAdd = 7; 
        
        const nextSaturday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysToAdd);
        const monthNames = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
        return `${nextSaturday.getDate()} / ${monthNames[nextSaturday.getMonth()]}`;
    };

    // Configuración global del póster
    const [config, setConfig] = useState({
        discountPercent: 20,
        headerTag: 'EDICIÓN ESPECIAL',
        headerTitle: 'PREVENTA',
        headerSubtitle: 'ASEGURA TU PEDIDO • PRECIO ESPECIAL',
        dividerText: '★ PRECIOS EXCLUSIVOS POR TIEMPO LIMITADO • ENVÍO A TODA BOLIVIA ★',
        footerContact1: 'WHATSAPP: +591 XXXXXXXX',
        footerContact2: 'FACEBOOK: Mangas Comics Bolivia Store',
        footerContact3: 'LA PAZ, BOLIVIA',
        deadlineDate: calcularProximoSabado(),
        deadlineTime: ''
    });

    // Estado del catálogo y búsqueda
    const [catalogData, setCatalogData] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Filtros
    const [editorialFilter, setEditorialFilter] = useState('TODOS');
    const [categoryFilter, setCategoryFilter] = useState('TODOS');
    const [reprintsOnlyFilter, setReprintsOnlyFilter] = useState(false);
    const [editorialesList, setEditorialesList] = useState([]);
    
    // Ítems seleccionados para el póster
    const [selectedItems, setSelectedItems] = useState([]);
    const [draggedItem, setDraggedItem] = useState(null);

    // NUEVO: Pre-cargar el logo en Base64 para garantizar su presencia en la exportación
    const [logoBase64, setLogoBase64] = useState("");

    // --- EFECTO GUARDIÁN: Asegurar que la fecha nunca quede vacía ---
    useEffect(() => {
        if (!config.deadlineDate || config.deadlineDate.trim() === '') {
            setConfig(prev => ({
                ...prev,
                deadlineDate: calcularProximoSabado()
            }));
        }
    }, [config.deadlineDate]);

    useEffect(() => {
        const loadLogo = async () => {
            try {
                const response = await fetch('/logo.png');
                const blob = await response.blob();
                const reader = new FileReader();
                reader.onloadend = () => setLogoBase64(reader.result);
                reader.readAsDataURL(blob);
            } catch (err) {
                console.error("Error pre-loading logo:", err);
            }
        };
        loadLogo();
    }, []);
    const [isExporting, setIsExporting] = useState(false);
    const [previewMode, setPreviewMode] = useState('small'); // 'small' o 'large'
    const [editPage, setEditPage] = useState(0); // Página que se está editando en el sidebar

    useEffect(() => {
        loadCatalog();
    }, []);

    const loadCatalog = async () => {
        setIsLoading(true);
        try {
            const data = await catalogService.fetchFullCatalog();
            setCatalogData(data);
            const eds = [...new Set(data.map(i => i.editorial))].filter(Boolean).sort();
            setEditorialesList(eds);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    // Categorías dinámicas
    const dynamicCategories = useMemo(() => {
        const edMatch = editorialFilter.trim().toUpperCase();
        const base = edMatch === 'TODOS' 
            ? catalogData 
            : catalogData.filter(i => (i.editorial || '').trim().toUpperCase() === edMatch);
        return [...new Set(base.map(i => i.categoria))].filter(Boolean).sort();
    }, [catalogData, editorialFilter]);

    useEffect(() => {
        setCategoryFilter('TODOS');
    }, [editorialFilter]);

    // AUTO-LOAD PROJECT WHEN SELECTED
    useEffect(() => {
        if (selectedProjectId && savedProjects[selectedProjectId]) {
            const proj = savedProjects[selectedProjectId];
            if (proj.config) {
                const savedConfig = typeof proj.config === 'string' ? JSON.parse(proj.config) : proj.config;
                setConfig({
                    ...savedConfig,
                    deadlineDate: calcularProximoSabado()
                });
            }
            if (proj.items) setSelectedItems(JSON.parse(JSON.stringify(proj.items)));
        }
    }, [selectedProjectId, savedProjects]);

    // AUTO-LOAD TEMPLATE WHEN SELECTED
    useEffect(() => {
        if (selectedTemplateId && userTemplates[selectedTemplateId]) {
            const tpl = userTemplates[selectedTemplateId].config || {};
            
            setConfig(prev => {
                const newConfig = { ...prev, ...tpl };
                
                // Forzar siempre la fecha actual independientemente de lo que diga la plantilla
                newConfig.deadlineDate = calcularProximoSabado();

                // Si la selección de plantilla fue provocada por la Automatización, 
                // mantenemos la fecha calculada automáticamente y evitamos que la plantilla la sobreescriba.
                if (skipTemplateDateRef.current) {
                    newConfig.deadlineDate = prev.deadlineDate;
                    newConfig.deadlineTime = prev.deadlineTime;
                }
                return newConfig;
            });
            
            const mult = (100 - (tpl.discountPercent !== undefined ? tpl.discountPercent : 20)) / 100;
            setSelectedItems(items => items.map(it => ({
                ...it,
                customPreventa: it.customPvp * mult
            })));

            // Resetear el bloqueo tras haber consumido la acción
            skipTemplateDateRef.current = false;
        }
    }, [selectedTemplateId, userTemplates]);

    // NUEVO: PERSISTENCIA AUTOMÁTICA DE IMÁGENES AL CATÁLOGO
    useEffect(() => {
        const persistImages = async () => {
            const itemsToPersist = selectedItems.filter(it => 
                it.customImageUrl && 
                it.customImageUrl.startsWith('http') && 
                !it.customImageUrl.includes('supabase.co/storage') &&
                !it._persisting
            );

            if (itemsToPersist.length === 0) return;

            // Marcar como en proceso para evitar loops
            setSelectedItems(prev => prev.map(it => {
                const match = itemsToPersist.find(tp => tp.id === it.id);
                return match ? { ...it, _persisting: true } : it;
            }));

            for (const item of itemsToPersist) {
                try {
                    console.log(`☁️ Intentando auto-persistir imagen para: ${item.titulo}`);
                    const newUrl = await catalogService.persistProductImage(item.product_id, item.customImageUrl);
                    
                    if (newUrl) {
                        setSelectedItems(prev => prev.map(it => 
                            it.id === item.id ? { ...it, customImageUrl: newUrl, _persisting: false, _persisted: true } : it
                        ));
                    }
                } catch (err) {
                    console.error(`❌ Error auto-persistiendo ${item.titulo}:`, err);
                    setSelectedItems(prev => prev.map(it => 
                        it.id === item.id ? { ...it, _persisting: false, _persistError: true } : it
                    ));
                }
            }
        };

        const timer = setTimeout(persistImages, 2000); // Debounce de 2 segundos tras escribir
        return () => clearTimeout(timer);
    }, [selectedItems]);


    // Filtro de búsqueda
    const searchResults = useMemo(() => {
        const edSearch = editorialFilter.trim().toUpperCase();
        const catSearch = categoryFilter.trim().toUpperCase();
        const query = searchQuery.trim().toLowerCase();

        if (!query && edSearch === 'TODOS' && catSearch === 'TODOS' && !reprintsOnlyFilter) return [];

        const filtered = catalogData.filter(item => {
            const valEd = (item.editorial || '').trim().toUpperCase();
            if (edSearch !== 'TODOS' && valEd !== edSearch) return false;

            const valCat = (item.categoria || '').trim().replace(/\s+/g, ' ').toUpperCase();
            const catSearchMatch = catSearch.replace(/\s+/g, ' ');
            if (catSearch !== 'TODOS' && valCat !== catSearchMatch) return false;

            if (reprintsOnlyFilter && !item.es_reimpresion) return false;

            if (query) {
                const searchScope = [
                    item.titulo,
                    item.ean_oficial,
                    item.ean_interno,
                    item.product_id
                ].map(v => (v || '').toLowerCase());
                if (!searchScope.some(v => v.includes(query))) return false;
            }
            return true;
        });

        return filtered.slice(0, 15);
    }, [catalogData, searchQuery, editorialFilter, categoryFilter, reprintsOnlyFilter]);

    const handleAddItem = (item) => {
        if (selectedItems.find(i => i.product_id === item.product_id)) return;
        
        const discountMult = (100 - config.discountPercent) / 100;
        // Solo Ivrea usa el "precio próximo" si existe; el resto, su precio actual.
        const esIvrea = (item.editorial || '').toUpperCase().includes('IVREA');
        const pvp = parseFloat(esIvrea ? (item.precio_venta_bs_prox || item.precio_venta_bs)
                                       : item.precio_venta_bs) || 0;
        const preventa = pvp * discountMult;

        setSelectedItems(prev => [...prev, {
            ...item,
            id: String(Date.now() + Math.random()),
            customImageUrl: item.imagen_url || '',
            customPvp: pvp,
            customPreventa: preventa,
            overrideText: '',
            customVol: ''
        }]);
        setSearchQuery('');
    };

    const handleUpdateItem = (id, field, value) => {
        setSelectedItems(prev => prev.map(it => {
            if (it.id === id) {
                return { ...it, [field]: value };
            }
            return it;
        }));
    };

    const handleRemoveItem = (id) => {
        setSelectedItems(prev => prev.filter(it => it.id !== id));
    };

    const handleConfigChange = (e) => {
        const { name, value } = e.target;
        setConfig(prev => {
            const next = { ...prev, [name]: value };
            if (name === 'discountPercent') {
                const perc = parseFloat(value) || 0;
                const mult = (100 - perc) / 100;
                setSelectedItems(items => items.map(it => ({
                    ...it,
                    customPreventa: it.customPvp * mult
                })));
            }
            return next;
        });
    };

    // Paginación: Trozar selectedItems en grupos de 8 (4x2)
    const pages = useMemo(() => {
        if (selectedItems.length === 0) return [[]];
        const result = [];
        for (let i = 0; i < selectedItems.length; i += 8) {
            result.push(selectedItems.slice(i, i + 8));
        }
        return result;
    }, [selectedItems]);

    const handleExportImage = async () => {
        setIsExporting(true);
        setStatusMessage("SINCRONIZANDO RECURSOS...");
        
        try {
            // CRITICO: Forzar recarga de fuentes
            if (document.fonts) await document.fonts.ready;

            const numPages = Math.max(1, pages.length);
            for (let i = 0; i < numPages; i++) {
                // Pequeña espera para que el DOM de exportación se "asiente"
                await new Promise(r => setTimeout(r, 400));
                
                const node = document.getElementById(`export-page-${i}`);
                if (!node) continue;
                
                setStatusMessage(`PAGINANDO... (${i + 1}/${numPages})`);
                
                const options = {
                    scale: 2, // Calidad óptima (3 a veces causa cuelgues)
                    useCORS: true,
                    allowTaint: false,
                    backgroundColor: '#1b3a57',
                    logging: true, // Para ver detalles en la consola si algo falla
                    // CORRECCION DEFINITIVA DE OFFSET:
                    x: 0,
                    y: 0,
                    scrollX: 0,
                    scrollY: 0,
                    windowWidth: 1080,
                    windowHeight: 1680,
                    onclone: (doc) => {
                        // Asegurar que el el clon esté al principio
                        const clonedNode = doc.getElementById(`export-page-${i}`);
                        if (clonedNode) {
                            clonedNode.style.display = 'block';
                            clonedNode.style.position = 'relative';
                        }
                    }
                };

                const projName = savedProjects[selectedProjectId]?.name?.replace(/\s+/g, '_') || 'Pagina';
                const canvas = await html2canvas(node, options);
                const image = canvas.toDataURL("image/jpeg", 0.95);
                const link = document.createElement('a');
                link.href = image;
                link.download = `PREVENTA_${projName}_${i + 1}.jpg`;
                link.click();
                
                await new Promise(r => setTimeout(r, 800));
            }
            setStatusMessage("✓ ¡EXPORTACIÓN EXITOSA!");
            setTimeout(() => setStatusMessage(""), 3000);
        } catch (err) {
            console.error("Error detallado export:", err);
            alert(`Falla técnica al generar imagen: ${err.message || 'CORS o Memoria insuficiente'}. Revisa la consola (F12).`);
        } finally {
            setIsExporting(false);
        }
    };

    const handleAutoLoad = async (type) => { // type = 'NOVEDADES' | 'REIMPRESIONES' | 'CURADOS_NOVEDADES' | 'CURADOS_REIMPRESIONES'
        const isReimpresion = type === 'REIMPRESIONES' || type === 'CURADOS_REIMPRESIONES';
        const isCurados = type.startsWith('CURADOS');
        
        const getIsItemReimpresion = (item) => {
            const cat = (item.categoria || '').toUpperCase();
            return item.es_reimpresion === true || cat.includes('REIMPRESI');
        };

        // 1. Obtener items (intentar usar los actuales)
        let itemsToFilter = catalogData;

        // Si es CURADOS y no vemos nada, intentamos un refresco forzoso
        let filteredItems = itemsToFilter.filter(item => {
            if (isCurados) {
                const itemIsReimp = getIsItemReimpresion(item);
                const matchesType = isReimpresion ? itemIsReimp : !itemIsReimp;
                return item.para_preventa === true && matchesType;
            }
            const ed = (item.editorial || '').toUpperCase();
            if (!ed.includes('IVREA')) return false;
            return isReimpresion ? getIsItemReimpresion(item) : (item.categoria || '').toUpperCase().includes('NOVEDAD');
        });

        if (filteredItems.length === 0 && isCurados) {
            setStatusMessage("⏳ SINCRONIZANDO CON EL CURADOR...");
            try {
                const freshData = await catalogService.fetchFullCatalog(true); // Forzar descarga de Supabase
                setCatalogData(freshData);
                filteredItems = freshData.filter(item => {
                    const itemIsReimp = getIsItemReimpresion(item);
                    const matchesType = isReimpresion ? itemIsReimp : !itemIsReimp;
                    return item.para_preventa === true && matchesType;
                });
            } catch (err) {
                console.error("Error sincronizando:", err);
            }
        }

        if (filteredItems.length === 0) {
            const msg = isCurados 
                ? `No hay ${isReimpresion ? 'reimpresiones' : 'novedades'} marcadas para preventa en el Curador.` 
                : `No se encontraron ${type.toLowerCase()} de Ivrea en el catálogo actual.`;
            alert(msg);
            setStatusMessage("");
            return;
        }
        setStatusMessage("");

        // 2. Calcular fecha automática usando la función central
        const formattedDate = calcularProximoSabado();

        // 3. Buscar plantilla
        let targetTplId = null;
        if (isReimpresion) {
            targetTplId = Object.keys(userTemplates).find(id => userTemplates[id].name.toUpperCase().includes('REIMPRESI'));
        }
        
        if (!targetTplId) {
             targetTplId = Object.keys(userTemplates).find(id => userTemplates[id].isDefault) || Object.keys(userTemplates)[0];
        }

        let tplConfig = {};
        let tplDiscount = isReimpresion ? 10 : 20;

        if (targetTplId && userTemplates[targetTplId]) {
            tplConfig = userTemplates[targetTplId].config || {};
            if (tplConfig.discountPercent !== undefined) {
                tplDiscount = parseFloat(tplConfig.discountPercent) || 0;
            }
        } else if (isReimpresion) {
            // Fallback manual si no hay plantilla de reimpresión guardada
            tplConfig = {
                discountPercent: 10,
                headerTag: 'REIMPRESIONES',
                headerSubtitle: 'APROVECHA EL DESCUENTO DEL 10%',
                dividerText: '★ STOCK LIMITADO • ENVÍO A TODA BOLIVIA ★'
            };
        }

        // 4. Preparar items
        const discountMult = (100 - tplDiscount) / 100;
        const newSelectedItems = filteredItems.map(item => {
            // Solo Ivrea usa el "precio próximo" si existe; el resto, su precio actual.
            const esIvrea = (item.editorial || '').toUpperCase().includes('IVREA');
            const pvp = parseFloat(esIvrea ? (item.precio_venta_bs_prox || item.precio_venta_bs)
                                           : item.precio_venta_bs) || 0;
            const preventa = pvp * discountMult;
            return {
                ...item,
                id: String(Date.now() + Math.random()),
                customImageUrl: item.imagen_url || '',
                customPvp: pvp,
                customPreventa: preventa,
                overrideText: '',
                customVol: ''
            };
        });

        // 5. Aplicar estados
        if (targetTplId) {
            skipTemplateDateRef.current = true; // Activar el bloqueo para el useEffect
            setSelectedTemplateId(targetTplId);
        }
        
        setSelectedItems(newSelectedItems);
        
        // 6. Aplicar la configuración y fijar la fecha automática
        setConfig(prev => ({ 
            ...prev, 
            ...tplConfig,
            deadlineDate: formattedDate 
        }));

        setStatusMessage(`⚡ ¡Cargadas ${filteredItems.length} ${type.toLowerCase()} de Ivrea!`);
        setTimeout(() => setStatusMessage(""), 4000);
    };

    const [statusMessage, setStatusMessage] = useState("");

    // NOVEDAD: COMPONENTE INTERNO PARA EL POSTER (Compartido entre Preview y Export)
    const PosterPageContent = ({ pageItems, pageIndex, idPrefix }) => (
        <div 
            id={`${idPrefix}-${pageIndex}`}
            className="bg-[#faca33] w-[1080px] h-[1680px] flex flex-col font-sans relative overflow-hidden text-center items-center"
        >
            {/* Dotted background overlay */}
            <div className="absolute inset-0 opacity-[0.12] pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle, #000 3px, transparent 3px)', backgroundSize: '28px 28px' }} />
            
            {/* ESTILOS INLINE PARA EL POSTER */}
            <style>{`
                .edición-tag { font-family: 'DM Sans', sans-serif; }
                .title-preventa { font-family: 'Anton', 'Impact', sans-serif; letter-spacing: -2px; }
            `}</style>
            
            {/* TOP HEADER (Reduced to 240px to fit considerations better) */}
            <div className="bg-[#1b3a57] w-full h-[240px] py-4 px-14 z-10 relative flex justify-between items-center shadow-lg border-b-[4px] border-[#132b42] shrink-0 overflow-hidden">
                <div className="flex flex-col items-start h-full justify-start flex-1 text-left pt-2">
                    {/* Band 1: Tag (Enlarged and Closer) */}
                    <div className="h-[55px] flex items-center">
                        <div className="flex items-center gap-2 mb-0 ml-1">
                            <Zap size={22} className="text-[#f5a800] fill-current" />
                            <span className="bg-[#f5a800] text-[#1b3a57] font-bold italic px-4 py-1.5 text-[22px] uppercase skew-x-[-12deg] tracking-wider">{config.headerTag}</span>
                        </div>
                    </div>
                    {/* Band 2: Title (Moved closer by reducing band height) */}
                    <div className="h-[110px] flex items-center -mt-1">
                        <h1 className="text-[#f5a800] text-[95px] leading-none font-black uppercase italic skew-x-[-8deg] title-preventa transform -translate-x-3 mb-0 whitespace-nowrap pr-8" style={{ textShadow: '4px 4px 0px rgba(0,0,0,0.5), 8px 8px 0px rgba(0,0,0,0.2)' }}>
                            {config.headerTitle.substring(0, 16)}
                        </h1>
                    </div>
                    {/* Band 3: Subtitle */}
                    <div className="h-[50px] flex items-center mt-3">
                        <p className="text-[#78a2c4] font-bold text-[19px] uppercase tracking-widest pl-1 font-sans opacity-95 leading-tight w-[710px] whitespace-pre-wrap">{config.headerSubtitle}</p>
                    </div>
                </div>
                <div className="bg-white p-2 rounded-2xl h-[120px] w-[120px] flex items-center justify-center shadow-2xl self-center border-4 border-[#132b42]/30 shrink-0 ml-4">
                    <img 
                        src={logoBase64 || "/logo.png"} 
                        alt="Logo" 
                        className="max-h-full max-w-full object-contain" 
                        crossOrigin="anonymous" 
                        onError={(e) => e.target.style.display='none'} 
                    />
                </div>
            </div>

            {/* DIVIDER (Fixed 75px H - IMPROVED FOR WRAP) */}
            <div className="bg-[#1b3a57] border-y-[6px] border-[#f5a800] h-[75px] w-full z-10 text-center relative shadow-xl flex justify-center items-center shrink-0 px-12">
                <div className="text-white font-black text-[17px] tracking-widest uppercase font-sans leading-tight drop-shadow-md whitespace-pre-wrap text-center opacity-100">
                    ★ {config.dividerText} ★
                </div>
            </div>

            {/* GRID CARDS (Re-balanced for Considerations) */}
            <div className="flex-1 w-full px-1 py-0 grid grid-cols-4 grid-rows-2 gap-x-2 gap-y-[10px] z-10 relative place-items-center font-sans overflow-visible h-[1160px]">
                {pageItems.length === 0 && pageIndex === 0 && (
                    <div className="col-span-4 row-span-2 w-full h-full flex items-center justify-center text-[#1b3a57]/20 font-black text-6xl uppercase italic">
                        VISTA PREVIA VACÍA
                    </div>
                )}
                {pageItems.map((item, idx) => (
                    <div key={idx} className="w-[264px] h-[575px] bg-white rounded-[16px] shadow-[0_12px_44px_rgba(0,0,0,0.35)] flex flex-col border-[2.5px] border-[#1b3a57]/20 relative overflow-hidden">
                        {/* Card Image Area (305px - Reduced to fit Considerations) */}
                        <div className="h-[305px] bg-[#4a708b] w-full relative shrink-0">
                            {item.customImageUrl ? (
                                 <img 
                                    src={
                                        (item.customImageUrl.startsWith('blob:') || item.customImageUrl.startsWith('data:') || item.customImageUrl.includes('supabase.co'))
                                            ? item.customImageUrl
                                            : `https://images.weserv.nl/?url=${encodeURIComponent(item.customImageUrl.replace(/^https?:\/\//, ''))}`
                                    } 
                                    className="w-full h-full object-cover" 
                                    crossOrigin="anonymous" 
                                    alt={item.titulo} 
                                    loading="eager"
                                />
                            ) : (
                                <div className="flex items-center justify-center w-full h-full opacity-20"><Book size={80} className="text-[#1b3a57]"/></div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-[#1b3a57]/50 to-transparent"></div>
                        </div>
                        
                        {/* Card Title Area (135px) */}
                        <div className="px-6 bg-white h-[135px] flex flex-col justify-center items-center border-b-[8px] border-[#f5a800] shrink-0 text-center py-2 overflow-visible">
                            <h3 className="text-[#1b3a57] font-black italic uppercase text-[22px] leading-[1.1] text-ellipsis overflow-hidden font-display tracking-tight-line-clamp-3 w-full drop-shadow-sm pb-1.5">{item.titulo || 'Manga Title'}</h3>
                        </div>
                        
                        {/* Preventa Area (H=100px) */}
                        <div className="bg-[#f5a800] px-4 flex flex-col justify-center items-center h-[100px] shrink-0">
                            <span className="text-[#1b3a57] font-black italic text-[14px] uppercase tracking-wider leading-none mb-1.5 drop-shadow-sm">PREVENTA ESPECIAL</span>
                            <span className="text-[#1b3a57] font-black italic text-[36px] font-display tracking-wider leading-none">BS {Math.round(item.customPreventa || 0)}</span>
                        </div>
                        
                        {/* PVP Area (35px) */}
                        <div className="bg-[#1b3a57] px-4 flex justify-between items-center h-[35px] rounded-b-xl mt-auto shadow-[inner_0_3px_6px_rgba(0,0,0,0.4)] overflow-hidden">
                            <span className="text-white/80 font-black text-[10px] uppercase tracking-widest">PVP REGULAR</span>
                            <span className="text-white font-black text-[17px] font-mono tracking-wider italic drop-shadow-md pb-1">Bs {Math.round(item.customPvp || 0)}</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* CONSIDERATIONS PANEL (Enlarged for legibility) */}
            <div className="bg-[#132b42] w-full h-[85px] px-14 py-2 border-t-[3px] border-[#f5a800]/30 z-10 relative flex gap-8 items-center shrink-0">
                <div className="flex-1 text-left border-r border-white/10 pr-4 h-full flex flex-col justify-center">
                    <span className="text-[#f5a800] font-black text-[12px] uppercase tracking-widest mb-0.5">Gestión con Editoriales</span>
                    <p className="text-white/70 text-[11px] leading-tight font-medium uppercase font-sans">
                        Los pedidos pueden verse afectados por factores ajenos a la tienda, tales como retrasos en las fechas de salida editorial, falta de disponibilidad de producto en origen o recortes en las unidades asignadas por parte de la editorial.
                    </p>
                </div>
                <div className="flex-1 text-left h-full flex flex-col justify-center">
                    <span className="text-[#f5a800] font-black text-[12px] uppercase tracking-widest mb-0.5">Política de Cambios y Preventa</span>
                    <p className="text-white/70 text-[11px] leading-tight font-medium uppercase font-sans">
                        Si el pedido sufre algún cambio de fecha de salida o cambio de precio, el cliente podrá escoger entre continuar con la preventa o solicitar la cancelación inmediata de la reserva.
                    </p>
                </div>
            </div>

            {/* BOTTOM FOOTER (Fixed 110px H) */}
            <div className="bg-[#1b3a57] h-[110px] w-full px-12 py-2 flex justify-between items-start z-10 relative shrink-0 border-t-[4px] border-[#132b42] overflow-hidden">
                {/* Left Contacts */}
                <div className="flex flex-col gap-1.5 mt-1 text-left">
                    <div className="flex items-center gap-2">
                        <Smartphone size={16} className="text-[#f5a800]" />
                        <span className="text-white font-black text-[15px] italic leading-none">{config.footerContact1}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <Facebook size={16} className="text-[#f5a800]" />
                        <span className="text-[#78a2c4] font-bold text-[14px] uppercase truncate w-[280px] leading-tight">{config.footerContact2}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <MapPin size={16} className="text-[#f5a800]" />
                        <span className="text-[#78a2c4] font-bold text-[13px] uppercase tracking-widest leading-none">{config.footerContact3}</span>
                    </div>
                </div>
                
                {/* Center Date & Time */}
                <div className="text-center flex flex-col pt-0 pr-8 min-w-[340px] items-center">
                    <span className="text-white/60 font-black italic text-[15px] uppercase tracking-[0.2em] mb-1">CIERRE DE PEDIDOS</span>
                    <div className="flex items-center justify-center gap-6">
                        <span className="text-[#f5a800] font-black italic text-[44px] uppercase tracking-[0.05em] leading-[0.9] pb-3 drop-shadow-lg">{config.deadlineDate}</span>
                        {config.deadlineTime && (
                            <div className="flex flex-col items-start border-l-[3px] border-[#f5a800]/40 pl-6 mt-1.5">
                                <span className="text-white/50 font-black text-[11px] tracking-widest leading-none mb-1 uppercase">HORA</span>
                                <span className="text-[#f5a800] font-black italic text-[26px] tracking-wider leading-none drop-shadow-sm pb-1">{config.deadlineTime}</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Logo */}
                <div className="bg-white p-2 rounded-xl h-[80px] w-[110px] flex items-center justify-center shadow-lg border-2 border-white/20 self-center">
                    <img 
                        src={logoBase64 || "/logo.png"} 
                        alt="Logo" 
                        className="max-h-full max-w-full object-contain" 
                        crossOrigin="anonymous" 
                        onError={(e) => e.target.style.display='none'} 
                    />
                </div>
            </div>
        </div>
    );

    return (
        <div className="animate-in fade-in duration-500 p-4 md:p-8 max-w-[1600px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-8">
            
            {/* PANEL IZQUIERDO: CONFIGURACIÓN Y SELECCIÓN */}
            <div className="xl:col-span-4 space-y-6">
                
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-border/40">
                    <h3 className="text-xl font-black text-[#1b3a57] mb-4 flex items-center gap-2">
                        <ImageIcon size={24} className="text-[#f5a800]" />
                        Generador de Preventas (Ed. Azul)
                    </h3>

                    {/* MENSAJE DE ERROR DE SINCRONIZACIÓN */}
                    {dbError && !isLoadingProjects && (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                            <AlertCircle size={18} className="text-red-500 shrink-0 mt-0.5" />
                            <div className="text-[11px] leading-tight text-red-700">
                                <p className="font-bold uppercase mb-1">Error de Sincronización</p>
                                <p>No se pudo conectar con la base de datos completa. Por favor, asegúrate de haber ejecutado el script SQL en Supabase.</p>
                                <p className="mt-1 font-mono text-[9px] bg-white/50 p-1 rounded">Detalle: {dbError}</p>
                            </div>
                        </div>
                    )}

                     <div className="mb-4 bg-blue-50 p-4 rounded-xl border border-blue-200 shadow-sm flex flex-col gap-2">
                         <p className="text-[10px] font-bold uppercase tracking-widest text-blue-700 mb-1 text-center font-display flex items-center justify-center gap-2">
                            <Zap size={10} className="fill-blue-700" /> 
                            Automatización de Carga
                         </p>
                         <div className="flex gap-2 mb-1">
                             <button 
                                 onClick={() => handleAutoLoad('CURADOS_NOVEDADES')}
                                 className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white py-2.5 rounded-xl font-black text-[10px] transition-all flex items-center justify-center gap-2 shadow-lg ring-2 ring-blue-500/20"
                             >
                                 <Star size={14} className="fill-white" />
                                 NOVEDADES CURADAS
                             </button>
                             <button 
                                 onClick={() => handleAutoLoad('CURADOS_REIMPRESIONES')}
                                 className="flex-1 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white py-2.5 rounded-xl font-black text-[10px] transition-all flex items-center justify-center gap-2 shadow-lg ring-2 ring-indigo-500/20"
                             >
                                 <RefreshCw size={14} />
                                 REIMP. CURADAS
                             </button>
                         </div>
                         <div className="flex gap-2">
                             <button 
                                 onClick={() => handleAutoLoad('NOVEDADES')}
                                 className="flex-1 bg-white border border-blue-200 hover:bg-slate-50 text-[#1b3a57] py-2 rounded-lg font-black text-[10px] transition-colors flex items-center justify-center gap-1.5"
                             >
                                 NOVEDADES (IVREA)
                             </button>
                             <button 
                                 onClick={() => handleAutoLoad('REIMPRESIONES')}
                                 className="flex-1 bg-white border border-blue-200 hover:bg-slate-50 text-[#1b3a57] py-2 rounded-lg font-black text-[10px] transition-colors flex items-center justify-center gap-1.5"
                             >
                                 REIMP. (IVREA)
                             </button>
                         </div>
                    </div>
                    
                    <div className="space-y-4">
                        {/* SECCIÓN DE PROYECTOS */}
                        <div className="mb-4 bg-orange-50 p-3 rounded-xl border border-orange-200">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#e68219] flex items-center gap-1">
                                    <CheckCircle2 size={12} className="text-[#e68219]" /> Proyectos (Nube)
                                </label>
                                <div className="flex gap-1">
                                    <button onClick={saveProject} className="text-[10px] font-bold bg-[#e68219] text-white px-2 py-1 rounded hover:bg-[#d47617] transition-colors">
                                        {selectedProjectId && savedProjects[selectedProjectId]?.user_id !== user?.id && !isAdmin ? "Guardar Copia" : "Guardar"}
                                    </button>
                                    {selectedProjectId && (savedProjects[selectedProjectId]?.user_id === user?.id || isAdmin) && (
                                        <button onClick={deleteProject} className="text-[10px] font-bold bg-white text-red-600 px-2 py-1 rounded border border-red-100 hover:bg-red-50">Borrar</button>
                                    )}
                                </div>
                            </div>
                            <select 
                                value={selectedProjectId}
                                onChange={(e) => setSelectedProjectId(e.target.value)}
                                className="w-full text-xs font-bold border-2 border-orange-100 outline-none rounded-lg px-3 py-2 bg-white text-[#1b3a57] shadow-sm mb-2"
                            >
                                <option value="">-- Proyectos Disponibles --</option>
                                <optgroup label="Mis Proyectos">
                                    {Object.values(savedProjects).filter(p => p.user_id === user?.id).map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </optgroup>
                                <optgroup label="Otros Proyectos (Solo Lectura)">
                                    {Object.values(savedProjects).filter(p => p.user_id !== user?.id).map(p => (
                                        <option key={p.id} value={p.id}>{p.name} (👤 {p.owner_name})</option>
                                    ))}
                                </optgroup>
                            </select>
                            <div className="flex gap-2">
                                 <button onClick={() => { 
                                     setSelectedProjectId(''); 
                                     setSelectedItems([]);
                                     setConfig({
                                         discountPercent: 20,
                                         headerTag: 'EDICIÓN ESPECIAL',
                                         headerTitle: 'PREVENTA',
                                         headerSubtitle: 'ASEGURA TU PEDIDO • PRECIO ESPECIAL',
                                         dividerText: '★ PRECIOS EXCLUSIVOS POR TIEMPO LIMITADO • ENVÍO A TODA BOLIVIA ★',
                                         footerContact1: 'WHATSAPP: +591 XXXXXXXX',
                                         footerContact2: 'FACEBOOK: Mangas Comics Bolivia Store',
                                         footerContact3: 'LA PAZ, BOLIVIA',
                                         deadlineDate: calcularProximoSabado(),
                                         deadlineTime: ''
                                     });
                                     setStatusMessage("NUEVO PROYECTO"); 
                                     setTimeout(()=>setStatusMessage(""), 2000); 
                                 }} className="w-full text-[10px] font-bold bg-white text-orange-600 border border-orange-200 py-1.5 rounded-lg hover:bg-orange-50 transition-all uppercase">
                                     Nuevo Proyecto en Blanco
                                 </button>
                            </div>
                            {statusMessage && (
                                <div className="text-[10px] font-black text-orange-600 animate-pulse mt-1 flex justify-center uppercase">{statusMessage}</div>
                            )}
                        </div>

                        <div className="mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#1b3a57] flex items-center gap-1">
                                    <Zap size={12} className="text-[#f5a800] fill-current" /> Plantillas
                                </label>
                                <div className="flex gap-1">
                                    <button onClick={saveCurrentAsTemplate} className="text-[10px] font-bold bg-[#1b3a57] text-white px-2 py-1 rounded hover:bg-[#132a41] transition-colors whitespace-nowrap">
                                        {selectedTemplateId && (isAdmin || userTemplates[selectedTemplateId]?.user_id === user?.id) ? "Guardar" : "Guardar Copia"}
                                    </button>
                                    {selectedTemplateId && (isAdmin || userTemplates[selectedTemplateId]?.user_id === user?.id) && (
                                        <>
                                            <button onClick={renameTemplate} className="text-[10px] font-bold bg-slate-200 text-slate-700 px-2 py-1 rounded hover:bg-slate-300 transition-colors">Renombrar</button>
                                            <button onClick={deleteTemplate} className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200 transition-colors">Borrar</button>
                                        </>
                                    )}
                                </div>
                            </div>
                            <select 
                                value={selectedTemplateId}
                                onChange={(e) => setSelectedTemplateId(e.target.value)}
                                className="w-full text-xs font-bold border-2 border-slate-200 focus:border-[#f5a800] outline-none rounded-lg px-3 py-2 bg-white text-[#1b3a57] cursor-pointer shadow-sm transition-all mb-2"
                            >
                                <option value="">-- Plantillas Disponibles --</option>

                                <optgroup label="Mis Plantillas">
                                    {Object.values(userTemplates).filter(t => !t.isDefault && t.user_id === user?.id).map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </optgroup>
                                <optgroup label="Plantillas de Otros">
                                    {Object.values(userTemplates).filter(t => !t.isDefault && t.user_id !== user?.id).map(t => (
                                        <option key={t.id} value={t.id}>{t.name} (👤 {t.owner_name})</option>
                                    ))}
                                </optgroup>
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-1 block">Etiqueta Superior</label>
                                <input type="text" name="headerTag" value={config.headerTag} onChange={handleConfigChange} className="w-full text-xs font-bold border rounded-lg px-3 py-2 bg-slate-50" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-1 block">% Descuento Auto</label>
                                <div className="flex items-center gap-2">
                                    <input type="number" name="discountPercent" value={config.discountPercent} onChange={handleConfigChange} className="w-full text-xs font-bold border rounded-lg px-3 py-2 bg-slate-50" />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-1 block">Título Central</label>
                            <input type="text" name="headerTitle" value={config.headerTitle} onChange={handleConfigChange} className="w-full text-sm font-bold border rounded-lg px-3 py-2 bg-slate-50" />
                        </div>
                        
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-1 block">Subtítulo (Asegura tu pedido...)</label>
                            <textarea name="headerSubtitle" value={config.headerSubtitle} onChange={handleConfigChange} className="w-full text-xs font-semibold border rounded-lg px-3 py-2 bg-slate-50 min-h-[60px] resize-y" />
                        </div>

                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-1 block">Texto del Divisor Estrellado</label>
                            <textarea name="dividerText" value={config.dividerText} onChange={handleConfigChange} className="w-full text-xs font-semibold border rounded-lg px-3 py-2 bg-slate-50 min-h-[80px] resize-y" />
                        </div>

                        <div className="pt-2 border-t border-slate-100">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-2 block">Datos del Pie de Página</label>
                            <div className="space-y-2">
                                <input type="text" name="footerContact1" value={config.footerContact1} onChange={handleConfigChange} placeholder="WhatsApp" className="w-full text-xs font-semibold border rounded-lg px-3 py-2 bg-slate-50 shadow-inner" />
                                <input type="text" name="footerContact2" value={config.footerContact2} onChange={handleConfigChange} placeholder="Facebook" className="w-full text-xs font-semibold border rounded-lg px-3 py-2 bg-slate-50 shadow-inner" />
                                <input type="text" name="footerContact3" value={config.footerContact3} onChange={handleConfigChange} placeholder="Ubicación" className="w-full text-xs font-semibold border rounded-lg px-3 py-2 bg-slate-50 shadow-inner" />
                                <div className="grid grid-cols-2 gap-2 pt-2">
                                     <div>
                                         <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-1 block">Fecha (DD/MES)</label>
                                         <input type="text" name="deadlineDate" value={config.deadlineDate} onChange={handleConfigChange} placeholder="28 / MAR" className="w-full text-xs font-black text-center border rounded-lg px-3 py-2 bg-orange-50 text-[#e68219] uppercase" />
                                     </div>
                                     <div>
                                         <label className="text-[10px] font-bold uppercase tracking-widest text-[#78a2c4] mb-1 block">Hora (HH:MM)</label>
                                         <input type="text" name="deadlineTime" value={config.deadlineTime || ''} onChange={handleConfigChange} placeholder="20:00" className="w-full text-xs font-black text-center border rounded-lg px-3 py-2 bg-slate-50 text-[#1b3a57]" />
                                     </div>
                                </div>
                            </div>

                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-border/40">
                    <h4 className="text-sm font-black text-[#1b3a57] uppercase mb-3 flex items-center gap-2">
                        <Search size={16} /> Buscar Mangas
                    </h4>
                    <div className="space-y-3">
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Buscar por nombre o EAN..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-[#f5a800] transition-colors text-sm font-bold"
                            />
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <select 
                                value={editorialFilter}
                                onChange={(e) => setEditorialFilter(e.target.value)}
                                className="flex-1 min-w-[120px] text-xs font-bold border rounded-lg px-3 py-2 bg-slate-50 text-slate-700"
                            >
                                <option value="TODOS">Editoriales</option>
                                {editorialesList.map(ed => (
                                    <option key={ed} value={ed}>{ed}</option>
                                ))}
                            </select>

                            <select 
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="flex-1 min-w-[120px] text-xs font-bold border rounded-lg px-3 py-2 bg-slate-50 text-slate-700"
                            >
                                <option value="TODOS">Categorías</option>
                                {dynamicCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>

                            <label className="flex items-center gap-2 px-3 py-2 bg-slate-50 border rounded-lg cursor-pointer">
                                <input 
                                    type="checkbox"
                                    checked={reprintsOnlyFilter}
                                    onChange={(e) => setReprintsOnlyFilter(e.target.checked)}
                                    className="accent-[#f5a800]"
                                />
                                <span className="text-xs font-bold text-slate-700">Solo Reimp.</span>
                            </label>
                        </div>
                    </div>

                    {/* Resultados de Búsqueda */}
                    {searchResults.length > 0 && (
                        <div className="mt-2 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden flex flex-col max-h-48 overflow-y-auto custom-scrollbar">
                            {searchResults.map(item => (
                                <button
                                    key={item.product_id}
                                    onClick={() => handleAddItem(item)}
                                    className="text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 flex justify-between items-center group"
                                >
                                    <div className="min-w-0 pr-4 flex items-center gap-2">
                                        <div className="truncate">
                                            <p className="font-bold text-sm text-[#1b3a57] truncate flex items-center gap-2">
                                                {item.titulo}
                                                {item.imagen_url && <ImageIcon size={14} className="text-green-500 shrink-0" title="Ya tiene imagen en catálogo" />}
                                            </p>
                                            <p className="text-xs text-slate-500 font-mono truncate">{item.editorial} • {item.ean_oficial || 'S/EAN'}</p>
                                        </div>
                                    </div>
                                    <span className="shrink-0 text-xs font-bold text-[#f5a800] bg-[#f5a800]/10 px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                        + Añadir
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Ítems Agregados Configuración */}
                <div className="bg-slate-50 p-6 rounded-2xl shadow-inner border border-slate-200 space-y-4 max-h-[700px] overflow-y-auto custom-scrollbar">
                    <div className="flex flex-col gap-3 sticky top-0 bg-slate-50 py-2 z-10 border-b border-slate-200 mb-2">
                        <div className="flex justify-between items-center">
                            <h4 className="text-sm font-black text-[#1b3a57] uppercase flex items-center gap-2">
                                Mangas a Generar ({selectedItems.length})
                            </h4>
                            <span className="text-[10px] font-bold bg-[#1b3a57] text-white px-2 py-1 rounded">
                                {pages.length} Página(s) (8/pág)
                            </span>
                        </div>

                        {/* SELECTOR DE PÁGINA PARA EL EDITOR */}
                        {pages.length > 1 && (
                            <div className="flex gap-1 flex-wrap">
                                {pages.map((_, i) => (
                                    <button 
                                        key={i}
                                        onClick={() => setEditPage(i)}
                                        className={`px-3 py-1 rounded-full text-xs font-black transition-all ${editPage === i ? 'bg-[#f5a800] text-[#1b3a57] shadow-sm scale-110' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                                    >
                                        Pág {i + 1}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    
                    {selectedItems.length === 0 ? (
                        <div className="text-center py-8 text-slate-400 font-semibold text-sm">
                            Añade mangas para estructurar el diseño.
                            <br/><span className="text-xs font-normal">Máximo 8 por página (4x2).</span>
                        </div>
                    ) : (
                        (pages[editPage] || []).map((item, localIdx) => {
                            const globalIdx = editPage * 8 + localIdx;
                            return (
                                <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm border-l-4 border-l-[#f5a800] border-y border-r border-slate-200 relative mb-4">
                                    <button 
                                        onClick={() => handleRemoveItem(item.id)}
                                        className="absolute top-3 right-3 text-red-400 hover:text-red-500 bg-red-50 p-1.5 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                    
                                    <div className="absolute -left-3 -top-3 bg-[#1b3a57] text-[#f5a800] text-[10px] font-black w-6 h-6 flex items-center justify-center rounded-full border-2 border-white shadow-sm">
                                        {globalIdx + 1}
                                    </div>
                                    
                                    <p className="font-black text-[#1b3a57] text-sm pr-8 mb-3 leading-tight mt-1">{item.titulo}</p>
                                    
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 gap-2">
                                            <div className="col-span-2">
                                                <label className="text-[10px] font-bold text-slate-500 block mb-1">Imagen de Portada</label>
                                                <div className="flex gap-2">
                                                    <div className="relative flex-1">
                                                        <input 
                                                            type="text" 
                                                            value={item.customImageUrl?.startsWith('blob:') ? '' : item.customImageUrl}
                                                            onChange={(e) => handleUpdateItem(item.id, 'customImageUrl', e.target.value)}
                                                            placeholder="Link jpg/png"
                                                            disabled={item.customImageUrl?.startsWith('blob:')}
                                                            className="w-full text-xs box-border pl-2 pr-6 py-1.5 border border-slate-200 rounded bg-slate-50 disabled:opacity-50"
                                                        />
                                                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
                                                            {item._persisting && <Loader2 size={12} className="text-blue-500 animate-spin" />}
                                                            {item._persisted && <Cloud size={12} className="text-green-500" title="Guardado en nube de MCB" />}
                                                            {item._persistError && <AlertCircle size={12} className="text-red-400" title="Error: No se pudo auto-guardar" />}
                                                            {item.customImageUrl?.includes('supabase.co/storage') && !item._persisting && !item._persisted && (
                                                                <Cloud size={12} className="text-slate-400 opacity-50" />
                                                            )}
                                                        </div>
                                                    </div>
                                                    <label className="bg-[#1b3a57] hover:bg-[#132a41] text-[#f5a800] px-3 py-1.5 rounded cursor-pointer transition-colors text-xs font-bold flex items-center justify-center whitespace-nowrap shadow-sm">
                                                        Subir Foto
                                                        <input 
                                                            type="file" 
                                                            accept="image/*" 
                                                            className="hidden" 
                                                            onChange={(e) => {
                                                                const file = e.target.files[0];
                                                                if (file) {
                                                                    const url = URL.createObjectURL(file);
                                                                    handleUpdateItem(item.id, 'customImageUrl', url);
                                                                }
                                                            }}
                                                        />
                                                    </label>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 block mb-1">Volumen</label>
                                                <input 
                                                    type="text" 
                                                    value={item.customVol}
                                                    onChange={(e) => handleUpdateItem(item.id, 'customVol', e.target.value)}
                                                    placeholder="Ej. VOL 03"
                                                    className="w-full text-xs font-bold px-2 py-1.5 border border-slate-200 rounded bg-slate-50"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 block mb-1">Editorial (Override)</label>
                                                <input 
                                                    type="text" 
                                                    value={item.overrideText}
                                                    onChange={(e) => handleUpdateItem(item.id, 'overrideText', e.target.value)}
                                                    placeholder={item.editorial}
                                                    className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded bg-slate-50"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 block mb-1">Preventa (BS)</label>
                                                <input 
                                                    type="number" 
                                                    value={item.customPreventa}
                                                    onChange={(e) => handleUpdateItem(item.id, 'customPreventa', parseFloat(e.target.value) || 0)}
                                                    className="w-full font-black text-sm text-[#e68219] px-2 py-1.5 border border-slate-200 rounded bg-orange-50"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-bold text-slate-500 block mb-1">PVP (BS)</label>
                                                <input 
                                                    type="number" 
                                                    value={item.customPvp}
                                                    onChange={(e) => handleUpdateItem(item.id, 'customPvp', parseFloat(e.target.value) || 0)}
                                                    className="w-full font-black text-sm text-slate-700 px-2 py-1.5 border border-slate-200 rounded bg-slate-50"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* PANEL DERECHO: PÓSTER PREVIEW (PAGINADO) */}
            <div className="xl:col-span-8 flex flex-col items-center custom-scrollbar overflow-x-auto pb-8">
                
                <div className="mb-4 w-full flex justify-between items-center max-w-[1080px] gap-2 flex-wrap">
                    <div className="flex items-center gap-2 bg-white p-1 rounded-xl shadow-sm border border-slate-200">
                        <button 
                            onClick={() => setPreviewMode('small')}
                            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${previewMode === 'small' ? 'bg-[#1b3a57] text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                        >Miniaturas</button>
                        <button 
                            onClick={() => setPreviewMode('large')}
                            className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-colors ${previewMode === 'large' ? 'bg-[#1b3a57] text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                        >Página Grande</button>
                    </div>
                    <span className="text-sm font-bold text-slate-500 flex-1 text-center bg-white px-4 py-2 rounded-lg shadow-sm">
                        {pages.length > 1 
                            ? `Generando ${pages.length} páginas para ${selectedItems.length} ítems.` 
                            : 'Vista previa (escala reducida para pantalla).'}
                    </span>
                    <button 
                        onClick={handleExportImage}
                        disabled={isExporting || selectedItems.length === 0}
                        className="bg-[#1b3a57] hover:bg-[#132a41] text-[#f5a800] px-6 py-2.5 rounded-xl font-black disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg"
                    >
                        {isExporting ? <Loader2 className="animate-spin text-white" size={18} /> : <Download size={18} className="text-[#f5a800]" />}
                        {isExporting ? 'Generando ZIP o JPGs...' : `Descargar ${pages.length > 1 ? `(${pages.length}) Páginas` : 'Imagen'}`}
                    </button>
                </div>

                <div className={`flex w-full ${previewMode === 'small' ? 'flex-wrap gap-12 justify-center' : 'flex-col gap-16 items-center'}`}>
                    {pages.map((pageItems, pageIndex) => {
                        const scale = previewMode === 'small' ? 0.38 : 0.62;
                        
                        return (
                            <div key={pageIndex} className="flex flex-col items-center gap-6">
                                <div className="bg-[#1b3a57] text-white px-8 py-2 rounded-full font-black italic shadow-lg uppercase tracking-widest text-lg border-[2px] border-white/10 z-20">
                                    PÁGINA {pageIndex + 1}
                                </div>
                                
                                <div 
                                    className="bg-[#1b3a57] rounded-3xl shadow-[0_45px_100px_rgba(0,0,0,0.6)] overflow-hidden border-[2px] border-white/5 origin-top p-0.5"
                                    style={{ 
                                        width: `${1080 * scale}px`, 
                                        height: `${1680 * scale}px`
                                    }}
                                >
                                    <div 
                                        style={{ 
                                            width: '1080px', 
                                            height: '1680px', 
                                            transform: `scale(${scale})`, 
                                            transformOrigin: 'top left' 
                                        }}
                                    >
                                        <PosterPageContent pageItems={pageItems} pageIndex={pageIndex} idPrefix="uipreview-page" />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* HIDDEN EXPORT AREA (Always 1:1 Scale) */}
                {/* Posicionado fuera de pantalla con tamaño real para captura correcta */}
                <div style={{ position: 'fixed', left: '-5000px', top: '0', opacity: 0, pointerEvents: 'none', zIndex: -1000 }}>
                    {pages.map((pageItems, pageIndex) => (
                        <div key={pageIndex}>
                             <PosterPageContent pageItems={pageItems} pageIndex={pageIndex} idPrefix="export-page" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
