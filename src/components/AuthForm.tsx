'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import styles from './AuthForm.module.css';

export default function AuthForm() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [lastName, setLastName] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [photobookType, setPhotobookType] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        router.push('/dashboard');
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        
        // Save user profile metadata to Firestore
        await setDoc(doc(db, 'users', user.uid), {
          name,
          lastName,
          whatsapp,
          email,
          photobookType,
          createdAt: new Date().toISOString()
        });
        
        router.push('/dashboard');
      }
    } catch (err: unknown) {
      console.error(err);
      setError((err as Error).message || 'Ocurrió un error durante la autenticación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.authContainer}>
      <h2 className={styles.title}>{isLogin ? 'Bienvenido de nuevo' : 'Crear Cuenta'}</h2>
      <p className={styles.subtitle}>
        {isLogin 
          ? 'Ingresa tus credenciales para acceder a tu galería' 
          : 'Regístrate para subir fotos sin pérdida de calidad'}
      </p>

      {error && <div className={styles.error}>{error}</div>}

      <form onSubmit={handleAuth} className={styles.form}>
        {!isLogin && (
          <>
            <div className={styles.inputGroup}>
              <label htmlFor="name" className={styles.label}>Nombre</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={styles.input}
                required={!isLogin}
              />
            </div>
            <div className={styles.inputGroup}>
              <label htmlFor="lastName" className={styles.label}>Apellido</label>
              <input
                id="lastName"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className={styles.input}
                required={!isLogin}
              />
            </div>
            <div className={styles.inputGroup}>
              <label htmlFor="whatsapp" className={styles.label}>Número de WhatsApp</label>
              <input
                id="whatsapp"
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                className={styles.input}
                placeholder="+1 234 567 8900"
                required={!isLogin}
              />
            </div>

            <div className={styles.inputGroup}>
              <label className={styles.label}>
                Tipo de Foto Libro <span className={styles.required}>*</span>
              </label>
              <p className={styles.fieldHint}>Seleccioná el modelo que encargaste</p>
              <div className={styles.optionGrid}>
                {[
                  { value: 'A4 Tapa Dura',   size: 'A4', cover: 'Tapa Dura' },
                  { value: 'A5 Tapa Dura',   size: 'A5', cover: 'Tapa Dura' },
                  { value: 'A4 Tapa Blanda', size: 'A4', cover: 'Tapa Blanda' },
                  { value: 'A5 Tapa Blanda', size: 'A5', cover: 'Tapa Blanda' },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className={`${styles.optionCard} ${photobookType === opt.value ? styles.optionCardSelected : ''}`}
                  >
                    <input
                      type="radio"
                      name="photobookType"
                      value={opt.value}
                      checked={photobookType === opt.value}
                      onChange={(e) => setPhotobookType(e.target.value)}
                      required={!isLogin}
                      className={styles.optionRadio}
                    />
                    <span className={styles.optionSize}>{opt.size}</span>
                    <span className={styles.optionCover}>{opt.cover}</span>
                  </label>
                ))}
              </div>
            </div>
          </>
        )}

        <div className={styles.inputGroup}>
          <label htmlFor="email" className={styles.label}>Correo electrónico</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input}
            required
          />
        </div>

        <div className={styles.inputGroup}>
          <label htmlFor="password" className={styles.label}>Contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.input}
            required
          />
        </div>

        <button type="submit" className={styles.button} disabled={loading}>
          {loading ? 'Procesando...' : isLogin ? 'Iniciar Sesión' : 'Registrarse'}
        </button>
      </form>

      <div className={styles.toggleText}>
        {isLogin ? "¿No tienes una cuenta? " : "¿Ya tienes una cuenta? "}
        <button 
          type="button" 
          onClick={() => setIsLogin(!isLogin)}
          className={styles.toggleLink}
        >
          {isLogin ? 'Registrarse' : 'Iniciar Sesión'}
        </button>
      </div>
    </div>
  );
}
