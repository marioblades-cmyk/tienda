import { useState, useEffect } from 'react';
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
import { LayoutDashboard, Calendar, Users, LogOut, PanelLeftClose, PanelLeftOpen, Database, CheckCircle2, Zap } from 'lucide-react';
import { supabase } from './services/supabase';

function Main() {
    const { user, profile, loading, isAdmin, isSocio } = useAuth();
    const [showRegister, setShowRegister] = useState(false);
    const [activeTab, setActiveTab] = useState('pedidos');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [initialized, setInitialized] = useState(false);

    // Sync activeTab with isAdmin when initial load completes
    useEffect(() => {
        if (!loading && user && !initialized) {
            setActiveTab(isAdmin ? 'semanas' : 'pedidos');
            setInitialized(true);
        }
    }, [loading, isAdmin, user, initialized]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="w-12 h-12 border-4 border-border border-t-accent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen flex flex-col items-center pt-20 p-4 bg-background">
                <header className="mb-0 text-center animate-in fade-in zoom-in slide-in-from-top-12 duration-1000">
                    <div className="flex justify-center mb-1">
                        <img
                            src="/logo.png"
                            alt="Logo"
                            className="h-28 md:h-36 object-contain mix-blend-multiply"
                        />
                    </div>
                    <h1 className="text-4xl md:text-5xl font-display tracking-tight text-text leading-none">
                        MANGAS <span className="text-primary">COMICS</span>
                    </h1>
                    <div className="mt-0.5 flex items-center justify-center gap-4 text-[11px] font-mono font-bold text-muted uppercase tracking-[0.4em]">
                        <span className="w-8 h-[1px] bg-primary"></span>
                        Bolivia Store
                        <span className="w-8 h-[1px] bg-primary"></span>
                    </div>
                </header>

                <div className="w-full max-w-md">
                    {showRegister ? <Register /> : <Login />}

                    <div className="text-center mt-6">
                        <button
                            onClick={() => setShowRegister(!showRegister)}
                            className="text-primary font-medium text-sm hover:underline transition-all"
                        >
                            {showRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background flex text-text font-sans antialiased min-w-fit">
            {/* Sidebar */}
            <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-[#1a2d42] transition-all duration-300 flex flex-col sticky top-0 h-screen z-50 border-r border-white/5`}>
                <div className="p-6 flex items-center gap-3 border-b border-white/5">
                    <div className="bg-primary text-text p-2 rounded font-display text-xl min-w-[36px] text-center">MC</div>
                    {sidebarOpen && <span className="font-display text-2xl tracking-wide whitespace-nowrap text-white">MANGAS <span className="text-primary">COMICS</span></span>}
                </div>

                <nav className="flex-1 px-4 py-6 space-y-2">
                    {isAdmin ? (
                        <>
                            <button
                                onClick={() => setActiveTab('semanas')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'semanas' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <Calendar size={20} />
                                {sidebarOpen && <span>Semanas</span>}
                            </button>
                            <button
                                onClick={() => setActiveTab('mis-pedidos')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'mis-pedidos' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <LayoutDashboard size={20} />
                                {sidebarOpen && <span>Mis Pedidos</span>}
                            </button>
                            <button
                                onClick={() => setActiveTab('consolidado')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'consolidado' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <LayoutDashboard size={20} />
                                {sidebarOpen && <span>Consolidado</span>}
                            </button>
                            <button
                                onClick={() => setActiveTab('confirmaciones')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'confirmaciones' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <CheckCircle2 size={20} />
                                {sidebarOpen && <span>Confirmaciones</span>}
                            </button>
                            <button
                                onClick={() => setActiveTab('remitos')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'remitos' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <Database size={20} />
                                {sidebarOpen && <span>Gestión Integral</span>}
                            </button>
                            <button
                                onClick={() => setActiveTab('usuarios')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'usuarios' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <Users size={20} />
                                {sidebarOpen && <span>Vendedores</span>}
                            </button>
                            <button
                                onClick={() => setActiveTab('entelequia')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'entelequia' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <Zap size={20} />
                                {sidebarOpen && <span>Herramienta Editorial</span>}
                            </button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={() => setActiveTab('pedidos')}
                                className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'pedidos' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                            >
                                <LayoutDashboard size={20} />
                                {sidebarOpen && <span>Mis Pedidos</span>}
                            </button>
                            {isSocio && (
                                <button
                                    onClick={() => setActiveTab('remitos')}
                                    className={`w-full flex items-center gap-3 p-3 transition-all relative ${activeTab === 'remitos' ? 'text-white font-bold bg-white/5 border-l-[3px] border-[#f07d2a]' : 'text-white/60 hover:bg-white/5 hover:text-[#f07d2a]'}`}
                                >
                                    <Database size={20} />
                                    {sidebarOpen && <span>Gestión Integral</span>}
                                </button>
                            )}
                        </>
                    )}
                </nav>

                <div className="p-4 border-t border-white/5 mt-auto bg-black/20">
                    <div className={`flex items-center gap-3 mb-4 p-2 ${sidebarOpen ? '' : 'justify-center'}`}>
                        <div className="w-8 h-8 bg-primary text-primary-text rounded-full flex items-center justify-center font-bold text-xs shadow-lg ring-2 ring-primary/20">
                            {profile?.nombre?.[0] || user.email[0].toUpperCase()}
                        </div>
                        {sidebarOpen && (
                            <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold text-white truncate">{profile?.nombre || 'Usuario'}</span>
                                <span className="text-xs font-medium text-white/50 truncate">{user.email}</span>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => supabase.auth.signOut()}
                        className={`w-full flex items-center gap-3 p-3 rounded-xl text-muted hover:bg-error/10 hover:text-error transition-all ${sidebarOpen ? '' : 'justify-center'}`}
                        title="Cerrar Sesión"
                    >
                        <LogOut size={20} />
                        {sidebarOpen && <span className="text-xs font-bold font-mono">SALIR</span>}
                    </button>
                </div>

                <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    className="absolute -right-3 top-20 bg-border text-muted p-1 rounded-full hover:text-accent transition-colors border border-background shadow-lg"
                >
                    {sidebarOpen ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
                </button>
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-h-screen max-w-full overflow-x-auto">
                <header className="p-4 md:p-6 pb-0">
                    <div className="flex items-center gap-2 text-xs font-bold text-muted uppercase tracking-[0.2em] mb-4">
                        <span className="text-primary font-mono opacity-80">PLATAFORMA</span>
                        <span className="opacity-30">/</span>
                        <span className="text-text">{isAdmin ? 'ADMINISTRADOR' : (isSocio ? 'SOCIO' : 'VENDEDOR')}</span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-text">
                        {isAdmin
                            ? (activeTab === 'semanas' ? 'Gestión de Semanas' :
                                activeTab === 'consolidado' ? 'Consolidado General' :
                                    activeTab === 'remitos' ? 'Remitos y Finanzas' :
                                        activeTab === 'confirmaciones' ? 'Base Master' :
                                            activeTab === 'mis-pedidos' ? 'Mis Pedidos como Vendedor' :
                                                activeTab === 'usuarios' ? 'Gestión de Vendedores' :
                                                    'Herramienta Editorial (Mangas Comics Bolivia)')
                            : 'Mis Pedidos Semanales'
                        }
                    </h2>
                    <div className="h-1 w-12 bg-primary mt-4"></div>
                </header>

                <main className="p-4 md:p-6 flex-1 animate-in fade-in duration-500">
                    {isAdmin ? (
                        activeTab === 'semanas' ? <AdminWeeklyView /> :
                            activeTab === 'consolidado' ? <AdminConsolidatedView /> :
                                activeTab === 'remitos' ? <RemitosManagement /> :
                                    activeTab === 'confirmaciones' ? <AdminMasterView /> :
                                        activeTab === 'mis-pedidos' ? <SellerDashboard isAdmin={isAdmin} /> :
                                            activeTab === 'usuarios' ? <AdminUserManagement /> :
                                                <ComicAnalysisTool />
                    ) : (
                        activeTab === 'remitos' && isSocio ? <RemitosManagement isSocio={true} /> :
                            <SellerDashboard isAdmin={isAdmin} />
                    )}
                </main>

                <footer className="p-10 pt-0 text-[11px] font-mono text-slate-800 uppercase tracking-[0.2em] flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-success animate-pulse"></span>
                        <span className="font-bold">&copy; 2024 MANGAS COMICS BOLIVIA STORE</span>
                    </div>
                    <div className="flex gap-6">
                        <span className="hover:text-accent font-bold transition-colors cursor-help">SOPORTE TÉCNICO</span>
                        <span className="hover:text-accent2 font-bold transition-colors cursor-help">ESTADO DEL SERVIDOR: ONLINE</span>
                    </div>
                </footer>
            </div>
        </div>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <Main />
        </AuthProvider>
    );
}
