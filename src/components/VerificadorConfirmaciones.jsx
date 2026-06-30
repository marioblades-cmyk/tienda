import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { catalogService } from '../services/catalogService';
import { supabase } from '../services/supabase';
import { ShieldCheck, Upload, Loader2, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Calendar, Save } from 'lucide-react';

// Descuentos correctos por editorial (los mismos del sistema)
const EDITORIAL_DTOS = {
    'Ivrea': 35, 'Ovnipress': 30, 'Panini-Utopia': 20, 'Penguin': 35, 'Planeta': 35,
    'Deux-PopFiction': 40, 'Hotel de las Ideas': 40, 'V&R': 35, 'Otras': 35, 'Merchandising': 0,
};
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const DTO_NORM = Object.entries(EDITORIAL_DTOS).map(([k, v]) => ({ key: k, n: norm(k), dto: v }));
const getDto = (editorial) => {
    const n = norm(editorial);
    if (!n) return null;
    const m = DTO_NORM.find(e => e.n === n) || DTO_NORM.find(e => n.includes(e.n) || e.n.includes(n));
    return m ? m.dto : null;
};

// Parsea las filas del Excel de confirmaciones → ítems con sección (editorial) y descuento aplicado.
// Resultado serializable (se puede guardar tal cual en la base por semana).
const parseRows = (rows) => {
    const items = [];
    let cur = null, started = false;
    for (const r of rows) {
        const c0 = String(r[0] || '').trim();
        if (!started) { if (/^t[íi]tulo$/i.test(c0)) started = true; continue; }
        if (!c0) continue;
        const low = c0.toLowerCase();
        const dto = c0.match(/descuento\s*(\d+)/i);
        if (dto) { if (cur) cur.descuento = parseInt(dto[1]); continue; }
        if (low === 'subtotal' || low === 'total' || low.includes('total a pagar') || low.includes('total productos')) continue;
        const isbn = String(r[1] || '').replace(/[^0-9]/g, '');
        const precio = Number(r[2]) || 0;
        if (precio > 0) {
            // ítem (tenga o no ISBN numérico — muchos vienen como "ISBN A CONFIRMAR")
            items.push({ titulo: c0, isbn, precio, cant: parseInt(r[3]) || 0, _ref: cur });
        } else {
            // marcador de sección (editorial)
            cur = { nombre: c0, descuento: null };
        }
    }
    // Aplanar la sección/descuento (el descuento viene DESPUÉS de los ítems de la sección)
    return items.map(({ _ref, ...it }) => ({ ...it, seccion: _ref?.nombre || '?', descuento: _ref?.descuento ?? null }));
};

const parseFile = async (file) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    return parseRows(rows);
};

