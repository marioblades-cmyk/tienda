import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth, AuthProvider } from './hooks/useAuth';
import Login from './components/Login';
import Register from './components/Register';
import AdminWeeklyView from './components/AdminWeeklyView';
import AdminConsolidatedView from './components/AdminConsolidatedView';
import AdminUserManagement from './components/AdminUserManagement';
import SellerDashboard from './components/SellerDashboard';
import RemitosManagement from './components/RemitosManagement';
import AdminMasterView from './components/AdminMasterView';
import ComicAnalysisTool from './components/ComicAnalysisTool';
import PriceAnalysisTool from './components/PriceAnalysisTool';
import QuotationTool from './components/QuotationTool';
import PreSaleGenerator from './components/PreSaleGenerator';
import ReceptionManagement from './components/ReceptionManagement';
import ConfirmationInfoView from './components/StockFlotanteView';
import {
    LayoutDashboard, Calendar, Users, LogOut,
    PanelLeftClose, PanelLeftOpen, Database,
    CheckCircle2, BookOpen, FileText, Image as ImageIcon,
    Truck, BarChart3, ShoppingBag, Wallet, BookMarked, History, HandCoins
} from 'lucide-react';
import { supabase } from './services/supabase';
import { useCatalogStatus } from './hooks/useCatalogStatus';
import CatalogUpdatedView from './components/CatalogUpdatedView';
import ClientOrdersView from './components/ClientOrdersView';
import FlujoCajaView from './components/FlujoCajaView';
import ContabilidadView from './components/ContabilidadView';
import PrestamosView from './components/PrestamosView';
import StockHistorialView from './components/StockHistorialView';

