'use client';

import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, deleteField, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Briefcase, FileText, Circle, CheckCircle2, DollarSign, ExternalLink, StickyNote, Clock, Download, Calendar, Search } from 'lucide-react';

interface PrintJob {
  id: string;
  name: string;
  photobookType: string;
  notes: string;
  pdfUrl: string;
  pdfFilename: string;
  status: 'pending' | 'done' | 'paid';
  createdAt?: { seconds: number };
  statusUpdatedAt?: { seconds: number };
  doneAt?: { seconds: number };
  paidAt?: { seconds: number };
  pages?: number;
  costOverride?: number;
}

type JobStatus = 'pending' | 'done' | 'paid';

// ── Costos (mismo modelo que en el panel admin) ──
const COVER_COST: Record<string, number> = {
  'A4 Tapa Blanda': 6500,
  'A5 Tapa Blanda': 4500,
  'A4 Tapa Dura': 8500,
  'A5 Tapa Dura': 5000,
};
const pageRate = (type: string) => (type.includes('A4') ? 500 : type.includes('A5') ? 300 : 0);
const COVER_PAGES = 2;
const CUADRO_COST = 1500;

function costBreakdown(job: PrintJob): { tapa: number; pages: number; total: number; kind: 'book' | 'cuadro' | 'other' } {
  const cover = COVER_COST[job.photobookType];
  if (cover !== undefined) {
    const printable = Math.max(0, Math.round(job.pages || 0) - COVER_PAGES);
    const pagesCost = printable * pageRate(job.photobookType);
    return { tapa: cover, pages: pagesCost, total: cover + pagesCost, kind: 'book' };
  }
  if (job.photobookType === 'Cuadro 30x40') return { tapa: 0, pages: 0, total: CUADRO_COST, kind: 'cuadro' };
  return { tapa: 0, pages: 0, total: 0, kind: 'other' };
}
function jobTotal(job: PrintJob): number {
  if (typeof job.costOverride === 'number' && Number.isFinite(job.costOverride)) return job.costOverride;
  return costBreakdown(job).total;
}
const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

// Fecha corta dd/mm/aa a partir de un Timestamp de Firestore.
function fmtStatusDate(ts?: { seconds: number }) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pendiente',
  done: 'Realizado',
  paid: 'Cobrado',
};

const STATUS_COLOR: Record<JobStatus, { bg: string; color: string; border: string; chipBg: string }> = {
  pending: { bg: 'rgba(245,158,11,0.05)', color: '#b45309', border: 'rgba(245,158,11,0.35)', chipBg: 'rgba(245,158,11,0.15)' },
  done:    { bg: 'rgba(59,130,246,0.05)', color: '#1d4ed8', border: 'rgba(59,130,246,0.35)', chipBg: 'rgba(59,130,246,0.15)' },
  paid:    { bg: 'rgba(34,197,94,0.05)',  color: '#15803d', border: 'rgba(34,197,94,0.35)',  chipBg: 'rgba(34,197,94,0.15)'  },
};

