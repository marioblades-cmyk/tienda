import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

console.log("-> main.jsx: Iniciando ReactDOM.createRoot...");
const rootElement = document.getElementById('root');
console.log("-> main.jsx: Elemento #root encontrado:", rootElement);

ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
console.log("-> main.jsx: Renderizado invocado exitosamente.");
