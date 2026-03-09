// ============================================================
// CylinderConfigurator.jsx
// Interaktywny konfigurator walca 3D z eksportem do pliku STL
// Używa biblioteki Three.js do renderowania grafiki 3D
// oraz React do zarządzania interfejsem użytkownika
// ============================================================

// Importy z biblioteki React:
// - useEffect: uruchamia kod po załadowaniu komponentu (np. inicjalizacja sceny 3D)
// - useRef: przechowuje referencję do elementu HTML lub dowolnej wartości bez re-renderowania
// - useState: przechowuje wartości które mogą się zmieniać (średnica, długość)
// - useCallback: zapamiętuje funkcję żeby nie tworzyć jej na nowo przy każdym renderze
import { useEffect, useRef, useState, useCallback } from "react";

// Three.js - biblioteka do grafiki 3D w przeglądarce
import * as THREE from "three";

// OrbitControls - rozszerzenie Three.js umożliwiające obracanie/zoom kamerą myszką
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Czcionka używana w interfejsie
const FONT = "'DM Mono', monospace";

// ============================================================
// FUNKCJA EKSPORTU DO STL
// STL to format pliku 3D używany przez drukarki 3D i programy CAD
// Plik STL opisuje bryłę jako zbiór trójkątów z wektorami normalnymi
// ============================================================
function exportSTL(scene, filename) {

  // Zbieramy wszystkie geometrie (siatki trójkątów) ze sceny
  const geos = [];
  scene.traverse((obj) => {
    // Pomijamy obiekty które nie są siatkami (np. światła, kamera)
    if (!obj.isMesh || !obj.geometry) return;

    // Aktualizujemy macierz transformacji obiektu (pozycja, rotacja, skala)
    obj.updateWorldMatrix(true, false);

    // Konwertujemy geometrię do formatu bez indeksów (każdy trójkąt = 3 osobne wierzchołki)
    // - geometria indeksowana: wierzchołki są współdzielone (oszczędza pamięć)
    // - geometria nieindeksowana: każdy trójkąt ma własne 3 wierzchołki (wymagana przez STL)
    const g = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();

    // Aplikujemy transformację świata - przenosimy pozycję/rotację do współrzędnych geometrii
    g.applyMatrix4(obj.matrixWorld);
    geos.push(g);
  });

  // Liczymy łączną liczbę trójkątów we wszystkich geometriach
  // (każde 3 wierzchołki = 1 trójkąt)
  let totalTris = 0;
  geos.forEach((g) => { totalTris += g.attributes.position.count / 3; });

  // Tworzymy bufor binarny o dokładnie wyliczonym rozmiarze:
  // - 84 bajty = nagłówek STL (80 bajtów opisu + 4 bajty liczba trójkątów)
  // - 50 bajtów na każdy trójkąt (12B normal + 3×12B wierzchołki + 2B atrybut)
  const buf = new ArrayBuffer(84 + totalTris * 50);
  const view = new DataView(buf); // DataView pozwala zapisywać bajt po bajcie

  // Zapisujemy nagłówek: 80 bajtów zerowych (opis pliku - tu pusty)
  for (let i = 0; i < 80; i++) view.setUint8(i, 0);

  // Zapisujemy liczbę trójkątów jako 32-bitową liczbę całkowitą (little-endian)
  view.setUint32(80, totalTris, true);

  // Offset - wskaźnik na aktualne miejsce zapisu w buforze
  let offset = 84;

  // Wektory pomocnicze do obliczeń (tworzymy raz poza pętlą dla wydajności)
  const va = new THREE.Vector3(); // wierzchołek A trójkąta
  const vb = new THREE.Vector3(); // wierzchołek B trójkąta
  const vc = new THREE.Vector3(); // wierzchołek C trójkąta
  const n  = new THREE.Vector3(); // wektor normalny (prostopadły do powierzchni)
  const e1 = new THREE.Vector3(); // krawędź AB (do obliczenia normalu)
  const e2 = new THREE.Vector3(); // krawędź AC (do obliczenia normalu)

  // Iterujemy po każdej geometrii i każdym trójkącie
  geos.forEach((g) => {
    const pos = g.attributes.position; // tablica współrzędnych wierzchołków XYZ

    for (let i = 0; i < pos.count; i += 3) {
      // Odczytujemy 3 wierzchołki trójkąta
      va.fromBufferAttribute(pos, i);
      vb.fromBufferAttribute(pos, i + 1);
      vc.fromBufferAttribute(pos, i + 2);

      // Obliczamy wektor normalny przez iloczyn wektorowy krawędzi
      // Normal wskazuje "na zewnątrz" powierzchni - ważne dla drukarki 3D
      e1.subVectors(vb, va); // e1 = B - A
      e2.subVectors(vc, va); // e2 = C - A
      n.crossVectors(e1, e2).normalize(); // normal = e1 × e2 (znormalizowany)

      // Zapisujemy normal (3 × float32 = 12 bajtów)
      view.setFloat32(offset, n.x, true);  offset += 4;
      view.setFloat32(offset, n.y, true);  offset += 4;
      view.setFloat32(offset, n.z, true);  offset += 4;

      // Zapisujemy 3 wierzchołki (każdy 3 × float32 = 12 bajtów, łącznie 36 bajtów)
      [va, vb, vc].forEach((v) => {
        view.setFloat32(offset, v.x, true); offset += 4;
        view.setFloat32(offset, v.y, true); offset += 4;
        view.setFloat32(offset, v.z, true); offset += 4;
      });

      // 2 bajty atrybutu (nieużywane w standardowym STL, zawsze 0)
      view.setUint16(offset, 0, true); offset += 2;
    }

    // Zwalniamy pamięć GPU zajmowaną przez tymczasową geometrię
    g.dispose();
  });

  // Tworzymy plik w pamięci przeglądarki (Blob) i wymuszamy jego pobranie
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); // tymczasowy URL do pliku w pamięci
  a.download = filename;             // nazwa pliku do pobrania
  a.click();                         // symulujemy kliknięcie = pobieranie
  URL.revokeObjectURL(a.href);       // zwalniamy tymczasowy URL z pamięci
}

