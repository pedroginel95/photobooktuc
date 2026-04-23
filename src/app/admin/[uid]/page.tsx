'use client';

import React, { useEffect, useState, use } from 'react';
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DownloadCloud, ArrowLeft, Image as ImageIcon, Folder } from 'lucide-react';
import Link from 'next/link';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import styles from '../../dashboard/page.module.css';

interface UserData {
  name: string;
  lastName: string;
  whatsapp: string;
  email: string;
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
}

export default function ClientDetail({ params }: { params: Promise<{ uid: string }> }) {
  const resolvedParams = use(params);
  const uid = resolvedParams.uid;
  
  const [client, setClient] = useState<UserData | null>(null);
  const [collections, setCollections] = useState<CollectionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

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
          
          cols.push({
            id: d.id,
            name: d.data().name || 'Unnamed',
            photos: pList
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
          const response = await fetch(photo.url);
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
      alert("Failed to download files.");
    } finally {
      setDownloadingId(null);
      setDownloadProgress(0);
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando colecciones del cliente...</div>;
  }

  if (!client) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>Cliente no encontrado.</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '1rem', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Volver al Directorio
        </Link>
        <div>
          <h2 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--foreground)' }}>
            {client.name} {client.lastName}
          </h2>
          <div style={{ color: 'var(--text-muted)', marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
            <span>Teléfono: {client.whatsapp}</span>
            <span>Correo: {client.email}</span>
          </div>
        </div>
      </div>

      <div className={styles.gallerySection}>
        <h3 className={styles.galleryHeader} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>Colecciones del Cliente</h3>
        
        {collections.length === 0 ? (
          <div className={styles.emptyGallery}>
            <Folder size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
            <p>Este cliente todavía no ha creado ninguna colección.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
            {collections.map((col) => (
              <div key={col.id} style={{ 
                backgroundColor: 'var(--surface)', 
                padding: '2rem', 
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)'
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
                    <Folder size={24} color="var(--primary)" />
                    <h4 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{col.name} <span style={{ color: 'var(--text-muted)', fontSize: '1rem', fontWeight: 400 }}>({col.photos.length} fotos)</span></h4>
                  </div>
                  
                  <button 
                    onClick={() => handleDownloadCollection(col)}
                    disabled={downloadingId === col.id || col.photos.length === 0}
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
                    }}
                  >
                    <DownloadCloud size={18} />
                    {downloadingId === col.id ? `Comprimiendo... ${downloadProgress}%` : `Descargar Zip`}
                  </button>
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
