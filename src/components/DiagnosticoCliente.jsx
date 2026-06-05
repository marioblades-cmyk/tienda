// ─────────────────────────────────────────────────────────────────────────
//  HERRAMIENTA TEMPORAL DE DIAGNÓSTICO DE CUENTA
//  Saca TODO el estado de cuenta de un cliente (ítems, pagos, caja, saldos)
//  en un bloque de texto copiable, para analizar y corregir errores.
//
//  ⚠️ TEMPORAL — quitar del menú cuando terminemos de corregir las cuentas.
// ─────────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Search, Stethoscope, Copy, Check, Loader2 } from 'lucide-react';

const f = (n) => Number(n || 0).toFixed(2);

export default function DiagnosticoCliente() {
    const [busqueda, setBusqueda] = useState('');
    const [resultados, setResultados] = useState([]);
    const [reporte, setReporte] = useState('');
    const [loading, setLoading] = useState(false);
    const [copiado, setCopiado] = useState(false);
    const [clienteSel, setClienteSel] = useState(null);

    const buscar = async (val) => {
        setBusqueda(val);
        if (val.trim().length < 2) { setResultados([]); return; }
        const { data } = await supabase.from('clientes')
            .select('id, nombre, celular')
            .or(`nombre.ilike.%${val}%,celular.ilike.%${val}%`)
            .limit(20);
        setResultados(data || []);
    };

    const generar = async (cliente) => {
        setLoading(true);
        setClienteSel(cliente);
        setResultados([]);
        setBusqueda(cliente.nombre);
        try {
            const cid = cliente.id;
            const [{ data: items }, { data: pagos }, { data: caja }] = await Promise.all([
                supabase.from('cliente_items').select('*').eq('cliente_id', cid).order('titulo'),
                supabase.from('cliente_pagos').select('*').eq('cliente_id', cid).order('created_at'),
                supabase.from('caja_movimientos').select('id, monto, concepto, metodo_pago, categoria, tipo, turno_id, created_at')
                    .ilike('concepto', `%${cliente.nombre}%`).order('created_at'),
            ]);

            const IT = items || [], PG = pagos || [], CJ = caja || [];

            // ── Cálculos ────────────────────────────────────────
            const totVentas = IT.reduce((s, i) => s + Number(i.precio_venta || 0), 0);
            const totPagItems = IT.reduce((s, i) => s + Number(i.monto_pagado || 0), 0);
            const saldoMostrado = totVentas - totPagItems;

            const esSub = (p) => (p.concepto || '').startsWith('Asignado a:');
            const raices = PG.filter(p => !esSub(p));
            const subs = PG.filter(esSub);

            const totCaja = CJ.filter(m => m.tipo !== 'EGRESO').reduce((s, m) => s + Number(m.monto || 0), 0);

            // Saldo a favor REAL = Σ por cada raíz: max(0, monto - subs vinculadas)
            let saldoFavorReal = 0;
            const detalleRaices = raices.map(r => {
                const subsVinc = subs.filter(s =>
                    (r.caja_mov_id && s.caja_mov_id === r.caja_mov_id) || (s.referencia && s.referencia === r.id)
                );
                const sumSubs = subsVinc.reduce((a, s) => a + Number(s.monto || 0), 0);
                const sobrante = Math.max(0, Number(r.monto || 0) - sumSubs);
                saldoFavorReal += sobrante;
                return { r, sumSubs, sobrante };
            });

            const esHistorico = (p) => (p.concepto || '').toLowerCase().includes('histórico');
            const totHistoricos = subs.filter(s => !s.caja_mov_id).reduce((a, s) => a + Number(s.monto || 0), 0);

            // ── Armar reporte de texto ──────────────────────────
            let R = '';
            R += `═══════════════════════════════════════════════════════\n`;
            R += `DIAGNÓSTICO DE CUENTA — ${cliente.nombre}\n`;
            R += `Cliente ID: ${cid} | Celular: ${cliente.celular || '—'}\n`;
            R += `Generado: ${new Date().toLocaleString('es-BO')}\n`;
            R += `═══════════════════════════════════════════════════════\n\n`;

            R += `── ÍTEMS (${IT.length}) ──\n`;
            IT.forEach(i => {
                const saldo = Number(i.precio_venta || 0) - Number(i.monto_pagado || 0);
                R += `  ${(i.titulo || '').slice(0, 38).padEnd(38)} | PV ${f(i.precio_venta).padStart(8)} | pag ${f(i.monto_pagado).padStart(8)} | saldo ${f(saldo).padStart(8)} | ${i.estado || ''}\n`;
            });
            R += `  ----------------------------------------------------\n`;
            R += `  TOTAL VENTAS: ${f(totVentas)} | TOTAL PAGADO ÍTEMS: ${f(totPagItems)} | SALDO MOSTRADO: ${f(saldoMostrado)}\n\n`;

            R += `── PAGOS / cliente_pagos (${PG.length}) ──\n`;
            PG.forEach(p => {
                R += `  ${(p.created_at || '').slice(0, 16)} | Bs ${f(p.monto).padStart(8)} | ${esSub(p) ? 'SUB ' : 'RAÍZ'} | "${(p.concepto || '').slice(0, 45)}" | caja=${p.caja_mov_id ? p.caja_mov_id.slice(0, 8) : 'NULL'.padEnd(8)} | ref=${p.referencia ? p.referencia.slice(0, 8) : 'null'}\n`;
            });
            R += `\n`;

            R += `── CAJA / contabilidad — ingresos a nombre del cliente (${CJ.length}) ──\n`;
            CJ.forEach(m => {
                R += `  ${(m.created_at || '').slice(0, 16)} | Bs ${f(m.monto).padStart(8)} | ${m.tipo} | ${m.categoria || ''} | "${(m.concepto || '').slice(0, 40)}" | ${m.metodo_pago || ''}\n`;
            });
            R += `  ----------------------------------------------------\n`;
            R += `  TOTAL EN CAJA (ingresos): ${f(totCaja)}\n\n`;

            R += `── ANÁLISIS DE SALDO A FAVOR (fórmula correcta) ──\n`;
            detalleRaices.forEach(({ r, sumSubs, sobrante }) => {
                R += `  ${(r.concepto || '').slice(0, 40).padEnd(40)} | monto ${f(r.monto).padStart(8)} − distribuido ${f(sumSubs).padStart(8)} = sobrante ${f(sobrante).padStart(8)}\n`;
            });
            R += `  ----------------------------------------------------\n`;
            R += `  SALDO A FAVOR REAL: ${f(saldoFavorReal)}\n\n`;

            // ── Verificación de confiabilidad ──────────────────
            // Lado A: dinero que entró (caja + históricos)
            // Lado B: dinero contabilizado (pagado a ítems + saldo a favor calculado)
            // Si NO cuadran → los datos están enredados, el saldo a favor NO es confiable
            const ladoA = totCaja + totHistoricos;
            const ladoB = totPagItems + saldoFavorReal;
            const difVerif = Math.abs(ladoA - ladoB);
            const confiable = difVerif < 1;

            R += `── VERIFICACIÓN DE CONFIABILIDAD ──\n`;
            R += `  (A) Dinero que entró     = caja + históricos      = ${f(ladoA)}\n`;
            R += `  (B) Dinero contabilizado = pagado ítems + a favor = ${f(ladoB)}\n`;
            R += `  Diferencia |A − B|       = ${f(difVerif)}\n`;
            if (confiable) {
                R += `  >>> ✅ CONFIABLE — los números cierran, el saldo a favor es real.\n\n`;
            } else {
                R += `  >>> ⚠️ NO CONFIABLE — datos enredados (vínculos pago→ítem rotos).\n`;
                R += `      El "saldo a favor real" de abajo está SOBREESTIMADO. NO corregir con él.\n`;
                R += `      El saldo MOSTRADO probablemente es el correcto. Revisar manual.\n\n`;
            }

            R += `── RESUMEN ──\n`;
            R += `  Total ventas:                    ${f(totVentas)}\n`;
            R += `  Pagado a ítems:                  ${f(totPagItems)}\n`;
            R += `  Saldo que MUESTRA el sistema:    ${f(saldoMostrado)}\n`;
            R += `  Saldo a favor calculado:         ${f(saldoFavorReal)} ${confiable ? '(confiable)' : '(⚠️ NO confiable)'}\n`;
            if (confiable) {
                R += `  >>> SALDO NETO REAL:             ${f(Math.max(0, saldoMostrado - saldoFavorReal))}  (saldo − saldo a favor)\n`;
            } else {
                R += `  >>> SALDO NETO REAL:             revisar manual (cálculo no confiable)\n`;
            }
            R += `  Dinero en caja (contabilidad):   ${f(totCaja)}\n`;
            R += `  Pagos históricos (sin caja):     ${f(totHistoricos)}\n`;
            R += `  Caja + históricos:               ${f(ladoA)}\n`;
            R += `═══════════════════════════════════════════════════════\n`;

            setReporte(R);
        } catch (e) {
            setReporte('ERROR al generar diagnóstico: ' + e.message);
        } finally {
            setLoading(false);
        }
    };

    const copiar = () => {
        navigator.clipboard.writeText(reporte);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
    };

    return (
        <div className="space-y-5 max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
                <Stethoscope className="text-purple-500" />
                <h3 className="text-xl font-bold text-navy">Diagnóstico de Cuenta <span className="text-xs font-normal text-purple-400">(herramienta temporal)</span></h3>
            </div>

            {/* Buscador + botón */}
            <div className="bg-white border border-border/40 rounded-2xl p-4">
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 flex-1 border border-border/40 rounded-xl px-3 py-2">
                        <Search size={16} className="text-slate-400" />
                        <input
                            value={busqueda}
                            onChange={e => buscar(e.target.value)}
                            placeholder="Buscar cliente por nombre o celular…"
                            className="flex-1 outline-none text-sm"
                        />
                    </div>
                </div>
                {resultados.length > 0 && (
                    <div className="mt-2 border border-border/30 rounded-xl divide-y divide-border/20 max-h-60 overflow-y-auto">
                        {resultados.map(c => (
                            <div key={c.id} className="flex items-center justify-between px-3 py-2 hover:bg-slate-50">
                                <div className="text-sm">
                                    <span className="font-bold text-navy">{c.nombre}</span>
                                    <span className="text-slate-400 ml-2">{c.celular}</span>
                                </div>
                                <button
                                    onClick={() => generar(c)}
                                    className="flex items-center gap-1.5 bg-purple-500 hover:bg-purple-600 text-white text-xs font-black px-3 py-1.5 rounded-lg transition-all"
                                >
                                    <Stethoscope size={13} /> Diagnóstico
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Reporte */}
            {loading ? (
                <div className="text-center py-10 text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin" /> Generando diagnóstico…
                </div>
            ) : reporte ? (
                <div className="bg-white border border-border/40 rounded-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-border/20">
                        <span className="font-bold text-navy text-sm">{clienteSel?.nombre}</span>
                        <button
                            onClick={copiar}
                            className="flex items-center gap-1.5 bg-navy hover:bg-navy/90 text-white text-xs font-black px-3 py-1.5 rounded-lg transition-all"
                        >
                            {copiado ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar todo</>}
                        </button>
                    </div>
                    <textarea
                        readOnly
                        value={reporte}
                        className="w-full h-[500px] p-4 font-mono text-[11px] leading-relaxed outline-none resize-none bg-slate-50/30"
                        onFocus={e => e.target.select()}
                    />
                </div>
            ) : (
                <div className="text-center py-10 text-slate-400 text-sm">
                    Buscá un cliente y apretá "Diagnóstico" para ver todo su estado de cuenta.
                </div>
            )}
        </div>
    );
}
