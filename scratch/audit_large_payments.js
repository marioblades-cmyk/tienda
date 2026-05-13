
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
        const sinceDate = "2026-05-09T00:00:00Z";

        console.log(`--- BUSCANDO PAGOS GRANDES (>500 BS) DESDE EL SÁBADO ---`);
        const pagos = await query(`cliente_pagos?monto=gt.500&created_at=gte.${sinceDate}&select=*,vendedores(nombre),clientes(nombre)`);
        
        pagos.forEach(p => {
            console.log(`[${p.created_at}] BS ${p.monto} - ${p.clientes?.nombre} - ${p.metodo_pago} (Vendedor: ${p.vendedores?.nombre}) - Caja ID: ${p.caja_mov_id}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
