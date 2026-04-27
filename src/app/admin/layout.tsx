'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import styles from '../dashboard/layout.module.css'; // Reusing dashboard styles

export default function AdminLayout({
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
      } else if (!profile?.isAdmin) {
        router.push('/dashboard');
      }
    }
  }, [user, profile, loading, router]);

  if (loading || !user || !profile?.isAdmin) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Verificando acceso de administrador...</p>
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
            <div className={styles.logo} style={{ display: 'flex', alignItems: 'center' }}>
              <Image src="/logo.png" alt="Admin Panel" width={180} height={32} style={{ objectFit: 'contain' }} />
            </div>
            <Link href="/admin" style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              Directorio
            </Link>
          </div>
          <div className={styles.userSection}>
            <span className={styles.greeting}>
              Admin: {profile.name}
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
