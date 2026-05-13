
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
        const monday = "2026-05-11T00:00:00Z";
        const tuesday = "2026-05-12T00:00:00Z";
        console.log(`--- ANALIZANDO ACTIVIDAD DE LUNES (MAYO 11) ---`);
        
        const pagos = await query(`cliente_pagos?created_at=gte.${monday}&created_at=lt.${tuesday}&vendedor_id=eq.159c2549-e6b3-4326-8b09-7eb8b1a7e671&select=*,clientes(nombre)`);
        console.log(`\nPagos registrados por Mauricio el lunes: ${pagos.length}`);
        
        const caja = await query(`caja_movimientos?created_at=gte.${monday}&created_at=lt.${tuesday}&vendedor_id=eq.159c2549-e6b3-4326-8b09-7eb8b1a7e671`);
        console.log(`\nMovimientos de caja de Mauricio el lunes: ${caja.length}`);
        caja.forEach(m => {
            console.log(`  [${m.created_at}] ${m.tipo}: BS ${m.monto} - ${m.concepto} - ${m.metodo_pago}`);
        });

        // Ver si hay pagos de hoy con método Yasta que NO tienen caja
        const sinCaja = pagos.filter(p => !p.caja_mov_id && p.metodo_pago === 'Yasta (QR)');
        console.log(`\nPagos YASTA sin caja (LUNES): ${sinCaja.length}`);
        let totalSinCaja = 0;
        sinCaja.forEach(p => {
            console.log(`  [${p.created_at}] BS ${p.monto} - ${p.clientes?.nombre} - ${p.concepto}`);
            totalSinCaja += Number(p.monto);
        });
        console.log(`TOTAL YASTA "GHOST": BS ${totalSinCaja}`);

    } catch (error) {
        console.error(error);
    }
}

main();
