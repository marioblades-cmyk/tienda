import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import { ChevronDown, ChevronRight, Download, Filter, Eye, EyeOff, FileText, Plus, Database } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function AdminConsolidatedView({ sellerIdFilter = null }) {
    const [semanas, setSemanas] = useState([]);
    const [selectedSemana, setSelectedSemana] = useState('');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedEditoriales, setExpandedEditoriales] = useState({});
    const [showOnlyWithOrders, setShowOnlyWithOrders] = useState(true);
    const [editorialFilter, setEditorialFilter] = useState('');

    const EDITORIAL_DTOS = {
        'Ivrea': 35,
        'Ovnipress': 30,
        'Panini-Utopia': 20,
        'Penguin': 35,
        'Planeta': 35,
        'Deux-PopFiction': 40,
        'Hotel de las Ideas': 40,
        'V&R': 35,
        'Otras': 35,
        'Merchandising': 0
    };

    // Fixed editorials for Summary section
    const EDITORIALES = [
        'Ivrea', 'Ovnipress', 'Panini-Utopia', 'Penguin', 'Planeta',
        'Deux-PopFiction', 'Hotel de las Ideas', 'V&R', 'Otras', 'Merchandising'
    ];

    useEffect(() => {
        fetchSemanas();
    }, []);

    useEffect(() => {
        if (selectedSemana) fetchConsolidado();
    }, [selectedSemana]);

    const fetchSemanas = async () => {
        const { data } = await supabase.from('semanas').select('id, nombre').order('created_at', { ascending: false });
        if (data?.length) {
            setSemanas(data);
            setSelectedSemana(data[0].id);
        }
    };

    const fetchConsolidado = async () => {
        setLoading(true);
        // Note: We use the consolidated view from our SQL schema
        const { data, error } = await supabase
            .from('consolidado_detailed') // This is a view that includes vendor names as columns or aggregated
            .select('*')
        // This is a simplification; in a real app, we might join pedido_items with pedidos
        // For now, let's assume we fetch all items for this week and process them in JS
        // to handle dynamic vendor columns

        // FETCH RAW DATA AND AGGREGATE IN JS FOR HIGHER FLEXIBILITY
        let query = supabase
            .from('pedido_items')
            .select('*, pedido:pedidos!inner(vendedor_nombre, tipo, semana_id, vendedor_id)')
            .eq('pedido.semana_id', selectedSemana);

        if (sellerIdFilter) {
            query = query.eq('pedido.vendedor_id', sellerIdFilter);
        }

        const { data: rawItems, error: itemsError } = await query;

        if (itemsError) console.error(itemsError);
        else setItems(rawItems || []);
        setLoading(false);
    };

    // Process data for tables
    const { summaryData, detailData, vendors, tiendaVendors, fileCards } = useMemo(() => {
        const vendorsSet = new Set();
        const tiendaVendorsSet = new Set();
        const editorialSummary = {};
        const editorialDetails = {};

        // Initialize summary
        EDITORIALES.forEach(ed => {
            editorialSummary[ed] = { vendors: {}, tiendaVendors: {}, subtotal: 0, dto: EDITORIAL_DTOS[ed] || 35, total: 0 };
        });

        items.forEach(item => {
            const vName = item.pedido.vendedor_nombre || 'Desconocido';
            const isTienda = item.pedido.tipo === 'tienda';
            const editorial = item.editorial || 'Otras';
            const amount = (item.precio || 0) * (item.cantidad || 0);

            if (isTienda) tiendaVendorsSet.add(vName);
            else vendorsSet.add(vName);

            // Aggregating for Summary Table
            if (!editorialSummary[editorial]) editorialSummary[editorial] = { vendors: {}, tiendaVendors: {}, subtotal: 0, dto: 35, total: 0 };

            if (isTienda) {
                editorialSummary[editorial].tiendaVendors[vName] = (editorialSummary[editorial].tiendaVendors[vName] || 0) + amount;
            } else {
                editorialSummary[editorial].vendors[vName] = (editorialSummary[editorial].vendors[vName] || 0) + amount;
            }
            editorialSummary[editorial].subtotal += amount;

            // Aggregating for Detail Table
            const detailKey = `${item.editorial}|${item.titulo}|${item.isbn_raw}`;
            if (!editorialDetails[editorial]) editorialDetails[editorial] = {};
            if (!editorialDetails[editorial][detailKey]) {
                editorialDetails[editorial][detailKey] = {
                    titulo: item.titulo,
                    ean: item.isbn_raw,
                    precio: item.precio,
                    vendorQty: {},
                    tiendaQty: {},
                    totalQty: 0,
                    subtotal: 0
                };
            }

            if (isTienda) {
                editorialDetails[editorial][detailKey].tiendaQty[vName] = (editorialDetails[editorial][detailKey].tiendaQty[vName] || 0) + item.cantidad;
            } else {
                editorialDetails[editorial][detailKey].vendorQty[vName] = (editorialDetails[editorial][detailKey].vendorQty[vName] || 0) + item.cantidad;
            }
            editorialDetails[editorial][detailKey].totalQty += item.cantidad;
            editorialDetails[editorial][detailKey].subtotal += amount;
        });

        // Calculate totals for summary
        Object.keys(editorialSummary).forEach(ed => {
            const s = editorialSummary[ed];
            s.total = s.subtotal * (1 - (s.dto / 100));
        });

        // Calculate figures for cards
        const fileCards = [];
        // Extract personal vendors for cards
        vendorsSet.forEach(v => {
            let vTotal = 0;
            let vItems = 0;
            items.forEach(item => {
                if (item.pedido.vendedor_nombre === v && item.pedido.tipo !== 'tienda') {
                    const amount = (item.precio || 0) * (item.cantidad || 0);
                    const editorial = item.editorial || 'Otras';
                    const dto = EDITORIAL_DTOS[editorial] || 35;
                    vTotal += amount * (1 - (dto / 100));
                    vItems += item.cantidad || 0;
                }
            });
            fileCards.push({ name: v, total: Math.round(vTotal), items: vItems, type: 'vendedor' });
        });

        // Extract tienda vendors for cards
        tiendaVendorsSet.forEach(v => {
            let tiendaTotal = 0;
            let tiendaItems = 0;
            items.forEach(item => {
                if (item.pedido.vendedor_nombre === v && item.pedido.tipo === 'tienda') {
                    const amount = (item.precio || 0) * (item.cantidad || 0);
                    const editorial = item.editorial || 'Otras';
                    const dto = EDITORIAL_DTOS[editorial] || 35;
                    tiendaTotal += amount * (1 - (dto / 100));
                    tiendaItems += item.cantidad || 0;
                }
            });
            fileCards.push({ name: `TIENDA - ${v}`, total: Math.round(tiendaTotal), items: tiendaItems, type: 'tienda' });
        });

        return {
            summaryData: editorialSummary,
            detailData: editorialDetails,
            vendors: Array.from(vendorsSet).sort(),
            tiendaVendors: Array.from(tiendaVendorsSet).sort(),
            fileCards
        };
    }, [items]);

    const exportExcel = () => {
        const wb = XLSX.utils.book_new();

        // Summary Sheet
        const summaryRows = [['Editorial', ...vendors, ...tiendaVendors.map(v => `T. ${v}`), 'Subtotal', 'Dto %', 'Total']];
        EDITORIALES.forEach(ed => {
            const s = summaryData[ed];
            summaryRows.push([
                ed,
                ...vendors.map(v => s.vendors[v] || 0),
                ...tiendaVendors.map(v => s.tiendaVendors[v] || 0),
                s.subtotal,
                s.dto,
                s.total
            ]);
        });

        summaryRows.push([]); // Espacio antes del total

        const totalFooterRow = ['TOTAL (C/ DTO)'];
        vendors.forEach(v => {
            totalFooterRow.push(EDITORIALES.reduce((sum, ed) => sum + ((summaryData[ed].vendors[v] || 0) * (1 - summaryData[ed].dto / 100)), 0));
        });
        tiendaVendors.forEach(v => {
            totalFooterRow.push(EDITORIALES.reduce((sum, ed) => sum + ((summaryData[ed].tiendaVendors[v] || 0) * (1 - summaryData[ed].dto / 100)), 0));
        });
        totalFooterRow.push(EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].subtotal, 0));
        totalFooterRow.push('');
        totalFooterRow.push(EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].total, 0));

        summaryRows.push(totalFooterRow);

        const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Resumen Editorial');

        // Detail Sheet
        const detailRows = [['Editorial', 'Título', 'EAN', 'Precio', ...vendors, ...tiendaVendors.map(v => `T. ${v}`), 'Total Unidades', 'Subtotal $']];
        Object.entries(detailData).forEach(([ed, products]) => {
            Object.values(products).forEach(p => {
                detailRows.push([
                    ed, p.titulo, p.ean, p.precio,
                    ...vendors.map(v => p.vendorQty[v] || 0),
                    ...tiendaVendors.map(v => p.tiendaQty[v] || 0),
                    p.totalQty, p.subtotal
                ]);
            });
        });
        const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
        XLSX.utils.book_append_sheet(wb, wsDetail, 'Detalle Títulos');

        XLSX.writeFile(wb, `Consolidado_${semanas.find(s => s.id === selectedSemana)?.nombre}.xlsx`);
    };

    const toggleEditorial = (ed) => {
        setExpandedEditoriales(prev => ({ ...prev, [ed]: !prev[ed] }));
    };

    if (loading) return <div className="py-12 flex justify-center"><div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin"></div></div>;

    const grandTotal = EDITORIALES.reduce((sum, ed) => sum + (summaryData[ed]?.total || 0), 0);

    return (
        <div className="space-y-6">
            {/* NEW PREMIUM HEADER */}
            <div className="bg-text text-white p-6 rounded-2xl shadow-2xl overflow-hidden relative group border border-white/5">
                <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full -mr-32 -mt-32 blur-3xl group-hover:bg-primary/20 transition-all duration-700"></div>
                <div className="relative flex flex-wrap items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-3 text-white/60 text-xs font-bold tracking-widest uppercase mb-1">
                            <Database size={14} className="text-primary" />
                            <span>GESTIÓN DE PEDIDOS</span>
                        </div>
                        <h3 className="text-3xl font-display uppercase tracking-tight">
                            ENTELEQUIA <span className="text-primary">—</span> CONSOLIDACIÓN
                        </h3>
                        <p className="text-white/40 text-xs mt-1 font-mono uppercase tracking-widest">
                            {vendors.length} Vendedores • {items.reduce((sum, i) => sum + i.cantidad, 0)} Items Cargados
                        </p>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                        <div className="text-xs text-white/40 font-bold uppercase tracking-widest">Total Consolidado (c/dto)</div>
                        <div className="text-5xl font-display text-primary leading-none">
                            ${grandTotal.toLocaleString()}
                        </div>
                    </div>
                </div>
            </div>

            {/* ACTION BAR & STATUS CARDS */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                <div className="lg:col-span-1 space-y-4">
                    <div className="glass p-4 rounded-2xl border border-border/40 shadow-sm">
                        <h4 className="text-xs font-bold text-muted uppercase tracking-widest mb-4 flex items-center gap-2">
                            <Filter size={12} className="text-primary" /> CONTROLES
                        </h4>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-bold text-muted/60 uppercase block mb-1">Semana Activa</label>
                                <select
                                    value={selectedSemana}
                                    onChange={e => setSelectedSemana(e.target.value)}
                                    className="w-full bg-background border border-border/60 p-2.5 rounded-xl text-xs font-semibold focus:border-primary outline-none transition-all"
                                >
                                    {semanas.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                                </select>
                            </div>
                            <button
                                onClick={exportExcel}
                                className="w-full flex items-center justify-center gap-2 bg-text text-white p-3 rounded-xl text-xs font-bold hover:bg-black transition-all shadow-lg active:scale-95"
                            >
                                <Download size={16} className="text-primary" /> EXPORTAR CONSOLIDADO
                            </button>
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-3">
                    <div className="glass p-5 rounded-2xl border border-border/40 shadow-sm relative overflow-hidden">
                        <div className="flex items-center justify-between mb-4">
                            <h4 className="text-xs font-bold text-muted uppercase tracking-widest flex items-center gap-2">
                                <FileText size={12} className="text-primary" /> Archivos en esta semana
                            </h4>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={showOnlyWithOrders}
                                        onChange={e => setShowOnlyWithOrders(e.target.checked)}
                                        className="accent-primary"
                                        id="onlyOrders"
                                    />
                                    <label htmlFor="onlyOrders" className="text-xs font-bold text-muted/60 cursor-pointer">Solo con pedidos</label>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[160px] overflow-y-auto pr-2 custom-scrollbar">
                            {fileCards.map((card, idx) => (
                                <div key={idx} className="bg-white/5 border border-border/40 p-3 rounded-xl flex items-center justify-between group hover:border-primary/40 transition-all">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.type === 'tienda' ? 'bg-secondary/20 text-secondary' : 'bg-primary/20 text-primary'}`}>
                                            <FileText size={16} />
                                        </div>
                                        <div>
                                            <div className="text-xs font-bold text-text truncate max-w-[200px]">{card.name}</div>
                                            <div className="text-xs text-muted font-medium">{card.items} productos cargados</div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs text-muted/50 font-bold uppercase tracking-widest leading-none mb-1">Total</div>
                                        <div className={`text-sm font-bold ${card.type === 'tienda' ? 'text-secondary' : 'text-primary'}`}>
                                            ${card.total.toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* SECTION 1: RESUMEN POR EDITORIAL */}
            <section>
                <div className="overflow-hidden border border-border/40 rounded-2xl shadow-xl glass">
                    <div className="bg-text text-white p-4 flex items-center justify-between border-b border-white/10">
                        <div className="flex items-center gap-2">
                            <Plus size={16} className="text-primary" />
                            <h4 className="text-xs font-bold uppercase tracking-[0.2em] mb-0">Resumen por Editorial</h4>
                        </div>
                        <div className="flex items-center gap-2">
                            <Filter size={14} className="text-white/40" />
                            <select
                                value={editorialFilter}
                                onChange={e => setEditorialFilter(e.target.value)}
                                className="bg-transparent border-none text-xs font-bold uppercase tracking-widest text-white/60 focus:ring-0 outline-none cursor-pointer hover:text-primary transition-colors"
                            >
                                <option value="" className="bg-text text-white">Todas las editoriales</option>
                                {EDITORIALES.map(ed => <option key={ed} value={ed} className="bg-text text-white">{ed}</option>)}
                            </select>
                        </div>
                    </div>
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="text-xs uppercase tracking-widest bg-white/5">
                            <tr className="border-b border-border/40">
                                <th className="p-4 font-bold text-muted w-1/4">EDITORIAL</th>
                                {vendors.map(v => <th key={v} className="p-4 font-bold text-center">{v}</th>)}
                                {tiendaVendors.map(v => <th key={`t-${v}`} className="p-4 font-bold text-center text-secondary">T. {v}</th>)}
                                <th className="p-4 font-bold text-center">SUBTOTAL</th>
                                <th className="p-4 font-bold text-center text-muted/40">DTO %</th>
                                <th className="p-4 font-bold text-center text-primary">TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {EDITORIALES.filter(ed => !editorialFilter || ed === editorialFilter).map(ed => {
                                const s = summaryData[ed];
                                if (showOnlyWithOrders && s.subtotal === 0) return null;
                                return (
                                    <tr key={ed} className="border-b border-border hover:bg-primary/5 transition-colors text-[13px]">
                                        <td className="p-4 font-bold text-text">{ed}</td>
                                        {vendors.map(v => (
                                            <td key={v} className="p-4 text-center text-muted-2 font-medium">
                                                {s.vendors[v] ? `$${s.vendors[v].toLocaleString()}` : '—'}
                                            </td>
                                        ))}
                                        {tiendaVendors.map(v => (
                                            <td key={`t-${v}`} className="p-4 text-center text-secondary font-bold bg-secondary/5">
                                                {s.tiendaVendors[v] ? `$${s.tiendaVendors[v].toLocaleString()}` : '—'}
                                            </td>
                                        ))}
                                        <td className="p-4 text-center text-text font-semibold">${s.subtotal.toLocaleString()}</td>
                                        <td className="p-4 text-center text-muted/60">{s.dto}%</td>
                                        <td className="p-4 text-center font-bold text-primary bg-primary/5 border-l border-primary/10">${s.total.toLocaleString()}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-text text-white">
                            <tr className="font-bold text-[13px]">
                                <td className="p-6">TOTAL (C/DTO) <span className="text-[10px] text-primary block mt-1">Neto a pagar</span></td>
                                {vendors.map(v => {
                                    const totalV = EDITORIALES.reduce((sum, ed) => {
                                        const gross = summaryData[ed].vendors[v] || 0;
                                        const dto = summaryData[ed].dto / 100;
                                        return sum + (gross * (1 - dto));
                                    }, 0);
                                    return <td key={v} className="p-6 text-center text-primary-content">${Math.round(totalV).toLocaleString()}</td>;
                                })}
                                {tiendaVendors.map(v => {
                                    const totalTV = EDITORIALES.reduce((sum, ed) => {
                                        const gross = summaryData[ed].tiendaVendors[v] || 0;
                                        const dto = summaryData[ed].dto / 100;
                                        return sum + (gross * (1 - dto));
                                    }, 0);
                                    return <td key={`t-${v}`} className="p-6 text-center text-secondary bg-white/5 border-l border-secondary/10">${Math.round(totalTV).toLocaleString()}</td>;
                                })}
                                <td className="p-6 text-center border-l border-white/10">
                                    ${EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].subtotal, 0).toLocaleString()}
                                </td>
                                <td></td>
                                <td className="p-6 text-center text-3xl text-primary font-display tracking-tighter bg-white/5 border-l border-white/10">
                                    <span className="text-xs align-top mr-1 opacity-50">$</span>
                                    {EDITORIALES.reduce((sum, ed) => sum + summaryData[ed].total, 0).toLocaleString()}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </section>

            {/* SECTION 2: DETALLE POR TITULO */}
            <section>
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-1 bg-primary rounded-full"></div>
                    <h4 className="text-xs font-bold text-muted uppercase tracking-[0.3em] opacity-60">Detalle por Título</h4>
                </div>
                <div className="space-y-4">
                    {EDITORIALES.filter(ed => !editorialFilter || ed === editorialFilter).map(ed => {
                        const products = Object.values(detailData[ed] || {});
                        const filteredProducts = showOnlyWithOrders ? products.filter(p => p.totalQty > 0) : products;
                        if (filteredProducts.length === 0) return null;

                        const isOpen = expandedEditoriales[ed];

                        return (
                            <div key={ed} className="glass rounded-2xl overflow-hidden border border-border/40 shadow-sm hover:border-primary/20 transition-all">
                                <button
                                    onClick={() => toggleEditorial(ed)}
                                    className={`w-full flex items-center justify-between p-4 transition-all ${isOpen ? 'bg-text text-white' : 'bg-surface/50 hover:bg-surface'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1 rounded-lg ${isOpen ? 'bg-primary/20 text-primary' : 'bg-border text-muted'}`}>
                                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                        </div>
                                        <span className={`font-bold uppercase tracking-widest text-xs ${isOpen ? 'text-white' : 'text-text'}`}>{ed}</span>
                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${isOpen ? 'bg-white/10 text-white/60' : 'bg-border text-muted'}`}>
                                            {filteredProducts.length} PRODUCTOS
                                        </span>
                                    </div>
                                    <span className={`text-xs font-bold ${isOpen ? 'text-primary' : 'text-accent'}`}>
                                        ${summaryData[ed].subtotal.toLocaleString()}
                                    </span>
                                </button>

                                {isOpen && (
                                    <div className="overflow-x-auto border-t border-border/20">
                                        <table className="w-full text-left border-collapse text-[12px]">
                                            <thead className="bg-[#f8f9fa] border-b border-border/40">
                                                <tr className="text-[11px] font-bold uppercase tracking-widest text-muted/60">
                                                    <th className="p-3 w-1/3">TITULO</th>
                                                    <th className="p-3">EAN</th>
                                                    <th className="p-3 text-center">PRECIO</th>
                                                    {vendors.map(v => <th key={v} className="p-3 text-center uppercase tracking-tighter">{v}</th>)}
                                                    {tiendaVendors.map(v => <th key={`t-${v}`} className="p-3 text-center text-secondary uppercase tracking-tighter">T. {v}</th>)}
                                                    <th className="p-3 text-center">TOTAL</th>
                                                    <th className="p-3 text-right text-primary">SUBTOTAL</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredProducts.map(p => (
                                                    <tr key={p.titulo + p.ean} className="border-b border-border hover:bg-primary/5 transition-colors">
                                                        <td className="p-3 font-semibold text-text">{p.titulo}</td>
                                                        <td className="p-3 text-muted font-mono text-xs">{p.ean}</td>
                                                        <td className="p-3 text-center font-medium">${p.precio?.toLocaleString()}</td>
                                                        {vendors.map(v => (
                                                            <td key={v} className={`p-3 text-center ${p.vendorQty[v] ? 'text-text font-bold' : 'text-muted/20'}`}>
                                                                {p.vendorQty[v] || '—'}
                                                            </td>
                                                        ))}
                                                        {tiendaVendors.map(v => (
                                                            <td key={`t-${v}`} className={`p-3 text-center border-l border-secondary/10 ${p.tiendaQty[v] ? 'text-secondary font-bold bg-secondary/5' : 'text-muted/20'}`}>
                                                                {p.tiendaQty[v] || '—'}
                                                            </td>
                                                        ))}
                                                        <td className="p-3 text-center font-bold bg-background/30 border-l border-border">{p.totalQty}</td>
                                                        <td className="p-3 text-right font-bold text-primary">${p.subtotal.toLocaleString()}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
