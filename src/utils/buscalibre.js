// Lógica compartida del Cotizador Buscalibre: traer la página, parsear el libro y calcular el precio en Bs.
// La usan tanto BuscalibreCotizador como el modo "Buscalibre" del Nuevo Pedido en ClientOrdersView.

// Trae el HTML (o imagen) vía nuestra función serverless; fallback a proxies públicos.
export const fetchHtml = async (u) => {
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

export const parseBook = (html, srcUrl) => {
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

// Fórmula: (precio ARS × tipo de cambio + 35) × 1.3, redondeado a entero.
export const precioBs = (precioArs, tc) => Math.round((Number(precioArs) * Number(tc) + 35) * 1.3);

// Cotiza un link: trae la página, parsea el libro y devuelve los datos + precio en Bs.
export const cotizarLink = async (url, tc) => {
    const html = await fetchHtml(url);
    const data = parseBook(html, url);
    if (!data.precioArs) throw new Error('No se pudo leer el precio de la página.');
    return { ...data, link: url, precioBs: precioBs(data.precioArs, tc), tc: Number(tc) };
};
