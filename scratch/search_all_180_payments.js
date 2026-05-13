
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
        console.log(`--- BUSCANDO TODOS LOS PAGOS DE BS 180 AYER (LUNES) ---`);
        const pagos = await query(`cliente_pagos?monto=eq.180&created_at=gte.${monday}&created_at=lt.${tuesday}&select=*,clientes(nombre)`);
        pagos.forEach(p => {
            console.log(`  [${p.created_at}] BS ${p.monto} - Cliente: ${p.clientes?.nombre} - Concepto: ${p.concepto} (Caja ID: ${p.caja_mov_id})`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