// ============================================================
// GŁÓWNY KOMPONENT REACT
// Komponent to funkcja która zwraca HTML (JSX) i zarządza stanem
// ============================================================
export default function BoltConfigurator() {

  // ref do elementu <div> w którym będzie renderowana scena Three.js
  const mountRef = useRef(null);

  // ref przechowujący obiekty Three.js (renderer, scena, kamera itp.)
  // używamy ref zamiast state bo zmiana tych obiektów nie powinna
  // powodować ponownego renderowania całego komponentu React
  const sceneRef = useRef({});

  // Stan: aktualna średnica walca w metrach (domyślnie 1.0m)
  // setDiameter to funkcja do zmiany wartości - wywoła ponowne renderowanie
  const [diameter, setDiameter] = useState(1.0);

  // Stan: aktualna długość walca w metrach (domyślnie 2.0m)
  const [length, setLength] = useState(2.0);

  // Stan: czy trwa generowanie pliku STL (blokuje przycisk podczas eksportu)
  const [exporting, setExporting] = useState(false);

  // ============================================================
  // INICJALIZACJA SCENY THREE.JS
  // useEffect z pustą tablicą [] uruchamia się TYLKO RAZ po
  // pierwszym załadowaniu komponentu
  // ============================================================
  useEffect(() => {
    const container = mountRef.current; // element HTML gdzie renderujemy
    const W = container.clientWidth;    // szerokość kontenera w pikselach
    const H = container.clientHeight;   // wysokość kontenera w pikselach

    // --- RENDERER ---
    // WebGLRenderer używa karty graficznej do renderowania 3D
    // antialias: true - wygładzanie krawędzi (eliminuje "schodki")
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);                              // rozmiar obszaru renderowania
    renderer.setPixelRatio(window.devicePixelRatio);     // obsługa ekranów Retina/HiDPI
    renderer.shadowMap.enabled = true;                   // włączamy cienie
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;    // miękkie, rozmyte cienie
    container.appendChild(renderer.domElement);          // dodajemy canvas HTML do strony

    // --- SCENA ---
    // Scena to "świat 3D" - kontener na wszystkie obiekty, światła, kamerę
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d0d0f"); // ciemnogranatowe tło

    // --- KAMERA ---
    // PerspectiveCamera symuluje ludzkie oko - obiekty dalej wyglądają mniejsze
    // Parametry: kąt widzenia (45°), proporcje ekranu, min/max odległość renderowania
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
    camera.position.set(4, 2.5, 4); // pozycja kamery w przestrzeni XYZ
    camera.lookAt(0, 0, 0);         // kamera patrzy na środek sceny

    // --- OŚWIETLENIE ---

    // Światło otoczenia - równomiernie oświetla wszystko, bez cieni
    // Symuluje rozproszone światło dzienne (niebo, odbicia)
    scene.add(new THREE.AmbientLight(0xffffff, 0.3)); // białe, intensywność 30%

    // Światło kierunkowe - jak słońce, równoległe promienie, tworzy cienie
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 8, 5); // pozycja "słońca"
    dirLight.castShadow = true;     // to światło rzuca cienie
    scene.add(dirLight);

    // Światło krawędziowe (rim light) - podświetla krawędzie obiektu
    // Nadaje efekt "blasku" i wyodrębnia obiekt od tła
    const rimLight = new THREE.DirectionalLight(0x88ccff, 0.6); // niebieskawe
    rimLight.position.set(-4, 2, -4);
    scene.add(rimLight);

    // Punktowe światło wypełniające - świeci ze wszystkich stron jak żarówka
    // Dodaje ciepły pomarańczowy odcień od dołu
    const fillLight = new THREE.PointLight(0xff6633, 0.4, 20); // kolor, intensywność, zasięg
    fillLight.position.set(-3, -2, 3);
    scene.add(fillLight);

    // --- SIATKA POMOCNICZA ---
    // Pozioma siatka na "podłodze" - ułatwia orientację w przestrzeni 3D
    const grid = new THREE.GridHelper(10, 20, "#1a1a2e", "#1a1a2e");
    grid.position.y = -2; // przesuwamy siatkę pod walec
    scene.add(grid);

    // --- WALEC (geometria + materiał + siatka) ---

    // Materiał PBR (Physically Based Rendering) - symuluje fizyczne właściwości powierzchni
    // metalness: jak bardzo "metaliczny" wygląd (0=plastik, 1=metal)
    // roughness: chropowatość (0=lustro, 1=matowa)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8e0d0,   // kolor kości słoniowej
      metalness: 0.15,
      roughness: 0.35,
    });

    // CylinderGeometry(radiusTop, radiusBottom, height, segmentsRadial, segmentsHeight)
    // 64 segmenty radialne = walec wygląda gładko (więcej segmentów = gładszy ale wolniejszy)
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 2, 64, 1);

    // Mesh łączy geometrię (kształt) z materiałem (wygląd) - to jest widoczny obiekt 3D
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;    // walec rzuca cień
    mesh.receiveShadow = true; // walec przyjmuje cień
    scene.add(mesh);

    // --- NAKŁADKA WIREFRAME ---
    // Subtelna siatka druciana nałożona na walec - efekt wizualny
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      wireframe: true,   // rysuje tylko krawędzie trójkątów, bez wypełnienia
      transparent: true,
      opacity: 0.06,     // prawie niewidoczna - tylko delikatny efekt
    });
    const wireMesh = new THREE.Mesh(geo.clone(), wireMat); // klon tej samej geometrii
    scene.add(wireMesh);

    // --- ORBIT CONTROLS ---
    // Pozwala użytkownikowi obracać, zoomować i przesuwać kamerę myszką
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;    // włącza bezwładność - kamera "wyhamowuje" płynnie
    controls.dampingFactor = 0.06;    // współczynnik tłumienia (im mniejszy, tym dłużej wyhamowuje)
    controls.minDistance = 1.5;       // minimalna odległość kamery (max zoom in)
    controls.maxDistance = 15;        // maksymalna odległość kamery (max zoom out)

    // --- PĘTLA ANIMACJI ---
    // requestAnimationFrame wywołuje funkcję przed każdą klatką (~60 razy/s)
    // To standardowy sposób animowania w przeglądarce
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate); // zaplanuj następną klatkę
      controls.update();                       // aktualizuj kontrolki (bezwładność)
      renderer.render(scene, camera);          // wyrenderuj aktualną klatkę
    };
    animate(); // startujemy pętlę

    // --- OBSŁUGA ZMIANY ROZMIARU OKNA ---
    // Gdy użytkownik zmieni rozmiar okna, aktualizujemy kamerę i renderer
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h;           // aktualizuj proporcje kamery
      camera.updateProjectionMatrix(); // przelicz macierz projekcji
      renderer.setSize(w, h);          // zmień rozmiar canvasu
    };
    window.addEventListener("resize", onResize);

    // Zapisujemy wszystkie obiekty Three.js do ref - będą potrzebne w innych useEffect
    sceneRef.current = { renderer, scene, camera, mesh, wireMesh, controls, mat };

    // --- CLEANUP (sprzątanie) ---
    // Funkcja zwracana z useEffect jest wywoływana gdy komponent jest usuwany ze strony
    // Zwalniamy wszystkie zasoby żeby nie było wycieków pamięci
    return () => {
      cancelAnimationFrame(animId);              // zatrzymaj pętlę animacji
      window.removeEventListener("resize", onResize); // usuń listener resize
      controls.dispose();                        // zwolnij kontrolki
      renderer.dispose();                        // zwolnij zasoby GPU
      container.removeChild(renderer.domElement); // usuń canvas z HTML
    };
  }, []); // pusta tablica = uruchom tylko raz przy montowaniu komponentu

  // ============================================================
  // AKTUALIZACJA GEOMETRII WALCA
  // Ten useEffect uruchamia się za każdym razem gdy zmieni się
  // diameter lub length (są w tablicy zależności)
  // ============================================================
  useEffect(() => {
    const { mesh, wireMesh } = sceneRef.current;
    if (!mesh) return; // jeśli scena jeszcze nie jest zainicjalizowana, wyjdź

    const radius = diameter / 2; // przeliczamy średnicę na promień

    // Tworzymy nową geometrię z aktualnymi wymiarami
    const newGeo = new THREE.CylinderGeometry(radius, radius, length, 64, 1);

    // Zastępujemy starą geometrię nową
    // dispose() zwalnia starą geometrię z pamięci GPU - WAŻNE żeby nie przeciekała pamięć
    mesh.geometry.dispose();
    mesh.geometry = newGeo;

    // To samo dla nakładki wireframe
    wireMesh.geometry.dispose();
    wireMesh.geometry = newGeo.clone();
  }, [diameter, length]); // uruchom ponownie gdy zmieni się diameter lub length

  // ============================================================
  // FUNKCJA EKSPORTU - opakowana w useCallback
  // useCallback zapamiętuje funkcję i tworzy ją na nowo tylko gdy
  // zmieni się diameter lub length (optymalizacja wydajności)
  // ============================================================
  const handleExport = useCallback(() => {
    const { scene } = sceneRef.current;
    if (!scene) return;

    setExporting(true); // blokujemy przycisk i pokazujemy "GENEROWANIE..."

    // setTimeout z 100ms daje React czas na przerenderowanie przycisku
    // zanim zablokujemy wątek główny generowaniem pliku STL
    setTimeout(() => {
      // Generujemy nazwę pliku z aktualnymi wymiarami, np. "walec_d1.00_l2.00.stl"
      exportSTL(scene, `walec_d${diameter.toFixed(2)}_l${length.toFixed(2)}.stl`);
      setExporting(false); // odblokowujemy przycisk
    }, 100);
  }, [diameter, length]);

  // ============================================================
  // OBLICZENIA GEOMETRYCZNE (przeliczane przy każdym renderze)
  // ============================================================

  // Wzór na objętość walca: V = π × r² × h
  const volume = Math.PI * Math.pow(diameter / 2, 2) * length;

  // Wzór na całkowitą powierzchnię walca: S = 2πr×h + 2πr²
  // (boczna + 2 podstawy)
  const surfaceArea = 2 * Math.PI * (diameter / 2) * length + 2 * Math.PI * Math.pow(diameter / 2, 2);

  // ============================================================
  // JSX - to co komponent renderuje (HTML z supermocami)
  // ============================================================
  return (
    <div style={styles.root}>
      {/* Ładowanie czcionek Google Fonts */}
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap" rel="stylesheet" />

      {/* Pasek nagłówka z tytułem i przyciskiem eksportu */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>CYLINDER</span>
        <span style={styles.headerSub}>KONFIGURATOR</span>
        <div style={{ flex: 1 }} /> {/* elastyczny odstęp - wypycha przycisk na prawo */}
        <button
          // Dynamiczny styl: zielona ramka gdy trwa eksport, ciemna gdy nie
          style={{ ...styles.exportBtn, borderColor: exporting ? "#4ade80" : "#1e1e22" }}
          onClick={handleExport}
          disabled={exporting} // blokuj kliknięcia podczas eksportu
        >
          <span style={{ color: "#4ade80", fontSize: "14px" }}>↓</span>
          {exporting ? "GENEROWANIE..." : "EKSPORT STL"} {/* tekst zmienia się dynamicznie */}
        </button>
      </div>

      {/* Kontener na scenę Three.js - ref pozwala Three.js "wejść" do tego divu */}
      <div ref={mountRef} style={styles.viewport} />

      {/* Panel kontrolny z suwakami i statystykami */}
      <div style={styles.panel}>

        {/* Suwak średnicy */}
        <div style={styles.control}>
          <div style={styles.labelRow}>
            <span style={styles.label}>ŚREDNICA</span>
            {/* toFixed(2) = wyświetl z 2 miejscami po przecinku */}
            <span style={styles.value}>{diameter.toFixed(2)} <span style={styles.unit}>m</span></span>
          </div>
          <div style={styles.sliderWrap}>
            <input
              type="range"
              min={0.2}   // minimalna wartość suwaka
              max={4.0}   // maksymalna wartość suwaka
              step={0.01} // krok co 1cm
              value={diameter}
              // onChange wywołuje się przy każdym przesunięciu suwaka
              // parseFloat konwertuje string z inputa na liczbę
              onChange={(e) => setDiameter(parseFloat(e.target.value))}
              style={styles.slider}
            />
            {/* Kolorowy pasek wypełnienia suwaka - obliczamy % ze wzoru liniowego */}
            <div style={{ ...styles.sliderFill, width: `${((diameter - 0.2) / 3.8) * 100}%` }} />
          </div>
          <div style={styles.rangeLabels}><span>0.20</span><span>4.00</span></div>
        </div>

        {/* Suwak długości - identyczna struktura jak suwak średnicy */}
        <div style={styles.control}>
          <div style={styles.labelRow}>
            <span style={styles.label}>DŁUGOŚĆ</span>
            <span style={styles.value}>{length.toFixed(2)} <span style={styles.unit}>m</span></span>
          </div>
          <div style={styles.sliderWrap}>
            <input
              type="range"
              min={0.2}
              max={8.0}
              step={0.01}
              value={length}
              onChange={(e) => setLength(parseFloat(e.target.value))}
              style={styles.slider}
            />
            <div style={{ ...styles.sliderFill, width: `${((length - 0.2) / 7.8) * 100}%` }} />
          </div>
          <div style={styles.rangeLabels}><span>0.20</span><span>8.00</span></div>
        </div>

        {/* Panel statystyk - 3 komórki z obliczonymi wartościami */}
        <div style={styles.stats}>
          <div style={styles.statItem}>
            <span style={styles.statLabel}>OBJĘTOŚĆ</span>
            <span style={styles.statValue}>{volume.toFixed(3)} m³</span>
          </div>
          <div style={styles.statDivider} />
          <div style={styles.statItem}>
            <span style={styles.statLabel}>POW. BOCZNA</span>
            <span style={styles.statValue}>{surfaceArea.toFixed(3)} m²</span>
          </div>
          <div style={styles.statDivider} />
          <div style={styles.statItem}>
            <span style={styles.statLabel}>PROMIEŃ</span>
            <span style={styles.statValue}>{(diameter / 2).toFixed(3)} m</span>
          </div>
        </div>

        {/* Podpowiedź sterowania */}
        <div style={styles.hint}>
          🖱 Lewy przycisk — obracaj &nbsp;|&nbsp; Scroll — zoom &nbsp;|&nbsp; Prawy — przesuń
        </div>
      </div>

      {/* Style CSS dla suwaka - musi być w <style> bo CSS pseudo-elementy
          (::-webkit-slider-thumb) nie działają w React inline styles */}
      <style>{`
        input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:2px;background:transparent;position:relative;z-index:2;cursor:pointer;outline:none;}
        input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#ff5500;border:2px solid #0d0d0f;box-shadow:0 0 10px #ff550088;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;}
        input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.25);box-shadow:0 0 18px #ff5500cc;}
        input[type=range]::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#ff5500;border:2px solid #0d0d0f;box-shadow:0 0 10px #ff550088;cursor:pointer;}
        button:hover{ background: #1a1a1f !important; }
      `}</style>
    </div>
  );
}

