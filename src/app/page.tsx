import styles from './page.module.css';
import AuthForm from '@/components/AuthForm';
import { Clock, Award, PenTool, CheckCircle, Smartphone, MapPin } from 'lucide-react';
import Image from 'next/image';

export default function Home() {
  return (
    <div className={styles.wrapper}>
      {/* Navbar */}
      <header className={styles.navbar}>
        <div className={styles.navContainer}>
          <div className={styles.logo} style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.75rem' }}>
            <Image src="/logo.png" alt="Photobook Tuc" width={56} height={56} style={{ objectFit: 'cover', borderRadius: '50%' }} />
            <span className={styles.desktopLogoText}>PHOTOBOOKTUC</span>
          </div>
          <div className={styles.navLinks}>
            <a href="#contacto">Contacto</a>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className={styles.heroWrap}>
        <main className={styles.main}>
          <div className={styles.heroSection}>
            <h1 className={styles.title}>Hacé que tus recuerdos duren para siempre.</h1>
            <p className={styles.description}>
              Diseñamos tu book a medida de tus necesidades y gustos. Subí hasta 50 fotos por álbum directamente desde tu celular, sin perder calidad.
            </p>
            <div className={styles.badges}>
              <span className={styles.badge}><CheckCircle size={18}/> Calidad Láser</span>
              <span className={styles.badge}><Smartphone size={18}/> Directo de tu celular</span>
            </div>
            <a href="#auth" className={styles.mobileCta}>Carga tus fotos</a>
          </div>
          <div className={styles.authSection} id="auth">
            <AuthForm />
          </div>
        </main>
      </section>

      {/* Features Section */}
      <section className={styles.features}>
        <div className={styles.sectionContainer}>
          <div className={styles.featureGrid}>
            <div className={styles.featureItem}>
              <div className={styles.iconWrap}><Clock size={32} /></div>
              <h3>Entrega Rápida</h3>
              <p>Tu photobook listo y en tus manos en menos de 7 días.</p>
            </div>
            <div className={styles.featureItem}>
              <div className={styles.iconWrap}><Award size={32} /></div>
              <h3>Calidad Premium</h3>
              <p>Impreso en alta calidad láser y entregado con tapas de 300 gramos de espesor.</p>
            </div>
            <div className={styles.featureItem}>
              <div className={styles.iconWrap}><PenTool size={32} /></div>
              <h3>Diseño Único</h3>
              <p>5 plantillas de diseño básicas. Vos elegís y nosotros terminamos la magia personalizada para vos.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer} id="contacto">
        <div className={styles.sectionContainer}>
          <div className={styles.footerSplit}>
            <div>
              <div className={styles.logo} style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.75rem' }}>
                <Image src="/logo.png" alt="Photobook Tuc" width={56} height={56} style={{ objectFit: 'cover', borderRadius: '50%' }} />
                <span className={styles.desktopLogoText}>PHOTOBOOKTUC</span>
              </div>
              <p className={styles.footerDetail}>
                <MapPin size={18} style={{display:'inline', marginRight:'8px'}} />
                Envíos a domicilio sin cargo en San Miguel de Tucumán y alrededores.
              </p>
            </div>
            <div className={styles.socials}>
              <a href="https://wa.me/5493816090225" target="_blank" rel="noopener noreferrer">WhatsApp</a>
              <a href="https://www.instagram.com/photobooktuc/" target="_blank" rel="noopener noreferrer">Instagram</a>
              <a href="https://www.facebook.com/profile.php?id=61587267113057" target="_blank" rel="noopener noreferrer">Facebook</a>
            </div>
          </div>
          <div className={styles.copyright}>
            © {new Date().getFullYear()} PHOTOBOOKTUC. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}
