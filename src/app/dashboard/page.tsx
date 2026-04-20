'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { collection, doc, setDoc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import { storage, db } from '@/lib/firebase';
import styles from './page.module.css';
import { UploadCloud, Image as ImageIcon } from 'lucide-react';

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

export default function DashboardPage() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [photos, setPhotos] = useState<PhotoData[]>([]);

  useEffect(() => {
    if (!user) return;

    // Real-time listener for user's photos
    const q = query(
      collection(db, `users/${user.uid}/photos`),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const photosData: PhotoData[] = [];
      snapshot.forEach((doc) => {
        photosData.push({ id: doc.id, ...doc.data() } as PhotoData);
      });
      setPhotos(photosData);
    });

    return () => unsubscribe();
  }, [user]);

  const handleCardClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploads(Array.from(e.target.files));
      
      // Reset input so the same files can be selected again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleUploads = (files: File[]) => {
    if (!user) return;

    files.forEach((file) => {
      const tempId = Date.now().toString() + '-' + Math.floor(Math.random() * 1000);
      const filename = file.name;
      const storageRef = ref(storage, `users/${user.uid}/${tempId}-${filename}`);
      
      const uploadTask = uploadBytesResumable(storageRef, file);

      // Add to tracked uploads
      setUploads(prev => [...prev, { filename, progress: 0 }]);

      uploadTask.on('state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploads(prev => 
            prev.map(u => u.filename === filename ? { ...u, progress } : u)
          );
        },
        (error) => {
          console.error("Upload failed", error);
        },
        async () => {
          // Upload complete
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          
          // Save reference to Firestore
          await setDoc(doc(db, `users/${user.uid}/photos`, tempId), {
            filename,
            url: downloadURL,
            createdAt: Timestamp.now()
          });

          // Remove from tracked uploads shortly after finish
          setTimeout(() => {
            setUploads(prev => prev.filter(u => u.filename !== filename));
          }, 1500);
        }
      );
    });
  };

  return (
    <div>
      <div className={styles.dashboardHeader}>
        <div>
          <h2 className={styles.title}>Your Gallery</h2>
          <p className={styles.subtitle}>Upload and preview your photos here.</p>
        </div>
      </div>

      <div className={styles.uploaderCard} onClick={handleCardClick}>
        <UploadCloud size={48} className={styles.uploadIcon} />
        <div className={styles.uploadText}>Tap to select photos from your device</div>
        <div className={styles.uploadSubtext}>Upload original, high-quality files directly</div>
        <input 
          type="file" 
          multiple 
          accept="image/*" 
          className={styles.fileInput}
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <button className={styles.uploadBtn}>Browse Files</button>
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
                <div 
                  className={styles.progressBar} 
                  style={{ width: `${upload.progress}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={styles.gallerySection}>
        <h3 className={styles.galleryHeader}>Uploaded Photos ({photos.length})</h3>
        
        {photos.length === 0 ? (
          <div className={styles.emptyGallery}>
            <ImageIcon size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
            <p>No photos uploaded yet. They will appear here once uploaded.</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {photos.map((photo) => (
              <div key={photo.id} className={styles.imageWrapper}>
                {/* Fallback to full image for previews. In production, a cloud function creates tiny thumbnails */}
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
