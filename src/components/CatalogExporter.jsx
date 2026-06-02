import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, Download, Check, Image as ImageIcon, LayoutGrid, List, FileSpreadsheet, TrendingUp } from 'lucide-react';
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

const FIELDS = [
    { id: 'imagen', label: 'Imagen de Portada', icon: ImageIcon },
    { id: 'titulo', label: 'Título del Producto', icon: null, required: true },
    { id: 'editorial', label: 'Editorial', icon: null },
    { id: 'categoria', label: 'Categoría', icon: null },
    { id: 'precio', label: 'Precio PVP (Bs)', icon: null },
    { id: 'stock', label: 'Stock Físico', icon: null },
    { id: 'ean', label: 'Código EAN/ISBN', icon: null },
];

export default function CatalogExporter({ isOpen, onClose, data }) {
    const [selectedFields, setSelectedFields] = useState(new Set(['imagen', 'titulo', 'editorial', 'precio', 'stock']));
    const [format, setFormat] = useState('pdf'); // 'pdf' | 'excel'
    const [pdfLayout, setPdfLayout] = useState('grid'); // 'grid' | 'list'
    const [onlyInStock, setOnlyInStock] = useState(false);
    const [useProxPrices, setUseProxPrices] = useState(false);
    const [tipoPrice, setTipoPrice] = useState('mayoreo'); // 'mayoreo' | 'retail'
    const [discount, setDiscount] = useState(0);
    const [selectedEditoriales, setSelectedEditoriales] = useState(new Set());
    const [isGenerating, setIsGenerating] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0 });

    // Obtener editoriales únicas de los datos recibidos
    const availableEditoriales = React.useMemo(() => {
        const eds = [...new Set(data.map(item => item.editorial))].filter(Boolean).sort();
        return eds;
    }, [data]);

    // Inicializar editoriales seleccionadas si el Set está vacío
    React.useEffect(() => {
        if (selectedEditoriales.size === 0 && availableEditoriales.length > 0) {
            setSelectedEditoriales(new Set(availableEditoriales));
        }
    }, [availableEditoriales]);

    const toggleField = (id) => {
        if (id === 'titulo') return; // Título es obligatorio
        const next = new Set(selectedFields);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedFields(next);
    };

    const getBase64ImageFromUrl = async (url) => {
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.error("Error cargando imagen:", url, e);
            return null;
        }
    };

    const handleExport = async () => {
        let exportData = data;
        
        // Filtrar por Stock
        if (onlyInStock) {
            exportData = exportData.filter(item => (item.stock_fisico || 0) > 0);
        }

        // Filtrar por Editoriales seleccionadas
        if (selectedEditoriales.size > 0 && selectedEditoriales.size < availableEditoriales.length) {
            exportData = exportData.filter(item => selectedEditoriales.has(item.editorial));
        }

        setIsGenerating(true);
        setProgress({ current: 0, total: exportData.length });
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `catalogo_${dateStr}`;

        try {
            if (format === 'excel') {
                await exportToExcel(fileName, exportData);
            } else {
                // Para PDF masivos con imágenes, avisar si es muy grande
                if (selectedFields.has('imagen') && exportData.length > 800) {
                    if (!window.confirm(`⚠️ Estás intentando generar un PDF con imágenes para ${exportData.length} productos. Esto puede tardar varios minutos y saturar la memoria de tu navegador. \n\n¿Deseas continuar de todas formas? (Se recomienda filtrar por editorial primero)`)) {
                        setIsGenerating(false);
                        return;
                    }
                }
                await exportToPDF(fileName, exportData);
            }
        } catch (error) {
            console.error("Error en exportación:", error);
            alert("Hubo un error al generar el archivo.");
        } finally {
            setIsGenerating(false);
        }
    };

    const exportToExcel = async (fileName, exportData) => {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Catálogo');

        // Logo
        try {
            const logoBase64 = await getBase64ImageFromUrl('/logo.png');
            if (logoBase64) {
                const logoId = workbook.addImage({
                    base64: logoBase64,
                    extension: 'png',
                });
                worksheet.addImage(logoId, {
                    tl: { col: 0, row: 0 },
                    ext: { width: 120, height: 60 }
                });
                worksheet.getRow(1).height = 50;
            }
        } catch (e) { console.warn("No se pudo cargar el logo para Excel"); }

        // Definir Columnas
        const columns = [];
        if (selectedFields.has('titulo')) columns.push({ header: 'TÍTULO', key: 'titulo', width: 40 });
        if (selectedFields.has('editorial')) columns.push({ header: 'EDITORIAL', key: 'editorial', width: 20 });
        if (selectedFields.has('categoria')) columns.push({ header: 'CATEGORÍA', key: 'categoria', width: 20 });
        if (selectedFields.has('precio')) {
            columns.push({ header: tipoPrice === 'mayoreo' ? 'PRECIO MAYORISTA (Bs)' : 'PRECIO RETAIL -10% (Bs)', key: 'precio_orig', width: 18 });
            if (discount > 0) {
                columns.push({ header: `PRECIO DTO (${discount}%)`, key: 'precio_dto', width: 18 });
            }
        }
        if (selectedFields.has('stock')) columns.push({ header: 'STOCK', key: 'stock', width: 15 });
        if (selectedFields.has('ean')) columns.push({ header: 'EAN/ISBN', key: 'ean', width: 20 });

        worksheet.columns = columns;

        // Estilo de encabezados (Fila 2 si hay logo, o fila 1)
        const headerRowNumber = 2;
        const headerRow = worksheet.getRow(headerRowNumber);
        headerRow.values = columns.map(c => c.header);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2D42' } }; // Azul oscuro de la app
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

        // Añadir Datos
        exportData.forEach((item, index) => {
            const rowData = {};
            if (selectedFields.has('titulo')) rowData.titulo = item.titulo;
            if (selectedFields.has('editorial')) rowData.editorial = item.editorial;
            if (selectedFields.has('categoria')) rowData.categoria = item.categoria;
            if (selectedFields.has('precio')) {
                const base = tipoPrice === 'mayoreo'
                    ? (item.precio_mayoreo_bs || item.precio_venta_bs)
                    : (item.precio_n2_bs || item.precio_venta_bs * 0.90); // retail ya con 10%
                const p = (useProxPrices
                    ? (tipoPrice === 'mayoreo'
                        ? (item.precio_mayoreo_bs_prox || item.precio_mayoreo_bs)
                        : (item.precio_venta_bs_prox || item.precio_venta_bs) * 0.90)
                    : base) || item.precio_tapa || 0;
                rowData.precio_orig = p;
            }
            
            if (selectedFields.has('stock')) {
                const stock = parseInt(item.stock_fisico || 0, 10);
                if (stock > 0) {
                    rowData.stock = `EN STOCK`;
                } else {
                    rowData.stock = 'BAJO PEDIDO';
                }
            }

            if (selectedFields.has('ean')) rowData.ean = item.ean_oficial || item.ean_interno;

            const row = worksheet.addRow(rowData);
            
            // Estilos por estado de stock
            if (selectedFields.has('stock')) {
                const cell = row.getCell('stock');
                const isAvailable = rowData.stock.includes('EN STOCK');
                cell.font = { 
                    bold: true, 
                    color: { argb: isAvailable ? 'FF16A34A' : 'FF2563EB' } 
                };
            }

            // Tachar precio original si hay descuento
            if (discount > 0 && selectedFields.has('precio')) {
                const cell = row.getCell('precio_orig');
                cell.font = { strike: true, color: { argb: 'FF94A3B8' } };
            }
            
            // Colores alternos
            if (index % 2 !== 0) {
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            }
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    const exportToPDF = async (fileName, exportData) => {
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4'
        });

        const pageWidth = doc.internal.pageSize.getWidth();
        let y = 15;

        // Header Branding
        try {
            const logoBase64 = await getBase64ImageFromUrl('/logo.png');
            if (logoBase64) {
                doc.addImage(logoBase64, 'PNG', 15, y, 40, 20);
                y += 25;
            }
        } catch (e) {}

        doc.setFontSize(22);
        doc.setTextColor(26, 45, 66); // #1a2d42
        doc.text("CATÁLOGO DE PRODUCTOS", 15, y);
        y += 10;
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Fecha de generación: ${new Date().toLocaleDateString()}`, 15, y);
        y += 15;

        // Configuración de Cuadrícula (Visual)
        const margin = 10; // Margen menor para ganar espacio
        const colGap = 3;
        const rowGap = 3;
        const itemsPerRow = pdfLayout === 'grid' ? 3 : 3; // 3 columnas para ambos, pero lista es más baja
        const colWidth = (pageWidth - (margin * 2) - (colGap * (itemsPerRow - 1))) / itemsPerRow;
        const rowHeight = pdfLayout === 'grid' ? 85 : 22; // Lista ultra-compacta

        let currentX = margin;
        let itemsProcessed = 0;

        // Función para procesar imágenes en lotes para no bloquear el hilo principal
        const BATCH_SIZE = 10;
        
        for (let i = 0; i < exportData.length; i += BATCH_SIZE) {
            const batch = exportData.slice(i, i + BATCH_SIZE);
            
            // Descargar imágenes del lote en paralelo
            const images = await Promise.all(batch.map(async (item) => {
                if (selectedFields.has('imagen') && item.imagen_url) {
                    return await getBase64ImageFromUrl(item.imagen_url);
                }
                return null;
            }));

            for (let j = 0; j < batch.length; j++) {
                const item = batch[j];
                const imgBase64 = images[j];

                if (y + rowHeight > 280) {
                    doc.addPage();
                    y = 20;
                    currentX = margin;
                }

                // Fondo de la tarjeta
                doc.setDrawColor(240);
                doc.rect(currentX, y, colWidth, rowHeight);

                // Imagen
                if (imgBase64) {
                    try {
                        if (pdfLayout === 'grid') {
                            doc.addImage(imgBase64, 'JPEG', currentX + 2, y + 2, colWidth - 4, 55, undefined, 'FAST');
                        } else {
                            // Miniatura ultra-pequeña
                            doc.addImage(imgBase64, 'JPEG', currentX + 1, y + 1, 12, 17, undefined, 'FAST');
                        }
                    } catch (e) {}
                }

                // Textos
                let textX = pdfLayout === 'grid' ? currentX + 2 : currentX + 14;
                let textY = pdfLayout === 'grid' ? y + 62 : y + 4;
                
                doc.setTextColor(26, 45, 66);
                doc.setFont("helvetica", "bold");
                doc.setFontSize(pdfLayout === 'grid' ? 8 : 6); // Fuente más pequeña
                
                const titleWidth = pdfLayout === 'grid' ? colWidth - 4 : colWidth - 15;
                const titleLines = doc.splitTextToSize(item.titulo || 'Sin título', titleWidth);
                doc.text(titleLines.slice(0, 2), textX, textY);
                
                textY += pdfLayout === 'grid' ? 7 : 5;
                doc.setFont("helvetica", "normal");
                doc.setFontSize(pdfLayout === 'grid' ? 7 : 5.5);
                doc.setTextColor(100);
                
                if (selectedFields.has('editorial')) {
                    doc.text(item.editorial || '-', textX, textY);
                    textY += pdfLayout === 'grid' ? 3.5 : 2.5;
                }

                if (selectedFields.has('precio')) {
                    const baseP = tipoPrice === 'mayoreo'
                        ? (item.precio_mayoreo_bs || item.precio_venta_bs)
                        : (item.precio_n2_bs || item.precio_venta_bs * 0.90); // retail con 10%
                    const pOrig = (useProxPrices
                        ? (tipoPrice === 'mayoreo'
                            ? (item.precio_mayoreo_bs_prox || item.precio_mayoreo_bs)
                            : (item.precio_venta_bs_prox || item.precio_venta_bs) * 0.90)
                        : baseP) || item.precio_tapa || 0;
                    if (discount > 0) {
                        const pDto = (pOrig * (1 - discount / 100)).toFixed(2);
                        
                        // Precio Original Tachado
                        doc.setTextColor(150);
                        doc.setFontSize(pdfLayout === 'grid' ? 6 : 5);
                        const origText = `Bs. ${pOrig}`;
                        doc.text(origText, textX, textY);
                        
                        // Línea de tachado
                        const textWidth = doc.getTextWidth(origText);
                        doc.setDrawColor(150);
                        doc.line(textX, textY - 0.6, textX + textWidth, textY - 0.6);
                        
                        // Precio Descuento
                        doc.setTextColor(240, 125, 42);
                        doc.setFont("helvetica", "bold");
                        doc.setFontSize(pdfLayout === 'grid' ? 8 : 6.5);
                        doc.text(`Bs. ${pDto}`, textX + textWidth + 1.5, textY);
                    } else {
                        doc.setTextColor(240, 125, 42);
                        doc.setFont("helvetica", "bold");
                        doc.text(`Bs. ${pOrig}`, textX, textY);
                    }
                    textY += pdfLayout === 'grid' ? 3.5 : 2.5;
                }

                if (selectedFields.has('stock')) {
                    const stock = parseInt(item.stock_fisico || 0, 10);
                    doc.setFont("helvetica", "bold");
                    doc.setFontSize(pdfLayout === 'grid' ? 7 : 5.5); 
                    if (stock > 0) {
                        doc.setTextColor(22, 163, 74); 
                        doc.text(`● EN STOCK`, textX, textY);
                    } else {
                        doc.setTextColor(37, 99, 235);
                        doc.text(`○ BAJO PEDIDO`, textX, textY);
                    }
                }

                itemsProcessed++;
                if (itemsProcessed % itemsPerRow === 0) {
                    currentX = margin;
                    y += rowGap + rowHeight;
                } else {
                    currentX += colWidth + colGap;
                }
            }
            
            setProgress({ current: Math.min(i + BATCH_SIZE, exportData.length), total: exportData.length });
            // Pequeño respiro para el navegador
            await new Promise(r => setTimeout(r, 10));
        }

        doc.save(`${fileName}.pdf`);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            
            <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="relative w-full max-w-2xl bg-[#1a2d42] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/5">
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Download className="text-[#f07d2a]" size={20} />
                            Generar Catálogo
                        </h2>
                        <p className="text-white/50 text-xs mt-1 font-mono uppercase tracking-widest">
                            Personaliza tu reporte de {data.length} productos
                        </p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-all">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-8 space-y-8 overflow-y-auto custom-scrollbar flex-1">
                    {/* Formato */}
                    <section>
                        <label className="text-[11px] font-bold text-[#f07d2a] uppercase tracking-[0.2em] mb-4 block">
                            1. Elegir Formato
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={() => setFormat('pdf')}
                                className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${format === 'pdf' ? 'bg-[#f07d2a]/10 border-[#f07d2a] text-white' : 'bg-white/5 border-white/5 text-white/40 hover:border-white/20'}`}
                            >
                                <div className={`p-2 rounded-lg ${format === 'pdf' ? 'bg-[#f07d2a] text-white' : 'bg-white/5'}`}>
                                    <LayoutGrid size={18} />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-sm">PDF Catálogo</div>
                                    <div className="text-[10px] opacity-60">Visual (Cuadrícula)</div>
                                </div>
                            </button>
                            <button
                                onClick={() => { setFormat('pdf'); setPdfLayout('list'); }}
                                className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${format === 'pdf' && pdfLayout === 'list' ? 'bg-[#f07d2a]/10 border-[#f07d2a] text-white' : 'bg-white/5 border-white/5 text-white/40 hover:border-white/20'}`}
                            >
                                <div className={`p-2 rounded-lg ${format === 'pdf' && pdfLayout === 'list' ? 'bg-[#f07d2a] text-white' : 'bg-white/5'}`}>
                                    <List size={18} />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-sm">PDF Lista</div>
                                    <div className="text-[10px] opacity-60">Compacto con miniaturas</div>
                                </div>
                            </button>
                            <button
                                onClick={() => setFormat('excel')}
                                className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${format === 'excel' ? 'bg-green-500/10 border-green-500 text-white' : 'bg-white/5 border-white/5 text-white/40 hover:border-white/20'}`}
                            >
                                <div className={`p-2 rounded-lg ${format === 'excel' ? 'bg-green-500 text-white' : 'bg-white/5'}`}>
                                    <FileSpreadsheet size={18} />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-sm">Excel Informativo</div>
                                    <div className="text-[10px] opacity-60">Para control interno</div>
                                </div>
                            </button>
                        </div>
                    </section>

                    {/* Descuento */}
                    <section>
                        <label className="text-[11px] font-bold text-[#f07d2a] uppercase tracking-[0.2em] mb-4 block">
                            2. Aplicar Descuento Especial
                        </label>
                        <div className="grid grid-cols-5 gap-2 bg-white/5 p-2 rounded-xl border border-white/5">
                            {[0, 5, 10, 15, 20].map(val => (
                                <button
                                    key={val}
                                    onClick={() => setDiscount(val)}
                                    className={`py-3 rounded-lg text-sm font-black transition-all ${discount === val ? 'bg-[#f07d2a] text-white shadow-lg shadow-[#f07d2a]/20' : 'text-white/40 hover:bg-white/5 hover:text-white'}`}
                                >
                                    {val === 0 ? 'SIN DTO' : `${val}%`}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Características */}
                    <section>
                        <label className="text-[11px] font-bold text-[#f07d2a] uppercase tracking-[0.2em] mb-4 block">
                            3. Características a incluir
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {FIELDS.map(field => (
                                <button
                                    key={field.id}
                                    onClick={() => toggleField(field.id)}
                                    disabled={field.required}
                                    className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${selectedFields.has(field.id) ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-transparent text-white/30 hover:bg-white/5'}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`p-1.5 rounded ${selectedFields.has(field.id) ? 'text-[#f07d2a]' : 'text-white/20'}`}>
                                            {field.icon ? <field.icon size={16} /> : <Check size={16} />}
                                        </div>
                                        <span className="text-xs font-medium">{field.label}</span>
                                    </div>
                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${selectedFields.has(field.id) ? 'bg-[#f07d2a] border-[#f07d2a]' : 'border-white/10'}`}>
                                        {selectedFields.has(field.id) && <Check size={12} className="text-white" />}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Editoriales */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <label className="text-[11px] font-bold text-[#f07d2a] uppercase tracking-[0.2em] block">
                                4. Filtrar por Editoriales
                            </label>
                            <button 
                                onClick={() => {
                                    if (selectedEditoriales.size === availableEditoriales.length) setSelectedEditoriales(new Set());
                                    else setSelectedEditoriales(new Set(availableEditoriales));
                                }}
                                className="text-[10px] text-[#f07d2a] hover:underline font-bold"
                            >
                                {selectedEditoriales.size === availableEditoriales.length ? 'DESELECCIONAR TODO' : 'SELECCIONAR TODO'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-white/5 rounded-xl border border-white/5">
                            {availableEditoriales.map(ed => (
                                <button
                                    key={ed}
                                    onClick={() => {
                                        const next = new Set(selectedEditoriales);
                                        if (next.has(ed)) next.delete(ed);
                                        else next.add(ed);
                                        setSelectedEditoriales(next);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all border ${selectedEditoriales.has(ed) ? 'bg-[#f07d2a] border-[#f07d2a] text-white' : 'bg-white/5 border-white/10 text-white/40 hover:border-white/20'}`}
                                >
                                    {ed}
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Opciones Adicionales */}
                    <section>
                        <label className="text-[11px] font-bold text-[#f07d2a] uppercase tracking-[0.2em] mb-4 block">
                            5. Opciones de Filtro
                        </label>
                        {/* Tipo de precio */}
                        <div style={{ padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: '0.5rem' }}>
                            <p style={{ fontSize: '0.65rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>Tipo de Precio</p>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {[{ id: 'mayoreo', label: 'Precio Mayorista' }, { id: 'retail', label: 'Precio PVP Retail' }].map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => { setTipoPrice(opt.id); if (opt.id === 'retail') setDiscount(10); else setDiscount(0); }}
                                        style={{
                                            flex: 1, padding: '0.5rem', borderRadius: 8, fontSize: '0.65rem', fontWeight: 800,
                                            border: tipoPrice === opt.id ? '1.5px solid #f59e0b' : '1.5px solid rgba(255,255,255,0.1)',
                                            background: tipoPrice === opt.id ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
                                            color: tipoPrice === opt.id ? '#fbbf24' : 'rgba(255,255,255,0.4)',
                                            cursor: 'pointer', transition: 'all 0.15s'
                                        }}
                                    >{opt.label}</button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={() => setOnlyInStock(!onlyInStock)}
                            className={`flex items-center justify-between w-full p-4 rounded-xl border transition-all ${onlyInStock ? 'bg-[#16a34a]/10 border-[#16a34a] text-white' : 'bg-white/5 border-transparent text-white/40 hover:bg-white/5'}`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${onlyInStock ? 'bg-[#16a34a] text-white' : 'bg-white/5'}`}>
                                    <Check size={18} />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-sm text-white">Solo Items en Stock</div>
                                    <div className="text-[10px] opacity-60 text-white/60">Excluir productos agotados o a pedido</div>
                                </div>
                            </div>
                            <div className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all ${onlyInStock ? 'bg-[#16a34a] border-[#16a34a]' : 'border-white/10'}`}>
                                {onlyInStock && <Check size={14} className="text-white" />}
                            </div>
                        </button>

                        {/* Toggle precios próximos */}
                        <button
                            onClick={() => setUseProxPrices(!useProxPrices)}
                            className={`flex items-center justify-between w-full p-4 rounded-xl border transition-all ${useProxPrices ? 'bg-amber-500/20 border-amber-400 text-white' : 'bg-white/5 border-transparent text-white/40 hover:bg-white/5'}`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${useProxPrices ? 'bg-amber-500 text-white' : 'bg-white/5'}`}>
                                    <TrendingUp size={18} />
                                </div>
                                <div className="text-left">
                                    <div className="font-bold text-sm text-white">Usar Precios Próximos</div>
                                    <div className="text-[10px] opacity-60 text-white/60">Exportar con precios nuevos (vigencia mañana)</div>
                                </div>
                            </div>
                            <div className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-all ${useProxPrices ? 'bg-amber-500 border-amber-400' : 'border-white/10'}`}>
                                {useProxPrices && <Check size={14} className="text-white" />}
                            </div>
                        </button>
                    </section>
                </div>

                {/* Footer */}
                <div className="p-6 bg-black/20 flex items-center justify-between">
                    <div className="text-[10px] text-white/30 font-mono">
                        {selectedFields.size} características seleccionadas
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 rounded-xl text-sm font-bold text-white/60 hover:text-white transition-all"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={handleExport}
                            disabled={isGenerating || data.length === 0}
                            className="bg-[#f07d2a] hover:bg-[#f07d2a]/80 disabled:opacity-50 text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-[#f07d2a]/20 flex items-center gap-2 transition-all"
                        >
                            {isGenerating ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>{progress.total > 0 ? `${Math.round((progress.current / progress.total) * 100)}%` : 'Generando...'}</span>
                                </>
                            ) : (
                                <>
                                    <Download size={18} />
                                    Descargar {format.toUpperCase()}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}
