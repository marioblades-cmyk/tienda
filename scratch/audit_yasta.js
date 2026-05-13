
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

        console.log(`--- AUDITORÍA ESPECÍFICA: YASTA (QR) - MAURICIO ---`);

        // 1. Pagos de Clientes con Yasta (QR)
        const pagos = await query(`cliente_pagos?vendedor_id=eq.${mauricioId}&metodo_pago=eq.Yasta%20(QR)&created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        console.log(`\n💰 PAGOS DE CLIENTES (YASTA QR) - REGISTRADOS POR MAURICIO:`);
        pagos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        let totalPagos = 0;
        pagos.forEach(p => {
            console.log(`  [${p.created_at}] ${p.clientes?.nombre}: BS ${p.monto} - ${p.concepto || 'Abono'}`);
            totalPagos += Number(p.monto);
        });
        console.log(`TOTAL PAGOS YASTA QR: BS ${totalPagos}`);

        // 2. Movimientos de Caja relacionados con Yasta o QR
        const caja = await query(`caja_movimientos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}&or=(concepto.ilike.*Yasta*,concepto.ilike.*QR*)`);
        console.log(`\n🏦 MOVIMIENTOS DE CAJA (YASTA/QR) - MAURICIO:`);
        caja.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        let totalCaja = 0;
        caja.forEach(m => {
            console.log(`  [${m.created_at}] ${m.tipo}: BS ${m.monto} - ${m.concepto}`);
            if (m.tipo === 'INGRESO') totalCaja += Number(m.monto);
            else totalCaja -= Number(m.monto);
        });
        console.log(`BALANCE NETO EN CAJA (YASTA/QR): BS ${totalCaja}`);

        // 3. Buscar discrepancias (Pagos sin movimiento de caja o viceversa)
        console.log(`\n🔍 BUSCANDO DISCREPANCIAS EN YASTA:`);
        const cajaIds = new Set(caja.map(m => m.id));
        const pagosConCaja = pagos.filter(p => p.caja_mov_id);
        const pagosSinCaja = pagos.filter(p => !p.caja_mov_id);

        if (pagosSinCaja.length > 0) {
            console.log(`⚠️ ALERTA: ${pagosSinCaja.length} pagos registrados por Mauricio NO TIENEN movimiento de caja asociado (No sumaron al total de la caja):`);
            pagosSinCaja.forEach(p => console.log(`  - [${p.created_at}] ${p.clientes?.nombre}: BS ${p.monto}`));
        } else {
            console.log(`✅ Todos los pagos de Yasta registrados por Mauricio tienen un ID de movimiento de caja.`);
        }

        // 4. Ver si hay movimientos de caja de Yasta/QR que NO sean de Mauricio pero ocurrieron en su turno
        console.log(`\n🕵️ OTROS MOVIMIENTOS DE YASTA/QR DESDE EL SÁBADO:`);
        const otrosCaja = await query(`caja_movimientos?vendedor_id=neq.${mauricioId}&created_at=gte.${sinceDate}&or=(concepto.ilike.*Yasta*,concepto.ilike.*QR*)`);
        otrosCaja.forEach(m => {
            console.log(`  [${m.created_at}] ${m.tipo}: BS ${m.monto} - ${m.concepto} (Vendedor ID: ${m.vendedor_id})`);
        });

    } catch (error) {
        console.error("Error en el reporte:", error);
    }
}

main();
