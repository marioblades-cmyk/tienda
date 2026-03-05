import { useState } from 'react';
import { UserPlus, Mail, Lock, User, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../services/supabase';
import { translateError } from '../services/errorTranslations';

export default function Register() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [nombre, setNombre] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    const handleRegister = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { data, error: signUpError } = await supabase.auth.signUp({
                email,
                password,
                options: { data: { nombre } }
            });

            if (signUpError) throw signUpError;

            // Create profile in vendedores table
            const { error: profileError } = await supabase
                .from('vendedores')
                .insert([{ id: data.user.id, nombre, email }]);

            if (profileError) throw profileError;

            setSuccess(true);
        } catch (err) {
            console.error(err);
            setError(translateError(err));
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="flex flex-col items-center justify-center p-4">
                <div className="glass p-8 rounded-2xl w-full max-w-md text-center">
                    <div className="text-4xl mb-4">✅</div>
                    <h2 className="text-2xl font-bold mb-2">Registro exitoso</h2>
                    <p className="text-muted font-mono text-sm leading-relaxed">
                        Por favor, revisa tu correo para confirmar tu cuenta e intenta ingresar.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-surface p-8 rounded-xl w-full max-w-md border border-border shadow-md mx-auto">
            <div className="text-center mb-8">
                <h2 className="text-3xl font-bold text-text mb-2 tracking-tight">Nuevo Vendedor</h2>
                <p className="text-muted text-sm font-medium opacity-80">Únete a Mangas Comics Bolivia</p>
            </div>

            {error && (
                <div className="bg-danger/10 text-danger border border-danger/20 p-3 rounded-lg mb-6 text-sm">
                    {error}
                </div>
            )}

            <form onSubmit={handleRegister} className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-muted-2 mb-1.5">Nombre Completo</label>
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Tu nombre..."
                            value={nombre}
                            onChange={(e) => setNombre(e.target.value)}
                            className="input-field pl-10 h-12"
                            required
                        />
                        <User className="absolute left-3 top-3.5 w-5 h-5 text-muted" />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-muted-2 mb-1.5">Correo Electrónico</label>
                    <div className="relative">
                        <input
                            type="email"
                            placeholder="vendedor@gmail.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="input-field pl-10 h-12"
                            required
                        />
                        <Mail className="absolute left-3 top-3.5 w-5 h-5 text-muted" />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-muted-2 mb-1.5">Contraseña</label>
                    <div className="relative">
                        <input
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="input-field pl-10 h-12"
                            required
                            minLength={6}
                        />
                        <Lock className="absolute left-3 top-3.5 w-5 h-5 text-muted" />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-3.5 text-muted hover:text-text transition-colors"
                        >
                            {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="btn-primary w-full h-12 text-lg shadow-sm"
                >
                    {loading ? 'Creando cuenta...' : 'Completar Registro'}
                </button>
            </form>

            <div className="mt-8 pt-6 border-t border-border text-center">
                <p className="text-sm text-muted">© 2024 Mangas Comics Bolivia Store</p>
            </div>
        </div>
    );
}