// ============================================================
// STYLE INLINE
// Obiekt ze stylami CSS zapisanymi jako JavaScript
// Używamy camelCase zamiast kebab-case: "flex-direction" → "flexDirection"
// ============================================================
const styles = {
  root:{
    fontFamily: FONT,
    background: "#0d0d0f",   // bardzo ciemne tło
    color: "#e8e0d0",         // jasny krem - kolor tekstu
    display: "flex",
    flexDirection: "column",  // układamy elementy pionowo
    height: "100vh",          // 100% wysokości okna przeglądarki
    overflow: "hidden",       // ukrywamy paski przewijania
    position: "relative",
  },
  header:{
    display: "flex",
    alignItems: "baseline",   // wyrównujemy tekst po linii bazowej
    gap: "12px",
    padding: "14px 24px 10px",
    borderBottom: "1px solid #1e1e22", // cienka linia oddzielająca header
    flexShrink: 0,            // header nie kurczy się gdy brakuje miejsca
  },
  headerTitle:{ fontFamily:"'Bebas Neue', sans-serif", fontSize:"28px", letterSpacing:"0.12em", color:"#ff5500" },
  headerSub:{ fontFamily:"'Bebas Neue', sans-serif", fontSize:"18px", letterSpacing:"0.2em", color:"#555" },
  exportBtn:{
    fontFamily: FONT, fontSize:"10px", letterSpacing:"0.12em",
    color:"#e8e0d0", background:"transparent",
    border:"1px solid #1e1e22", padding:"7px 14px", borderRadius:"3px",
    cursor:"pointer", display:"flex", alignItems:"center", gap:"6px",
    transition:"border-color .2s",
    marginLeft:"auto",        // przesuwa przycisk na prawą stronę
  },
  viewport:{
    flex: 1,                  // viewport zajmuje całe dostępne miejsce między headerem a panelem
    minHeight: 0,             // pozwala na kurczenie się (wymagane dla flex)
  },
  panel:{
    padding:"18px 24px 14px",
    borderTop:"1px solid #1e1e22",
    background:"#0d0d0f",
    flexShrink: 0,            // panel nie kurczy się - zawsze ma swój rozmiar
    display:"flex", flexDirection:"column", gap:"14px",
  },
  control:{ display:"flex", flexDirection:"column", gap:"6px" },
  labelRow:{ display:"flex", justifyContent:"space-between", alignItems:"baseline" },
  label:{ fontSize:"10px", letterSpacing:"0.18em", color:"#666" },
  value:{ fontSize:"22px", fontWeight:"500", color:"#e8e0d0", letterSpacing:"-0.02em" },
  unit:{ fontSize:"13px", color:"#555", marginLeft:"2px" },
  sliderWrap:{
    position:"relative",
    height:"2px",             // cienka linia suwaka
    background:"#222",
    borderRadius:"1px",
    marginTop:"4px",
  },
  sliderFill:{
    position:"absolute", top:0, left:0,
    height:"100%",
    background:"#ff5500",     // pomarańczowy pasek wypełnienia
    borderRadius:"1px",
    pointerEvents:"none",     // nie przechwytuje kliknięć myszki
    transition:"width 0.05s", // płynna animacja zmiany szerokości
  },
  rangeLabels:{ display:"flex", justifyContent:"space-between", fontSize:"9px", color:"#333", marginTop:"3px" },
  stats:{ display:"flex", background:"#111", border:"1px solid #1e1e22", borderRadius:"4px", overflow:"hidden" },
  statItem:{ flex:1, padding:"10px 12px", display:"flex", flexDirection:"column", gap:"4px" },
  statDivider:{ width:"1px", background:"#1e1e22" }, // pionowa linia między komórkami
  statLabel:{ fontSize:"9px", letterSpacing:"0.15em", color:"#444" },
  statValue:{ fontSize:"13px", color:"#e8e0d0", fontWeight:"500" },
  hint:{ fontSize:"10px", color:"#333", textAlign:"center", letterSpacing:"0.05em" },
};