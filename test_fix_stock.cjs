
const fs = require('fs');
const envStr = fs.readFileSync('.env', 'utf8');
const env = {};
envStr.split('\n').filter(Boolean).forEach(line => {
    if(line.includes('=')) {
        const parts = line.split('=');
        env[parts[0]] = parts.slice(1).join('=').trim();
    }
});
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function checkStock() {
    const semanaId = '2a61ddf3-c405-46d7-916a-ea99376bcca9';
    // 1. Get week info
    const { data: master } = await supabase.from('master_confirmaciones').select('*').eq('semana_id', semanaId).maybeSingle();
    const items = master.datos_json || [];
    
    console.log('--- Checking Overstock for Semana 15 ---');
    for (const item of items.slice(0, 10)) {
        const qtyRec = item.cantidad;
        const key = item.titulo.toLowerCase().trim();
        
        // Find how many went to clients
        const { data: clients } = await supabase.from('cliente_items').select('id, estado').ilike('titulo', \%\%\).eq('semana_id', semanaId);
        // Note: For real calculation we need to mimic the exact code:
        const preAllocatedIds = (clients || []).filter(c => c.estado === 'EN TIENDA' || c.estado === 'ADJUDICADO');
        
        const forStore = Math.max(0, qtyRec - preAllocatedIds.length);
        
        if (forStore > 0) {
            const { data: prods } = await supabase.from('catalogo_productos').select('titulo, stock_fisico').ilike('titulo', \%\%\);
            const p = prods && prods.length > 0 ? (prods.find(x => (x.titulo||'').trim().toLowerCase() === item.titulo.trim().toLowerCase()) || prods[0]) : null;
            if (p) {
                console.log(\[\] -> Should have added: \ | Current DB Stock: \\);
            }
        }
    }
}
checkStock();

