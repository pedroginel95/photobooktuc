'use client';

import React, { useEffect, useState, use } from 'react';
import { doc, getDoc, collection, getDocs, query, orderBy, deleteDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DownloadCloud, ArrowLeft, Image as ImageIcon, Folder, Trash2, Archive, ArchiveRestore, Eye, EyeOff, Pencil, Save, X } from 'lucide-react';
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

  useEffect(() => {
    const fetchData = async () => {
      try {
        const docRef = doc(db, 'users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setClient(docSnap.data() as UserData);
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

      for (const photo of col.photos) {
        try {
          const proxyUrl = `/api/proxy?url=${encodeURIComponent(photo.url)}`;
          const response = await fetch(proxyUrl);
          if (!response.ok) throw new Error('Failed to fetch via proxy');

          const blob = await response.blob();
          zip.file(photo.filename, blob);

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
                border: `1px solid ${col.archived ? 'var(--text-muted)' : 'var(--border)'}`,
                opacity: col.archived ? 0.75 : 1,
              }}>
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
                    {col.photos.map((photo) => (
                      <div key={photo.id} className={styles.imageWrapper}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo.url} alt={photo.filename} className={styles.image} loading="lazy" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
