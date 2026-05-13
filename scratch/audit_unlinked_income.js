
const url = "https://lbraboujrajvzosmddtu.supabase.co/rest/v1/";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs";

async function query(path) {
    const response = await fetch(url + path, {
        headers: {
            "apikey": key,
            "Authorization": "Bearer " + key
        }
    });
    return await response.json();
}

async function main() {
    try {
        const since = "2026-05-09T00:00:00Z";
        console.log(`--- INGRESOS EN CAJA SIN PAGO VINCULADO (Desde Sábado) ---`);
        
        const caja = await query(`caja_movimientos?tipo=eq.INGRESO&created_at=gte.${since}`);
        const pagos = await query(`cliente_pagos?created_at=gte.${since}`);
        const linkedIds = new Set(pagos.map(p => p.caja_mov_id).filter(id => id));

        caja.forEach(m => {
            if (!linkedIds.has(m.id) && m.categoria !== 'Venta Directa' && !m.concepto.includes("Transferencia")) {
                console.log(`  [${m.created_at}] BS ${m.monto} - ${m.concepto} (Vendedor ID: ${m.vendedor_id})`);
            }
        });

    } catch (error) {
        console.error(error);
    }
}

main();
