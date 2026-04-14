import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { 
    Wallet, Plus, Minus, Eye, History, User, 
    ArrowUpRight, ArrowDownLeft, Trash2, Edit3, 
    XCircle, CheckCircle2, AlertCircle, Clock, Search, LayoutDashboard,
    ShoppingBag, Package, Trash
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function FlujoCajaView({ user, profile }) {
    const isAdmin = profile?.is_admin === true ||
                    profile?.email === 'admin@gmail.com' ||
                    profile?.email === 'testadmin@mangascomics.bo';
    const [loading, setLoading] = useState(true);
    const [turnoActivo, setTurnoActivo] = useState(null);
    const [historialTurnos, setHistorialTurnos] = useState([]);
    const [vendedores, setVendedores] = useState([]);
    const [movimientos, setMovimientos] = useState([]);
    
    // UI state
    const [showOpenModal, setShowOpenModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showCalcModal, setShowCalcModal] = useState(false);
    const BILLETES = [200, 100, 50, 20, 10];
    const MONEDAS  = [5, 2, 1, 0.5, 0.2, 0.1];
    const initCalc = () => [...BILLETES, ...MONEDAS].reduce((a, d) => ({ ...a, [d]: 0 }), {});
    const [calcQty, setCalcQty] = useState(initCalc);
    const [showDetailModal, setShowDetailModal] = useState(null);
    const [showEditModal, setShowEditModal] = useState(null); // { id, responsable, turno, monto_inicial, monto_final }
    const [ultimoTurno, setUltimoTurno] = useState(null);
    
    // Form states
    const [openForm, setOpenForm] = useState({ responsable: '', turno: 'MAÑANA', monto_inicial: '' });
    const [moveForm, setMoveForm] = useState({ tipo: 'INGRESO', categoria: '', concepto: '', monto: '', metodo_pago: 'Efectivo' });

    // Categorías
    const [categorias, setCategorias] = useState([]);
    const [showCategoriasModal, setShowCategoriasModal] = useState(false);
    const [categoriaForm, setCategoriaForm] = useState({ nombre: '', tipo: 'INGRESO' });
    const [editingCategoria, setEditingCategoria] = useState(null); // {id, nombre, tipo}
    
    // View state
    const [currentView, setCurrentView] = useState('panel'); // 'panel' | 'historial'
    
    // Pagination, Search & Tabs
    const [searchTerm, setSearchTerm] = useState('');
    const [historyLimit, setHistoryLimit] = useState(20);
    const [historyTab, setHistoryTab] = useState('recientes'); // 'recientes' | 'completo'
    const [dateRange, setDateRange] = useState({ 
        from: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
        to: new Date().toISOString().split('T')[0] 
    });
    const [hasMore, setHasMore] = useState(true);
    
    // Venta Directa States
    const [showVentaModal, setShowVentaModal] = useState(false);
    const [ventaSearch, setVentaSearch] = useState('');
    const [ventaResults, setVentaResults] = useState([]);
    const [ventaCart, setVentaCart] = useState([]); // [{id, titulo, precio, cantidad, stock_max, editorial}]
    const [ventaDiscount, setVentaDiscount] = useState(0); // Porcentaje de descuento
    const [ventaLoading, setVentaLoading] = useState(false);
    const [montoFinalOverride, setMontoFinalOverride] = useState(null); // null = usar cálculo automático
    const [activeOpTab, setActiveOpTab] = useState('pos'); // 'pos' | 'manual'
    const [ventaMethod, setVentaMethod] = useState('Efectivo'); // método de pago del POS
    const [splitEnabled, setSplitEnabled] = useState(false); // pago mixto
    const [splitMethod2, setSplitMethod2] = useState('Yasta (QR)'); // segundo método en pago mixto
    const [splitAmount2, setSplitAmount2] = useState(''); // monto del segundo método

    // --- SISTEMA DE NOTIFICACIONES PERSONALIZADAS ---
    const [toasts, setToasts] = useState([]); // [{id, type, message}]
    const [confirmModal, setConfirmModal] = useState(null); // {message, resolve}

    const showToast = (message, type = 'info') => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };

    const showConfirm = (message) => new Promise(resolve => {
        setConfirmModal({ message, resolve });
    });

    const handleConfirmResolve = (result) => {
        if (confirmModal) confirmModal.resolve(result);
        setConfirmModal(null);
    };

    
    // --- POS MULTI-ITEM LOGIC ---
    const handleVentaSearch = async (val) => {
        setVentaSearch(val);
        if (val.trim().length < 2) { setVentaResults([]); return; }
        
        const { data } = await supabase
            .from('catalogo_productos')
            .select('*')
            .ilike('titulo', `%${val.trim()}%`)
            .order('stock_fisico', { ascending: false })
            .order('titulo', { ascending: true })
            .limit(10);
            
        if (data) setVentaResults(data);
    };

    useEffect(() => {
        init();
    }, []);

    useEffect(() => {
        const delayDebounceFn = setTimeout(() => {
            fetchHistorial();
        }, 500);

        return () => clearTimeout(delayDebounceFn);
    }, [searchTerm, historyLimit, currentView, dateRange]);

    const init = async () => {
        setLoading(true);
        await Promise.all([
            fetchVendedores(),
            fetchTurnoStatus(),
            fetchHistorial(),
            fetchCategorias()
        ]);
        setLoading(false);
    };

    const fetchCategorias = async () => {
        const { data } = await supabase
            .from('categorias_caja')
            .select('*')
            .order('tipo')
            .order('nombre');
        if (data) {
            setCategorias(data);
            // Preseleccionar primera categoría si el form está vacío
            if (!moveForm.categoria && data.length > 0) {
                setMoveForm(prev => ({ ...prev, categoria: data.find(c => c.tipo === 'INGRESO')?.nombre || data[0].nombre }));
            }
        }
    };

    const handleSaveCategoria = async () => {
        if (!categoriaForm.nombre.trim()) return showToast('El nombre no puede estar vacío.', 'warning');
        if (editingCategoria) {
            const { error } = await supabase.from('categorias_caja')
                .update({ nombre: categoriaForm.nombre.trim(), tipo: categoriaForm.tipo })
                .eq('id', editingCategoria.id);
            if (error) return showToast('Error al actualizar: ' + error.message, 'error');
            showToast('Categoría actualizada.', 'success');
        } else {
            const { error } = await supabase.from('categorias_caja')
                .insert([{ nombre: categoriaForm.nombre.trim(), tipo: categoriaForm.tipo }]);
            if (error) return showToast('Error al crear: ' + error.message, 'error');
            showToast('Categoría creada.', 'success');
        }
        setCategoriaForm({ nombre: '', tipo: 'INGRESO' });
        setEditingCategoria(null);
        fetchCategorias();
    };

    const handleDeleteCategoria = async (id, nombre) => {
        const ok = await showConfirm(`¿Eliminar la categoría "${nombre}"?`);
        if (!ok) return;
        const { error } = await supabase.from('categorias_caja').delete().eq('id', id);
        if (error) return showToast('Error al eliminar: ' + error.message, 'error');
        showToast('Categoría eliminada.', 'success');
        fetchCategorias();
    };

    const fetchVendedores = async () => {
        // Ya no es necesario cargar todos los vendedores para el selector manual
        // Pero guardamos la lista por si se necesitara en reportes (opcional)
        const { data } = await supabase.from('vendedores').select('id, nombre').eq('active', true);
        setVendedores(data || []);
    };

    const fetchTurnoStatus = async () => {
        const { data: activeArr, error: turnoErr } = await supabase
            .from('turnos_caja')
            .select('*')
            .eq('estado', 'ABIERTO')
            .order('abierto_at', { ascending: false })
            .limit(1);

        if (turnoErr) console.error('fetchTurnoStatus error:', turnoErr);

        const active = activeArr?.[0] || null;

        if (active) {
            setTurnoActivo(active);
            await fetchMovimientos(active.id);
        } else {
            setTurnoActivo(null);
            setMovimientos([]);
            // Si no hay turno abierto, buscamos el último cerrado para el balance inicial
            const { data: lastArr } = await supabase
                .from('turnos_caja')
                .select('*')
                .eq('estado', 'CERRADO')
                .order('cerrado_at', { ascending: false })
                .limit(1);
            setUltimoTurno(lastArr?.[0] || null);
        }
    };

    const fetchMovimientos = async (turnoId) => {
        const { data } = await supabase
            .from('caja_movimientos')
            .select('*')
            .eq('turno_id', turnoId)
            .order('created_at', { ascending: false });
        setMovimientos(data || []);
    };

    const fetchHistorial = async () => {
        let query = supabase
            .from('turnos_caja')
            .select('*')
            .eq('estado', 'CERRADO')
            .order('cerrado_at', { ascending: false });
            
        if (currentView === 'panel') {
            const tenDaysAgo = new Date();
            tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
            query = query.gte('fecha', tenDaysAgo.toISOString().split('T')[0]);
        } else {
            // Historial Completo con filtros en el apartado de de Historial
            if (dateRange.from) query = query.gte('fecha', dateRange.from);
            if (dateRange.to) query = query.lte('fecha', dateRange.to);
            if (searchTerm) query = query.ilike('responsable', `%${searchTerm}%`);
        }
            
        const { data } = await query.limit(historyLimit + 1);
        
        if (data && data.length > historyLimit) {
            setHasMore(true);
            setHistorialTurnos(data.slice(0, historyLimit));
        } else {
            setHasMore(false);
            setHistorialTurnos(data || []);
        }
    };

    const addToCart = (product) => {
        setVentaCart(prev => {
            const exists = prev.find(i => i.id === product.id);
            if (exists) {
                if (exists.cantidad + 1 > product.stock_fisico) {
                    showToast('No hay más stock disponible de este producto.', 'warning');
                    return prev;
                }
                return prev.map(i => i.id === product.id ? { ...i, cantidad: i.cantidad + 1 } : i);
            }
            return [...prev, { 
                id: product.id, 
                titulo: product.titulo, 
                precio: product.precio_venta_bs || 0, 
                precioOriginal: product.precio_venta_bs || 0, // Para detectar cambios manuales
                cantidad: 1, 
                stock_max: product.stock_fisico,
                editorial: product.editorial,
                imagen: product.imagen_url
            }];
        });
        setVentaSearch('');
        setVentaResults([]);
    };

    const updateCartQty = (id, delta) => {
        setVentaCart(prev => prev.map(i => {
            if (i.id === id) {
                const n = Math.max(0, i.cantidad + delta);
                if (n > i.stock_max) {
                    showToast('Stock máximo alcanzado.', 'warning');
                    return i;
                }
                return { ...i, cantidad: n };
            }
            return i;
        }).filter(i => i.cantidad > 0));
    };

    const updateCartPrice = (id, newPrice) => {
        setVentaCart(prev => prev.map(i => 
            i.id === id ? { ...i, precio: parseFloat(newPrice) || 0 } : i
        ));
    };

    const handleConfirmVenta = async () => {
        if (ventaCart.length === 0) return;
        
        const subtotal = ventaCart.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);
        const totalCalculado = subtotal * (1 - (ventaDiscount / 100));
        // Usar el monto override si fue editado manualmente, sino el calculado
        const totalVenta = montoFinalOverride !== null ? montoFinalOverride : totalCalculado;

        const confirmText = `¿Confirmar venta de ${ventaCart.length} producto(s) por un TOTAL de Bs ${totalVenta.toLocaleString()}?`;
        const ok = await showConfirm(confirmText);
        if (!ok) return;
        
        setVentaLoading(true);
        try {
            // Preparar metadatos ANTES de descontar (para la reversión futura)
            const itemsMetadata = ventaCart.map(i => ({
                id: i.id,
                cantidad: parseInt(i.cantidad),
                titulo: i.titulo
            }));

            console.log('🛒 Iniciando venta. Items:', JSON.stringify(itemsMetadata));

            // 1. Descontar stock de cada producto via RPC
            for (const item of itemsMetadata) {
                console.log(`📦 Descontando stock: ${item.titulo} x${item.cantidad} (id: ${item.id})`);
                const { error: stockErr } = await supabase.rpc('adjust_product_stock', {
                    p_id: item.id,
                    p_delta: -item.cantidad
                });

                if (stockErr) {
                    console.error(`❌ Error RPC descuento ${item.titulo}:`, stockErr);
                    showToast(`Error al descontar stock (${item.titulo}): ${stockErr.message}`, 'error');
                    throw stockErr;
                }
                console.log(`✅ Stock descontado OK: ${item.titulo}`);
            }

            // 2. Registrar movimiento en Flujo de Caja con metadatos
            if (turnoActivo) {
                const detalle = ventaCart.map(i => `${i.titulo} (x${i.cantidad})`).join(', ');
                const conceptoMsg = `VENTA DIRECTA: ${detalle}${ventaDiscount > 0 ? ` [Dcto ${ventaDiscount}%]` : ''}`;

                console.log('💰 Registrando movimiento con items_json:', itemsMetadata);
                const movimientosAInsertar = [];
                if (splitEnabled && splitAmount2 > 0) {
                    const amt2 = parseFloat(splitAmount2) || 0;
                    const amt1 = Math.max(0, totalVenta - amt2);
                    movimientosAInsertar.push(
                        { turno_id: turnoActivo.id, tipo: 'INGRESO', categoria: 'Venta Stock', concepto: conceptoMsg.substring(0, 500), monto: amt1, vendedor_id: user?.id, items_json: itemsMetadata, metodo_pago: ventaMethod, origen: 'Tienda' },
                        { turno_id: turnoActivo.id, tipo: 'INGRESO', categoria: 'Venta Stock', concepto: `${conceptoMsg.substring(0, 480)} [PARTE 2]`, monto: amt2, vendedor_id: user?.id, metodo_pago: splitMethod2, origen: 'Tienda' }
                    );
                } else {
                    movimientosAInsertar.push({ turno_id: turnoActivo.id, tipo: 'INGRESO', categoria: 'Venta Stock', concepto: conceptoMsg.substring(0, 500), monto: totalVenta, vendedor_id: user?.id, items_json: itemsMetadata, metodo_pago: ventaMethod, origen: 'Tienda' });
                }
                const { error: moveErr } = await supabase.from('caja_movimientos').insert(movimientosAInsertar);
                if (moveErr) {
                    console.error('❌ Error al registrar movimiento:', moveErr);
                    throw moveErr;
                }
                console.log('✅ Movimiento registrado con items_json OK');
            } else {
                console.warn('⚠️ No hay turno activo, el movimiento NO se registró en caja.');
            }

            catalogService.patchStockInCache(
                itemsMetadata.map(i => ({ id: i.id, delta: -i.cantidad }))
            );

            showToast(`Venta procesada por Bs ${totalVenta.toLocaleString()}`, 'success');
            setVentaCart([]);
            setVentaDiscount(0);
            setMontoFinalOverride(null);
            setVentaMethod('Efectivo');
            setSplitEnabled(false);
            setSplitAmount2('');
            setSplitMethod2('Yasta (QR)');
            if (turnoActivo) await fetchMovimientos(turnoActivo.id);
            if (searchTerm) fetchVentaResults(searchTerm);
        } catch (e) {
            console.error('❌ Fallo en venta:', e);
            showToast(`Error: ${e.message || 'Error desconocido'}`, 'error');
        } finally {
            setVentaLoading(false);
        }
    };

    const handleOpenCaja = async () => {
        const responsable = profile?.nombre || user?.email || 'Desconocido';
        if (!openForm.monto_inicial) return alert('Ingresa el monto inicial');
        
        const { data, error } = await supabase.from('turnos_caja').insert([{
            responsable: responsable,
            vendedor_id: user?.id,
            turno: openForm.turno,
            monto_inicial: parseFloat(openForm.monto_inicial) || 0,
            estado: 'ABIERTO'
        }]).select().single();
        
        if (error) return alert('Error al abrir caja: ' + error.message);
        setTurnoActivo(data);
        setMovimientos([]);
        setShowOpenModal(false);
    };

    const handleAddMovement = async () => {
        if (!moveForm.monto) return;

        const { data, error } = await supabase.from('caja_movimientos').insert([{
            turno_id: turnoActivo.id,
            tipo: moveForm.tipo,
            categoria: moveForm.categoria,
            concepto: moveForm.concepto,
            monto: parseFloat(moveForm.monto) || 0,
            vendedor_id: user?.id,
            metodo_pago: moveForm.metodo_pago || 'Efectivo',
            origen: 'Tienda'
        }]).select().single();
        
        if (error) return alert('Error al registrar movimiento: ' + error.message);
        setMovimientos([data, ...movimientos]);
        setMoveForm({ ...moveForm, concepto: '', monto: '' });
    };

    const deleteMovement = async (id) => {
        // Buscar en estado local primero
        let movement = movimientos.find(m => m.id === id);
        
        // Si no está en el estado local, buscarlo directamente en la BD
        if (!movement) {
            const { data: fresh } = await supabase
                .from('caja_movimientos')
                .select('*')
                .eq('id', id)
                .single();
            movement = fresh;
        }
        if (!movement) return showToast('No se encontró el movimiento.', 'error');

        console.log('🗑️ deleteMovement - movement:', JSON.stringify(movement));
        console.log('🗑️ items_json:', JSON.stringify(movement.items_json));

        const hasMetadata = movement.items_json && Array.isArray(movement.items_json) && movement.items_json.length > 0;
        console.log('🗑️ hasMetadata:', hasMetadata);
        
        const confirmMsg = hasMetadata 
            ? `¿Eliminar esta venta? Se RESTAURARÁ el stock de ${movement.items_json.length} producto(s).`
            : '¿Eliminar este movimiento?';

        const ok = await showConfirm(confirmMsg);
        if (!ok) return;

        // 1. Restaurar stock si hay metadatos
        if (hasMetadata) {
            for (const item of movement.items_json) {
                const qty = parseInt(item.cantidad);
                console.log(`🔄 Restaurando: ${item.titulo} +${qty} (id: ${item.id})`);
                const { error: rpcErr } = await supabase.rpc('adjust_product_stock', {
                    p_id: item.id,
                    p_delta: qty
                });
                if (rpcErr) {
                    console.error('❌ Error RPC restauración:', rpcErr);
                    return showToast(`No se pudo restaurar stock de ${item.titulo}: ${rpcErr.message}`, 'error');
                }
                console.log(`✅ Stock restaurado OK: ${item.titulo}`);
            }
            catalogService.patchStockInCache(
                movement.items_json.map(i => ({ id: i.id, delta: parseInt(i.cantidad) }))
            );

        }

        // 2. Eliminar el registro
        const { error } = await supabase.from('caja_movimientos').delete().eq('id', id);
        if (error) return alert('Error al eliminar: ' + error.message);
        
        setMovimientos(prev => prev.filter(m => m.id !== id));
        if (searchTerm) fetchVentaResults(searchTerm);
        console.log('✅ Movimiento eliminado y stock restaurado correctamente.');
    };

    const handleCloseCaja = async () => {
        const totals = calculateTotals();
        const cerradoAt = new Date().toISOString();
        const turnoResumen = {
            ...turnoActivo,
            estado: 'CERRADO',
            monto_final: totals.efectivoEnCaja,
            cerrado_at: cerradoAt,
        };
        const { error } = await supabase
            .from('turnos_caja')
            .update({
                estado: 'CERRADO',
                monto_final: totals.efectivoEnCaja,
                cerrado_at: cerradoAt,
            })
            .eq('id', turnoActivo.id);

        if (error) return alert('Error al cerrar caja');
        setShowCloseModal(false);
        await init();
        // Mostrar resumen del turno recién cerrado para que el vendedor confirme los datos
        setShowDetailModal(turnoResumen);
    };

    const handleDeleteTurno = async (id) => {
        const ok = await showConfirm('¿Seguro que deseas ELIMINAR este turno? (Se borrarán todos sus movimientos asociados)');
        if (!ok) return;
        const { error } = await supabase.from('turnos_caja').delete().eq('id', id);
        if (error) return showToast('Error al eliminar: ' + error.message, 'error');
        setTurnoActivo(null);
        init();
    };

    const handleSaveEditTurno = async (newData) => {
        const { error } = await supabase
            .from('turnos_caja')
            .update({
                responsable: newData.responsable,
                turno: newData.turno,
                monto_inicial: parseFloat(newData.monto_inicial) || 0,
                monto_final: parseFloat(newData.monto_final) || 0,
                fecha: newData.fecha
            })
            .eq('id', newData.id);
            
        if (error) return showToast('Error al actualizar turno: ' + error.message, 'error');
        setShowEditModal(null);
        init();
    };

    const calculateTotals = () => {
        const esCash = m => (m.metodo_pago || 'Efectivo') === 'Efectivo';
        const efectivoIngresos = movimientos.filter(m => m.tipo === 'INGRESO' &&  esCash(m)).reduce((a, m) => a + (parseFloat(m.monto) || 0), 0);
        const efectivoEgresos  = movimientos.filter(m => m.tipo === 'EGRESO'  &&  esCash(m)).reduce((a, m) => a + (parseFloat(m.monto) || 0), 0);
        const digitalIngresos  = movimientos.filter(m => m.tipo === 'INGRESO' && !esCash(m)).reduce((a, m) => a + (parseFloat(m.monto) || 0), 0);
        const digitalEgresos   = movimientos.filter(m => m.tipo === 'EGRESO'  && !esCash(m)).reduce((a, m) => a + (parseFloat(m.monto) || 0), 0);
        const totalIngresos    = efectivoIngresos + digitalIngresos;
        const totalEgresos     = efectivoEgresos  + digitalEgresos;
        const efectivoEnCaja   = (parseFloat(turnoActivo?.monto_inicial) || 0) + efectivoIngresos - efectivoEgresos;
        return { efectivoIngresos, efectivoEgresos, digitalIngresos, digitalEgresos, totalIngresos, totalEgresos, efectivoEnCaja,
                 // aliases para compatibilidad con código existente
                 ingresos: totalIngresos, egresos: totalEgresos, saldoActual: efectivoEnCaja };
    };

    if (loading) return <div className="py-20 flex justify-center items-center"><div className="animate-spin text-primary w-10 h-10 border-4 border-current border-t-transparent rounded-full" /></div>;

    const totals = turnoActivo ? calculateTotals() : { ingresos: 0, egresos: 0, saldoActual: 0, efectivoIngresos: 0, efectivoEgresos: 0, digitalIngresos: 0, digitalEgresos: 0, totalIngresos: 0, totalEgresos: 0, efectivoEnCaja: 0 };

    return (
        <div className="space-y-6 max-w-[1440px] mx-auto animate-in fade-in duration-700 pb-20 px-4">

            {/* ===== SISTEMA DE NOTIFICACIONES ===== */}
            {/* Toasts flotantes */}
            <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
                <AnimatePresence>
                    {toasts.map(toast => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, x: 60, scale: 0.9 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 60, scale: 0.9 }}
                            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl min-w-[280px] max-w-[380px] border backdrop-blur-sm
                                ${ toast.type === 'success' ? 'bg-emerald-950/90 border-emerald-500/30 text-emerald-100' 
                                 : toast.type === 'error'   ? 'bg-red-950/90 border-red-500/30 text-red-100'
                                 : toast.type === 'warning' ? 'bg-amber-950/90 border-amber-500/30 text-amber-100'
                                 : 'bg-navy/90 border-navy/30 text-white'}`}
                        >
                            <span className="text-lg flex-shrink-0 mt-0.5">
                                {toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : toast.type === 'warning' ? '⚠️' : 'ℹ️'}
                            </span>
                            <span className="text-sm font-semibold leading-snug">{toast.message}</span>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>

            {/* Modal de Confirmación personalizado */}
            <AnimatePresence>
                {confirmModal && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9998] flex items-center justify-center bg-navy/60 backdrop-blur-sm px-4"
                    >
                        <motion.div
                            initial={{ scale: 0.85, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.85, opacity: 0, y: 20 }}
                            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                            className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full border border-border/20"
                        >
                            <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
                                <CheckCircle2 size={28} className="text-primary" />
                            </div>
                            <h3 className="text-center text-lg font-black text-navy mb-2">Confirmar Acción</h3>
                            <p className="text-center text-sm text-navy/60 font-medium leading-relaxed mb-8">{confirmModal.message}</p>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => handleConfirmResolve(false)}
                                    className="flex-1 py-3 rounded-2xl border-2 border-border text-navy/60 font-bold text-sm hover:bg-navy/5 transition-all"
                                >Cancelar</button>
                                <button
                                    onClick={() => handleConfirmResolve(true)}
                                    className="flex-1 py-3 rounded-2xl bg-navy text-white font-bold text-sm hover:brightness-110 transition-all shadow-md shadow-navy/20"
                                >Confirmar</button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            {/* --- TOP NAVIGATION BAR --- */}
            <div className="flex bg-white/50 border border-border/20 p-1 rounded-xl w-fit mx-auto sticky top-4 z-40 backdrop-blur-md shadow-sm">
                <button 
                    onClick={() => setCurrentView('panel')}
                    className={`flex items-center gap-2.5 px-5 py-1.5 rounded-lg text-xs font-bold transition-all uppercase tracking-widest ${currentView === 'panel' ? 'bg-navy text-white shadow-sm' : 'text-navy/60 hover:bg-navy/5'}`}
                >
                    <LayoutDashboard size={14} className={currentView === 'panel' ? 'text-primary' : ''} /> Operativa
                </button>
                {isAdmin && (
                    <button
                        onClick={() => setCurrentView('historial')}
                        className={`flex items-center gap-2.5 px-5 py-1.5 rounded-lg text-[10px] font-bold transition-all uppercase tracking-widest ${currentView === 'historial' ? 'bg-navy text-white shadow-sm' : 'text-navy/40 hover:bg-navy/5'}`}
                    >
                        <History size={14} className={currentView === 'historial' ? 'text-primary' : ''} /> Auditoría
                    </button>
                )}
            </div>

            {currentView === 'panel' ? (
                <div className="space-y-8">
                    {/* --- HEADER: PANEL DE CONTROL --- */}
                    <motion.div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm relative overflow-hidden group border border-border/40"
                    >
                        <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-primary/5 rounded-full -mr-16 -mt-16 blur-[40px]" />
                        <div className="relative">
                            <div className="flex items-center gap-2.5 text-primary font-bold text-xs uppercase tracking-widest mb-1">
                                <span className="w-4 h-[1px] bg-primary" /> Gestión Operativa
                            </div>
                            <h2 className="text-xl font-display uppercase tracking-tight text-navy font-black">
                                {turnoActivo ? `Caja: ${turnoActivo.responsable}` : 'Caja Cerrada'}
                            </h2>
                            <div className="flex items-center gap-4 mt-2.5">
                                <div className="flex items-center gap-2 px-2 py-0.5 bg-background border border-border/20 rounded-md">
                                    <div className={`w-1.5 h-1.5 rounded-full ${turnoActivo ? 'bg-success shadow-[0_0_8px_rgba(22,163,74,0.4)] animate-pulse' : 'bg-muted/40'}`} />
                                    <span className="text-xs font-bold text-navy tracking-widest uppercase">{turnoActivo ? 'Canal Activo' : 'Inactivo'}</span>
                                </div>
                                {turnoActivo && (
                                    <span className="text-xs font-mono text-navy font-bold uppercase tracking-tighter">
                                        ID: {turnoActivo.turno} • {new Date(turnoActivo.abierto_at).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(turnoActivo.abierto_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                                {turnoActivo && turnoActivo.vendedor_id !== user?.id && !isAdmin && (
                                    <span className="text-[9px] font-bold text-orange-400 bg-orange-400/10 border border-orange-400/20 px-2 py-0.5 rounded-full uppercase tracking-widest">
                                        Solo lectura — abierto por {turnoActivo.responsable}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="relative flex items-center gap-2">
                            {turnoActivo ? (
                                <>
                                    {(isAdmin || turnoActivo?.vendedor_id === user?.id) && (
                                        <button
                                            onClick={() => setShowEditModal(turnoActivo)}
                                            className="p-2.5 bg-background text-navy/30 rounded-lg hover:text-primary hover:bg-primary/5 transition-all border border-border/20"
                                            title="Editar turno activo"
                                        >
                                            <Edit3 size={16} />
                                        </button>
                                    )}
                                    {isAdmin && (
                                        <button
                                            onClick={() => handleDeleteTurno(turnoActivo.id)}
                                            className="p-2.5 bg-background text-navy/30 rounded-lg hover:text-error hover:bg-error/5 transition-all border border-border/20"
                                            title="Eliminar turno (solo admin)"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setCalcQty(initCalc()); setShowCalcModal(true); }}
                                        className="p-2.5 bg-background text-navy/40 rounded-lg hover:text-primary hover:bg-primary/5 transition-all border border-border/20"
                                        title="Calculadora de billetes"
                                    >
                                        🧮
                                    </button>
                                    <button
                                        onClick={() => setShowCloseModal(true)}
                                        className="bg-navy text-white px-5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-md shadow-navy/10"
                                    >
                                        Cierre de Turno
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => { setCalcQty(initCalc()); setShowCalcModal(true); }}
                                        className="p-2.5 bg-background text-navy/40 rounded-lg hover:text-primary hover:bg-primary/5 transition-all border border-border/20"
                                        title="Calculadora de billetes"
                                    >
                                        🧮
                                    </button>
                                    <button
                                        onClick={() => setShowOpenModal(true)}
                                        className="bg-primary text-navy px-5 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest hover:brightness-105 active:scale-95 transition-all shadow-md shadow-primary/20"
                                    >
                                        Iniciar Jornada
                                    </button>
                                </>
                            )}
                        </div>
                    </motion.div>

                    {turnoActivo ? (
                        /* --- DASHBOARD ACTIVO (Unified Fragment) --- */
                        <>
                            <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
                            {/* Panel Lateral: Saldo */}
                            <motion.div 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="space-y-3"
                            >
                                <div className="bg-white p-3.5 rounded-lg border border-border/40 shadow-sm flex justify-between items-baseline">
                                    <p className="text-xs font-bold text-navy uppercase tracking-widest">Apertura</p>
                                    <p className="text-lg font-black font-mono text-navy tracking-tight">Bs {turnoActivo.monto_inicial.toLocaleString()}</p>
                                </div>
                                <div className="bg-success/5 p-3.5 rounded-lg border border-success/10 flex justify-between items-start">
                                   <p className="text-xs font-bold text-success uppercase tracking-widest flex items-center gap-1.5">
                                       <ArrowDownLeft size={10} /> Ingresos
                                   </p>
                                   <div className="text-right">
                                       <p className="text-lg font-black font-mono text-success tracking-tight">+{totals.totalIngresos.toLocaleString()}</p>
                                       {totals.digitalIngresos > 0 && (
                                           <p className="text-[9px] font-bold text-success/60 font-mono">ef. {totals.efectivoIngresos.toLocaleString()} + dig. {totals.digitalIngresos.toLocaleString()}</p>
                                       )}
                                   </div>
                                </div>
                                <div className="bg-error/5 p-3.5 rounded-lg border border-error/10 flex justify-between items-baseline">
                                   <p className="text-xs font-bold text-error uppercase tracking-widest flex items-center gap-1.5">
                                       <ArrowUpRight size={10} /> Egresos
                                   </p>
                                   <p className="text-lg font-black font-mono text-error tracking-tight">-{totals.totalEgresos.toLocaleString()}</p>
                                </div>
                                <div className="bg-slate-50/50 p-4 rounded-xl border border-border/40 shadow-sm flex flex-col justify-center">
                                     <p className="text-xs font-bold text-navy uppercase tracking-widest mb-1 relative z-10">Efectivo Físico</p>
                                     <div className="flex items-baseline gap-1.5 text-navy relative z-10">
                                         <span className="text-xs font-bold opacity-30">Bs</span>
                                         <span className="text-2xl font-black font-mono tracking-tighter">{totals.efectivoEnCaja.toLocaleString()}</span>
                                     </div>
                                     {totals.digitalIngresos > 0 && (
                                         <p className="text-[9px] font-bold text-primary/60 mt-1">+ Bs {totals.digitalIngresos.toLocaleString()} digital</p>
                                     )}
                                </div>

                                {/* Desglose por método de pago */}
                                {(() => {
                                    const METODOS = [
                                        { id: 'Efectivo', icon: '💵', color: 'text-success' },
                                        { id: 'Yasta (QR)', icon: '📲', color: 'text-blue-500' },
                                        { id: 'Banco Unión (QR/Transf)', icon: '🏦', color: 'text-indigo-500' },
                                        { id: 'BNB', icon: '🏛️', color: 'text-purple-500' },
                                        { id: 'Otros', icon: '💳', color: 'text-muted' },
                                    ];
                                    const ingresosPorMetodo = METODOS.map(m => ({
                                        ...m,
                                        total: movimientos
                                            .filter(mov => mov.tipo === 'INGRESO' && (mov.metodo_pago || 'Efectivo') === m.id)
                                            .reduce((s, mov) => s + (parseFloat(mov.monto) || 0), 0)
                                    })).filter(m => m.total > 0);

                                    if (ingresosPorMetodo.length === 0) return null;
                                    const digitalTotal = ingresosPorMetodo.filter(m => m.id !== 'Efectivo').reduce((s, m) => s + m.total, 0);
                                    return (
                                        <div className="bg-white p-3.5 rounded-xl border border-border/40 shadow-sm space-y-2">
                                            <p className="text-[9px] font-black text-navy/40 uppercase tracking-widest">Ingresos por Método</p>
                                            {ingresosPorMetodo.map(m => (
                                                <div key={m.id} className="flex items-center justify-between">
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-sm leading-none">{m.icon}</span>
                                                        <span className="text-[10px] font-bold text-navy/60">{m.id === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m.id}</span>
                                                    </div>
                                                    <span className={`text-xs font-black font-mono ${m.color}`}>Bs {m.total.toLocaleString()}</span>
                                                </div>
                                            ))}
                                            {digitalTotal > 0 && (
                                                <div className="flex items-center justify-between border-t border-border/20 pt-2 mt-1">
                                                    <span className="text-[9px] font-black text-primary uppercase tracking-widest">Total Digital</span>
                                                    <span className="text-xs font-black font-mono text-primary">Bs {digitalTotal.toLocaleString()}</span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </motion.div>

                            {/* Panel Central: Operaciones (POS-First) */}
                            <div className="xl:col-span-3 bg-white rounded-xl border border-border/30 overflow-hidden shadow-sm flex flex-col">
                                <div className="flex bg-slate-50 border-b border-border/20 p-1">
                                    <button 
                                        onClick={() => setActiveOpTab('pos')}
                                        className={`flex-1 py-1.5 px-4 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeOpTab === 'pos' ? 'bg-white text-primary shadow-sm border border-border/10' : 'text-navy/30 hover:bg-white/50'}`}
                                    >
                                        <ShoppingBag size={14} /> Punto de Venta
                                    </button>
                                    <button 
                                        onClick={() => setActiveOpTab('manual')}
                                        className={`flex-1 py-1.5 px-4 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${activeOpTab === 'manual' ? 'bg-white text-primary shadow-sm border border-border/10' : 'text-navy/30 hover:bg-white/50'}`}
                                    >
                                        <Plus size={14} /> Movimientos Otros
                                    </button>
                                </div>

                                <div className="p-4 pt-1">
                                        {activeOpTab === 'pos' ? (
                                            /* --- PUNTO DE VENTA DIRECTO --- */
                                            <div className="space-y-6">
                                                <div className="relative group">
                                                    <label className="text-xs font-bold text-navy uppercase tracking-widest block mb-3 px-2">Buscador de Manga / Cómic (Venta Inmediata)</label>
                                                    <div className="relative">
                                                        <input 
                                                            type="text" 
                                                            placeholder="Buscar manga o cómic..."
                                                            value={ventaSearch}
                                                            onChange={(e) => handleVentaSearch(e.target.value)}
                                                            className="w-full bg-white border border-border/20 p-3.5 rounded-lg text-sm font-bold text-navy outline-none focus:border-primary/40 transition-all pr-12 shadow-sm"
                                                            autoFocus
                                                        />
                                                        <Search className="absolute right-4 top-1/2 -translate-y-1/2 text-navy/20 group-focus-within:text-primary transition-colors" size={18} />
                                                    </div>

                                                    <AnimatePresence>
                                                        {ventaSearch.length >= 2 && (
                                                            <motion.div 
                                                                initial={{ opacity: 0, scale: 0.98 }}
                                                                animate={{ opacity: 1, scale: 1 }}
                                                                className="absolute z-[100] w-full mt-2 bg-white border border-border/20 shadow-xl rounded-xl overflow-hidden max-h-[400px] overflow-y-auto"
                                                            >
                                                                {ventaResults.length > 0 ? (
                                                                    ventaResults.map(p => {
                                                                        // Stock real disponible = stock en BD - lo ya reservado en carrito
                                                                        const enCarrito = ventaCart.find(i => i.id === p.id)?.cantidad || 0;
                                                                        const stockDisponible = (p.stock_fisico || 0) - enCarrito;
                                                                        return (
                                                                        <button 
                                                                            key={p.id}
                                                                            onClick={() => stockDisponible > 0 ? addToCart(p) : alert('⚠️ No hay más unidades disponibles de este producto.')}
                                                                            className={`w-full p-4 hover:bg-primary/5 border-b border-border/5 last:border-0 flex items-center gap-5 group/item transition-all ${stockDisponible <= 0 && 'opacity-40 grayscale'}`}
                                                                        >
                                                                            <div className="w-14 h-14 bg-navy/5 rounded-xl overflow-hidden shadow-sm flex-shrink-0">
                                                                                {p.imagen_url ? (
                                                                                    <img src={p.imagen_url} alt="" className="w-full h-full object-cover" />
                                                                                ) : (
                                                                                    <div className="w-full h-full flex items-center justify-center text-navy/20">
                                                                                        <Package size={20} />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="font-black text-navy text-sm uppercase truncate group-hover/item:text-primary transition-colors">{p.titulo}</div>
                                                                                <div className="text-[10px] font-bold text-muted uppercase mt-0.5">{p.editorial} • Bs {p.precio_venta_bs?.toLocaleString()}</div>
                                                                            </div>
                                                                            <div className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest ${stockDisponible > 0 ? 'bg-navy text-white' : 'bg-error/10 text-error'}`}>
                                                                                {stockDisponible > 0 ? `Quedan: ${stockDisponible}` : enCarrito > 0 ? 'En carrito' : 'Agotado'}
                                                                            </div>
                                                                        </button>
                                                                        );
                                                                    })
                                                                ) : (
                                                                    <div className="p-10 text-center">
                                                                        <div className="w-12 h-12 bg-muted/10 rounded-full flex items-center justify-center mx-auto mb-3">
                                                                            <AlertCircle className="text-muted/40" size={24} />
                                                                        </div>
                                                                        <p className="text-[10px] font-black text-navy uppercase tracking-widest">Sin resultados</p>
                                                                    </div>
                                                                )}
                                                            </motion.div>
                                                        )}
                                                    </AnimatePresence>
                                                </div>

                                                {/* CARRITO DE VENTAS */}
                                                <AnimatePresence>
                                                    {ventaCart.length > 0 && (
                                                        <motion.div 
                                                            initial={{ opacity: 0, y: 10 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            className="space-y-4"
                                                        >
                                                            <div className="bg-navy/[0.03] rounded-3xl p-5 border border-navy/5">
                                                                <h4 className="text-xs font-bold text-navy uppercase tracking-widest mb-4 px-2">Resumen del Carrito</h4>
                                                                <div className="space-y-2">
                                                                    {ventaCart.map(item => {
                                                                        const precioEditado = item.precio !== item.precioOriginal;
                                                                        return (
                                                                        <div key={item.id} className={`bg-white p-3 rounded-2xl shadow-sm flex items-center justify-between border transition-all ${precioEditado ? 'border-amber-300 bg-amber-50/30' : 'border-border/10'}`}>
                                                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                                                <div className="w-10 h-10 bg-navy/5 rounded-lg overflow-hidden flex-shrink-0">
                                                                                    {item.imagen ? (
                                                                                        <img src={item.imagen} alt="" className="w-full h-full object-cover" />
                                                                                    ) : (
                                                                                        <div className="w-full h-full flex items-center justify-center text-navy/20">
                                                                                            <Package size={16} />
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                                <div className="flex-1 min-w-0">
                                                                                    <div className="text-[11px] font-black text-navy uppercase leading-tight truncate">{item.titulo}</div>
                                                                                    {/* Campo de Precio Manual */}
                                                                                    <div className="flex items-center gap-2 mt-1">
                                                                                        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-all ${precioEditado ? 'border-amber-400 bg-amber-100' : 'border-navy/10 bg-navy/5 hover:border-primary/30'}`}>
                                                                                            <Edit3 size={9} className={precioEditado ? 'text-amber-600' : 'text-muted/50'} />
                                                                                            <span className="text-[9px] font-bold text-muted uppercase">Bs</span>
                                                                                            <input 
                                                                                                type="number" 
                                                                                                value={item.precio}
                                                                                                onChange={(e) => updateCartPrice(item.id, e.target.value)}
                                                                                                onFocus={(e) => e.target.select()}
                                                                                                className={`bg-transparent outline-none text-[11px] font-black w-12 ${precioEditado ? 'text-amber-700' : 'text-navy'}`}
                                                                                            />
                                                                                        </div>
                                                                                        {precioEditado && (
                                                                                            <span className="text-[9px] text-muted line-through opacity-60">Bs {item.precioOriginal}</span>
                                                                                        )}
                                                                                        {precioEditado && (
                                                                                            <button 
                                                                                                onClick={() => updateCartPrice(item.id, item.precioOriginal)}
                                                                                                className="text-[8px] font-black text-amber-600 hover:text-amber-800 uppercase tracking-tighter border border-amber-300 rounded px-1 transition-colors"
                                                                                            >↩ Reset</button>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            </div>

                                                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                                                <div className="flex items-center bg-background rounded-xl p-1 border border-border/10">
                                                                                    <button onClick={() => updateCartQty(item.id, -1)} className="w-7 h-7 rounded-lg hover:bg-white transition-all font-black text-muted text-sm">-</button>
                                                                                    <span className="w-8 text-center text-xs font-black font-mono">{item.cantidad}</span>
                                                                                    <button onClick={() => updateCartQty(item.id, 1)} className="w-7 h-7 rounded-lg hover:bg-white transition-all font-black text-navy text-sm">+</button>
                                                                                </div>
                                                                                <div className="text-right min-w-[60px]">
                                                                                    <div className={`text-xs font-black font-mono ${precioEditado ? 'text-amber-700' : 'text-navy'}`}>Bs {(item.precio * item.cantidad).toLocaleString()}</div>
                                                                                </div>
                                                                                <button onClick={() => updateCartQty(item.id, -item.cantidad)} className="p-1.5 text-error/30 hover:text-error transition-colors">
                                                                                    <Trash2 size={15} />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                        );
                                                                    })}

                                                                </div>
                                                            </div>

                                                            <div className="bg-white border-2 border-navy border-dashed rounded-xl p-4 shadow-sm space-y-3">
                                                                {/* Fila 1: Descuento + Total calculado */}
                                                                <div className="flex items-center gap-6">
                                                                    <div className="flex flex-col gap-0.5 px-2 border-r border-navy/10 pr-6">
                                                                        <label className="text-xs font-bold text-navy uppercase tracking-widest">Descuento (%)</label>
                                                                        <input 
                                                                            type="number"
                                                                            min="0"
                                                                            max="100"
                                                                            value={ventaDiscount}
                                                                            onChange={(e) => {
                                                                                setVentaDiscount(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)));
                                                                                setMontoFinalOverride(null); // Reset override al cambiar descuento
                                                                            }}
                                                                            onFocus={(e) => e.target.select()}
                                                                            className="w-16 bg-navy/5 border border-navy/10 py-1.5 rounded-xl text-base font-black font-mono text-navy outline-none focus:border-primary/50 focus:bg-white focus:ring-4 focus:ring-primary/5 transition-all text-center"
                                                                        />
                                                                    </div>
                                                                    <div className="flex flex-col flex-1">
                                                                        <p className="text-xs font-bold text-navy/50 uppercase tracking-widest mb-0.5">Total Calculado</p>
                                                                        <div className="flex items-baseline gap-2">
                                                                            <span className={`text-lg font-black font-mono ${montoFinalOverride !== null ? 'text-navy/30 line-through text-base' : 'text-navy'}`}>
                                                                                Bs {(ventaCart.reduce((acc, i) => acc + (i.precio * i.cantidad), 0) * (1 - (ventaDiscount / 100))).toLocaleString()}
                                                                            </span>
                                                                            {ventaDiscount > 0 && montoFinalOverride === null && (
                                                                                <span className="text-[10px] font-bold text-error line-through opacity-40">
                                                                                    Bs {ventaCart.reduce((acc, i) => acc + (i.precio * i.cantidad), 0).toLocaleString()}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Fila 2: Monto Final a Cobrar + Botones Redondeo */}
                                                                {(() => {
                                                                    const calc = ventaCart.reduce((acc, i) => acc + (i.precio * i.cantidad), 0) * (1 - (ventaDiscount / 100));
                                                                    const monto = montoFinalOverride !== null ? montoFinalOverride : calc;
                                                                    const roundDown = Math.floor(calc);
                                                                    const roundUp = Math.ceil(calc);
                                                                    return (
                                                                    <div className={`flex items-center gap-3 pt-2 border-t ${montoFinalOverride !== null ? 'border-amber-200' : 'border-navy/5'}`}>
                                                                        <div className="flex flex-col flex-1">
                                                                            <p className="text-[10px] font-bold text-navy/50 uppercase tracking-widest mb-1">💵 Cobrar</p>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="text-xs font-bold text-navy/40">Bs</span>
                                                                                <input
                                                                                    type="number"
                                                                                    value={monto}
                                                                                    onChange={(e) => setMontoFinalOverride(parseFloat(e.target.value) || 0)}
                                                                                    onFocus={(e) => e.target.select()}
                                                                                    className={`w-28 border-b-2 outline-none text-2xl font-black font-mono pb-0.5 transition-all ${montoFinalOverride !== null ? 'border-amber-400 text-amber-700' : 'border-navy/20 text-navy'}`}
                                                                                />
                                                                                {montoFinalOverride !== null && (
                                                                                    <button onClick={() => setMontoFinalOverride(null)} className="text-[9px] font-black text-amber-600 border border-amber-300 rounded px-1.5 py-0.5 hover:bg-amber-50 transition-colors">↩ Auto</button>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                        {/* Botones de redondeo a entero */}
                                                                        {calc !== Math.floor(calc) && (
                                                                        <div className="flex flex-col gap-1">
                                                                            <p className="text-[9px] font-bold text-navy/30 uppercase tracking-widest">Redondear</p>
                                                                            <div className="flex gap-1">
                                                                                {[roundDown, roundUp].map(val => (
                                                                                    <button
                                                                                        key={val}
                                                                                        onClick={() => setMontoFinalOverride(val)}
                                                                                        className={`px-3 py-1.5 rounded-lg text-[11px] font-black border transition-all hover:scale-105 active:scale-95 ${montoFinalOverride === val ? 'bg-amber-400 text-white border-amber-400' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'}`}
                                                                                    >
                                                                                        Bs {val}
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                        )}
                                                                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                                                                            <p className="text-[9px] font-black text-navy/40 uppercase tracking-widest px-1">Método de Pago</p>
                                                                            <div className="flex gap-1">
                                                                                {[
                                                                                    { id: 'Efectivo', icon: '💵', label: 'Efectivo' },
                                                                                    { id: 'Yasta (QR)', icon: '📲', label: 'Yasta' },
                                                                                    { id: 'Banco Unión (QR/Transf)', icon: '🏦', label: 'B. Unión' },
                                                                                    { id: 'BNB', icon: '🏛️', label: 'BNB' },
                                                                                    { id: 'Otros', icon: '💳', label: 'Otros' },
                                                                                ].map(m => (
                                                                                    <button
                                                                                        key={m.id}
                                                                                        onClick={() => setVentaMethod(m.id)}
                                                                                        className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[9px] font-black transition-all border ${ventaMethod === m.id ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow-md' : 'bg-white border-border/30 text-navy/50 hover:border-border hover:text-navy'}`}
                                                                                    >
                                                                                        <span className="text-sm leading-none">{m.icon}</span>
                                                                                        <span>{m.label}</span>
                                                                                    </button>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                        <div className="flex flex-col gap-1.5 flex-shrink-0 min-w-0">
                                                                            {splitEnabled && (
                                                                                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2">
                                                                                    <div className="flex gap-1">
                                                                                        {[
                                                                                            { id: 'Yasta (QR)', icon: '📲', label: 'Yasta' },
                                                                                            { id: 'Banco Unión (QR/Transf)', icon: '🏦', label: 'B. Unión' },
                                                                                            { id: 'BNB', icon: '🏛️', label: 'BNB' },
                                                                                            { id: 'Otros', icon: '💳', label: 'Otros' },
                                                                                        ].map(m => (
                                                                                            <button key={m.id} onClick={() => setSplitMethod2(m.id)}
                                                                                                className={`flex flex-col items-center px-1.5 py-1 rounded text-[8px] font-black border transition-all ${splitMethod2 === m.id ? 'bg-amber-400 border-amber-400 text-white' : 'bg-white border-amber-200 text-amber-700'}`}>
                                                                                                <span className="text-sm leading-none">{m.icon}</span>
                                                                                                <span>{m.label}</span>
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                    <div className="flex flex-col">
                                                                                        <span className="text-[8px] font-black text-amber-600 uppercase">Monto 2do método</span>
                                                                                        <div className="flex items-center gap-1">
                                                                                            <span className="text-[10px] font-bold text-amber-600">Bs</span>
                                                                                            <input type="number" value={splitAmount2} onChange={e => setSplitAmount2(e.target.value)}
                                                                                                className="w-20 border-b-2 border-amber-400 outline-none text-base font-black font-mono text-amber-700 bg-transparent text-center"
                                                                                                placeholder="0"/>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                            <button onClick={() => setSplitEnabled(!splitEnabled)}
                                                                                className={`text-[9px] font-black uppercase tracking-wider py-1 px-3 rounded-lg border transition-all ${splitEnabled ? 'bg-amber-100 border-amber-300 text-amber-700' : 'bg-white border-border/30 text-navy/40 hover:border-border'}`}>
                                                                                {splitEnabled ? '✕ Cancelar pago mixto' : '⇄ Pago Mixto'}
                                                                            </button>
                                                                        </div>
                                                                        <button
                                                                            onClick={handleConfirmVenta}
                                                                            disabled={ventaLoading}
                                                                            className="bg-navy text-white px-6 h-12 rounded-lg text-xs font-bold uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all shadow-md shadow-navy/10 flex items-center gap-2.5 flex-shrink-0"
                                                                        >
                                                                            {ventaLoading ? 'Procesando...' : <><CheckCircle2 size={16} className="text-primary" /> Finalizar </>}
                                                                        </button>
                                                                    </div>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        ) : (
                                            /* --- OTROS MOVIMIENTOS (MANUAL) --- */
                                            (turnoActivo?.vendedor_id === user?.id || isAdmin) ? (
                                            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
                                                <div className="space-y-3">
                                                    <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] block px-2">Naturaleza</label>
                                                    <select 
                                                        value={moveForm.tipo}
                                                        onChange={e => setMoveForm({...moveForm, tipo: e.target.value})}
                                                        className="w-full bg-white border border-border/20 p-3 rounded-lg text-[10px] font-bold uppercase outline-none focus:border-primary/30 transition-all cursor-pointer shadow-sm"
                                                    >
                                                        <option value="INGRESO">INGRESO (+)</option>
                                                        <option value="EGRESO">EGRESO (-)</option>
                                                    </select>
                                                </div>
                                                <div className="space-y-3">
                                                    <div className="flex items-center justify-between px-2">
                                                        <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em]">Categoría</label>
                                                        {isAdmin && (
                                                            <button
                                                                onClick={() => setShowCategoriasModal(true)}
                                                                className="text-[8px] font-black text-primary/60 hover:text-primary uppercase tracking-widest flex items-center gap-1 transition-colors"
                                                            >
                                                                <Edit3 size={9} /> Gestionar
                                                            </button>
                                                        )}
                                                    </div>
                                                    <select 
                                                        value={moveForm.categoria}
                                                        onChange={e => setMoveForm({...moveForm, categoria: e.target.value})}
                                                        className="w-full bg-background border-2 border-border/10 p-4 rounded-2xl text-[11px] font-black uppercase outline-none focus:border-primary/50 transition-all cursor-pointer"
                                                    >
                                                        {categorias
                                                            .filter(c => c.tipo === moveForm.tipo || c.tipo === 'AMBOS')
                                                            .map(c => (
                                                                <option key={c.id} value={c.nombre}>{c.nombre}</option>
                                                            ))
                                                        }
                                                        {categorias.filter(c => c.tipo === moveForm.tipo || c.tipo === 'AMBOS').length === 0 && (
                                                            <option value="">Sin categorías</option>
                                                        )}
                                                    </select>
                                                </div>
                                                <div className="space-y-3">
                                                    <label className="text-xs font-bold text-navy uppercase tracking-widest block px-2">Importe (BS)</label>
                                                    <input 
                                                        type="number" 
                                                        placeholder="0"
                                                        value={moveForm.monto}
                                                        onChange={e => setMoveForm({...moveForm, monto: e.target.value})}
                                                        className="w-full bg-white border border-border/20 p-3 rounded-lg font-mono font-bold text-navy focus:border-primary/30 outline-none text-base transition-all text-center shadow-sm"
                                                    />
                                                </div>
                                                <button onClick={handleAddMovement} className="bg-navy text-white h-12 rounded-lg hover:brightness-110 transition-all shadow-md shadow-navy/10 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                                                    <Plus size={16} className="text-primary" /> Registrar
                                                </button>
                                                <div className="md:col-span-4 mt-2 space-y-3">
                                                    <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] block px-2">Referencia / Observaciones</label>
                                                    <input
                                                        type="text"
                                                        placeholder="Detalle de la transacción..."
                                                        value={moveForm.concepto}
                                                        onChange={e => setMoveForm({...moveForm, concepto: e.target.value})}
                                                        className="w-full bg-background border-2 border-border/10 p-4 rounded-2xl text-[11px] font-bold outline-none focus:border-primary/50 transition-all px-6"
                                                    />
                                                </div>
                                                <div className="md:col-span-4 space-y-2">
                                                    <label className="text-[9px] font-black text-muted uppercase tracking-[0.2em] block px-2">Método de Pago</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        {[
                                                            { id: 'Efectivo', icon: '💵' },
                                                            { id: 'Yasta (QR)', icon: '📲' },
                                                            { id: 'Banco Unión (QR/Transf)', icon: '🏦' },
                                                            { id: 'BNB', icon: '🏛️' },
                                                            { id: 'Otros', icon: '💳' },
                                                        ].map(m => (
                                                            <button
                                                                key={m.id}
                                                                onClick={() => setMoveForm({...moveForm, metodo_pago: m.id})}
                                                                title={m.id}
                                                                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-black border transition-all ${moveForm.metodo_pago === m.id ? 'bg-[var(--primary)] border-[var(--primary)] text-white shadow' : 'bg-white border-border/30 text-muted hover:border-border'}`}
                                                            >
                                                                <span>{m.icon}</span>
                                                                <span>{m.id === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m.id}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                            ) : (
                                                <div className="text-center py-6 text-xs text-muted border border-border/30 rounded-xl bg-slate-50/50">
                                                    Solo <strong>{turnoActivo?.responsable}</strong> puede agregar movimientos a este turno.
                                                </div>
                                            )
                                        )}
                                    </div>
                                </div>
                            </div>
                        
                        {/* --- LIBRO DE OPERACIONES DIARIAS (Full-Width Relocated) --- */}
                        <motion.div 
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="bg-white rounded-xl border border-border/20 overflow-hidden shadow-sm mt-8 w-full"
                        >
                            <div className="p-4 border-b border-border/20 flex items-center justify-between bg-slate-50/50">
                                <div className="flex items-center gap-3">
                                    <div className="w-1.5 h-6 bg-navy rounded-full" />
                                    <h4 className="text-xs font-bold text-navy uppercase tracking-widest px-1">Libro de Operaciones Diarias</h4>
                                </div>
                                <div className="flex items-center gap-4">
                                    <span className="text-xs font-bold text-navy/30 uppercase tracking-widest">{movimientos.length} REGISTROS</span>
                                </div>
                            </div>
                            <div className="overflow-x-auto custom-scrollbar">
                                <table className="w-full text-left border-collapse min-w-[800px]">
                                    <thead className="bg-slate-50 border-b border-border/40 text-xs font-bold text-navy uppercase tracking-widest">
                                        <tr>
                                            <th className="p-5 w-32">Cronología</th>
                                            <th className="p-5 w-40">Flujo</th>
                                            <th className="p-5">Concepto Operativo</th>
                                            <th className="p-5 w-40">Método</th>
                                            <th className="p-5 text-right w-48">Efecto Neto</th>
                                            <th className="p-5 text-center w-24">Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/10">
                                        <AnimatePresence initial={false}>
                                            {movimientos.map(m => {
                                                const METHOD_META = {
                                                    'Efectivo':                   { icon: '💵', color: 'bg-success/10 text-success border-success/20' },
                                                    'Yasta (QR)':                 { icon: '📲', color: 'bg-blue-50 text-blue-600 border-blue-200' },
                                                    'Banco Unión (QR/Transf)':    { icon: '🏦', color: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
                                                    'BNB':                        { icon: '🏛️', color: 'bg-purple-50 text-purple-600 border-purple-200' },
                                                    'Otros':                      { icon: '💳', color: 'bg-slate-100 text-slate-500 border-slate-200' },
                                                };
                                                const metodo = m.metodo_pago || 'Efectivo';
                                                const meta = METHOD_META[metodo] || METHOD_META['Otros'];
                                                const label = metodo === 'Banco Unión (QR/Transf)' ? 'B. Unión' : metodo;
                                                return (
                                                <motion.tr
                                                    key={m.id}
                                                    initial={{ opacity: 0, x: -15 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0, x: 15 }}
                                                    className="hover:bg-slate-50/50 transition-all group"
                                                >
                                                    <td className="p-5 font-mono text-navy/60 text-xs font-bold leading-tight">
                                                        {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </td>
                                                    <td className="p-5">
                                                        <span className={`px-3 py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider border shadow-sm ${m.tipo === 'INGRESO' ? 'bg-success/10 text-success border-success/20' : 'bg-error/10 text-error border-error/20'}`}>
                                                            {m.categoria}
                                                        </span>
                                                    </td>
                                                    <td className="p-5 text-navy font-bold text-sm uppercase tracking-tight">{m.concepto || '—'}</td>
                                                    <td className="p-5">
                                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md font-bold text-[10px] border ${meta.color}`}>
                                                            <span>{meta.icon}</span>
                                                            <span>{label}</span>
                                                        </span>
                                                    </td>
                                                    <td className={`p-5 text-right font-black font-mono text-base tracking-tighter ${m.tipo === 'INGRESO' ? 'text-success' : 'text-error'}`}>
                                                        {m.tipo === 'INGRESO' ? '+' : '-'} {m.monto.toLocaleString()}
                                                    </td>
                                                    <td className="p-5 text-center">
                                                        {(isAdmin || turnoActivo?.vendedor_id === user?.id) && (
                                                        <button
                                                            onClick={() => deleteMovement(m.id)}
                                                            className="p-3 text-muted hover:text-error transition-all opacity-0 group-hover:opacity-100 hover:bg-error/10 rounded-xl"
                                                            title="Eliminar Movimiento"
                                                        >
                                                            <Trash2 size={18} />
                                                        </button>
                                                        )}
                                                    </td>
                                                </motion.tr>
                                                );
                                            })}
                                        </AnimatePresence>
                                        {movimientos.length === 0 && (
                                            <tr>
                                                <td colSpan="5" className="p-20 text-center text-navy/20 uppercase font-black tracking-widest text-xs italic">No se registran movimientos en esta sesión</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </motion.div>
                    </>
                    ) : (
                        /* --- STANDBY: ÚLTIMAS 10 SESIONES --- */
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
                            <motion.div 
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="space-y-8"
                            >
                                <div className="flex items-center gap-4 px-6">
                                    <History size={18} className="text-primary" />
                                    <h4 className="text-sm font-black text-navy uppercase tracking-[0.3em] flex items-center gap-3">
                                        <div className="w-2 h-6 bg-primary rounded-full" />
                                        Cierre Reciente del Módulo
                                    </h4>
                                </div>
                                {ultimoTurno ? (
                                    <div className="bg-white p-7 rounded-3xl border border-border/40 shadow-xl relative overflow-hidden group">
                                        <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full -mr-32 -mt-32 blur-[80px]" />
                                        <div className="grid grid-cols-2 gap-8 relative">
                                            <div>
                                                <p className="text-xs font-bold text-navy uppercase tracking-widest mb-1">Último Responsable</p>
                                                <p className="text-2xl font-black text-navy mb-6 uppercase tracking-tight leading-tight">{ultimoTurno.responsable}</p>
                                                <div className="space-y-3">
                                                    <div>
                                                        <p className="text-xs font-bold text-navy uppercase tracking-widest mb-1">Cierre de Caja</p>
                                                        <p className="text-sm font-bold text-navy tracking-tight">{new Date(ultimoTurno.cerrado_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                                                    </div>
                                                    <div className="inline-flex bg-navy text-white px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-lg shadow-navy/20">
                                                        Turno {ultimoTurno.turno}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col justify-between">
                                                <div>
                                                    <p className="text-xs font-bold text-navy uppercase tracking-widest mb-2">Efectivo de Cierre</p>
                                                    <p className="text-4xl font-black text-navy font-mono tracking-tighter leading-none">Bs {ultimoTurno.monto_final.toLocaleString()}</p>
                                                </div>
                                                <div className="pt-4">
                                                     <button 
                                                        onClick={() => setShowDetailModal(ultimoTurno)} 
                                                        className="group text-sm font-black text-navy hover:text-primary uppercase tracking-widest flex items-center gap-2 justify-end transition-all"
                                                     >
                                                        Auditar <Eye size={18} className="text-primary group-hover:scale-110 transition-transform" />
                                                     </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="p-16 text-center bg-white/50 border-2 border-dashed border-border/40 rounded-3xl">
                                        <Wallet size={48} className="mx-auto text-navy/20 mb-4" />
                                        <p className="text-[10px] text-navy/60 font-black uppercase tracking-[0.2em]">Sin registros previos</p>
                                    </div>
                                )}
                            </motion.div>

                            <motion.div 
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="space-y-8"
                            >
                                <div className="flex items-center gap-4 px-6">
                                    <h4 className="text-sm font-black text-navy uppercase tracking-[0.3em] flex items-center gap-3">
                                        <div className="w-2 h-6 bg-primary rounded-full" />
                                        Historial de Actividad (Resumen Inteligente)
                                    </h4>
                                </div>
                                <div className="bg-white rounded-xl border border-border/20 overflow-hidden shadow-sm">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-slate-50 border-b border-border/20">
                                            <tr className="text-xs font-bold text-navy uppercase tracking-widest">
                                                <th className="p-4">Sesión / Turno</th>
                                                <th className="p-4">Auditor Responsable</th>
                                                <th className="p-4 text-right">Efectivo Final</th>
                                                <th className="p-4 text-center px-8">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/10">
                                            {historialTurnos.map(h => (
                                                <tr key={h.id} className="hover:bg-primary/5 transition-all group">
                                                    <td className="p-4">
                                                        <div className="font-bold text-navy text-sm uppercase tracking-tight mb-0.5">{new Date(h.cerrado_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                                                        <div className="text-xs font-bold uppercase text-primary tracking-widest">TURNO: {h.turno}</div>
                                                    </td>
                                                    <td className="p-4 font-bold text-navy text-sm uppercase truncate max-w-[150px]">{h.responsable}</td>
                                                    <td className="p-4 text-right font-black font-mono text-base text-navy tracking-tighter leading-none">Bs {h.monto_final?.toLocaleString()}</td>
                                                    <td className="p-4 text-center">
                                                        <button 
                                                            onClick={() => setShowDetailModal(h)} 
                                                            className="p-2 bg-background rounded-lg text-navy/40 hover:text-primary transition-all border border-border/20 shadow-sm" 
                                                        >
                                                            <Eye size={14} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {historialTurnos.length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="p-12 text-center text-navy/20 uppercase font-black text-[9px] tracking-widest">Historial de caja vacío</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </motion.div>
                        </div>
                    )}
                </div>
            ) : (
                /* --- VISTA: ARCHIVO HISTÓRICO (ADMINISTRATIVO) --- */
                <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="space-y-10"
                >
                    {/* Barra de Auditoría Unificada (Uniformity Fix) */}
                    <motion.div 
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm relative overflow-hidden group border border-border/40"
                    >
                        <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-primary/5 rounded-full -mr-16 -mt-16 blur-[40px]" />
                        <div className="relative">
                            <div className="flex items-center gap-2.5 text-primary font-bold text-xs uppercase tracking-widest mb-1">
                                <span className="w-4 h-[1px] bg-primary" /> Archivo de Sesiones
                            </div>
                            <h2 className="text-xl font-display uppercase tracking-tight text-navy font-black">
                                Caja Maestra
                            </h2>
                            <p className="text-navy/60 text-xs font-bold uppercase tracking-widest mt-1">Análisis y Auditoría de Flujos Históricos</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-4 relative">
                            <div className="flex items-center gap-4 bg-background border border-border/20 rounded-xl px-4 py-2 shadow-sm">
                                <Clock size={16} className="text-primary" />
                                <div className="flex items-center gap-3">
                                    <input 
                                        type="date" 
                                        value={dateRange.from}
                                        onChange={e => setDateRange({...dateRange, from: e.target.value})}
                                        className="bg-transparent text-[11px] font-black font-mono outline-none text-navy w-32 uppercase focus:text-primary transition-colors"
                                    />
                                    <span className="text-navy/20 font-black text-[9px]">—</span>
                                    <input 
                                        type="date" 
                                        value={dateRange.to}
                                        onChange={e => setDateRange({...dateRange, to: e.target.value})}
                                        className="bg-transparent text-[11px] font-black font-mono outline-none text-navy w-32 uppercase focus:text-primary transition-colors"
                                    />
                                </div>
                            </div>
                            <div className="relative group min-w-[280px]">
                                <input 
                                    type="text" 
                                    placeholder="Auditador / Responsable..." 
                                    className="bg-white border border-border/20 rounded-xl pl-10 pr-4 py-2.5 text-sm font-bold outline-none focus:border-primary/40 w-full text-navy placeholder-navy/20 transition-all shadow-sm"
                                    value={searchTerm}
                                    onChange={e => setSearchTerm(e.target.value)}
                                />
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-navy/20 group-focus-within:text-primary transition-all" size={16} />
                            </div>
                        </div>
                    </motion.div>

                    {/* Tabla Maestra */}
                    <div className="bg-white rounded-3xl border border-border/40 shadow-xl overflow-hidden">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-[#fcfdfe] border-b border-border/20">
                                <tr className="text-xs font-bold uppercase tracking-widest text-navy">
                                    <th className="p-6">Referencia</th>
                                    <th className="p-6">Auditor Responsable</th>
                                    <th className="p-6">Turno</th>
                                    <th className="p-6 text-right">Apertura</th>
                                    <th className="p-6 text-right">Cierre Efectivo</th>
                                    <th className="p-6 text-right px-10">Gestión</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/10">
                                {historialTurnos.map(h => (
                                    <tr key={h.id} className="hover:bg-primary/5 transition-all group">
                                        <td className="p-6">
                                            <div className="font-bold text-navy text-sm uppercase tracking-tight mb-1">{new Date(h.cerrado_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                                            <div className="text-xs text-navy/60 font-mono tracking-tighter font-bold uppercase">ID: {h.id.slice(0,6)}</div>
                                        </td>
                                        <td className="p-6 font-bold text-navy text-sm uppercase truncate max-w-[150px]">{h.responsable}</td>
                                        <td className="p-6">
                                            <span className="text-xs font-bold uppercase bg-navy text-white px-3 py-1.5 rounded-lg border border-white/5">{h.turno}</span>
                                        </td>
                                        <td className="p-6 text-right">
                                            <div className="font-bold text-navy/60 font-mono text-xs">Bs {h.monto_inicial.toLocaleString()}</div>
                                        </td>
                                        <td className="p-6 text-right">
                                            <div className="font-black text-navy font-mono text-xl tracking-tight leading-none">Bs {h.monto_final?.toLocaleString()}</div>
                                            <div className="text-xs font-bold text-success mt-1.5 tracking-widest uppercase">✓ Cerrado</div>
                                        </td>
                                        <td className="p-6 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button onClick={() => setShowDetailModal(h)} className="p-2.5 bg-background rounded-xl text-navy/70 hover:text-primary transition-all border border-border/20 shadow-sm" title="Detalle">
                                                    <Eye size={16} />
                                                </button>
                                                {isAdmin && (
                                                    <>
                                                        <button onClick={() => setShowEditModal(h)} className="p-2.5 bg-background rounded-xl text-navy/70 hover:text-accent transition-all border border-border/20 shadow-sm" title="Editar (solo admin)">
                                                            <Edit3 size={16} />
                                                        </button>
                                                        <button onClick={() => handleDeleteTurno(h.id)} className="p-2.5 bg-background rounded-xl text-navy/70 hover:text-error transition-all border border-border/20 shadow-sm" title="Eliminar (solo admin)">
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {historialTurnos.length === 0 && (
                                    <tr>
                                        <td colSpan="6" className="p-32 text-center">
                                            <Search size={40} className="mx-auto text-navy/10 mb-4" />
                                            <p className="text-[10px] uppercase font-black tracking-widest text-navy/30">Sin registros encontrados</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {hasMore && (
                        <div className="flex justify-center pb-32">
                            <button 
                                onClick={() => setHistoryLimit(prev => prev + 20)}
                                className="bg-navy text-white px-20 py-8 rounded-[2.5rem] text-[11px] font-black uppercase tracking-[0.5em] shadow-[0_30px_90px_-15px_rgba(0,0,0,0.5)] hover:bg-black active:scale-95 transition-all flex items-center gap-8 border border-white/5"
                            >
                                <Plus size={24} className="text-primary" /> Sincronizar Registros de Archivo Profundo
                            </button>
                        </div>
                    )}
                </motion.div>
            )}

            {/* --- MODAL ABRIR CAJA --- */}
            <AnimatePresence>
                {showOpenModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-md">
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20"
                        >
                            <div className="bg-navy p-6 text-white text-center relative">
                                <button onClick={() => setShowOpenModal(false)} className="absolute right-6 top-6 text-white/40 hover:text-white transition-colors">
                                    <XCircle size={24} />
                                </button>
                                <div className="w-16 h-16 bg-primary text-background rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-xl shadow-primary/20">
                                    <Wallet size={32} className="stroke-[2.5px]" />
                                </div>
                                <h3 className="text-2xl font-display uppercase tracking-tight">Apertura de Turno</h3>
                                <p className="text-white/40 text-[10px] font-mono uppercase tracking-[0.3em] mt-1">Configuración inicial de caja</p>
                            </div>
                            
                            <div className="p-10 space-y-6">
                                <div className="grid grid-cols-1 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-navy uppercase tracking-widest block mb-2 px-1">Turno</label>
                                        <select 
                                            value={openForm.turno}
                                            onChange={e => setOpenForm({...openForm, turno: e.target.value})}
                                            className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                                        >
                                            <option>MAÑANA</option>
                                            <option>TARDE</option>
                                            <option>DÍA</option>
                                        </select>
                                    </div>
                                    <div className="bg-background/50 p-4 rounded-2xl border border-border/40">
                                         <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-1 px-1">Responsable Detectado</label>
                                         <div className="flex items-center gap-2 text-navy">
                                             <User size={14} className="text-primary" />
                                             <span className="text-sm font-bold">{profile?.nombre || user?.email}</span>
                                         </div>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Monto Inicial en Efectivo (BS)</label>
                                    <div className="relative">
                                        <input 
                                            type="number"
                                            value={openForm.monto_inicial}
                                            onChange={e => setOpenForm({...openForm, monto_inicial: e.target.value})}
                                            className="w-full bg-background border-2 border-border/80 p-4 rounded-2xl text-2xl font-black font-mono outline-none focus:border-primary transition-all text-center tracking-tighter"
                                            placeholder="0.00"
                                        />
                                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-bold text-xs uppercase">Bs</div>
                                    </div>
                                </div>

                                {ultimoTurno && openForm.monto_inicial && parseFloat(openForm.monto_inicial) !== ultimoTurno.monto_final && (
                                    <div className="bg-error/5 border border-error/20 p-4 rounded-2xl flex gap-3 items-center">
                                        <AlertCircle size={20} className="text-error shrink-0" />
                                        <p className="text-[10px] font-bold text-error leading-relaxed uppercase">
                                            Diferencia detectada: el turno anterior cerró con <span className="underline">Bs {ultimoTurno.monto_final.toLocaleString()}</span>. 
                                            Faltan/Sobran Bs {(parseFloat(openForm.monto_inicial) - ultimoTurno.monto_final).toLocaleString()}.
                                        </p>
                                    </div>
                                )}

                                {ultimoTurno && openForm.monto_inicial && parseFloat(openForm.monto_inicial) === ultimoTurno.monto_final && (
                                    <div className="bg-success/5 border border-success/20 p-4 rounded-2xl flex gap-3 items-center">
                                        <CheckCircle2 size={20} className="text-success shrink-0" />
                                        <p className="text-[10px] font-bold text-success leading-relaxed uppercase tracking-wider">
                                            ¡El monto coincide perfectamente con el cierre anterior! Saldo verificado.
                                        </p>
                                    </div>
                                )}

                                <button 
                                    onClick={handleOpenCaja}
                                    className="w-full bg-text text-white py-5 rounded-3xl text-sm font-black uppercase tracking-[0.3em] hover:bg-black transition-all shadow-2xl active:scale-95"
                                >
                                    Abrir Turno Ahora
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* --- MODAL CERRAR CAJA --- */}
            <AnimatePresence>
                {showCloseModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/40 backdrop-blur-md">
                        <motion.div 
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            className="bg-white w-full max-w-md rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20"
                        >
                            <div className="p-8 text-center space-y-6">
                                <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto shadow-inner">
                                    <AlertCircle size={32} className="stroke-[2.5px]" />
                                </div>
                                <div>
                                    <h3 className="text-2xl font-display uppercase tracking-tight text-navy">¿Cerrar Turno Actual?</h3>
                                    <p className="text-xs text-muted font-medium mt-2">Se registrarán los totales finales y la caja dejará de recibir movimientos.</p>
                                </div>

                                <div className="bg-background/50 rounded-3xl p-6 border border-border divide-y divide-border/40">
                                    <div className="flex justify-between py-2 items-center">
                                        <span className="text-[10px] font-bold text-muted uppercase tracking-widest">Apertura</span>
                                        <span className="font-mono font-black text-navy">Bs {turnoActivo.monto_inicial.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between py-2 items-center">
                                        <span className="text-[10px] font-bold text-success uppercase tracking-widest">+ Ef. Ingresado</span>
                                        <span className="font-mono font-black text-success">Bs {totals.efectivoIngresos.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between py-2 items-center">
                                        <span className="text-[10px] font-bold text-error uppercase tracking-widest">- Ef. Egresado</span>
                                        <span className="font-mono font-black text-error">Bs {totals.efectivoEgresos.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between py-3 items-center">
                                        <span className="text-[11px] font-black text-navy uppercase tracking-[0.2em]">💵 Efectivo Físico</span>
                                        <span className="text-2xl font-black font-mono text-primary">Bs {totals.efectivoEnCaja.toLocaleString()}</span>
                                    </div>
                                    {totals.digitalIngresos > 0 && (
                                        <>
                                            {[
                                                { id: 'Yasta (QR)', icon: '📲' },
                                                { id: 'Banco Unión (QR/Transf)', icon: '🏦' },
                                                { id: 'BNB', icon: '🏛️' },
                                                { id: 'Otros', icon: '💳' },
                                            ].map(m => {
                                                const t = movimientos.filter(mov => mov.tipo === 'INGRESO' && (mov.metodo_pago || 'Efectivo') === m.id).reduce((s, mov) => s + (parseFloat(mov.monto) || 0), 0);
                                                if (!t) return null;
                                                return (
                                                    <div key={m.id} className="flex justify-between py-1.5 items-center">
                                                        <span className="text-[10px] font-bold text-muted uppercase tracking-widest">{m.icon} {m.id === 'Banco Unión (QR/Transf)' ? 'B. Unión' : m.id}</span>
                                                        <span className="font-mono font-bold text-navy text-sm">Bs {t.toLocaleString()}</span>
                                                    </div>
                                                );
                                            })}
                                            <div className="flex justify-between py-2 items-center">
                                                <span className="text-[10px] font-black text-navy uppercase tracking-widest">Total Ventas</span>
                                                <span className="font-mono font-black text-navy">Bs {totals.totalIngresos.toLocaleString()}</span>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="flex gap-4">
                                    <button onClick={() => setShowCloseModal(false)} className="flex-1 bg-surface py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest text-navy border border-border hover:bg-white transition-all">Cancelar</button>
                                    <button onClick={handleCloseCaja} className="flex-1 bg-error text-white py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-error/20 hover:brightness-110 active:scale-95 transition-all">Confirmar Cierre</button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* --- MODAL EDITAR TURNO --- */}
            <AnimatePresence>
                {showEditModal && (
                    <EditTurnoModal 
                        turno={showEditModal} 
                        vendedores={vendedores}
                        onSave={handleSaveEditTurno} 
                        onClose={() => setShowEditModal(null)} 
                    />
                )}
            </AnimatePresence>

            {/* --- MODAL DETALLE TURNO HISTORIAL --- */}
            <AnimatePresence>
                {showDetailModal && (
                   <TurnoDetailModal
                        turno={showDetailModal}
                        onClose={() => setShowDetailModal(null)}
                   />
                )}
            </AnimatePresence>

            {/* ===== MODAL: CALCULADORA DE BILLETES ===== */}
            {showCalcModal && (() => {
                const denom = [...BILLETES, ...MONEDAS];
                const total = denom.reduce((s, d) => s + d * (parseFloat(calcQty[d]) || 0), 0);
                return (
                    <div
                        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(4px)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                        onClick={() => setShowCalcModal(false)}
                    >
                        <div
                            onClick={e => e.stopPropagation()}
                            style={{ background: 'white', borderRadius: '20px', width: '100%', maxWidth: '420px', boxShadow: '0 25px 50px rgba(0,0,0,0.3)', overflow: 'hidden' }}
                        >
                            {/* Header */}
                            <div style={{ background: '#1b3a57', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ color: '#f5a800', fontWeight: 900, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🧮 Conteo de Caja</span>
                                <button onClick={() => setShowCalcModal(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '18px' }}>✕</button>
                            </div>

                            {/* Body */}
                            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '70vh', overflowY: 'auto' }}>
                                {/* Billetes */}
                                <p style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.1em', margin: 0 }}>Billetes</p>
                                {BILLETES.map(d => (
                                    <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ width: '56px', fontSize: '13px', fontWeight: 900, color: '#1e293b', fontFamily: 'monospace', textAlign: 'right' }}>Bs {d}</span>
                                        <input
                                            type="number" min="0" step="1"
                                            value={calcQty[d] === 0 ? '' : calcQty[d]}
                                            placeholder="0"
                                            onChange={e => setCalcQty(p => ({ ...p, [d]: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 }))}
                                            onClick={e => e.target.select()}
                                            style={{ flex: 1, padding: '7px 12px', borderRadius: '8px', border: '1.5px solid #e2e8f0', fontWeight: 800, fontSize: '14px', outline: 'none', textAlign: 'center' }}
                                            onFocus={e => { e.target.style.borderColor = '#f07d2a'; e.target.select(); }}
                                            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                        <span style={{ width: '80px', fontSize: '13px', fontWeight: 800, color: '#475569', fontFamily: 'monospace', textAlign: 'right' }}>
                                            = Bs {(d * (parseFloat(calcQty[d]) || 0)).toFixed(2)}
                                        </span>
                                    </div>
                                ))}

                                {/* Monedas */}
                                <p style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#94a3b8', letterSpacing: '0.1em', margin: '6px 0 0 0' }}>Monedas</p>
                                {MONEDAS.map(d => (
                                    <div key={d} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ width: '56px', fontSize: '13px', fontWeight: 900, color: '#1e293b', fontFamily: 'monospace', textAlign: 'right' }}>Bs {d}</span>
                                        <input
                                            type="number" min="0" step="1"
                                            value={calcQty[d] === 0 ? '' : calcQty[d]}
                                            placeholder="0"
                                            onChange={e => setCalcQty(p => ({ ...p, [d]: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 }))}
                                            onClick={e => e.target.select()}
                                            style={{ flex: 1, padding: '7px 12px', borderRadius: '8px', border: '1.5px solid #e2e8f0', fontWeight: 800, fontSize: '14px', outline: 'none', textAlign: 'center' }}
                                            onFocus={e => { e.target.style.borderColor = '#94a3b8'; e.target.select(); }}
                                            onBlur={e => e.target.style.borderColor = '#e2e8f0'}
                                        />
                                        <span style={{ width: '80px', fontSize: '13px', fontWeight: 800, color: '#475569', fontFamily: 'monospace', textAlign: 'right' }}>
                                            = Bs {(d * (parseFloat(calcQty[d]) || 0)).toFixed(2)}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            {/* Total + acciones */}
                            <div style={{ borderTop: '2px solid #f1f5f9', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                <button
                                    onClick={() => setCalcQty(initCalc())}
                                    style={{ padding: '8px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', background: 'white', fontWeight: 700, fontSize: '12px', cursor: 'pointer', color: '#94a3b8' }}
                                >
                                    Limpiar
                                </button>
                                <div style={{ textAlign: 'right' }}>
                                    <p style={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', color: '#64748b', margin: 0 }}>Total en Caja</p>
                                    <p style={{ fontSize: '26px', fontWeight: 900, color: '#1b3a57', fontFamily: 'monospace', margin: 0, lineHeight: 1.1 }}>Bs {total.toFixed(2)}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* ===== MODAL: GESTIÓN DE CATEGORÍAS (solo admin) ===== */}
            <AnimatePresence>
                {showCategoriasModal && isAdmin && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-[9997] flex items-center justify-center bg-navy/60 backdrop-blur-sm px-4"
                        onClick={(e) => e.target === e.currentTarget && setShowCategoriasModal(false)}
                    >
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
                            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col border border-border/20"
                        >
                            <div className="p-6 border-b border-border/10 flex items-center justify-between shrink-0">
                                <div>
                                    <h3 className="text-lg font-black text-navy uppercase tracking-widest">Categorías de Caja</h3>
                                    <p className="text-xs text-muted mt-0.5">Gestiona las categorías de ingresos y egresos</p>
                                </div>
                                <button onClick={() => setShowCategoriasModal(false)} className="w-9 h-9 rounded-xl bg-navy/5 hover:bg-navy/10 flex items-center justify-center transition-colors">
                                    <XCircle size={18} className="text-navy/40" />
                                </button>
                            </div>
                            <div className="p-6 border-b border-border/10 bg-navy/[0.02] shrink-0">
                                <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-3">
                                    {editingCategoria ? '✏️ Editando categoría' : '➕ Nueva categoría'}
                                </p>
                                <div className="flex gap-3">
                                    <select
                                        value={categoriaForm.tipo}
                                        onChange={e => setCategoriaForm({...categoriaForm, tipo: e.target.value})}
                                        className="bg-white border border-border/20 rounded-xl px-3 py-2.5 text-[11px] font-black uppercase outline-none focus:border-primary/40 transition-all cursor-pointer w-32 shrink-0"
                                    >
                                        <option value="INGRESO">Ingreso</option>
                                        <option value="EGRESO">Egreso</option>
                                        <option value="AMBOS">Ambos</option>
                                    </select>
                                    <input
                                        type="text"
                                        placeholder="Nombre de la categoría..."
                                        value={categoriaForm.nombre}
                                        onChange={e => setCategoriaForm({...categoriaForm, nombre: e.target.value})}
                                        onKeyDown={e => e.key === 'Enter' && handleSaveCategoria()}
                                        className="flex-1 bg-white border border-border/20 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-primary/40 transition-all"
                                    />
                                    <button
                                        onClick={handleSaveCategoria}
                                        className="bg-navy text-white px-4 rounded-xl text-xs font-bold hover:brightness-110 transition-all flex items-center gap-1.5 shrink-0"
                                    >
                                        {editingCategoria ? <><CheckCircle2 size={13} /> Guardar</> : <><Plus size={13} /> Crear</>}
                                    </button>
                                    {editingCategoria && (
                                        <button
                                            onClick={() => { setEditingCategoria(null); setCategoriaForm({ nombre: '', tipo: 'INGRESO' }); }}
                                            className="px-3 rounded-xl border border-border text-navy/40 hover:bg-navy/5 transition-all text-xs font-bold"
                                        >✕</button>
                                    )}
                                </div>
                            </div>
                            <div className="overflow-y-auto flex-1 p-4">
                                {['INGRESO', 'EGRESO', 'AMBOS'].map(tipo => {
                                    const grupo = categorias.filter(c => c.tipo === tipo);
                                    if (grupo.length === 0) return null;
                                    return (
                                        <div key={tipo} className="mb-4">
                                            <p className={`text-[9px] font-black uppercase tracking-widest mb-2 px-2 ${tipo === 'INGRESO' ? 'text-emerald-600' : tipo === 'EGRESO' ? 'text-red-500' : 'text-navy/40'}`}>
                                                {tipo === 'INGRESO' ? '▲ Ingresos' : tipo === 'EGRESO' ? '▼ Egresos' : '⇅ Ambos'}
                                            </p>
                                            {grupo.map(cat => (
                                                <div key={cat.id} className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-navy/[0.03] group transition-colors">
                                                    <span className="text-sm font-bold text-navy">{cat.nombre}</span>
                                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => { setEditingCategoria(cat); setCategoriaForm({ nombre: cat.nombre, tipo: cat.tipo }); }} className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition-colors"><Edit3 size={12} /></button>
                                                        <button onClick={() => handleDeleteCategoria(cat.id, cat.nombre)} className="w-7 h-7 rounded-lg bg-error/10 text-error flex items-center justify-center hover:bg-error/20 transition-colors"><Trash2 size={12} /></button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                                {categorias.length === 0 && (
                                    <div className="py-10 text-center text-muted text-sm">No hay categorías. Crea la primera ↑</div>
                                )}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

function EditTurnoModal({ turno, vendedores, onSave, onClose }) {
    const [formData, setFormData] = useState({ ...turno });

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-md">
            <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20"
            >
                <div className="bg-navy p-6 text-white text-center relative">
                    <button onClick={onClose} className="absolute right-6 top-6 text-white/40 hover:text-white transition-colors">
                        <XCircle size={24} />
                    </button>
                    <h3 className="text-2xl font-display uppercase tracking-tight">Editar Turno</h3>
                    <p className="text-white/40 text-[10px] font-mono uppercase tracking-[0.2em] mt-1">ID: {turno.id.slice(0,8)}</p>
                </div>
                
                <div className="p-10 space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Fecha</label>
                            <input 
                                type="date"
                                value={formData.fecha}
                                onChange={e => setFormData({...formData, fecha: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Turno</label>
                            <select 
                                value={formData.turno}
                                onChange={e => setFormData({...formData, turno: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                            >
                                <option>MAÑANA</option>
                                <option>TARDE</option>
                                <option>DÍA</option>
                            </select>
                        </div>
                        <div className="col-span-2">
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Responsable</label>
                            <input 
                                type="text"
                                value={formData.responsable}
                                onChange={e => setFormData({...formData, responsable: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-xs font-bold focus:border-primary outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Saldo Inicial (BS)</label>
                            <input 
                                type="number"
                                value={formData.monto_inicial}
                                onChange={e => setFormData({...formData, monto_inicial: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-lg font-black font-mono focus:border-primary outline-none transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-muted uppercase tracking-widest block mb-2 px-1">Saldo Final (BS)</label>
                            <input 
                                type="number"
                                value={formData.monto_final}
                                onChange={e => setFormData({...formData, monto_final: e.target.value})}
                                className="w-full bg-background border border-border p-3 rounded-2xl text-lg font-black font-mono focus:border-primary outline-none transition-all"
                            />
                        </div>
                    </div>

                    <div className="flex gap-4 mt-4">
                        <button onClick={onClose} className="flex-1 bg-surface py-4 rounded-3xl text-[10px] font-black uppercase tracking-widest text-navy border border-border">Cancelar</button>
                        <button onClick={() => onSave(formData)} className="flex-1 bg-primary text-navy py-4 rounded-3xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:brightness-110 transition-all">Guardar Cambios</button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

function TurnoDetailModal({ turno, onClose }) {
    const [movs, setMovs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchMovs();
    }, [turno.id]);

    const fetchMovs = async () => {
        setLoading(true);
        const { data } = await supabase.from('caja_movimientos').select('*').eq('turno_id', turno.id).order('created_at', { ascending: true });
        setMovs(data || []);
        setLoading(false);
    };

    const ingresos = movs.filter(m => m.tipo === 'INGRESO').reduce((acc, m) => acc + m.monto, 0);
    const egresos = movs.filter(m => m.tipo === 'EGRESO').reduce((acc, m) => acc + m.monto, 0);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-lg">
            <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white w-full max-w-4xl max-h-[90vh] rounded-[3rem] shadow-[0_32px_120px_-20px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col"
            >
                {/* Header Compacto Detalle */}
                <div className="bg-navy p-8 text-white flex justify-between items-start shrink-0 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 rounded-full -mr-32 -mt-32 blur-3xl opacity-30" />
                    <div className="relative">
                        <div className="flex items-center gap-3 text-sky font-bold text-[10px] uppercase tracking-widest mb-2">
                            <History size={14} /> DETALLE DE TURNO — #{turno.id.slice(0,8)}
                        </div>
                        <h3 className="text-3xl font-display uppercase tracking-tight tracking-tighter">{turno.responsable}</h3>
                        <p className="text-xs text-white/50 font-medium mt-1">Cerrado el {new Date(turno.cerrado_at).toLocaleString()} • Turno {turno.turno}</p>
                    </div>
                    <button onClick={onClose} className="p-2 text-white/40 hover:text-white transition-all bg-white/5 rounded-full relative z-10">
                        <XCircle size={28} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {loading ? (
                       <div className="py-20 flex justify-center"><div className="w-8 h-8 border-2 border-primary border-t-transparent animate-spin rounded-full" /></div>
                    ) : (
                        <div className="space-y-8">
                            {/* Resumen Numeros */}
                            <div className="grid grid-cols-4 gap-4">
                                <div className="p-4 rounded-2xl bg-background border border-border/40 text-center">
                                    <p className="text-[9px] font-bold text-muted uppercase tracking-widest mb-1">Inicial</p>
                                    <p className="text-lg font-black font-mono">Bs {turno.monto_inicial.toLocaleString()}</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-success/5 border border-success/20 text-center">
                                    <p className="text-[9px] font-bold text-success uppercase tracking-widest mb-1">Ingresos</p>
                                    <p className="text-lg font-black font-mono text-success">+ {ingresos.toLocaleString()}</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-error/5 border border-error/20 text-center">
                                    <p className="text-[9px] font-bold text-error uppercase tracking-widest mb-1">Egresos</p>
                                    <p className="text-lg font-black font-mono text-error">- {egresos.toLocaleString()}</p>
                                </div>
                                <div className="p-4 rounded-2xl bg-navy text-white text-center shadow-lg">
                                    <p className="text-[9px] font-bold text-sky uppercase tracking-widest mb-1">Final</p>
                                    <p className="text-lg font-black font-mono text-primary">Bs {turno.monto_final?.toLocaleString()}</p>
                                </div>
                            </div>

                            {/* Categorización */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <h5 className="text-[10px] font-black text-success uppercase tracking-[0.2em] flex items-center gap-2">
                                        <ArrowDownLeft size={14} /> Desglose de Ingresos
                                    </h5>
                                    <div className="divide-y divide-border/20 border border-border/20 rounded-2xl overflow-hidden shadow-sm">
                                        {['Venta Stock', 'Cobro Pedido', 'Cobro Seña', 'Otro Ingreso'].map(cat => {
                                            const amt = movs.filter(m => m.categoria === cat).reduce((acc, m) => acc + m.monto, 0);
                                            return (
                                                <div key={cat} className="p-4 flex justify-between items-center bg-white hover:bg-success/5 transition-all">
                                                    <span className="text-[11px] font-bold text-text uppercase tracking-wide">{cat}</span>
                                                    <span className="text-sm font-black font-mono text-success">Bs {amt.toLocaleString()}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h5 className="text-[10px] font-black text-error uppercase tracking-[0.2em] flex items-center gap-2">
                                        <ArrowUpRight size={14} /> Desglose de Egresos
                                    </h5>
                                    <div className="divide-y divide-border/20 border border-border/20 rounded-2xl overflow-hidden shadow-sm">
                                        {['Compra/Gasto', 'Retiro', 'Pago Proveedor', 'Otro Egreso'].map(cat => {
                                            const amt = movs.filter(m => m.categoria === cat).reduce((acc, m) => acc + m.monto, 0);
                                            return (
                                                <div key={cat} className="p-4 flex justify-between items-center bg-white hover:bg-error/5 transition-all">
                                                    <span className="text-[11px] font-bold text-text uppercase tracking-wide">{cat}</span>
                                                    <span className="text-sm font-black font-mono text-error">Bs {amt.toLocaleString()}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            {/* Tabla Completa (Scrollable) */}
                            <div className="space-y-4">
                                <h5 className="text-[10px] font-black text-navy uppercase tracking-[0.2em] flex items-center gap-2">
                                    <Clock size={14} /> Auditoría de Movimientos
                                </h5>
                                <div className="border border-border/40 rounded-2xl overflow-hidden">
                                    <table className="w-full text-[11px] border-collapse">
                                        <thead className="bg-[#f8f9fa] border-b border-border/40 text-muted/60 uppercase font-bold tracking-tighter">
                                            <tr>
                                                <th className="p-3 text-left">Hora</th>
                                                <th className="p-3 text-left">Categoría</th>
                                                <th className="p-3 text-left">Detalle</th>
                                                <th className="p-3 text-right">Monto</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/10 text-navy/80">
                                            {movs.map(m => (
                                                <tr key={m.id} className="hover:bg-background transition-all">
                                                    <td className="p-3 border-r border-border/5 font-mono opacity-60">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                                                    <td className="p-3 font-black">{m.categoria}</td>
                                                    <td className="p-3 italic opacity-80">{m.concepto || '—'}</td>
                                                    <td className={`p-3 text-right font-black font-mono ${m.tipo === 'INGRESO' ? 'text-success' : 'text-error'}`}>
                                                        {m.tipo === 'INGRESO' ? '+' : '-'} {m.monto.toLocaleString()}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>


                <div className="p-6 bg-navy/5 border-t border-border/40 text-center shrink-0">
                    <p className="text-[10px] font-mono text-navy/30 uppercase tracking-[0.4em]">Fin del Reporte Auditado</p>
                </div>
            </motion.div>
        </div>
    );
}
