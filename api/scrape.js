// Función serverless (Vercel) que trae una página del lado del servidor para evitar CORS.
// Restringida SOLO a buscalibre.com por seguridad (no es un proxy abierto).
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Falta el parámetro url.' });
        return;
    }

    let host;
    try {
        host = new URL(url).hostname;
    } catch {
        res.status(400).json({ error: 'URL inválida.' });
        return;
    }

    // Solo se permite buscalibre (cualquier país: .com.ar, .com, etc.)
    if (!host.endsWith('buscalibre.com') && !host.includes('buscalibre.com.')) {
        res.status(403).json({ error: 'Solo se permiten links de buscalibre.' });
        return;
    }

    try {
        const r = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept-Language': 'es-AR,es;q=0.9',
            },
        });
        if (!r.ok) {
            res.status(502).json({ error: `La página respondió ${r.status}.` });
            return;
        }
        const html = await r.text();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(html);
    } catch (e) {
        res.status(500).json({ error: e?.message || 'Error al traer la página.' });
    }
}
