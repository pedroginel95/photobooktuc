'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  collection, onSnapshot, query, orderBy,
  doc, setDoc, updateDoc, deleteDoc, Timestamp, getDocs
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import {
  BarChart3, ArrowLeft, Plus, X, Trash2, TrendingUp,
  DollarSign, Wallet, BookOpen, Calendar, RefreshCw
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
  userId?: string;
  linkedCollectionId?: string;
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
  const facturado = cfg.price * books;
  const costos = (cfg.printCost + cfg.designerCost) * books;
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

  // Filtros
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [dateFrom, setDateFrom] = useState<string>(toDateInputValue(firstOfMonth));
  const [dateTo, setDateTo] = useState<string>(toDateInputValue(today));
  const [statusFilter, setStatusFilter] = useState<'all' | SaleStatus>('all');

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
        snapshot.forEach((d) => list.push({ id: d.id, ...d.data() } as SaleRecord));
        setRecords(list);
        setLoading(false);
      },
      (err) => { console.error('Error fetching sales:', err); setLoading(false); }
    );
    return () => unsubscribe();
  }, []);

  // ── Sincronización con colecciones de clientes ──
  const syncCollections = async (silent = false) => {
    setSyncing(true);
    if (!silent) setSyncMsg('Sincronizando...');
    try {
      // IDs de colecciones ya importadas (lectura fresca para evitar duplicados)
      const existingSnap = await getDocs(collection(db, 'salesRecords'));
      const existingIds = new Set<string>();
      existingSnap.forEach(d => {
        const lc = d.data().linkedCollectionId;
        if (lc) existingIds.add(lc);
      });

      const usersSnap = await getDocs(collection(db, 'users'));
      let created = 0;

      for (const userDoc of usersSnap.docs) {
        const u = userDoc.data();
        // Saltar cuentas de admin e imprenta (no son clientes)
        if (u.isAdmin || u.isImprenta) continue;

        const colsSnap = await getDocs(collection(db, `users/${userDoc.id}/collections`));

        for (const colDoc of colsSnap.docs) {
          if (existingIds.has(colDoc.id)) continue; // ya importada

          const colData = colDoc.data();
          // Contar fotos de la colección
          const photosSnap = await getDocs(collection(db, `users/${userDoc.id}/collections/${colDoc.id}/photos`));

          const recordId = `auto-${colDoc.id}`;
          await setDoc(doc(db, 'salesRecords', recordId), {
            date: colData.createdAt || Timestamp.now(),
            clientName: `${u.name || ''} ${u.lastName || ''}`.trim() || u.email || 'Cliente',
            productType: u.photobookType || '',
            collectionsCount: 1,
            photosCount: photosSnap.size,
            booksCount: 1,
            status: 'pending',
            userId: userDoc.id,
            linkedCollectionId: colDoc.id,
            source: 'auto',
            createdAt: Timestamp.now(),
          });
          created++;
          existingIds.add(colDoc.id);
        }
      }

      if (!silent) {
        setSyncMsg(created > 0 ? `✓ ${created} colección(es) importada(s)` : '✓ Todo al día');
        setTimeout(() => setSyncMsg(''), 3500);
      }
    } catch (err) {
      console.error('Error sincronizando colecciones:', err);
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

  // ── Filtrado ──
  const filtered = useMemo(() => {
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00').getTime() / 1000 : 0;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() / 1000 : Infinity;
    return records.filter(r => {
      const t = r.date?.seconds || 0;
      if (t < fromTs || t > toTs) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      return true;
    });
  }, [records, dateFrom, dateTo, statusFilter]);

  // ── Totales ──
  const totals = useMemo(() => {
    let facturado = 0, costos = 0, ganancia = 0, libros = 0;
    filtered.forEach(r => {
      const c = calcRecord(r);
      facturado += c.facturado;
      costos += c.costos;
      ganancia += c.ganancia;
      libros += r.booksCount || 1;
    });
    return { facturado, costos, ganancia, libros };
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

  const handleUpdateField = async (id: string, field: 'booksCount' | 'status', value: number | string) => {
    try {
      await updateDoc(doc(db, 'salesRecords', id), { [field]: value });
    } catch (err) {
      console.error('Error actualizando registro:', err);
    }
  };

  const handleDelete = async (r: SaleRecord) => {
    if (!confirm(`¿Eliminar el registro de "${r.clientName}"?`)) return;
    try {
      await deleteDoc(doc(db, 'salesRecords', r.id));
    } catch (err) {
      console.error('Error eliminando registro:', err);
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
                    <span style={{ fontWeight: 600 }}>{p.type}</span>
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
      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
        Registros ({filtered.length})
      </h3>

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
                {['Fecha', 'Cliente', 'Producto', 'Colecciones', 'Fotos', 'Libros', 'Facturado', 'Costos', 'Ganancia', 'Estado', ''].map((h) => (
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
                    <td style={{ padding: '0.6rem 0.8rem', whiteSpace: 'nowrap' }}>{r.productType}</td>
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
                    <td style={{ padding: '0.6rem 0.8rem', whiteSpace: 'nowrap' }}>{fmt(c.facturado)}</td>
                    <td style={{ padding: '0.6rem 0.8rem', whiteSpace: 'nowrap', color: '#ef4444' }}>{fmt(c.costos)}</td>
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
