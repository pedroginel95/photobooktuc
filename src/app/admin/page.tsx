'use client';

import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Search, UserCheck } from 'lucide-react';
import Link from 'next/link';

interface UserData {
  id: string;
  name: string;
  lastName: string;
  whatsapp: string;
  email: string;
  createdAt: string;
}

export default function AdminDirectory() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        
        const usersList: UserData[] = [];
        querySnapshot.forEach((doc) => {
          usersList.push({ id: doc.id, ...doc.data() } as UserData);
        });
        
        setUsers(usersList);
      } catch (error) {
        console.error("Error fetching users:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const filteredUsers = users.filter((user) => {
    const term = searchTerm.toLowerCase();
    return (
      (user.name && user.name.toLowerCase().includes(term)) ||
      (user.lastName && user.lastName.toLowerCase().includes(term)) ||
      (user.whatsapp && user.whatsapp.toLowerCase().includes(term)) ||
      (user.email && user.email.toLowerCase().includes(term))
    );
  });

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.5rem' }}>Directorio de Clientes</h2>
        <p style={{ color: 'var(--text-muted)' }}>Gestiona tus clientes y accede a sus colecciones subidas.</p>
      </div>

      <div style={{ position: 'relative', maxWidth: '400px', marginBottom: '2rem' }}>
        <Search 
          size={20} 
          style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} 
        />
        <input
          type="text"
          placeholder="Buscar por nombre, whatsapp, o email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.75rem 1rem 0.75rem 3rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            fontSize: '1rem',
            color: 'var(--foreground)'
          }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando clientes...</div>
      ) : filteredUsers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <UserCheck size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
          <p>No se encontraron clientes que coincidan con la búsqueda.</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gap: '1rem',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))'
        }}>
          {filteredUsers.map((user) => (
            <Link 
              key={user.id} 
              href={`/admin/${user.id}`}
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '1.5rem',
                display: 'block',
                transition: 'border-color 0.2s',
                textDecoration: 'none',
                color: 'inherit'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.5rem' }}>
                {user.name} {user.lastName}
              </h3>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span><strong>Teléfono:</strong> {user.whatsapp}</span>
                <span><strong>Correo:</strong> {user.email}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
