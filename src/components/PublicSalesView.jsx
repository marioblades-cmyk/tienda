import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { Search, ShoppingBag, X, Check, ArrowRight, MessageCircle, Info, Filter, User, Sparkles, RefreshCw, Phone, Edit3, Library, Image as ImageIcon, Truck, Calendar, Minus, Plus } from 'lucide-react';

export default function PublicSalesView() {
    const getBoliviaTime = () => {
        return new Date(new Date().toLocaleString(
            'en-US', { timeZone: 'America/La_Paz' }
        ));
    };

    const [activeSection, setActiveSection] = useState('catalogo'); // 'catalogo' | 'cuenta'
    const [catalog, setCatalog] = useState([]);
    const [semanas, setSemanas] = useState([]);
    const [nextDeliveries, setNextDeliveries] = useState({}); // Mapa de titulo -> nombre_semana
    const [flotanteLoaded, setFlotanteLoaded] = useState(false);
    const [loading, setLoading] = useState(true);

    const normalizeTitle = (s) => (s||'').toLowerCase().replace(/\s+/g,' ').trim();
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('todos');

    // Carrito y Modales
    // Carrito con Persistencia
    const [cart, setCart] = useState(() => {
        try {
            const saved = localStorage.getItem('mcb_cart');
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });

    useEffect(() => {
        try {
            localStorage.setItem('mcb_cart', JSON.stringify(cart));
        } catch {}
    }, [cart]);
    const [checkoutMode, setCheckoutMode] = useState(false);
    const [isConfirmed, setIsConfirmed] = useState(false);

    // Formulario de Cliente (Checkout)
    const [clientForm, setClientForm] = useState({
        nombre: '',
        celular: '',
        ci: '',
        ciudad: '',
        sucursal: '',
        direccion: '',
        notas: ''
    });

    // Portal Mi Cuenta
    const [accountPhone, setAccountPhone] = useState('');
    const [accountUser, setAccountUser] = useState(null);
    const [accountOrders, setAccountOrders] = useState([]);
    const [accountLoading, setAccountLoading] = useState(false);
    const [isEditingData, setIsEditingData] = useState(false);
    const [displayLimit, setDisplayLimit] = useState(50);

    useEffect(() => {
        fetchCatalog();
    }, []);

    const fetchCatalog = async () => {
        setLoading(true);
        try {
            // Validación de Versión de Caché (Auto-limpieza)
            const CACHE_VERSION = 'v3'; 
            const cachedVersion = localStorage.getItem('mcb_catalog_version');

            if (cachedVersion !== CACHE_VERSION) {
                localStorage.removeItem('mcb_catalog_full_cache');
                localStorage.removeItem('mcb_catalog_cache_time');
                localStorage.setItem('mcb_catalog_version', CACHE_VERSION);
            }

            // FASE 1: Carga Ultra-Rápida de Novedades y Preventas
            // Esto permite que la parte de arriba de la página cargue al instante
            const featured = await catalogService.fetchFeaturedOnly();
            setCatalog(featured);
            setLoading(false); // Ya podemos mostrar las novedades

            // FASE 2: Carga en segundo plano del resto (9000 items)
            // Se usa la caché (false) para que sea instantáneo si ya se visitó
            const prods = await catalogService.fetchFullCatalog(false);
            setCatalog(prods);

            // Cargar Semanas (Limitado a las últimas 8 para rendimiento)
            const { data: sems, error: sErr } = await supabase
                .from('semanas')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(8);

            if (sErr) throw sErr;
            setSemanas(sems || []);

            // FASE 3: Cargar Próximas Entregas (Caché + Query Optimizada)
            if (sems && sems.length > 0) {
                const CACHE_KEY = 'mcb_delivery_map_v2';
                const CACHE_TIME_KEY = 'mcb_delivery_time_v2';
                const CACHE_MINUTES = 20;

                let cacheHit = false;
                try {
                    const cached = localStorage.getItem(CACHE_KEY);
                    const cachedTime = localStorage.getItem(CACHE_TIME_KEY);
                    const ageMinutes = (Date.now() - parseInt(cachedTime || 0)) / 60000;

                    if (cached && ageMinutes < CACHE_MINUTES) {
                        setNextDeliveries(JSON.parse(cached));
                        cacheHit = true;
                    }
                } catch (e) {
                    console.warn('Caché flotante inválido');
                }

                if (!cacheHit) {
                    const recentSems = [...sems].reverse(); 
                    const recentSemIds = recentSems.map(s => s.id);
                
                const { data: masters } = await supabase
                    .from('master_confirmaciones')
                    .select('semana_id, datos_json')
                    .in('semana_id', recentSemIds);

                // BLOQUE OPTIMIZADO: 3 queries paralelas en lugar de 50+
                const [clientItemsRes, recepcionesRes, allOrdersRes] = await Promise.all([
                    supabase.from('cliente_items')
                        .select('semana_id, titulo, estado')
                        .in('semana_id', recentSemIds),
                    supabase.from('pedido_items_recepcion')
                        .select('semana_id, titulo, cantidad_recibida')
                        .in('semana_id', recentSemIds),
                    supabase.from('pedido_items')
                        .select('cantidad, titulo, pedido:pedidos!inner(semana_id, tipo)')
                        .in('pedido.semana_id', recentSemIds)
                        .limit(5000)
                ]);

                const recepciones = recepcionesRes.data || [];
                const allOrdersData = allOrdersRes.data || [];

                // Reconstruir nextDeliveries con unidades reales
                const deliveryMap = {};

                // 1. SEMANAS CONFIRMADAS (Con master_confirmaciones)
                (sems || []).forEach(week => {
                    const master = (masters || []).find(m => m.semana_id === week.id);
                    if (!master) return;

                    const fechaArribo = week.fecha_estimada_llegada 
                        ? new Date(week.fecha_estimada_llegada)
                        : new Date(new Date(week.created_at).getTime() + (22 * 24 * 60 * 60 * 1000));

                    const fechaBase = fechaArribo.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });

                    (master.datos_json || []).forEach(item => {
                        const key = normalizeTitle(item.titulo);
                        const confirmado = item.cantidad || 0;
                        
                        const recibido = recepciones
                            .filter(r => r.semana_id === week.id && normalizeTitle(r.titulo) === key)
                            .reduce((sum, r) => sum + (r.cantidad_recibida || 0), 0);

                        const reservado = (clientItemsRes.data || [])
                            .filter(ci => ci.semana_id === week.id && normalizeTitle(ci.titulo) === key && 
                                (ci.estado?.includes('ADJUDICADO') || ci.estado?.includes('CONFIRMADO')))
                            .length;

                        const disponible = Math.max(0, confirmado - recibido - reservado);

                        if (disponible <= 0) return;

                            deliveryMap[key] = {
                                nombre: week.nombre,
                                fecha: fechaBase,
                                fechaFull: fechaArribo,
                                fechaFormateada: fechaBase,
                                disponible,
                                confirmado: true,
                                semanaId: week.id
                            };
                    });
                });

                // 2. SEMANAS EN PREVENTA (Sin master aún)
                (sems || []).forEach(week => {
                    const hasMaster = (masters || []).some(m => m.semana_id === week.id);
                    if (hasMaster) return;

                    const fechaArribo = week.fecha_estimada_llegada 
                        ? new Date(week.fecha_estimada_llegada)
                        : new Date(new Date(week.created_at).getTime() + (22 * 24 * 60 * 60 * 1000));

                    const fechaBase = fechaArribo.toLocaleDateString('es-BO', { day: 'numeric', month: 'short' });

                    const weekOrders = allOrdersData.filter(o => o.pedido?.semana_id === week.id);
                    const titlesInWeek = [...new Set(weekOrders.map(o => normalizeTitle(o.titulo)))];

                    titlesInWeek.forEach(key => {
                        const storeTotal = weekOrders
                            .filter(o => normalizeTitle(o.titulo) === key && o.pedido?.tipo === 'tienda')
                            .reduce((sum, o) => sum + (o.cantidad || 0), 0);

                        const personalTotal = weekOrders
                            .filter(o => normalizeTitle(o.titulo) === key && o.pedido?.tipo === 'personal')
                            .reduce((sum, o) => sum + (o.cantidad || 0), 0);

                        const clientWaitlist = (clientItemsRes.data || [])
                            .filter(ci => ci.semana_id === week.id && normalizeTitle(ci.titulo) === key && 
                                (ci.estado || '').includes('PEDIDO'))
                            .length;

                        const storeClientWaitlist = Math.max(0, clientWaitlist - personalTotal);
                        const disponible = Math.max(0, storeTotal - storeClientWaitlist);

                        if (disponible <= 0) return;

                            deliveryMap[key] = {
                                nombre: week.nombre,
                                fecha: fechaBase,
                                fechaFull: fechaArribo,
                                fechaFormateada: fechaBase,
                                disponible,
                                confirmado: false,
                                semanaId: week.id
                            };
                    });
                });

                // Guardar en Caché antes de actualizar estado
                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify(deliveryMap));
                    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
                } catch (e) {
                    console.warn('Error al guardar caché de stock flotante');
                }

                    setNextDeliveries(deliveryMap);
                }
            }
            
            // Se activaba aquí antes, pero ahora se movió al finally para seguridad total
        } catch (error) {
            console.error('Error en fetchCatalog:', error?.message, error);
        } finally {
            setLoading(false);
            setFlotanteLoaded(true);
        }
    };

    // Helper para extraer fecha bonita de un objeto de entrega
    const formatDeliveryDate = (sem) => {
        if (!sem) return '';
        const d = sem.fecha_estimada_llegada 
            ? new Date(sem.fecha_estimada_llegada) 
            : new Date(new Date(sem.created_at).getTime() + (21 * 24 * 60 * 60 * 1000));
        return d.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' });
    };

    // Mi Cuenta - Buscar órdenes por celular
    const handleAccountLookup = async (e) => {
        if (e) e.preventDefault();
        if (!accountPhone.trim()) return;

        setAccountLoading(true);
        try {
            const { data: client, error: cErr } = await supabase
                .from('clientes')
                .select('*')
                .eq('celular', accountPhone.trim())
                .maybeSingle();

            if (cErr) throw cErr;

            if (!client) {
                alert('No se encontró ninguna cuenta vinculada a este celular.');
                setAccountUser(null);
                setAccountOrders([]);
                return;
            }

            setAccountUser(client);

            const { data: items, error: iErr } = await supabase
                .from('cliente_items')
                .select('*')
                .eq('cliente_id', client.id)
                .order('created_at', { ascending: false });

            if (iErr) throw iErr;
            setAccountOrders(items || []);
        } catch (err) {
            console.error('Error retrieving account:', err);
            alert('Error al consultar tu cuenta. Intenta nuevamente.');
        } finally {
            setAccountLoading(false);
        }
    };

    // Actualizar datos de Mi Cuenta
    const handleUpdateAccountData = async (e) => {
        e.preventDefault();
        if (!accountUser.nombre || !accountUser.celular) return;

        setAccountLoading(true);
        try {
            const { error } = await supabase
                .from('clientes')
                .update({
                    nombre: accountUser.nombre,
                    ci: accountUser.ci,
                    ciudad: accountUser.ciudad,
                    sucursal: accountUser.sucursal,
                    direccion: accountUser.direccion,
                    notas: accountUser.notas
                })
                .eq('id', accountUser.id);

            if (error) throw error;

            alert('Datos actualizados con éxito.');
            setIsEditingData(false);
        } catch (err) {
            console.error(err);
            alert('Error al actualizar datos.');
        } finally {
            setAccountLoading(false);
        }
    };

    // Series Completas Detector
    const seriesCompletas = useMemo(() => {
        const VOLUME_REGEX = /(?:vol(?:umen|ume|\.)?\s*|tomo\s*|#\s*)(\d+)(?:\s*\(.*?\))?\s*$/i;
        const TRAILING_NUM_REGEX = /\s+(\d{1,3})(?:\s*\(.*?\))?\s*$/;
        const groups = {};

        catalog.forEach(item => {
            const titulo = (item.titulo || '').trim();
            let serieNombre = null;
            let tomoNum = null;

            const volMatch = titulo.match(VOLUME_REGEX);
            if (volMatch) {
                tomoNum = parseInt(volMatch[1], 10);
                serieNombre = titulo.slice(0, volMatch.index).trim().replace(/[-–:\s]+$/, '').trim();
            } else {
                const numMatch = titulo.match(TRAILING_NUM_REGEX);
                if (numMatch) {
                    tomoNum = parseInt(numMatch[1], 10);
                    serieNombre = titulo.slice(0, numMatch.index).trim().replace(/[-–:\s]+$/, '').trim();
                }
            }

            if (!serieNombre || tomoNum === null || isNaN(tomoNum)) return;
            const key = serieNombre.toUpperCase().trim();

            if (!groups[key]) groups[key] = { nombre: serieNombre, editorial: item.editorial, tomos: {} };
            groups[key].tomos[tomoNum] = { stock: item.stock_fisico || 0, item };
        });

        const completas = [];
        Object.values(groups).forEach(serie => {
            const numeros = Object.keys(serie.tomos).map(Number).sort((a, b) => a - b);
            if (numeros.length < 2) return; 
            const maxTomo = numeros[numeros.length - 1];
            const minTomo = numeros[0];

            let completa = true;
            for (let t = minTomo; t <= maxTomo; t++) {
                if (!serie.tomos[t] || (serie.tomos[t].stock || 0) < 1) {
                    completa = false;
                    break;
                }
            }
            if (!completa) return;

            const stockMin = Math.min(...numeros.map(n => serie.tomos[n].stock));
            const primerTomo = serie.tomos[minTomo]?.item;

            completas.push({
                nombre: serie.nombre,
                editorial: serie.editorial || primerTomo?.editorial || '—',
                imagen: primerTomo?.imagen_url || null,
                totalTomos: maxTomo - minTomo + 1,
                minTomo,
                maxTomo,
                stockMin,
                tomos: serie.tomos,
                items: numeros.map(n => serie.tomos[n].item)
            });
        });

        return completas.sort((a, b) => a.nombre.localeCompare(b.nombre));
    }, [catalog]);

    // Filtrar catálogo por búsqueda y categorías y priorizar Ivrea
    const filteredCatalog = useMemo(() => {
        // Solo mostrar productos marcados como visibles (por defecto true)
        let list = catalog.filter(p => p.visible_web !== false);

        if (search.trim()) {
            const lowSearch = search.toLowerCase().trim();
            list = list.filter(p => 
                p.titulo?.toLowerCase().includes(lowSearch) || 
                p.editorial?.toLowerCase().includes(lowSearch)
            );
        }

        if (selectedCategory !== 'todos') {
            list = list.filter(p => p.editorial === selectedCategory);
        }

        // Ordenar: Prioridad a Ivrea, luego alfabético
        list = list.sort((a, b) => {
            const aIsIvrea = (a.editorial || '').toLowerCase().includes('ivrea');
            const bIsIvrea = (b.editorial || '').toLowerCase().includes('ivrea');
            if (aIsIvrea && !bIsIvrea) return -1;
            if (!aIsIvrea && bIsIvrea) return 1;
            return (a.titulo || '').localeCompare(b.titulo || '');
        });

        return list;
    }, [catalog, search, selectedCategory]);

    // Novedades Curadas (Estrenos)
    const novelties = useMemo(() => {
        return catalog
            .filter(p => p.es_novedad_semana === true && p.es_reimpresion !== true)
            .sort((a, b) => {
                const edA = (a.editorial || '').toUpperCase();
                const edB = (b.editorial || '').toUpperCase();
                
                // Priorizar IVREA
                const isIvreaA = edA.includes('IVREA');
                const isIvreaB = edB.includes('IVREA');
                if (isIvreaA && !isIvreaB) return -1;
                if (!isIvreaA && isIvreaB) return 1;
                
                // Si ambos son Ivrea o ambos no lo son, ordenar por Editorial alfabéticamente
                if (edA !== edB) return edA.localeCompare(edB);
                
                // Si son la misma editorial, por fecha
                return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            });
    }, [catalog]);

    // Reimpresiones Curadas (Reposiciones Destacadas)
    const featuredReprints = useMemo(() => {
        return catalog
            .filter(p => p.es_novedad_semana === true && p.es_reimpresion === true)
            .sort((a, b) => {
                const edA = (a.editorial || '').toUpperCase();
                const edB = (b.editorial || '').toUpperCase();
                
                const isIvreaA = edA.includes('IVREA');
                const isIvreaB = edB.includes('IVREA');
                if (isIvreaA && !isIvreaB) return -1;
                if (!isIvreaA && isIvreaB) return 1;
                
                if (edA !== edB) return edA.localeCompare(edB);
                return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            });
    }, [catalog]);

    // Obtener las categorías (Editoriales) disponibles
    const categories = useMemo(() => {
        const unique = new Set(catalog.map(p => p.editorial).filter(Boolean));
        return ['todos', ...Array.from(unique).sort()];
    }, [catalog]);

    // Cálculo dinámico de entrega
    const getAvailabilityStatus = (item) => {
      const stockFisico = item.stock_fisico || 0;
      const agotado = item.agotado_distribuidor === true;

      if (stockFisico > 0) {
        return {
          label: '¡En Stock! Entrega inmediata',
          color: 'bg-green-500/20 border-green-500/40 text-green-400',
          icon: '📦',
          canOrder: true,
          agotado: false,
          semanaId: null
        };
      }

      if (agotado) {
        return {
          label: 'Agotado',
          color: 'bg-red-500/20 border-red-500/40 text-red-400',
          icon: '❌',
          canOrder: false,
          agotado: true,
          semanaId: null
        };
      }

      if (!flotanteLoaded) {
        return {
          label: 'Verificando disponibilidad...',
          color: 'bg-gray-500/20 border-gray-500/40 text-gray-400',
          icon: '⏳',
          canOrder: false,
          agotado: false,
          semanaId: null
        };
      }

      const key = normalizeTitle(item.titulo);
      const nextDelivery = nextDeliveries[key];

      if (nextDelivery) {
        const isConfirmado = nextDelivery.confirmado === true;
        return {
          label: isConfirmado 
            ? `Bajo pedido (${nextDelivery.fechaFormateada})`
            : `A pedido (pend. confirmación - ${nextDelivery.fechaFormateada})`,
          color: isConfirmado
            ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400'
            : 'bg-orange-500/20 border-orange-500/40 text-orange-400',
          icon: isConfirmado ? '🕐' : '⏳',
          canOrder: true,
          agotado: false,
          fecha: nextDelivery.fechaFormateada,
          semanaId: nextDelivery.semanaId
        };
      }

      // Cálculo de fecha con hora Bolivia y corte de 11:30 AM del sábado
      const ahora = getBoliviaTime();
      const diaSemana = ahora.getDay();
      const hora = ahora.getHours();
      const minutos = ahora.getMinutes();
      const antesDelCorte = hora < 11 || (hora === 11 && minutos < 30);

      let diasHastaSabado;
      if (diaSemana === 6 && antesDelCorte) {
        diasHastaSabado = 0; // Hoy es sábado, antes del corte
      } else if (diaSemana === 6) {
        diasHastaSabado = 7; // Sábado pasado el corte
      } else {
        diasHastaSabado = (6 - diaSemana + 7) % 7 || 7;
      }

      const proximoSabado = new Date(ahora);
      proximoSabado.setDate(ahora.getDate() + diasHastaSabado);

      const fechaEst = new Date(proximoSabado);
      fechaEst.setDate(proximoSabado.getDate() + 22);

      const fechaFormateada = fechaEst.toLocaleDateString(
        'es-BO', { day: 'numeric', month: 'short' }
      );

      return {
        label: `A pedido (pend. confirmación - ${fechaFormateada})`,
        color: 'bg-orange-500/20 border-orange-500/40 text-orange-400',
        icon: '⏳',
        canOrder: true,
        agotado: false,
        fecha: fechaFormateada,
        semanaId: null
      };
    };

    // Funciones Carrito
    const addToCart = (product, status) => {
        if (!status?.canOrder) return;
        const existing = cart.find(c => c.id === product.id);
        const semanaId = status?.semanaId || null;
        
        if (existing) {
            setCart(cart.map(c => c.id === product.id ? { ...c, qty: c.qty + 1, semana_id: semanaId } : c));
        } else {
            setCart([...cart, { ...product, qty: 1, semana_id: semanaId }]);
        }
    };

    const addSeriesToCart = (serie) => {
        // Adds all items in a complete series to cart
        let newCart = [...cart];
        serie.items.forEach(product => {
            const existing = newCart.find(c => c.id === product.id);
            if (existing) {
                newCart = newCart.map(c => c.id === product.id ? { ...c, qty: c.qty + 1 } : c);
            } else {
                newCart.push({ ...product, qty: 1 });
            }
        });
        setCart(newCart);
        alert(`Se han añadido los ${serie.totalTomos} tomos de la serie ${serie.nombre} al carrito.`);
    };

    const removeFromCart = (pid) => {
        setCart(cart.filter(c => c.id !== pid));
    };

    const totalCart = useMemo(() => {
        return cart.reduce((acc, c) => acc + ((c.precio_venta_bs || c.precio_tapa || 0) * c.qty), 0);
    }, [cart]);

    const fechaEntregaFormateada = useMemo(() => {
        if (cart.length === 0) return null;
        
        // Si TODOS los items tienen stock físico
        const todoEnStock = cart.every(item => (item.stock_fisico || 0) > 0);
        if (todoEnStock) return 'INMEDIATA';
        
        // Calcular fecha más lejana
        const fechaMaxima = cart.reduce((maxFecha, item) => {
            const status = getAvailabilityStatus(item);
            if (!status.fecha) return maxFecha;
            
            const delivery = nextDeliveries[normalizeTitle(item.titulo)];
            const fechaItem = delivery?.fechaFull 
                ? new Date(delivery.fechaFull)
                : (() => {
                    const hoy = new Date();
                    const diasHastaSabado = (6 - hoy.getDay() + 7) % 7 || 7;
                    const sabado = new Date(hoy);
                    sabado.setDate(hoy.getDate() + diasHastaSabado);
                    sabado.setDate(sabado.getDate() + 22);
                    return sabado;
                })();
            
            return fechaItem > maxFecha ? fechaItem : maxFecha;
        }, new Date(0));

        return fechaMaxima > new Date(0)
            ? fechaMaxima.toLocaleDateString('es-BO', { day: 'numeric', month: 'long' })
            : null;
    }, [cart, nextDeliveries, getAvailabilityStatus]);

    // Procesamiento de Orden
    const handleCheckoutSubmit = async (e) => {
        e.preventDefault();
        if (!clientForm.nombre || !clientForm.celular) {
            alert('Por favor completa los datos de contacto obligatorios.');
            return;
        }

        setLoading(true);
        try {
            let { data: existingClient } = await supabase
                .from('clientes')
                .select('*')
                .eq('celular', clientForm.celular)
                .maybeSingle();

            let clientId;

            if (existingClient) {
                clientId = existingClient.id;
                await supabase
                    .from('clientes')
                    .update({
                        nombre: clientForm.nombre,
                        ci: clientForm.ci || existingClient.ci,
                        ciudad: clientForm.ciudad || existingClient.ciudad,
                        sucursal: clientForm.sucursal || existingClient.sucursal,
                        direccion: clientForm.direccion || existingClient.direccion,
                        notas: clientForm.notas || existingClient.notas
                    })
                    .eq('id', clientId);
            } else {
                const { data: newClient, error: clErr } = await supabase
                    .from('clientes')
                    .insert([{
                        nombre: clientForm.nombre,
                        celular: clientForm.celular,
                        ci: clientForm.ci,
                        ciudad: clientForm.ciudad,
                        sucursal: clientForm.sucursal,
                        direccion: clientForm.direccion,
                        notas: clientForm.notas
                    }])
                    .select()
                    .single();

                if (clErr) throw clErr;
                clientId = newClient.id;
            }

            for (const item of cart) {
                // DESCUENTO DE STOCK DISPONIBLE (Reserva)
                // Buscamos el producto actual para estar seguros de su stock
                const { data: currentProd } = await supabase
                    .from('catalogo_productos')
                    .select('stock_disponible, stock_fisico')
                    .eq('id', item.id)
                    .single();

                if (currentProd) {
                    const newDisponible = Math.max(0, (currentProd.stock_disponible || 0) - item.qty);
                    // Actualizamos stock_disponible (reserva)
                    await supabase
                        .from('catalogo_productos')
                        .update({ 
                            stock_disponible: newDisponible,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', item.id);
                }

                for (let i = 0; i < item.qty; i++) {
                    const { error: itErr } = await supabase
                        .from('cliente_items')
                        .insert([{
                            cliente_id: clientId,
                            titulo: item.titulo,
                            product_id: item.id,
                            precio_venta: Number(item.precio_venta_bs || item.precio_tapa || 0),
                            monto_pagado: 0,
                            estado: 'POR CONFIRMAR',
                            vendedor_id: '50965707-16d7-463c-912f-65935b0b2d6d', // ID Tienda/Web por defecto
                            nota: `Venta Web - Fecha de compra: ${new Date().toLocaleDateString()}`
                        }]);

                    if (itErr) throw itErr;
                }
            }
            
            // Refrescar catálogo local para reflejar stock descontado
            await fetchCatalog();

            setIsConfirmed(true);
        } catch (error) {
            console.error('Error al registrar la compra:', error);
            alert('Hubo un error al procesar tu pedido. Intenta nuevamente.');
        } finally {
            setLoading(false);
        }
    };

    const handleWhatsAppSubmit = () => {
        const itemsList = cart.map(c => `- ${c.titulo} x${c.qty} (${(c.precio_venta_bs || c.precio_tapa || 0) * c.qty} Bs)`).join('\n');
        const text = `¡Hola Mangas Comics Bolivia Store! Acabo de hacer un pedido web:\n\n*Mis Datos:*\n- Nombre: ${clientForm.nombre}\n- Celular: ${clientForm.celular}\n\n*Pedido:*\n${itemsList}\n\n*Total a pagar:* ${totalCart.toFixed(2)} Bs\n\n¿Me confirman los detalles del pago por favor?`;
        window.open(`https://wa.me/59175111355?text=${encodeURIComponent(text)}`, '_blank');
    };



    return (
        <div className="bg-[#f8fafc] text-slate-800 min-h-screen flex flex-col font-sans antialiased relative pb-12">
            {/* ── SECCIÓN PRINCIPAL ── */}
            {/* ── BOTÓN FLOTANTE DE WHATSAPP ── */}
            <a
                href="https://wa.me/59175111355?text=¡Hola!%20Quisiera%20consultar%20sobre%20unos%20mangas."
                target="_blank"
                rel="noreferrer"
                className="fixed bottom-6 right-6 z-50 bg-green-500 hover:bg-green-400 text-white p-4 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 transform hover:scale-110 border border-green-400/30 group animate-bounce select-none"
                title="Comunícate por WhatsApp"
            >
                <MessageCircle size={28} />
            </a>

            {/* ── NAVBAR SUPERIOR (TABS) ── */}
            <nav className="sticky top-0 z-40 bg-[#1a2d42] border-b border-white/5 flex justify-between items-center px-4 md:px-8 py-3 shrink-0 shadow-lg">
                <div className="flex items-center gap-3 cursor-pointer select-none group" onClick={() => setActiveSection('catalogo')}>
                    <img src="/logo.png" alt="Logo" className="w-10 h-10 object-contain drop-shadow-md rounded-md group-hover:scale-110 transition-transform" onError={(e) => e.target.style.display='none'} />
                    <span className="font-display text-lg md:text-xl font-black tracking-wider text-white hidden sm:block">
                        MANGAS <span className="text-primary">COMICS</span> BOLIVIA STORE
                    </span>
                    {/* Versión corta para móviles */}
                    <span className="font-display text-lg font-black tracking-wider text-white sm:hidden">
                        MC STORE
                    </span>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveSection('cuenta')}
                        className={`flex items-center gap-2 px-3 md:px-4 py-2.5 rounded-xl text-xs font-black font-mono tracking-wider transition-all select-none border ${activeSection === 'cuenta' ? 'bg-primary/20 text-primary border-primary/30 shadow-md' : 'text-slate-300 hover:text-white border-transparent hover:bg-white/5'}`}
                    >
                        <User size={16} />
                        <span className="hidden sm:inline">MI CUENTA</span>
                    </button>
                    <button
                        onClick={() => { window.location.search = ''; window.location.hash = ''; window.location.reload(); }}
                        className="flex items-center gap-2 px-3 py-2 text-white/50 hover:text-[#f07d2a] transition-all select-none text-xs bg-white/5 rounded-xl border border-white/5"
                    >
                        LOGIN
                    </button>
                </div>
            </nav>

            {activeSection === 'cuenta' ? (
                /* ── PESTAÑA MI CUENTA (PORTAL DE CLIENTE) ── */
                <div className="max-w-4xl mx-auto w-full px-4 md:px-6 py-10 flex flex-col gap-8 flex-1 animate-fadeIn">
                    <div className="text-center">
                        <h2 className="text-3xl font-display font-black tracking-tight text-[#1a2d42] mb-1">Mi Cuenta y Pedidos</h2>
                        <span className="text-slate-500 text-xs leading-relaxed">Consulta tu historial de pedidos, estados de entrega y edita tus datos</span>
                    </div>

                    {!accountUser ? (
                        /* Login de Cliente con Celular */
                        <div className="max-w-md mx-auto w-full bg-[#1a2d42] border border-[#1a2d42]/10 p-6 rounded-3xl shadow-xl">
                            <h3 className="text-sm font-black text-white font-mono tracking-wider uppercase mb-3 text-center">Ingresa tu Celular para Consultar</h3>
                            <form onSubmit={handleAccountLookup} className="flex flex-col gap-4">
                                <div className="relative flex items-center">
                                    <Phone className="absolute left-4 text-slate-400" size={16} />
                                    <input
                                        type="text"
                                        value={accountPhone}
                                        onChange={(e) => setAccountPhone(e.target.value)}
                                        required
                                        className="w-full bg-black/30 border border-white/10 pl-11 pr-4 py-3.5 rounded-xl text-white text-sm focus:outline-none focus:border-primary transition-all font-mono tracking-wider"
                                        placeholder="Ej: 78945612"
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={accountLoading}
                                    className="w-full bg-primary hover:bg-secondary text-slate-900 font-black p-3.5 rounded-xl transition-all duration-200 shadow-xl shadow-primary/10 select-none flex items-center justify-center gap-2"
                                >
                                    {accountLoading ? <RefreshCw className="animate-spin" size={18} /> : 'Continuar'}
                                    <ArrowRight size={18} />
                                </button>
                            </form>
                        </div>
                    ) : (
                        /* Perfil y Pedidos */
                        <div className="flex flex-col gap-6">
                            {/* Información del Cliente */}
                            <div className="bg-[#1a2d42] p-6 rounded-3xl shadow-md flex flex-col md:flex-row justify-between gap-4 border border-white/5">
                                <div className="space-y-1">
                                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                        ¡Bienvenido, {accountUser.nombre || 'Cliente'}!
                                    </h3>
                                    <span className="text-xs text-slate-300 block">Celular: {accountUser.celular}</span>
                                    <span className="text-xs text-slate-300 block">C.I.: {accountUser.ci || 'No especificado'}</span>
                                    <span className="text-xs text-slate-300 block">Ciudad: {accountUser.ciudad || 'No especificada'}</span>
                                    <span className="text-xs text-slate-300 block">Sucursal/Dirección: {accountUser.sucursal || 'No especificada'}</span>
                                </div>

                                <div className="flex items-center gap-3 self-end md:self-center">
                                    <button
                                        onClick={() => setIsEditingData(!isEditingData)}
                                        className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold px-3.5 py-2.5 rounded-xl text-xs transition-all select-none"
                                    >
                                        <Edit3 size={16} />
                                        Editar Mis Datos
                                    </button>
                                    <button
                                        onClick={() => { setAccountUser(null); setAccountOrders([]); setAccountPhone(''); }}
                                        className="bg-white/5 hover:bg-white/10 text-slate-300 px-3.5 py-2.5 rounded-xl text-xs transition-all select-none border border-white/5"
                                    >
                                        Salir
                                    </button>
                                </div>
                            </div>

                            {/* Formulario de Edición */}
                            {isEditingData && (
                                <form onSubmit={handleUpdateAccountData} className="bg-white border border-slate-200 p-6 rounded-3xl shadow-md flex flex-col gap-4 animate-fadeIn">
                                    <h4 className="text-sm font-black font-mono tracking-widest text-primary uppercase">Editar Mis Datos Personales</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-black font-mono tracking-widest text-slate-500 uppercase block mb-1">Nombre Completo</label>
                                            <input
                                                type="text"
                                                value={accountUser.nombre || ''}
                                                onChange={(e) => setAccountUser({ ...accountUser, nombre: e.target.value })}
                                                required
                                                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-slate-800 focus:outline-none focus:border-primary text-sm transition-all"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs font-black font-mono tracking-widest text-slate-500 uppercase block mb-1">C.I.</label>
                                            <input
                                                type="text"
                                                value={accountUser.ci || ''}
                                                onChange={(e) => setAccountUser({ ...accountUser, ci: e.target.value })}
                                                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-slate-800 focus:outline-none focus:border-primary text-sm transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-xs font-black font-mono tracking-widest text-slate-500 uppercase block mb-1">Ciudad</label>
                                            <input
                                                type="text"
                                                value={accountUser.ciudad || ''}
                                                onChange={(e) => setAccountUser({ ...accountUser, ciudad: e.target.value })}
                                                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-slate-800 focus:outline-none focus:border-primary text-sm transition-all"
                                            />
                                        </div>

                                        <div>
                                            <label className="text-xs font-black font-mono tracking-widest text-slate-500 uppercase block mb-1">Dirección / Sucursal</label>
                                            <input
                                                type="text"
                                                value={accountUser.sucursal || ''}
                                                onChange={(e) => setAccountUser({ ...accountUser, sucursal: e.target.value })}
                                                className="w-full bg-slate-50 border border-slate-200 p-3 rounded-xl text-slate-800 focus:outline-none focus:border-primary text-sm transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex gap-2 justify-end mt-2">
                                        <button
                                            type="button"
                                            onClick={() => setIsEditingData(false)}
                                            className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:border-slate-300 transition-all select-none"
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="submit"
                                            className="px-4 py-2 bg-primary hover:bg-secondary text-slate-900 font-black rounded-xl text-xs transition-all select-none"
                                        >
                                            Guardar Cambios
                                        </button>
                                    </div>
                                </form>
                            )}

                            {/* Listado de Pedidos */}
                            <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-md flex-1">
                                <h3 className="text-sm font-black font-mono tracking-widest text-slate-800 uppercase mb-4">Historial y Estado de Pedidos</h3>
                                {accountOrders.length === 0 ? (
                                    <div className="text-center py-10 bg-slate-50 border border-slate-100 rounded-2xl">
                                        <span className="text-xs text-slate-500">Aún no has registrado ningún pedido.</span>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead>
                                                <tr className="border-b border-slate-200 text-slate-500 uppercase font-mono tracking-wider font-black">
                                                    <th className="py-3 px-2">Título</th>
                                                    <th className="py-3 px-2">Precio</th>
                                                    <th className="py-3 px-2">Fecha</th>
                                                    <th className="py-3 px-2 text-right">Estado</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {accountOrders.map(it => (
                                                    <tr key={it.id} className="hover:bg-slate-50 transition-colors">
                                                        <td className="py-3 px-2 text-slate-800 font-bold leading-relaxed">{it.titulo}</td>
                                                        <td className="py-3 px-2 font-mono font-bold text-slate-600">{(it.precio_venta || 0).toFixed(2)} Bs</td>
                                                        <td className="py-3 px-2 text-slate-400 text-xs">{it.created_at ? new Date(it.created_at).toLocaleDateString() : 'N/A'}</td>
                                                        <td className="py-3 px-2 text-right">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wide border transition-colors whitespace-nowrap ${
                                                                it.estado === 'POR CONFIRMAR' ? 'bg-orange-500/10 border-orange-500/30 text-orange-600' :
                                                                it.estado === 'ENTREGADO' ? 'bg-slate-100 border-slate-200 text-slate-500' :
                                                                it.estado === 'EN TIENDA' ? 'bg-success/10 border-success/30 text-success shadow-sm' :
                                                                'bg-primary/10 border-primary/30 text-primary shadow-sm'
                                                            }`}>
                                                                {it.estado}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ) : isConfirmed ? (
                /* ── PESTAÑA CONFIRMACIÓN COMPRA ── */
                <div className="max-w-xl mx-auto mt-12 bg-white border border-slate-200 p-8 rounded-3xl shadow-2xl ring-1 ring-slate-100 text-center animate-fadeIn">
                    <div className="w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-500/20">
                        <Check size={36} />
                    </div>
                    <h1 className="text-3xl font-display font-black text-slate-800 mb-3">¡Pedido Recibido Exitosamente!</h1>
                    <p className="text-slate-500 text-sm max-w-sm mx-auto mb-6 leading-relaxed">
                        Muchas gracias por tu compra. Tu pedido ahora está en estado pendiente de confirmación.
                    </p>

                    <div className="bg-slate-50 border border-slate-200 p-5 rounded-2xl mb-6 flex flex-col items-center">
                        <span className="text-[10px] font-mono font-bold tracking-widest text-slate-500 mb-2 uppercase">Opción de Pago por QR</span>
                        <span className="text-2xl font-black text-slate-800 mb-4 leading-none">{totalCart.toFixed(2)} <span className="text-primary">Bs.</span></span>
                        
                        <div className="w-48 h-48 bg-white p-3 rounded-2xl flex items-center justify-center shadow-inner mb-3 border border-slate-200">
                            <svg className="w-full h-full text-slate-800" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M3 3h6v6H3V3zm1 1v4h4V4H4zm1 1h2v2H5V5zm10-2h6v6h-6V3zm1 1v4h4V4h-4zm1 1h2v2h-2V5zM3 15h6v6H3v-6zm1 1v4h4v-4H4zm1 1h2v2H5v-2zm12-2h2v1h-1v2h1v1h-2v-4zm-2 2h1v1h-1v-1zm1 2h1v1h-1v-1zm2 1h1v1h-1v-1zm0-3h1v1h-1v-1zm-1-2h1v1h-1v-1zm-1-1h1v1h-1v-1zm1 1h1v1h-1v-1zm-2-2h1v1h-1v-1zm1-1h1v1h-1v-1zm-4 8h1v1h-1v-1zm-1-1h1v1h-1v-1zm1-1h1v1h-1v-1zm-1-1h1v1h-1v-1zm-1-1h1v1h-1v-1zm1 1h1v1h-1v-1zm-2-1h1v1h-1v-1zm1-1h1v1h-1v-1zm2 1h1v1h-1v-1zm2-1h1v1h-1v-1z" />
                            </svg>
                        </div>
                        <span className="text-xs text-slate-500 font-medium mb-1">Escanea el código para transferir el monto.</span>
                        <span className="text-xs text-primary font-black uppercase tracking-wider">Monto Libre tienda</span>
                    </div>

                    <div className="space-y-3">
                        <button
                            onClick={handleWhatsAppSubmit}
                            className="w-full bg-green-600 hover:bg-green-500 text-white font-bold p-3.5 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 border border-green-500/20 shadow-lg shadow-green-600/20"
                        >
                            <MessageCircle size={20} />
                            Enviar pedido y comprobante por WhatsApp
                        </button>

                        <button
                            onClick={() => {
                                setCart([]);
                                localStorage.removeItem('mcb_cart');
                                setClientForm({ nombre: '', celular: '', ci: '', ciudad: '', sucursal: '', direccion: '', notas: '' });
                                setCheckoutMode(false);
                                setIsConfirmed(false);
                            }}
                            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold p-3.5 rounded-xl transition-all border border-slate-200"
                        >
                            Volver al Catálogo
                        </button>
                    </div>
                </div>
            ) : checkoutMode ? (
                /* ── PESTAÑA CHECKOUT FORMS (REDISEÑO PREMIUM) ── */
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-0 md:gap-8 min-h-screen md:min-h-0 bg-slate-50 md:bg-transparent pb-32 md:pb-10 animate-fadeIn font-body">
                    
                    {/* COLUMNA 1: RESUMEN DEL PEDIDO (ARRIBA EN MÓVIL) */}
                    <div className="w-full md:w-5/12 order-1 md:order-2">
                        <div className="bg-[#1E3A5F] text-white p-5 md:p-8 md:rounded-3xl shadow-xl sticky top-0 md:top-24 z-20">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-2xl font-display tracking-wider uppercase text-[#F5C842]">Tu Pedido</h3>
                                <button onClick={() => setCheckoutMode(false)} className="bg-white/10 p-2 rounded-full hover:bg-white/20 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>

                            <div className="flex flex-col gap-4 max-h-[40vh] md:max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                                {cart.map(item => {
                                    const status = getAvailabilityStatus(item);
                                    const price = (item.precio_venta_bs || item.precio_tapa || 0);
                                    
                                    return (
                                        <div key={item.id} className="bg-white/5 border border-white/10 p-3 rounded-2xl flex gap-3 group relative">
                                            {/* Miniatura Imagen */}
                                            <div className="w-16 h-24 bg-black/20 rounded-lg overflow-hidden shrink-0 border border-white/5">
                                                <img 
                                                    src={item.imagen_url || '/placeholder-manga.jpg'} 
                                                    alt={item.titulo}
                                                    className="w-full h-full object-cover"
                                                    onError={(e) => e.target.src='/logo.png'}
                                                />
                                            </div>

                                            {/* Info */}
                                            <div className="flex flex-col justify-between flex-1 min-w-0">
                                                <div>
                                                    <h4 className="text-sm font-bold text-white leading-tight line-clamp-2 mb-1">{item.titulo}</h4>
                                                    
                                                    {/* Badge Corto */}
                                                    <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter ${status.color}`}>
                                                        {status.label.includes('Stock') ? '✅ Stock' : 
                                                         status.label.includes('Agotado') ? '❌ Agotado' :
                                                         status.label.includes('pend') ? `🟠 ${status.fecha}*` : `🟡 ${status.fecha}`}
                                                    </div>
                                                </div>

                                                <div className="flex justify-between items-end">
                                                    <span className="text-lg font-black text-[#F5C842]">{price.toFixed(2)} <span className="text-[10px]">Bs</span></span>
                                                    
                                                    {/* Controles Cantidad */}
                                                    <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1 border border-white/5">
                                                        <button 
                                                            onClick={() => item.qty > 1 ? setCart(cart.map(c => c.id === item.id ? {...c, qty: c.qty - 1} : c)) : removeFromCart(item.id)}
                                                            className="w-7 h-7 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors"
                                                        >
                                                            <Minus size={12} className="text-white/60" />
                                                        </button>
                                                        <span className="w-6 text-center text-xs font-black font-mono">{item.qty}</span>
                                                        <button 
                                                            onClick={() => setCart(cart.map(c => c.id === item.id ? {...c, qty: c.qty + 1} : c))}
                                                            className="w-7 h-7 flex items-center justify-center hover:bg-white/10 rounded-lg transition-colors text-primary"
                                                        >
                                                            <Plus size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            {/* Botón Eliminar X */}
                                            <button 
                                                onClick={() => removeFromCart(item.id)}
                                                className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Totales */}
                            <div className="mt-8 pt-6 border-t border-white/10 space-y-3">
                                <div className="flex justify-between text-white/60 text-sm font-bold">
                                    <span>Subtotal</span>
                                    <span>{totalCart.toFixed(2)} Bs</span>
                                </div>
                                <div className="flex justify-between items-end">
                                    <span className="text-lg font-bold text-[#F5C842] uppercase tracking-widest">Total</span>
                                    <span className="text-3xl font-black text-white leading-none">{totalCart.toFixed(2)} <span className="text-sm">Bs</span></span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* COLUMNA 2: FORMULARIO (ABAJO EN MÓVIL) */}
                    <div className="w-full md:w-7/12 order-2 md:order-1 p-5 md:p-0 md:mt-0">
                        <div className="bg-white p-6 md:p-10 md:rounded-3xl border border-slate-200 shadow-xl">
                            <div className="mb-8 border-l-4 border-[#E8891A] pl-4">
                                <h2 className="text-2xl font-display text-[#1E3A5F] tracking-tight uppercase">Datos de Entrega</h2>
                                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Completa tus datos para procesar el pedido</p>
                            </div>

                            <form onSubmit={handleCheckoutSubmit} className="flex flex-col gap-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Nombre Completo *</label>
                                        <input
                                            type="text"
                                            value={clientForm.nombre}
                                            onChange={(e) => setClientForm({ ...clientForm, nombre: e.target.value })}
                                            required
                                            className="w-full bg-slate-50 border-2 border-slate-100 p-3.5 rounded-2xl text-slate-800 focus:outline-none focus:border-[#E8891A] transition-all text-sm font-bold"
                                            placeholder="Tu nombre aquí"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Celular WhatsApp *</label>
                                        <input
                                            type="text"
                                            value={clientForm.celular}
                                            onChange={(e) => setClientForm({ ...clientForm, celular: e.target.value })}
                                            required
                                            className="w-full bg-slate-50 border-2 border-slate-100 p-3.5 rounded-2xl text-slate-800 focus:outline-none focus:border-[#E8891A] transition-all text-sm font-bold font-mono"
                                            placeholder="789XXXXX"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Ciudad</label>
                                        <input
                                            type="text"
                                            value={clientForm.ciudad}
                                            onChange={(e) => setClientForm({ ...clientForm, ciudad: e.target.value })}
                                            className="w-full bg-slate-50 border-2 border-slate-100 p-3.5 rounded-2xl text-slate-800 focus:outline-none focus:border-[#E8891A] transition-all text-sm font-bold"
                                            placeholder="Ej: La Paz"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">C.I. (Opcional)</label>
                                        <input
                                            type="text"
                                            value={clientForm.ci}
                                            onChange={(e) => setClientForm({ ...clientForm, ci: e.target.value })}
                                            className="w-full bg-slate-50 border-2 border-slate-100 p-3.5 rounded-2xl text-slate-800 focus:outline-none focus:border-[#E8891A] transition-all text-sm font-bold"
                                            placeholder="Carnet de Identidad"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Dirección / Sucursal de Entrega</label>
                                    <input
                                        type="text"
                                        value={clientForm.sucursal}
                                        onChange={(e) => setClientForm({ ...clientForm, sucursal: e.target.value })}
                                        className="w-full bg-slate-50 border-2 border-slate-100 p-3.5 rounded-2xl text-slate-800 focus:outline-none focus:border-[#E8891A] transition-all text-sm font-bold"
                                        placeholder="Ej: Sucursal Central, o Dirección particular"
                                    />
                                </div>

                                <div className="space-y-1.5">
                                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Notas o Comentarios</label>
                                    <textarea
                                        value={clientForm.notas}
                                        onChange={(e) => setClientForm({ ...clientForm, notas: e.target.value })}
                                        className="w-full bg-slate-50 border-2 border-slate-100 p-3.5 rounded-2xl text-slate-800 focus:outline-none focus:border-[#E8891A] transition-all text-sm font-bold h-24 resize-none"
                                        placeholder="Indícanos algo extra si necesitas"
                                    />
                                </div>

                                {/* Botón Desktop (Visible solo en md+) */}
                                <button
                                    type="submit"
                                    disabled={loading || cart.length === 0}
                                    className="hidden md:flex w-full bg-[#E8891A] hover:bg-[#F5C842] text-white hover:text-[#1E3A5F] font-display text-xl p-5 rounded-2xl transition-all duration-300 shadow-xl shadow-[#E8891A]/20 items-center justify-center gap-3 uppercase tracking-wider"
                                >
                                    {loading ? 'Procesando...' : `Confirmar Compra — ${totalCart.toFixed(2)} Bs`}
                                    <ArrowRight size={24} />
                                </button>
                            </form>
                        </div>
                    </div>

                    {/* BOTÓN MÓVIL FIJO (Visible solo en móvil) */}
                    <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 z-50">
                        {fechaEntregaFormateada && (
                            <div className="flex items-center justify-center gap-3 py-3 px-4 bg-[#1E3A5F]/10 rounded-2xl border border-[#E8891A]/20 mb-3 animate-fadeIn">
                                <span className="text-xl">
                                    {fechaEntregaFormateada === 'INMEDIATA' ? '📦' : '📅'}
                                </span>
                                <div>
                                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest leading-none mb-1">Entrega estimada</p>
                                    <p className="text-[#1E3A5F] font-black text-sm leading-none">
                                        {fechaEntregaFormateada === 'INMEDIATA' ? '¡Entrega inmediata!' : fechaEntregaFormateada}
                                    </p>
                                </div>
                            </div>
                        )}
                        <button
                            onClick={() => document.querySelector('form').requestSubmit()}
                            disabled={loading || cart.length === 0}
                            className="w-full bg-[#E8891A] active:bg-[#F5C842] text-white font-display text-xl p-4 rounded-2xl shadow-2xl flex items-center justify-center gap-3 uppercase tracking-wider transition-all"
                        >
                            {loading ? 'Procesando...' : `Confirmar — ${totalCart.toFixed(2)} Bs`}
                            <ArrowRight size={22} />
                        </button>
                    </div>
                </div>
            ) : (
                /* ── PESTAÑA CATÁLOGO Y NOVEDADES (LANDING PRINCIPAL) ── */
                <div className="flex-1 flex flex-col gap-10">
                    {/* Hero Section */}
                    <div className="relative bg-gradient-to-r from-[#1a2d42] via-[#152436] to-[#0f172a] border-b border-white/5 px-4 md:px-8 py-12 md:py-16 text-center md:text-left flex flex-col md:flex-row justify-between items-center gap-8 shadow-inner select-none animate-fadeIn overflow-hidden">
                        {/* Abstract Background Element */}
                        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                        <div className="max-w-2xl space-y-4 relative z-10">
                            <span className="text-xs font-black text-primary font-mono tracking-widest uppercase opacity-80 flex items-center justify-center md:justify-start gap-2">
                                <Sparkles size={16} className="text-primary animate-pulse" /> Novedades y Catálogo Completo
                            </span>
                            <div className="flex flex-col md:flex-row items-center md:items-start gap-4">
                                <img src="/logo.png" alt="Logo" className="w-20 h-20 md:w-24 md:h-24 object-contain drop-shadow-2xl rounded-2xl" onError={(e) => e.target.style.display='none'} />
                                <div>
                                    <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight text-white leading-tight">
                                        MANGAS <span className="text-primary">COMICS</span> <br className="hidden md:block"/> BOLIVIA STORE
                                    </h1>
                                    <p className="text-slate-300 text-sm leading-relaxed max-w-xl mx-auto md:mx-0 mt-3 font-medium">
                                        Tu tienda favorita de cómics y mangas en Bolivia. Puedes buscar lo que quieras, añadirlo a tu carrito y completar la compra fácilmente.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/5 border border-white/10 p-5 rounded-3xl text-center flex flex-col items-center max-w-xs shadow-2xl backdrop-blur-md shrink-0 select-none relative z-10">
                            <span className="text-xs text-slate-300 font-black font-mono tracking-wider uppercase mb-1">¡Ventas Directas!</span>
                            <span className="text-white text-sm font-semibold leading-relaxed mb-3">Encuentra tus mangas favoritos y reserva de inmediato.</span>
                            <button
                                onClick={() => {
                                    if (cart.length > 0) setCheckoutMode(true);
                                    else alert('Tu carrito está vacío');
                                }}
                                className="flex items-center gap-2 bg-primary hover:bg-secondary text-slate-900 px-4 py-3 rounded-xl transition-all duration-200 font-black shadow-xl shadow-primary/10 select-none text-sm w-full justify-center"
                            >
                                <ShoppingBag size={18} />
                                Ver Carrito ({cart.reduce((a, c) => a + c.qty, 0)})
                            </button>
                        </div>
                    </div>

                    {/* Sección Novedades (Estrenos) */}
                    <FeaturedSection 
                        items={novelties} 
                        title="Estrenos de la Semana" 
                        icon={Sparkles} 
                        colorClass="text-primary"
                        getAvailabilityStatus={getAvailabilityStatus}
                        addToCart={addToCart}
                    />

                    {/* Sección Reimpresiones Destacadas */}
                    <FeaturedSection 
                        items={featuredReprints} 
                        title="Reimpresiones de la Semana" 
                        icon={RefreshCw} 
                        colorClass="text-orange-500"
                        getAvailabilityStatus={getAvailabilityStatus}
                        addToCart={addToCart}
                    />

                    {/* Sección Series Completas / Al Día */}
                    {seriesCompletas.length > 0 && (
                        <div className="max-w-7xl mx-auto w-full px-4 md:px-6 animate-fadeIn mt-4">
                            <div className="flex items-center gap-2 mb-5">
                                <Library className="text-primary" size={20} />
                                <div>
                                    <h2 className="text-xl font-display font-black text-[#1a2d42] tracking-tight leading-none">Series Completas en Stock</h2>
                                    <span className="text-xs text-slate-500 font-medium">Llevate todos los tomos publicados sin interrupciones.</span>
                                </div>
                            </div>
                            <div className="flex gap-4 overflow-x-auto pb-4 snap-x custom-scrollbar">
                                {seriesCompletas.map((serie) => {
                                    const totalPrecio = serie.items.reduce((s, i) => s + (i.precio_venta_bs || i.precio_tapa || 0), 0);
                                    return (
                                        <div key={serie.nombre} className="bg-white border border-slate-200 p-4 rounded-3xl min-w-[280px] w-[280px] flex flex-col transition-all duration-200 shadow-md hover:shadow-lg snap-start shrink-0 group">
                                            
                                            {/* Imagen de la Serie (Tomo 1) */}
                                            <div className="w-full h-32 bg-slate-100 rounded-2xl overflow-hidden mb-3 relative flex-shrink-0 border border-slate-200 flex items-center justify-center">
                                                {serie.imagen ? (
                                                    <img 
                                                        src={serie.imagen} 
                                                        alt={serie.nombre} 
                                                        className="h-full object-contain group-hover:scale-105 transition-transform duration-500" 
                                                        onError={(e) => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }} 
                                                    />
                                                ) : null}
                                                <div className={`absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-1 ${serie.imagen ? 'hidden' : 'flex'}`}>
                                                    <ImageIcon size={24} />
                                                    <span className="text-[9px] font-mono">Sin Imagen</span>
                                                </div>
                                            </div>

                                            <div className="flex-1">
                                                <div className="flex justify-between items-start gap-2 mb-2">
                                                    <span className="text-[10px] font-mono font-black text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 tracking-wider">
                                                        {serie.editorial || 'EDITORIAL'}
                                                    </span>
                                                    <span className="px-2 py-0.5 text-[9px] font-bold rounded border tracking-tight leading-tight bg-green-500/10 border-green-500/30 text-green-600">
                                                        ¡{serie.totalTomos} Tomos!
                                                    </span>
                                                </div>

                                                <h3 className="text-base font-bold text-slate-800 mb-1 tracking-tight leading-snug line-clamp-2">
                                                    {serie.nombre}
                                                </h3>
                                                <span className="text-slate-500 text-[10px] leading-none">Tomo {serie.minTomo} al {serie.maxTomo}</span>
                                            </div>

                                            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-slate-500 font-mono tracking-widest uppercase">Total Serie</span>
                                                    <span className="text-base font-black text-slate-800 leading-tight tracking-tight">
                                                        {totalPrecio.toFixed(2)} <span className="text-primary text-[10px]">Bs.</span>
                                                    </span>
                                                </div>

                                                <button
                                                    onClick={() => addSeriesToCart(serie)}
                                                    className="bg-primary/20 hover:bg-primary text-primary hover:text-slate-900 font-bold px-3 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1 shadow-sm select-none text-xs"
                                                    title="Añadir toda la serie al carrito"
                                                >
                                                    <ShoppingBag size={12} />
                                                    Añadir ({serie.totalTomos})
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Buscador & Catálogo Completo */}
                    <div className="max-w-7xl mx-auto w-full px-4 md:px-6 flex flex-col gap-6 animate-fadeIn pb-10 mt-4">
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                            <div>
                                <h3 className="text-xl font-display font-black text-[#1a2d42] tracking-tight leading-none mb-1">Catálogo Completo</h3>
                                <span className="text-slate-500 text-xs">Usa la lupa para buscar tu manga o cómic. Priorizando Ivrea.</span>
                            </div>

                            {/* Filtro por Categorías */}
                            <div className="flex items-center gap-2 w-full md:w-auto">
                                <Filter className="text-slate-400 shrink-0" size={18} />
                                <select
                                    value={selectedCategory}
                                    onChange={(e) => setSelectedCategory(e.target.value)}
                                    className="w-full md:w-48 bg-white border border-slate-200 px-4 py-3 rounded-xl text-slate-800 text-xs focus:outline-none focus:border-primary cursor-pointer shadow-sm transition-all font-bold"
                                >
                                    {categories.map(cat => (
                                        <option key={cat} value={cat}>
                                            {cat === 'todos' ? 'Todas las Editoriales' : cat}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Buscador Lupa */}
                        <div className="relative flex items-center">
                            <Search className="absolute left-4 text-slate-400 pointer-events-none" size={18} />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full bg-white border border-slate-200 pl-12 pr-4 py-4 rounded-2xl text-slate-800 text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 shadow-md transition-all font-medium"
                                placeholder="Escribe el nombre del manga o cómic que buscas..."
                            />
                        </div>

                        {/* Carrito Flotante Estilo WhatsApp (Elevado para no solapar) */}
                        {cart.length > 0 && (
                            <div className="fixed bottom-24 right-6 z-[100] animate-bounceIn">
                                <button
                                    onClick={() => setCheckoutMode(true)}
                                    className="w-16 h-16 bg-primary hover:bg-secondary text-slate-900 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.3)] flex items-center justify-center transition-all hover:scale-110 active:scale-90 relative group border-4 border-white"
                                    title="Ver mi Carrito"
                                >
                                    <ShoppingBag size={28} className="group-hover:rotate-12 transition-transform" />
                                    
                                    {/* Contador / Badge */}
                                    <div className="absolute -top-2 -right-1 bg-red-600 text-white text-[11px] font-black w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow-md animate-pulse">
                                        {cart.reduce((a, c) => a + c.qty, 0)}
                                    </div>

                                    {/* Tooltip con Total (Aparece al pasar el mouse) */}
                                    <div className="absolute right-20 bg-[#1a2d42] text-white px-4 py-2 rounded-2xl text-[10px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-white/10 shadow-xl">
                                        Total: {totalCart.toFixed(2)} Bs
                                    </div>
                                </button>
                            </div>
                        )}

                        {/* Listado de Productos (Tarjetas con Imagen) */}
                        {loading ? (
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-4 md:gap-6 animate-pulse">
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                                    <div key={n} className="bg-slate-100 border border-slate-200 h-64 md:h-80 rounded-3xl" />
                                ))}
                            </div>
                        ) : filteredCatalog.length === 0 ? (
                            <div className="text-center py-16 bg-white border border-slate-200 rounded-3xl shadow-sm">
                                <p className="text-slate-500 text-base font-medium">No se encontraron productos que coincidan.</p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-12">
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 animate-fadeIn">
                                    {filteredCatalog.slice(0, displayLimit).map((prod) => {
                                    const status = getAvailabilityStatus(prod);
                                    const price = prod.precio_venta_bs || prod.precio_tapa || 0;

                                    return (
                                        <div key={prod.id} className="bg-[#1a2d42] hover:bg-[#152436] border border-[#1a2d42]/10 p-3 md:p-5 rounded-3xl flex flex-col justify-between transition-all duration-200 shadow-lg select-none hover:shadow-2xl hover:scale-[1.02] hover:border-white/10 flex-1 min-w-0 group">
                                            
                                            {/* Imagen de Portada */}
                                            <div className="w-full aspect-[2/3] bg-[#111f2e] rounded-2xl overflow-hidden mb-4 relative flex-shrink-0 border border-white/5 shadow-inner">
                                                {/* BADGES DE ESTADO (✨ NUEVO / 🔄 REIMP) */}
                                                {prod.es_novedad && (
                                                    <div className="absolute top-2 left-2 z-10 bg-green-500 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg flex items-center gap-1 animate-pulse border border-green-400">
                                                        <Sparkles size={10} className="fill-white" />
                                                        NUEVO
                                                    </div>
                                                )}
                                                {prod.es_reimpresion && (
                                                    <div className="absolute top-2 left-2 z-10 bg-blue-500 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg flex items-center gap-1 border border-blue-400">
                                                        <RefreshCw size={10} />
                                                        REIMP.
                                                    </div>
                                                )}
                                                {prod.imagen_url ? (
                                                    <img 
                                                        src={prod.imagen_url} 
                                                        alt={prod.titulo} 
                                                        className="w-full h-full object-cover md:object-contain group-hover:scale-105 transition-transform duration-500" 
                                                        onError={(e) => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }} 
                                                    />
                                                ) : null}
                                                <div className={`absolute inset-0 flex flex-col items-center justify-center text-white/20 gap-2 ${prod.imagen_url ? 'hidden' : 'flex'}`}>
                                                    <ImageIcon size={32} />
                                                    <span className="text-[10px] font-mono">Sin Imagen</span>
                                                </div>
                                            </div>

                                            <div className="flex flex-col flex-1">
                                                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                                    <span className="text-[9px] font-mono font-black text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20 tracking-wider">
                                                        {prod.editorial || 'EDITORIAL'}
                                                    </span>
                                                    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border tracking-tight leading-tight flex items-center gap-1 ${status.color}`}>
                                                        {status.isComingSoon && <Truck size={10} className="animate-bounce" />}
                                                        {status.label}
                                                    </span>
                                                </div>

                                                <h3 className="text-sm md:text-base font-bold text-white mb-1 tracking-tight leading-snug">
                                                    {prod.titulo}
                                                </h3>
                                            </div>

                                            <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/10">
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase hidden md:inline">Precio</span>
                                                    <span className="text-[11px] md:text-xl font-black text-white leading-tight tracking-tight">
                                                        {price.toFixed(2)} <span className="text-primary text-[9px]">Bs.</span>
                                                    </span>
                                                </div>

                                    {(() => {
                                      const status = getAvailabilityStatus(prod);
                                      return (
                                        <button
                                          type="button"
                                          onClick={(e) => { e.preventDefault(); status.canOrder && addToCart(prod, status); }}
                                          disabled={!status.canOrder}
                                          className={`font-bold px-2 py-1.5 md:px-3.5 md:py-2 
                                            rounded-xl transition-all duration-200 flex items-center 
                                            gap-1.5 shadow-md text-xs
                                            ${status.canOrder 
                                              ? 'bg-primary hover:bg-secondary text-slate-900 cursor-pointer' 
                                              : 'bg-gray-500/20 text-gray-400 cursor-not-allowed opacity-50'
                                            }`}
                                        >
                                          <ShoppingBag size={14} className="hidden md:block"/>
                                          <span>
                                            {status.canOrder ? 'Añadir' : 
                                             status.agotado ? 'Agotado' : '...'}
                                          </span>
                                        </button>
                                      );
                                    })()}
                                            </div>
                                        </div>
                                    );
                                })}
                                </div>

                                {/* Botón Cargar Más */}
                                {displayLimit < filteredCatalog.length && (
                                    <div className="flex justify-center mt-12 mb-20">
                                        <button
                                            onClick={() => setDisplayLimit(prev => prev + 100)}
                                            className="bg-white hover:bg-slate-50 text-[#1a2d42] font-black px-10 py-4 rounded-2xl border-2 border-[#1a2d42]/10 transition-all duration-200 shadow-lg flex items-center gap-2 hover:scale-[1.05] active:scale-95 uppercase text-sm tracking-widest"
                                        >
                                            <RefreshCw size={20} className="text-primary" />
                                            Ver más títulos ({filteredCatalog.length - displayLimit} restantes)
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

// Componente Interno para Cuadrículas de Productos Destacados (MOVIDO FUERA PARA EVITAR SCROLL JUMPS)
const FeaturedSection = ({ items, title, icon: Icon, colorClass = "text-primary", getAvailabilityStatus, addToCart }) => {
    if (!items || items.length === 0) return null;
    return (
        <div className="max-w-7xl mx-auto w-full px-4 md:px-6 animate-fadeIn mb-4">
            <div className="flex items-center gap-2 mb-5">
                <Icon className={`${colorClass} ${Icon === Sparkles ? 'animate-pulse' : ''}`} size={20} />
                <h2 className="text-xl font-display font-black text-[#1a2d42] tracking-tight leading-none uppercase italic">{title}</h2>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                {items.map((prod) => {
                    const status = getAvailabilityStatus(prod);
                    const price = prod.precio_venta_bs || prod.precio_tapa || 0;

                    return (
                        <div key={prod.id} className="bg-[#1a2d42] border border-[#1a2d42]/10 p-3 md:p-5 rounded-3xl flex flex-col justify-between transition-all duration-200 hover:scale-[1.02] hover:shadow-xl select-none flex-1 group">
                            <div className="w-full aspect-[2/3] bg-[#111f2e] rounded-2xl overflow-hidden mb-4 relative flex-shrink-0 border border-white/5 shadow-inner">
                                {/* BADGES DE ESTADO (✨ NUEVO / 🔄 REIMP) */}
                                {prod.es_novedad && (
                                    <div className="absolute top-2 left-2 z-10 bg-green-500 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg flex items-center gap-1 animate-pulse border border-green-400">
                                        <Sparkles size={10} className="fill-white" />
                                        NUEVO
                                    </div>
                                )}
                                {prod.es_reimpresion && (
                                    <div className="absolute top-2 left-2 z-10 bg-blue-500 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg flex items-center gap-1 border border-blue-400">
                                        <RefreshCw size={10} />
                                        REIMP.
                                    </div>
                                )}
                                {prod.imagen_url ? (
                                    <img 
                                        src={prod.imagen_url} 
                                        alt={prod.titulo} 
                                        className="w-full h-full object-cover md:object-contain group-hover:scale-105 transition-transform duration-500" 
                                        onError={(e) => { e.target.style.display='none'; e.target.nextSibling.style.display='flex'; }} 
                                    />
                                ) : null}
                                <div className={`absolute inset-0 flex flex-col items-center justify-center text-white/20 gap-2 ${prod.imagen_url ? 'hidden' : 'flex'}`}>
                                    <ImageIcon size={32} />
                                    <span className="text-[10px] font-mono">Sin Imagen</span>
                                </div>
                            </div>

                            <div className="flex flex-col flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                                    <span className="text-[9px] font-mono font-black text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20 tracking-wider">
                                        {prod.editorial || 'EDITORIAL'}
                                    </span>
                                    <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border tracking-tight leading-tight flex items-center gap-1 ${status.color}`}>
                                        {status.isComingSoon && <Truck size={10} className="animate-bounce" />}
                                        {status.label}
                                    </span>
                                </div>
                                <h3 className="text-sm md:text-base font-bold text-white mb-1 tracking-tight leading-snug">
                                    {prod.titulo}
                                </h3>
                            </div>

                            <div className="flex items-center justify-between mt-2 pt-3 border-t border-white/10">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black text-white leading-tight tracking-tight">
                                        {price.toFixed(2)} <span className="text-primary text-[9px]">Bs.</span>
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); status.canOrder && addToCart(prod, status); }}
                                    disabled={!status.canOrder}
                                    className={`font-bold px-2 py-1.5 md:px-3.5 md:py-2 
                                    rounded-xl transition-all duration-200 flex items-center 
                                    gap-1.5 shadow-md text-xs
                                    ${status.canOrder 
                                        ? 'bg-primary hover:bg-secondary text-slate-900 cursor-pointer' 
                                        : 'bg-gray-500/20 text-gray-400 cursor-not-allowed opacity-50'
                                    }`}
                                >
                                    <ShoppingBag size={14} className="hidden md:block"/>
                                    <span>
                                    {status.canOrder ? 'Añadir' : 
                                        status.agotado ? 'Agotado' : '...'}
                                    </span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
