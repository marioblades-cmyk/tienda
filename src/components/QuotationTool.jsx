import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useAuth';
import {
    FileImage, Send, Save, Trash2, Plus, X, ShoppingCart,
    MessageCircle, ChevronDown, RefreshCw, Package, CheckCircle2,
    Clock, XCircle, Archive, Eye, Link, Search, Layers, Hash, Copy
} from 'lucide-react';

const PRICE_TYPES = [
    { key: 'retail', label: 'PVP Retail' },
    { key: 'n2', label: 'N2 (-10%)' },
    { key: 'n3', label: 'N3 (-15%)' },
    { key: 'mayoreo', label: 'Mayoreo' },
];

const PRICE_FIELD = {
    retail: 'precio_venta_bs',
    n2: 'precio_n2_bs',
    n3: 'precio_n3_bs',
    mayoreo: 'precio_mayoreo_bs',
};

const ESTADO_CONFIG = {
    borrador: { label: 'Borrador', icon: Clock, color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20' },
    enviada: { label: 'Enviada', icon: Send, color: 'text-blue-400 bg-blue-400/10 border-blue-400/20' },
    aceptada: { label: 'Aceptada', icon: CheckCircle2, color: 'text-green-400 bg-green-400/10 border-green-400/20' },
    rechazada: { label: 'Rechazada', icon: XCircle, color: 'text-red-400 bg-red-400/10 border-red-400/20' },
};

const CONDITIONS = [
    { title: 'Disponibilidad de Stock', text: 'Los títulos y productos están sujetos a disponibilidad al momento de concretar la compra. Debido al flujo constante de ventas, el inventario puede variar entre la emisión de esta cotización y la confirmación final del pedido.' },
    { title: 'Gestión con Editoriales', text: 'Los pedidos pueden verse afectados por factores ajenos a la tienda, tales como retrasos en las fechas de salida editorial, falta de disponibilidad de producto en origen o recortes en las unidades asignadas por parte de la editorial.' },
    { title: 'Eventos Imprevistos', text: 'La entrega o disponibilidad final podría verse afectada por situaciones de fuerza mayor, eventos climatológicos extremos o retrasos logísticos en el transporte internacional/nacional.' },
    { title: 'Envíos', text: 'El costo de envío no está incluido en el precio. La logística y entrega serán coordinadas directamente con el cliente una vez confirmado el pago, según la zona y el método de transporte de su preferencia.' },
    { title: 'Confirmación', text: 'Para asegurar sus ejemplares, le recomendamos realizar el pago y enviar el comprobante a la brevedad posible.' },
];

function getItemPrice(item, priceType) {
    const field = PRICE_FIELD[priceType];
    return Number(item[field] || item.precio_tapa || 0);
}

export default function QuotationTool() {
    const { user, profile } = useAuth();
    const cardRef = useRef(null);

    // Form state
    const [clienteNombre, setClienteNombre] = useState('');
    const [clienteCelular, setClienteCelular] = useState('+591 ');
    const [nota, setNota] = useState('');
    const [tipoPrecio, setTipoPrecio] = useState('retail');
    const [descuentoPct, setDescuentoPct] = useState(0);
    const [costoEnvio, setCostoEnvio] = useState(0);
    const [items, setItems] = useState([]);

    // UI state
    const [view, setView] = useState('editor'); // 'editor' | 'historial'
    const [historial, setHistorial] = useState([]);
    const [loadingHistorial, setLoadingHistorial] = useState(false);
    const [saving, setSaving] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [currentId, setCurrentId] = useState(null);
    const [currentEstado, setCurrentEstado] = useState('borrador');

    // Bulk add modal state
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkSearch, setBulkSearch] = useState('');
    const [bulkRange, setBulkRange] = useState('');
    const [bulkResults, setBulkResults] = useState([]);
    const [bulkSelected, setBulkSelected] = useState(new Set());
    const [bulkLoading, setBulkLoading] = useState(false);
    const bulkSearchRef = useRef(null);

    // Single item search state
    const [itemSearchQuery, setItemSearchQuery] = useState('');
    const [itemSearchResults, setItemSearchResults] = useState([]);
    const [itemSearchLoading, setItemSearchLoading] = useState(false);
    const itemSearchRef = useRef(null);
    const itemSearchDebounce = useRef(null);

    // Conditions editor state
    const [customConditions, setCustomConditions] = useState(() => CONDITIONS.map(c => ({ ...c })));
    const [showConditionsEditor, setShowConditionsEditor] = useState(false);

    // Load cart from localStorage on mount
    useEffect(() => {
        try {
            const cart = localStorage.getItem('mcb_quote_cart');
            if (cart) {
                const parsed = JSON.parse(cart);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setItems(prev => {
                        // Merge avoiding duplicates by product_id
                        const existing = new Set(prev.map(i => i.product_id));
                        const newItems = parsed.filter(i => !existing.has(i.product_id)).map(item => ({
                            ...item,
                            qty: 1,
                            unitPrice: getItemPrice(item, tipoPrecio),
                            customPrice: null,
                        }));
                        return [...prev, ...newItems];
                    });
                    localStorage.removeItem('mcb_quote_cart');
                }
            }
        } catch (e) {
            console.warn('Error loading cart:', e);
        }
    }, []);

    // Recalculate prices when price type changes
    useEffect(() => {
        setItems(prev => prev.map(item => ({
            ...item,
            unitPrice: item.customPrice !== null ? item.customPrice : getItemPrice(item, tipoPrecio),
        })));
    }, [tipoPrecio]);

    // Descuento efectivo por item: si el item tiene descuento propio lo usa,
    // si no, usa el global. No se acumulan.
    const getEffectivePct = (item) => item.hasCustomDiscount ? (item.itemDiscountPct || 0) : descuentoPct;

    // Calculated totals
    const rawTotal = items.reduce((sum, item) => sum + (item.unitPrice || 0) * (item.qty || 1), 0);
    const subtotal = items.reduce((sum, item) => {
        const pct = getEffectivePct(item);
        return sum + (item.unitPrice || 0) * (1 - pct / 100) * (item.qty || 1);
    }, 0);
    const discountAmount = rawTotal - subtotal;
    const total = subtotal + Number(costoEnvio || 0);

    // Badge: solo aparece cuando TODOS los items tienen el mismo %
    const effectiveDiscounts = items.map(getEffectivePct);
    const allSamePct = items.length > 0 && effectiveDiscounts.every(d => d === effectiveDiscounts[0]);
    const uniformPct = allSamePct ? effectiveDiscounts[0] : 0;

    // ── Item Management ──
    const removeItem = (productId) => {
        setItems(prev => prev.filter(i => i.product_id !== productId));
    };

    const updateQty = (productId, qty) => {
        const q = Math.max(1, parseInt(qty) || 1);
        setItems(prev => prev.map(i => i.product_id === productId ? { ...i, qty: q } : i));
    };

    const updatePrice = (productId, price) => {
        const p = parseFloat(price) || 0;
        setItems(prev => prev.map(i => i.product_id === productId ? { ...i, unitPrice: p, customPrice: p } : i));
    };

    const updateTitulo = (productId, titulo) => {
        setItems(prev => prev.map(i => {
            if (i.product_id !== productId) return i;
            const restoredLink = i.catalogTitulo && titulo.trim().toLowerCase() === i.catalogTitulo.trim().toLowerCase();
            return { ...i, titulo, catalogLinked: restoredLink };
        }));
    };

    const updateItemDiscount = (productId, pct) => {
        const d = Math.min(100, Math.max(0, parseFloat(pct) || 0));
        setItems(prev => prev.map(i => i.product_id === productId ? { ...i, itemDiscountPct: d, hasCustomDiscount: true } : i));
    };

    const duplicateItem = (item) => {
        const newId = `${item.product_id}_copy_${Date.now()}`;
        setItems(prev => {
            const idx = prev.findIndex(i => i.product_id === item.product_id);
            const copy = { ...item, product_id: newId, catalogLinked: false, itemDiscountPct: 0 };
            const next = [...prev];
            next.splice(idx + 1, 0, copy);
            return next;
        });
    };

    const clearAll = () => {
        setItems([]);
        setClienteNombre('');
        setClienteCelular('+591 ');
        setNota('');
        setDescuentoPct(0);
        setCostoEnvio(0);
        setCurrentId(null);
        setCurrentEstado('borrador');
        setCustomConditions(CONDITIONS.map(c => ({ ...c })));
    };

    // ── Bulk Add Modal ──
    const parseRange = (rangeStr) => {
        if (!rangeStr.trim()) return null;
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
        const matches = title.match(/\d+/g);
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
                .limit(150);
            if (error) throw error;
            const results = data || [];
            setBulkResults(results);
            // Auto-select if range is already set
            const rangeSet = parseRange(bulkRange);
            if (rangeSet) {
                setBulkSelected(new Set(
                    results.filter(p => {
                        const v = extractVolNum(p.titulo);
                        return p.titulo.toLowerCase().startsWith(term.trim().toLowerCase()) && v !== null && rangeSet.has(v);
                    }).map(p => p.product_id)
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

    const titleMatchesTerm = (title, term) => {
        // Only select items whose title STARTS WITH the search term (case-insensitive)
        // This avoids selecting "Chainsaw Man x Blue Lock" when searching "Blue Lock"
        return title.toLowerCase().startsWith(term.trim().toLowerCase());
    };

    const applyBulkRange = () => {
        const rangeSet = parseRange(bulkRange);
        if (!rangeSet) {
            // No range: select only items that start with search term
            setBulkSelected(new Set(
                bulkResults.filter(p => titleMatchesTerm(p.titulo, bulkSearch)).map(p => p.product_id)
            ));
            return;
        }
        setBulkSelected(new Set(
            bulkResults.filter(p => {
                const v = extractVolNum(p.titulo);
                return titleMatchesTerm(p.titulo, bulkSearch) && v !== null && rangeSet.has(v);
            }).map(p => p.product_id)
        ));
    };

    const toggleBulkItem = (productId) => {
        setBulkSelected(prev => {
            const next = new Set(prev);
            next.has(productId) ? next.delete(productId) : next.add(productId);
            return next;
        });
    };

    const confirmBulkAdd = () => {
        const toAdd = bulkResults.filter(p => bulkSelected.has(p.product_id));
        setItems(prev => {
            const existing = new Set(prev.map(i => i.product_id));
            const newItems = toAdd.filter(p => !existing.has(p.product_id)).map(p => ({
                ...p, qty: 1, unitPrice: getItemPrice(p, tipoPrecio), customPrice: null,
            }));
            return [...prev, ...newItems];
        });
        setShowBulkModal(false);
        setBulkSearch(''); setBulkRange(''); setBulkResults([]); setBulkSelected(new Set());
    };

    const openBulkModal = () => {
        setShowBulkModal(true);
        setTimeout(() => bulkSearchRef.current?.focus(), 50);
    };

    // ── Single Item Search ──
    const handleItemSearchInput = (val) => {
        setItemSearchQuery(val);
        clearTimeout(itemSearchDebounce.current);
        if (!val || val.trim().length < 2) { setItemSearchResults([]); return; }
        setItemSearchLoading(true);
        itemSearchDebounce.current = setTimeout(async () => {
            try {
                const { data } = await supabase
                    .from('catalogo_productos')
                    .select('*')
                    .ilike('titulo', `%${val.trim()}%`)
                    .order('titulo', { ascending: true })
                    .limit(10);
                setItemSearchResults(data || []);
            } catch (e) {
                console.error(e);
            } finally {
                setItemSearchLoading(false);
            }
        }, 300);
    };

    const addSingleItem = (product) => {
        setItems(prev => {
            if (prev.some(i => i.product_id === product.product_id)) return prev;
            return [...prev, { ...product, qty: 1, unitPrice: getItemPrice(product, tipoPrecio), customPrice: null, catalogLinked: true, catalogTitulo: product.titulo }];
        });
        setItemSearchQuery('');
        setItemSearchResults([]);
        setTimeout(() => itemSearchRef.current?.focus(), 50);
    };

    // ── Capture card as Blob ──
    const captureAsBlob = async () => {
        if (!cardRef.current) return null;
        const canvas = await html2canvas(cardRef.current, {
            scale: 2,
            useCORS: true,
            backgroundColor: '#ffffff',
            logging: false,
        });
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    };

    // ── Image Export (download) ──
    const exportAsImage = async () => {
        if (!cardRef.current) return;
        setExporting(true);
        try {
            const blob = await captureAsBlob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `cotizacion_${clienteNombre || 'MCB'}_${Date.now()}.png`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error exportando imagen:', err);
            alert('Error al generar la imagen: ' + err.message);
        } finally {
            setExporting(false);
        }
    };

    // ── WhatsApp: upload to Supabase Storage ─> send link ──
    const sendWhatsApp = async () => {
        if (!clienteCelular) {
            alert('Por favor ingresá el número de celular del cliente.');
            return;
        }
        if (!cardRef.current) return;
        setExporting(true);
        try {
            const blob = await captureAsBlob();
            if (!blob) throw new Error('No se pudo generar la imagen.');

            // Upload to Supabase Storage
            const fileName = `cotizacion_${user.id}_${Date.now()}.png`;
            const { data: uploadData, error: uploadError } = await supabase.storage
                .from('cotizaciones-imagenes')
                .upload(fileName, blob, { contentType: 'image/png', upsert: false });

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('cotizaciones-imagenes')
                .getPublicUrl(fileName);

            const publicUrl = urlData?.publicUrl;
            if (!publicUrl) throw new Error('No se pudo obtener el link público de la imagen.');

            // Build WhatsApp message
            const phone = clienteCelular.replace(/\D/g, '');
            const nombre = clienteNombre ? `*${clienteNombre}*` : 'estimado cliente';
            const msg = `📚 *Mangas Comics Bolivia* 📚

Hola ${nombre}, te compartimos tu cotización:

🔗 ${publicUrl}

Total: *Bs. ${total.toFixed(2)}*
${nota ? `\n📝 ${nota}` : ''}

Gracias por tu confianza! 😊`;

            window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
        } catch (err) {
            console.error('Error enviando por WhatsApp:', err);
            alert(`Error: ${err.message}\n\nAsegurate de haber creado el bucket "cotizaciones-imagenes" en Supabase Storage con acceso público.`);
        } finally {
            setExporting(false);
        }
    };

    // ── Save to Supabase ──
    const saveCotizacion = async () => {
        if (items.length === 0) {
            alert('Agrega al menos un producto a la cotización.');
            return;
        }
        setSaving(true);
        try {
            const payload = {
                usuario_id: user.id,
                cliente_nombre: clienteNombre,
                cliente_celular: clienteCelular,
                nota,
                tipo_precio: tipoPrecio,
                descuento_pct: descuentoPct,
                costo_envio: costoEnvio,
                estado: currentEstado,
                items_json: items,
                subtotal,
                total,
                updated_at: new Date().toISOString(),
            };

            if (currentId) {
                const { error } = await supabase.from('cotizaciones').update(payload).eq('id', currentId);
                if (error) throw error;
                alert('✅ Cotización actualizada correctamente.');
            } else {
                const { data, error } = await supabase.from('cotizaciones').insert([payload]).select().single();
                if (error) throw error;
                setCurrentId(data.id);
                alert('✅ Cotización guardada correctamente.');
            }
        } catch (err) {
            console.error('Error guardando:', err);
            alert('Error al guardar: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // ── Load Historial ──
    const fetchHistorial = async () => {
        setLoadingHistorial(true);
        try {
            const { data, error } = await supabase
                .from('cotizaciones')
                .select('*')
                .eq('usuario_id', user.id)
                .order('updated_at', { ascending: false });
            if (error) throw error;
            setHistorial(data || []);
        } catch (err) {
            console.error('Error historial:', err);
        } finally {
            setLoadingHistorial(false);
        }
    };

    const openFromHistorial = (cot) => {
        setClienteNombre(cot.cliente_nombre || '');
        setClienteCelular(cot.cliente_celular || '');
        setNota(cot.nota || '');
        setTipoPrecio(cot.tipo_precio || 'retail');
        setDescuentoPct(cot.descuento_pct || 0);
        setCostoEnvio(cot.costo_envio || 0);
        setCurrentEstado(cot.estado || 'borrador');
        setItems(cot.items_json || []);
        setCurrentId(cot.id);
        setView('editor');
    };

    const deleteCotizacion = async (id) => {
        if (!confirm('¿Eliminar esta cotización?')) return;
        try {
            const { error } = await supabase.from('cotizaciones').delete().eq('id', id);
            if (error) throw error;
            setHistorial(prev => prev.filter(c => c.id !== id));
            if (currentId === id) clearAll();
        } catch (err) {
            alert('Error al eliminar: ' + err.message);
        }
    };

    const updateEstado = async (id, estado) => {
        try {
            const { error } = await supabase.from('cotizaciones').update({ estado }).eq('id', id);
            if (error) throw error;
            setHistorial(prev => prev.map(c => c.id === id ? { ...c, estado } : c));
            if (currentId === id) setCurrentEstado(estado);
        } catch (err) {
            alert('Error al actualizar estado: ' + err.message);
        }
    };

    const handleViewChange = (v) => {
        setView(v);
        if (v === 'historial') fetchHistorial();
    };

    const today = new Date().toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });

    return (
        <div className="min-h-screen bg-background text-text">
            {/* ── HEADER ── */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex gap-2">
                    <button
                        onClick={() => handleViewChange('editor')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'editor' ? 'bg-primary text-white shadow-lg' : 'bg-surface border border-border text-muted hover:text-text'}`}
                    >
                        <ShoppingCart size={16} /> Nueva Cotización
                    </button>
                    <button
                        onClick={() => handleViewChange('historial')}
                        className={`px-5 py-2.5 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${view === 'historial' ? 'bg-primary text-white shadow-lg' : 'bg-surface border border-border text-muted hover:text-text'}`}
                    >
                        <Archive size={16} /> Historial
                    </button>
                </div>
                {view === 'editor' && items.length > 0 && (
                    <div className="flex gap-2">
                        <button
                            onClick={() => exportAsImage(false)}
                            disabled={exporting}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                        >
                            <FileImage size={16} className={exporting ? 'animate-pulse' : ''} />
                            {exporting ? 'Generando...' : 'Exportar Imagen'}
                        </button>
                        <button
                            onClick={sendWhatsApp}
                            disabled={exporting}
                            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                        >
                            <MessageCircle size={16} />
                            Enviar WhatsApp
                        </button>
                        <button
                            onClick={saveCotizacion}
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                        >
                            <Save size={16} className={saving ? 'animate-spin' : ''} />
                            {saving ? 'Guardando...' : currentId ? 'Actualizar' : 'Guardar'}
                        </button>
                        <button onClick={clearAll} className="p-2 text-muted hover:text-red-400 transition-colors" title="Limpiar todo">
                            <Trash2 size={18} />
                        </button>
                    </div>
                )}
            </div>

            {view === 'historial' ? (
                /* ── HISTORIAL VIEW ── */
                <div className="space-y-3">
                    {loadingHistorial && (
                        <div className="flex justify-center py-12">
                            <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
                        </div>
                    )}
                    {!loadingHistorial && historial.length === 0 && (
                        <div className="text-center py-16 glass rounded-xl border-dashed border-2">
                            <Archive size={48} className="mx-auto opacity-20 mb-4" />
                            <p className="text-muted font-mono text-sm">No hay cotizaciones guardadas todavía.</p>
                        </div>
                    )}
                    {historial.map(cot => {
                        const cfg = ESTADO_CONFIG[cot.estado] || ESTADO_CONFIG.borrador;
                        const Icon = cfg.icon;
                        return (
                            <div key={cot.id} className="glass rounded-xl p-4 flex items-center gap-4 hover:border-primary/40 transition-all">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-bold text-text truncate">{cot.cliente_nombre || 'Sin nombre'}</span>
                                        {cot.cliente_celular && (
                                            <span className="text-xs font-mono text-muted">· {cot.cliente_celular}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs text-muted">
                                        <span>{Array.isArray(cot.items_json) ? cot.items_json.length : 0} productos</span>
                                        <span>·</span>
                                        <span className="font-bold text-primary">Bs. {Number(cot.total || 0).toFixed(2)}</span>
                                        <span>·</span>
                                        <span>{new Date(cot.updated_at).toLocaleDateString('es-BO')}</span>
                                    </div>
                                </div>
                                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold ${cfg.color}`}>
                                    <Icon size={11} />
                                    {cfg.label}
                                </div>
                                <select
                                    value={cot.estado}
                                    onChange={e => updateEstado(cot.id, e.target.value)}
                                    className="text-xs bg-surface border border-border rounded-lg px-2 py-1 text-muted"
                                >
                                    {Object.entries(ESTADO_CONFIG).map(([k, v]) => (
                                        <option key={k} value={k}>{v.label}</option>
                                    ))}
                                </select>
                                <button
                                    onClick={() => openFromHistorial(cot)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-bold transition-all"
                                >
                                    <Eye size={13} /> Abrir
                                </button>
                                <button
                                    onClick={() => deleteCotizacion(cot.id)}
                                    className="p-1.5 text-muted hover:text-red-400 transition-colors"
                                    title="Eliminar"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                /* ── EDITOR VIEW ── */
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    {/* ── LEFT: Config Panel ── */}
                    <div className="space-y-4">
                        {/* CLIENT */}
                        <div className="card p-5 space-y-4">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-muted flex items-center gap-2">
                                <MessageCircle size={16} className="text-primary" /> Datos del Cliente
                            </h3>
                            <div>
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-1.5">Nombre</label>
                                <input
                                    type="text"
                                    placeholder="Nombre del cliente..."
                                    value={clienteNombre}
                                    onChange={e => setClienteNombre(e.target.value)}
                                    className="input-field h-10 text-sm w-full"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-1.5">Celular / WhatsApp</label>
                                <div className="flex gap-2">
                                    <input
                                        type="tel"
                                        placeholder="+591 7XXXXXXX"
                                        value={clienteCelular}
                                        onChange={e => setClienteCelular(e.target.value)}
                                        className="input-field h-10 text-sm flex-1"
                                    />
                                    {clienteCelular && (
                                        <a
                                            href={`https://wa.me/${clienteCelular.replace(/\D/g, '')}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-3 h-10 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center transition-all"
                                            title="Abrir WhatsApp"
                                        >
                                            <MessageCircle size={16} />
                                        </a>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-1.5">Nota adicional (opcional)</label>
                                <textarea
                                    placeholder="Ej.: Válida hasta el 30/03. Consultar disponibilidad..."
                                    value={nota}
                                    onChange={e => setNota(e.target.value)}
                                    rows={2}
                                    className="input-field text-sm w-full resize-none"
                                />
                            </div>
                            <div>
                                <button
                                    onClick={() => setShowConditionsEditor(v => !v)}
                                    className="flex items-center justify-between w-full text-xs font-bold text-muted hover:text-text transition-colors py-1"
                                >
                                    <span className="uppercase tracking-wider">Condiciones estándar</span>
                                    <span className={`transition-transform ${showConditionsEditor ? 'rotate-180' : ''}`}>▾</span>
                                </button>
                                {showConditionsEditor && (
                                    <div className="mt-2 space-y-3 border border-border rounded-lg p-3 bg-surface-2">
                                        {customConditions.map((cond, i) => (
                                            <div key={i} className="space-y-1">
                                                <input
                                                    type="text"
                                                    value={cond.title}
                                                    onChange={e => setCustomConditions(prev => prev.map((c, j) => j === i ? { ...c, title: e.target.value } : c))}
                                                    className="input-field h-8 text-xs w-full font-bold"
                                                    placeholder="Título de condición"
                                                />
                                                <textarea
                                                    value={cond.text}
                                                    onChange={e => setCustomConditions(prev => prev.map((c, j) => j === i ? { ...c, text: e.target.value } : c))}
                                                    rows={2}
                                                    className="input-field text-xs w-full resize-none"
                                                    placeholder="Texto de la condición..."
                                                />
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => setCustomConditions(CONDITIONS.map(c => ({ ...c })))}
                                            className="text-xs text-muted hover:text-primary transition-colors"
                                        >
                                            ↺ Restablecer por defecto
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* PRICING CONFIG */}
                        <div className="card p-5 space-y-4">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-muted flex items-center gap-2">
                                <Package size={16} className="text-primary" /> Configuración de Precios
                            </h3>
                            <div>
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-1.5">Tipo de Precio Global</label>
                                <select
                                    value={tipoPrecio}
                                    onChange={e => setTipoPrecio(e.target.value)}
                                    className="input-field h-10 text-sm w-full"
                                >
                                    {PRICE_TYPES.map(p => (
                                        <option key={p.key} value={p.key}>{p.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-1.5">Descuento Global (%)</label>
                                <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.5"
                                    value={descuentoPct}
                                    onChange={e => setDescuentoPct(parseFloat(e.target.value) || 0)}
                                    className="input-field h-10 text-sm w-full"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-1.5">Costo de Envío (Bs.)</label>
                                <input
                                    type="number"
                                    min="0"
                                    step="1"
                                    value={costoEnvio}
                                    onChange={e => setCostoEnvio(parseFloat(e.target.value) || 0)}
                                    className="input-field h-10 text-sm w-full"
                                />
                            </div>
                        </div>

                        {/* TOTALS */}
                        <div className="card p-5 space-y-3">
                            <h3 className="font-bold text-sm uppercase tracking-wider text-muted">Resumen de Totales</h3>
                            <div className="space-y-2 text-sm">
                                <div className="flex justify-between font-mono">
                                    <span className="text-muted">Subtotal</span>
                                    <span className="font-bold">Bs. {subtotal.toFixed(2)}</span>
                                </div>
                                {discountAmount > 0 && (
                                    <div className="flex justify-between font-mono text-red-400">
                                        <span>Descuento{uniformPct > 0 ? ` (${uniformPct}%)` : ''}</span>
                                        <span>-Bs. {discountAmount.toFixed(2)}</span>
                                    </div>
                                )}
                                {Number(costoEnvio) > 0 && (
                                    <div className="flex justify-between font-mono text-muted">
                                        <span>Envío</span>
                                        <span>+Bs. {Number(costoEnvio).toFixed(2)}</span>
                                    </div>
                                )}
                                <div className="border-t border-border pt-2 flex justify-between">
                                    <span className="font-display text-lg font-bold">TOTAL</span>
                                    <span className="font-display text-xl font-bold text-primary">Bs. {total.toFixed(2)}</span>
                                </div>
                            </div>
                        </div>

                        {/* ESTADO */}
                        {currentId && (
                            <div className="card p-4">
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-2">Estado de Cotización</label>
                                <select
                                    value={currentEstado}
                                    onChange={e => setCurrentEstado(e.target.value)}
                                    className="input-field h-10 text-sm w-full"
                                >
                                    {Object.entries(ESTADO_CONFIG).map(([k, v]) => (
                                        <option key={k} value={k}>{v.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}
                    </div>

                    {/* ── RIGHT: Items Table & Preview ── */}
                    <div className="xl:col-span-2 space-y-6">
                        {/* ITEMS TABLE */}
                        <div className="card overflow-hidden">
                            <div className="p-4 bg-surface-2 border-b border-border flex items-center justify-between gap-2">
                                <h3 className="font-bold text-sm uppercase tracking-wider text-muted flex items-center gap-2 shrink-0">
                                    <ShoppingCart size={16} className="text-primary" />
                                    Productos ({items.length})
                                </h3>
                                <button
                                    onClick={openBulkModal}
                                    className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-xs font-bold transition-all border border-primary/20"
                                >
                                    <Layers size={14} /> Agregar en lote
                                </button>
                            </div>

                            {/* ── BÚSQUEDA RÁPIDA (siempre visible) ── */}
                            <div className="border-b border-border bg-surface/50 p-3">
                                <div className="flex items-center gap-2">
                                    <Search size={14} className="text-muted shrink-0" />
                                    <input
                                        ref={itemSearchRef}
                                        type="text"
                                        placeholder="Buscar y agregar producto al catálogo..."
                                        value={itemSearchQuery}
                                        onChange={e => handleItemSearchInput(e.target.value)}
                                        className="flex-1 bg-transparent outline-none text-sm"
                                    />
                                    {itemSearchLoading && <RefreshCw size={14} className="animate-spin text-muted shrink-0" />}
                                    {itemSearchQuery && (
                                        <button onClick={() => { setItemSearchQuery(''); setItemSearchResults([]); }} className="text-muted hover:text-text shrink-0">
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                                {itemSearchResults.length > 0 && (
                                    <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border">
                                        {itemSearchResults.map(product => {
                                            const alreadyIn = items.some(i => i.product_id === product.product_id);
                                            const price = getItemPrice(product, tipoPrecio);
                                            return (
                                                <div key={product.product_id}
                                                    onClick={() => !alreadyIn && addSingleItem(product)}
                                                    className={`flex items-center gap-3 px-3 py-2 border-b border-border/50 last:border-0 transition-all ${alreadyIn ? 'opacity-40 cursor-not-allowed' : 'hover:bg-surface-2 cursor-pointer'}`}
                                                >
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-text truncate">{product.titulo}</p>
                                                        <p className="text-xs text-muted">{product.editorial} · Bs. {price.toFixed(2)}</p>
                                                    </div>
                                                    {alreadyIn && <span className="shrink-0 text-xs text-green-500">✓ En lista</span>}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                                {itemSearchQuery.length >= 2 && itemSearchResults.length === 0 && !itemSearchLoading && (
                                    <p className="text-center text-muted text-xs py-3">Sin resultados para "{itemSearchQuery}"</p>
                                )}
                            </div>

                            {items.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                    <ShoppingCart size={48} className="text-muted opacity-20 mb-4" />
                                    <p className="text-muted text-sm font-mono">Carrito vacío</p>
                                    <p className="text-muted/60 text-xs mt-2 mb-4">Buscá un producto arriba para agregar,<br />o usá "Agregar en lote" para cargar por colección</p>
                                    <button onClick={openBulkModal} className="flex items-center gap-2 px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-lg text-sm font-bold transition-all border border-primary/20">
                                        <Layers size={15} /> Agregar en lote
                                    </button>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs font-bold uppercase tracking-wider text-muted bg-surface-2">
                                            <tr>
                                                <th className="text-left p-3">Título</th>
                                                <th className="text-center p-3 w-20">Cant.</th>
                                                <th className="text-right p-3 w-36">P. Unitario</th>
                                                <th className="text-center p-3 w-20">Desc. %</th>
                                                <th className="text-right p-3 w-32">Subtotal</th>
                                                <th className="p-3 w-16"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {items.map(item => {
                                                const effectivePct = getEffectivePct(item);
                                                const priceAfterDto = (item.unitPrice || 0) * (1 - effectivePct / 100);
                                                const itemSubtotalOriginal = (item.unitPrice || 0) * (item.qty || 1);
                                                const itemSubtotal = priceAfterDto * (item.qty || 1);
                                                const showOriginalSubtotal = effectivePct > 0;
                                                return (
                                                    <tr key={item.product_id} className="hover:bg-surface-2/50 transition-colors">
                                                        <td className="p-3">
                                                            <input
                                                                type="text"
                                                                value={item.titulo}
                                                                onChange={e => updateTitulo(item.product_id, e.target.value)}
                                                                className="font-semibold text-text leading-tight bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none w-full text-sm transition-colors"
                                                            />
                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                <p className="text-xs text-muted">{item.editorial}</p>
                                                                {item.catalogLinked
                                                                    ? <span className="text-xs text-green-500/70" title="Vinculado al catálogo maestro">· ✓ cat</span>
                                                                    : <span className="text-xs text-yellow-500" title="No vinculado al catálogo maestro">· ⚠ sin cat</span>
                                                                }
                                                            </div>
                                                        </td>
                                                        <td className="p-3">
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={item.qty}
                                                                onChange={e => updateQty(item.product_id, e.target.value)}
                                                                className="w-16 text-center bg-surface border border-border rounded px-2 py-1 text-sm font-mono"
                                                            />
                                                        </td>
                                                        <td className="p-3">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <span className="text-muted text-xs">Bs.</span>
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    step="0.5"
                                                                    value={item.unitPrice}
                                                                    onChange={e => updatePrice(item.product_id, e.target.value)}
                                                                    className="w-24 text-right bg-surface border border-border rounded px-2 py-1 text-sm font-mono"
                                                                />
                                                            </div>
                                                            {effectivePct > 0 && (
                                                                <p className="text-xs text-primary/70 text-right mt-0.5 font-mono">
                                                                    → Bs. {priceAfterDto.toFixed(2)}
                                                                </p>
                                                            )}
                                                        </td>
                                                        <td className="p-3">
                                                            <div className="flex items-center justify-center gap-0.5">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    max="100"
                                                                    step="1"
                                                                    value={effectivePct || ''}
                                                                    placeholder="0"
                                                                    onChange={e => updateItemDiscount(item.product_id, e.target.value)}
                                                                    className={`w-12 text-center bg-surface border rounded px-1 py-1 text-sm font-mono ${item.hasCustomDiscount ? 'border-primary' : 'border-border'}`}
                                                                />
                                                                <span className="text-muted text-xs">%</span>
                                                            </div>
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            {showOriginalSubtotal && (
                                                                <p className="line-through text-muted text-xs font-mono">Bs. {itemSubtotalOriginal.toFixed(2)}</p>
                                                            )}
                                                            <p className="font-bold font-mono text-primary">Bs. {itemSubtotal.toFixed(2)}</p>
                                                        </td>
                                                        <td className="p-3">
                                                            <div className="flex gap-1">
                                                                <button
                                                                    onClick={() => duplicateItem(item)}
                                                                    className="text-muted hover:text-primary transition-colors"
                                                                    title="Duplicar item"
                                                                >
                                                                    <Copy size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={() => removeItem(item.product_id)}
                                                                    className="text-muted hover:text-red-400 transition-colors"
                                                                    title="Eliminar"
                                                                >
                                                                    <X size={16} />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* ── QUOTATION CARD (for export) ── */}
                        {items.length > 0 && (
                            <div>
                                <p className="text-xs font-mono text-muted mb-2 uppercase tracking-wider">Vista previa de exportación:</p>
                                <div
                                    ref={cardRef}
                                    className="bg-white rounded-2xl overflow-hidden shadow-xl"
                                    style={{ fontFamily: 'sans-serif', maxWidth: '800px' }}
                                >
                                    {/* Card Header */}
                                    <div style={{ background: 'linear-gradient(135deg, #1a2d42 0%, #0f1e2e 100%)', padding: '28px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{ background: 'white', borderRadius: '8px', padding: '4px', height: '60px', width: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <img src="/logo.png" alt="Logo" style={{ height: '52px', width: '52px', objectFit: 'contain' }} />
                                            </div>
                                            <div>
                                                <div style={{ color: 'white', fontSize: '22px', fontWeight: 800, letterSpacing: '0.05em' }}>
                                                    MANGAS <span style={{ color: '#f07d2a' }}>COMICS</span>
                                                </div>
                                                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', letterSpacing: '0.3em', fontWeight: 600 }}>BOLIVIA STORE</div>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            {uniformPct > 0 && (
                                                <div style={{ background: '#f07d2a', borderRadius: '8px', padding: '6px 12px', textAlign: 'center' }}>
                                                    <div style={{ color: 'white', fontSize: '22px', fontWeight: 900, lineHeight: 1 }}>{uniformPct}%</div>
                                                    <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.2em' }}>OFF</div>
                                                </div>
                                            )}
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ color: '#f07d2a', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Cotización</div>
                                                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginTop: '4px' }}>{today}</div>
                                                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px' }}>{profile?.nombre || 'Agente de Ventas'}</div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Client Info */}
                                    <div style={{ padding: '20px 32px 0', borderBottom: '1px solid #eee' }}>
                                        <div style={{ fontSize: '11px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700, marginBottom: '6px' }}>Para</div>
                                        <div style={{ fontSize: '20px', fontWeight: 800, color: '#1a2d42' }}>{clienteNombre || 'Cliente'}</div>
                                        {clienteCelular && (
                                            <div style={{ fontSize: '13px', color: '#666', marginTop: '2px', marginBottom: '16px' }}>📱 {clienteCelular}</div>
                                        )}
                                        {!clienteCelular && <div style={{ marginBottom: '16px' }} />}
                                    </div>

                                    {/* Items Table */}
                                    <div style={{ padding: '0 32px' }}>
                                        {(() => {
                                        const showPFinal = items.some(i => getEffectivePct(i) > 0);
                                        return (
                                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
                                            <thead>
                                                <tr style={{ background: '#f5f5f5' }}>
                                                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, borderRadius: '4px 0 0 4px' }}>Título</th>
                                                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>Editorial</th>
                                                    <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>Cant.</th>
                                                    <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>P/U</th>
                                                    {showPFinal && (
                                                        <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: '10px', color: '#e53e3e', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>Desc.</th>
                                                    )}
                                                    {showPFinal && (
                                                        <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '10px', color: '#2d9e5a', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>P. Final</th>
                                                    )}
                                                    <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, borderRadius: showPFinal ? '0' : '0 4px 4px 0' }}>Subtotal</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {items.map((item, idx) => {
                                                    const ePct = getEffectivePct(item);
                                                    const finalUnit = (item.unitPrice || 0) * (1 - ePct / 100);
                                                    const hasAnyDiscount = ePct > 0;
                                                    const finalSubtotal = finalUnit * (item.qty || 1);
                                                    return (
                                                        <tr key={item.product_id} style={{ borderBottom: '1px solid #f0f0f0', background: idx % 2 === 0 ? 'white' : '#fafafa' }}>
                                                            <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 700, color: '#1a2d42', maxWidth: '240px' }}>{item.titulo}</td>
                                                            <td style={{ padding: '10px 12px', fontSize: '11px', color: '#888' }}>{item.editorial}</td>
                                                            <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '14px', fontWeight: 600 }}>{item.qty}</td>
                                                            <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontFamily: 'monospace', color: hasAnyDiscount ? '#bbb' : '#444', textDecoration: hasAnyDiscount ? 'line-through' : 'none' }}>Bs. {Number(item.unitPrice || 0).toFixed(2)}</td>
                                                            {showPFinal && (
                                                                <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', fontFamily: 'monospace', fontWeight: 700, color: '#e53e3e' }}>
                                                                    {hasAnyDiscount ? `${ePct}%` : '—'}
                                                                </td>
                                                            )}
                                                            {showPFinal && (
                                                                <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontFamily: 'monospace', fontWeight: 700, color: '#2d9e5a' }}>
                                                                    {hasAnyDiscount ? `Bs. ${finalUnit.toFixed(2)}` : '—'}
                                                                </td>
                                                            )}
                                                            <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', fontFamily: 'monospace', fontWeight: 800, color: '#f07d2a' }}>
                                                                Bs. {finalSubtotal.toFixed(2)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                        );})()}
                                    </div>

                                    {/* Totals */}
                                    <div style={{ padding: '16px 32px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <div style={{ minWidth: '260px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: '#666' }}>
                                                <span>Subtotal</span>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>Bs. {subtotal.toFixed(2)}</span>
                                            </div>
                                            {discountAmount > 0 && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: '#e53e3e' }}>
                                                    <span>Descuento{uniformPct > 0 ? ` (${uniformPct}%)` : ''}</span>
                                                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>-Bs. {discountAmount.toFixed(2)}</span>
                                                </div>
                                            )}
                                            {Number(costoEnvio) > 0 && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: '#666' }}>
                                                    <span>Envío</span>
                                                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>+Bs. {Number(costoEnvio).toFixed(2)}</span>
                                                </div>
                                            )}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #1a2d42', paddingTop: '10px', marginTop: '6px' }}>
                                                <span style={{ fontSize: '18px', fontWeight: 800, color: '#1a2d42' }}>TOTAL</span>
                                                <span style={{ fontSize: '22px', fontWeight: 900, color: '#f07d2a', fontFamily: 'monospace' }}>Bs. {total.toFixed(2)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Conditions */}
                                    <div style={{ padding: '16px 32px 8px', background: '#f9f9f9', borderTop: '2px solid #eee' }}>
                                        <div style={{ fontSize: '11px', color: '#f07d2a', textTransform: 'uppercase', letterSpacing: '0.25em', fontWeight: 800, marginBottom: '10px' }}>Condiciones</div>
                                        <div style={{ fontSize: '10px', color: '#555', fontWeight: 700, marginBottom: '10px' }}>Condiciones de la Cotización y Pedidos:</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                                            {customConditions.map((c, i) => (
                                                <div key={i} style={{ fontSize: '10px', color: '#555', lineHeight: 1.5 }}>
                                                    <span style={{ fontWeight: 800, color: '#333' }}>{c.title}: </span>{c.text}
                                                </div>
                                            ))}
                                        </div>
                                        {nota && (
                                            <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #e5e5e5', fontSize: '10px', color: '#777', fontStyle: 'italic' }}>
                                                <span style={{ fontWeight: 700, fontStyle: 'normal', color: '#555' }}>Nota: </span>{nota}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ padding: '10px 32px 16px', background: 'linear-gradient(135deg, #1a2d42, #0f1e2e)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.2em' }}>MANGAS COMICS BOLIVIA</div>
                                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>Generado el {today}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── BULK ADD MODAL ── */}
            {showBulkModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={e => e.target === e.currentTarget && setShowBulkModal(false)}>
                    <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                        {/* Modal Header */}
                        <div className="p-5 border-b border-border flex items-center justify-between shrink-0">
                            <div className="flex items-center gap-2">
                                <Layers size={18} className="text-primary" />
                                <h2 className="font-bold text-base">Agregar en lote</h2>
                            </div>
                            <button onClick={() => setShowBulkModal(false)} className="text-muted hover:text-text transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        {/* Search + Range */}
                        <div className="p-5 border-b border-border space-y-3 shrink-0">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                                    <input
                                        ref={bulkSearchRef}
                                        type="text"
                                        placeholder="Nombre de la colección, ej: Blue Lock"
                                        value={bulkSearch}
                                        onChange={e => setBulkSearch(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && searchBulkCatalog(bulkSearch)}
                                        className="input-field h-10 pl-9 text-sm w-full"
                                    />
                                </div>
                                <button
                                    onClick={() => searchBulkCatalog(bulkSearch)}
                                    disabled={bulkLoading}
                                    className="px-4 h-10 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-bold transition-all disabled:opacity-50 shrink-0"
                                >
                                    {bulkLoading ? <RefreshCw size={15} className="animate-spin" /> : 'Buscar'}
                                </button>
                            </div>
                            {bulkResults.length > 0 && (
                                <div className="flex gap-2 items-center">
                                    <Hash size={14} className="text-muted shrink-0" />
                                    <input
                                        type="text"
                                        placeholder="Tomos a seleccionar, ej: 2-15 o 1,2,5-10"
                                        value={bulkRange}
                                        onChange={e => setBulkRange(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && applyBulkRange()}
                                        className="input-field h-9 text-sm flex-1"
                                    />
                                    <button
                                        onClick={applyBulkRange}
                                        className="px-3 h-9 bg-surface border border-border hover:border-primary text-sm font-bold rounded-lg transition-all shrink-0"
                                    >
                                        Aplicar
                                    </button>
                                    <button
                                        onClick={() => setBulkSelected(new Set(bulkResults.map(p => p.product_id)))}
                                        className="px-3 h-9 text-xs text-muted hover:text-text transition-colors shrink-0"
                                    >
                                        Todos
                                    </button>
                                    <button
                                        onClick={() => setBulkSelected(new Set())}
                                        className="px-3 h-9 text-xs text-muted hover:text-text transition-colors shrink-0"
                                    >
                                        Ninguno
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Results List */}
                        <div className="flex-1 overflow-y-auto">
                            {bulkResults.length === 0 && !bulkLoading && (
                                <div className="flex flex-col items-center justify-center py-16 text-center text-muted">
                                    <Search size={36} className="opacity-20 mb-3" />
                                    <p className="text-sm font-mono">Buscá una colección para ver los tomos disponibles</p>
                                </div>
                            )}
                            {bulkResults.length > 0 && (
                                <div className="divide-y divide-border">
                                    {bulkResults.map(product => {
                                        const isSelected = bulkSelected.has(product.product_id);
                                        const alreadyInQuote = items.some(i => i.product_id === product.product_id);
                                        const price = getItemPrice(product, tipoPrecio);
                                        return (
                                            <div
                                                key={product.product_id}
                                                onClick={() => !alreadyInQuote && toggleBulkItem(product.product_id)}
                                                className={`flex items-center gap-3 px-5 py-3 transition-all cursor-pointer ${alreadyInQuote ? 'opacity-40 cursor-not-allowed' : isSelected ? 'bg-primary/10' : 'hover:bg-surface-2'}`}
                                            >
                                                <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-all ${isSelected ? 'bg-primary border-primary' : 'border-border'}`}>
                                                    {isSelected && <svg viewBox="0 0 12 10" fill="none" className="w-3 h-3"><path d="M1 5l3 3 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-text truncate">{product.titulo}</p>
                                                    <p className="text-xs text-muted">{product.editorial}</p>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <p className="text-sm font-bold font-mono text-primary">Bs. {price.toFixed(2)}</p>
                                                    {alreadyInQuote && <p className="text-xs text-green-500">✓ ya agregado</p>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        {bulkSelected.size > 0 && (
                            <div className="p-4 border-t border-border flex items-center justify-between shrink-0">
                                <p className="text-sm text-muted"><span className="font-bold text-text">{bulkSelected.size}</span> tomos seleccionados</p>
                                <button
                                    onClick={confirmBulkAdd}
                                    className="flex items-center gap-2 px-5 py-2 bg-primary hover:bg-primary/80 text-white rounded-lg text-sm font-bold transition-all"
                                >
                                    <Plus size={16} /> Agregar a cotización
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
