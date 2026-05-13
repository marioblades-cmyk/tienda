
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
        console.log(`--- CALCULANDO BALANCE TEÓRICO DE YASTA (QR) ---`);
        const caja = await query(`caja_movimientos?metodo_pago=eq.Yasta%20(QR)`);
        
        let totalIngresos = 0;
        let totalEgresos = 0;
        
        caja.forEach(m => {
            if (m.tipo === 'INGRESO') totalIngresos += Number(m.monto);
            else totalEgresos += Number(m.monto);
        });

        console.log(`Ingresos Totales: BS ${totalIngresos}`);
        console.log(`Egresos Totales: BS ${totalEgresos}`);
        console.log(`BALANCE ACTUAL: BS ${totalIngresos - totalEgresos}`);

        console.log(`\n--- ÚLTIMOS 10 MOVIMIENTOS DE YASTA ---`);
        caja.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        caja.slice(0, 10).forEach(m => {
            console.log(`[${m.created_at}] ${m.tipo}: BS ${m.monto} - ${m.concepto}`);
        });

    } catch (error) {
        console.error(error);
    }
}

main();
