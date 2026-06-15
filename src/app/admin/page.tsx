'use client';

import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Search, UserCheck, CheckCircle2, Circle, Folder, Archive, Users, PackageCheck, Sparkles, StickyNote, DollarSign, Clock } from 'lucide-react';
import Link from 'next/link';

interface UserData {
  id: string;
  name: string;
  lastName: string;
  whatsapp: string;
  email: string;
  createdAt: string;
  photobookType?: string;
  clientStatus?: 'active' | 'done' | 'finalized';
  clientStatusUpdatedAt?: { seconds: number };
  hasArchived?: boolean;
  hasNewOrder?: boolean;
  hasClientNote?: boolean;
  hasAdminNotes?: boolean;
  adminNotes?: string;
  aggregatedAdminNotes?: string; // legacy
  designerPaid?: boolean;
}

type ClientStatus = 'active' | 'done' | 'finalized';

const STATUS_LABELS: Record<ClientStatus, string> = {
  active: 'Pendiente',
  done: 'Realizado',
  finalized: 'Pedido Finalizado',
};

const STATUS_COLORS: Record<ClientStatus, { bg: string; color: string; border: string }> = {
  active:    { bg: 'var(--background)',           color: 'var(--text-muted)', border: 'var(--border)' },
  done:      { bg: 'rgba(34,197,94,0.1)',         color: '#16a34a',           border: 'rgba(34,197,94,0.4)' },
  finalized: { bg: 'rgba(168,85,247,0.1)',        color: '#9333ea',           border: 'rgba(168,85,247,0.4)' },
};

