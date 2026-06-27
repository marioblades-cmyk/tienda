import React, { useState, useRef } from 'react';
import html2canvas from 'html2canvas';
import { Link2, Loader2, Download, BookOpen, AlertCircle } from 'lucide-react';

// Cotizador Buscalibre: pega un link de buscalibre.com.ar, trae los datos del libro
// (vía proxy CORS), calcula el precio en Bs y genera una imagen para WhatsApp.
// Fórmula: ((precio_ARS × tipo_de_cambio) + 35) × 1.3, redondeado a entero.

export default function BuscalibreCotizador() {
    const [url, setUrl] = useState('');
    const [tc, setTc] = useState('');           // tipo de cambio (lo pone el usuario)
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [book, setBook] = useState(null);
    const cardRef = useRef(null);

    // Trae el HTML de la página. Primero usa nuestra función serverless (/api/scrape),
    // confiable y sin CORS. Si no está disponible (ej. dev local), prueba proxies públicos.
    const fetchHtml = async (u) => {
        // 1. Serverless propio (producción)
        try {
            const res = await fetch(`/api/scrape?url=${encodeURIComponent(u)}`);
            if (res.ok) {
                const txt = await res.text();
                if (txt && txt.length > 2000 && !txt.trimStart().startsWith('{')) return txt;
            }
        } catch { /* sin serverless: probar proxies */ }

        // 2. Fallback: proxies públicos
        const proxies = [
            (x) => `https://api.allorigins.win/raw?url=${encodeURIComponent(x)}`,
            (x) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(x)}`,
        ];
        for (const p of proxies) {
            try {
                const res = await fetch(p(u));
                if (res.ok) {
                    const txt = await res.text();
                    if (txt && txt.length > 2000) return txt;
                }
            } catch { /* probar siguiente */ }
        }
        throw new Error('No se pudo traer la página. Probá de nuevo en unos segundos.');
    };

    const parseBook = (html, srcUrl) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const meta = (prop) => doc.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') || '';

        // Título: del <h1> (más limpio) o del og:title
        let titulo = (doc.querySelector('h1')?.textContent || meta('og:title') || '').trim();
        titulo = titulo.replace(/\s*-\s*Buscalibre.*$/i, '').trim();

        const cover = meta('og:image') || '';

        // Detalles: filas con label (col-xs-5) y valor (col-xs-7)
        const fields = {};
        doc.querySelectorAll('.row').forEach((row) => {
            const l = row.querySelector('.col-xs-5');
            const v = row.querySelector('.col-xs-7');
            if (l && v) {
                const key = l.textContent.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
                const val = v.textContent.trim();
                if (key && val) fields[key] = val;
            }
        });
        const get = (...names) => {
            for (const k of Object.keys(fields)) {
                if (names.some((n) => k.includes(n))) return fields[k];
            }
            return '';
        };

        // Precio en ARS = el precio VISIBLE que se paga (el que está junto al botón "agregar al carro").
        // OJO: NO usar 'precio_producto' del dataLayer — es otra métrica y da un valor distinto (mal).
        let precioArs = 0;
        let pm = html.match(/<strong class="precio">\s*\$?\s*([\d.]+)\s*<\/strong>\s*<form[^>]*carro\/agregar/i);
        if (!pm) pm = html.match(/<strong class="precio">\s*\$?\s*([\d.]+)\s*<\/strong>/i);
        if (pm) precioArs = parseInt(pm[1].replace(/\./g, ''), 10) || 0; // los puntos son separador de miles
        if (!precioArs) {
            const h = html.match(/name="precio_producto"\s+value="?([\d.]+)"?/i);
            if (h) precioArs = Math.round(parseFloat(h[1])) || 0;
        }
        if (!precioArs) {
            const j = html.match(/"price":\s*"?([\d.]+)"?/);
            if (j) precioArs = Math.round(parseFloat(j[1])) || 0;
        }

        const isbnM = srcUrl.match(/(\d{13})/);
        const isbn = isbnM ? isbnM[1] : get('isbn');

        return {
            titulo,
            autor: get('autor'),
            editorial: get('editorial'),
            coleccion: get('coleccion', 'colecc'),
            anio: get('ano', 'año'),
            idioma: get('idioma'),
            paginas: get('paginas', 'pagina'),
            encuadernacion: get('encuaderna'),
            dimensiones: get('dimension'),
            formato: get('formato'),
            pais: get('editado en', 'pais'),
            isbn,
            cover,
            precioArs,
        };
    };

    const buscar = async () => {
        setError('');
        setBook(null);
        if (!url.includes('buscalibre')) { setError('Pegá un link de buscalibre.com.ar'); return; }
        if (!Number(tc) || Number(tc) <= 0) { setError('Poné el tipo de cambio (mayor a 0).'); return; }
        setLoading(true);
        try {
            const html = await fetchHtml(url.trim());
            const data = parseBook(html, url.trim());
            if (!data.precioArs) throw new Error('No se encontró el precio en la página.');
            // La portada también se trae por nuestra función serverless (mismo origen → sin CORS, exportable)
            data.coverData = data.cover ? `/api/scrape?url=${encodeURIComponent(data.cover)}` : '';
            setBook(data);
        } catch (e) {
            setError(e.message || 'Error al procesar el link.');
        } finally {
            setLoading(false);
        }
    };

    // Precio final en Bs = ((ARS × TC) + 35) × 1.3, redondeado a entero
    const precioBs = book ? Math.round(((book.precioArs * Number(tc)) + 35) * 1.3) : 0;

    const descargarImagen = async () => {
        if (!cardRef.current) return;
        try {
            const canvas = await html2canvas(cardRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/jpeg', 0.95);
            link.download = `${(book.titulo || 'libro').slice(0, 40).replace(/[^a-z0-9]/gi, '_')}.jpg`;
            link.click();
        } catch (e) {
            alert('No se pudo generar la imagen: ' + e.message);
        }
    };

    const Detalle = ({ label, value }) => value ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ color: '#888', fontWeight: 700 }}>{label}</span>
            <span style={{ color: '#1a2d42', fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
        </div>
    ) : null;

    return (
        <div className="space-y-5 max-w-3xl mx-auto">
            <div className="flex items-center gap-2">
                <Link2 className="text-orange-500" />
                <h3 className="text-xl font-bold text-navy">Cotizador Buscalibre</h3>
            </div>

            {/* Controles */}
            <div className="bg-white border border-border/40 rounded-2xl p-4 space-y-3">
                <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Pegá el link del libro (buscalibre.com.ar/...)"
                    className="w-full border border-border/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400"
                />
                <div className="flex gap-2">
                    <div className="flex items-center gap-2 border border-border/40 rounded-xl px-3 py-2">
                        <span className="text-[11px] font-black text-slate-400 uppercase">Tipo de cambio</span>
                        <input
                            type="number"
                            value={tc}
                            onChange={(e) => setTc(e.target.value)}
                            placeholder="ej. 0.012"
                            className="w-24 outline-none text-sm font-mono"
                        />
                    </div>
                    <button
                        onClick={buscar}
                        disabled={loading}
                        className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-black px-5 py-2 rounded-xl transition-all"
                    >
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />} Cotizar
                    </button>
                </div>
                <p className="text-[11px] text-slate-400">
                    Fórmula: (precio ARS × tipo de cambio + 35) × 1.3, redondeado. Usa el precio con descuento de buscalibre.
                </p>
                {error && (
                    <div className="flex items-center gap-2 text-red-500 text-xs font-bold"><AlertCircle size={14} /> {error}</div>
                )}
            </div>

            {/* Resultado + imagen */}
            {book && (
                <div className="space-y-4">
                    <div className="flex justify-end">
                        <button onClick={descargarImagen} className="flex items-center gap-1.5 bg-navy hover:bg-navy/90 text-white text-xs font-black px-4 py-2 rounded-xl transition-all">
                            <Download size={14} /> Descargar imagen WhatsApp
                        </button>
                    </div>

                    {/* Tarjeta que se exporta como imagen */}
                    <div ref={cardRef} style={{ width: 480, margin: '0 auto', background: '#ffffff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,.12)', fontFamily: 'system-ui, sans-serif' }}>
                        <div style={{ background: 'linear-gradient(135deg,#1a2d42,#26415e)', color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 900, letterSpacing: 1, fontSize: 15 }}>MANGAS COMICS BOLIVIA</span>
                            <span style={{ fontSize: 11, opacity: .8 }}>📚 Pedido a Pedido</span>
                        </div>
                        <div style={{ display: 'flex', gap: 16, padding: 18 }}>
                            {book.coverData && (
                                <img src={book.coverData} alt="" crossOrigin="anonymous" onError={(e) => { if (book.cover && e.currentTarget.src !== book.cover) e.currentTarget.src = book.cover; }} style={{ width: 150, height: 220, objectFit: 'contain', borderRadius: 10, background: '#f3f4f6', flexShrink: 0 }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 17, fontWeight: 900, color: '#1a2d42', lineHeight: 1.2, marginBottom: 4 }}>{book.titulo}</div>
                                {book.autor && <div style={{ fontSize: 13, color: '#e8852b', fontWeight: 800, marginBottom: 8 }}>{book.autor}</div>}
                                <Detalle label="Editorial" value={book.editorial} />
                                <Detalle label="Colección" value={book.coleccion} />
                                <Detalle label="Año" value={book.anio} />
                                <Detalle label="Páginas" value={book.paginas} />
                                <Detalle label="Encuadernación" value={book.encuadernacion} />
                                <Detalle label="Idioma" value={book.idioma} />
                                <Detalle label="ISBN" value={book.isbn} />
                            </div>
                        </div>
                        <div style={{ background: '#fff7ed', borderTop: '2px dashed #f59e0b', padding: '16px 18px', textAlign: 'center' }}>
                            <div style={{ fontSize: 12, color: '#92400e', fontWeight: 800, letterSpacing: 1 }}>PRECIO</div>
                            <div style={{ fontSize: 34, fontWeight: 900, color: '#1a2d42', lineHeight: 1 }}>Bs {precioBs.toLocaleString('es-BO')}</div>
                        </div>
                    </div>

                    {/* Desglose del cálculo (solo en pantalla, no en la imagen) */}
                    <div className="bg-white border border-border/40 rounded-2xl p-4 text-xs text-slate-500 max-w-md mx-auto">
                        <div className="flex justify-between"><span>Precio buscalibre (ARS)</span><span className="font-mono font-bold text-navy">{book.precioArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span></div>
                        <div className="flex justify-between"><span>× Tipo de cambio ({tc})</span><span className="font-mono">{(book.precioArs * Number(tc)).toFixed(2)} Bs</span></div>
                        <div className="flex justify-between"><span>+ Flete</span><span className="font-mono">35 Bs</span></div>
                        <div className="flex justify-between"><span>× Margen 1.3</span><span className="font-mono"></span></div>
                        <div className="flex justify-between border-t mt-1 pt-1 font-black text-navy"><span>= Precio final (redondeado)</span><span className="font-mono">Bs {precioBs}</span></div>
                    </div>
                </div>
            )}
        </div>
    );
}
