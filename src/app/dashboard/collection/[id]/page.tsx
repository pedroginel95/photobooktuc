'use client';

import React, { useState, useRef, useEffect, useMemo, use } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { collection, doc, setDoc, getDoc, getDocs, onSnapshot, query, orderBy, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { storage, db } from '@/lib/firebase';
import styles from '../../page.module.css';
import {
  UploadCloud, Image as ImageIcon, ArrowLeft,
  GripVertical, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown,
  SortAsc, Check, Trash2, CheckSquare, Square, X, StickyNote, Save
} from 'lucide-react';
import Link from 'next/link';

interface UploadProgress {
  id: string;        // id único del archivo (no el nombre: puede repetirse)
  filename: string;
  progress: number;
  error?: boolean;
}

// Cuántas fotos se suben a la vez. Subir todas en paralelo agota memoria/red
// (sobre todo en celulares, con conversión HEIC y generación de miniaturas).
const UPLOAD_CONCURRENCY = 3;

interface PhotoData {
  id: string;
  url: string;            // Original full-res: descarga, vista grande e impresion.
  thumbUrl?: string;      // Miniatura liviana, SOLO para el preview de ordenar.
  thumbStoragePath?: string;
  filename: string;
  createdAt: unknown;
}

// Genera una miniatura liviana (JPEG comprimido) a partir del blob original.
// NO toca el original: solo se usa para mostrar el preview mas rapido.
const makeThumbnail = (blob: Blob, maxSize = 600, quality = 0.6): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No se pudo crear el contexto del canvas')); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (out) => out ? resolve(out) : reject(new Error('toBlob devolvio null')),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('No se pudo cargar la imagen para la miniatura')); };
    img.src = objectUrl;
  });

