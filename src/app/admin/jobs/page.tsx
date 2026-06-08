'use client';

import React, { useEffect, useState } from 'react';
import {
  collection, onSnapshot, query, orderBy,
  doc, setDoc, deleteDoc, updateDoc, Timestamp
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import Link from 'next/link';
import {
  Briefcase, Plus, FileText, Trash2, ExternalLink,
  Circle, CheckCircle2, DollarSign, UploadCloud, X, StickyNote, ArrowLeft
} from 'lucide-react';

interface PrintJob {
  id: string;
  name: string;
  photobookType: string;
  notes: string;
  pdfUrl: string;
  pdfFilename: string;
  pdfStoragePath?: string;
  status: 'pending' | 'done' | 'paid';
  createdAt?: { seconds: number };
}

type JobStatus = 'pending' | 'done' | 'paid';

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pendiente',
  done: 'Realizado',
  paid: 'Cobrado',
};

const STATUS_COLOR: Record<JobStatus, { color: string; border: string; chipBg: string }> = {
  pending: { color: '#b45309', border: 'rgba(245,158,11,0.35)', chipBg: 'rgba(245,158,11,0.15)' },
  done:    { color: '#1d4ed8', border: 'rgba(59,130,246,0.35)', chipBg: 'rgba(59,130,246,0.15)' },
  paid:    { color: '#15803d', border: 'rgba(34,197,94,0.35)',  chipBg: 'rgba(34,197,94,0.15)'  },
};

const PHOTOBOOK_TYPES = [
  'A4 Tapa Dura',
  'A5 Tapa Dura',
  'A4 Tapa Blanda',
  'A5 Tapa Blanda',
  'Cuadro 30x40',
];

// Valor centinela para "trabajo manual": habilita un campo de texto libre.
const MANUAL_OPTION = '__manual__';

