
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
    const { data: mc } = await supabase.from('master_confirmaciones').select('semana_id, semana:semanas(nombre)');
    console.log(mc.map(m => m.semana ? m.semana.nombre : m.semana_id));
}
check();