export default function CollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const collectionId = resolvedParams.id;

  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [collectionName, setCollectionName] = useState<string>('Cargando...');
  const [photoOrder, setPhotoOrder] = useState<string[]>([]);

  // Nota de diseño que el cliente deja para el diseñador.
  const [clientNote, setClientNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  // Borrador editable mientras se ordena manualmente (modo ordenar).
  const [draftPhotos, setDraftPhotos] = useState<PhotoData[]>([]);

  // Modo ordenar
  const [sortMode, setSortMode] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  // Modo seleccionar / eliminar
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  // Drag & drop (mouse)
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Drag táctil (touch/mobile)
  const touchDragIdx = useRef<number | null>(null);

  // Orden canónico (guardado): derivado de photos + photoOrder.
  const sortedPhotos = useMemo(() => {
    if (photoOrder.length === 0) return photos;
    return [...photos].sort((a, b) => {
      const ai = photoOrder.indexOf(a.id);
      const bi = photoOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [photos, photoOrder]);

  // En modo ordenar mostramos el borrador editable; si no, el orden canónico.
  // Así nuevas subidas no rompen el orden manual en curso (el borrador es independiente).
  const orderedPhotos = sortMode ? draftPhotos : sortedPhotos;

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
        const note = (snap.data().clientNote as string) || '';
        setClientNote(note);
        setSavedNote(note);
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

  // Sube UN archivo de punta a punta. Lanza si falla, para poder contarlo.
  const uploadOne = async (uid: string, file: File, tempId: string) => {
    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif') || file.type === 'image/heic' || file.type === 'image/heif';
    // Nombre final: si es HEIC lo guardamos como .jpg
    const filename = isHeic ? file.name.replace(/\.(heic|heif)$/i, '.jpg') : file.name;

    setUploads(prev => [...prev, { id: tempId, filename, progress: 0 }]);

    try {
      // 1) Convertir HEIC → JPEG si hace falta (si falla, se sube el original)
      let blob: Blob = file;
      if (isHeic) {
        try {
          const { default: heic2any } = await import('heic2any');
          const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
          blob = (Array.isArray(converted) ? converted[0] : converted) as Blob;
        } catch (err) {
          console.error('Error convirtiendo HEIC, se sube el original:', err);
          blob = file;
        }
      }

      // 2) Subir el original con seguimiento de progreso
      const storageRef = ref(storage, `users/${uid}/${collectionId}/${tempId}-${filename}`);
      const uploadTask = uploadBytesResumable(storageRef, blob);
      await new Promise<void>((resolve, reject) => {
        uploadTask.on('state_changed',
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            setUploads(prev => prev.map(u => u.id === tempId ? { ...u, progress } : u));
          },
          (err) => reject(err),
          () => resolve()
        );
      });
      const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);

      // 3) Miniatura liviana SOLO para el preview. Si falla, seguimos sin ella.
      let thumbUrl = '';
      let thumbStoragePath = '';
      try {
        const thumbBlob = await makeThumbnail(blob);
        thumbStoragePath = `users/${uid}/${collectionId}/thumbs/${tempId}-${filename}`;
        const thumbRef = ref(storage, thumbStoragePath);
        await uploadBytes(thumbRef, thumbBlob);
        thumbUrl = await getDownloadURL(thumbRef);
      } catch (err) {
        console.error('No se pudo generar la miniatura:', err);
        thumbStoragePath = '';
      }

      // 4) Registrar la foto
      await setDoc(doc(db, `users/${uid}/collections/${collectionId}/photos`, tempId), {
        filename,
        url: downloadURL,
        thumbUrl,
        thumbStoragePath,
        createdAt: Timestamp.now()
      });

      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.id !== tempId));
      }, 1200);
    } catch (err) {
      // La dejamos visible marcada como error para que la clienta lo vea.
      console.error(`Falló la subida de "${filename}":`, err);
      setUploads(prev => prev.map(u => u.id === tempId ? { ...u, error: true } : u));
      throw err;
    }
  };

  const handleUploads = async (files: File[]) => {
    if (!user) return;
    const uid = user.uid;

    if (photos.length + files.length > 160) {
      alert(`No puedes subir más de 160 fotos por colección. Actualmente tienes ${photos.length} fotos, e intentas subir ${files.length} más.`);
      return;
    }

    // Limpiar errores de intentos anteriores
    setUploads(prev => prev.filter(u => !u.error));

    const batchTs = Date.now();
    const items = files.map((file, idx) => ({
      file,
      tempId: `${batchTs}-${idx}-${Math.random().toString(36).slice(2, 12)}`,
    }));

    // Cola con concurrencia limitada: varios "workers" toman de a un archivo.
    let cursor = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < items.length) {
        const { file, tempId } = items[cursor++];
        try {
          await uploadOne(uid, file, tempId);
        } catch {
          failed++;
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, items.length) }, worker)
    );

    if (failed > 0) {
      alert(
        `${failed} de ${items.length} foto${items.length !== 1 ? 's' : ''} no se pudieron subir.\n\n` +
        `Quedaron marcadas en rojo en la lista. Volvé a seleccionarlas para reintentar; ` +
        `las que ya subieron no se duplican.`
      );
    }
  };

  // ── Ordenar ─────────────────────────────────────────────────────────────────

  const handleMovePhoto = (index: number, direction: 'up' | 'down') => {
    const newPhotos = [...orderedPhotos];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newPhotos.length) return;
    [newPhotos[index], newPhotos[swapIndex]] = [newPhotos[swapIndex], newPhotos[index]];
    setDraftPhotos(newPhotos);
  };

  const handleMoveToFirst = (index: number) => {
    if (index === 0) return;
    const newPhotos = [...orderedPhotos];
    const [moved] = newPhotos.splice(index, 1);
    newPhotos.unshift(moved);
    setDraftPhotos(newPhotos);
  };

  const handleMoveToLast = (index: number) => {
    if (index === orderedPhotos.length - 1) return;
    const newPhotos = [...orderedPhotos];
    const [moved] = newPhotos.splice(index, 1);
    newPhotos.push(moved);
    setDraftPhotos(newPhotos);
  };

  const handleSetPosition = (fromIndex: number, inputValue: string) => {
    const pos = parseInt(inputValue, 10);
    if (isNaN(pos)) return;
    const toIndex = Math.min(Math.max(0, pos - 1), orderedPhotos.length - 1);
    if (toIndex === fromIndex) return;
    const newPhotos = [...orderedPhotos];
    const [moved] = newPhotos.splice(fromIndex, 1);
    newPhotos.splice(toIndex, 0, moved);
    setDraftPhotos(newPhotos);
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
    // Descartamos el borrador; el render vuelve al orden canónico (sortedPhotos).
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

        // Eliminar la miniatura asociada (si existe)
        if (photo.thumbStoragePath) {
          try {
            await deleteObject(ref(storage, photo.thumbStoragePath));
          } catch {
            // Si no existe, continuar
          }
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

  // ── Nota de diseño ───────────────────────────────────────────────────────────

  const handleSaveNote = async () => {
    if (!user) return;
    setSavingNote(true);
    setNoteSaved(false);
    try {
      const trimmed = clientNote.trim();
      const colRef = doc(db, `users/${user.uid}/collections`, collectionId);
      await updateDoc(colRef, { clientNote: trimmed });

      // Reflejar a nivel usuario si tiene al menos una colección con nota,
      // para mostrar el indicador en el directorio del admin.
      try {
        const colsSnap = await getDocs(collection(db, `users/${user.uid}/collections`));
        const anyNote = colsSnap.docs.some(d => {
          const n = d.id === collectionId ? trimmed : ((d.data().clientNote as string) || '').trim();
          return n.length > 0;
        });
        await updateDoc(doc(db, 'users', user.uid), { hasClientNote: anyNote });
      } catch (flagErr) {
        console.error('No se pudo actualizar el indicador de nota:', flagErr);
      }

      setSavedNote(trimmed);
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2500);
    } catch (error) {
      console.error('Error guardando la nota:', error);
      alert('No se pudo guardar la nota. Intentá de nuevo.');
    } finally {
      setSavingNote(false);
    }
  };

  const noteDirty = clientNote.trim() !== savedNote.trim();

  // ── Render ───────────────────────────────────────────────────────────────────

  const allSelected = orderedPhotos.length > 0 && selectedPhotos.size === orderedPhotos.length;

  const btnStyle: React.CSSProperties = {
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: 'white', border: 'none', borderRadius: '4px',
    width: '26px', height: '26px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  };

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

      {/* ── Nota de diseño para el diseñador ── */}
      <div style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '1.1rem 1.25rem',
        marginBottom: '1.5rem',
      }}>
        <label htmlFor="clientNote" style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.3rem' }}>
          <StickyNote size={16} color="#b45309" /> Nota para el diseñador
        </label>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.6rem', lineHeight: 1.45 }}>
          Dejá acá cualquier sugerencia de diseño y el diseñador la va a seguir. Por ejemplo:
          “quiero que el photobook tenga esta frase en la foto 10” o “quiero que el título de este book sea: …”.
        </p>
        <textarea
          id="clientNote"
          value={clientNote}
          onChange={(e) => setClientNote(e.target.value)}
          placeholder="Ej: Quiero que el título del book sea “Nuestra Boda 2026” y que en la foto 10 vaya la frase “Para siempre”."
          rows={4}
          style={{
            width: '100%', padding: '0.7rem', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', backgroundColor: 'var(--background)',
            color: 'var(--foreground)', fontFamily: 'inherit', fontSize: '0.9rem',
            resize: 'vertical', lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.6rem' }}>
          <button
            onClick={handleSaveNote}
            disabled={savingNote || !noteDirty}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
              backgroundColor: 'var(--primary)', color: 'white', border: 'none',
              padding: '0.55rem 1.1rem', borderRadius: 'var(--radius)', fontWeight: 600,
              fontSize: '0.85rem',
              cursor: savingNote || !noteDirty ? 'not-allowed' : 'pointer',
              opacity: savingNote || !noteDirty ? 0.6 : 1,
            }}
          >
            <Save size={15} /> {savingNote ? 'Guardando...' : 'Guardar nota'}
          </button>
          {noteSaved && !noteDirty && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: '#15803d', fontSize: '0.82rem', fontWeight: 600 }}>
              <Check size={14} /> Nota guardada
            </span>
          )}
          {noteDirty && !savingNote && (
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>Cambios sin guardar</span>
          )}
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
          {uploads.map((upload) => (
            <div key={upload.id} className={styles.progressItem}>
              <div className={styles.progressHeader}>
                <span className={styles.filename}>{upload.filename}</span>
                <span className={styles.percentage} style={upload.error ? { color: '#ef4444', fontWeight: 700 } : undefined}>
                  {upload.error ? 'Error' : `${Math.round(upload.progress)}%`}
                </span>
              </div>
              <div className={styles.progressBarContainer}>
                <div
                  className={styles.progressBar}
                  style={{
                    width: upload.error ? '100%' : `${upload.progress}%`,
                    backgroundColor: upload.error ? '#ef4444' : undefined,
                  }}
                />
              </div>
              {upload.error && (
                <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>
                  No se pudo subir. Volvé a seleccionarla para reintentar.
                </span>
              )}
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
                      onClick={() => { setDraftPhotos(sortedPhotos); setSortMode(true); setSelectMode(false); }}
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
            Arrastrá las fotos para reordenarlas (también podés usar las flechas ↑ ↓). Presioná <strong style={{ marginLeft: '0.2rem' }}>Guardar orden</strong> cuando termines.
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

              const isDragging = draggedIndex === idx;

              return (
                <div
                  key={photo.id}
                  className={styles.imageWrapper}
                  data-sort-idx={idx}
                  onClick={selectMode ? () => handleToggleSelect(photo.id) : undefined}
                  // Drag mouse (desktop)
                  draggable={sortMode}
                  onDragStart={(e) => {
                    if (!sortMode) return;
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggedIndex(idx);
                  }}
                  onDragOver={(e) => {
                    if (!sortMode || draggedIndex === null) return;
                    e.preventDefault();
                    if (draggedIndex === idx) return;
                    const newPhotos = [...orderedPhotos];
                    const [moved] = newPhotos.splice(draggedIndex, 1);
                    newPhotos.splice(idx, 0, moved);
                    setDraftPhotos(newPhotos);
                    setDraggedIndex(idx);
                  }}
                  onDragEnd={() => setDraggedIndex(null)}
                  onDrop={(e) => { e.preventDefault(); setDraggedIndex(null); }}
                  // Drag táctil (mobile)
                  onTouchStart={() => {
                    if (!sortMode) return;
                    touchDragIdx.current = idx;
                  }}
                  onTouchMove={(e) => {
                    if (!sortMode || touchDragIdx.current === null) return;
                    e.preventDefault();
                    const touch = e.touches[0];
                    const el = document.elementFromPoint(touch.clientX, touch.clientY);
                    const card = el?.closest('[data-sort-idx]') as HTMLElement | null;
                    if (!card) return;
                    const targetIdx = Number(card.getAttribute('data-sort-idx'));
                    if (isNaN(targetIdx) || targetIdx === touchDragIdx.current) return;
                    const newPhotos = [...orderedPhotos];
                    const [moved] = newPhotos.splice(touchDragIdx.current, 1);
                    newPhotos.splice(targetIdx, 0, moved);
                    setDraftPhotos(newPhotos);
                    touchDragIdx.current = targetIdx;
                  }}
                  onTouchEnd={() => { touchDragIdx.current = null; }}
                  style={{
                    cursor: selectMode ? 'pointer' : sortMode ? 'grab' : undefined,
                    border: selectMode
                      ? isSelected ? '2.5px solid #ef4444' : '2px solid var(--border)'
                      : sortMode ? '2px solid var(--primary)' : undefined,
                    boxShadow: selectMode && isSelected ? '0 0 0 1px rgba(239,68,68,0.2)' : undefined,
                    opacity: isDragging ? 0.4 : 1,
                    transform: isDragging ? 'scale(0.96)' : undefined,
                    transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.15s, transform 0.15s',
                    touchAction: sortMode ? 'none' : undefined,
                  }}
                >
                  {/* Preview liviano: usa la miniatura; si no hay (fotos viejas), cae al original.
                      El original full-res sigue en photo.url para descarga/impresión. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.thumbUrl || photo.url} alt={photo.filename} className={styles.image} loading="lazy" decoding="async" />

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
                    <>
                      {/* Input de posición — arriba centrado */}
                      <div style={{
                        position: 'absolute', top: '0.35rem', left: 0, right: 0,
                        display: 'flex', justifyContent: 'center',
                      }}>
                        <input
                          type="number"
                          min={1}
                          max={orderedPhotos.length}
                          defaultValue={idx + 1}
                          key={`${photo.id}-${idx}`}
                          onClick={(e) => e.stopPropagation()}
                          onFocus={(e) => e.currentTarget.select()}
                          onBlur={(e) => handleSetPosition(idx, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                            e.stopPropagation();
                          }}
                          title="Escribí el número de posición y presioná Enter"
                          style={{
                            width: '52px', textAlign: 'center',
                            padding: '0.2rem 0.3rem',
                            borderRadius: '6px',
                            border: '2px solid rgba(255,255,255,0.8)',
                            backgroundColor: 'rgba(0,0,0,0.65)',
                            color: 'white', fontWeight: 700, fontSize: '0.85rem',
                            outline: 'none', cursor: 'text',
                          }}
                        />
                      </div>

                      {/* Barra de controles — abajo */}
                      <div style={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.3rem 0.4rem',
                        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(2px)',
                        gap: '0.2rem',
                      }}>
                        {/* Al inicio */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveToFirst(idx); }}
                          disabled={idx === 0}
                          title="Mover al inicio"
                          style={{ ...btnStyle, opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? 'not-allowed' : 'pointer' }}
                        >
                          <ChevronsUp size={13} />
                        </button>
                        {/* Arriba */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMovePhoto(idx, 'up'); }}
                          disabled={idx === 0}
                          title="Mover una posición arriba"
                          style={{ ...btnStyle, opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? 'not-allowed' : 'pointer' }}
                        >
                          <ChevronUp size={13} />
                        </button>

                        {/* Ícono drag */}
                        <GripVertical size={13} color="rgba(255,255,255,0.5)" style={{ flexShrink: 0 }} />

                        {/* Abajo */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMovePhoto(idx, 'down'); }}
                          disabled={idx === orderedPhotos.length - 1}
                          title="Mover una posición abajo"
                          style={{ ...btnStyle, opacity: idx === orderedPhotos.length - 1 ? 0.3 : 1, cursor: idx === orderedPhotos.length - 1 ? 'not-allowed' : 'pointer' }}
                        >
                          <ChevronDown size={13} />
                        </button>
                        {/* Al final */}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveToLast(idx); }}
                          disabled={idx === orderedPhotos.length - 1}
                          title="Mover al final"
                          style={{ ...btnStyle, opacity: idx === orderedPhotos.length - 1 ? 0.3 : 1, cursor: idx === orderedPhotos.length - 1 ? 'not-allowed' : 'pointer' }}
                        >
                          <ChevronsDown size={13} />
                        </button>
                      </div>
                    </>
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
