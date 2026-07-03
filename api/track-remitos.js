// Rastreador de envíos FlechaCarga → aviso por Telegram cuando cambia el estado.
// Lo llama cron-job.org 4x/día (8, 12, 16, 19 Bolivia). Requiere ?key=CRON_SECRET.
// Sigue solo los remitos con fecha >= DESDE_FECHA que aún no estén "Entregado".
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const TELEGRAM_TOKEN = '8853375009:AAFB8TvpVxgwA5E3g11ifoJ5qGNR-5zVCSA';
const TELEGRAM_CHAT = '6025198555';
const FLECHA_TOKEN = 'DB1347515B35A29E391339D7F41AD05DB5E27CD0'; // token público del tracking de FlechaCarga
const CRON_SECRET = 'mcb-remitos-2026';   // debe coincidir con el ?key= que pongas en cron-job.org
const DESDE_FECHA = '2026-06-24';         // solo remitos de esta fecha en adelante (3737-10258)

async function telegram(text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'HTML' }),
        });
    } catch { /* si Telegram falla, no cortamos el resto */ }
}

// Consulta el estado de un remito en FlechaCarga. Devuelve el texto del estado (o null).
async function estadoFlecha(nro) {
    const numero = 'R-' + nro;
    const url = `https://rest.empresar-sys.com.ar:1433/convenios/estadoDelivery/template?numero=${encodeURIComponent(numero)}&token=${FLECHA_TOKEN}`;
    try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.flechacarga.com/' } });
        const j = await r.json();
        if (j?.estado === 1 && j?.template?.titulo) {
            // "Encomiendas - Buspack -En Agencia Destino" → último tramo = "En Agencia Destino"
            const partes = String(j.template.titulo).split('-').map(s => s.trim()).filter(Boolean);
            return partes[partes.length - 1] || j.template.titulo;
        }
    } catch { /* sin estado */ }
    return null;
}

export default async function handler(req, res) {
    if ((req.query.key || '') !== CRON_SECRET) { res.status(403).json({ error: 'forbidden' }); return; }
    if (!SUPABASE_URL || !SUPABASE_KEY) { res.status(500).json({ error: 'sin config supabase' }); return; }
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    try {
        // 1) Remitos desde la app
        const { data: st } = await supabase.from('app_state').select('data').eq('id', 'remitos').maybeSingle();
        const remitos = Array.isArray(st?.data) ? st.data : [];
        // 2) Seguimiento previo
        const { data: seg } = await supabase.from('remito_seguimiento').select('*');
        const segMap = {};
        (seg || []).forEach(s => { segMap[s.nro] = s; });

        // Activos: de la fecha en adelante y aún no entregados
        const activos = remitos.filter(r => r.nro && String(r.fecha || '') >= DESDE_FECHA && !segMap[r.nro]?.entregado);

        let cambios = 0, revisados = 0, avisados = 0;
        for (const r of activos) {
            const estado = await estadoFlecha(r.nro);
            revisados++;
            if (!estado) continue;
            const prev = segMap[r.nro]?.estado ?? null;
            const entregado = /entregad/i.test(estado);
            const primeraVez = !(r.nro in segMap);

            // Avisar solo cuando CAMBIA (no en el primer registro, para no floodear al arranque)
            if (!primeraVez && estado !== prev) {
                cambios++;
                const precio = r.precio_remito ? ` · $${Number(r.precio_remito).toLocaleString('es-AR')}` : '';
                await telegram(`📦 <b>${r.pedido || 'Pedido'}</b>\nRemito <b>R-${r.nro}</b>${precio}\n🔄 Estado: <b>${estado}</b>${entregado ? '\n🎉 ¡ENTREGADO!' : ''}`);
                avisados++;
            }

            await supabase.from('remito_seguimiento').upsert({
                nro: r.nro,
                pedido: r.pedido || null,
                precio_remito: r.precio_remito ? String(r.precio_remito) : null,
                estado,
                entregado,
                last_check: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'nro' });
        }

        res.status(200).json({ ok: true, activos: activos.length, revisados, cambios, avisados });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'error' });
    }
}
