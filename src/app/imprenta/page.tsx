'use client';

import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Briefcase, FileText, Circle, CheckCircle2, DollarSign, ExternalLink, StickyNote } from 'lucide-react';

interface PrintJob {
  id: string;
  name: string;
  photobookType: string;
  notes: string;
  pdfUrl: string;
  pdfFilename: string;
  status: 'pending' | 'done' | 'paid';
  createdAt?: { seconds: number };
}

type JobStatus = 'pending' | 'done' | 'paid';

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
      await updateDoc(doc(db, 'printJobs', jobId), { status: newStatus });
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
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2.2rem', fontWeight: 800, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Briefcase size={32} color="#4338ca" /> Trabajos
        </h2>
        <p style={{ color: 'var(--text-muted)' }}>Gestioná los trabajos asignados a tu imprenta moviéndolos entre estados.</p>
      </div>

      {loading ? (
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
      )}
    </div>
  );
}
