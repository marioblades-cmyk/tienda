
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

        console.log(`--- REPORTE COMPLETO DE ACTIVIDAD: MAURICIO ---`);
        console.log(`Desde: 2026-05-09 (Sábado)`);
        console.log(`Hasta: Hoy`);

        // 1. Items de Clientes (Ventas/Pedidos)
        const items = await query(`cliente_items?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        console.log(`\n📦 ITEMS REGISTRADOS / PEDIDOS (${items.length}):`);
        items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        items.forEach(item => {
            console.log(`  [${item.created_at.slice(0,16)}] ${item.clientes?.nombre}: ${item.titulo} (${item.estado})`);
        });

        // 2. Pagos de Clientes
        const pagos = await query(`cliente_pagos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}&select=*,clientes(nombre)`);
        console.log(`\n💰 PAGOS REGISTRADOS (${pagos.length}):`);
        pagos.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        pagos.forEach(pago => {
            console.log(`  [${pago.created_at.slice(0,16)}] ${pago.clientes?.nombre}: BS ${pago.monto} (${pago.motivo || 'Sin motivo'})`);
        });

        // 3. Movimientos de Caja
        const caja = await query(`caja_movimientos?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}`);
        console.log(`\n🏦 MOVIMIENTOS DE CAJA (${caja.length}):`);
        caja.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        caja.forEach(mov => {
            console.log(`  [${mov.created_at.slice(0,16)}] ${mov.tipo}: BS ${mov.monto} - ${mov.concepto}`);
        });

        // 4. Sincronizaciones de Catálogo
        const syncs = await query(`catalogo_sync_logs?vendedor_id=eq.${mauricioId}&created_at=gte.${sinceDate}`);
        console.log(`\n🔄 SINCRONIZACIONES DE CATÁLOGO (${syncs.length}):`);
        syncs.forEach(s => {
            console.log(`  [${s.created_at.slice(0,16)}] Archivo: ${s.filename}, Nuevos: ${s.nuevos_detectados}, Precios: ${s.precios_actualizados}`);
        });

        // 5. Búsqueda de errores específicos (borrados/ediciones)
        // Como stock_movimientos no tiene vendedor_id, buscamos por timestamps cercanos a su actividad en caja/pagos
        console.log(`\n⚠️ POSIBLES EDICIONES DE STOCK (Basado en timestamps de actividad):`);
        const stockMovs = await query(`stock_movimientos?created_at=gte.${sinceDate}&or=(motivo.eq.EDICIÓN%20MANUAL,motivo.eq.DEVOLUCIÓN)`);
        // Filtrar movimientos de stock que ocurrieron a la misma hora que los pagos de Mauricio
        const mauricioTimestamps = [
            ...items.map(i => i.created_at.slice(0, 16)),
            ...pagos.map(p => p.created_at.slice(0, 16)),
            ...caja.map(c => c.created_at.slice(0, 16))
        ];
        
        stockMovs.forEach(mov => {
            const ts = mov.created_at.slice(0, 16);
            if (mauricioTimestamps.includes(ts)) {
                console.log(`  [${mov.created_at.slice(0,16)}] (COINCIDENCIA) ${mov.titulo}: ${mov.delta} [${mov.motivo}] - ${mov.detalle}`);
            }
        });

    } catch (error) {
        console.error("Error en el reporte:", error);
    }
}

main();
