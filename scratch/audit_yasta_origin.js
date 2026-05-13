
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
        const mauricioId = "159c2549-e6b3-4326-8b09-7eb8b1a7e671";
        const sinceDate = "2026-05-09T00:00:00Z";

        console.log(`--- BUSCANDO PAGOS ORIGEN (NO DISTRIBUIDOS) DE YASTA ---`);
        // Pagos que NO empiezan con "Asignado a:" o "Saldo recuperado"
        const pagos = await query(`cliente_pagos?vendedor_id=eq.${mauricioId}&metodo_pago=eq.Yasta%20(QR)&created_at=gte.${sinceDate}&not.concepto.ilike.Asignado*&not.concepto.ilike.Saldo*`);
        
        pagos.forEach(p => {
            console.log(`[${p.created_at}] BS ${p.monto} - ${p.concepto} (Caja ID: ${p.caja_mov_id})`);
        });
        
        console.log(`\nTotal Pagos Origen Yasta: ${pagos.length}`);

    } catch (error) {
        console.error(error);
    }
}

main();
