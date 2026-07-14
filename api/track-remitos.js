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
const VENTANA = 12;                       // mira solo los N remitos más recientes (para no revisar el historial viejo).
                                          // De esos, sigue los que NO estén "Entregado"; al entregarse, deja de seguirlos.

async function telegram(text) {
    try {
        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ chat_id: TELEGRAM_CHAT, text, parse_mode: 'HTML' }),
        });
    } catch { /* si Telegram falla, no cortamos el resto */ }
}

// Consulta el estado de un envío en FlechaCarga. Devuelve el texto del estado (o null).
// Soporta 2 formatos:
//   • Códigos nuevos "FLC..." → API de guías (NroGuia), estado en resultado.bultosEstadoTracking[].operacion
//   • Códigos viejos "R-..."  → API empresar-sys (numero=R-), estado en template.titulo
async function estadoFlecha(nro) {
    const codigo = String(nro || '').trim();
    const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.flechacarga.com/' };

    // ── Formato nuevo: código de guía "FLC..." ──
    if (/^FLC/i.test(codigo)) {
        const url = `https://api.flechacarga.com/FlcInterface/api/Guia/ObtenerSegunGuia?NroGuia=${encodeURIComponent(codigo)}&Token=${FLECHA_TOKEN}`;
        try {
            const r = await fetch(url, { headers });
            const j = await r.json();
            const eventos = j?.resultado?.bultosEstadoTracking;
            if (Array.isArray(eventos) && eventos.length) {
                // El evento más reciente (por fecha) marca el estado actual
                const ultimo = eventos.reduce((a, b) => (new Date(b.fecha) > new Date(a.fecha) ? b : a));
                return ultimo.operacion || null;
            }
        } catch { /* sin estado */ }
        return null;
    }

    // ── Formato viejo: remito "R-..." (compatibilidad) ──
    const numero = 'R-' + codigo;
    const url = `https://rest.empresar-sys.com.ar:1433/convenios/estadoDelivery/template?numero=${encodeURIComponent(numero)}&token=${FLECHA_TOKEN}`;
    try {
        const r = await fetch(url, { headers });
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

        // Activos: los VENTANA remitos más recientes que aún NO estén entregados
        const recientes = remitos
            .filter(r => r.nro)
            .sort((a, b) => {
                const fa = String(a.fecha || ''), fb = String(b.fecha || '');
                if (fa !== fb) return fb.localeCompare(fa);      // fecha desc (más nuevo primero)
                return (Number(b.id) || 0) - (Number(a.id) || 0); // desempate por id desc
            })
            .slice(0, VENTANA);
        const activos = recientes.filter(r => !segMap[r.nro]?.entregado);

        let cambios = 0, revisados = 0, avisados = 0, guardados = 0, dbError = null;
        const estados = [];
        for (const r of activos) {
            const estado = await estadoFlecha(r.nro);
            revisados++;
            if (!estado) { estados.push({ nro: r.nro, estado: 'sin datos', pedido: r.pedido || null, precio: r.precio_remito || null }); continue; }
            estados.push({ nro: r.nro, estado, pedido: r.pedido || null, precio: r.precio_remito || null });
            const prev = segMap[r.nro]?.estado ?? null;
            const entregado = /entregad/i.test(estado);
            const primeraVez = !(r.nro in segMap);
            const label = /^FLC/i.test(String(r.nro || '')) ? r.nro : 'R-' + r.nro;
            const precio = r.precio_remito ? ` · $${Number(r.precio_remito).toLocaleString('es-AR')}` : '';

            if (primeraVez) {
                // Primera vez que se detecta este envío → avisar su estado inicial (una sola vez)
                await telegram(`🆕 <b>${r.pedido || 'Pedido'}</b>\nGuía <b>${label}</b>${precio}\n📍 Estado inicial: <b>${estado}</b>${entregado ? '\n🎉 ¡ENTREGADO!' : ''}`);
                avisados++;
            } else if (estado !== prev) {
                // Cambio de estado → avisar
                cambios++;
                await telegram(`📦 <b>${r.pedido || 'Pedido'}</b>\nGuía <b>${label}</b>${precio}\n🔄 Estado: <b>${estado}</b>${entregado ? '\n🎉 ¡ENTREGADO!' : ''}`);
                avisados++;
            }

            const { error: upErr } = await supabase.from('remito_seguimiento').upsert({
                nro: r.nro,
                pedido: r.pedido || null,
                precio_remito: r.precio_remito ? String(r.precio_remito) : null,
                estado,
                entregado,
                last_check: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            }, { onConflict: 'nro' });
            if (upErr) dbError = upErr.message; else guardados++;
        }

        res.status(200).json({ ok: true, activos: activos.length, revisados, cambios, avisados, guardados, dbError, estados });
    } catch (e) {
        res.status(500).json({ error: e?.message || 'error' });
    }
}
