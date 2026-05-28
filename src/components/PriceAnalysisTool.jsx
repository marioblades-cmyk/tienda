import React, { useState, useEffect, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../services/supabase';
import { catalogService } from '../services/catalogService';
import { SHEET_PROCESSORS } from '../utils/excelProcessors';
import { RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import './PriceAnalysisTool.css';

// Descuentos por editorial (usados si la hoja Totales no los tiene)
const EDITORIAL_DTOS_DEFAULT = {
  'Ivrea': 35, 'Ovnipress': 30, 'Panini-Utopia': 20,
  'Penguin': 35, 'Planeta': 35, 'Deux-PopFiction': 40,
  'Hotel de las Ideas': 40, 'V&R': 35, 'Otras': 35, 'Merchandising': 0
};

// ─── getBadgeClass ────────────────────────────────────────────────────────────
function getBadgeClass(margin) {
  if (margin >= 0.30) return 'badge-success';
  if (margin >= 0.15) return 'badge-warning';
  return 'badge-danger';
}

// Mapeo de nombres en hoja Totales → nombres de tabs del Excel
const TOTALES_NAME_MAP = {
  'ivrea':             'Ivrea',
  'ovni press':        'Ovnipress',
  'ovnipress':         'Ovnipress',
  'panini y utopia':   'Panini-Utopia',
  'panini-utopia':     'Panini-Utopia',
  'panini':            'Panini-Utopia',
  'penguin':           'Penguin',
  'planeta':           'Planeta',
  'pop fiction':       'Deux-PopFiction',
  'deux':              'Deux-PopFiction',
  'deux-popfiction':   'Deux-PopFiction',
  'hotel de las ideas':'Hotel de las Ideas',
  'hotel':             'Hotel de las Ideas',
  'v&r':               'V&R',
  'otras':             'Otras',
  'merchandising':     'Merchandising',
};

// ─── Extrae descuentos de la hoja Totales ────────────────────────────────────
// Col B (índice 1) = Editorial, Col E (índice 4) = Dto%
function parseTotalesSheet(ws) {
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const dtos = { ...EDITORIAL_DTOS_DEFAULT };

  for (const row of rows) {
    if (!row || row.length < 5) continue;

    const colB = row[1]; // Editorial
    const colE = row[4]; // Dto%

    if (!colB || colE == null) continue;

    const edName = String(colB).trim().toLowerCase();
    const tabKey = TOTALES_NAME_MAP[edName];
    if (!tabKey) continue;

    // Parsear el porcentaje (puede venir como 0.35 o como "35%")
    let dtoNum = parseFloat(String(colE).replace('%', '').replace(',', '.'));
    if (isNaN(dtoNum)) continue;
    // Si llegó como decimal (ej. 0.35), convertir a %
    if (dtoNum > 0 && dtoNum < 1) dtoNum = dtoNum * 100;
    if (dtoNum > 0 && dtoNum < 100) {
      dtos[tabKey] = dtoNum;
    }
  }
  return dtos;
}


export default function PriceAnalysisTool() {
  // ── Estado de datos cargados ──────────────────────────────────────────────
  const [semanaInfo, setSemanaInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // editoriales: { 'Ivrea': [2500, 3000, …], 'Ovnipress': [...] }
  const [editoriales, setEditoriales] = useState({});
  // descuentos por editorial extraídos del Excel
  const [dtosPorEd, setDtosPorEd] = useState(EDITORIAL_DTOS_DEFAULT);

  // ── Estado de la herramienta ──────────────────────────────────────────────
  const [curEd, setCurEd] = useState(null);
  const [showFormulas, setShowFormulas] = useState(false);
  const [activeRow, setActiveRow] = useState(null); // fila seleccionada para desglose
  const [params, setParams] = useState({
    flet:          6,      // Flete BS/ud
    tcf:           0.014,  // TC Fijo
    tca:           0.0068, // TC Actual
    dtoNiveles:    [5, 10, 15],
  });
  // PVC: Ajustes manuales de PV — persistidos en localStorage
  const PVC_KEY    = 'mcb_price_adjustments';
  const MARG_KEY   = 'mcb_margin_per_ed';
  const MMAY_KEY   = 'mcb_margin_mayor_per_ed';

  const [PVC, setPVC] = useState({});
  const [margPorEd, setMargPorEd] = useState({});
  const [margenMayoreoPorEd, setMargenMayoreoPorEd] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { msg, type: 'success'|'error' }

  // Mostrar toast y auto-ocultar a los 3 segundos
  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Valores activos para la editorial seleccionada ────────────────────────
  const descActual          = useMemo(() => curEd ? (dtosPorEd[curEd] ?? 35) / 100 : 0, [curEd, dtosPorEd]);
  const margActual          = useMemo(() => curEd ? (margPorEd[curEd] ?? 0.40) : 0.40, [curEd, margPorEd]);
  const margenMayoreoActual = useMemo(() => curEd ? (margenMayoreoPorEd[curEd] ?? 0.30) : 0.30, [curEd, margenMayoreoPorEd]);

  // Helpers para actualizar valores por editorial (con persistencia)
  const setMargEd = (val) => {
    const v = parseFloat(val) || 0;
    const next = { ...margPorEd, [curEd]: v / 100 };
    setMargPorEd(next);
    try { localStorage.setItem(MARG_KEY, JSON.stringify(next)); } catch {}
  };
  const setMargenMayoreoEd = (val) => {
    const v = parseFloat(val) || 0;
    const next = { ...margenMayoreoPorEd, [curEd]: v / 100 };
    setMargenMayoreoPorEd(next);
    try { localStorage.setItem(MMAY_KEY, JSON.stringify(next)); } catch {}
  };

  // ── Cargar último Excel de semanas ────────────────────────────────────────
  useEffect(() => {
    initTool();

    // Escuchar cuando se sube un nuevo Excel de semana y recargar precios
    const handleNewWeek = () => {
      showToast('Nuevo Excel detectado. Actualizando precios...', 'success');
      setTimeout(() => initTool(), 800);
    };
    window.addEventListener('week-file-uploaded', handleNewWeek);
    return () => window.removeEventListener('week-file-uploaded', handleNewWeek);
  }, []);

  const initTool = async () => {
    await loadLastWeek();
    await fetchSyncData();
  };

  const fetchSyncData = async () => {
    try {
      // 1. Cargar Configuraciones
      const { data: settings, error: setErr } = await supabase
        .from('price_analysis_settings')
        .select('*');
      
      if (!setErr && settings) {
        const mEd = {};
        const mmEd = {};
        const dEd = { ...dtosPorEd }; // Empezar con los del Excel
        let globalParams = { ...params };

        settings.forEach(s => {
          if (s.editorial && s.editorial !== 'GLOBAL_SETTINGS') {
            mEd[s.editorial] = parseFloat(s.margen_venta);
            mmEd[s.editorial] = parseFloat(s.margen_mayoreo);
            if (s.descuento_proveedor != null) {
              dEd[s.editorial] = parseFloat(s.descuento_proveedor);
            }
          } else if (s.editorial === 'GLOBAL_SETTINGS') {
            // Configuración global
            globalParams = {
              ...globalParams,
              flet: parseFloat(s.flete),
              tcf: parseFloat(s.tcf),
              tca: parseFloat(s.tca),
              dtoNiveles: s.dto_niveles || [5, 10, 15]
            };
          }
        });

        setMargPorEd(mEd);
        setMargenMayoreoPorEd(mmEd);
        setDtosPorEd(dEd);
        setParams(globalParams);
      }

      // 2. Cargar Ajustes Manuales
      const { data: adjustments, error: adjErr } = await supabase
        .from('price_analysis_adjustments')
        .select('*');
      
      if (!adjErr && adjustments) {
        const nextPVC = {};
        adjustments.forEach(a => {
          if (!nextPVC[a.editorial]) nextPVC[a.editorial] = {};
          nextPVC[a.editorial][a.precio_ars] = parseFloat(a.pv_ajuste);
        });
        setPVC(nextPVC);
      }
    } catch (err) {
      console.warn('Error sincronizando con BD, usando valores por defecto:', err);
    }
  };

  const loadLastWeek = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // 1. Obtener la semana más reciente con archivo
      const { data: semanas, error: semErr } = await supabase
        .from('semanas')
        .select('*')
        .not('archivo_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (semErr) throw semErr;
      if (!semanas?.length) throw new Error('No hay semanas con archivo cargado.');

      const semana = semanas[0];
      setSemanaInfo(semana);

      // 2. Descargar el Excel
      const response = await fetch(semana.archivo_url);
      if (!response.ok) throw new Error('No se pudo descargar el archivo del servidor.');

      const blob = await response.blob();
      const arrayBuf = await blob.arrayBuffer();
      const wb = XLSX.read(arrayBuf, { type: 'array' });

      // 3. Extraer descuentos de la primera hoja (Totales)
      const firstSheet = wb.SheetNames[0];
      const totalesNombres = ['Totales', 'TOTALES', 'Resumen', 'RESUMEN', 'Total', firstSheet];
      const totalesSheetName = totalesNombres.find(n => wb.SheetNames.includes(n));
      let dtos = { ...EDITORIAL_DTOS_DEFAULT };
      if (totalesSheetName) {
        dtos = parseTotalesSheet(wb.Sheets[totalesSheetName]);
      }
      setDtosPorEd(dtos);

      // 4. Para cada editorial, extraer precios únicos
      const edData = {};
      const disponibles = Object.keys(SHEET_PROCESSORS).filter(s => wb.SheetNames.includes(s));

      for (const sheetName of disponibles) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const result = SHEET_PROCESSORS[sheetName](rows);

        if (result?.items?.length) {
          // Extraer precios únicos y marcar si tienen alguna reimpresión
          const priceMap = {}; // ars -> { isReprint: bool }
          result.items.forEach(item => {
            const p = parseFloat(item.precio_tapa);
            if (!p) return;
            const cat = (item.categoria_principal || item.categoria || '').toLowerCase();
            const tit = (item.titulo || '').toLowerCase();
            // Búsqueda más agresiva para reimpresiones
            const reprintTerm = /reimp|reimpresi[óo]n/i;
            const isReprint = reprintTerm.test(cat) || reprintTerm.test(tit);
            
            if (!priceMap[p]) {
              priceMap[p] = { ars: p, isReprint };
            } else if (isReprint) {
              priceMap[p].isReprint = true;
            }
          });
          
          edData[sheetName] = Object.values(priceMap).sort((a, b) => a.ars - b.ars);
        }
      }

      if (!Object.keys(edData).length) throw new Error('No se encontraron precios en el Excel.');

      setEditoriales(edData);
      setCurEd(Object.keys(edData)[0]);

    } catch (err) {
      console.error('Error cargando datos de precio:', err);
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Actualizadores de parámetros ──────────────────────────────────────────
  const updateParam = (key, val) => {
    let numVal = parseFloat(val) || 0;
    if (['marg', 'margenMayoreo'].includes(key)) numVal = numVal / 100;
    setParams(prev => ({ ...prev, [key]: numVal }));
  };

  const updateDtoNivel = (idx, val) => {
    const n = [...params.dtoNiveles];
    n[idx] = parseFloat(val) || 0;
    setParams(prev => ({ ...prev, dtoNiveles: n }));
  };

  const updatePrice = (ars, val) => {
    const numVal = parseFloat(val) || 0;
    setPVC(prev => {
      const next = {
        ...prev,
        [curEd]: { ...(prev[curEd] || {}), [ars]: numVal }
      };
      // Si el valor es 0 o vacío, borrar la clave para no acumular basura
      if (!numVal) {
        const edCopy = { ...(next[curEd] || {}) };
        delete edCopy[ars];
        next[curEd] = edCopy;
      }
      return next;
    });
  };

  const handleSaveAndApply = async () => {
    if (!curEd) return;
    setSaving(true);
    try {
      // 1. GUARDAR CONFIGURACIÓN (Settings y Ajustes Manuales)
      // 1.1 Guardar settings de la editorial actual
      await supabase.from('price_analysis_settings').delete().eq('editorial', curEd);
      const { error: err1 } = await supabase.from('price_analysis_settings').insert({
        editorial: curEd,
        margen_venta: margActual,
        margen_mayoreo: margenMayoreoActual,
        descuento_proveedor: dtosPorEd[curEd],
        updated_at: new Date()
      });
      if (err1) throw err1;

      // 1.2 Guardar settings globales (flete y TC)
      await supabase.from('price_analysis_settings').delete().eq('editorial', 'GLOBAL_SETTINGS');
      const { error: err2 } = await supabase.from('price_analysis_settings').insert({
        editorial: 'GLOBAL_SETTINGS',
        flete: params.flet,
        tcf: params.tcf,
        tca: params.tca,
        dto_niveles: params.dtoNiveles,
        updated_at: new Date()
      });
      if (err2) throw err2;

      // 1.3 Guardar ajustes manuales
      await supabase.from('price_analysis_adjustments').delete().eq('editorial', curEd);
      const adjustments = Object.entries(PVC[curEd] || {}).map(([ars, pv]) => ({
        editorial: curEd,
        precio_ars: parseFloat(ars),
        pv_ajuste: parseFloat(pv)
      }));
      if (adjustments.length > 0) {
        const { error: err3 } = await supabase.from('price_analysis_adjustments').insert(adjustments);
        if (err3) throw err3;
      }

      // 2. SINCRONIZAR CON EL CATÁLOGO MAESTRO (Aplicar cambios a productos)
      if (rows.length > 0) {
        let catalogItems = [];
        let from = 0;
        let to = 999;
        let hasMore = true;

        while (hasMore) {
          const { data, error: fetchErr } = await supabase
            .from('catalogo_productos')
            .select('id, product_id, titulo, precio_tapa, editorial')
            .eq('editorial', curEd)
            .range(from, to);

          if (fetchErr) throw fetchErr;
          
          if (data && data.length > 0) {
            catalogItems = [...catalogItems, ...data];
            if (data.length < 1000) hasMore = false;
            else { from += 1000; to += 1000; }
          } else {
            hasMore = false;
          }
        }

        if (catalogItems.length > 0) {
          const resultsMap = {};
          rows.forEach(r => {
            const arsKey = Math.round(Number(r.ars));
            resultsMap[arsKey] = { pv: r.pvFinal, n2: r.dtos[1], n3: r.dtos[2], pm: r.pMayor };
          });

          const payload = [];
          catalogItems.forEach(item => {
            const itemArs = Math.round(Number(item.precio_tapa));
            const calc = resultsMap[itemArs];
            if (calc) {
              payload.push({
                id: item.id,
                product_id: item.product_id,
                titulo: item.titulo,
                editorial: item.editorial,
                precio_tapa: item.precio_tapa,
                precio_venta_bs: Number(calc.pv.toFixed(2)),
                precio_n2_bs: Number(calc.n2.toFixed(2)),
                precio_n3_bs: Number(calc.n3.toFixed(2)),
                precio_mayoreo_bs: Number(calc.pm.toFixed(2)),
                updated_at: new Date()
              });
            }
          });

          if (payload.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < payload.length; i += chunkSize) {
              const chunk = payload.slice(i, i + chunkSize);
              const { error: syncErr } = await supabase
                .from('catalogo_productos')
                .upsert(chunk, { onConflict: 'id' });
              if (syncErr) throw syncErr;
            }
          }
        }
      }

      // Notificar a CatalogUpdatedView y otras vistas para que refresquen
      catalogService.clearCache?.();
      window.dispatchEvent(new CustomEvent('catalog-prices-updated'));
      showToast(`¡Cambios aplicados! Configuración guardada y productos actualizados.`);
    } catch (err) {
      console.error('Error al guardar y aplicar:', err);
      showToast('Error al guardar y aplicar: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Cálculos por fila ────────────────────────────────────────────────────
  const rows = useMemo(() => {
    if (!curEd || !editoriales[curEd]) return [];
    
    // Base ARS de la editorial
    const baseArs = editoriales[curEd];

    return baseArs.map(item => {
      const ars = item.ars;
      const desc  = descActual;
      const marg  = margActual;
      const mmayo = margenMayoreoActual;

      // Cálculo Automático
      const D    = (ars * (1 - desc) * params.tcf + params.flet) * (1 + marg);
      const E    = Math.round(D / 5) * 5;
      const F    = E * 0.65;
      const G_PV = Math.round(F / 5) * 5;

      const pvManual = PVC[curEd]?.[ars] || 0;
      const pvFinal  = pvManual || G_PV;

      const precioN2 = pvFinal * 0.90;
      const costoReal = ars * (1 - desc) * params.tca + params.flet;
      const gN2 = (precioN2 - costoReal) / costoReal;

      // Descuentos sobre PV
      const dtos = params.dtoNiveles.map(lvl => pvFinal * (1 - lvl / 100));

      // Rentabilidad
      const gPV       = costoReal > 0 ? (pvFinal - costoReal) / costoReal : 0;
      const pMayor    = costoReal * (1 + mmayo);
      const gMayor    = costoReal > 0 ? (pMayor - costoReal) / costoReal : 0;

      // G% para cada nivel de descuento  =  (PV_Nivel - Costo) / Costo
      const gDtos = dtos.map(dVal => (dVal - costoReal) / costoReal);

      return {
        ars, D, E, F, G_PV, pvManual, pvFinal, dtos, gDtos,
        costoReal, gPV, pMayor, gMayor, precioN2, gN2
      };
    });
  }, [curEd, editoriales, params, descActual, margActual, margenMayoreoActual, PVC]);

  // ── Render de estados de carga ────────────────────────────────────────────
  if (loading) return (
    <div className="mcb-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '0.75rem' }}>
      <div style={{ width: 32, height: 32, border: '3px solid var(--mcb-border)', borderTopColor: 'var(--mcb-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: 'var(--mcb-muted)', fontFamily: 'var(--mcb-font-body)', fontWeight: 600 }}>
        Cargando última semana…
      </span>
    </div>
  );

  if (loadError) return (
    <div className="mcb-container" style={{ padding: '2rem' }}>
      <div style={{ background: 'hsla(0, 72%, 51%, 0.1)', border: '1px solid hsla(0, 72%, 51%, 0.3)', borderRadius: 10, padding: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        <AlertTriangle size={24} style={{ color: 'hsl(0 72% 51%)', flexShrink: 0, marginTop: 2 }} />
        <div>
          <p style={{ fontWeight: 700, color: 'hsl(0 72% 40%)', marginBottom: '0.5rem' }}>Error al cargar datos</p>
          <p style={{ color: 'var(--mcb-muted)', fontSize: '0.875rem' }}>{loadError}</p>
          <button className="btn-mcb-primary" style={{ marginTop: '1rem' }} onClick={loadLastWeek}>
            <RefreshCw size={14} style={{ marginRight: 6, display: 'inline' }} />
            Reintentar
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="mcb-container">
      {/* ── Toast Notification ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          background: toast.type === 'success' ? 'hsl(142 71% 45%)' : 'hsl(0 72% 51%)',
          color: 'white', borderRadius: 12, padding: '0.75rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
          fontSize: '0.85rem', fontWeight: 700, zIndex: 9999,
          animation: 'slideIn 0.3s ease',
        }}>
          {toast.type === 'success'
            ? <CheckCircle2 size={18} />
            : <XCircle size={18} />}
          {toast.msg}
        </div>
      )}

      {/* Banner de semana activa */}
      {semanaInfo && (
        <div style={{ marginBottom: '1rem', padding: '0.5rem 1rem', background: 'var(--mcb-cream)', borderRadius: 8, border: '1px solid var(--mcb-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--mcb-primary)', fontFamily: 'var(--mcb-font-mono)' }}>
            📂 {semanaInfo.nombre} — {Object.keys(editoriales).length} editoriales cargadas
          </span>
          <button onClick={loadLastWeek} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--mcb-muted)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
            <RefreshCw size={12} /> Actualizar
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: '1.5rem', alignItems: 'start' }}>

        {/* ════  SIDEBAR  ════ */}
        <aside>
          {/* Editoriales del Excel */}
          <div className="mcb-sidebar-group">
            <div className="mcb-sidebar-group-title">Editoriales</div>
            <div>
              {Object.keys(editoriales).map(ed => (
                <button
                  key={ed}
                  className={`mcb-sidebar-btn ${curEd === ed ? 'active' : ''}`}
                  onClick={() => setCurEd(ed)}
                >
                  <span>{ed}</span>
                  <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>{editoriales[ed].length} prec.</span>
                </button>
              ))}
            </div>
          </div>

          {/* Descuento y Márgenes de la editorial activa (leídos del Excel / override) */}
          {curEd && (
            <div className="mcb-sidebar-group" style={{ borderLeft: '3px solid var(--mcb-accent)' }}>
              <div className="mcb-sidebar-group-title">📌 {curEd}</div>
              <div className="mcb-param-row">
                <span className="mcb-param-label">Dto. proveedor</span>
                <div className="mcb-param-input-wrap">
                  <input type="number" className="mcb-param-input"
                    value={dtosPorEd[curEd] ?? 35}
                    onChange={e => {
                      const v = parseFloat(e.target.value) || 0;
                      setDtosPorEd(prev => ({ ...prev, [curEd]: v }));
                    }}
                  />
                  <span className="mcb-param-unit">%</span>
                </div>
              </div>
              <div className="mcb-param-row">
                <span className="mcb-param-label">Margen venta</span>
                <div className="mcb-param-input-wrap">
                  <input type="number" step="any" className="mcb-param-input"
                    value={+(margActual * 100).toFixed(1)}
                    onChange={e => setMargEd(e.target.value)}
                  />
                  <span className="mcb-param-unit">%</span>
                </div>
              </div>
              <div className="mcb-param-row">
                <span className="mcb-param-label">Margen mayor.</span>
                <div className="mcb-param-input-wrap">
                  <input type="number" step="any" className="mcb-param-input"
                    value={+(margenMayoreoActual * 100).toFixed(1)}
                    onChange={e => setMargenMayoreoEd(e.target.value)}
                  />
                  <span className="mcb-param-unit">%</span>
                </div>
              </div>
              <p style={{ fontSize: '0.62rem', color: 'var(--mcb-muted)', marginTop: '0.25rem' }}>
                Sin guardar: usa 40% venta · 30% mayor.
              </p>
            </div>
          )}

          {/* Flete (único parámetro global — el resto es por editorial) */}
          <div className="mcb-sidebar-group">
            <div className="mcb-sidebar-group-title">Global</div>
            <div className="mcb-param-row">
              <span className="mcb-param-label">Flete/ud.</span>
              <div className="mcb-param-input-wrap">
                <input type="number" step="any" className="mcb-param-input"
                  value={params.flet}
                  onChange={e => updateParam('flet', e.target.value)} />
                <span className="mcb-param-unit">BS</span>
              </div>
            </div>
          </div>

          {/* Tipo de Cambio */}
          <div className="mcb-sidebar-group">
            <div className="mcb-sidebar-group-title">Tipo de Cambio</div>
            {[
              { label: 'TC fijo',   key: 'tcf' },
              { label: 'TC actual', key: 'tca' },
            ].map(({ label, key }) => (
              <div className="mcb-param-row" key={key}>
                <span className="mcb-param-label">{label}</span>
                <input type="number" step="0.0001" className="mcb-param-input"
                  value={params[key]}
                  onChange={e => updateParam(key, e.target.value)} />
              </div>
            ))}
          </div>

          {/* Niveles de Descuento — solo 3 */}
          <div className="mcb-sidebar-group">
            <div className="mcb-sidebar-group-title">Niveles de Dto.</div>
            {params.dtoNiveles.map((dto, idx) => (
              <div className="mcb-param-row" key={idx}>
                <span className="mcb-param-label">Nivel {idx + 1}</span>
                <div className="mcb-param-input-wrap">
                  <input type="number" className="mcb-param-input" value={dto}
                    onChange={e => updateDtoNivel(idx, e.target.value)} />
                  <span className="mcb-param-unit">%</span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* ════  TABLA PRINCIPAL  ════ */}
        <section>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '1.25rem',
            background: 'white',
            padding: '1rem',
            borderRadius: '12px',
            border: '1px solid var(--mcb-border)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', alignItems: 'center' }}>
              <div style={{ fontSize: '0.9rem', color: 'var(--mcb-primary)', fontWeight: 700 }}>
                {rows.length} precios · <span style={{ color: 'var(--mcb-accent)' }}>{curEd}</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                className="btn-mcb-primary" 
                style={{ 
                  fontSize: '0.82rem', 
                  padding: '0.6rem 1.4rem', 
                  borderRadius: '10px',
                  fontWeight: 700,
                  boxShadow: '0 10px 15px -3px rgba(240, 125, 42, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem'
                }}
                onClick={handleSaveAndApply}
                disabled={saving}
              >
                {saving ? <RefreshCw size={14} className="spin" /> : '🚀'}
                {saving ? 'Aplicando...' : 'Guardar y Aplicar al Catálogo'}
              </button>
            </div>
          </div>

          {rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--mcb-muted)' }}>
              Seleccioná una editorial del panel izquierdo
            </div>
          ) : (
            <div className="mcb-table-wrapper">
              <table className="mcb-table">
                <thead>
                  <tr>
                    <th rowSpan="2" className="bg-ars">PRECIO ARS</th>
                    <th rowSpan="2" className="bg-pv">PV AJUSTE</th>
                    <th colSpan="4" className="bg-auto">CÁLCULO AUTOMÁTICO</th>
                    <th colSpan="3" className="bg-dtos">DESCUENTOS SOBRE PV</th>
                    <th colSpan="3" className="bg-gain">G% POR NIVEL</th>
                    <th colSpan="4" className="bg-cost">COSTO Y GANANCIA</th>
                  </tr>
                  <tr>
                    <th className="bg-auto">D BASE</th>
                    <th className="bg-auto">E RDND</th>
                    <th className="bg-auto">F ×0.65</th>
                    <th className="bg-auto">G PV</th>
                    {params.dtoNiveles.map((_, i) => (
                      <th key={`n${i}`} className="bg-dto" style={{ minWidth: 60 }}>N{i + 1} BS</th>
                    ))}
                    <th className="bg-gain">G% N2</th>
                    {params.dtoNiveles.map((_, i) => (
                      <th key={`g${i}`} className="bg-gain">G% N{i + 1}</th>
                    ))}
                    <th className="bg-cost">COSTO REAL BS</th>
                    <th className="bg-gain">G% PV</th>
                    <th className="bg-mayor">P. MAYOR</th>
                    <th className="bg-mayor">G% MAYOR</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr
                      key={row.ars}
                      onClick={() => {
                        setActiveRow(row);
                        if (!showFormulas) setShowFormulas(true);
                      }}
                      style={{
                        cursor: 'pointer',
                        outline: activeRow?.ars === row.ars ? '2px solid var(--mcb-accent)' : 'none',
                        outlineOffset: '-1px',
                        background: activeRow?.ars === row.ars ? 'hsla(28,90%,52%,0.08)' : undefined,
                      }}
                      title="Clic para ver desglose de cálculo"
                    >
                      <td className="td-ars">ARS {row.ars.toLocaleString('es-BO')}</td>
                      <td style={{ padding: '0.4rem 0.5rem' }}>
                        <input type="number" className="mcb-input"
                          placeholder={row.G_PV}
                          value={row.pvManual || ''}
                          onChange={e => updatePrice(row.ars, e.target.value)} />
                      </td>
                      <td className="td-muted">{row.D.toFixed(2)}</td>
                      <td className="td-mono">{row.E}</td>
                      <td className="td-muted">{row.F.toFixed(2)}</td>
                      <td className="td-navy" style={{ position: 'relative' }}>
                        {row.pvFinal}
                        {row.pvManual > 0 && (
                          <span title="Precio ajustado manualmente" style={{
                            display: 'inline-block', marginLeft: 4,
                            background: 'var(--mcb-accent)', color: 'white',
                            borderRadius: 3, fontSize: '0.55rem', padding: '1px 4px',
                            verticalAlign: 'middle', fontWeight: 800, lineHeight: 1.4
                          }}>M</span>
                        )}
                      </td>
                      {row.dtos.map((val, i) => (
                        <td key={i} className="td-dto">{val.toFixed(2)}</td>
                      ))}
                      <td>
                        <span className={`mcb-badge ${getBadgeClass(row.gN2)}`}>
                          {(row.gN2 * 100).toFixed(1)}%
                        </span>
                      </td>
                      {row.gDtos.map((g, i) => (
                        <td key={`g${i}`}>
                          <span className={`mcb-badge ${getBadgeClass(g)}`}>
                            {(g * 100).toFixed(1)}%
                          </span>
                        </td>
                      ))}
                      <td className="td-costo">BS {row.costoReal.toFixed(2)}</td>
                      <td>
                        <span className={`mcb-badge ${getBadgeClass(row.gPV)}`}>
                          {(row.gPV * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="td-accent">BS {row.pMayor.toFixed(2)}</td>
                      <td>
                        <span className={`mcb-badge ${getBadgeClass(row.gMayor)}`}>
                          {(row.gMayor * 100).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── PANEL DE FÓRMULAS ── */}
          <div style={{ marginTop: '1rem' }}>
            <button
              onClick={() => setShowFormulas(v => !v)}
              style={{
                background: showFormulas ? 'var(--mcb-primary)' : 'white',
                color: showFormulas ? 'var(--mcb-cream)' : 'var(--mcb-muted)',
                border: '1px solid var(--mcb-border)',
                borderRadius: 8,
                padding: '0.4rem 1rem',
                fontFamily: 'var(--mcb-font-body)',
                fontWeight: 700,
                fontSize: '0.78rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                transition: 'all 0.15s',
              }}
            >
              <span>{showFormulas ? '▲' : '▼'}</span>
              {showFormulas ? 'Ocultar fórmulas' : '📐 Ver fórmulas y cálculos'}
            </button>

            {showFormulas && (
              <div style={{
                marginTop: '0.5rem',
                background: 'white',
                border: '1px solid var(--mcb-border)',
                borderRadius: 10,
                padding: '1.25rem',
                boxShadow: '0 2px 8px -2px rgba(21,37,54,0.08)',
              }}>
                {/* Sección de fórmulas genéricas */}
                <div style={{ marginBottom: activeRow ? '1rem' : 0 }}>
                  <p style={{ fontFamily: 'var(--mcb-font-display)', fontSize: '1rem', color: 'var(--mcb-primary)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                    📌 Fórmulas de referencia
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.5rem' }}>
                    {[
                      { col: 'D BASE',     formula: '(ARS × (1−Desc) × TC_Fijo + Flete) × (1+Margen)' },
                      { col: 'E RDND',     formula: 'Math.round(D / 5) × 5' },
                      { col: 'F ×0.65',   formula: 'E × 0.65' },
                      { col: 'G PV',       formula: 'Math.round(F / 5) × 5  ← precio sugerido' },
                      { col: 'N2 (-10%)',   formula: 'PV_Final × 0.90' },
                      { col: 'N3 (-15%)',   formula: 'PV_Final × 0.85' },
                      { col: 'Descuentos', formula: 'PV_Final × (1 − Nivel%)' },
                      { col: 'COSTO REAL', formula: 'ARS × (1−Desc) × TC_Actual + Flete' },
                      { col: 'G% PV',      formula: '(PV_Final − Costo) / Costo' },
                      { col: 'P. MAYOR',   formula: 'Costo × (1 + Margen_Mayoreo)' },
                      { col: 'G% MAYOR',   formula: '(P.Mayor − Costo) / Costo' },
                    ].map(({ col, formula }) => (
                      <div key={col} style={{
                        background: 'var(--mcb-background)',
                        borderRadius: 8,
                        padding: '0.5rem 0.75rem',
                        border: '1px solid var(--mcb-border)',
                      }}>
                        <div style={{ fontWeight: 800, fontSize: '0.65rem', color: 'var(--mcb-primary)', textTransform: 'uppercase', marginBottom: 2 }}>{col}</div>
                        <div style={{ fontFamily: 'var(--mcb-font-mono)', fontSize: '0.68rem', color: 'var(--mcb-foreground)' }}>{formula}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Desglose de fila seleccionada */}
                {activeRow ? (
                  <div style={{ borderTop: '2px solid var(--mcb-accent)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                    <p style={{ fontFamily: 'var(--mcb-font-display)', fontSize: '1rem', color: 'var(--mcb-accent)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                      🔢 Desglose — ARS {activeRow.ars.toLocaleString('es-BO')}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.5rem' }}>
                      {[
                        { col: 'D BASE',     expr: `(${activeRow.ars} × (1−${(descActual*100).toFixed(0)}%) × ${params.tcf} + ${params.flet}) × (1+${(margActual*100).toFixed(0)}%)`, val: activeRow.D.toFixed(4) },
                        { col: 'E RDND',     expr: `round(${activeRow.D.toFixed(2)} / 5) × 5`, val: activeRow.E },
                        { col: 'F ×0.65',   expr: `${activeRow.E} × 0.65`, val: activeRow.F.toFixed(4) },
                        { col: 'G PV',       expr: `round(${activeRow.F.toFixed(2)} / 5) × 5`, val: `BS ${activeRow.G_PV}` },
                        { col: 'N2 (-10%)',   expr: `${activeRow.pvFinal} × 0.90`, val: `BS ${activeRow.precioN2.toFixed(2)}` },
                        { col: 'PV Final',   expr: activeRow.pvManual ? `Manual: BS ${activeRow.pvManual}` : `Auto (G PV): BS ${activeRow.G_PV}`, val: `BS ${activeRow.pvFinal}` },
                        { col: 'COSTO REAL', expr: `${activeRow.ars} × (1−${(descActual*100).toFixed(0)}%) × ${params.tca} + ${params.flet}`, val: `BS ${activeRow.costoReal.toFixed(4)}` },
                        { col: 'G% PV',      expr: `(${activeRow.pvFinal} − ${activeRow.costoReal.toFixed(2)}) / ${activeRow.costoReal.toFixed(2)}`, val: `${(activeRow.gPV*100).toFixed(2)}%` },
                        { col: 'P. MAYOR',   expr: `${activeRow.costoReal.toFixed(2)} × (1 + ${(margenMayoreoActual*100).toFixed(0)}%)`, val: `BS ${activeRow.pMayor.toFixed(2)}` },
                        { col: 'G% MAYOR',   expr: `(${activeRow.pMayor.toFixed(2)} − ${activeRow.costoReal.toFixed(2)}) / ${activeRow.costoReal.toFixed(2)}`, val: `${(activeRow.gMayor*100).toFixed(2)}%` },
                      ].map(({ col, expr, val }) => (
                        <div key={col} style={{
                          background: 'hsla(28,90%,52%,0.05)',
                          borderRadius: 8,
                          padding: '0.5rem 0.75rem',
                          border: '1px solid hsla(28,90%,52%,0.2)',
                        }}>
                          <div style={{ fontWeight: 800, fontSize: '0.65rem', color: 'var(--mcb-accent)', textTransform: 'uppercase', marginBottom: 2 }}>{col}</div>
                          <div style={{ fontFamily: 'var(--mcb-font-mono)', fontSize: '0.65rem', color: 'var(--mcb-muted)', marginBottom: 4 }}>{expr}</div>
                          <div style={{ fontFamily: 'var(--mcb-font-mono)', fontSize: '0.85rem', fontWeight: 800, color: 'var(--mcb-primary)' }}>= {val}</div>
                        </div>
                      ))}
                    </div>
                    <p style={{ marginTop: '0.5rem', fontSize: '0.68rem', color: 'var(--mcb-muted)' }}>Hacé clic en otra fila para ver su desglose.</p>
                  </div>
                ) : (
                  <p style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--mcb-muted)', textAlign: 'center', padding: '0.5rem', fontStyle: 'italic' }}>
                    👆 Hacé clic en cualquier fila de la tabla para ver el desglose de cálculo con valores reales.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Estadísticas finales */}
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--mcb-muted)', alignSelf: 'center' }}>
              {rows.length} precios · {curEd} · Dto. {((descActual || 0) * 100).toFixed(0)}%
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
