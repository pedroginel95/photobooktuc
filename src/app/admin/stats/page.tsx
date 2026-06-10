'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  collection, onSnapshot, query, orderBy,
  doc, setDoc, updateDoc, deleteDoc, Timestamp, getDocs, arrayUnion
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  BarChart3, ArrowLeft, Plus, X, Trash2, TrendingUp,
  DollarSign, Wallet, BookOpen, Calendar, RefreshCw, RotateCcw, Frame, Search
} from 'lucide-react';

type SaleStatus = 'pending' | 'done' | 'finalized';

interface SaleRecord {
  id: string;
  date: { seconds: number };
  clientName: string;
  productType: string;
  collectionsCount: number;
  photosCount: number;
  booksCount: number;
  status: SaleStatus;
  priceOverride?: number;   // precio forzado (total) — por descuentos
  costOverride?: number;    // costo forzado (total)
  designerPaid?: boolean;   // control: ¿se le pagó al diseñador?
  userId?: string;
  linkedClientId?: string;
  linkedCollectionId?: string; // legacy (modelo anterior por colección)
  source?: 'auto' | 'manual';
  createdAt?: { seconds: number };
}

// ── Configuración de precios y costos ──
interface ProductConfig { price: number; printCost: number; designerCost: number; }

const PRODUCT_CONFIG: Record<string, ProductConfig> = {
  'A5 Tapa Blanda': { price: 33990, printCost: 13000, designerCost: 7000 },
  'A5 Tapa Dura':   { price: 35990, printCost: 13000, designerCost: 7000 },
  'A4 Tapa Blanda': { price: 49990, printCost: 23500, designerCost: 7000 },
  'A4 Tapa Dura':   { price: 59990, printCost: 23500, designerCost: 7000 },
  'Cuadro 30x40':   { price: 24990, printCost: 13000, designerCost: 0 },
};

const PRODUCT_TYPES = Object.keys(PRODUCT_CONFIG);

// Distingue cuadros de foto libros
const isCuadroType = (type: string) => type === 'Cuadro 30x40';

// Documento especial dentro de salesRecords que guarda los clientes descartados
// (para que no se vuelvan a importar al sincronizar). Se filtra de la tabla.
// IMPORTANTE: Firestore prohíbe IDs que matcheen __.*__ (con doble guión bajo
// al inicio Y al final), así que no podemos usar "__meta_dismissed__".
const DISMISSED_DOC_ID = 'meta_dismissed';

const STATUS_LABEL: Record<SaleStatus, string> = {
  pending: 'Pendiente',
  done: 'Realizado',
  finalized: 'Finalizado',
};

const STATUS_COLOR: Record<SaleStatus, { color: string; bg: string; border: string }> = {
  pending:   { color: '#b45309', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)' },
  done:      { color: '#1d4ed8', bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.4)' },
  finalized: { color: '#15803d', bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.4)' },
};

const CHART_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6'];

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

function getConfig(productType: string): ProductConfig {
  return PRODUCT_CONFIG[productType] || { price: 0, printCost: 0, designerCost: 0 };
}

function calcRecord(r: SaleRecord) {
  const cfg = getConfig(r.productType);
  const books = r.booksCount || 1;
  const facturado = (r.priceOverride !== undefined && r.priceOverride !== null)
    ? r.priceOverride
    : cfg.price * books;
  const costos = (r.costOverride !== undefined && r.costOverride !== null)
    ? r.costOverride
    : (cfg.printCost + cfg.designerCost) * books;
  const ganancia = facturado - costos;
  return { facturado, costos, ganancia };
}

