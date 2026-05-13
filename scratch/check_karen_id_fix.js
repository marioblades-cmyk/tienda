
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
        const items = await query(`cliente_items?titulo=ilike.DEMON%20SLAYER%20-%20KIMETSU%20NO%20YAIBA%2001&limit=1`);
        const cid = items[0].cliente_id;
        console.log(`Cliente ID de Karen: ${cid}`);
        
        const allItems = await query(`cliente_items?cliente_id=eq.${cid}`);
        allItems.forEach(it => {
            console.log(`  [${it.estado}] ${it.titulo} - Pagado: ${it.monto_pagado}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
