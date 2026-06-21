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
  Circle, CheckCircle2, DollarSign, UploadCloud, X, StickyNote, ArrowLeft,
  Pencil, Save, Clock, Search, Calendar
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
  statusUpdatedAt?: { seconds: number };
  doneAt?: { seconds: number };   // fecha en que pasó a "Realizado"
  paidAt?: { seconds: number };   // fecha en que pasó a "Cobrado"
  costOverride?: number;          // costo forzado (trabajos especiales)
}

// Fecha corta dd/mm/aa a partir de un Timestamp de Firestore.
function fmtStatusDate(ts?: { seconds: number }) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
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

// Costo por defecto según el tipo de producto. Los tipos no listados
// (Tapa Blanda, trabajos manuales) arrancan en 0 y se fuerzan por trabajo.
const COST_CONFIG: Record<string, number> = {
  'A4 Tapa Dura': 23500,
  'A5 Tapa Dura': 14000,
  'Cuadro 30x40': 2000,
};

// Costo efectivo de un trabajo: el forzado si existe, si no el del tipo.
function jobCost(job: PrintJob): number {
  if (typeof job.costOverride === 'number') return job.costOverride;
  return COST_CONFIG[job.photobookType] ?? 0;
}

const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

export default function AdminJobsPanel() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Vista: trabajos o costos
  const [view, setView] = useState<'jobs' | 'costs'>('jobs');
  // Buscador por nombre (cliente)
  const [searchJob, setSearchJob] = useState('');
  // Filtro de la sección de costos
  const [costDateField, setCostDateField] = useState<'done' | 'paid'>('paid');
  const [costFrom, setCostFrom] = useState('');
  const [costTo, setCostTo] = useState('');
  // Backfill temporal de fecha de realizado
  const [backfilling, setBackfilling] = useState(false);

  // Formulario
  const [name, setName] = useState('');
  const [photobookType, setPhotobookType] = useState('');
  const [manualType, setManualType] = useState('');
  const [notes, setNotes] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Edición de un trabajo existente
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editManualType, setEditManualType] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

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
      const now = Timestamp.now();
      const data: Record<string, unknown> = { status: newStatus, statusUpdatedAt: now };
      // Registrar la fecha de cuando entra a Realizado / Cobrado.
      if (newStatus === 'done') data.doneAt = now;
      if (newStatus === 'paid') data.paidAt = now;
      await updateDoc(doc(db, 'printJobs', jobId), data);
    } catch (err) {
      console.error('Error actualizando estado:', err);
    }
  };

  const handleUpdateCost = async (jobId: string, value: number) => {
    try {
      await updateDoc(doc(db, 'printJobs', jobId), { costOverride: value });
    } catch (err) {
      console.error('Error actualizando costo:', err);
      alert('No se pudo guardar el costo.');
    }
  };

  // Backfill temporal: asigna 10/06/26 como fecha de realizado a los trabajos
  // en estado "Realizado" que todavía no tienen doneAt.
  const handleBackfillDoneDate = async () => {
    const targets = jobs.filter(j => j.status === 'done' && !j.doneAt?.seconds);
    if (targets.length === 0) {
      alert('No hay trabajos en "Realizado" sin fecha.');
      return;
    }
    if (!confirm(`Asignar 10/06/26 como fecha de realizado a ${targets.length} trabajo(s) sin fecha?`)) return;
    setBackfilling(true);
    try {
      const ts = Timestamp.fromDate(new Date('2026-06-10T12:00:00'));
      for (const j of targets) {
        await updateDoc(doc(db, 'printJobs', j.id), { doneAt: ts });
      }
      alert(`Listo: ${targets.length} trabajo(s) actualizados.`);
    } catch (err) {
      console.error('Error en el backfill:', err);
      alert('Hubo un error en el backfill.');
    } finally {
      setBackfilling(false);
    }
  };

  const startEdit = (job: PrintJob) => {
    setEditingId(job.id);
    setEditName(job.name);
    // Si el tipo es uno de los preset usamos el desplegable; si no, modo manual.
    const isPreset = PHOTOBOOK_TYPES.includes(job.photobookType);
    setEditType(isPreset ? job.photobookType : MANUAL_OPTION);
    setEditManualType(isPreset ? '' : job.photobookType);
    setEditNotes(job.notes || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (jobId: string) => {
    if (!editName.trim()) {
      alert('El nombre del trabajo es obligatorio.');
      return;
    }
    const finalType = editType === MANUAL_OPTION ? editManualType.trim() : editType;
    if (!finalType) {
      alert(editType === MANUAL_OPTION ? 'Escribí el tipo de trabajo manual.' : 'Elegí un tipo de libro.');
      return;
    }
    setSavingEdit(true);
    try {
      await updateDoc(doc(db, 'printJobs', jobId), {
        name: editName.trim(),
        photobookType: finalType,
        notes: editNotes.trim(),
      });
      setEditingId(null);
    } catch (err) {
      console.error('Error editando trabajo:', err);
      alert('No se pudieron guardar los cambios.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Buscador por nombre del trabajo (cliente).
  const searchTerm = searchJob.trim().toLowerCase();
  const visibleJobs = searchTerm
    ? jobs.filter(j => (j.name || '').toLowerCase().includes(searchTerm))
    : jobs;

  const grouped: Record<JobStatus, PrintJob[]> = {
    pending: visibleJobs.filter(j => (j.status || 'pending') === 'pending'),
    done:    visibleJobs.filter(j => j.status === 'done'),
    paid:    visibleJobs.filter(j => j.status === 'paid'),
  };

  // ── Sección de costos: filtrar por fecha de realizado o cobrado ──
  // Fecha relevante del trabajo según el filtro. Si no tiene doneAt/paidAt
  // (trabajos previos a registrar esas fechas) pero ya está en ese estado,
  // usamos statusUpdatedAt como aproximación para que igual aparezca.
  const jobDateSec = (j: PrintJob): number | undefined => {
    if (costDateField === 'done') {
      return j.doneAt?.seconds ?? (j.status === 'done' ? j.statusUpdatedAt?.seconds : undefined);
    }
    return j.paidAt?.seconds ?? (j.status === 'paid' ? j.statusUpdatedAt?.seconds : undefined);
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
  const costTotal = costJobs.reduce((sum, j) => sum + jobCost(j), 0);

  // Tipo efectivo para validar el formulario (manual usa el texto libre).
  const effectiveType = photobookType === MANUAL_OPTION ? manualType.trim() : photobookType;
  const formInvalid = creating || !name.trim() || !effectiveType;

  // Estilos de la tabla de costos
  const costTh: React.CSSProperties = { padding: '0.6rem 0.7rem', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' };
  const costTd: React.CSSProperties = { padding: '0.55rem 0.7rem', whiteSpace: 'nowrap' };
  const costFilterInput: React.CSSProperties = { padding: '0.5rem 0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '0.85rem', cursor: 'pointer' };

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

      {/* ── Tabs: Trabajos / Costos ── */}
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
      <>
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
          Trabajos ({visibleJobs.length})
        </h3>
        <div style={{ position: 'relative', minWidth: '240px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input
            type="text"
            placeholder="Buscar por cliente..."
            value={searchJob}
            onChange={(e) => setSearchJob(e.target.value)}
            style={{ width: '100%', padding: '0.5rem 0.75rem 0.5rem 2rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--surface)', color: 'var(--foreground)', fontSize: '0.9rem' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando trabajos...</div>
      ) : jobs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <Briefcase size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
          <p style={{ color: 'var(--text-muted)' }}>Todavía no creaste ningún trabajo.</p>
        </div>
      ) : visibleJobs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Sin resultados para “{searchJob}”.
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
                      {editingId === job.id ? (
                        /* ── Modo edición ── */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Nombre del trabajo *</label>
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Tipo de libro *</label>
                            <select
                              value={editType}
                              onChange={(e) => setEditType(e.target.value)}
                              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '0.85rem', cursor: 'pointer' }}
                            >
                              <option value="">— Elegí un producto —</option>
                              {PHOTOBOOK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              <option value={MANUAL_OPTION}>✏️ Trabajo manual (otro)</option>
                            </select>
                            {editType === MANUAL_OPTION && (
                              <input
                                type="text"
                                value={editManualType}
                                onChange={(e) => setEditManualType(e.target.value)}
                                placeholder="Escribí el tipo de trabajo"
                                autoFocus
                                style={{ width: '100%', marginTop: '0.4rem', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontSize: '0.85rem' }}
                              />
                            )}
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.2rem' }}>Notas para la imprenta</label>
                            <textarea
                              value={editNotes}
                              onChange={(e) => setEditNotes(e.target.value)}
                              rows={3}
                              style={{ width: '100%', padding: '0.5rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontFamily: 'inherit', fontSize: '0.85rem', resize: 'vertical' }}
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            <button
                              onClick={cancelEdit}
                              disabled={savingEdit}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.45rem 0.8rem', borderRadius: 'var(--radius)', backgroundColor: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--border)', fontWeight: 500, fontSize: '0.78rem', cursor: savingEdit ? 'not-allowed' : 'pointer' }}
                            >
                              <X size={13} /> Cancelar
                            </button>
                            <button
                              onClick={() => saveEdit(job.id)}
                              disabled={savingEdit}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.45rem 0.8rem', borderRadius: 'var(--radius)', backgroundColor: 'var(--primary)', color: 'white', border: 'none', fontWeight: 600, fontSize: '0.78rem', cursor: savingEdit ? 'not-allowed' : 'pointer', opacity: savingEdit ? 0.7 : 1 }}
                            >
                              <Save size={13} /> {savingEdit ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── Vista normal ── */
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <h5 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.2rem' }}>{job.name}</h5>
                              <span style={{ fontSize: '0.7rem', color: '#b45309', backgroundColor: 'rgba(245,158,11,0.12)', padding: '0.1rem 0.5rem', borderRadius: '999px', fontWeight: 600 }}>
                                📖 {job.photobookType}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                              <button
                                onClick={() => startEdit(job)}
                                style={{
                                  background: 'rgba(59,130,246,0.08)',
                                  color: '#1d4ed8',
                                  border: '1px solid rgba(59,130,246,0.25)',
                                  borderRadius: 'var(--radius)',
                                  padding: '0.3rem 0.5rem',
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                }}
                                title="Editar trabajo"
                              >
                                <Pencil size={13} />
                              </button>
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

                          {job.statusUpdatedAt && (
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                              <Clock size={11} /> Estado actualizado: {fmtStatusDate(job.statusUpdatedAt)}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      {view === 'costs' && (
        <div>
          {/* Herramienta temporal: backfill de fecha de realizado */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.25rem', padding: '0.75rem 1rem', backgroundColor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 'var(--radius)' }}>
            <span style={{ fontSize: '0.82rem', color: '#92400e' }}>
              Herramienta única: asignar 10/06/26 como fecha de realizado a los trabajos en “Realizado” que no tengan fecha.
            </span>
            <button
              onClick={handleBackfillDoneDate}
              disabled={backfilling}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', borderRadius: 'var(--radius)', backgroundColor: '#b45309', color: 'white', border: 'none', fontWeight: 600, fontSize: '0.82rem', cursor: backfilling ? 'not-allowed' : 'pointer', opacity: backfilling ? 0.7 : 1, whiteSpace: 'nowrap' }}
            >
              <Calendar size={15} /> {backfilling ? 'Aplicando...' : 'Asignar 10/06/26'}
            </button>
          </div>

          {/* Filtros de costos */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Filtrar por fecha de</label>
              <select value={costDateField} onChange={(e) => setCostDateField(e.target.value as 'done' | 'paid')} style={costFilterInput}>
                <option value="paid">Cobrado (finalizado)</option>
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
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Costo total ({costJobs.length} trabajo{costJobs.length !== 1 ? 's' : ''})</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ef4444' }}>{fmtMoney(costTotal)}</div>
            </div>
          </div>

          {costJobs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <Calendar size={40} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
              No hay trabajos con fecha de {costDateField === 'done' ? 'realizado' : 'cobrado'} en este período.
            </div>
          ) : (
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '720px' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--surface)', textAlign: 'left' }}>
                    {['Cliente / Trabajo', 'Producto', 'Realizado', 'Cobrado', 'Costo', 'Estado'].map((h) => (
                      <th key={h} style={costTh}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {costJobs.map((job) => {
                    const st = (job.status || 'pending') as JobStatus;
                    const sc = STATUS_COLOR[st];
                    const forced = typeof job.costOverride === 'number';
                    return (
                      <tr key={job.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ ...costTd, fontWeight: 600 }}>{job.name}</td>
                        <td style={costTd}>{job.photobookType}</td>
                        <td style={costTd}>{job.doneAt ? fmtStatusDate(job.doneAt) : '—'}</td>
                        <td style={costTd}>{job.paidAt ? fmtStatusDate(job.paidAt) : '—'}</td>
                        <td style={costTd}>
                          <span style={{ color: 'var(--text-muted)', marginRight: '0.2rem' }}>$</span>
                          <input
                            type="number"
                            key={`cost-${job.id}-${job.costOverride ?? ''}`}
                            defaultValue={jobCost(job)}
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (!isNaN(v) && v !== jobCost(job)) handleUpdateCost(job.id, v);
                            }}
                            title={forced ? 'Costo forzado para este trabajo' : 'Costo por defecto del producto. Editalo para forzarlo.'}
                            style={{ width: '90px', padding: '0.3rem 0.4rem', borderRadius: '6px', border: `1px solid ${forced ? 'rgba(245,158,11,0.55)' : 'var(--border)'}`, backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                          />
                          {forced && <span style={{ marginLeft: '0.35rem', fontSize: '0.62rem', fontWeight: 700, color: '#b45309' }}>forzado</span>}
                        </td>
                        <td style={costTd}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.15rem 0.55rem', borderRadius: '999px', color: sc.color, backgroundColor: sc.chipBg, border: `1px solid ${sc.border}` }}>
                            {STATUS_LABEL[st]}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.9rem', lineHeight: 1.5 }}>
            Costos por defecto: A4 Tapa Dura {fmtMoney(23500)} · A5 Tapa Dura {fmtMoney(14000)} · Cuadro 30x40 {fmtMoney(2000)}.
            El resto (Tapa Blanda y trabajos manuales) arranca en {fmtMoney(0)}. Editá el costo de cualquier fila para forzarlo (queda marcado como “forzado”).
          </p>
        </div>
      )}
    </div>
  );
}
