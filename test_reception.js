
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

async function check() {
    const semanaId = '2a61ddf3-c405-46d7-916a-ea99376bcca9';
    const { data: master } = await supabase.from('master_confirmaciones').select('*').eq('semana_id', semanaId).maybeSingle();
    if (!master) { console.log('NO MASTER'); return; }
    
    const items = master.datos_json || [];
    console.log('Items in master:', items.length);
    
    let ok = 0; let fail = 0; let multi = 0;
    for (const item of items) {
        const { data, error } = await supabase.from('catalogo_productos').select('id, titulo').ilike('titulo', item.titulo.trim()).maybeSingle();
        if (error && error.code === 'PGRST116') { multi++; }
        else if (!data && !error) { fail++; }
        else if (data) { ok++; }
    }
    console.log('OK:', ok, 'FAIL:', fail, 'MULTI:', multi);
}
check();

