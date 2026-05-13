
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
        console.log(`--- BUSCANDO PAGOS NUEVOS (NO DISTRIBUCIONES) SIN CAJA ---`);
        
        const pagos = await query(`cliente_pagos?created_at=gte.${monday}&created_at=lt.${tuesday}&vendedor_id=eq.159c2549-e6b3-4326-8b09-7eb8b1a7e671&caja_mov_id=is.null&select=*,clientes(nombre)`);
        
        const nuevos = pagos.filter(p => !p.concepto.includes("Asignado a:") && !p.concepto.includes("Saldo recuperado"));
        
        if (nuevos.length > 0) {
            console.log(`\n🔴 ENCONTRADOS ${nuevos.length} PAGOS NUEVOS SIN CAJA:`);
            nuevos.forEach(p => {
                console.log(`  [${p.created_at}] BS ${p.monto} - ${p.clientes?.nombre} - ${p.concepto}`);
            });
        } else {
            console.log(`\n✅ No hay pagos nuevos sin caja (todos los nulos son distribuciones).`);
        }

    } catch (error) {
        console.error(error);
    }
}

main();
