# INSTRUCCIÓN DE CONSTRUCCIÓN — Sistema de Remitos Mangas Comics Bolivia
## Para Google Antigravity — Construir esta herramienta ahora

---

## INSTRUCCIÓN PRINCIPAL

**Construí esta herramienta completa.** Es un sistema interno de gestión de remitos, distribuidor, planes de pago y alquiler para Mangas Comics Bolivia.

La sección 13 de este documento contiene la **Guía de Diseño oficial de Mangas Comics Bolivia**. Aplicarla **únicamente a esta herramienta** — no es para el proyecto completo de la tienda, solo para este sistema de remitos.

Todo el stack, la lógica de cálculo, el esquema de base de datos, las APIs y los layouts están definidos exactamente en este documento. **No inventar, no simplificar, no cambiar ningún cálculo.**

---

## 1. CONTEXTO Y OBJETIVO

Construir una aplicación web fullstack que reemplaza un archivo HTML con localStorage por una app persistente con base de datos real. La lógica de negocio ya está 100% definida — el agente NO debe inventar ni simplificar ningún cálculo.

---

## 2. STACK TÉCNICO EXACTO

```
Frontend:  Next.js 14 App Router + TypeScript
Estilos:   Tailwind CSS + CSS variables custom
BD:        Supabase (PostgreSQL)
ORM:       Prisma
Estado:    React Query (TanStack Query v5) para fetching/cache
Fuentes:   Google Fonts: Nunito (400,600,700,800) + JetBrains Mono (400,500)
Deploy:    Vercel (frontend) + Supabase (DB)
```

---

## 3. VARIABLES GLOBALES DE CONFIGURACIÓN

```typescript
// Tarifas flete Bolivia (editables por el usuario, persisten en DB tabla config)
let FG = 70   // BS por caja grande
let FM = 40   // BS por caja mediana
let FP = 20   // BS por caja pequeña
```

---

## 4. ESQUEMA COMPLETO DE BASE DE DATOS (Prisma schema)

```prisma
model Config {
  key   String @id
  value String
  // Seeds requeridos: {key:"fg",value:"70"}, {key:"fm",value:"40"}, {key:"fp",value:"20"}
}

model Remito {
  id            Int      @id @default(autoincrement())
  nro           String   @default("")
  fecha         String   @default("")   // formato "YYYY-MM-DD" como string
  cajas         String   @default("")
  kg            String   @default("")   // peso KG
  precioRemito  String   @default("")   // Precio Remito ARS
  compre        String   @default("")   // Compré ARS
  cambio        String   @default("")   // Cambio del día
  cg            String   @default("0") // Cajas grandes
  cm            String   @default("0") // Cajas medianas
  cp            String   @default("0") // Cajas pequeñas
  // Campos Socio (todos editables inline)
  skg           String   @default("")  // Peso KG socio
  scaj          String   @default("")  // Cajas grandes socio
  smonto        String   @default("")  // Monto ARS socio
  // Campos calculados por FIFO (escritos por syncDistToRows, NO editables por usuario)
  pedido        String   @default("")  // Nombre pedido (viene de dist_pedidos en orden)
  pagoAprox     String   @default("")  // Monto ARS del pedido distribuidor
  distTC        Float    @default(0)   // TC ponderado FIFO (7 decimales)
  distPag       Float    @default(0)   // Monto ARS cubierto por FIFO
  orden         Int      @default(0)   // Para mantener orden de creación
  createdAt     DateTime @default(now())
}

model DistPedido {
  id        Int      @id @default(autoincrement())
  nombre    String   @default("")
  monto     Float    @default(0)
  orden     Int      @default(0)   // orden FIFO — crítico
  createdAt DateTime @default(now())
}

model DistPago {
  id        Int      @id @default(autoincrement())
  fecha     String   @default("")   // "YYYY-MM-DD"
  monto     Float    @default(0)
  tc        Float    @default(0)    // tipo de cambio del pago
  nota      String   @default("")
  createdAt DateTime @default(now())
}

model DistAjuste {
  id        Int      @id @default(autoincrement())
  fecha     String   @default("")
  monto     Float    @default(0)    // positivo = crédito, negativo = débito
  nota      String   @default("")
  createdAt DateTime @default(now())
}

model DistSaldoInicial {
  id    Int    @id @default(1)
  monto Float  @default(0)
  tipo  String @default("favor")  // "favor" | "deuda"
}

model Plan {
  id        Int        @id @default(autoincrement())
  fecha     String     @default("")
  collapsed Boolean    @default(true)
  editing   Boolean    @default(false)
  items     PlanItem[]
  pagos     PlanPago[]
  createdAt DateTime   @default(now())
}

model PlanItem {
  id      Int    @id @default(autoincrement())
  planId  Int
  plan    Plan   @relation(fields: [planId], references: [id], onDelete: Cascade)
  remId   String  // puede ser número (remito.id) o "extra-N"
  tipo    String  // "envio" | "flete" | "pedido" | "extra"
  label   String  // "Envio" | "Flete" | "Pedido" | "Extra"
  nro     String  // identificador del pedido (ej: "COMIC M BOLIVIA 24-1")
  amount  Float   @default(0)
}

model PlanPago {
  id        Int      @id @default(autoincrement())
  planId    Int
  plan      Plan     @relation(fields: [planId], references: [id], onDelete: Cascade)
  monto     Float    @default(0)
  fecha     String   @default("")
  createdAt DateTime @default(now())
}

model PlanExtra {
  id        Int      @id @default(autoincrement())
  label     String
  amount    Float    @default(0)
  createdAt DateTime @default(now())
}

model CtaPago {
  id        Int      @id @default(autoincrement())
  monto     Float    @default(0)
  fecha     String   @default("")
  createdAt DateTime @default(now())
}

model CtaExtra {
  id        Int      @id @default(autoincrement())
  label     String
  amount    Float    @default(0)
  createdAt DateTime @default(now())
}

model AlquilerConfig {
  id        Int    @id @default(1)
  totalMes  Float  @default(0)
  socioMes  Float  @default(0)
  mesInicio String @default("")  // "YYYY-MM"
}

model AlquilerMes {
  id          Int     @id @default(autoincrement())
  ym          String  @unique  // "YYYY-MM"
  cargado     Boolean @default(false)
  autoCargado Boolean @default(false)
}
```

---

## 5. LÓGICA DE CÁLCULO — COPIAR EXACTAMENTE

