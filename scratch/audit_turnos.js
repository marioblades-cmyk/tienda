
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
        console.log(`--- TURNOS DE CAJA RECIENTES ---`);
        const turnos = await query(`turnos_caja?order=abierto_at.desc&limit=10`);
        turnos.forEach(t => {
            console.log(`[${t.abierto_at}] ${t.responsable} (${t.estado}) - Inicial: ${t.monto_inicial} | Final: ${t.monto_final}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
