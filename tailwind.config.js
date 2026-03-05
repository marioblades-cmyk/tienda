/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                display: ['Anton', 'sans-serif'],
                mono: ['"DM Mono"', 'ui-monospace', 'monospace'],
            },
            colors: {
                primary: '#f5a800',
                'primary-active': '#e09500',
                'primary-tint': '#fff8e6',
                secondary: '#5bc8f5',
                'secondary-dark': '#29b6f0',
                'secondary-tint': '#e8f8ff',
                success: '#27ae60',
                danger: '#eb5757',
                background: '#f7f7f5',
                surface: '#ffffff',
                'surface-2': '#f2f1ee',
                border: '#e2e0da',
                text: '#1a1a1a',
                muted: '#888580',
            },
            boxShadow: {
                'sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                'md': '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }
        },
    },
    plugins: [],
}