### 5.1 Función num() — parsear cualquier valor a número
```typescript
function num(v: any): number {
  if (v === null || v === undefined || v === '') return 0
  return parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0
}
```

### 5.2 Función calcRow() — cálculo de una fila de remito
```typescript
// INPUTS del remito: compre, cambio, cg, cm, cp, skg, scaj, smonto, kg, pagoAprox, distTC
// FG, FM, FP vienen de config global

function calcRow(r: RemitoConCampos, FG: number, FM: number, FP: number) {
  const compre = num(r.compre)
  const cambio = num(r.cambio)
  const costoBS = compre * cambio                              // Costo BS

  const cg = num(r.cg), cm = num(r.cm), cp = num(r.cp)
  const fleteBS = cg * FG + cm * FM + cp * FP                 // Total Flete BS

  const totalBS = costoBS + fleteBS                           // Costo Total BS

  const tcDist = r.distTC || 0                                // TC Distribuidor (viene del FIFO)
  const pa = num(r.pagoAprox)
  const costoLibrosBS = pa && tcDist ? pa * tcDist : 0
  const grandBS = totalBS + costoLibrosBS                     // GRAND TOTAL BS

  // SOCIO
  const kgTotal = num(r.kg)
  const skg = num(r.skg)
  const pctKg = kgTotal > 0 ? skg / kgTotal : 0
  const sEnvBS = compre * pctKg * cambio                      // Envío BS socio
  const sFltBS = num(r.scaj) * FG                             // Flete BS socio
  const sPedBS = num(r.smonto) * tcDist                       // Pedido BS socio
  const sTotBS = sEnvBS + sFltBS + sPedBS                     // Total BS socio

  return { costoBS, fleteBS, totalBS, grandBS, sEnvBS, sFltBS, sPedBS, sTotBS }
}
```

### 5.3 Función calcDistFIFO() — EL CORAZÓN DEL SISTEMA
```typescript
// REGLAS FIFO:
// 1. Débitos = dist_pedidos en orden (orden ASC) + saldo inicial tipo "deuda" va PRIMERO
// 2. Pool de créditos = saldo inicial tipo "favor" + dist_pagos ordenados por fecha ASC + ajustes positivos
// 3. Ajustes negativos REDUCEN el pool desde el ÚLTIMO crédito hacia atrás
// 4. TC ponderado por pedido = suma(monto_usado_i × tc_i) / suma(monto_usado_i)
//    Solo se pondera con créditos que tienen tc > 0 (el saldo inicial favor tiene tc=0)

async function calcDistFIFO(prisma: PrismaClient) {
  const pedidos = await prisma.distPedido.findMany({ orderBy: { orden: 'asc' } })
  const pagos   = await prisma.distPago.findMany({ orderBy: { fecha: 'asc' } })
  const ajustes = await prisma.distAjuste.findMany({ orderBy: { createdAt: 'asc' } })
  const remitos = await prisma.remito.findMany({ orderBy: { orden: 'asc' } })
  const saldoIni = await prisma.distSaldoInicial.findFirst()

  // Construir débitos
  type Debito = { remitoId: number, nro: string, nombre: string, monto: number, esInicial?: boolean }
  const debitos: Debito[] = []

  // Saldo inicial deuda va PRIMERO
  if (saldoIni && saldoIni.monto > 0 && saldoIni.tipo === 'deuda') {
    debitos.push({ remitoId: -1, nro: 'Saldo inicial', nombre: 'Saldo inicial', monto: saldoIni.monto, esInicial: true })
  }

  // Pedidos en orden, cada uno asociado al remito de mismo índice
  pedidos.forEach((p, idx) => {
    const r = remitos[idx]
    debitos.push({
      remitoId: r ? r.id : -1,
      nro: r ? (r.nro || `#${r.id}`) : `pedido ${idx + 1}`,
      nombre: p.nombre || '',
      monto: p.monto || 0
    })
  })

  // Construir pool de créditos
  type PoolItem = { restante: number, tc: number, fecha: string, nota: string }
  const pool: PoolItem[] = []

  if (saldoIni && saldoIni.monto > 0 && saldoIni.tipo === 'favor') {
    pool.push({ restante: saldoIni.monto, tc: 0, fecha: '', nota: 'Saldo inicial a favor' })
  }

  pagos.forEach(p => pool.push({ restante: p.monto || 0, tc: p.tc || 0, fecha: p.fecha, nota: p.nota }))

  // Aplicar ajustes
  ajustes.forEach(a => {
    if (!a.monto) return
    if (a.monto > 0) {
      pool.push({ restante: a.monto, tc: 0, fecha: a.fecha || '', nota: `Ajuste: ${a.nota || ''}` })
    } else {
      // Ajuste negativo: resta del pool desde el ÚLTIMO hacia atrás
      let resta = Math.abs(a.monto)
      for (let i = pool.length - 1; i >= 0 && resta > 0; i--) {
        const quitar = Math.min(pool[i].restante, resta)
        pool[i].restante -= quitar
        resta -= quitar
      }
    }
  })

  // FIFO — asignar pool a débitos
  const resultado = debitos.filter(d => d.monto > 0).map(d => {
    let pendiente = d.monto
    let cubiertoARS = 0
    let sp = 0, sm = 0  // para TC ponderado

    for (let i = 0; i < pool.length && pendiente > 0; i++) {
      if (pool[i].restante <= 0) continue
      const usar = Math.min(pool[i].restante, pendiente)
      pool[i].restante -= usar
      pendiente -= usar
      cubiertoARS += usar
      if (pool[i].tc > 0) { sp += usar * pool[i].tc; sm += usar }
    }

    const tcPond = sm > 0 ? sp / sm : 0
    const estadoPct = d.monto > 0 ? Math.min(100, Math.round(cubiertoARS / d.monto * 100)) : 0

    return {
      remitoId: d.remitoId,
      nro: d.nro,
      nombre: d.nombre,
      esInicial: d.esInicial || false,
      monto: d.monto,
      cubierto: cubiertoARS,
      pendiente,
      tcPond,
      cubiertoBS: tcPond > 0 ? cubiertoARS * tcPond : null,
      estadoPct
    }
  })

  // Saldo restante en pool
  const saldoARS = pool.reduce((s, p) => s + p.restante, 0)
  let sp2 = 0, sm2 = 0
  pool.forEach(p => { if (p.restante > 0 && p.tc > 0) { sp2 += p.restante * p.tc; sm2 += p.restante } })
  const saldoTC = sm2 > 0 ? sp2 / sm2 : 0

  return { debitos: resultado, saldoARS, saldoBS: saldoTC > 0 ? saldoARS * saldoTC : null, saldoTC }
}
```

### 5.4 syncDistToRows() — Propagar FIFO a remitos
```typescript
// Llamar SIEMPRE que cambie: dist_pedidos, dist_pagos, dist_ajustes, dist_saldo_inicial
// EFECTO: actualiza remitos.distTC, remitos.distPag, remitos.pedido, remitos.pagoAprox en DB