// Fecha corta dd/mm/aa a partir de un Timestamp de Firestore.
function fmtStatusDate(ts?: { seconds: number }) {
  if (!ts?.seconds) return '';
  const d = new Date(ts.seconds * 1000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

export default function AdminDirectory() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'directory' | 'archived'>('directory');
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const usersList: UserData[] = [];
        snapshot.forEach((d) => {
          usersList.push({ id: d.id, ...d.data() } as UserData);
        });
        setUsers(usersList);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching users:", error);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleChangeStatus = async (userId: string, newStatus: ClientStatus) => {
    setTogglingId(userId);
    try {
      const now = Timestamp.now();
      await updateDoc(doc(db, 'users', userId), { clientStatus: newStatus, clientStatusUpdatedAt: now });
      setUsers(prev =>
        prev.map(u => u.id === userId ? { ...u, clientStatus: newStatus, clientStatusUpdatedAt: now } : u)
      );
    } catch (error) {
      console.error("Error actualizando estado:", error);
    } finally {
      setTogglingId(null);
    }
  };

  const handleToggleDesignerPaid = async (userId: string, current: boolean) => {
    const newValue = !current;
    // Update optimista
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, designerPaid: newValue } : u));
    try {
      await updateDoc(doc(db, 'users', userId), { designerPaid: newValue });
      // Reflejar el cambio en el registro de estadísticas del cliente (mismo concepto).
      // El id del registro es determinístico: `client-{userId}`. Si todavía no existe
      // (cliente no sincronizado), se ignora; al sincronizar tomará el valor del usuario.
      try {
        await updateDoc(doc(db, 'salesRecords', `client-${userId}`), { designerPaid: newValue });
      } catch {
        // El registro puede no existir todavía. No es un error.
      }
    } catch (error) {
      console.error("Error actualizando pago al diseñador:", error);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, designerPaid: current } : u));
    }
  };

  const matchesSearch = (user: UserData) => {
    const term = searchTerm.toLowerCase();
    return (
      (user.name && user.name.toLowerCase().includes(term)) ||
      (user.lastName && user.lastName.toLowerCase().includes(term)) ||
      (user.whatsapp && user.whatsapp.toLowerCase().includes(term)) ||
      (user.email && user.email.toLowerCase().includes(term))
    );
  };

  const pendingUsers = users.filter(u => (!u.clientStatus || u.clientStatus === 'active') && matchesSearch(u));
  const doneUsers = users.filter(u => u.clientStatus === 'done' && matchesSearch(u));
  const finalizedUsers = users.filter(u => u.clientStatus === 'finalized' && matchesSearch(u));
  const archivedUsers = users.filter(u => u.hasArchived && matchesSearch(u));

  const tabStyle = (tab: 'directory' | 'archived'): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.6rem 1.25rem',
    borderRadius: 'var(--radius)',
    fontWeight: 600,
    fontSize: '0.9rem',
    cursor: 'pointer',
    border: 'none',
    transition: 'background-color 0.2s, color 0.2s',
    backgroundColor: activeTab === tab ? 'var(--primary)' : 'var(--surface)',
    color: activeTab === tab ? 'white' : 'var(--text-muted)',
    boxShadow: activeTab === tab ? '0 2px 8px rgba(59,130,246,0.25)' : 'none',
  });

  const renderClientCard = (user: UserData) => {
    const status: ClientStatus = (user.clientStatus as ClientStatus) || 'active';
    const isDone = status === 'done';
    const isFinalized = status === 'finalized';
    const colors = STATUS_COLORS[status];

    const cardBorder = isFinalized
      ? 'rgba(168,85,247,0.35)'
      : isDone ? 'rgba(34,197,94,0.35)' : 'var(--border)';
    const cardBorderHover = isFinalized
      ? 'rgba(168,85,247,0.6)'
      : isDone ? 'rgba(34,197,94,0.6)' : 'var(--primary)';

    return (
      <div key={user.id} style={{ position: 'relative' }}>
        <Link
          href={`/admin/${user.id}`}
          style={{
            backgroundColor: 'var(--surface)',
            border: `1px solid ${cardBorder}`,
            borderRadius: 'var(--radius)',
            padding: '1.25rem 1.5rem',
            display: 'block',
            transition: 'border-color 0.2s',
            textDecoration: 'none',
            color: 'inherit',
            opacity: status === 'active' ? 1 : 0.85,
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = cardBorderHover}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = cardBorder}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{
                fontSize: '1.1rem',
                fontWeight: 600,
                color: status === 'active' ? 'var(--primary)' : 'var(--text-muted)',
                marginBottom: '0.4rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                flexWrap: 'wrap',
              }}>
                {user.name} {user.lastName}
                {user.photobookType && (
                  <span style={{
                    fontSize: '0.72rem',
                    backgroundColor: 'rgba(245,158,11,0.12)',
                    color: '#b45309',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    fontWeight: 600,
                    border: '1px solid rgba(245,158,11,0.3)',
                    whiteSpace: 'nowrap',
                  }}>
                    📖 {user.photobookType}
                  </span>
                )}
                {user.hasArchived && (
                  <span style={{
                    fontSize: '0.7rem',
                    backgroundColor: 'rgba(99,102,241,0.12)',
                    color: '#6366f1',
                    padding: '0.1rem 0.5rem',
                    borderRadius: '999px',
                    fontWeight: 500,
                    border: '1px solid rgba(99,102,241,0.25)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}>
                    <Archive size={10} /> Archivados
                  </span>
                )}
                {user.hasNewOrder && (
                  <span style={{
                    fontSize: '0.7rem',
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    fontWeight: 700,
                    letterSpacing: '0.03em',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    boxShadow: '0 2px 6px rgba(245,158,11,0.4)',
                  }}>
                    <Sparkles size={11} /> NUEVO PEDIDO
                  </span>
                )}
                {user.hasClientNote && (
                  <span style={{
                    fontSize: '0.7rem',
                    backgroundColor: 'rgba(245,158,11,0.12)',
                    color: '#b45309',
                    padding: '0.15rem 0.55rem',
                    borderRadius: '999px',
                    fontWeight: 600,
                    border: '1px solid rgba(245,158,11,0.3)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    whiteSpace: 'nowrap',
                  }}>
                    <StickyNote size={11} /> Nota de diseño
                  </span>
                )}
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <span>{user.whatsapp}</span>
                <span>{user.email}</span>
              </div>

              {/* Checkbox interactivo: pago al diseñador */}
              <label
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleToggleDesignerPaid(user.id, !!user.designerPaid);
                }}
                style={{
                  marginTop: '0.6rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: user.designerPaid ? '#15803d' : 'var(--text-muted)',
                  backgroundColor: user.designerPaid ? 'rgba(34,197,94,0.1)' : 'var(--background)',
                  border: `1px solid ${user.designerPaid ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  padding: '0.35rem 0.7rem',
                  width: 'fit-content',
                  transition: 'all 0.2s',
                  userSelect: 'none',
                }}
                title={user.designerPaid ? 'Pago al diseñador realizado' : 'Marcar pago al diseñador'}
              >
                <input
                  type="checkbox"
                  checked={!!user.designerPaid}
                  readOnly
                  style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: '#16a34a', pointerEvents: 'none' }}
                />
                <DollarSign size={13} /> Pagado al diseñador
              </label>

              {(() => {
                const noteText = (user.adminNotes ?? user.aggregatedAdminNotes ?? '').trim();
                if (!noteText) return null;
                return (
                  <div style={{
                    marginTop: '0.75rem',
                    padding: '0.65rem 0.8rem',
                    backgroundColor: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: 'calc(var(--radius) - 0.2rem)',
                    fontSize: '0.78rem',
                    color: '#78350f',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.5,
                    position: 'relative',
                  }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontWeight: 700,
                      fontSize: '0.65rem',
                      color: '#b45309',
                      marginBottom: '0.35rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}>
                      <StickyNote size={11} /> Notas internas
                    </div>
                    {noteText}
                  </div>
                );
              })()}
            </div>

            {/* Dropdown de estado + fecha del último cambio */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
              <select
                value={status}
                disabled={togglingId === user.id}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onChange={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleChangeStatus(user.id, e.target.value as ClientStatus);
                }}
                style={{
                  padding: '0.45rem 0.6rem',
                  borderRadius: 'var(--radius)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: togglingId === user.id ? 'not-allowed' : 'pointer',
                  border: `1px solid ${colors.border}`,
                  backgroundColor: colors.bg,
                  color: colors.color,
                  transition: 'all 0.2s',
                  opacity: togglingId === user.id ? 0.5 : 1,
                  minWidth: '155px',
                }}
              >
                <option value="active" style={{ backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}>⚪ Pendiente</option>
                <option value="done" style={{ backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}>✅ Realizado</option>
                <option value="finalized" style={{ backgroundColor: 'var(--surface)', color: 'var(--foreground)' }}>📦 Pedido Finalizado</option>
              </select>
              {user.clientStatusUpdatedAt && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.68rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  <Clock size={10} /> {fmtStatusDate(user.clientStatusUpdatedAt)}
                </span>
              )}
            </div>
          </div>
        </Link>
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '0.25rem' }}>Panel de Administración</h2>
        <p style={{ color: 'var(--text-muted)' }}>Gestioná tus clientes y sus colecciones.</p>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '1.75rem',
        backgroundColor: 'var(--surface)',
        padding: '0.4rem',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        width: 'fit-content',
      }}>
        <button style={tabStyle('directory')} onClick={() => setActiveTab('directory')}>
          <Users size={16} />
          Directorio
          <span style={{
            backgroundColor: activeTab === 'directory' ? 'rgba(255,255,255,0.25)' : 'var(--border)',
            color: activeTab === 'directory' ? 'white' : 'var(--text-muted)',
            borderRadius: '999px',
            fontSize: '0.75rem',
            padding: '0 0.5rem',
            fontWeight: 700,
          }}>
            {users.length}
          </span>
        </button>

        <button style={tabStyle('archived')} onClick={() => setActiveTab('archived')}>
          <Archive size={16} />
          Archivados
          {archivedUsers.length > 0 && (
            <span style={{
              backgroundColor: activeTab === 'archived' ? 'rgba(255,255,255,0.25)' : 'rgba(99,102,241,0.15)',
              color: activeTab === 'archived' ? 'white' : '#6366f1',
              borderRadius: '999px',
              fontSize: '0.75rem',
              padding: '0 0.5rem',
              fontWeight: 700,
            }}>
              {archivedUsers.length}
            </span>
          )}
        </button>
      </div>

      {/* Buscador */}
      <div style={{ position: 'relative', maxWidth: '420px', marginBottom: '2rem' }}>
        <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="Buscar por nombre, teléfono o email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '0.7rem 1rem 0.7rem 2.75rem',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
            fontSize: '0.95rem',
            color: 'var(--foreground)',
          }}
        />
      </div>

      {/* ── TAB: DIRECTORIO ── */}
      {activeTab === 'directory' && (
        <>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando clientes...</div>
          ) : (
            <>
              {/* PENDIENTES */}
              <div style={{ marginBottom: '2.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <Circle size={18} color="var(--text-muted)" />
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Pendientes
                  </h3>
                  <span style={{ backgroundColor: 'var(--border)', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700, padding: '0 0.5rem', color: 'var(--text-muted)' }}>
                    {pendingUsers.length}
                  </span>
                </div>

                {pendingUsers.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {searchTerm ? 'Sin resultados.' : '¡Todo al día! No hay clientes pendientes.'}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                    {pendingUsers.map(renderClientCard)}
                  </div>
                )}
              </div>

              {/* Divider Realizados */}
              {doneUsers.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border)' }} />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <CheckCircle2 size={14} color="#16a34a" /> REALIZADOS ({doneUsers.length})
                  </span>
                  <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border)' }} />
                </div>
              )}

              {/* REALIZADOS */}
              {doneUsers.length > 0 && (
                <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', marginBottom: '2.5rem' }}>
                  {doneUsers.map(renderClientCard)}
                </div>
              )}

              {/* Divider Pedido Finalizado */}
              {finalizedUsers.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                  <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border)' }} />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <PackageCheck size={14} color="#9333ea" /> PEDIDO FINALIZADO ({finalizedUsers.length})
                  </span>
                  <div style={{ flex: 1, height: '1px', backgroundColor: 'var(--border)' }} />
                </div>
              )}

              {/* PEDIDO FINALIZADO */}
              {finalizedUsers.length > 0 && (
                <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                  {finalizedUsers.map(renderClientCard)}
                </div>
              )}

              {pendingUsers.length === 0 && doneUsers.length === 0 && finalizedUsers.length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <UserCheck size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                  <p style={{ color: 'var(--text-muted)' }}>No se encontraron clientes.</p>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── TAB: ARCHIVADOS ── */}
      {activeTab === 'archived' && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            Clientes con colecciones archivadas. Hacé click para ver sus colecciones.
          </p>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Cargando...</div>
          ) : archivedUsers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', backgroundColor: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <Archive size={48} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
              <p style={{ color: 'var(--text-muted)' }}>No hay colecciones archivadas todavía.</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                Cuando archives una colección desde el detalle de un cliente, aparecerá aquí.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {archivedUsers.map((user) => (
                <Link
                  key={user.id}
                  href={`/admin/${user.id}`}
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    borderRadius: 'var(--radius)',
                    padding: '1.25rem 1.5rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    textDecoration: 'none',
                    color: 'inherit',
                    gap: '1rem',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = '#6366f1'}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(99,102,241,0.25)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                      backgroundColor: 'rgba(99,102,241,0.1)',
                      borderRadius: '50%',
                      width: '40px',
                      height: '40px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      <Folder size={20} color="#6366f1" />
                    </div>
                    <div>
                      <p style={{ fontWeight: 600, color: 'var(--foreground)', marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {user.name} {user.lastName}
                        {user.photobookType && (
                          <span style={{
                            fontSize: '0.7rem',
                            backgroundColor: 'rgba(245,158,11,0.12)',
                            color: '#b45309',
                            padding: '0.1rem 0.5rem',
                            borderRadius: '999px',
                            fontWeight: 600,
                            border: '1px solid rgba(245,158,11,0.3)',
                          }}>
                            📖 {user.photobookType}
                          </span>
                        )}
                      </p>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user.email}</p>
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.8rem',
                    color: '#6366f1',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    whiteSpace: 'nowrap',
                  }}>
                    <Archive size={14} /> Ver archivados →
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
