import styles from './page.module.css';
import AuthForm from '@/components/AuthForm';
import { Clock, Award, PenTool, CheckCircle, Smartphone, MapPin } from 'lucide-react';

export default function Home() {
  return (
    <div className={styles.wrapper}>
      {/* Navbar */}
      <header className={styles.navbar}>
        <div className={styles.navContainer}>
          <div className={styles.logo}>PHOTOBOOKTUC</div>
          <div className={styles.navLinks}>
            <a href="#productos">Productos</a>
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
            <a href="#auth" className={styles.mobileCta}>Comenzá Ahora</a>
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

      {/* Products Section */}
      <section className={styles.products} id="productos">
        <div className={styles.sectionContainer}>
          <h2 className={styles.sectionTitle}>Nuestros Productos</h2>
          <p className={styles.sectionSubtitle}>Fotografías y fotobooks diseñados para emocionar</p>
          <div className={styles.productGrid}>
            <div className={styles.productCard}>
              <h3>Fotobook A4 Clásico</h3>
              <div className={styles.price}>$39.990</div>
              <ul>
                <li>13 hojas (26 páginas)</li>
                <li>Capacidad hasta 50 fotos</li>
                <li>Ideal para eventos y viajes</li>
              </ul>
            </div>
            <div className={styles.productCard}>
              <h3>Fotobook A5 Compacto</h3>
              <div className={styles.price}>$38.990</div>
              <ul>
                <li>26 hojas (52 páginas)</li>
                <li>Capacidad para 52 fotos</li>
                <li>Diseño minimalista y ordenado</li>
              </ul>
            </div>
            <div className={styles.productCard}>
              <h3>Fotobook Personalizado</h3>
              <div className={styles.price}>Variable</div>
              <ul>
                <li>Formato libre</li>
                <li>Hojas y fotos ilimitadas</li>
                <li>Diseño 100% a tu medida</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Emotional Section */}
      <section className={styles.editorial}>
        <div className={styles.sectionContainer}>
          <div className={styles.editorialContent}>
            <h2>El Mejor Regalo</h2>
            <p>
              Regalar un photobook es mucho más que entregar un presente; es regalar la oportunidad de detener el tiempo. En un mundo donde todo pasa rápido y las fotos se pierden en la galería del celular, entregar un libro impreso es una invitación a sentarse, compartir y revivir esas historias que nos hicieron felices. Es transformar un archivo digital invisible en un tesoro tangible que se puede tocar, oler y disfrutar en familia.
            </p>
            <p>
              A diferencia de la ropa o la tecnología que pasan de moda, este es un regalo que gana valor con los años. Es el detalle perfecto para quien cree que ya lo tiene todo, porque nadie espera recibir sus propios recuerdos convertidos en una obra de arte. Un photobook no se guarda en un cajón; se deja en la mesa del living para volver a emocionar, una y otra vez, a quien más querés.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className={styles.footer} id="contacto">
        <div className={styles.sectionContainer}>
          <div className={styles.footerSplit}>
            <div>
              <h2 className={styles.logo}>PHOTOBOOKTUC</h2>
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