export default function AdminJobsPanel() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Formulario
  const [name, setName] = useState('');
  const [photobookType, setPhotobookType] = useState('');
  const [manualType, setManualType] = useState('');
  const [notes, setNotes] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      (err) => {
        console.error('Error fetching jobs:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const resetForm = () => {
    setName('');
    setPhotobookType('');
    setManualType('');
    setNotes('');
    setPdfFile(null);
    setUploadProgress(0);
    setError('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('El nombre del trabajo es obligatorio.');
      return;
    }
    // Tipo efectivo: si es manual, usar el texto libre; si no, la opción del desplegable.
    const finalType = photobookType === MANUAL_OPTION ? manualType.trim() : photobookType;
    if (!finalType) {
      setError(photobookType === MANUAL_OPTION
        ? 'Escribí el tipo de trabajo manual.'
        : 'Elegí un tipo de libro.');
      return;
    }

    setCreating(true);
    try {
      const jobId = Date.now().toString() + '-' + Math.floor(Math.random() * 1000);

      let pdfUrl = '';
      let pdfFilename = '';
      let pdfStoragePath = '';

      // Subir PDF si hay
      if (pdfFile) {
        pdfFilename = pdfFile.name;
        pdfStoragePath = `printJobs/${jobId}/${pdfFilename}`;
        const storageRef = ref(storage, pdfStoragePath);
        const uploadTask = uploadBytesResumable(storageRef, pdfFile);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on('state_changed',
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setUploadProgress(progress);
            },
            (err) => reject(err),
            async () => {
              pdfUrl = await getDownloadURL(uploadTask.snapshot.ref);
              resolve();
            }
          );
        });
      }

      // Crear documento
      await setDoc(doc(db, 'printJobs', jobId), {
        name: name.trim(),
        photobookType: finalType,
        notes: notes.trim(),
        pdfUrl,
        pdfFilename,
        pdfStoragePath,
        status: 'pending',
        createdAt: Timestamp.now(),
      });

      resetForm();
    } catch (err) {
      console.error('Error creando trabajo:', err);
      setError('Hubo un error al crear el trabajo. Revisá las reglas de Firebase.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (job: PrintJob) => {
    if (!confirm(`¿Eliminar el trabajo "${job.name}"?\n\nEsta acción no se puede deshacer.`)) return;
    setDeletingId(job.id);
    try {
      // Borrar PDF de Storage si existe
      if (job.pdfStoragePath) {
        try {
          await deleteObject(ref(storage, job.pdfStoragePath));
        } catch {
          // Si no existe, continuar
        }
      }
      await deleteDoc(doc(db, 'printJobs', job.id));
    } catch (err) {
      console.error('Error eliminando trabajo:', err);
      alert('No se pudo eliminar el trabajo.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleChangeStatus = async (jobId: string, newStatus: JobStatus) => {
    try {
      await updateDoc(doc(db, 'printJobs', jobId), { status: newStatus });
    } catch (err) {
      console.error('Error actualizando estado:', err);
    }
  };

  const grouped: Record<JobStatus, PrintJob[]> = {
    pending: jobs.filter(j => (j.status || 'pending') === 'pending'),
    done:    jobs.filter(j => j.status === 'done'),
    paid:    jobs.filter(j => j.status === 'paid'),
  };

  // Tipo efectivo para validar el formulario (manual usa el texto libre).
  const effectiveType = photobookType === MANUAL_OPTION ? manualType.trim() : photobookType;
  const formInvalid = creating || !name.trim() || !effectiveType;

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '1rem', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Volver al Directorio
        </Link>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <Briefcase size={28} color="#4338ca" /> Gestión de Imprenta
        </h2>
        <p style={{ color: 'var(--text-muted)' }}>Creá y gestioná los trabajos asignados a la imprenta.</p>
      </div>

      {/* ── Formulario crear trabajo ── */}
      <div style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '1.5rem',
        marginBottom: '2.5rem',
      }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Plus size={18} /> Nuevo trabajo
        </h3>

        {error && (
          <div style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '0.7rem 1rem', borderRadius: 'var(--radius)', marginBottom: '1rem', border: '1px solid rgba(239,68,68,0.3)', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleCreate}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Nombre del trabajo *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ej. Boda Marta y Juan"
                required
                style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Tipo de libro *</label>
              <select
                value={photobookType}
                onChange={(e) => setPhotobookType(e.target.value)}
                required
                style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', cursor: 'pointer' }}
              >
                <option value="">— Elegí un producto —</option>
                {PHOTOBOOK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                <option value={MANUAL_OPTION}>✏️ Trabajo manual (otro)</option>
              </select>

              {photobookType === MANUAL_OPTION && (
                <input
                  type="text"
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value)}
                  placeholder="Escribí el tipo de trabajo"
                  autoFocus
                  style={{ width: '100%', marginTop: '0.5rem', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                />
              )}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <StickyNote size={12} /> Notas para la imprenta
              </span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Indicaciones, particularidades del trabajo, fecha de entrega, etc."
              rows={3}
              style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <FileText size={12} /> Archivo PDF (opcional)
              </span>
            </label>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              padding: '0.6rem 0.85rem',
              borderRadius: 'var(--radius)',
              border: '1px dashed var(--border)',
              backgroundColor: 'var(--background)',
            }}>
              <UploadCloud size={18} color="var(--text-muted)" />
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                style={{ flex: 1, color: 'var(--foreground)', fontSize: '0.85rem' }}
              />
              {pdfFile && (
                <button
                  type="button"
                  onClick={() => setPdfFile(null)}
                  style={{
                    background: 'rgba(239,68,68,0.1)',
                    color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: '50%',
                    width: '24px',
                    height: '24px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  title="Quitar archivo"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {creating && pdfFile && uploadProgress > 0 && uploadProgress < 100 && (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ height: '6px', backgroundColor: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${uploadProgress}%`, backgroundColor: 'var(--primary)', transition: 'width 0.2s' }} />
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{Math.round(uploadProgress)}% subido</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={formInvalid}
            style={{
              backgroundColor: 'var(--primary)',
              color: 'white',
              border: 'none',
              padding: '0.7rem 1.5rem',
              borderRadius: 'var(--radius)',
              fontWeight: 600,
              cursor: formInvalid ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              opacity: formInvalid ? 0.7 : 1,
            }}
          >
            <Plus size={16} /> {creating ? 'Creando...' : 'Crear trabajo'}
          </button>
        </form>
      </div>

      {/* ── Listado de trabajos por estado ── */}
      <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
        Trabajos ({jobs.length})
      </h3>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando trabajos...</div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <Briefcase size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
          <p style={{ color: 'var(--text-muted)' }}>Todavía no creaste ningún trabajo.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {(['pending', 'done', 'paid'] as JobStatus[]).map((s) => {
            const list = grouped[s];
            if (list.length === 0) return null;
            const colors = STATUS_COLOR[s];
            const icon = s === 'pending' ? <Circle size={14} /> : s === 'done' ? <CheckCircle2 size={14} /> : <DollarSign size={14} />;
            return (
              <div key={s}>
                <h4 style={{
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  color: colors.color,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.75rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}>
                  {icon} {STATUS_LABEL[s]} ({list.length})
                </h4>
                <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
                  {list.map((job) => (
                    <div key={job.id} style={{
                      backgroundColor: 'var(--surface)',
                      border: `1px solid ${colors.border}`,
                      borderRadius: 'var(--radius)',
                      padding: '1rem 1.1rem',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h5 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.2rem' }}>{job.name}</h5>
                          <span style={{ fontSize: '0.7rem', color: '#b45309', backgroundColor: 'rgba(245,158,11,0.12)', padding: '0.1rem 0.5rem', borderRadius: '999px', fontWeight: 600 }}>
                            📖 {job.photobookType}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDelete(job)}
                          disabled={deletingId === job.id}
                          style={{
                            background: 'rgba(239,68,68,0.08)',
                            color: '#ef4444',
                            border: '1px solid rgba(239,68,68,0.25)',
                            borderRadius: 'var(--radius)',
                            padding: '0.3rem 0.5rem',
                            cursor: deletingId === job.id ? 'not-allowed' : 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            opacity: deletingId === job.id ? 0.6 : 1,
                          }}
                          title="Eliminar trabajo"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {job.notes && (
                        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>{job.notes}</p>
                      )}

                      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.75rem', alignItems: 'center' }}>
                        {job.pdfUrl && (
                          <a
                            href={job.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.3rem',
                              padding: '0.35rem 0.65rem',
                              borderRadius: 'var(--radius)',
                              backgroundColor: 'rgba(59,130,246,0.1)',
                              color: '#1d4ed8',
                              border: '1px solid rgba(59,130,246,0.3)',
                              fontSize: '0.72rem',
                              fontWeight: 600,
                              textDecoration: 'none',
                            }}
                          >
                            <FileText size={11} /> PDF <ExternalLink size={10} style={{ opacity: 0.6 }} />
                          </a>
                        )}

                        <select
                          value={job.status || 'pending'}
                          onChange={(e) => handleChangeStatus(job.id, e.target.value as JobStatus)}
                          style={{
                            marginLeft: 'auto',
                            padding: '0.3rem 0.55rem',
                            borderRadius: 'var(--radius)',
                            border: `1px solid ${colors.border}`,
                            backgroundColor: colors.chipBg,
                            color: colors.color,
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <option value="pending">⚪ Pendiente</option>
                          <option value="done">✅ Realizado</option>
                          <option value="paid">💵 Cobrado</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
