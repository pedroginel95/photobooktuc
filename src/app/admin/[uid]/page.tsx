'use client';

import React, { useEffect, useState, useRef, use } from 'react';
import { doc, getDoc, collection, getDocs, query, orderBy, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DownloadCloud, ArrowLeft, Image as ImageIcon, Folder, Trash2, Archive, ArchiveRestore, Eye, EyeOff, Pencil, Save, X, Copy, Check, ChevronLeft, ChevronRight, Sparkles, StickyNote, Lock } from 'lucide-react';
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import styles from '../../dashboard/page.module.css';

interface UserData {
  name: string;
  lastName: string;
  whatsapp: string;
  email: string;
  photobookType?: string;
  adminNotes?: string;
  aggregatedAdminNotes?: string; // legacy
}

interface PhotoData {
  id: string;
  url: string;
  filename: string;
}

interface CollectionData {
  id: string;
  name: string;
  photos: PhotoData[];
  archived?: boolean;
  isNewOrder?: boolean;
}

export default function ClientDetail({ params }: { params: Promise<{ uid: string }> }) {
  const resolvedParams = use(params);
  const uid = resolvedParams.uid;

  const [client, setClient] = useState<UserData | null>(null);
  const [collections, setCollections] = useState<CollectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Edición de datos del cliente
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<UserData>({ name: '', lastName: '', whatsapp: '', email: '', photobookType: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  // Lightbox de fotos
  const [lightbox, setLightbox] = useState<{ collectionId: string; index: number } | null>(null);
  const [copying, setCopying] = useState(false);
  const [copyOk, setCopyOk] = useState(false);

  // Notas internas del admin (a nivel cliente)
  const [clientNotes, setClientNotes] = useState<string>('');
  const [clientNotesStatus, setClientNotesStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const clientNotesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientNotesInitialized = useRef(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docRef = doc(db, 'users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data() as UserData;
          setClient(data);

          // Inicializar notas del cliente (con fallback a campo legacy si existe)
          const initialNotes = (data.adminNotes ?? data.aggregatedAdminNotes ?? '').toString();
          setClientNotes(initialNotes);
          clientNotesInitialized.current = true;

          // Limpiar el flag global de "nuevo pedido" — el admin ya está viendo el detalle
          if (docSnap.data().hasNewOrder) {
            await updateDoc(docRef, { hasNewOrder: false });
          }
        }

        const q = query(collection(db, `users/${uid}/collections`), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const cols: CollectionData[] = [];

        for (const d of querySnapshot.docs) {
          const photosQ = query(collection(db, `users/${uid}/collections/${d.id}/photos`), orderBy('createdAt', 'desc'));
          const pSnap = await getDocs(photosQ);
          const pList: PhotoData[] = [];

          pSnap.forEach((p) => {
            pList.push({ id: p.id, ...p.data() } as PhotoData);
          });

          // Aplicar orden manual del usuario si existe
          const photoOrder = d.data().photoOrder as string[] | undefined;
          if (photoOrder && photoOrder.length > 0) {
            pList.sort((a, b) => {
              const ai = photoOrder.indexOf(a.id);
              const bi = photoOrder.indexOf(b.id);
              if (ai === -1 && bi === -1) return 0;
              if (ai === -1) return 1;
              if (bi === -1) return -1;
              return ai - bi;
            });
          }

          cols.push({
            id: d.id,
            name: d.data().name || 'Unnamed',
            photos: pList,
            archived: d.data().archived || false,
            isNewOrder: d.data().isNewOrder || false,
          });
        }

        setCollections(cols);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    if (uid) fetchData();
  }, [uid]);

  const handleDownloadCollection = async (col: CollectionData) => {
    if (col.photos.length === 0) return;
    setDownloadingId(col.id);
    setDownloadProgress(0);

    try {
      const zip = new JSZip();
      let processed = 0;
      const padLength = String(col.photos.length).length;

      for (let i = 0; i < col.photos.length; i++) {
        const photo = col.photos[i];
        try {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(photo.url)}`;
          const response = await fetch(proxyUrl);
          if (!response.ok) throw new Error('Failed to fetch via proxy');

          const blob = await response.blob();

          // Prefijo numérico según el orden (01-, 02-, ...)
          const prefix = String(i + 1).padStart(padLength, '0');
          zip.file(`${prefix}-${photo.filename}`, blob);

          processed += 1;
          setDownloadProgress(Math.round((processed / col.photos.length) * 100));
        } catch (err) {
          console.error(`Failed to fetch ${photo.filename}`, err);
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const safeName = col.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      saveAs(zipBlob, `${client?.name || 'Client'}_${client?.lastName || 'Photos'}_${safeName}.zip`);

    } catch (error) {
      console.error("Error zipping files:", error);
      alert("Error al descargar los archivos.");
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  };

  const handleArchiveCollection = async (col: CollectionData) => {
    const isArchived = col.archived;
    const action = isArchived ? 'desarchivar' : 'archivar';
    if (!confirm(`¿Querés ${action} la colección "${col.name}"?`)) return;

    setActionLoading(col.id);
    try {
      const colRef = doc(db, `users/${uid}/collections`, col.id);
      await updateDoc(colRef, { archived: !isArchived });

      const updatedCollections = collections.map(c =>
        c.id === col.id ? { ...c, archived: !isArchived } : c
      );
      setCollections(updatedCollections);

      // Actualizar hasArchived en el documento del usuario
      const anyArchived = updatedCollections.some(c => c.archived);
      await updateDoc(doc(db, 'users', uid), { hasArchived: anyArchived });
    } catch (error) {
      console.error("Error archivando colección:", error);
      alert("Error al archivar la colección.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteCollection = async (col: CollectionData) => {
    if (!confirm(`¿Estás seguro de que querés ELIMINAR la colección "${col.name}"?\n\nEsta acción no se puede deshacer. Se eliminará la colección y todas sus fotos.`)) return;

    setActionLoading(col.id);
    try {
      const batch = writeBatch(db);

      for (const photo of col.photos) {
        const photoRef = doc(db, `users/${uid}/collections/${col.id}/photos`, photo.id);
        batch.delete(photoRef);
      }

      const colRef = doc(db, `users/${uid}/collections`, col.id);
      batch.delete(colRef);

      await batch.commit();
      setCollections(prev => prev.filter(c => c.id !== col.id));
    } catch (error) {
      console.error("Error eliminando colección:", error);
      alert("Error al eliminar la colección.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartEdit = () => {
    if (!client) return;
    setEditForm({
      name: client.name || '',
      lastName: client.lastName || '',
      whatsapp: client.whatsapp || '',
      email: client.email || '',
      photobookType: client.photobookType || '',
    });
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    setSavingEdit(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        name: editForm.name.trim(),
        lastName: editForm.lastName.trim(),
        whatsapp: editForm.whatsapp.trim(),
        email: editForm.email.trim(),
        photobookType: editForm.photobookType || '',
      });
      setClient({
        ...client!,
        name: editForm.name.trim(),
        lastName: editForm.lastName.trim(),
        whatsapp: editForm.whatsapp.trim(),
        email: editForm.email.trim(),
        photobookType: editForm.photobookType || '',
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Error guardando cambios:", error);
      alert("Error al guardar los cambios.");
    } finally {
      setSavingEdit(false);
    }
  };

  const saveClientNotes = async (value: string) => {
    setClientNotesStatus('saving');
    try {
      const trimmed = value.trim();
      await updateDoc(doc(db, 'users', uid), {
        adminNotes: value,
        hasAdminNotes: trimmed.length > 0,
      });
      setClientNotesStatus('saved');
      setTimeout(() => setClientNotesStatus('idle'), 1800);
    } catch (error) {
      console.error('Error guardando notas:', error);
      setClientNotesStatus('idle');
    }
  };

  const handleClientNotesChange = (value: string) => {
    setClientNotes(value);
    setClientNotesStatus('saving');
    if (clientNotesTimer.current) clearTimeout(clientNotesTimer.current);
    clientNotesTimer.current = setTimeout(() => {
      saveClientNotes(value);
    }, 900);
  };

  const handleDismissNewOrder = async (col: CollectionData) => {
    try {
      await updateDoc(doc(db, `users/${uid}/collections`, col.id), { isNewOrder: false });
      setCollections(prev =>
        prev.map(c => c.id === col.id ? { ...c, isNewOrder: false } : c)
      );
    } catch (error) {
      console.error("Error descartando indicador de nuevo pedido:", error);
    }
  };

  // ── Lightbox helpers ────────────────────────────────────────────────────────

  const lightboxCollection = lightbox ? collections.find(c => c.id === lightbox.collectionId) : null;
  const lightboxPhoto = lightboxCollection ? lightboxCollection.photos[lightbox!.index] : null;

  const handleLightboxNav = (dir: 'prev' | 'next') => {
    if (!lightbox || !lightboxCollection) return;
    const total = lightboxCollection.photos.length;
    const next = dir === 'next'
      ? (lightbox.index + 1) % total
      : (lightbox.index - 1 + total) % total;
    setLightbox({ ...lightbox, index: next });
    setCopyOk(false);
  };

  const handleCopyImage = async (url: string) => {
    setCopying(true);
    setCopyOk(false);
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('No se pudo descargar la imagen');
      const blob = await response.blob();

      // Cargar la imagen en un canvas para garantizar formato PNG (compatible con clipboard)
      const objUrl = URL.createObjectURL(blob);
      const img = new window.Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
        img.src = objUrl;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo obtener el contexto del canvas');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(objUrl);

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png')
      );
      if (!pngBlob) throw new Error('No se pudo generar el PNG');

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': pngBlob })
      ]);

      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 2200);
    } catch (error) {
      console.error('Error copiando imagen:', error);
      alert('No se pudo copiar la imagen al portapapeles. Tu navegador puede no soportar esta función.');
    } finally {
      setCopying(false);
    }
  };

  // Navegación con teclado dentro del lightbox
  useEffect(() => {
    if (!lightbox) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight') handleLightboxNav('next');
      else if (e.key === 'ArrowLeft') handleLightboxNav('prev');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox]);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando colecciones del cliente...</div>;
  }

  if (!client) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>Cliente no encontrado.</div>;
  }

  const visibleCollections = collections.filter(c => showArchived ? c.archived : !c.archived);
  const archivedCount = collections.filter(c => c.archived).length;

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '1rem', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Volver al Directorio
        </Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isEditing ? (
              <div style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--primary)',
                borderRadius: 'var(--radius)',
                padding: '1.5rem',
                marginBottom: '0.5rem',
              }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Pencil size={18} color="var(--primary)" /> Editar datos del cliente
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Nombre</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Apellido</label>
                    <input
                      type="text"
                      value={editForm.lastName}
                      onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>WhatsApp</label>
                    <input
                      type="tel"
                      value={editForm.whatsapp}
                      onChange={(e) => setEditForm({ ...editForm, whatsapp: e.target.value })}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Correo</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Tipo de Foto Libro</label>
                  <select
                    value={editForm.photobookType || ''}
                    onChange={(e) => setEditForm({ ...editForm, photobookType: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: 'var(--radius)', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', cursor: 'pointer' }}
                  >
                    <option value="">— Sin especificar —</option>
                    <option value="A4 Tapa Dura">A4 Tapa Dura</option>
                    <option value="A5 Tapa Dura">A5 Tapa Dura</option>
                    <option value="A4 Tapa Blanda">A4 Tapa Blanda</option>
                    <option value="A5 Tapa Blanda">A5 Tapa Blanda</option>
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleCancelEdit}
                    disabled={savingEdit}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      padding: '0.5rem 1rem', borderRadius: 'var(--radius)',
                      backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                      border: '1px solid var(--border)', fontWeight: 500,
                      cursor: savingEdit ? 'not-allowed' : 'pointer', fontSize: '0.875rem',
                    }}
                  >
                    <X size={15} /> Cancelar
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={savingEdit}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      padding: '0.5rem 1rem', borderRadius: 'var(--radius)',
                      backgroundColor: 'var(--primary)', color: 'white',
                      border: 'none', fontWeight: 600,
                      cursor: savingEdit ? 'not-allowed' : 'pointer', fontSize: '0.875rem',
                      opacity: savingEdit ? 0.7 : 1,
                    }}
                  >
                    <Save size={15} /> {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--foreground)' }}>
                    {client.name} {client.lastName}
                  </h2>
                  {client.photobookType && (
                    <span style={{
                      fontSize: '0.85rem',
                      backgroundColor: 'rgba(245,158,11,0.12)',
                      color: '#b45309',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '999px',
                      fontWeight: 600,
                      border: '1px solid rgba(245,158,11,0.3)',
                      whiteSpace: 'nowrap',
                    }}>
                      📖 {client.photobookType}
                    </span>
                  )}
                  <button
                    onClick={handleStartEdit}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                      padding: '0.4rem 0.75rem', borderRadius: 'var(--radius)',
                      backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                      border: '1px solid var(--border)', fontWeight: 500,
                      cursor: 'pointer', fontSize: '0.8rem',
                      transition: 'border-color 0.2s, background-color 0.2s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--foreground)'; }}
                    title="Editar datos del cliente"
                  >
                    <Pencil size={13} /> Editar datos
                  </button>
                </div>
                <div style={{ color: 'var(--text-muted)', marginTop: '0.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <span>Teléfono: {client.whatsapp}</span>
                  <span>Correo: {client.email}</span>
                </div>
              </>
            )}
          </div>

          {archivedCount > 0 && (
            <button
              onClick={() => setShowArchived(prev => !prev)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: 'var(--surface)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
                padding: '0.5rem 1rem',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontWeight: 500,
                fontSize: '0.875rem',
              }}
            >
              {showArchived ? <EyeOff size={16} /> : <Eye size={16} />}
              {showArchived ? 'Ver activas' : `Ver archivadas (${archivedCount})`}
            </button>
          )}
        </div>
      </div>

      {/* ── NOTAS INTERNAS DEL CLIENTE (solo admin) ── */}
      <div style={{
        backgroundColor: 'rgba(245,158,11,0.05)',
        border: '1px dashed rgba(245,158,11,0.4)',
        borderRadius: 'var(--radius)',
        padding: '1rem 1.25rem',
        marginBottom: '2rem',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.6rem',
        }}>
          <label style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#b45309',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}>
            <StickyNote size={14} /> Notas internas del cliente
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              fontSize: '0.65rem',
              backgroundColor: 'rgba(245,158,11,0.18)',
              padding: '0.05rem 0.4rem',
              borderRadius: '999px',
              marginLeft: '0.3rem',
              textTransform: 'none',
              letterSpacing: 0,
              fontWeight: 600,
            }}>
              <Lock size={9} /> solo admin
            </span>
          </label>

          {clientNotesStatus === 'saving' && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Guardando...
            </span>
          )}
          {clientNotesStatus === 'saved' && (
            <span style={{ fontSize: '0.75rem', color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontWeight: 600 }}>
              <Check size={12} /> Guardado
            </span>
          )}
        </div>

        <textarea
          value={clientNotes}
          onChange={(e) => handleClientNotesChange(e.target.value)}
          placeholder="Escribí acá tus notas sobre este cliente — el cliente no las verá."
          rows={4}
          style={{
            width: '100%',
            padding: '0.7rem 0.85rem',
            borderRadius: 'calc(var(--radius) - 0.2rem)',
            border: '1px solid rgba(245,158,11,0.25)',
            backgroundColor: 'var(--background)',
            color: 'var(--foreground)',
            fontFamily: 'inherit',
            fontSize: '0.9rem',
            resize: 'vertical',
            outline: 'none',
            lineHeight: 1.5,
          }}
          onFocus={(e) => e.target.style.borderColor = '#f59e0b'}
          onBlur={(e) => e.target.style.borderColor = 'rgba(245,158,11,0.25)'}
        />
      </div>

      <div className={styles.gallerySection}>
        <h3 className={styles.galleryHeader} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
          {showArchived ? 'Colecciones Archivadas' : 'Colecciones del Cliente'}
        </h3>

        {visibleCollections.length === 0 ? (
          <div className={styles.emptyGallery}>
            <Folder size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
            <p>{showArchived ? 'No hay colecciones archivadas.' : 'Este cliente todavía no ha creado ninguna colección.'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
            {visibleCollections.map((col) => (
              <div key={col.id} style={{
                backgroundColor: 'var(--surface)',
                padding: '2rem',
                borderRadius: 'var(--radius)',
                border: col.isNewOrder
                  ? '2px solid #f59e0b'
                  : `1px solid ${col.archived ? 'var(--text-muted)' : 'var(--border)'}`,
                opacity: col.archived ? 0.75 : 1,
                boxShadow: col.isNewOrder ? '0 0 0 4px rgba(245,158,11,0.12)' : undefined,
                position: 'relative',
              }}>
                {col.isNewOrder && (
                  <div style={{
                    position: 'absolute',
                    top: '-12px',
                    left: '1.5rem',
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    padding: '0.25rem 0.7rem 0.25rem 0.6rem',
                    borderRadius: '999px',
                    boxShadow: '0 2px 8px rgba(245,158,11,0.4)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}>
                    <Sparkles size={12} />
                    NUEVO PEDIDO
                    <button
                      onClick={() => handleDismissNewOrder(col)}
                      title="Descartar este indicador"
                      style={{
                        background: 'rgba(255,255,255,0.25)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '16px',
                        height: '16px',
                        marginLeft: '0.2rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                )}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.5rem',
                  flexWrap: 'wrap',
                  gap: '1rem'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Folder size={24} color={col.archived ? 'var(--text-muted)' : 'var(--primary)'} />
                    <h4 style={{ fontSize: '1.25rem', fontWeight: 600 }}>
                      {col.name}{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: '1rem', fontWeight: 400 }}>
                        ({col.photos.length} fotos)
                      </span>
                      {col.archived && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', backgroundColor: 'var(--border)', color: 'var(--text-muted)', padding: '0.15rem 0.5rem', borderRadius: '999px', fontWeight: 500 }}>
                          Archivada
                        </span>
                      )}
                    </h4>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {/* Descargar */}
                    <button
                      onClick={() => handleDownloadCollection(col)}
                      disabled={downloadingId === col.id || col.photos.length === 0 || actionLoading === col.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backgroundColor: downloadingId === col.id ? 'var(--border)' : 'var(--primary)',
                        color: downloadingId === col.id ? 'var(--text-muted)' : 'white',
                        border: 'none',
                        padding: '0.5rem 1rem',
                        borderRadius: 'var(--radius)',
                        fontWeight: 600,
                        cursor: downloadingId === col.id || col.photos.length === 0 ? 'not-allowed' : 'pointer',
                        transition: 'background-color 0.2s',
                        fontSize: '0.875rem',
                      }}
                    >
                      <DownloadCloud size={16} />
                      {downloadingId === col.id ? `${downloadProgress}%` : 'Descargar'}
                    </button>

                    {/* Archivar / Desarchivar */}
                    <button
                      onClick={() => handleArchiveCollection(col)}
                      disabled={actionLoading === col.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backgroundColor: 'var(--surface)',
                        color: 'var(--foreground)',
                        border: '1px solid var(--border)',
                        padding: '0.5rem 1rem',
                        borderRadius: 'var(--radius)',
                        fontWeight: 500,
                        cursor: actionLoading === col.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.875rem',
                        opacity: actionLoading === col.id ? 0.6 : 1,
                      }}
                      title={col.archived ? 'Desarchivar colección' : 'Archivar colección'}
                    >
                      {col.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                      {col.archived ? 'Desarchivar' : 'Archivar'}
                    </button>

                    {/* Eliminar */}
                    <button
                      onClick={() => handleDeleteCollection(col)}
                      disabled={actionLoading === col.id}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: '#ef4444',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        padding: '0.5rem 1rem',
                        borderRadius: 'var(--radius)',
                        fontWeight: 500,
                        cursor: actionLoading === col.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.875rem',
                        opacity: actionLoading === col.id ? 0.6 : 1,
                      }}
                      title="Eliminar colección permanentemente"
                    >
                      <Trash2 size={16} />
                      Eliminar
                    </button>
                  </div>
                </div>

                {col.photos.length === 0 ? (
                  <div className={styles.emptyGallery} style={{ padding: '2rem 1rem' }}>
                    <ImageIcon size={32} style={{ margin: '0 auto 0.5rem', opacity: 0.5 }} />
                    <p style={{ fontSize: '0.875rem' }}>No hay fotos en esta colección.</p>
                  </div>
                ) : (
                  <div className={styles.grid}>
                    {col.photos.map((photo, idx) => (
                      <div
                        key={photo.id}
                        className={styles.imageWrapper}
                        onClick={() => setLightbox({ collectionId: col.id, index: idx })}
                        style={{ cursor: 'zoom-in' }}
                        title="Click para ver completa"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.url} alt={photo.filename} className={styles.image} loading="lazy" />
                        <span style={{
                          position: 'absolute',
                          top: '0.4rem',
                          left: '0.4rem',
                          backgroundColor: 'rgba(0,0,0,0.6)',
                          color: 'white',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          padding: '0.15rem 0.45rem',
                          borderRadius: '999px',
                          backdropFilter: 'blur(2px)',
                        }}>
                          {String(idx + 1).padStart(String(col.photos.length).length, '0')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── LIGHTBOX ── */}
      {lightbox && lightboxPhoto && lightboxCollection && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.94)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
            backdropFilter: 'blur(4px)',
          }}
        >
          {/* Imagen */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxPhoto.url}
            alt={lightboxPhoto.filename}
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '92vw',
              maxHeight: '88vh',
              objectFit: 'contain',
              borderRadius: '6px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              userSelect: 'none',
            }}
          />

          {/* Toolbar superior derecha */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: '1rem',
              right: '1rem',
              display: 'flex',
              gap: '0.5rem',
              zIndex: 1001,
            }}
          >
            <button
              onClick={() => handleCopyImage(lightboxPhoto.url)}
              disabled={copying}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.55rem 1rem', borderRadius: 'var(--radius)',
                backgroundColor: copyOk ? 'rgba(34,197,94,0.95)' : 'rgba(255,255,255,0.95)',
                color: copyOk ? 'white' : '#111',
                border: 'none', fontWeight: 600,
                cursor: copying ? 'not-allowed' : 'pointer', fontSize: '0.875rem',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                transition: 'all 0.2s',
                opacity: copying ? 0.7 : 1,
              }}
              title="Copiar imagen al portapapeles (para pegar en Canva, etc.)"
            >
              {copyOk ? <><Check size={15} /> Copiada</> : copying ? 'Copiando...' : <><Copy size={15} /> Copiar imagen</>}
            </button>
            <button
              onClick={() => setLightbox(null)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '40px', height: '40px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255,255,255,0.15)',
                color: 'white',
                border: 'none', cursor: 'pointer',
                backdropFilter: 'blur(4px)',
              }}
              title="Cerrar (Esc)"
            >
              <X size={20} />
            </button>
          </div>

          {/* Info inferior centrada */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              bottom: '1rem',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(0,0,0,0.55)',
              color: 'white',
              padding: '0.5rem 1rem',
              borderRadius: '999px',
              fontSize: '0.8rem',
              backdropFilter: 'blur(6px)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              maxWidth: '90vw',
            }}
          >
            <span style={{ fontWeight: 700 }}>
              {lightbox.index + 1} / {lightboxCollection.photos.length}
            </span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '50vw' }}>
              {lightboxPhoto.filename}
            </span>
          </div>

          {/* Botones laterales */}
          {lightboxCollection.photos.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleLightboxNav('prev'); }}
                style={{
                  position: 'fixed',
                  left: '1rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '48px', height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  color: 'white',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backdropFilter: 'blur(4px)',
                  zIndex: 1001,
                }}
                title="Anterior (←)"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleLightboxNav('next'); }}
                style={{
                  position: 'fixed',
                  right: '1rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '48px', height: '48px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.15)',
                  color: 'white',
                  border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backdropFilter: 'blur(4px)',
                  zIndex: 1001,
                }}
                title="Siguiente (→)"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
