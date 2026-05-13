
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
        console.log(`--- BUSCANDO ÍTEMS DE DEMON SLAYER ---`);
        const items = await query(`cliente_items?titulo=ilike.DEMON%20SLAYER*&select=*,clientes(nombre)`);
        items.forEach(it => {
            console.log(`  [${it.estado}] ${it.titulo} - Cliente: ${it.clientes?.nombre} - Pagado: ${it.monto_pagado}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
