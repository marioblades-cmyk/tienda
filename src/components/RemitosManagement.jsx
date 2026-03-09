import { useState } from 'react';
import {
    FileText,
    Truck,
    User,
    CreditCard,
    Home,
    Plus,
    Download,
    Settings,
    ChevronRight,
    Search
} from 'lucide-react';
import RemitosTable from './RemitosTable';

export default function RemitosManagement({ isSocio = false }) {
    const [activeTab, setActiveTab] = useState('remitos');

    const allTabs = [
        { id: 'remitos', label: 'Remitos', icon: FileText },
        { id: 'distribuidor', label: 'Distribuidor', icon: Truck },
        { id: 'socio', label: 'Socio', icon: User },
        { id: 'cuenta', label: 'Cuenta Corriente', icon: CreditCard },
        { id: 'alquiler', label: 'Alquiler', icon: Home },
    ];

    const tabs = isSocio
        ? allTabs.filter(t => ['remitos', 'socio', 'cuenta', 'alquiler'].includes(t.id))
        : allTabs;

    return (
        <div className="remitos-system min-h-screen bg-[#f8f9fa] -m-4 p-4 md:-m-8 md:p-8 font-sans text-[#1a1c1e]">
            {/* Custom Styles for this tool only */}
            <style>{`
                .remitos-system {
                    --navy: #1a3a5f;
                    --navy-dark: #0f2942;
                    --accent: #f37021;
                    --sky: #89b3d9;
                    --cream: #fdf8ed;
                }
                .font-mono-numbers {
                    font-family: 'JetBrains Mono', monospace;
                    letter-spacing: -0.02em;
                }
                .custom-scrollbar::-webkit-scrollbar {
                    height: 8px;
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #dfe5eb;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #89b3d9;
                }
            `}</style>

            {/* Header / Navigation */}
            <header className="mb-2 flex flex-wrap items-center gap-6">
                {/* Title removed for ultra-compact UI */}

                <div className="bg-white p-1.5 rounded-2xl shadow-sm border border-border/40 flex gap-1">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-xs font-black transition-all duration-400 ${activeTab === tab.id
                                ? 'bg-navy text-white shadow-xl shadow-navy/20 scale-[1.05] z-10'
                                : 'bg-transparent text-navy/40 hover:text-navy hover:bg-navy/5'
                                }`}
                        >
                            <tab.icon size={18} className={activeTab === tab.id ? 'stroke-[3px]' : ''} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </header>



            {/* Main Content Area */}
            <div className="bg-white rounded-[2rem] shadow-xl shadow-navy/5 border border-border/40 overflow-visible min-h-[600px]">
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <RemitosTable activeTab={activeTab} isSocio={isSocio} />
                </div>
            </div>

        </div>
    );
}
