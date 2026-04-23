'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import styles from './layout.module.css';
import { auth } from '@/lib/firebase';
import { signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';

export default function DashboardLayout({
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
        router.push('/admin');
      }
    }
  }, [user, profile, loading, router]);

  if (loading || !user) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Cargando tu biblioteca...</p>
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
          <h1 className={styles.logo}>PHOTOBOOKTUC</h1>
          <div className={styles.userSection}>
            <span className={styles.greeting}>
              Hola, {profile?.name || user.email?.split('@')[0]}
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
