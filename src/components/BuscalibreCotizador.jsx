import React, { useState, useEffect } from 'react';
import html2canvas from 'html2canvas';
import { Link2, Loader2, Download, BookOpen, AlertCircle, Trash2, Clock } from 'lucide-react';

// Cotizador Buscalibre: pegás uno o varios links de buscalibre.com.ar, trae los datos
// (vía /api/scrape), calcula el precio en Bs y genera imágenes para WhatsApp.
// Fórmula: ((precio_ARS × tipo_de_cambio) + 35) × 1.3, redondeado a entero.
// Guarda un historial de lo cotizado en el navegador (localStorage).

const HISTORY_KEY = 'mcb_buscalibre_historial';

export default function BuscalibreCotizador() {
    const [links, setLinks] = useState('');
    const [tc, setTc] = useState('');
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState('');
    const [books, setBooks] = useState([]);
    const [history, setHistory] = useState([]);

    useEffect(() => {
        try { setHistory(JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')); } catch { /* noop */ }
    }, []);

    const saveHistory = (items) => {
        const trimmed = items.slice(0, 100);
        setHistory(trimmed);
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed)); } catch { /* noop */ }
    };

    // Trae el HTML (o imagen) vía nuestra función serverless; fallback a proxies públicos.
    const fetchHtml = async (u) => {
        try {
            const res = await fetch(`/api/scrape?url=${encodeURIComponent(u)}`);
            if (res.ok) {
                const txt = await res.text();
                if (txt && txt.length > 2000 && !txt.trimStart().startsWith('{')) return txt;
            }
        } catch { /* probar proxies */ }
        const proxies = [
            (x) => `https://api.allorigins.win/raw?url=${encodeURIComponent(x)}`,
            (x) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(x)}`,
        ];
        for (const p of proxies) {
            try {
                const res = await fetch(p(u));
                if (res.ok) { const txt = await res.text(); if (txt && txt.length > 2000) return txt; }
            } catch { /* siguiente */ }
        }
        throw new Error('No se pudo traer la página.');
    };

    const parseBook = (html, srcUrl) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const meta = (prop) => doc.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') || '';

        let titulo = (doc.querySelector('h1')?.textContent || meta('og:title') || '').trim();
        titulo = titulo.replace(/\s*-\s*Buscalibre.*$/i, '').trim();
        const cover = meta('og:image') || '';

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
            for (const k of Object.keys(fields)) if (names.some((n) => k.includes(n))) return fields[k];
            return '';
        };

        // Precio ARS = el precio VISIBLE que se paga (junto al botón "agregar al carro").
        let precioArs = 0;
        let pm = html.match(/<strong class="precio">\s*\$?\s*([\d.]+)\s*<\/strong>\s*<form[^>]*carro\/agregar/i);
        if (!pm) pm = html.match(/<strong class="precio">\s*\$?\s*([\d.]+)\s*<\/strong>/i);
        if (pm) precioArs = parseInt(pm[1].replace(/\./g, ''), 10) || 0;
        if (!precioArs) {
            const h = html.match(/name="precio_producto"\s+value="?([\d.]+)"?/i);
            if (h) precioArs = Math.round(parseFloat(h[1])) || 0;
        }
        if (!precioArs) {
            const j = html.match(/"price":\s*"?([\d.]+)"?/);
            if (j) precioArs = Math.round(parseFloat(j[1])) || 0;
        }

        const isbnM = srcUrl.match(/(\d{13})/);
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
            isbn: isbnM ? isbnM[1] : get('isbn'),
            cover,
            precioArs,
        };
    };

    const precioBsDe = (precioArs) => Math.round((precioArs * Number(tc) + 35) * 1.3);

    const cotizar = async () => {
        setError('');
        const urls = links.split('\n').map((s) => s.trim()).filter((s) => s.includes('buscalibre'));
        if (!urls.length) { setError('Pegá al menos un link de buscalibre (uno por línea).'); return; }
        if (!Number(tc) || Number(tc) <= 0) { setError('Poné el tipo de cambio (mayor a 0).'); return; }
        setLoading(true);
        setBooks([]);
        const results = [];
        const nuevos = [];
        for (let i = 0; i < urls.length; i++) {
            setProgress(`Procesando ${i + 1} de ${urls.length}…`);
            try {
                const html = await fetchHtml(urls[i]);
                const data = parseBook(html, urls[i]);
                if (!data.precioArs) throw new Error('Sin precio');
                data.coverData = data.cover ? `/api/scrape?url=${encodeURIComponent(data.cover)}` : '';
                data.link = urls[i];
                results.push(data);
                nuevos.push({
                    fecha: new Date().toISOString(), titulo: data.titulo, autor: data.autor,
                    isbn: data.isbn, precioArs: data.precioArs, precioBs: precioBsDe(data.precioArs),
                    tc: Number(tc), link: urls[i],
                });
            } catch {
                results.push({ error: true, titulo: urls[i], link: urls[i] });
            }
        }
        setBooks(results);
        if (nuevos.length) saveHistory([...nuevos, ...history]);
        setProgress('');
        setLoading(false);
    };

    const descargarUno = async (i) => {
        const node = document.getElementById(`bl-card-${i}`);
        if (!node) return;
        const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.download = `${(books[i]?.titulo || 'libro').slice(0, 40).replace(/[^a-z0-9]/gi, '_')}.jpg`;
        link.click();
    };

    const descargarTodas = async () => {
        for (let i = 0; i < books.length; i++) {
            if (books[i]?.error) continue;
            await descargarUno(i);
            await new Promise((r) => setTimeout(r, 700));
        }
    };

    const Detalle = ({ label, value }) => value ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '3px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ color: '#888', fontWeight: 700 }}>{label}</span>
            <span style={{ color: '#1a2d42', fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
        </div>
    ) : null;

    const Tarjeta = ({ book, idx }) => {
        const precioBs = precioBsDe(book.precioArs);
        return (
            <div id={`bl-card-${idx}`} style={{ width: 480, background: '#ffffff', borderRadius: 18, overflow: 'hidden', boxShadow: '0 10px 30px rgba(0,0,0,.12)', fontFamily: 'system-ui, sans-serif' }}>
                <div style={{ background: 'linear-gradient(135deg,#1a2d42,#26415e)', color: '#fff', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <img src="/logo.png" alt="logo" crossOrigin="anonymous" style={{ height: 38, objectFit: 'contain' }} />
                    <span style={{ fontSize: 12, opacity: .9, fontWeight: 700 }}>📚 Libros · Comics · Mangas a pedido</span>
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
        );
    };

    return (
        <div className="space-y-5 max-w-3xl mx-auto">
            <div className="flex items-center gap-2">
                <Link2 className="text-orange-500" />
                <h3 className="text-xl font-bold text-navy">Cotizador Buscalibre</h3>
            </div>

            {/* Controles */}
            <div className="bg-white border border-border/40 rounded-2xl p-4 space-y-3">
                <textarea
                    value={links}
                    onChange={(e) => setLinks(e.target.value)}
                    rows={4}
                    placeholder={'Pegá uno o varios links (uno por línea):\nhttps://www.buscalibre.com.ar/...\nhttps://www.buscalibre.com.ar/...'}
                    className="w-full border border-border/40 rounded-xl px-3 py-2 text-sm outline-none focus:border-orange-400 font-mono"
                />
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex items-center gap-2 border border-border/40 rounded-xl px-3 py-2">
                        <span className="text-[11px] font-black text-slate-400 uppercase">Tipo de cambio</span>
                        <input type="number" value={tc} onChange={(e) => setTc(e.target.value)} placeholder="ej. 0.0066" className="w-24 outline-none text-sm font-mono" />
                    </div>
                    <button onClick={cotizar} disabled={loading} className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-black px-5 py-2 rounded-xl transition-all">
                        {loading ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />} Cotizar
                    </button>
                    {books.some((b) => !b.error) && (
                        <button onClick={descargarTodas} className="flex items-center gap-1.5 bg-navy hover:bg-navy/90 text-white text-xs font-black px-4 py-2 rounded-xl transition-all">
                            <Download size={14} /> Descargar todas
                        </button>
                    )}
                </div>
                <p className="text-[11px] text-slate-400">Fórmula: (precio ARS × tipo de cambio + 35) × 1.3, redondeado. Usa el precio visible de buscalibre.</p>
                {progress && <div className="text-[11px] text-orange-500 font-bold">{progress}</div>}
                {error && <div className="flex items-center gap-2 text-red-500 text-xs font-bold"><AlertCircle size={14} /> {error}</div>}
            </div>

            {/* Tarjetas */}
            {books.length > 0 && (
                <div className="space-y-5 flex flex-col items-center">
                    {books.map((book, idx) => book.error ? (
                        <div key={idx} className="w-full max-w-[480px] bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-500">
                            ⚠️ No se pudo cotizar: <span className="break-all">{book.link}</span>
                        </div>
                    ) : (
                        <div key={idx} className="flex flex-col items-center gap-2">
                            <Tarjeta book={book} idx={idx} />
                            <div className="flex items-center gap-3 text-[11px] text-slate-400">
                                <span>ARS {book.precioArs.toLocaleString('es-AR', { maximumFractionDigits: 0 })} → <b className="text-navy">Bs {precioBsDe(book.precioArs)}</b></span>
                                <button onClick={() => descargarUno(idx)} className="flex items-center gap-1 text-navy font-bold hover:text-orange-500"><Download size={12} /> Descargar</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Historial */}
            {history.length > 0 && (
                <div className="bg-white border border-border/40 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="flex items-center gap-1.5 text-[11px] font-black text-slate-500 uppercase tracking-widest"><Clock size={13} /> Historial ({history.length})</span>
                        <button onClick={() => { if (confirm('¿Borrar todo el historial?')) saveHistory([]); }} className="flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-600"><Trash2 size={11} /> Borrar</button>
                    </div>
                    <div className="divide-y divide-border/20 max-h-72 overflow-y-auto">
                        {history.map((h, i) => (
                            <div key={i} className="flex items-center justify-between py-2 text-xs">
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-navy truncate">{h.titulo}</div>
                                    <div className="text-slate-400">{new Date(h.fecha).toLocaleString('es-BO')} · ARS {Number(h.precioArs).toLocaleString('es-AR', { maximumFractionDigits: 0 })}</div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-black text-navy font-mono">Bs {h.precioBs}</span>
                                    <button onClick={() => { setLinks(h.link); setTc(String(h.tc)); }} title="Volver a cargar este link" className="text-orange-500 hover:text-orange-600 font-bold text-[10px]">↻</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
