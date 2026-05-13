
const url = "https://lbraboujrajvzosmddtu.supabase.co/rest/v1/";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxicmFib3VqcmFqdnpvc21kZHR1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2MTM2NjIsImV4cCI6MjA4ODE4OTY2Mn0.Pd3WNR8l7ylm7kE9Y0OylBMncxe5dyRVKS2dsugMlbs";

async function query(path) {
    const response = await fetch(url + path, {
        headers: {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Prefer": "head=true"
        }
    });
    return response.headers.get("content-range");
}

async function getColumns(table) {
    const response = await fetch(url + table + "?select=*", {
        headers: {
            "apikey": key,
            "Authorization": "Bearer " + key,
            "Range": "0-0"
        }
    });
    return await response.json();
}

async function main() {
    try {
        console.log("Caja Movimientos Columns:", Object.keys((await getColumns("caja_movimientos"))[0]));
        console.log("Cliente Pagos Columns:", Object.keys((await getColumns("cliente_pagos"))[0]));
    } catch (error) {
        console.error(error);
    }
}

main();
