import { useState, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import { supabase } from '../services/supabase';
import { useAuth } from '../hooks/useAuth';
import {
    FileImage, Send, Save, Trash2, Plus, X, ShoppingCart,
    MessageCircle, ChevronDown, RefreshCw, Package, CheckCircle2,
    Clock, XCircle, Archive, Eye, Link
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

function getItemPrice(item, priceType) {
    const field = PRICE_FIELD[priceType];
    return Number(item[field] || item.precio_tapa || 0);
}

export default function QuotationTool() {
    const { user, profile } = useAuth();
    const cardRef = useRef(null);

    // Form state
    const [clienteNombre, setClienteNombre] = useState('');
    const [clienteCelular, setClienteCelular] = useState('');
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

    // Calculated totals
    const subtotal = items.reduce((sum, item) => sum + (item.unitPrice || 0) * (item.qty || 1), 0);
    const discountAmount = subtotal * (descuentoPct / 100);
    const total = subtotal - discountAmount + Number(costoEnvio || 0);

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

    const clearAll = () => {
        setItems([]);
        setClienteNombre('');
        setClienteCelular('');
        setNota('');
        setDescuentoPct(0);
        setCostoEnvio(0);
        setCurrentId(null);
        setCurrentEstado('borrador');
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
                                <label className="text-xs font-bold text-muted uppercase tracking-wider block mb-1.5">Nota / Condiciones</label>
                                <textarea
                                    placeholder="Ej.: Válida por 7 días. Precio sujeto a disponibilidad..."
                                    value={nota}
                                    onChange={e => setNota(e.target.value)}
                                    rows={3}
                                    className="input-field text-sm w-full resize-none"
                                />
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
                                {descuentoPct > 0 && (
                                    <div className="flex justify-between font-mono text-red-400">
                                        <span>Descuento ({descuentoPct}%)</span>
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
                            <div className="p-4 bg-surface-2 border-b border-border flex items-center justify-between">
                                <h3 className="font-bold text-sm uppercase tracking-wider text-muted flex items-center gap-2">
                                    <ShoppingCart size={16} className="text-primary" />
                                    Productos ({items.length})
                                </h3>
                                {items.length === 0 && (
                                    <span className="text-xs text-muted italic">Seleccioná productos desde el Catálogo Maestro o la Herramienta Editorial</span>
                                )}
                            </div>

                            {items.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-center">
                                    <ShoppingCart size={48} className="text-muted opacity-20 mb-4" />
                                    <p className="text-muted text-sm font-mono">Carrito vacío</p>
                                    <p className="text-muted/60 text-xs mt-2">Andá al Catálogo Maestro, seleccioná ítems<br />y apretá "Agregar a Cotización"</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="text-xs font-bold uppercase tracking-wider text-muted bg-surface-2">
                                            <tr>
                                                <th className="text-left p-3">Título</th>
                                                <th className="text-center p-3 w-20">Cant.</th>
                                                <th className="text-right p-3 w-32">P. Unitario</th>
                                                <th className="text-right p-3 w-32">Subtotal</th>
                                                <th className="p-3 w-10"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                            {items.map(item => (
                                                <tr key={item.product_id} className="hover:bg-surface-2/50 transition-colors">
                                                    <td className="p-3">
                                                        <p className="font-semibold text-text leading-tight">{item.titulo}</p>
                                                        <p className="text-xs text-muted mt-0.5">{item.editorial}</p>
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
                                                    </td>
                                                    <td className="p-3 text-right font-bold font-mono text-primary">
                                                        Bs. {((item.unitPrice || 0) * (item.qty || 1)).toFixed(2)}
                                                    </td>
                                                    <td className="p-3">
                                                        <button
                                                            onClick={() => removeItem(item.product_id)}
                                                            className="text-muted hover:text-red-400 transition-colors"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
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
                                    <div style={{ background: 'linear-gradient(135deg, #1a2d42 0%, #0f1e2e 100%)', padding: '28px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <img src="/logo.png" alt="Logo" style={{ height: '60px', objectFit: 'contain', filter: 'brightness(0) invert(1)', mixBlendMode: 'normal' }} />
                                            <div>
                                                <div style={{ color: 'white', fontSize: '22px', fontWeight: 800, letterSpacing: '0.05em' }}>
                                                    MANGAS <span style={{ color: '#f07d2a' }}>COMICS</span>
                                                </div>
                                                <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '11px', letterSpacing: '0.3em', fontWeight: 600 }}>BOLIVIA STORE</div>
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'right' }}>
                                            <div style={{ color: '#f07d2a', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Cotización</div>
                                            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '11px', marginTop: '4px' }}>{today}</div>
                                            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px' }}>{profile?.nombre || 'Agente de Ventas'}</div>
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
                                        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
                                            <thead>
                                                <tr style={{ background: '#f5f5f5' }}>
                                                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, borderRadius: '4px 0 0 4px' }}>Título</th>
                                                    <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>Editorial</th>
                                                    <th style={{ textAlign: 'center', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>Cant.</th>
                                                    <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700 }}>P/U</th>
                                                    <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: '10px', color: '#999', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: 700, borderRadius: '0 4px 4px 0' }}>Subtotal</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {items.map((item, idx) => (
                                                    <tr key={item.product_id} style={{ borderBottom: '1px solid #f0f0f0', background: idx % 2 === 0 ? 'white' : '#fafafa' }}>
                                                        <td style={{ padding: '10px 12px', fontSize: '13px', fontWeight: 700, color: '#1a2d42', maxWidth: '260px' }}>{item.titulo}</td>
                                                        <td style={{ padding: '10px 12px', fontSize: '11px', color: '#888' }}>{item.editorial}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '14px', fontWeight: 600 }}>{item.qty}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '13px', fontFamily: 'monospace', color: '#444' }}>Bs. {Number(item.unitPrice || 0).toFixed(2)}</td>
                                                        <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '14px', fontFamily: 'monospace', fontWeight: 800, color: '#f07d2a' }}>Bs. {((item.unitPrice || 0) * (item.qty || 1)).toFixed(2)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Totals */}
                                    <div style={{ padding: '16px 32px', display: 'flex', justifyContent: 'flex-end' }}>
                                        <div style={{ minWidth: '260px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: '#666' }}>
                                                <span>Subtotal</span>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>Bs. {subtotal.toFixed(2)}</span>
                                            </div>
                                            {descuentoPct > 0 && (
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '13px', color: '#e53e3e' }}>
                                                    <span>Descuento ({descuentoPct}%)</span>
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

                                    {/* Footer */}
                                    {nota && (
                                        <div style={{ padding: '12px 32px', background: '#f9f9f9', borderTop: '1px solid #eee' }}>
                                            <div style={{ fontSize: '10px', color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700, marginBottom: '4px' }}>Nota</div>
                                            <div style={{ fontSize: '12px', color: '#555', fontStyle: 'italic' }}>{nota}</div>
                                        </div>
                                    )}
                                    <div style={{ padding: '12px 32px 20px', background: 'linear-gradient(135deg, #1a2d42, #0f1e2e)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '10px', fontWeight: 600, letterSpacing: '0.2em' }}>MANGAS COMICS BOLIVIA</div>
                                        <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>Generado el {today}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