async function syncDistToRows(prisma: PrismaClient) {
  const pedidos = await prisma.distPedido.findMany({ orderBy: { orden: 'asc' } })
  const remitos = await prisma.remito.findMany({ orderBy: { orden: 'asc' } })

  // Paso 1: asignar pedido y pagoAprox a remitos en orden
  for (let i = 0; i < remitos.length; i++) {
    const ped = pedidos[i]
    await prisma.remito.update({
      where: { id: remitos[i].id },
      data: {
        pedido: ped ? (ped.nombre || '') : '',
        pagoAprox: ped ? String(ped.monto || '') : ''
      }
    })
  }

  // Paso 2: calcular FIFO y asignar TC a cada remito
  const fifo = await calcDistFIFO(prisma)
  for (const d of fifo.debitos) {
    if (d.remitoId > 0) {
      await prisma.remito.update({
        where: { id: d.remitoId },
        data: { distTC: d.tcPond, distPag: d.cubierto }
      })
    }
  }
}
```

### 5.5 ctaTotalDeuda() — Total deuda del socio
```typescript
// Total deuda = suma de (sEnvBS + sFltBS + sPedBS) de TODOS los remitos + cta_extras
async function ctaTotalDeuda(prisma: PrismaClient, FG: number, FM: number, FP: number) {
  const remitos = await prisma.remito.findMany()
  const extras = await prisma.ctaExtra.findMany()

  const fromRemitos = remitos.reduce((s, r) => {
    const { sEnvBS, sFltBS, sPedBS } = calcRow(r, FG, FM, FP)
    return s + sEnvBS + sFltBS + sPedBS
  }, 0)

  const fromExtras = extras.reduce((s, e) => s + e.amount, 0)
  return fromRemitos + fromExtras
}
```

### 5.6 getAvailableItems() — Items disponibles para planes
```typescript
// Un item está "disponible" si NO está ya incluido en ningún plan existente
// tipos: "envio", "flete", "pedido" (solo si tienen valor > 0)
async function getAvailableItems(prisma: PrismaClient, FG: number, FM: number, FP: number) {
  const remitos = await prisma.remito.findMany({ orderBy: { orden: 'asc' } })
  const planes  = await prisma.plan.findMany({ include: { items: true } })

  // Set de items ya usados: "remitoId-tipo"
  const used = new Set<string>()
  planes.forEach(p => p.items.forEach(it => used.add(`${it.remId}-${it.tipo}`)))

  const items = []
  for (const r of remitos) {
    const { sEnvBS, sFltBS, sPedBS } = calcRow(r, FG, FM, FP)
    const nro = r.pedido || r.nro || `#${r.id}`
    if (sEnvBS > 0 && !used.has(`${r.id}-envio`))
      items.push({ remId: String(r.id), tipo: 'envio',  label: 'Envio',  nro, amount: sEnvBS })
    if (sFltBS > 0 && !used.has(`${r.id}-flete`))
      items.push({ remId: String(r.id), tipo: 'flete',  label: 'Flete',  nro, amount: sFltBS })
    if (sPedBS > 0 && !used.has(`${r.id}-pedido`))
      items.push({ remId: String(r.id), tipo: 'pedido', label: 'Pedido', nro, amount: sPedBS })
  }
  return items
}
```

### 5.7 alqAutoCargar() — Auto-carga alquiler vencido
```typescript
// Llamar al renderizar la pestaña Alquiler
// REGLA: si un mes (ym < mesActual) no está cargado → agregarlo a cta_extras Y plan_extras
async function alqAutoCargar(prisma: PrismaClient) {
  const hoy = new Date()
  const mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const config = await prisma.alquilerConfig.findFirst()
  if (!config || !config.mesInicio) return

  const meses = await prisma.alquilerMes.findMany({ where: { cargado: false } })
  for (const m of meses) {
    if (m.ym < mesActual) {
      const label = `Alquiler ${ymLabel(m.ym)}`
      const monto = config.socioMes || 0
      // Agregar a cta_extras
      await prisma.ctaExtra.create({ data: { label, amount: monto } })
      // Agregar a plan_extras
      await prisma.planExtra.create({ data: { label, amount: monto } })
      // Marcar como cargado
      await prisma.alquilerMes.update({
        where: { id: m.id },
        data: { cargado: true, autoCargado: true }
      })
    }
  }
}
```

### 5.8 alqGenMeses() — Generar meses hasta hoy
```typescript
// Agrega meses faltantes desde mesInicio hasta el mes actual
// NUNCA sobreescribe meses existentes, NUNCA ordena
async function alqGenMeses(prisma: PrismaClient) {
  const config = await prisma.alquilerConfig.findFirst()
  if (!config || !config.mesInicio) return

  const hoy = new Date()
  const hasta = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const existentes = await prisma.alquilerMes.findMany()
  const ymSet = new Set(existentes.map(m => m.ym))

  let ym = config.mesInicio
  while (ym <= hasta) {
    if (!ymSet.has(ym)) {
      await prisma.alquilerMes.create({ data: { ym, cargado: false } })
    }
    ym = ymAdd(ym, 1)
  }
}
```

### 5.9 Helpers de fechas
```typescript
// 'YYYY-MM' → 'Mar 2025'
function ymLabel(ym: string): string {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
  return `${meses[parseInt(m) - 1] || m} ${y}`
}

