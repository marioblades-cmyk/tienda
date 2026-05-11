import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://lbraboujrajvzosmddtu.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs'
);

async function check() {
    const email = 'test_authenticated_1777647528098@gmail.com';
    const password = 'TestAuthenticated123!';
    await supabase.auth.signInWithPassword({ email, password });

    const mauricioId = '159c2549-e6b3-4326-8b09-7eb8b1a7e671';

    // Fetch ALL Excel uploads by Mauricio
    const { data: pFiles } = await supabase
        .from('pedidos')
        .select('created_at, archivo_nombre, tipo, semanas(*)')
        .eq('vendedor_id', mauricioId)
        .order('created_at', { ascending: true });

    console.log(`\n--- ALL EXCEL UPLOADS BY MAURICIO (CHRONOLOGICAL) ---`);
    for (const p of pFiles || []) {
        const weekStr = p.semanas ? p.semanas.nombre : 'No Week / Sin Semana';
        console.log(`  - ${p.created_at.substring(0, 10)} | File: ${p.archivo_nombre} | Week: ${weekStr} | Type: ${p.tipo}`);
    }
}

check();
