'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { LogOut, Printer } from 'lucide-react';
import Image from 'next/image';
import styles from '../dashboard/layout.module.css'; // Reuso estilos del dashboard

export default function ImprentaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push('/');
      } else if (profile?.isAdmin) {
        // admins also can access (admin trumps)
        return;
      } else if (!profile?.isImprenta) {
        router.push('/dashboard');
      }
    }
  }, [user, profile, loading, router]);

  if (loading || !user || (!profile?.isImprenta && !profile?.isAdmin)) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Verificando acceso de imprenta...</p>
      </div>
    );
  }

  const handleSignOut = async () => {
    await signOut(auth);
    router.push('/');
  };

  return (
    <div className={styles.dashboardContainer}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className={styles.logo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
              <Image src="/logo.png" alt="Panel Imprenta" width={48} height={48} style={{ objectFit: 'cover', borderRadius: '50%' }} />
            </div>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: '#4338ca',
              fontWeight: 700,
              fontSize: '0.9rem',
              backgroundColor: 'rgba(99,102,241,0.1)',
              padding: '0.3rem 0.7rem',
              borderRadius: '999px',
              border: '1px solid rgba(99,102,241,0.3)',
            }}>
              <Printer size={14} /> Panel Imprenta
            </span>
          </div>
          <div className={styles.userSection}>
            <span className={styles.greeting}>
              {profile?.name || user.email?.split('@')[0]}
            </span>
            <button onClick={handleSignOut} className={styles.logoutBtn} aria-label="Sign out">
              <LogOut size={20} />
              <span className={styles.logoutText}>Cerrar Sesión</span>
            </button>
          </div>
        </div>
      </header>
      <main className={styles.mainContent}>
        {children}
      </main>
    </div>
  );
}