// Suma n meses a 'YYYY-MM'
function ymAdd(ym: string, n: number): string {
  let y = parseInt(ym.slice(0, 4))
  let m = parseInt(ym.slice(5, 7)) - 1
  m += n
  y += Math.floor(m / 12)
  m = ((m % 12) + 12) % 12
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

// Mes actual como 'YYYY-MM'
function ymNow(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
```

### 5.10 Formateo de números
```typescript
// Locale boliviano: separador miles='.', decimales=','
function fmt(v: number, dec = 0): string {
  return v.toLocaleString('es-BO', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}
function fBS(v: number):  string { return v ? `BS ${fmt(v, 2)}` : '--' }
function fARS(v: number): string { return v ? `ARS ${fmt(v, 0)}` : '--' }
function fARS2(v: number):string { return v ? `ARS ${fmt(v, 2)}` : '--' }
// TC siempre con 7 decimales: "1.8734521"
function fTC(v: number):  string { return v ? v.toFixed(7) : '--' }
```

---

## 6. API ROUTES — Next.js App Router

Todas las routes en `/app/api/`. Todas retornan JSON. Todas usan Prisma.

Después de cualquier cambio en dist_pedidos, dist_pagos, dist_ajustes o dist_saldo_inicial → llamar `syncDistToRows()`.

```
GET    /api/remitos              → lista todos ordenados por orden ASC
POST   /api/remitos              → crea nuevo (orden = max(orden)+1)
PUT    /api/remitos/[id]         → actualiza campos (no distTC/distPag/pedido/pagoAprox)
DELETE /api/remitos/[id]         → elimina + reordena + syncDistToRows

GET    /api/dist/saldo-inicial   → { monto, tipo }
PUT    /api/dist/saldo-inicial   → upsert { monto, tipo } + syncDistToRows

GET    /api/dist/pedidos         → lista ordenada por orden ASC
POST   /api/dist/pedidos         → { nombre, monto } orden = max+1, + syncDistToRows
PUT    /api/dist/pedidos/[id]    → { nombre?, monto? } + syncDistToRows
DELETE /api/dist/pedidos/[id]    → elimina + reordena por orden + syncDistToRows

GET    /api/dist/pagos           → lista ordenada por fecha ASC
POST   /api/dist/pagos           → { fecha, monto, tc, nota? } + syncDistToRows
PUT    /api/dist/pagos/[id]      → { fecha?, monto?, tc?, nota? } + syncDistToRows
DELETE /api/dist/pagos/[id]      → elimina + syncDistToRows

GET    /api/dist/ajustes         → lista ordenada por createdAt ASC
POST   /api/dist/ajustes         → { fecha, monto, nota? } + syncDistToRows
DELETE /api/dist/ajustes/[id]    → elimina + syncDistToRows

GET    /api/dist/fifo            → ejecuta calcDistFIFO() y retorna resultado completo

GET    /api/planes               → lista con items y pagos incluidos
POST   /api/planes               → { fecha, items: [{remId,tipo,label,nro,amount}] }
DELETE /api/planes/[id]          → elimina (cascade items y pagos)
PATCH  /api/planes/[id]          → { collapsed?, editing? }

POST   /api/planes/[id]/items    → { remId, tipo, label, nro, amount }
DELETE /api/planes/[id]/items/[iid]
PATCH  /api/planes/[id]/items/[iid] → { amount }

POST   /api/planes/[id]/pagos    → { monto, fecha }
PUT    /api/planes/[id]/pagos/[pid] → { monto?, fecha? }
DELETE /api/planes/[id]/pagos/[pid]

GET    /api/plan-extras          → lista todos
POST   /api/plan-extras          → { label, amount }
DELETE /api/plan-extras/[id]

GET    /api/cta                  → { pagos, extras, totalDeuda, totalPagado, saldo }
POST   /api/cta/pagos            → { monto, fecha }
PUT    /api/cta/pagos/[id]       → { monto?, fecha? }
DELETE /api/cta/pagos/[id]

POST   /api/cta/extras           → { label, amount }
DELETE /api/cta/extras/[id]

GET    /api/alquiler             → { config, meses }
PUT    /api/alquiler/config      → { totalMes, socioMes, mesInicio } + alqGenMeses()
POST   /api/alquiler/meses       → agrega un mes manual { ym }
PUT    /api/alquiler/meses/[ym]  → { cargado, autoCargado }
DELETE /api/alquiler/meses/[ym]  → elimina + limpia cta_extras y plan_extras del label "Alquiler MMM YYYY"

GET    /api/config               → { fg, fm, fp }
PUT    /api/config               → { fg?, fm?, fp? }
```

---

## 7. ESTRUCTURA DE PÁGINAS / COMPONENTES

```
app/
├── layout.tsx          ← Header sticky + Tabs + Providers (QueryClient)
├── page.tsx            ← Tab "Remitos" (tabla)
├── socio/page.tsx      ← Tab "Plan de Pagos Socio"
├── cta/page.tsx        ← Tab "Cuenta Corriente"
├── distribuidor/page.tsx
└── alquiler/page.tsx

components/
├── RemitosTable.tsx    ← Tabla principal con inline editing
├── SummaryBar.tsx      ← Barra de totales (fondo navy)
├── PlanCard.tsx        ← Card de plan individual (expandible)
├── DistFifoCard.tsx    ← Card de débito FIFO con barra de progreso
├── KpiCard.tsx         ← Card KPI reutilizable (borde izquierdo de color)
├── ProgressBar.tsx
└── ConfigModal.tsx     ← Modal para editar FG/FM/FP
```

---

## 8. TABLA DE REMITOS — COLUMNAS EXACTAS

### Grupos de columnas (en orden):

| Grupo | Color header | Columnas |
|-------|-------------|----------|
| Remito + Envío Argentina | azul cielo | Nro Remito, Fecha, Cajas, Peso KG, Precio Remito ARS |
| Compra ARS a BS | naranja | Compré ARS, Cambio día, Costo BS* |
| Flete Bolivia BS | naranja | Cajas Gdes 70, Cajas Med 40, Cajas Peq 20, Total Flete BS* |
| Costo Total | verde | Costo Total BS* |
| Pedido | blanco | Pedido (read-only), Pago Aprox ARS (read-only) |
| Distribuidor | amarillo/warn | Pagos Dist. ARS (read-only), TC Dist. (read-only, 7 dec) |
| Total | verde | Grand Total BS* |
| Socio | violeta | Peso KG, Cajas Gdes, Monto ARS, Envío BS*, Flete BS*, Pedido BS*, Total BS* |

`*` = calculado automáticamente, no editable

### Comportamiento de inputs:
- Campos ARS (compre, precioRemito, smonto): mostrar formateado "1.268.890", al hacer focus mostrar número crudo "1268890"
- Campos numéricos: text-align right, JetBrains Mono
- Al cambiar cualquier campo → recalcular esa fila → actualizar totales del footer
- Columnas Pedido y Pago Aprox: read-only, se llenan automáticamente desde dist_pedidos
- Columnas TC Dist y Pagos Dist: read-only, calculadas por FIFO

### Footer (tfoot):
- Fondo navy, borde superior 3px naranja
- Sumas de: Precio Remito ARS, Compré ARS, Costo BS, Cajas Gdes/Med/Peq, Total Flete BS, Costo Total BS, Pagos Dist. ARS, Grand Total BS, Envío BS socio, Flete BS socio, Pedido BS socio, Total BS socio

### Summary Bar (encima de la tabla):
- Fondo navy, texto blanco, labels en rgba(255,255,255,0.5)
- Muestra: N remitos, Total ARS, Costo BS, Flete BS, Total Envíos BS, Libros BS, Gran Total BS, TC Dist Global

---

## 9. PESTAÑA DISTRIBUIDOR — LAYOUT EXACTO

```
┌─────────────────────────────────────────────────────────┐
│ Card "Punto de Partida" (saldo inicial)                 │
│ header navy: "💰 Punto de Partida"                      │
│ radio: deuda / a favor  +  input monto  +  btn Guardar  │
└─────────────────────────────────────────────────────────┘

┌──────────┬──────────┬──────────┬──────────┐
│ Total    │ Total    │ Saldo    │ Pendiente│
│ Pagado   │ Pedidos  │ a Favor  │ Pedidos  │
│ (verde)  │ (naranja)│ (verde/- │ (rojo/--)|
└──────────┴──────────┴──────────┴──────────┘

[Barra progreso global 8px]

┌────────────────────┬────────────────────┐
│ 📦 Pedidos         │ 💰 Créditos/Pagos  │
│ Lista + form add   │ Lista + form add   │
│ cada item:         │ cada item:         │
│ nombre | monto ARS │ fecha | monto | TC │
│ [editar] [borrar]  │ [editar] [borrar]  │
└────────────────────┴────────────────────┘

┌─────────────────────────────────────────┐
│ 📊 Débitos FIFO (grid auto-fill 280px) │
│ Por cada pedido en FIFO:               │
│ ┌────────────────────────────────────┐ │
│ │ nro remito    badge estado         │ │
│ │ nombre pedido                      │ │
│ │ monto ARS total                    │ │
│ │ [barra progreso 6px]               │ │
│ │ cubierto ARS / pendiente ARS       │ │
│ │ TC ponderado (7 decimales)         │ │
│ └────────────────────────────────────┘ │
│ Si saldo a favor → banner verde        │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ ⚙️ Ajustes (grid auto-fill 260px)      │
│ Por cada ajuste:                        │
│ borde-left verde (positivo) / rojo (neg)│
│ fecha | monto | nota | [borrar]         │
└─────────────────────────────────────────┘
```

### Estados badge FIFO:
- `estadoPct === 100` → badge verde "✓ Pagado"
- `0 < estadoPct < 100` → badge naranja "⏳ Parcial (XX%)"
- `estadoPct === 0` → badge rojo "⚠ Pendiente"

---

## 10. PESTAÑA PLAN DE PAGOS SOCIO — LAYOUT

```
Sección "Items disponibles":
  Agrupados por remito (cada grupo tiene header azul cielo claro)
  ├── [checkbox] badge-ENVIO  "Envio Argentina"   BS XXX,XX
  ├── [checkbox] badge-FLETE  "Flete Bolivia"     BS XXX,XX
  └── [checkbox] badge-PEDIDO "Pedido/Monto"      BS XXX,XX

  Grupo "Items extra" (amarillo) si existen planExtras disponibles:
  └── [checkbox] badge-EXTRA  label               BS XXX,XX

  [+ Item extra]  [+ Generar Plan]

  Card "Total disponible": borde violeta, monto en violeta grande

"PLANES GENERADOS" (label gris oscuro uppercase)
  [checkbox "Ocultar pagados"] si hay alguno pagado

  Por cada plan → <PlanCard>:
  ┌──────────────────────────────────────────────────────┐
  │ header navy: ▶ Plan #N  fecha    pagado/total  Resta │
  │              [Editar] [Borrar]                       │
  │ [barra progreso]                                     │
  │ (expandido):                                         │
  │   "ITEMS DEL PLAN"                                   │
  │   badge tipo | nombre | BS monto    (si editing: input+borrar) │
  │   Total  [+ Agregar item]  BS total                  │
  │                                                      │
  │   "PAGOS REGISTRADOS"                                │
  │   #N BS [input monto] [input fecha] [borrar]         │
  │   Pagado: BS X  Resta: BS X  [+ Registrar Pago]     │
  └──────────────────────────────────────────────────────┘
```

### Badges de tipo:
```
envio  → fondo hsl(205,55%,90%) color hsl(205,55%,30%)  texto "ENVIO"
flete  → fondo hsl(28,90%,90%)  color hsl(28,90%,35%)   texto "FLETE"
pedido → fondo hsl(260,60%,90%) color hsl(260,60%,35%)  texto "PEDIDO"
extra  → fondo hsl(45,92%,88%)  color hsl(38,80%,32%)   texto "EXTRA"
```

---

## 11. PESTAÑA CUENTA CORRIENTE — LAYOUT

```
Card principal (fondo blanco, borde gris):
  header navy: "Cuenta Corriente Socio"  |  "Al día!" / "Saldo: BS X"
  [barra progreso]
  ┌─────────────────┬─────────────────┬─────────────────┐
  │  TOTAL DEUDA    │    PAGADO       │     RESTA       │
  │  BS X (violeta) │  BS X (verde)   │  BS X (naranja) │
  └─────────────────┴─────────────────┴─────────────────┘

"Desglose de deuda" + [+ Item extra]
  Por cada remito con valores socio:
    Header azul cielo claro: "nombre del pedido"
    ENVIO   Envio Argentina     BS X
    FLETE   Flete Bolivia       BS X
    PEDIDO  Pedido/Monto        BS X
  Si hay extras:
    Header amarillo: "Items Extra"
    Extra | label | BS X | [borrar]
    Subtotal extras

"Pagos Registrados" + [+ Registrar Pago]
  #N  BS  [input monto verde]  [input fecha]  [borrar]
```

---

## 12. PESTAÑA ALQUILER — LAYOUT

```
Header: "Alquiler"  subtítulo gris  [⚙ Configurar]

[Config panel oculto por defecto]:
  Total alquiler BS | Parte del socio BS | Mes de inicio
  [Cancelar] [Guardar]

KPI cards (4 columnas, cards blancas con borde-left de color):
  🟠 Total por mes    🟢 Tu parte/mes    🟣 Parte socio/mes    🔵 Meses en CTA

[+ Mes]  "Desde Ene 2026 hasta Mar 2026"

Tabla (fondo blanco, border-radius 10px, sombra):
  thead navy:
  Mes | Total BS | Tu parte BS | Socio BS | Estado CTA | Acciones

  Por cada mes:
  - cargado     → fondo verde muy claro    estado: "✓ Auto · En CTA" o "✓ En CTA" (verde)
  - vencido     → fondo rojo muy claro     estado: "⚠ Vencido" (rojo)
  - pendiente   → fondo normal             estado: "Pendiente" (gris)
  Acciones: [→ CTA] (solo si !cargado)  [✕]

  tfoot navy: TOTAL (N meses)
```

---

## 13. GUÍA DE DISEÑO OFICIAL — MANGAS COMICS BOLIVIA STORE

> ⚠️ Esta guía aplica ÚNICAMENTE a esta herramienta (sistema de remitos). No es para el proyecto completo de la tienda.

---

### 13.1 PALETA DE COLORES — CSS Variables

```css
:root {
  /* Colores principales */
  --navy:        hsl(215, 55%, 22%);  /* primary — nav, headers, autoridad */
  --navy-dark:   hsl(215, 55%, 16%);  /* gradient nav (top) */
  --accent:      hsl(28, 90%, 52%);   /* naranja — CTA, activos, badges importantes */
  --yellow:      hsl(45, 92%, 60%);   /* highlights, tags, precios */
  --sky:         hsl(205, 55%, 65%);  /* fondos secundarios, hover, bordes suaves */
  --cream:       hsl(45, 60%, 94%);   /* fondos tarjetas destacadas, secciones alternas */

  /* Fondos y texto — SIEMPRE tema claro */
  --bg:          hsl(220, 20%, 97%);  /* fondo general de la app — CLARO */
  --fg:          hsl(220, 30%, 12%);  /* texto principal — OSCURO */
  --muted:       hsl(210, 20%, 93%);  /* inputs deshabilitados, separadores */
  --muted-fg:    hsl(215, 15%, 48%);  /* texto secundario, placeholders, captions */

  /* Estados */
  --danger:      hsl(0, 72%, 51%);    /* error, eliminar */
  --ok:          hsl(145, 50%, 38%);  /* éxito, pagado, al día */
  --purple:      hsl(260, 60%, 55%);  /* socio, planes de pago */

  /* Bordes */
  --border:        hsl(215, 25%, 85%);  /* borde por defecto — thin 1px */
  --border-active: hsl(28, 90%, 52%);   /* borde activo/focus — naranja */
  --border-dest:   hsl(215, 55%, 22%);  /* borde destacado — navy */

  /* Sombras */
  --shadow-card:       0 2px 8px -2px hsl(215 55% 22% / 8%), 0 4px 16px -4px hsl(215 55% 22% / 6%);
  --shadow-card-hover: 0 4px 12px -2px hsl(215 55% 22% / 12%), 0 8px 24px -4px hsl(215 55% 22% / 10%);
  --shadow-button:     0 2px 6px -1px hsl(28 90% 52% / 30%);
  --shadow-nav:        0 4px 20px -4px hsl(215 55% 22% / 15%);
}
```

---

### 13.2 TIPOGRAFÍA

**Importar de Google Fonts:**
```html
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Nunito:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

**Reglas de uso estrictas:**

| Fuente | Pesos | Usar para | NUNCA usar para |
|--------|-------|-----------|-----------------|
| `Bangers` | 400 | Títulos decorativos hero, banners | Texto funcional, interfaz, tablas |
| `Nunito` | 400/600/700/800 | TODO: body, h1-h4, botones, tabs, labels, nav | Números de montos |
| `JetBrains Mono` | 400/500 | Montos ARS/BS, TC (7 dec), IDs, refs técnicas | Texto corrido |

**Escala tipográfica:**
```css
/* display — solo Bangers, solo hero */
.display   { font-size: 3rem;     line-height: 1.1;  font-family: 'Bangers'; }
h1         { font-size: 2.25rem;  line-height: 1.2;  font-family: 'Nunito'; font-weight: 800; }
h2         { font-size: 1.75rem;  line-height: 1.25; font-family: 'Nunito'; font-weight: 800; }
h3         { font-size: 1.375rem; line-height: 1.3;  font-family: 'Nunito'; font-weight: 700; }
h4         { font-size: 1.125rem; line-height: 1.4;  font-family: 'Nunito'; font-weight: 700; }
body       { font-size: 1rem;     line-height: 1.6;  font-family: 'Nunito'; font-weight: 400; }
.small     { font-size: 0.875rem; line-height: 1.5; }
.caption   { font-size: 0.75rem;  line-height: 1.4; }
```

---

### 13.3 BORDES Y RADIOS

```css
/* Grosores */
/* thin:   1px — separadores, bordes inputs, divisiones tabla */
/* medium: 2px — tarjetas activas, elementos seleccionados */
/* thick:  3px — decorativos, tab activa, tarjetas destacadas */

/* Radios */
--radius-sm: 0.375rem;  /* 6px  — badges, chips, tags pequeños */
--radius-md: 0.5rem;    /* 8px  — botones, inputs */
--radius-lg: 0.625rem;  /* 10px — tarjetas, paneles, modales */
```

---

### 13.4 NAVEGACIÓN / HEADER

```css
header {
  background: linear-gradient(180deg, hsl(215,55%,16%) 0%, hsl(215,55%,22%) 100%);
  height: 4rem; /* 64px */
  position: sticky; top: 0; z-index: 100;
  box-shadow: var(--shadow-nav); /* 0 4px 20px -4px navy/15% */
  padding: 0 1.5rem;
  display: flex; align-items: center; gap: 1rem;
}

/* Logo / título */
header h1 {
  font-family: 'Nunito'; font-size: 1.25rem; font-weight: 800; color: #fff;
  /* La palabra "Mangas" va en color naranja (--accent) */
}

/* Tabs de navegación interna */
.tab {
  font-family: 'Nunito'; font-size: 0.875rem; font-weight: 600;
  color: rgba(255,255,255,0.6);
  border-bottom: 3px solid transparent;
  padding: 0.375rem 1rem;
  cursor: pointer; background: transparent;
  border-top: none; border-left: none; border-right: none;
  transition: color 150ms, border-color 150ms;
  gap: 0.125rem; /* entre tabs */
}
.tab:hover  { color: rgba(255,255,255,0.9); }
.tab.active { color: #fff; border-bottom: 3px solid hsl(28,90%,52%); }

/* Links en nav */
/* default: opacity 0.8 | hover: opacity 1 + underline accent | active: borde-bottom thick naranja */
/* fontSize: 0.875rem | fontWeight: 600 | spacing: 1.5rem entre links */
```

---

### 13.5 TABLAS

```css
/* Header de tabla */
thead th {
  background: hsl(215,55%,22%);         /* navy */
  color: rgba(255,255,255,0.65);
  font-family: 'Nunito'; font-size: 0.875rem; /* 14px */
  font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.875rem 0.75rem;            /* vertical 14px, horizontal 12px */
}
/* Borde inferior del thead: 2px naranja */
thead { border-bottom: 2px solid hsl(28,90%,52%); }

/* Filas */
tbody tr:nth-child(even) td { background: hsl(45,60%,94%); }  /* --cream */
tbody tr:nth-child(odd)  td { background: #fff; }
tbody tr:hover           td {
  background: hsl(205,55%,65%);  /* --sky */
  transition: background 150ms;
}

/* Celdas */
td {
  padding: 0.75rem;         /* horizontal */
  /* padding vertical: 0.875rem */
  border-bottom: 1px solid hsl(215,25%,85%);  /* thin border */
  /* SIN bordes verticales en el body */
}

/* Celdas de inputs inline */
td input {
  width: 100%; background: transparent; border: none; outline: none;
  color: hsl(215,55%,22%);
  font-family: 'JetBrains Mono'; font-size: 0.75rem; font-weight: 600;
  padding: 0.5rem 0.625rem; text-align: right;
}
td input:focus { background: hsl(45,92%,60%, 0.15); } /* yellow 15% */

/* Footer */
tfoot td {
  background: hsl(215,55%,22%);
  border-top: 3px solid hsl(28,90%,52%);  /* thick naranja */
  color: #fff;
  font-family: 'JetBrains Mono'; font-weight: 800;
  padding: 0.875rem 0.75rem; text-align: right;
}
```

---

### 13.6 TARJETAS (CARDS)

```css
/* Card estándar */
.card {
  background: #fff;
  border: 1px solid hsl(215,25%,85%);   /* thin */
  border-radius: 0.625rem;              /* lg = 10px */
  box-shadow: var(--shadow-card);
  padding: 1.25rem 1.5rem;
  transition: box-shadow 150ms;
}
.card:hover { box-shadow: var(--shadow-card-hover); }

/* Card destacada */
.card-highlighted {
  border-left: 3px solid hsl(28,90%,52%);  /* thick naranja */
  background: hsl(45,60%,94%);             /* cream */
}

/* KPI card (distribuidor, alquiler) */
.kpi-card {
  background: #fff;
  border: 1px solid hsl(215,25%,85%);
  border-left: 3px solid var(--color-kpi);  /* naranja/verde/violeta/navy según el KPI */
  border-radius: 0.625rem;
  padding: 0.875rem;
  box-shadow: var(--shadow-card);
}
.kpi-label {
  font-size: 0.5625rem; font-weight: 700; font-family: 'Nunito';
  color: hsl(215,15%,48%);
  text-transform: uppercase; letter-spacing: 0.075rem;
  margin-bottom: 0.375rem;
}
.kpi-value {
  font-size: 1rem; font-weight: 800;
  font-family: 'JetBrains Mono';
  /* color según KPI: naranja, verde, violeta, navy */
}

/* Card de plan (header navy) */
.plan-card {
  background: #fff;
  border: 1px solid hsl(215,25%,85%);
  border-radius: 0.625rem;
  overflow: hidden;
  margin-bottom: 0.75rem;
  box-shadow: var(--shadow-card);
}
.plan-card-header {
  background: hsl(215,55%,22%);
  padding: 0.75rem 1rem;
  display: flex; align-items: center; gap: 0.5rem;
  cursor: pointer;
}
.plan-card-header h4 { color: #fff; font-family: 'Nunito'; font-weight: 800; }
```

---

### 13.7 BOTONES

```css
/* PRIMARY — naranja, acción principal */
.btn-primary {
  background: hsl(28,90%,52%);
  color: #fff;
  border: none;
  border-radius: 0.5rem;          /* md = 8px */
  padding: 0.625rem 1.25rem;
  font-family: 'Nunito'; font-size: 1rem; font-weight: 700;
  box-shadow: var(--shadow-button);
  cursor: pointer;
  transition: filter 150ms, transform 150ms;
}
.btn-primary:hover { filter: brightness(1.1); transform: scale(1.02); }

/* SECONDARY — azul suave */
.btn-secondary {
  background: hsl(205,55%,90%);
  color: hsl(215,55%,22%);
  border: 1px solid hsl(215,25%,85%);
  border-radius: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-family: 'Nunito'; font-weight: 700;
}

/* OUTLINE */
.btn-outline {
  background: transparent;
  color: hsl(220,30%,12%);
  border: 2px solid hsl(215,25%,85%);
  border-radius: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-family: 'Nunito'; font-weight: 700;
}
.btn-outline:hover { background: hsl(210,20%,93%); }

/* GHOST — en header (sobre navy) */
.btn-ghost {
  background: transparent;
  color: rgba(255,255,255,0.85);
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 0.5rem;
  padding: 0.5rem 1rem;
  font-family: 'Nunito'; font-weight: 600;
}
.btn-ghost:hover { border-color: hsl(28,90%,52%); color: hsl(28,90%,52%); }

/* DANGER — eliminar */
.btn-danger {
  background: transparent;
  color: hsl(0,72%,51%);
  border: 1px solid hsl(0,72%,65%);
  border-radius: 0.5rem;
  padding: 0.25rem 0.625rem;
  font-family: 'Nunito'; font-weight: 700;
}
.btn-danger:hover { background: hsl(0,72%,51%, 0.08); }
```

---

### 13.8 BADGES / ETIQUETAS DE TIPO

```css
/* Base badge */
.badge {
  display: inline-flex; align-items: center;
  padding: 0.1em 0.5em;
  border-radius: 0.375rem;  /* sm = 6px */
  font-family: 'Nunito'; font-size: 0.6875rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em;
  white-space: nowrap;
}

/* Tipos específicos de la herramienta */
.badge-envio  { background: hsl(205,55%,90%); color: hsl(205,55%,28%); }
.badge-flete  { background: hsl(28,90%,90%);  color: hsl(28,90%,30%);  }
.badge-pedido { background: hsl(260,60%,90%); color: hsl(260,60%,30%); }
.badge-extra  { background: hsl(45,92%,88%);  color: hsl(38,80%,28%);  }

/* Estados de pago FIFO */
.badge-pagado  { background: hsl(145,50%,90%); color: hsl(145,50%,28%); } /* ✓ Pagado */
.badge-parcial { background: hsl(28,90%,90%);  color: hsl(28,90%,30%);  } /* ⏳ Parcial */
.badge-pend    { background: hsl(0,72%,90%);   color: hsl(0,72%,30%);   } /* ⚠ Pendiente */

/* Estados estándar de la guía */
.badge-nuevo   { background: hsl(28,90%,52%);  color: #fff; }
.badge-oferta  { background: hsl(45,92%,60%);  color: hsl(220,30%,12%); }
.badge-agotado { background: hsl(210,20%,93%);  color: hsl(215,15%,48%); }
```

---

### 13.9 SUMMARY BAR (barra de totales sobre tabla)

```css
.summary-bar {
  display: flex;
  background: hsl(215,55%,22%);  /* navy */
  border-bottom: 2px solid hsl(215,25%,85%);
  overflow-x: auto;
}
.sum-item {
  padding: 0.625rem 1.25rem;
  border-right: 1px solid hsl(215,35%,35%);
  white-space: nowrap; flex-shrink: 0;
}
.sum-label {
  font-size: 0.5625rem; font-weight: 700;
  color: rgba(255,255,255,0.5);
  text-transform: uppercase; letter-spacing: 0.075rem;
  margin-bottom: 0.25rem;
  font-family: 'Nunito';
}
.sum-value {
  font-size: 0.9375rem; font-weight: 800;
  font-family: 'JetBrains Mono';
  color: #fff;
}
```

---

### 13.10 GRADIENTES

```css
/* Hero (no usado en esta herramienta, reservado para landing) */
.gradient-hero { background: linear-gradient(135deg, hsl(28,90%,52%), hsl(45,92%,60%)); }

/* Navegación — USADO en header */
.gradient-nav  { background: linear-gradient(180deg, hsl(215,55%,16%) 0%, hsl(215,55%,22%) 100%); }

/* Accent de tarjeta */
.gradient-card { background: linear-gradient(135deg, hsl(205,55%,65%), hsl(215,55%,22%)); }
```

---

### 13.11 ESPACIADO

```css
/* Entre secciones principales */  gap/margin: 3rem a 4rem;
/* Entre grupos de elementos */    gap/margin: 1.5rem a 2rem;
/* Entre elementos relacionados */ gap/margin: 0.75rem a 1rem;
/* Entre elementos inline */       gap: 0.5rem;
```

---

### 13.12 RESALTADO DE TEXTO (si aplica)

```css
/* Palabra clave */
.highlight-word {
  background: hsl(45,92%,60%, 0.35);
  padding: 0.1em 0.4em; border-radius: 0.25rem; font-weight: 700;
}
/* Acento/acción */
.highlight-accent {
  background: hsl(28,90%,52%, 0.15);
  color: hsl(28,90%,52%);
  padding: 0.1em 0.4em; border-radius: 0.25rem; font-weight: 700;
}
```

---

### 13.13 REGLAS DE CONTRASTE — OBLIGATORIAS

- El fondo general `--bg` es siempre `hsl(220,20%,97%)` — **NUNCA oscuro**
- El texto principal `--fg` es siempre `hsl(220,30%,12%)` — **NUNCA claro sobre fondo claro**
- Labels de categoría (`.sum-label`, `.kpi-label`): `hsl(215,15%,48%)` — visible sobre blanco/crema
- Texto sobre fondo navy: siempre `#fff` o `rgba(255,255,255,0.X)`
- Montos numéricos: **siempre** `font-family: 'JetBrains Mono'`
- TC distribuidor: **siempre** `.toFixed(7)` — nunca redondear
- Formato de moneda: locale `'es-BO'` — separador miles `.`, decimales `,`
  - ARS sin decimales: `"ARS 1.268.890"`
  - BS con 2 decimales: `"BS 7.994,01"`

---

## 14. REGLAS DE NEGOCIO CRÍTICAS — NO SIMPLIFICAR

1. **syncDistToRows se llama automáticamente** en el servidor después de cualquier mutación a dist_pedidos, dist_pagos, dist_ajustes, o dist_saldo_inicial. El cliente usa React Query para refrescar remitos después.

2. **FIFO usa orden de pedidos** (campo `orden` ASC), NO fecha. El orden en que se ingresaron los pedidos es el orden de consumo del pool.

3. **Los pagos del distribuidor SÍ se ordenan por fecha** para construir el pool.

4. **TC ponderado** solo incluye créditos con tc > 0. El saldo inicial a favor tiene tc = 0 (no afecta el TC).

5. **Remitos en la tabla**: los campos `pedido`, `pagoAprox`, `distTC`, `distPag` son SOLO para display — el usuario no los edita. Se llenan desde `syncDistToRows`.

6. **Inline editing de la tabla**: al cambiar un campo de un remito, guardar en DB via PUT /api/remitos/[id], luego recalcular localmente (optimistic update) sin recargar toda la tabla.

7. **alqAutoCargar**: ejecutar al montar la página /alquiler. Si hay meses vencidos sin cargar → crearlos en cta_extras y plan_extras, marcar cargado=true, autoCargado=true.

8. **Eliminar un mes de alquiler**: si estaba cargado → también eliminar el registro correspondiente en cta_extras (por label "Alquiler MMM YYYY") y en plan_extras.

9. **Plan de pagos**: un item (remId + tipo) solo puede estar en UN plan a la vez. `getAvailableItems` filtra los que ya están en algún plan.

10. **Input ARS**: al hacer focus mostrar número crudo sin formato, al hacer blur mostrar formateado con puntos de miles.
