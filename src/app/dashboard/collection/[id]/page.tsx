'use client';

import React, { useState, useRef, useEffect, use } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, doc, setDoc, getDoc, onSnapshot, query, orderBy, Timestamp, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { storage, db } from '@/lib/firebase';
import styles from '../../page.module.css';
import {
  UploadCloud, Image as ImageIcon, ArrowLeft,
  GripVertical, ChevronUp, ChevronDown, SortAsc, Check,
  Trash2, CheckSquare, Square, X
} from 'lucide-react';
import Link from 'next/link';

interface UploadProgress {
  filename: string;
  progress: number;
}

interface PhotoData {
  id: string;
  url: string;
  filename: string;
  createdAt: unknown;
}

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const collectionId = resolvedParams.id;

  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [collectionName, setCollectionName] = useState<string>('Cargando...');
  const [photoOrder, setPhotoOrder] = useState<string[]>([]);
  const [orderedPhotos, setOrderedPhotos] = useState<PhotoData[]>([]);

  // Modo ordenar
  const [sortMode, setSortMode] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  // Modo seleccionar / eliminar
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Aplicar orden manual a las fotos
  useEffect(() => {
    if (photoOrder.length > 0) {
      const sorted = [...photos].sort((a, b) => {
        const ai = photoOrder.indexOf(a.id);
        const bi = photoOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      setOrderedPhotos(sorted);
    } else {
      setOrderedPhotos(photos);
    }
  }, [photos, photoOrder]);

  useEffect(() => {
    if (!user || !collectionId) return;

    const fetchCollection = async () => {
      const docRef = doc(db, `users/${user.uid}/collections`, collectionId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setCollectionName(snap.data().name || 'Colección Sin Nombre');
        if (snap.data().photoOrder) {
          setPhotoOrder(snap.data().photoOrder as string[]);
        }
      } else {
        setCollectionName('Colección No Encontrada');
      }
    };
    fetchCollection();

    const q = query(
      collection(db, `users/${user.uid}/collections/${collectionId}/photos`),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const photosData: PhotoData[] = [];
      snapshot.forEach((d) => {
        photosData.push({ id: d.id, ...d.data() } as PhotoData);
      });
      setPhotos(photosData);
    });

    return () => unsubscribe();
  }, [user, collectionId]);

  // ── Subida ──────────────────────────────────────────────────────────────────

  const handleCardClick = () => {
    if (selectMode || sortMode) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploads(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUploads = (files: File[]) => {
    if (!user) return;

    if (photos.length + files.length > 80) {
      alert(`No puedes subir más de 80 fotos por colección. Actualmente tienes ${photos.length} fotos, e intentas subir ${files.length} más.`);
      return;
    }

    files.forEach((file) => {
      const tempId = Date.now().toString() + '-' + Math.floor(Math.random() * 1000);
      const filename = file.name;
      const storageRef = ref(storage, `users/${user.uid}/${collectionId}/${tempId}-${filename}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      setUploads(prev => [...prev, { filename, progress: 0 }]);

      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploads(prev => prev.map(u => u.filename === filename ? { ...u, progress } : u));
        },
        (error) => { console.error("Upload failed", error); },
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          await setDoc(doc(db, `users/${user.uid}/collections/${collectionId}/photos`, tempId), {
            filename,
            url: downloadURL,
            createdAt: Timestamp.now()
          });
          setTimeout(() => {
            setUploads(prev => prev.filter(u => u.filename !== filename));
          }, 1500);
        }
      );
    });
  };

  // ── Ordenar ─────────────────────────────────────────────────────────────────

  const handleMovePhoto = (index: number, direction: 'up' | 'down') => {
    const newPhotos = [...orderedPhotos];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newPhotos.length) return;
    [newPhotos[index], newPhotos[swapIndex]] = [newPhotos[swapIndex], newPhotos[index]];
    setOrderedPhotos(newPhotos);
  };

  const handleSaveOrder = async () => {
    if (!user) return;
    setSavingOrder(true);
    try {
      const newOrder = orderedPhotos.map(p => p.id);
      const colRef = doc(db, `users/${user.uid}/collections`, collectionId);
      await updateDoc(colRef, { photoOrder: newOrder });
      setPhotoOrder(newOrder);
      setSortMode(false);
    } catch (error) {
      console.error("Error guardando orden:", error);
      alert("Error al guardar el orden.");
    } finally {
      setSavingOrder(false);
    }
  };

  const handleCancelSort = () => {
    if (photoOrder.length > 0) {
      const sorted = [...photos].sort((a, b) => {
        const ai = photoOrder.indexOf(a.id);
        const bi = photoOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      setOrderedPhotos(sorted);
    } else {
      setOrderedPhotos(photos);
    }
    setSortMode(false);
  };

  // ── Seleccionar / Eliminar ───────────────────────────────────────────────────

  const handleEnterSelectMode = () => {
    setSortMode(false);
    setSelectMode(true);
    setSelectedPhotos(new Set());
  };

  const handleCancelSelect = () => {
    setSelectMode(false);
    setSelectedPhotos(new Set());
  };

  const handleToggleSelect = (photoId: string) => {
    setSelectedPhotos(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPhotos.size === orderedPhotos.length) {
      setSelectedPhotos(new Set());
    } else {
      setSelectedPhotos(new Set(orderedPhotos.map(p => p.id)));
    }
  };

  const handleDeleteSelected = async () => {
    if (!user || selectedPhotos.size === 0) return;

    const count = selectedPhotos.size;
    if (!confirm(`¿Estás segura de que querés eliminar ${count} foto${count > 1 ? 's' : ''}?\n\nEsta acción no se puede deshacer.`)) return;

    setDeleting(true);
    try {
      const batch = writeBatch(db);
      const toDelete = orderedPhotos.filter(p => selectedPhotos.has(p.id));

      for (const photo of toDelete) {
        // Eliminar documento de Firestore
        const photoRef = doc(db, `users/${user.uid}/collections/${collectionId}/photos`, photo.id);
        batch.delete(photoRef);

        // Eliminar archivo de Storage
        try {
          const storageRef = ref(storage, `users/${user.uid}/${collectionId}/${photo.id}-${photo.filename}`);
          await deleteObject(storageRef);
        } catch {
          // Si el archivo no existe o no se puede borrar, continuar igual
        }
      }

      await batch.commit();

      // Actualizar el orden guardado quitando las fotos eliminadas
      if (photoOrder.length > 0) {
        const newOrder = photoOrder.filter(id => !selectedPhotos.has(id));
        const colRef = doc(db, `users/${user.uid}/collections`, collectionId);
        await updateDoc(colRef, { photoOrder: newOrder });
        setPhotoOrder(newOrder);
      }

      setSelectedPhotos(new Set());
      setSelectMode(false);
    } catch (error) {
      console.error("Error eliminando fotos:", error);
      alert("Hubo un error al eliminar las fotos. Intenta de nuevo.");
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const allSelected = orderedPhotos.length > 0 && selectedPhotos.size === orderedPhotos.length;

  return (
    <div>
      <div className={styles.dashboardHeader}>
        <div>
          <Link href="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '1rem', textDecoration: 'none' }}>
            <ArrowLeft size={16} /> Volver a la Biblioteca
          </Link>
          <h2 className={styles.title}>{collectionName}</h2>
          <p className={styles.subtitle}>Sube fotos directamente a esta colección.</p>
        </div>
      </div>

      {/* Zona de subida — deshabilitada visualmente en modos activos */}
      <div
        className={styles.uploaderCard}
        onClick={handleCardClick}
        style={selectMode || sortMode ? { opacity: 0.4, pointerEvents: 'none', cursor: 'default' } : {}}
      >
        <UploadCloud size={48} className={styles.uploadIcon} />
        <div className={styles.uploadText}>Toca para seleccionar fotos de tu dispositivo</div>
        <div className={styles.uploadSubtext}>Sube archivos originales de alta calidad directamente</div>
        <input
          type="file"
          multiple
          accept="image/*"
          className={styles.fileInput}
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <button className={styles.uploadBtn}>Buscar Archivos</button>
      </div>

      {uploads.length > 0 && (
        <div className={styles.progressList}>
          {uploads.map((upload, idx) => (
            <div key={idx} className={styles.progressItem}>
              <div className={styles.progressHeader}>
                <span className={styles.filename}>{upload.filename}</span>
                <span className={styles.percentage}>{Math.round(upload.progress)}%</span>
              </div>
              <div className={styles.progressBarContainer}>
                <div className={styles.progressBar} style={{ width: `${upload.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.gallerySection}>

        {/* ── Barra de acciones ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>

          <h3 className={styles.galleryHeader} style={{ margin: 0 }}>
            {selectMode
              ? `${selectedPhotos.size} foto${selectedPhotos.size !== 1 ? 's' : ''} seleccionada${selectedPhotos.size !== 1 ? 's' : ''}`
              : `Fotos Subidas (${orderedPhotos.length})`
            }
          </h3>

          {orderedPhotos.length > 0 && (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>

              {/* ── Modo seleccionar activo ── */}
              {selectMode ? (
                <>
                  <button
                    onClick={handleSelectAll}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                      border: '1px solid var(--border)', padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius)', fontWeight: 500, cursor: 'pointer', fontSize: '0.875rem',
                    }}
                  >
                    {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                    {allSelected ? 'Deseleccionar todo' : 'Seleccionar todo'}
                  </button>

                  <button
                    onClick={handleCancelSelect}
                    disabled={deleting}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                      border: '1px solid var(--border)', padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius)', fontWeight: 500, cursor: 'pointer', fontSize: '0.875rem',
                    }}
                  >
                    <X size={15} /> Cancelar
                  </button>

                  <button
                    onClick={handleDeleteSelected}
                    disabled={selectedPhotos.size === 0 || deleting}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      backgroundColor: selectedPhotos.size === 0 ? 'var(--surface)' : 'rgba(239,68,68,0.1)',
                      color: selectedPhotos.size === 0 ? 'var(--text-muted)' : '#ef4444',
                      border: `1px solid ${selectedPhotos.size === 0 ? 'var(--border)' : 'rgba(239,68,68,0.35)'}`,
                      padding: '0.5rem 1rem', borderRadius: 'var(--radius)',
                      fontWeight: 600, cursor: selectedPhotos.size === 0 || deleting ? 'not-allowed' : 'pointer',
                      fontSize: '0.875rem', opacity: deleting ? 0.6 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    <Trash2 size={15} />
                    {deleting ? 'Eliminando...' : `Eliminar${selectedPhotos.size > 0 ? ` (${selectedPhotos.size})` : ''}`}
                  </button>
                </>

              /* ── Modo ordenar activo ── */
              ) : sortMode ? (
                <>
                  <button
                    onClick={handleCancelSort}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                      border: '1px solid var(--border)', padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius)', fontWeight: 500, cursor: 'pointer', fontSize: '0.875rem',
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleSaveOrder}
                    disabled={savingOrder}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      backgroundColor: 'var(--primary)', color: 'white',
                      border: 'none', padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius)', fontWeight: 600,
                      cursor: savingOrder ? 'not-allowed' : 'pointer',
                      fontSize: '0.875rem', opacity: savingOrder ? 0.7 : 1,
                    }}
                  >
                    <Check size={15} />
                    {savingOrder ? 'Guardando...' : 'Guardar orden'}
                  </button>
                </>

              /* ── Botones normales ── */
              ) : (
                <>
                  {orderedPhotos.length > 1 && (
                    <button
                      onClick={() => { setSortMode(true); setSelectMode(false); }}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                        backgroundColor: 'var(--surface)', color: 'var(--foreground)',
                        border: '1px solid var(--border)', padding: '0.5rem 1rem',
                        borderRadius: 'var(--radius)', fontWeight: 500, cursor: 'pointer', fontSize: '0.875rem',
                        transition: 'border-color 0.2s',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
                      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      <SortAsc size={15} /> Ordenar fotos
                    </button>
                  )}

                  <button
                    onClick={handleEnterSelectMode}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                      backgroundColor: 'rgba(239,68,68,0.07)', color: '#ef4444',
                      border: '1px solid rgba(239,68,68,0.25)', padding: '0.5rem 1rem',
                      borderRadius: 'var(--radius)', fontWeight: 500, cursor: 'pointer', fontSize: '0.875rem',
                      transition: 'border-color 0.2s, background-color 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.14)';
                      e.currentTarget.style.borderColor = 'rgba(239,68,68,0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.07)';
                      e.currentTarget.style.borderColor = 'rgba(239,68,68,0.25)';
                    }}
                  >
                    <Trash2 size={15} /> Eliminar fotos
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Aviso modo ordenar */}
        {sortMode && (
          <div style={{
            backgroundColor: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.3)',
            borderRadius: 'var(--radius)', padding: '0.7rem 1rem', marginBottom: '1.25rem',
            color: 'var(--primary)', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <GripVertical size={16} />
            Usá las flechas ↑ ↓ para reordenar. Presioná <strong style={{ marginLeft: '0.2rem' }}>Guardar orden</strong> cuando termines.
          </div>
        )}

        {/* Aviso modo seleccionar */}
        {selectMode && (
          <div style={{
            backgroundColor: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: 'var(--radius)', padding: '0.7rem 1rem', marginBottom: '1.25rem',
            color: '#ef4444', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            <Trash2 size={16} />
            Tocá las fotos que querés eliminar y luego presioná <strong style={{ marginLeft: '0.2rem' }}>Eliminar</strong>.
          </div>
        )}

        {/* Grid de fotos */}
        {orderedPhotos.length === 0 ? (
          <div className={styles.emptyGallery}>
            <ImageIcon size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
            <p>Todavía no has subido fotos a esta colección.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {orderedPhotos.map((photo, idx) => {
              const isSelected = selectedPhotos.has(photo.id);

              return (
                <div
                  key={photo.id}
                  className={styles.imageWrapper}
                  onClick={selectMode ? () => handleToggleSelect(photo.id) : undefined}
                  style={{
                    cursor: selectMode ? 'pointer' : undefined,
                    border: selectMode
                      ? isSelected ? '2.5px solid #ef4444' : '2px solid var(--border)'
                      : sortMode ? '2px solid var(--primary)' : undefined,
                    boxShadow: selectMode && isSelected ? '0 0 0 1px rgba(239,68,68,0.2)' : undefined,
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.url} alt={photo.filename} className={styles.image} loading="lazy" />

                  {/* Overlay modo seleccionar */}
                  {selectMode && (
                    <>
                      {/* Oscurecer si está seleccionada */}
                      {isSelected && (
                        <div style={{
                          position: 'absolute', inset: 0,
                          backgroundColor: 'rgba(239,68,68,0.18)',
                        }} />
                      )}
                      {/* Checkbox esquina superior derecha */}
                      <div style={{
                        position: 'absolute', top: '0.5rem', right: '0.5rem',
                        width: '26px', height: '26px', borderRadius: '50%',
                        backgroundColor: isSelected ? '#ef4444' : 'rgba(255,255,255,0.9)',
                        border: `2px solid ${isSelected ? '#ef4444' : 'rgba(0,0,0,0.3)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
                        transition: 'all 0.15s',
                      }}>
                        {isSelected && <Check size={14} color="white" strokeWidth={3} />}
                      </div>
                    </>
                  )}

                  {/* Controles modo ordenar */}
                  {sortMode && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.4rem 0.5rem',
                      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)',
                    }}>
                      <button
                        onClick={() => handleMovePhoto(idx, 'up')}
                        disabled={idx === 0}
                        style={{
                          backgroundColor: idx === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
                          color: 'white', border: 'none', borderRadius: '4px',
                          width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.4 : 1,
                        }}
                        title="Mover arriba"
                      >
                        <ChevronUp size={16} />
                      </button>
                      <span style={{ color: 'white', fontSize: '0.7rem', fontWeight: 600 }}>
                        {idx + 1}/{orderedPhotos.length}
                      </span>
                      <button
                        onClick={() => handleMovePhoto(idx, 'down')}
                        disabled={idx === orderedPhotos.length - 1}
                        style={{
                          backgroundColor: idx === orderedPhotos.length - 1 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.25)',
                          color: 'white', border: 'none', borderRadius: '4px',
                          width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: idx === orderedPhotos.length - 1 ? 'not-allowed' : 'pointer',
                          opacity: idx === orderedPhotos.length - 1 ? 0.4 : 1,
                        }}
                        title="Mover abajo"
                      >
                        <ChevronDown size={16} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