export default function VerificadorConfirmaciones({ file, semanaId }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [res, setRes] = useState(null);
    const [open, setOpen] = useState(false);
    const [semanas, setSemanas] = useState([]);
    const [savedIds, setSavedIds] = useState(new Set());   // semanas que ya tienen un Excel guardado
    const [sel, setSel] = useState('');                    // semana elegida en el selector
    const [nota, setNota] = useState('');

    // Cargar semanas + cuáles tienen Excel guardado
    const cargarSemanas = async () => {
        const { data: sems } = await supabase.from('semanas').select('id, nombre, created_at').order('created_at', { ascending: false });
        if (sems) setSemanas(sems.filter(s => { const u = (s.nombre || '').toUpperCase(); return !(u.includes('VENTA') && u.includes('STOCK')); }));
        const { data: saved } = await supabase.from('confirmaciones_archivos').select('semana_id');
        if (saved) setSavedIds(new Set(saved.map(x => x.semana_id)));
    };
    useEffect(() => { cargarSemanas(); }, []);

    // Cuando llega un Excel ya cargado (el que soltaste para el Master): abrir panel, preseleccionar su semana y guardarlo solo.
    useEffect(() => {
        if (!file) return;
        setOpen(true);
        if (semanaId) {
            setSel(semanaId);
            (async () => {
                try {
                    const items = await parseFile(file);
                    if (items.length) { await guardarSemana(semanaId, items, file.name); setNota('Excel guardado en su semana ✓ — ya podés generar el reporte cuando quieras.'); }
                } catch { /* silencioso: el guardado automático no debe molestar */ }
            })();
        }
    }, [file, semanaId]);

    const guardarSemana = async (semId, items, nombre) => {
        const { error: e } = await supabase.from('confirmaciones_archivos').upsert({
            semana_id: semId, archivo_nombre: nombre || null, items_json: items, total_items: items.length, updated_at: new Date().toISOString(),
        }, { onConflict: 'semana_id' });
        if (e) throw new Error('No se pudo guardar en la semana: ' + e.message);
        setSavedIds(prev => new Set(prev).add(semId));
    };

    // Corre el reporte (catálogo en vivo) sobre una lista de ítems ya parseados
    const runReport = async (items) => {
        if (!items || items.length === 0) throw new Error('No se detectaron ítems. ¿Es el archivo de confirmaciones del distribuidor?');
        const catalog = await catalogService.fetchFullCatalog();
        const byIsbn = {}, byTitle = {};
        catalog.forEach(p => {
            [p.ean_oficial, p.ean_interno].forEach(e => { const n = String(e || '').replace(/[^0-9]/g, ''); if (n.length >= 8 && !byIsbn[n]) byIsbn[n] = p; });
            const tn = norm(p.titulo); if (tn && !byTitle[tn]) byTitle[tn] = p;
        });

        const errores = [];
        let difMonto = 0, sinCatalogo = 0;
        for (const it of items) {
            const isbn = String(it.isbn || '');
            const prod = (isbn.length >= 8 && byIsbn[isbn]) || byTitle[norm(it.titulo)] || null;
            const edReal = prod?.editorial || '';
            const aplicado = it.descuento ?? null;            // descuento que puso el distribuidor (de la sección)
            const correcto = getDto(edReal || it.seccion);    // descuento correcto (editorial real, o la sección si no hay catálogo)
            const flags = [];
            if (edReal && norm(edReal) !== norm(it.seccion)) {
                flags.push({ t: 'ed', msg: `Está en "${it.seccion}" pero es de "${edReal}"` });
            }
            if (correcto != null && aplicado != null && correcto !== aplicado) {
                flags.push({ t: 'dto', msg: `Descuento ${aplicado}% — debería ser ${correcto}%${edReal ? ` (${edReal})` : ''}` });
                difMonto += it.precio * it.cant * ((1 - aplicado / 100) - (1 - correcto / 100));
            }
            if (prod && it.precio > 0) {
                const pc = Number(prod.precio_tapa) || 0;
                if (pc && Math.abs(pc - it.precio) > 0.5) {
                    flags.push({ t: 'precio', msg: `Precio ${it.precio.toLocaleString()} — catálogo ${pc.toLocaleString()}` });
                }
            } else if (!prod) {
                sinCatalogo++;
            }
            if (flags.length) errores.push({ ...it, flags });
        }
        setRes({ totalItems: items.length, errores, difMonto, sinCatalogo });
        setOpen(true);
    };

    // Subir un Excel (manual): parsea, lo guarda en la semana elegida (si hay) y corre el reporte
    const verificarFile = async (f) => {
        if (!f) return;
        setError(''); setRes(null); setNota(''); setLoading(true);
        try {
            const items = await parseFile(f);
            if (sel) { await guardarSemana(sel, items, f.name); setNota('Excel guardado en la semana seleccionada ✓'); }
            else setNota('No elegiste semana, así que NO se guardó (solo se generó el reporte). Elegí una semana arriba para guardarlo.');
            await runReport(items);
        } catch (e) { setError(e.message || 'Error al procesar el archivo.'); }
        finally { setLoading(false); }
    };

    // Generar el reporte desde lo guardado en una semana (sin subir nada)
    const verificarSemana = async () => {
        if (!sel) return;
        setError(''); setRes(null); setNota(''); setLoading(true);
        try {
            const { data, error: e } = await supabase.from('confirmaciones_archivos').select('items_json, archivo_nombre').eq('semana_id', sel).maybeSingle();
            if (e) throw new Error(e.message);
            if (!data?.items_json) throw new Error('Esta semana no tiene un Excel guardado. Subí uno y se guardará para la próxima.');
            await runReport(data.items_json);
        } catch (e) { setError(e.message || 'Error al cargar la semana.'); }
        finally { setLoading(false); }
    };

    const selTieneGuardado = sel && savedIds.has(sel);
    const COLOR = { ed: 'text-purple-600 bg-purple-50 border-purple-200', dto: 'text-red-600 bg-red-50 border-red-200', precio: 'text-orange-600 bg-orange-50 border-orange-200', cat: 'text-slate-500 bg-slate-50 border-slate-200' };

    return (
        <div className="bg-white border border-border/40 rounded-2xl overflow-hidden mb-5">
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3 bg-navy/5 hover:bg-navy/10 transition-colors">
                <span className="flex items-center gap-2 font-black text-navy text-sm"><ShieldCheck size={18} className="text-emerald-500" /> Verificador de Confirmaciones</span>
                {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
            {open && (
                <div className="p-5 space-y-4">
                    <p className="text-xs text-slate-500">Revisa, ítem por ítem (contra nuestro catálogo): editorial correcta, descuento correcto y precio.</p>

                    {/* Semanas guardadas: generar el reporte sin subir nada */}
                    <div className="bg-background rounded-xl p-3 border border-border/30 space-y-2">
                        <p className="text-[11px] font-black text-slate-500 flex items-center gap-1.5"><Calendar size={13} /> Semana</p>
                        <div className="flex flex-wrap items-center gap-2">
                            <select value={sel} onChange={e => setSel(e.target.value)} className="text-xs border border-border/40 rounded-lg px-2.5 py-2 bg-white min-w-[200px]">
                                <option value="">— Elegí una semana —</option>
                                {semanas.map(s => (
                                    <option key={s.id} value={s.id}>{savedIds.has(s.id) ? '✓ ' : '○ '}{s.nombre}</option>
                                ))}
                            </select>
                            <button onClick={verificarSemana} disabled={loading || !selTieneGuardado} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black px-4 py-2 rounded-lg transition-all">
                                {loading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Generar reporte de esta semana
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-400">✓ = la semana ya tiene un Excel guardado. ○ = todavía no (subí uno con la semana elegida y queda guardado).</p>
                    </div>

                    {/* Subir Excel (se guarda en la semana elegida) */}
                    <div className="flex flex-wrap items-center gap-2">
                        {file && (
                            <button onClick={() => verificarFile(file)} disabled={loading} className="flex items-center gap-2 bg-navy hover:bg-navy/90 disabled:opacity-50 text-white text-xs font-black px-4 py-2.5 rounded-xl transition-all">
                                {loading ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />} Verificar el Excel cargado ({file.name?.slice(0, 26)})
                            </button>
                        )}
                        <label className="flex items-center gap-2 w-fit cursor-pointer bg-navy hover:bg-navy/90 text-white text-xs font-black px-4 py-2.5 rounded-xl transition-all">
                            {loading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {sel ? 'Subir y guardar en la semana' : 'Subir Excel (sin guardar)'}
                            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={e => verificarFile(e.target.files?.[0])} disabled={loading} />
                        </label>
                    </div>

                    {nota && <div className="flex items-center gap-2 text-emerald-600 text-xs font-bold"><Save size={13} /> {nota}</div>}
                    {error && <div className="flex items-center gap-2 text-red-500 text-xs font-bold"><AlertTriangle size={14} /> {error}</div>}

                    {res && (
                        <div className="space-y-3">
                            <div className="flex flex-wrap gap-3">
                                <div className="bg-background rounded-xl px-4 py-2 border border-border/30">
                                    <p className="text-[9px] font-black text-slate-400 uppercase">Ítems</p>
                                    <p className="text-lg font-black text-navy">{res.totalItems}</p>
                                </div>
                                <div className={`rounded-xl px-4 py-2 border ${res.errores.length ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
                                    <p className="text-[9px] font-black text-slate-400 uppercase">Con error</p>
                                    <p className={`text-lg font-black ${res.errores.length ? 'text-red-600' : 'text-emerald-600'}`}>{res.errores.length}</p>
                                </div>
                                {Math.abs(res.difMonto) > 0.5 && (
                                    <div className="bg-red-50 rounded-xl px-4 py-2 border border-red-200">
                                        <p className="text-[9px] font-black text-slate-400 uppercase">Te cobran de más (por descuento mal)</p>
                                        <p className="text-lg font-black text-red-600 font-mono">{res.difMonto > 0 ? '+' : ''}{res.difMonto.toLocaleString('es-AR', { maximumFractionDigits: 0 })} ARS</p>
                                    </div>
                                )}
                            </div>

                            {res.errores.length === 0 ? (
                                <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm"><CheckCircle2 size={16} /> ¡Todo correcto! No se detectaron errores.</div>
                            ) : (
                                <div className="divide-y divide-border/20 border border-border/20 rounded-xl max-h-96 overflow-y-auto">
                                    {res.errores.map((it, i) => (
                                        <div key={i} className="px-3 py-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="font-bold text-navy text-xs truncate">{it.titulo}</span>
                                                <span className="text-[10px] text-slate-400 shrink-0">{it.isbn} · {it.cant}u · {it.precio.toLocaleString()}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                {it.flags.map((f, j) => (
                                                    <span key={j} className={`text-[10px] font-bold px-2 py-0.5 rounded border ${COLOR[f.t] || COLOR.cat}`}>{f.msg}</span>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {res.sinCatalogo > 0 && <p className="text-[11px] text-slate-400">{res.sinCatalogo} ítem(s) no están en el catálogo (no se pudieron verificar — quizá ISBN distinto o producto nuevo).</p>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