// --- Nav item ---
function NavItem({ id, icon: Icon, label, active, onClick, showLabel, badge }) {
    return (
        <button
            onClick={() => onClick(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 relative
                ${active
                    ? 'text-white font-bold bg-white/10 border-l-[3px] border-[#f07d2a] pl-[9px]'
                    : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}
                ${!showLabel ? 'justify-center' : ''}`}
        >
            <Icon size={20} className={badge ? 'text-[#f07d2a] animate-pulse' : ''} />
            {showLabel && (
                <span className="flex items-center gap-2 text-sm">
                    {label}
                    {badge && (
                        <span className="w-2 h-2 bg-[#f07d2a] rounded-full shadow-[0_0_8px_#f07d2a]" />
                    )}
                </span>
            )}
        </button>
    );
}

// --- Sidebar content ---
function SidebarContent({ activeTab, onTabChange, showLabels, isAdmin, isSocio, hasPendingChanges, user, profile }) {
    const adminItems = [
        { id: 'mis-pedidos', icon: LayoutDashboard, label: 'Mis Pedidos' },
        { id: 'semanas', icon: Calendar, label: 'Semanas' },
        { id: 'confirmaciones-info', icon: BarChart3, label: 'Información de Confirmaciones' },
        { id: 'consolidado', icon: Truck, label: 'Consolidado' },
        { id: 'confirmaciones', icon: CheckCircle2, label: 'Confirmaciones' },
        { id: 'remitos', icon: Database, label: 'Gestión Integral' },
        { id: 'usuarios', icon: Users, label: 'Vendedores' },
        { id: 'entelequia', icon: BookOpen, label: 'Herramienta Editorial' },
        { id: 'precios', icon: Database, label: 'Análisis de Precios' },
        { id: 'recepcion', icon: Truck, label: 'Recepción' },
        { id: 'catalogo-actualizado', icon: CheckCircle2, label: 'Catálogo Actualizado' },
        { id: 'preventas', icon: ImageIcon, label: 'Generador de Preventas' },
        { id: 'cotizaciones', icon: FileText, label: 'Cotizaciones' },
        { id: 'clientes', icon: ShoppingBag, label: 'Pedidos de Clientes' },
        { id: 'caja', icon: Wallet, label: 'Flujo de Caja' },
        { id: 'contabilidad', icon: BookMarked, label: 'Contabilidad' },
        { id: 'prestamos', icon: HandCoins, label: 'Préstamos' },
        { id: 'stock-historial', icon: History, label: 'Historial de Stock' },
    ];

    const sellerItems = [
        { id: 'pedidos', icon: LayoutDashboard, label: 'Mis Pedidos' },
        { id: 'confirmaciones-info', icon: BarChart3, label: 'Información de Confirmaciones' },
        ...(isSocio ? [
            { id: 'remitos', icon: Database, label: 'Gestión Integral' },
            { id: 'recepcion', icon: Truck, label: 'Recepción' }
        ] : []),
        { id: 'catalogo-actualizado', icon: CheckCircle2, label: 'Catálogo Actualizado' },
        { id: 'preventas', icon: ImageIcon, label: 'Generador de Preventas' },
        { id: 'cotizaciones', icon: FileText, label: 'Cotizaciones' },
        { id: 'clientes', icon: ShoppingBag, label: 'Pedidos de Clientes' },
        { id: 'caja', icon: Wallet, label: 'Flujo de Caja' },
    ];

    const items = isAdmin ? adminItems : sellerItems;

    return (
        <>
            {/* Header */}
            <div className="px-5 py-4 flex items-center gap-3 border-b border-white/5 shrink-0">
                <div className="bg-primary text-text p-2 rounded font-display text-xl min-w-[36px] text-center shrink-0 leading-none">
                    MC
                </div>
                {showLabels && (
                    <span className="font-display text-xl tracking-wide whitespace-nowrap text-white flex-1 overflow-hidden">
                        MANGAS <span className="text-primary">COMICS</span>
                    </span>
                )}
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
                {items.map(item => (
                    <NavItem
                        key={item.id}
                        id={item.id}
                        icon={item.icon}
                        label={item.label}
                        active={activeTab === item.id}
                        onClick={onTabChange}
                        showLabel={showLabels}
                        badge={item.id === 'entelequia' && hasPendingChanges}
                    />
                ))}
            </nav>

            {/* Footer */}
            <div className="p-4 border-t border-white/5 bg-black/20 shrink-0">
                <div className={`flex items-center gap-3 mb-3 p-2 ${!showLabels ? 'justify-center' : ''}`}>
                    <div className="w-8 h-8 bg-primary text-primary-text rounded-full flex items-center justify-center font-bold text-xs shadow-lg ring-2 ring-primary/20 shrink-0">
                        {profile?.nombre?.[0] || user.email[0].toUpperCase()}
                    </div>
                    {showLabels && (
                        <div className="flex flex-col min-w-0">
                            <span className="text-xs font-bold text-white truncate">
                                {profile?.nombre || 'Usuario'}
                            </span>
                            <span className="text-xs font-medium text-white/50 truncate">
                                {user.email}
                            </span>
                        </div>
                    )}
                </div>
                <button
                    onClick={() => supabase.auth.signOut()}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-muted hover:bg-error/10 hover:text-error transition-all ${!showLabels ? 'justify-center' : ''}`}
                    title="Cerrar Sesión"
                >
                    <LogOut size={20} />
                    {showLabels && <span className="text-xs font-bold font-mono">SALIR</span>}
                </button>
            </div>
        </>
    );
}

// --- Tab title map ---
const TAB_TITLES = {
    semanas: 'Gestión de Semanas',
    consolidado: 'Consolidado General',
    remitos: 'Remitos y Finanzas',
    confirmaciones: 'Base Master',
    'confirmaciones-info': 'Información de Confirmaciones',
    'mis-pedidos': 'Mis Pedidos como Vendedor',
    pedidos: 'Mis Pedidos Semanales',
    usuarios: 'Gestión de Vendedores',
    precios: 'Análisis de Precios',
    'catalogo-actualizado': 'Catálogo Maestro Actualizado',
    recepcion: 'Control de Recepción de Cajas',
    preventas: 'Generador de Preventas',
    cotizaciones: 'Generador de Cotizaciones',
    clientes: 'Pedidos de Clientes',
    caja: 'Flujo de Caja',
    contabilidad: 'Contabilidad General',
    prestamos: 'Préstamos Otorgados',
    entelequia: 'Herramienta Editorial',
};

function Main() {
    const { user, profile, loading, isAdmin, isSocio } = useAuth();
    const { hasPendingChanges } = useCatalogStatus();
    const [showRegister, setShowRegister] = useState(false);
    const [activeTab, setActiveTab] = useState('pedidos');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [initialized, setInitialized] = useState(false);

    useEffect(() => {
        if (!loading && user && !initialized) {
            setActiveTab(isAdmin ? 'semanas' : 'pedidos');
            setInitialized(true);
        }
    }, [loading, isAdmin, user, initialized]);

    // --- Loading ---
    if (loading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background">
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                    className="w-12 h-12 border-4 border-slate-200 border-t-primary rounded-full mb-6"
                />
            </div>
        );
    }

    // --- Auth screen ---
    if (!user) {
        return (
            <div className="min-h-screen flex flex-col items-center pt-16 p-4 bg-background">
                <motion.header
                    initial={{ opacity: 0, y: -24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="mb-6 text-center"
                >
                    <div className="flex justify-center mb-2">
                        <img
                            src="/logo.png"
                            alt="Logo"
                            className="h-28 md:h-36 object-contain mix-blend-multiply"
                        />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-display tracking-tight text-text leading-none">
                        MANGAS <span className="text-primary">COMICS</span>
                    </h1>
                    <div className="mt-1 flex items-center justify-center gap-4 text-[11px] font-mono font-bold text-muted uppercase tracking-[0.4em]">
                        <span className="w-8 h-[1px] bg-primary" />
                        Bolivia Store
                        <span className="w-8 h-[1px] bg-primary" />
                    </div>
                </motion.header>

                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.15 }}
                    className="w-full max-w-md"
                >
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={showRegister ? 'register' : 'login'}
                            initial={{ opacity: 0, x: showRegister ? 24 : -24 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: showRegister ? -24 : 24 }}
                            transition={{ duration: 0.22, ease: 'easeInOut' }}
                        >
                            {showRegister ? <Register /> : <Login />}
                        </motion.div>
                    </AnimatePresence>

                    <div className="text-center mt-6">
                        <button
                            onClick={() => setShowRegister(!showRegister)}
                            className="text-primary font-medium text-sm hover:underline transition-all"
                        >
                            {showRegister
                                ? '¿Ya tienes cuenta? Inicia sesión'
                                : '¿No tienes cuenta? Regístrate'}
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    // --- Tab content ---
    const currentContent = isAdmin ? (
        activeTab === 'semanas' ? <AdminWeeklyView /> :
        activeTab === 'confirmaciones-info' ? <ConfirmationInfoView /> :
        activeTab === 'consolidado' ? <AdminConsolidatedView /> :
        activeTab === 'confirmaciones' ? <AdminMasterView /> :
        activeTab === 'mis-pedidos' ? <SellerDashboard isAdmin={isAdmin} /> :
        activeTab === 'usuarios' ? <AdminUserManagement /> :
        activeTab === 'precios' ? <PriceAnalysisTool /> :
        activeTab === 'recepcion' ? <ReceptionManagement /> :
        activeTab === 'catalogo-actualizado' ? <CatalogUpdatedView /> :
        activeTab === 'preventas' ? <PreSaleGenerator /> :
        activeTab === 'cotizaciones' ? <QuotationTool /> :
        activeTab === 'clientes' ? <ClientOrdersView /> :
        activeTab === 'caja' ? <FlujoCajaView user={user} profile={profile} /> :
        activeTab === 'contabilidad' ? <ContabilidadView /> :
        activeTab === 'prestamos' ? <PrestamosView /> :
        activeTab === 'stock-historial' ? <StockHistorialView /> :
        activeTab === 'remitos' ? <RemitosManagement /> :
        activeTab === 'entelequia' ? <ComicAnalysisTool /> :
        <ComicAnalysisTool /> // Fallback
    ) : (
        (activeTab === 'remitos' && isSocio) ? <RemitosManagement isSocio={true} /> :
        (activeTab === 'recepcion' && isSocio) ? <ReceptionManagement /> :
        activeTab === 'confirmaciones-info' ? <ConfirmationInfoView /> :
        activeTab === 'catalogo-actualizado' ? <CatalogUpdatedView /> :
        activeTab === 'preventas' ? <PreSaleGenerator /> :
        activeTab === 'cotizaciones' ? <QuotationTool /> :
        activeTab === 'clientes' ? <ClientOrdersView /> :
        activeTab === 'caja' ? <FlujoCajaView user={user} profile={profile} /> :
        <SellerDashboard isAdmin={isAdmin} />
    );

    const pageTitle = TAB_TITLES[activeTab] || 'Módulos Mangas Comics';

    const roleLabel = isAdmin ? 'ADMINISTRADOR' : (isSocio ? 'SOCIO' : 'VENDEDOR');

    return (
        <div className="min-h-screen bg-background flex text-text font-sans antialiased min-w-fit">

            {/* ── SIDEBAR ── */}
            <motion.aside
                animate={{ width: sidebarOpen ? 256 : 80 }}
                transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
                className="bg-[#1a2d42] flex flex-col sticky top-0 h-screen z-50 border-r border-white/5 overflow-hidden shrink-0"
            >
                <SidebarContent
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    showLabels={sidebarOpen}
                    isAdmin={isAdmin}
                    isSocio={isSocio}
                    hasPendingChanges={hasPendingChanges}
                    user={user}
                    profile={profile}
                />
                {/* Collapse toggle */}
                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="absolute -right-3 top-20 bg-border text-muted p-1 rounded-full hover:text-accent transition-colors border border-background shadow-lg"
                    aria-label={sidebarOpen ? 'Colapsar sidebar' : 'Expandir sidebar'}
                >
                    {sidebarOpen ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
                </button>
            </motion.aside>

            {/* ── MAIN CONTENT ── */}
            <div className="flex-1 flex flex-col min-h-screen overflow-x-auto min-w-0">
                <header className="p-4 md:p-6 pb-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-muted uppercase tracking-[0.2em] mb-3">
                        <span className="text-primary font-mono opacity-80">PLATAFORMA</span>
                        <span className="opacity-30">/</span>
                        <span className="text-text">{roleLabel}</span>
                    </div>
                    <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-text">
                        {pageTitle}
                    </h2>
                    <div className="h-1 w-12 bg-primary mt-3" />
                </header>

                <main className="p-4 md:p-6 flex-1">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={activeTab}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.18, ease: 'easeOut' }}
                        >
                            {currentContent}
                        </motion.div>
                    </AnimatePresence>
                </main>

                <footer className="p-6 pt-0 text-[11px] font-mono text-slate-800 uppercase tracking-[0.2em] flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                        <span className="font-bold">&copy; 2024 MANGAS COMICS BOLIVIA STORE</span>
                    </div>
                    <div className="flex gap-6">
                        <span className="hover:text-accent font-bold transition-colors cursor-help">SOPORTE TÉCNICO</span>
                        <span className="hover:text-accent font-bold transition-colors cursor-help">ESTADO DEL SERVIDOR: ONLINE</span>
                    </div>
                </footer>
            </div>
        </div>
    );
}

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true };
    }
    componentDidCatch(error, errorInfo) {
        this.setState({ error, errorInfo });
        console.error("ErrorBoundary atrapó un error:", error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '20px', background: '#ffebee', color: '#c62828' }}>
                    <h2>Algo salió mal en React.</h2>
                    <details style={{ whiteSpace: 'pre-wrap' }}>
                        {this.state.error && this.state.error.toString()}
                        <br />
                        {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </details>
                </div>
            );
        }
        return this.props.children;
    }
}

export default function App() {
    return (
        <ErrorBoundary>
            <AuthProvider>
                <Main />
            </AuthProvider>
        </ErrorBoundary>
    );
}
