'use client';

import React, { useEffect, useState, use } from 'react';
import { doc, getDoc, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { DownloadCloud, ArrowLeft, Image as ImageIcon } from 'lucide-react';
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

export default function ClientDetail({ params }: { params: Promise<{ uid: string }> }) {
  const resolvedParams = use(params);
  const uid = resolvedParams.uid;
  
  const [client, setClient] = useState<UserData | null>(null);
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch client details
        const docRef = doc(db, 'users', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setClient(docSnap.data() as UserData);
        }

        // Fetch client photos
        const q = query(collection(db, `users/${uid}/photos`), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        const photosList: PhotoData[] = [];
        querySnapshot.forEach((d) => {
          photosList.push({ id: d.id, ...d.data() } as PhotoData);
        });
        setPhotos(photosList);
      } catch (error) {
        console.error("Error fetching data:", error);
      } finally {
        setLoading(false);
      }
    };

    if (uid) fetchData();
  }, [uid]);

  const handleDownloadAll = async () => {
    if (photos.length === 0) return;
    setDownloading(true);
    setDownloadProgress(0);

    try {
      const zip = new JSZip();
      
      let processed = 0;
      
      // Fetch each image as blob and add to zip
      for (const photo of photos) {
        try {
          const response = await fetch(photo.url);
          const blob = await response.blob();
          
          zip.file(photo.filename, blob);
          
          processed += 1;
          setDownloadProgress(Math.round((processed / photos.length) * 100));
        } catch (err) {
          console.error(`Failed to fetch ${photo.filename}`, err);
        }
      }

      // Generate Zip
      const zipBlob = await zip.generateAsync({ type: "blob" });
      saveAs(zipBlob, `${client?.name || 'Client'}_${client?.lastName || 'Photos'}.zip`);
      
    } catch (error) {
      console.error("Error zipping files:", error);
      alert("Failed to download files.");
    } finally {
      setDownloading(false);
      setDownloadProgress(0);
    }
  };

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading client data...</div>;
  }

  if (!client) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>Client not found.</div>;
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <Link href="/admin" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', marginBottom: '1rem', textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Back to Directory
        </Link>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--foreground)' }}>
              {client.name} {client.lastName}
            </h2>
            <div style={{ color: 'var(--text-muted)', marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
              <span>Phone: {client.whatsapp}</span>
              <span>Email: {client.email}</span>
            </div>
          </div>
          
          <div>
            <button 
              onClick={handleDownloadAll}
              disabled={downloading || photos.length === 0}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: downloading ? 'var(--border)' : 'var(--primary)',
                color: downloading ? 'var(--text-muted)' : 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: 'var(--radius)',
                fontWeight: 600,
                cursor: downloading || photos.length === 0 ? 'not-allowed' : 'pointer',
                transition: 'background-color 0.2s',
                marginTop: '1rem'
              }}
            >
              <DownloadCloud size={20} />
              {downloading ? `Zipping... ${downloadProgress}%` : `Download All (${photos.length})`}
            </button>
            {downloading && (
              <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                Fetching raw images. This may take a moment.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={styles.gallerySection}>
        <h3 className={styles.galleryHeader}>Uploaded Images</h3>
        
        {photos.length === 0 ? (
          <div className={styles.emptyGallery}>
            <ImageIcon size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
            <p>This client hasn&apos;t uploaded any photos yet.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {photos.map((photo) => (
              <div key={photo.id} className={styles.imageWrapper}>
                {/* Fallback to full image for previews. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt={photo.filename} className={styles.image} loading="lazy" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
