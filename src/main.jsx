import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Deshabilitar el cambio de valores con el scroll en inputs numéricos de forma global
document.addEventListener('wheel', (e) => {
    if (document.activeElement && document.activeElement.type === 'number') {
        e.preventDefault();
    }
}, { passive: false });

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
