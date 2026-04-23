'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { collection, onSnapshot, query, orderBy, setDoc, doc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import styles from './page.module.css';
import { FolderPlus, Folder, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface CollectionData {
  id: string;
  name: string;
  createdAt: unknown;
}

export default function DashboardLibraryPage() {
  const { user } = useAuth();
  const [collections, setCollections] = useState<CollectionData[]>([]);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, `users/${user.uid}/collections`),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const colData: CollectionData[] = [];
      snapshot.forEach((doc) => {
        colData.push({ id: doc.id, ...doc.data() } as CollectionData);
      });
      setCollections(colData);
    });

    return () => unsubscribe();
  }, [user]);

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!user || !newCollectionName.trim()) return;

    setIsCreating(true);
    try {
      const tempId = Date.now().toString() + '-' + Math.floor(Math.random() * 1000);
      await setDoc(doc(db, `users/${user.uid}/collections`, tempId), {
        name: newCollectionName.trim(),
        createdAt: Timestamp.now()
      });
      
      setNewCollectionName('');
      router.push(`/dashboard/collection/${tempId}`);
    } catch (error) {
      console.error("Error creating collection:", error);
      setErrorMsg("Error de permisos. Asegúrate de actualizar las Reglas de Firebase Security (ver consola).");
      alert("Error al crear la colección.\n\nEs probable que Firebase Security Rules esté bloqueando la escritura. Si ves esto en producción, actualiza las reglas a 'match /users/{userId}/{document=**}' en tu Firebase Console.");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div>
      <div className={styles.dashboardHeader}>
        <div>
          <h2 className={styles.title}>Tu Biblioteca</h2>
          <p className={styles.subtitle}>Crea colecciones para organizar tus fotos</p>
        </div>
      </div>

      <div style={{
        backgroundColor: 'var(--surface)',
        padding: '2rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        marginBottom: '3rem'
      }}>
        <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', fontWeight: 600 }}>Crear Nueva Colección</h3>
        
        {errorMsg && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', padding: '1rem', borderRadius: 'var(--radius)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--danger)' }}>
            <AlertTriangle size={20} />
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleCreateCollection} style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="ej. Boda 2026, Cumpleaños..."
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--background)',
              color: 'var(--foreground)'
            }}
            required
          />
          <button 
            type="submit"
            disabled={isCreating || !newCollectionName.trim()}
            style={{
              backgroundColor: 'var(--primary)',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: 'var(--radius)',
              fontWeight: 600,
              cursor: isCreating || !newCollectionName.trim() ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              opacity: isCreating || !newCollectionName.trim() ? 0.7 : 1
            }}
          >
            <FolderPlus size={20} />
            {isCreating ? 'Creando...' : 'Crear'}
          </button>
        </form>
      </div>

      <div className={styles.gallerySection}>
        <h3 className={styles.galleryHeader}>Tus Colecciones ({collections.length})</h3>
        
        {collections.length === 0 ? (
          <div className={styles.emptyGallery}>
            <Folder size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
            <p>Todavía no has creado ninguna colección.</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
            gap: '1.5rem'
          }}>
            {collections.map((col) => (
              <Link 
                href={`/dashboard/collection/${col.id}`} 
                key={col.id}
                style={{ textDecoration: 'none' }}
              >
                <div style={{
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  transition: 'transform 0.2s, border-color 0.2s',
                  cursor: 'pointer'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.borderColor = 'var(--primary)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'none';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }}
                >
                  <Folder size={32} color="var(--primary)" />
                  <div style={{ overflow: 'hidden' }}>
                    <h4 style={{ 
                      color: 'var(--foreground)', 
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>{col.name}</h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Abrir colección</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