function toDateInputValue(d: Date) {
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

export default function StatsPanel() {
  const [records, setRecords] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const syncedOnce = useRef(false);

  // Filtros — por defecto muestra TODO para no ocultar pedidos viejos/finalizados
  const today = new Date();
  const [dateFrom, setDateFrom] = useState<string>('2020-01-01');
  const [dateTo, setDateTo] = useState<string>(toDateInputValue(today));
  const [statusFilter, setStatusFilter] = useState<'all' | SaleStatus>('all');
  const [searchName, setSearchName] = useState('');

  // Modal alta
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    date: toDateInputValue(today),
    clientName: '',
    productType: '',
    collectionsCount: 1,
    photosCount: 0,
    booksCount: 1,
    status: 'pending' as SaleStatus,
  });

  useEffect(() => {
    const q = query(collection(db, 'salesRecords'), orderBy('date', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: SaleRecord[] = [];
        snapshot.forEach((d) => {
          if (d.id === DISMISSED_DOC_ID) return; // saltar doc de metadatos
          list.push({ id: d.id, ...d.data() } as SaleRecord);
        });
        setRecords(list);
        setLoading(false);
      },
      (err) => { console.error('Error fetching sales:', err); setLoading(false); }
    );
    return () => unsubscribe();
  }, []);

  // ── Sincronización con clientes (1 registro por cliente) ──
  const syncCollections = async (silent = false) => {
    setSyncing(true);
    if (!silent) setSyncMsg('Sincronizando...');
    try {
      // Lectura fresca de registros existentes
      const existingSnap = await getDocs(collection(db, 'salesRecords'));
      const existingClientIds = new Set<string>();
      const dismissed = new Set<string>();
      const legacyAutoDocs: string[] = []; // registros viejos por-colección a limpiar

      existingSnap.forEach(d => {
        if (d.id === DISMISSED_DOC_ID) {
          (d.data().ids || []).forEach((id: string) => dismissed.add(id));
          return;
        }
        const data = d.data();
        if (data.linkedClientId) existingClientIds.add(data.linkedClientId);
        // Detectar registros del modelo anterior (1 por colección) para eliminarlos
        if (data.linkedCollectionId && !data.linkedClientId) {
          legacyAutoDocs.push(d.id);
        }
      });

      // Limpiar registros viejos por-colección (auto-migración al modelo por-cliente)
      for (const id of legacyAutoDocs) {
        await deleteDoc(doc(db, 'salesRecords', id));
      }

      const usersSnap = await getDocs(collection(db, 'users'));
      let created = 0;

      for (const userDoc of usersSnap.docs) {
        const u = userDoc.data();
        // Saltar cuentas de admin e imprenta (no son clientes)
        if (u.isAdmin || u.isImprenta) continue;
        if (existingClientIds.has(userDoc.id)) continue; // ya tiene registro
        if (dismissed.has(userDoc.id)) continue;          // descartado manualmente

        const colsSnap = await getDocs(collection(db, `users/${userDoc.id}/collections`));
        if (colsSnap.empty) continue; // sin colecciones => no es una venta

        // Sumar fotos de todas las colecciones y tomar la fecha más antigua
        let totalPhotos = 0;
        let earliest: Timestamp | null = null;
        for (const colDoc of colsSnap.docs) {
          const photosSnap = await getDocs(collection(db, `users/${userDoc.id}/collections/${colDoc.id}/photos`));
          totalPhotos += photosSnap.size;
          const cd = colDoc.data().createdAt as Timestamp | undefined;
          if (cd && (!earliest || cd.seconds < earliest.seconds)) earliest = cd;
        }

        // Mapear el estado del cliente al estado del registro de venta
        const clientStatus = u.clientStatus;
        const recordStatus: SaleStatus =
          clientStatus === 'finalized' ? 'finalized'
          : clientStatus === 'done' ? 'done'
          : 'pending';

        const recordId = `client-${userDoc.id}`;
        await setDoc(doc(db, 'salesRecords', recordId), {
          date: earliest || Timestamp.now(),
          clientName: `${u.name || ''} ${u.lastName || ''}`.trim() || u.email || 'Cliente',
          productType: u.photobookType || '',
          collectionsCount: colsSnap.size,
          photosCount: totalPhotos,
          booksCount: 1,
          status: recordStatus,
          userId: userDoc.id,
          linkedClientId: userDoc.id,
          designerPaid: u.designerPaid || false,
          source: 'auto',
          createdAt: Timestamp.now(),
        });
        created++;
        existingClientIds.add(userDoc.id);
      }

      if (!silent) {
        setSyncMsg(created > 0 ? `✓ ${created} cliente(s) importado(s)` : '✓ Todo al día');
        setTimeout(() => setSyncMsg(''), 3500);
      }
    } catch (err) {
      console.error('Error sincronizando clientes:', err);
      if (!silent) {
        setSyncMsg('Error al sincronizar');
        setTimeout(() => setSyncMsg(''), 3500);
      }
    } finally {
      setSyncing(false);
    }
  };

  // Auto-sync una vez al cargar la página
  useEffect(() => {
    if (!loading && !syncedOnce.current) {
      syncedOnce.current = true;
      syncCollections(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Resincroniza SOLO el estado de los registros existentes según el estado
  // actual del cliente (no toca precio, costo, libros ni el pago al diseñador).
  const resyncStatuses = async () => {
    setSyncing(true);
    setSyncMsg('Actualizando estados...');
    try {
      // Lectura fresca de usuarios para obtener el estado actual
      const usersSnap = await getDocs(collection(db, 'users'));
      const statusByUser: Record<string, SaleStatus> = {};
      usersSnap.forEach(d => {
        const cs = d.data().clientStatus;
        statusByUser[d.id] = cs === 'finalized' ? 'finalized' : cs === 'done' ? 'done' : 'pending';
      });

      // Lectura fresca de salesRecords desde Firestore (no desde estado React)
      // para garantizar que trabajamos con los datos actuales y no con caché
      const recordsSnap = await getDocs(collection(db, 'salesRecords'));
      let updated = 0;

      for (const rDoc of recordsSnap.docs) {
        if (rDoc.id === DISMISSED_DOC_ID) continue;
        const data = rDoc.data();
        if (!data.linkedClientId) continue;
        const target = statusByUser[data.linkedClientId];
        if (target && target !== data.status) {
          await updateDoc(doc(db, 'salesRecords', rDoc.id), { status: target });
          updated++;
        }
      }

      setSyncMsg(updated > 0 ? `✓ ${updated} estado(s) actualizado(s)` : '✓ Estados al día');
      setTimeout(() => setSyncMsg(''), 3500);
    } catch (err) {
      console.error('Error resincronizando estados:', err);
      setSyncMsg('Error al actualizar estados');
      setTimeout(() => setSyncMsg(''), 3500);
    } finally {
      setSyncing(false);
    }
  };

  // ── Filtrado ──
  const filtered = useMemo(() => {
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() / 1000 : 0;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() / 1000 : Infinity;
    const nameTerm = searchName.trim().toLowerCase();
    return records.filter(r => {
      const t = r.date?.seconds || 0;
      if (t < fromTs || t > toTs) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (nameTerm && !r.clientName.toLowerCase().includes(nameTerm)) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter]);

  // ── Totales ──
  const totals = useMemo(() => {
    let facturado = 0, costos = 0, ganancia = 0, libros = 0, cuadros = 0;
    filtered.forEach(r => {
      const c = calcRecord(r);
      facturado += c.facturado;
      costos += c.costos;
      ganancia += c.ganancia;
      const units = r.booksCount || 1;
      if (isCuadroType(r.productType)) cuadros += units;
      else if (r.productType) libros += units; // solo cuenta foto libros con tipo asignado
    });
    return { facturado, costos, ganancia, libros, cuadros };
  }, [filtered]);

  // ── Productos más vendidos (por cantidad de libros) ──
  const byProduct = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(r => {
      map[r.productType] = (map[r.productType] || 0) + (r.booksCount || 1);
    });
    return Object.entries(map)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  // ── Actividad diaria (facturado por día) ──
  const byDay = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(r => {
      const d = new Date((r.date?.seconds || 0) * 1000);
      const key = toDateInputValue(d);
      map[key] = (map[key] || 0) + calcRecord(r).facturado;
    });
    return Object.entries(map)
      .map(([day, total]) => ({ day, total }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [filtered]);

  // ── Acciones ──
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.clientName.trim() || !form.productType) return;
    setSaving(true);
    try {
      const id = Date.now().toString() + '-' + Math.floor(Math.random() * 1000);
      await setDoc(doc(db, 'salesRecords', id), {
        date: Timestamp.fromDate(new Date(form.date + 'T12:00:00')),
        clientName: form.clientName.trim(),
        productType: form.productType,
        collectionsCount: Number(form.collectionsCount) || 1,
        photosCount: Number(form.photosCount) || 0,
        booksCount: Number(form.booksCount) || 1,
        status: form.status,
        createdAt: Timestamp.now(),
      });
      setShowAdd(false);
      setForm({
        date: toDateInputValue(today), clientName: '', productType: '',
        collectionsCount: 1, photosCount: 0, booksCount: 1, status: 'pending',
      });
    } catch (err) {
      console.error('Error creando registro:', err);
      alert('Error al crear el registro. Revisá las reglas de Firebase para salesRecords.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateField = async (
    id: string,
    field: 'booksCount' | 'status' | 'productType' | 'priceOverride' | 'costOverride' | 'designerPaid',
    value: number | string | boolean
  ) => {
    try {
      await updateDoc(doc(db, 'salesRecords', id), { [field]: value });
      // El pago al diseñador es el mismo concepto que el del directorio: reflejarlo
      // en el doc del cliente para que ambos lados queden sincronizados.
      if (field === 'designerPaid') {
        const rec = records.find(r => r.id === id);
        const clientId = rec?.linkedClientId || rec?.userId;
        if (clientId) {
          try {
            await updateDoc(doc(db, 'users', clientId), { designerPaid: value as boolean });
          } catch {
            // Registro manual sin cliente vinculado, o cliente inexistente. Ignorar.
          }
        }
      }
    } catch (err) {
      console.error('Error actualizando registro:', err);
    }
  };

  const handleDelete = async (r: SaleRecord) => {
    if (!confirm(`¿Eliminar el registro de "${r.clientName}"?\n\nNo va a volver a sincronizarse desde el directorio.`)) return;
    try {
      // Descartar por userId (vale tanto para registros nuevos como los del
      // modelo anterior). La sincronización chequea contra userId, así que
      // descartar por collectionId no servía y los registros volvían a aparecer.
      const dismissKey = r.linkedClientId || r.userId;

      // 1) Primero registrar el descarte: si falla, el registro NO se borra
      //    y se evita el caso "borrado pero no descartado → vuelve al sincronizar"
      if (dismissKey) {
        await setDoc(
          doc(db, 'salesRecords', DISMISSED_DOC_ID),
          { ids: arrayUnion(dismissKey) },
          { merge: true }
        );
      }

      // 2) Recién después, borrar el registro
      await deleteDoc(doc(db, 'salesRecords', r.id));
    } catch (err) {
      console.error('Error eliminando registro:', err);
      alert('No se pudo eliminar el registro. Probá de nuevo.');
    }
  };

  const setQuickRange = (kind: 'thisMonth' | 'lastMonth' | 'all') => {
    if (kind === 'thisMonth') {
      setDateFrom(toDateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)));
      setDateTo(toDateInputValue(today));
    } else if (kind === 'lastMonth') {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      setDateFrom(toDateInputValue(first));
      setDateTo(toDateInputValue(last));
    } else {
      setDateFrom('2020-01-01');
      setDateTo(toDateInputValue(today));
    }
  };

  const maxProduct = Math.max(1, ...byProduct.map(p => p.count));
  const maxDay = Math.max(1, ...byDay.map(d => d.total));

  const inputStyle: React.CSSProperties = {
    padding: '0.5rem 0.65rem', borderRadius: 'var(--radius)',
    border: '1px solid var(--border)', backgroundColor: 'var(--background)',
    color: 'var(--foreground)', fontSize: '0.875rem',
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '1rem', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Volver al Directorio
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <BarChart3 size={28} color="#6366f1" /> Estadísticas
          </h2>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {syncMsg && (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>{syncMsg}</span>
            )}
            <button
              onClick={() => syncCollections(false)}
              disabled={syncing}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                border: '1px solid var(--border)',
                padding: '0.6rem 1.1rem', borderRadius: 'var(--radius)', fontWeight: 600,
                cursor: syncing ? 'not-allowed' : 'pointer', fontSize: '0.9rem',
                opacity: syncing ? 0.6 : 1,
              }}
              title="Importar colecciones de clientes que aún no están en la tabla"
            >
              <RefreshCw size={16} style={syncing ? { animation: 'spin 1s linear infinite' } : undefined} />
              {syncing ? 'Sincronizando...' : 'Sincronizar'}
            </button>
            <button
              onClick={resyncStatuses}
              disabled={syncing}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                border: '1px solid var(--border)',
                padding: '0.6rem 1.1rem', borderRadius: 'var(--radius)', fontWeight: 600,
                cursor: syncing ? 'not-allowed' : 'pointer', fontSize: '0.9rem',
                opacity: syncing ? 0.6 : 1,
              }}
              title="Actualizar el estado de los registros según el estado actual del cliente (no toca precio, costo ni libros)"
            >
              <RotateCcw size={16} />
              Resincronizar estados
            </button>
            <button
              onClick={() => setShowAdd(true)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                backgroundColor: 'var(--primary)', color: 'white', border: 'none',
                padding: '0.6rem 1.1rem', borderRadius: 'var(--radius)', fontWeight: 600,
                cursor: 'pointer', fontSize: '0.9rem',
              }}
            >
              <Plus size={18} /> Agregar registro
            </button>
          </div>
          <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>

      {/* Filtros */}
      <div style={{
        backgroundColor: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '1rem 1.25rem', marginBottom: '1.5rem',
        display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Desde</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Hasta</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Estado</label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | SaleStatus)} style={{ ...inputStyle, cursor: 'pointer' }}>
            <option value="all">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="done">Realizado</option>
            <option value="finalized">Finalizado</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', marginLeft: 'auto' }}>
          <button onClick={() => setQuickRange('thisMonth')} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600 }}>Este mes</button>
          <button onClick={() => setQuickRange('lastMonth')} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600 }}>Mes pasado</button>
          <button onClick={() => setQuickRange('all')} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600 }}>Todo</button>
        </div>
      </div>

      {/* Cards resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <SummaryCard icon={<TrendingUp size={20} />} label="Ganancia" value={fmt(totals.ganancia)} accent="#16a34a" />
        <SummaryCard icon={<DollarSign size={20} />} label="Facturado (bruto)" value={fmt(totals.facturado)} accent="#6366f1" />
        <SummaryCard icon={<Wallet size={20} />} label="Costos" value={fmt(totals.costos)} accent="#ef4444" />
        <SummaryCard icon={<BookOpen size={20} />} label="Libros vendidos" value={String(totals.libros)} accent="#f59e0b" />
        <SummaryCard icon={<Frame size={20} />} label="Cuadros vendidos" value={String(totals.cuadros)} accent="#8b5cf6" />
      </div>

      {/* Gráficos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Productos más vendidos */}
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Productos más vendidos</h3>
          {byProduct.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos en este período.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {byProduct.map((p, i) => (
                <div key={p.type}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 600, fontStyle: p.type ? 'normal' : 'italic', color: p.type ? 'inherit' : 'var(--text-muted)' }}>
                      {p.type || 'Sin especificar'}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{p.count}</span>
                  </div>
                  <div style={{ height: '10px', backgroundColor: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(p.count / maxProduct) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], borderRadius: '5px', transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actividad diaria */}
        <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.25rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Calendar size={16} /> Actividad de ventas diaria
          </h3>
          {byDay.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos en este período.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4rem', height: '160px', overflowX: 'auto', paddingTop: '0.5rem' }}>
              {byDay.map((d) => (
                <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem', minWidth: '32px', flex: 1 }} title={`${d.day}: ${fmt(d.total)}`}>
                  <div style={{
                    width: '100%',
                    maxWidth: '34px',
                    height: `${Math.max(4, (d.total / maxDay) * 120)}px`,
                    backgroundColor: '#6366f1',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s',
                  }} />
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {d.day.slice(8, 10)}/{d.day.slice(5, 7)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabla */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
          Registros ({filtered.length})
        </h3>
        <div style={{ position: 'relative', minWidth: '220px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Buscar por nombre..."
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem 0.5rem 2rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--background)',
              color: 'var(--foreground)',
              fontSize: '0.875rem',
            }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando registros...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <BarChart3 size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
          <p style={{ color: 'var(--text-muted)' }}>No hay registros en este período. Agregá uno con el botón &quot;+&quot;.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', minWidth: '900px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--surface)', textAlign: 'left' }}>
                {['Fecha', 'Cliente', 'Producto', 'Colecciones', 'Fotos', 'Unidades', 'Facturado', 'Costos', 'Ganancia', 'Estado', 'Dis. pagado', ''].map((h) => (
                  <th key={h} style={{ padding: '0.7rem 0.8rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const c = calcRecord(r);
                const sc = STATUS_COLOR[r.status] || STATUS_COLOR.pending;
                const d = new Date((r.date?.seconds || 0) * 1000);
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 0.8rem', whiteSpace: 'nowrap' }}>{toDateInputValue(d).split('-').reverse().join('/')}</td>
                    <td style={{ padding: '0.6rem 0.8rem', fontWeight: 600 }}>{r.clientName}</td>
                    <td style={{ padding: '0.6rem 0.8rem' }}>
                      <select
                        value={r.productType || ''}
                        onChange={(e) => handleUpdateField(r.id, 'productType', e.target.value)}
                        style={{ padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '0.78rem', cursor: 'pointer', maxWidth: '140px' }}
                      >
                        <option value="">—</option>
                        {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>{r.collectionsCount}</td>
                    <td style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>{r.photosCount}</td>
                    <td style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>
                      <input
                        type="number"
                        min={1}
                        value={r.booksCount || 1}
                        onChange={(e) => handleUpdateField(r.id, 'booksCount', Number(e.target.value) || 1)}
                        style={{ width: '50px', padding: '0.25rem', textAlign: 'center', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem', whiteSpace: 'nowrap' }}>
                      <input
                        type="number"
                        key={`price-${r.id}-${r.productType}-${r.booksCount}-${r.priceOverride ?? ''}`}
                        defaultValue={c.facturado}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!isNaN(v) && v !== c.facturado) handleUpdateField(r.id, 'priceOverride', v);
                        }}
                        title="Editá para forzar el precio (ej. descuento)"
                        style={{ width: '92px', padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem', whiteSpace: 'nowrap' }}>
                      <input
                        type="number"
                        key={`cost-${r.id}-${r.productType}-${r.booksCount}-${r.costOverride ?? ''}`}
                        defaultValue={c.costos}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (!isNaN(v) && v !== c.costos) handleUpdateField(r.id, 'costOverride', v);
                        }}
                        title="Editá para forzar el costo"
                        style={{ width: '92px', padding: '0.25rem 0.4rem', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: '#ef4444' }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem', whiteSpace: 'nowrap', fontWeight: 700, color: '#16a34a' }}>{fmt(c.ganancia)}</td>
                    <td style={{ padding: '0.6rem 0.8rem' }}>
                      <select
                        value={r.status}
                        onChange={(e) => handleUpdateField(r.id, 'status', e.target.value)}
                        style={{ padding: '0.25rem 0.4rem', borderRadius: '6px', border: `1px solid ${sc.border}`, backgroundColor: sc.bg, color: sc.color, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        <option value="pending">Pendiente</option>
                        <option value="done">Realizado</option>
                        <option value="finalized">Finalizado</option>
                      </select>
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!r.designerPaid}
                        onChange={(e) => handleUpdateField(r.id, 'designerPaid', e.target.checked)}
                        title={r.designerPaid ? 'Diseñador pagado' : 'Pendiente de pago al diseñador'}
                        style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#16a34a' }}
                      />
                    </td>
                    <td style={{ padding: '0.6rem 0.8rem' }}>
                      <button onClick={() => handleDelete(r)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'inline-flex' }} title="Eliminar registro">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal alta ── */}
      {showAdd && (
        <div
          onClick={() => !saving && setShowAdd(false)}
          style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', backdropFilter: 'blur(3px)' }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', padding: '1.75rem', width: '100%', maxWidth: '480px', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Plus size={20} color="var(--primary)" /> Nuevo registro
              </h3>
              <button onClick={() => setShowAdd(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            <form onSubmit={handleAdd}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '0.85rem' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Cliente *</label>
                  <input type="text" value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} required style={{ ...inputStyle, width: '100%' }} placeholder="Nombre del cliente" />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Producto *</label>
                  <select value={form.productType} onChange={(e) => setForm({ ...form, productType: e.target.value })} required style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                    <option value="">— Elegí un producto —</option>
                    {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t} {PRODUCT_CONFIG[t].price > 0 ? `(${fmt(PRODUCT_CONFIG[t].price)})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Fecha</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={labelStyle}>Estado</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as SaleStatus })} style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                    <option value="pending">Pendiente</option>
                    <option value="done">Realizado</option>
                    <option value="finalized">Finalizado</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Colecciones</label>
                  <input type="number" min={0} value={form.collectionsCount} onChange={(e) => setForm({ ...form, collectionsCount: Number(e.target.value) })} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={labelStyle}>Fotos</label>
                  <input type="number" min={0} value={form.photosCount} onChange={(e) => setForm({ ...form, photosCount: Number(e.target.value) })} style={{ ...inputStyle, width: '100%' }} />
                </div>
                <div>
                  <label style={labelStyle}>Libros</label>
                  <input type="number" min={1} value={form.booksCount} onChange={(e) => setForm({ ...form, booksCount: Number(e.target.value) })} style={{ ...inputStyle, width: '100%' }} />
                </div>
              </div>

              {form.productType && (
                <div style={{ backgroundColor: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 'var(--radius)', padding: '0.7rem 0.9rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
                  {(() => {
                    const cfg = getConfig(form.productType);
                    const b = Number(form.booksCount) || 1;
                    const fac = cfg.price * b;
                    const cos = (cfg.printCost + cfg.designerCost) * b;
                    return (
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span>Facturado: <strong>{fmt(fac)}</strong></span>
                        <span style={{ color: '#ef4444' }}>Costos: <strong>{fmt(cos)}</strong></span>
                        <span style={{ color: '#16a34a' }}>Ganancia: <strong>{fmt(fac - cos)}</strong></span>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                <button type="button" onClick={() => setShowAdd(false)} disabled={saving} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
                <button type="submit" disabled={saving || !form.clientName.trim() || !form.productType} style={{ backgroundColor: 'var(--primary)', color: 'white', border: 'none', padding: '0.5rem 1.25rem', borderRadius: 'var(--radius)', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving || !form.clientName.trim() || !form.productType ? 0.6 : 1 }}>
                  {saving ? 'Guardando...' : 'Agregar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.75rem', fontWeight: 600,
  color: 'var(--text-muted)', marginBottom: '0.25rem',
};

function SummaryCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <div style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '1.1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: accent, marginBottom: '0.5rem' }}>
        {icon}
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--foreground)' }}>{value}</div>
    </div>
  );
}
