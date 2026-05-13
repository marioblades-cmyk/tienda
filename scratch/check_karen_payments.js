
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
        const cid = "f0c8aa46-7bc2-42ce-a82f-4d76763cc9f0";
        console.log(`--- PAGOS DE KAREN DANIELA RAMOS CAZON ---`);
        const pagos = await query(`cliente_pagos?cliente_id=eq.${cid}&order=created_at.desc`);
        pagos.forEach(p => {
            console.log(`  [${p.created_at}] BS ${p.monto} - ${p.concepto} (Caja ID: ${p.caja_mov_id})`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
