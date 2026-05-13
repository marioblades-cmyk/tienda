
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
        const clienteId = "78673a56-2580-40e1-af76-655f41ba8a06"; // ID de Karen
        console.log(`--- ÍTEMS DE KAREN DANIELA RAMOS CAZON ---`);
        const items = await query(`cliente_items?cliente_id=eq.${clienteId}`);
        items.forEach(it => {
            console.log(`  [${it.estado}] ${it.titulo} - Precio: ${it.precio_venta} - Pagado: ${it.monto_pagado}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