export default function ImprentaPanel() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // Vista: trabajos o calculadora de costos
  const [view, setView] = useState<'jobs' | 'costs'>('jobs');
  const [searchJob, setSearchJob] = useState('');
  const [costDateField, setCostDateField] = useState<'done' | 'paid'>('paid');
  const [costFrom, setCostFrom] = useState('');
  const [costTo, setCostTo] = useState('');

  const handleUpdatePages = async (jobId: string, value: number) => {
    try {
      await updateDoc(doc(db, 'printJobs', jobId), { pages: Math.max(0, Math.round(value)) });
    } catch (err) {
      console.error('Error actualizando páginas:', err);
      alert('No se pudo guardar la cantidad de páginas. Puede que falte publicar las reglas.');
    }
  };

  const handleUpdateCost = async (jobId: string, value: number) => {
    try {
      await updateDoc(doc(db, 'printJobs', jobId), { costOverride: value });
    } catch (err) {
      console.error('Error actualizando costo:', err);
      alert('No se pudo guardar el costo. Puede que falte publicar las reglas.');
    }
  };

  const handleClearOverride = async (jobId: string) => {
    try {
      await updateDoc(doc(db, 'printJobs', jobId), { costOverride: deleteField() });
    } catch (err) {
      console.error('Error quitando el costo forzado:', err);
      alert('No se pudo volver al cálculo automático.');
    }
  };

  // Descarga directa del PDF (sin abrirlo). Usa el proxy interno para evitar
  // problemas de CORS con Firebase Storage y forzar la descarga.
  const handleDownloadPdf = async (job: PrintJob) => {
    if (!job.pdfUrl) return;
    setDownloadingId(job.id);
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(job.pdfUrl)}`);
      if (!res.ok) throw new Error('No se pudo obtener el archivo');
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = job.pdfFilename || `${job.name || 'trabajo'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch (err) {
      console.error('Error descargando el PDF:', err);
      alert('No se pudo descargar el PDF. Probá de nuevo.');
    } finally {
      setDownloadingId(null);
    }
  };

  useEffect(() => {
    const q = query(collection(db, 'printJobs'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: PrintJob[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as PrintJob);
        });
        setJobs(list);
        setLoading(false);
      },
      (error) => {
        console.error('Error fetching jobs:', error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleChangeStatus = async (jobId: string, newStatus: JobStatus) => {
    setUpdatingId(jobId);
    try {
      const now = Timestamp.now();
      const full: Record<string, unknown> = { status: newStatus, statusUpdatedAt: now };
      if (newStatus === 'done') full.doneAt = now;
      if (newStatus === 'paid') full.paidAt = now;
      const ref = doc(db, 'printJobs', jobId);
      // Intentos escalonados según lo que permitan las reglas del rol imprenta:
      // 1) estado + todas las fechas; 2) estado + statusUpdatedAt; 3) solo estado.
      try {
        await updateDoc(ref, full);
      } catch {
        try {
          await updateDoc(ref, { status: newStatus, statusUpdatedAt: now });
        } catch (e2) {
          console.warn('Reglas restringidas; guardando solo status:', e2);
          await updateDoc(ref, { status: newStatus });
        }
      }
    } catch (error) {
      console.error('Error actualizando estado:', error);
      alert('No se pudo actualizar el estado.');
    } finally {
      setUpdatingId(null);
    }
  };

  const grouped: Record<JobStatus, PrintJob[]> = {
    pending: jobs.filter(j => (j.status || 'pending') === 'pending'),
    done:    jobs.filter(j => j.status === 'done'),
    paid:    jobs.filter(j => j.status === 'paid'),
  };

  // ── Calculadora de costos ──
  const searchTerm = searchJob.trim().toLowerCase();
  const targetStatus: JobStatus = costDateField === 'done' ? 'done' : 'paid';
  const jobDateSec = (j: PrintJob): number | undefined => {
    if ((j.status || 'pending') !== targetStatus) return undefined;
    const ts = costDateField === 'done' ? j.doneAt : j.paidAt;
    return ts?.seconds ?? j.statusUpdatedAt?.seconds;
  };
  const costFromTs = costFrom ? new Date(costFrom + 'T00:00:00').getTime() / 1000 : 0;
  const costToTs = costTo ? new Date(costTo + 'T23:59:59').getTime() / 1000 : Infinity;
  const costJobs = jobs
    .filter(j => {
      const sec = jobDateSec(j);
      if (sec === undefined) return false;
      if (sec < costFromTs || sec > costToTs) return false;
      if (searchTerm && !(j.name || '').toLowerCase().includes(searchTerm)) return false;
      return true;
    })
    .sort((a, b) => (jobDateSec(b) || 0) - (jobDateSec(a) || 0));
  const costTotal = costJobs.reduce((sum, j) => sum + jobTotal(j), 0);

  const costTh: React.CSSProperties = { padding: '0.6rem 0.7rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', textAlign: 'left' };
  const costTd: React.CSSProperties = { padding: '0.55rem 0.7rem', whiteSpace: 'nowrap' };
  const costFilterInput: React.CSSProperties = { padding: '0.5rem 0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '0.85rem', cursor: 'pointer' };

  const renderJobCard = (job: PrintJob) => {
    const status = (job.status || 'pending') as JobStatus;
    const colors = STATUS_COLOR[status];

    return (
      <div
        key={job.id}
        style={{
          backgroundColor: 'var(--surface)',
          border: `1px solid ${colors.border}`,
          borderRadius: 'var(--radius)',
          padding: '1rem 1.1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
        }}
      >
        <div>
          <h4 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>{job.name}</h4>
          {job.photobookType && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              fontSize: '0.72rem',
              backgroundColor: 'rgba(245,158,11,0.12)',
              color: '#b45309',
              padding: '0.15rem 0.55rem',
              borderRadius: '999px',
              fontWeight: 600,
              border: '1px solid rgba(245,158,11,0.3)',
            }}>
              📖 {job.photobookType}
            </span>
          )}
        </div>

        {job.notes && job.notes.trim() && (
          <div style={{
            padding: '0.5rem 0.7rem',
            backgroundColor: 'rgba(245,158,11,0.06)',
            border: '1px dashed rgba(245,158,11,0.3)',
            borderRadius: 'calc(var(--radius) - 0.2rem)',
            fontSize: '0.78rem',
            color: '#78350f',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#b45309', marginBottom: '0.25rem' }}>
              <StickyNote size={10} /> Notas
            </div>
            {job.notes}
          </div>
        )}

        {job.pdfUrl && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <a
              href={job.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius)',
                backgroundColor: 'rgba(59,130,246,0.1)',
                color: '#1d4ed8',
                border: '1px solid rgba(59,130,246,0.3)',
                fontSize: '0.82rem',
                fontWeight: 600,
                textDecoration: 'none',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(59,130,246,0.18)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(59,130,246,0.1)'; }}
            >
              <FileText size={14} /> Ver PDF
              <ExternalLink size={12} style={{ opacity: 0.7 }} />
            </a>
            <button
              onClick={() => handleDownloadPdf(job)}
              disabled={downloadingId === job.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius)',
                backgroundColor: '#1d4ed8',
                color: 'white',
                border: 'none',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: downloadingId === job.id ? 'not-allowed' : 'pointer',
                opacity: downloadingId === job.id ? 0.7 : 1,
                transition: 'all 0.2s',
              }}
              title="Descargar el PDF directamente"
            >
              <Download size={14} /> {downloadingId === job.id ? 'Descargando...' : 'Descargar'}
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: 'auto' }}>
          {(['pending', 'done', 'paid'] as JobStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => handleChangeStatus(job.id, s)}
              disabled={updatingId === job.id || s === status}
              style={{
                flex: 1,
                minWidth: '70px',
                padding: '0.4rem 0.5rem',
                borderRadius: 'calc(var(--radius) - 0.2rem)',
                border: `1px solid ${s === status ? STATUS_COLOR[s].border : 'var(--border)'}`,
                backgroundColor: s === status ? STATUS_COLOR[s].chipBg : 'var(--background)',
                color: s === status ? STATUS_COLOR[s].color : 'var(--text-muted)',
                fontSize: '0.72rem',
                fontWeight: 600,
                cursor: updatingId === job.id || s === status ? 'default' : 'pointer',
                transition: 'all 0.15s',
                opacity: updatingId === job.id ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (s !== status && updatingId !== job.id) {
                  e.currentTarget.style.borderColor = STATUS_COLOR[s].border;
                  e.currentTarget.style.color = STATUS_COLOR[s].color;
                }
              }}
              onMouseLeave={(e) => {
                if (s !== status) {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.color = 'var(--text-muted)';
                }
              }}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>

        {job.statusUpdatedAt && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <Clock size={11} /> Estado actualizado: {fmtStatusDate(job.statusUpdatedAt)}
          </div>
        )}
      </div>
    );
  };

  const renderColumn = (status: JobStatus, icon: React.ReactNode) => {
    const colJobs = grouped[status];
    const colors = STATUS_COLOR[status];
    return (
      <div style={{
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 'var(--radius)',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        minHeight: '300px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          paddingBottom: '0.75rem',
          borderBottom: `1px solid ${colors.border}`,
        }}>
          <h3 style={{
            fontSize: '0.95rem',
            fontWeight: 700,
            color: colors.color,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.45rem',
          }}>
            {icon}
            {STATUS_LABEL[status]}
          </h3>
          <span style={{
            fontSize: '0.78rem',
            fontWeight: 700,
            color: colors.color,
            backgroundColor: colors.chipBg,
            padding: '0.15rem 0.55rem',
            borderRadius: '999px',
          }}>
            {colJobs.length}
          </span>
        </div>

        {colJobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.85rem', opacity: 0.6 }}>
            Sin trabajos en este estado.
          </div>
        ) : (
          colJobs.map(renderJobCard)
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h2 style={{ fontSize: '2.2rem', fontWeight: 800, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Briefcase size={32} color="#4338ca" /> Imprenta
        </h2>
        <p style={{ color: 'var(--text-muted)' }}>Gestioná los trabajos y calculá los costos.</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.75rem', backgroundColor: 'var(--surface)', padding: '0.4rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', width: 'fit-content' }}>
        {([['jobs', 'Trabajos', <Briefcase size={16} key="b" />], ['costs', 'Costos', <DollarSign size={16} key="d" />]] as const).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setView(key as 'jobs' | 'costs')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.55rem 1.15rem', borderRadius: 'var(--radius)', fontWeight: 600,
              fontSize: '0.9rem', cursor: 'pointer', border: 'none',
              backgroundColor: view === key ? 'var(--primary)' : 'transparent',
              color: view === key ? 'white' : 'var(--text-muted)',
            }}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {view === 'jobs' && (
        loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando trabajos...</div>
        ) : jobs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <Briefcase size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
            <p style={{ color: 'var(--text-muted)' }}>Todavía no hay trabajos asignados.</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.25rem',
          }}>
            {renderColumn('pending', <Circle size={16} />)}
            {renderColumn('done', <CheckCircle2 size={16} />)}
            {renderColumn('paid', <DollarSign size={16} />)}
          </div>
        )
      )}

      {view === 'costs' && (
        <div>
          {/* Filtros */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Filtrar por fecha de</label>
              <select value={costDateField} onChange={(e) => setCostDateField(e.target.value as 'done' | 'paid')} style={costFilterInput}>
                <option value="paid">Cobrado</option>
                <option value="done">Realizado</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Desde</label>
              <input type="date" value={costFrom} onChange={(e) => setCostFrom(e.target.value)} style={{ ...costFilterInput, cursor: 'text' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Hasta</label>
              <input type="date" value={costTo} onChange={(e) => setCostTo(e.target.value)} style={{ ...costFilterInput, cursor: 'text' }} />
            </div>
            {(costFrom || costTo) && (
              <button onClick={() => { setCostFrom(''); setCostTo(''); }} style={{ padding: '0.5rem 0.9rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)', fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }}>
                Limpiar
              </button>
            )}
            <div style={{ position: 'relative', minWidth: '200px' }}>
              <Search size={14} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <input type="text" placeholder="Buscar por cliente..." value={searchJob} onChange={(e) => setSearchJob(e.target.value)} style={{ ...costFilterInput, cursor: 'text', width: '100%', paddingLeft: '1.9rem' }} />
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Costo total ({costJobs.length} trabajo{costJobs.length !== 1 ? 's' : ''})</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ef4444' }}>{fmtMoney(costTotal)}</div>
            </div>
          </div>

          {costJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <Calendar size={40} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
              No hay trabajos {targetStatus === 'done' ? 'realizados' : 'cobrados'} en este período.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '760px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface)' }}>
                    {['Cliente / Trabajo', 'Producto', 'Realizado', 'Cobrado', 'Págs.', 'Tapa', 'Páginas', 'Total'].map((h) => (
                      <th key={h} style={costTh}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {costJobs.map((job) => {
                    const parts = costBreakdown(job);
                    const isBook = parts.kind === 'book';
                    const forced = typeof job.costOverride === 'number';
                    return (
                      <tr key={job.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ ...costTd, fontWeight: 600 }}>{job.name}</td>
                        <td style={costTd}>{job.photobookType}</td>
                        <td style={costTd}>{job.doneAt ? fmtStatusDate(job.doneAt) : '—'}</td>
                        <td style={costTd}>{job.paidAt ? fmtStatusDate(job.paidAt) : '—'}</td>
                        <td style={costTd}>
                          {isBook ? (
                            <input
                              type="number"
                              min={0}
                              step={1}
                              key={`pages-${job.id}-${job.pages ?? ''}`}
                              defaultValue={job.pages ?? ''}
                              placeholder="—"
                              onBlur={(e) => {
                                const v = parseInt(e.target.value, 10);
                                if (!isNaN(v) && v !== (job.pages || 0)) handleUpdatePages(job.id, v);
                              }}
                              title="Páginas del archivo total (incluye las 2 de la tapa)"
                              style={{ width: '62px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                            />
                          ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={costTd}>{isBook ? fmtMoney(parts.tapa) : '—'}</td>
                        <td style={costTd}>{isBook ? fmtMoney(parts.pages) : '—'}</td>
                        <td style={costTd}>
                          <span style={{ color: 'var(--text-muted)', marginRight: '0.2rem' }}>$</span>
                          <input
                            type="number"
                            key={`total-${job.id}-${job.costOverride ?? ''}-${job.pages ?? ''}`}
                            defaultValue={jobTotal(job)}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!isNaN(v) && v !== jobTotal(job)) handleUpdateCost(job.id, v);
                            }}
                            title={forced ? 'Total forzado' : 'Total calculado (tapa + páginas). Editalo para forzarlo.'}
                            style={{ width: '92px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: `1px solid ${forced ? 'rgba(245,158,11,0.55)' : 'var(--border)'}`, backgroundColor: 'var(--background)', color: 'var(--foreground)', fontWeight: 600 }}
                          />
                          {forced && (
                            <button
                              onClick={() => handleClearOverride(job.id)}
                              title="Volver al cálculo automático (tapa + páginas)"
                              style={{ marginLeft: '0.3rem', fontSize: '0.62rem', fontWeight: 700, color: '#b45309', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                              forzado ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.9rem', lineHeight: 1.5 }}>
            Cálculo: tapa + páginas. Tapa: A4 Dura {fmtMoney(8500)} · A5 Dura {fmtMoney(5000)} · A4 Blanda {fmtMoney(6500)} · A5 Blanda {fmtMoney(4500)}.
            Páginas = (páginas del archivo − 2) × {fmtMoney(500)} en A4 / {fmtMoney(300)} en A5. Cuadro 30x40: {fmtMoney(1500)}.
            Cargá las páginas en la columna Págs.
          </p>
        </div>
      )}
    </div>
  );
}
