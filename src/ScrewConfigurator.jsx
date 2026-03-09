// ============================================================
// ScrewConfigurator.jsx
// Interaktywny konfigurator śruby z łbem sześciokątnym (bez gwintu)
// z eksportem do pliku STL i responsywnym układem na mobile
// Używa biblioteki Three.js do renderowania grafiki 3D
// oraz React do zarządzania interfejsem użytkownika
// ============================================================

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const FONT = "'DM Mono', monospace";

// ============================================================
// FUNKCJA BUDUJĄCA GEOMETRIĘ ŚRUBY
// Śruba składa się z dwóch części:
// 1. Łeb sześciokątny (hexagonal head) - bryła wytłaczana z sześciokąta
// 2. Trzpień cylindryczny (shaft) - zwykły walec
// ============================================================
function buildBolt(diameter, shankLength) {
  // Wysokość łba to ~65% średnicy (proporcja ISO dla śrub z łbem hex)
  const headHeight = diameter * 0.65;

  // Promień "przez płaskie" (across flats) = 1.75 × średnica nominalna
  // To standardowy rozmiar klucza dla śrub metrycznych
  const headRadius = (diameter * 1.75) / 2;

  // --- ŁEB SZEŚCIOKĄTNY ---
  // Tworzymy kształt 2D (Shape) który potem wytłaczamy w 3D (ExtrudeGeometry)
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    // Wyliczamy wierzchołki sześciokąta równomiernie rozmieszczone na okręgu
    // Math.PI/6 = 30° obrotu startowego (żeby płaskie krawędzie były po bokach)
    const angle = Math.PI / 6 + (i * Math.PI * 2) / 6;
    const x = headRadius * Math.cos(angle);
    const y = headRadius * Math.sin(angle);
    i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y);
  }
  shape.closePath(); // zamykamy kontur sześciokąta

  // ExtrudeGeometry "wytłacza" kształt 2D w 3D (jak stempel)
  // bevel = fazowanie krawędzi (zaokrąglenie górnej krawędzi łba)
  const headGeo = new THREE.ExtrudeGeometry(shape, {
    depth: headHeight,
    bevelEnabled: true,
    bevelThickness: diameter * 0.04, // grubość fazy
    bevelSize: diameter * 0.04,      // rozmiar fazy
    bevelSegments: 3,                // gładkość fazy
  });
  // Obracamy geometrię bo domyślnie jest "leżąca" - chcemy żeby stała pionowo
  headGeo.rotateX(-Math.PI / 2);
  // Przesuwamy żeby łeb był nad osią Y=0
  headGeo.translate(0, headHeight, 0);

  // --- KOŁNIERZ POD ŁBEM ---
  // Mały cylindryczny pierścień między łbem a trzpieniem (jak podkładka wbudowana)
  const collarGeo = new THREE.CylinderGeometry(
    diameter * 0.9,   // promień górny
    diameter * 0.9,   // promień dolny
    diameter * 0.12,  // wysokość kołnierza
    32                // liczba segmentów (gładkość)
  );
  // Centrujemy kołnierz na styku łba i trzpienia
  collarGeo.translate(0, -diameter * 0.06, 0);

  // --- TRZPIEŃ (SHAFT) ---
  // Zwykły walec - bez gwintu
  const shaftGeo = new THREE.CylinderGeometry(
    diameter / 2,     // promień górny = połowa średnicy
    diameter / 2,     // promień dolny (taki sam = walec, nie stożek)
    shankLength,      // długość trzpienia
    48                // liczba segmentów - więcej = gładszy walec
  );
  // Przesuwamy trzpień w dół od osi (łeb jest powyżej 0, trzpień poniżej)
  shaftGeo.translate(0, -shankLength / 2, 0);

  // --- FAZOWANIE KOŃCÓWKI TRZPIENIA ---
  // Mały stożek na końcu śruby ułatwiający wkręcanie
  const chamferHeight = diameter * 0.4;
  const chamferGeo = new THREE.CylinderGeometry(
    0,                // promień górny = 0 (czubek stożka)
    diameter / 2,     // promień dolny = pełna średnica
    chamferHeight,    // wysokość fazowania
    48
  );
  // Umieszczamy stożek pod trzpieniem
  chamferGeo.translate(0, -shankLength - chamferHeight / 2, 0);

  // Zwracamy wszystkie geometrie osobno żeby można było przypisać różne materiały
  return { headGeo, collarGeo, shaftGeo, chamferGeo, headHeight };
}

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
    const g = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();

    // Aplikujemy transformację świata - przenosimy pozycję/rotację do współrzędnych geometrii
    g.applyMatrix4(obj.matrixWorld);
    geos.push(g);
  });

  // Liczymy łączną liczbę trójkątów we wszystkich geometriach
  let totalTris = 0;
  geos.forEach((g) => { totalTris += g.attributes.position.count / 3; });

  // Tworzymy bufor binarny:
  // - 84 bajty = nagłówek STL
  // - 50 bajtów na każdy trójkąt
  const buf = new ArrayBuffer(84 + totalTris * 50);
  const view = new DataView(buf);

  // Zapisujemy nagłówek: 80 bajtów zerowych
  for (let i = 0; i < 80; i++) view.setUint8(i, 0);
  view.setUint32(80, totalTris, true);

  let offset = 84;

  // Wektory pomocnicze (tworzymy raz poza pętlą dla wydajności)
  const va = new THREE.Vector3(); // wierzchołek A
  const vb = new THREE.Vector3(); // wierzchołek B
  const vc = new THREE.Vector3(); // wierzchołek C
  const n  = new THREE.Vector3(); // wektor normalny
  const e1 = new THREE.Vector3(); // krawędź AB
  const e2 = new THREE.Vector3(); // krawędź AC

  geos.forEach((g) => {
    const pos = g.attributes.position;

    for (let i = 0; i < pos.count; i += 3) {
      // Odczytujemy 3 wierzchołki trójkąta
      va.fromBufferAttribute(pos, i);
      vb.fromBufferAttribute(pos, i + 1);
      vc.fromBufferAttribute(pos, i + 2);

      // Obliczamy wektor normalny przez iloczyn wektorowy
      e1.subVectors(vb, va);
      e2.subVectors(vc, va);
      n.crossVectors(e1, e2).normalize();

      // Zapisujemy normal (12 bajtów)
      view.setFloat32(offset, n.x, true);  offset += 4;
      view.setFloat32(offset, n.y, true);  offset += 4;
      view.setFloat32(offset, n.z, true);  offset += 4;

      // Zapisujemy 3 wierzchołki (36 bajtów)
      [va, vb, vc].forEach((v) => {
        view.setFloat32(offset, v.x, true); offset += 4;
        view.setFloat32(offset, v.y, true); offset += 4;
        view.setFloat32(offset, v.z, true); offset += 4;
      });

      // 2 bajty atrybutu (zawsze 0)
      view.setUint16(offset, 0, true); offset += 2;
    }

    // Zwalniamy pamięć GPU
    g.dispose();
  });

  // Tworzymy plik i wymuszamy pobranie
  const blob = new Blob([buf], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================================================
// HOOK WYKRYWAJĄCY SZEROKOŚĆ EKRANU
// Zwraca true jeśli ekran jest wąski (telefon)
// Używamy go żeby przełączać między układem pionowym (mobile)
// a poziomym (desktop)
// ============================================================
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// ============================================================
// GŁÓWNY KOMPONENT REACT
// ============================================================
export default function ScrewConfigurator() {

  // ref do elementu <div> gdzie renderujemy scenę Three.js
  const mountRef = useRef(null);

  // ref przechowujący obiekty Three.js (nie używamy state żeby nie re-renderować)
  const sceneRef = useRef({});

  // ref na grupę obiektów tworzących śrubę - żeby łatwo ją usunąć przy przebudowie
  const boltGroupRef = useRef(null);

  // Stan: średnica nominalna śruby w mm (domyślnie M10)
  const [diameter, setDiameter] = useState(10);

  // Stan: długość trzpienia w mm
  const [shankLength, setShankLength] = useState(40);

  // Stan: czy trwa eksport STL
  const [exporting, setExporting] = useState(false);

  // Czy jesteśmy na telefonie (wąski ekran)
  const isMobile = useIsMobile();

  // ============================================================
  // INICJALIZACJA SCENY THREE.JS - uruchamia się tylko raz
  // ============================================================
  useEffect(() => {
    const container = mountRef.current;
    const W = container.clientWidth;
    const H = container.clientHeight;

    // --- RENDERER ---
    // WebGLRenderer używa karty graficznej do renderowania 3D
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);     // obsługa ekranów Retina/HiDPI
    renderer.shadowMap.enabled = true;                   // włączamy cienie
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;    // miękkie cienie
    renderer.toneMapping = THREE.ACESFilmicToneMapping;  // kinematograficzne mapowanie tonów
    renderer.toneMappingExposure = 1.2;                  // jasność renderingu
    container.appendChild(renderer.domElement);

    // --- SCENA ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d0d0f");

    // --- KAMERA ---
    // PerspectiveCamera(kąt_widzenia, proporcje, near, far)
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 1000);
    camera.position.set(80, 40, 100);
    camera.lookAt(0, -15, 0); // patrzymy lekko w dół na środek śruby

    // --- OŚWIETLENIE ---

    // Światło otoczenia - podstawowe, równomierne
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    // Światło kluczowe (key light) - główne, tworzy cienie
    const key = new THREE.DirectionalLight(0xfff8e8, 2.0);
    key.position.set(80, 120, 80);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); // rozdzielczość mapy cieni
    scene.add(key);

    // Światło wypełniające (fill light) - rozjaśnia cienie, niebieskawe
    const fill = new THREE.DirectionalLight(0x7799ff, 0.45);
    fill.position.set(-60, 30, -50);
    scene.add(fill);

    // Światło krawędziowe (rim light) - złote, od tyłu
    const rim = new THREE.DirectionalLight(0xffbb55, 0.3);
    rim.position.set(0, -40, -80);
    scene.add(rim);

    // --- PODŁOGA ---
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshStandardMaterial({ color: "#14161a", roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2; // obracamy poziomo
    ground.position.y = -90;
    ground.receiveShadow = true;
    scene.add(ground);

    // Siatka pomocnicza na podłodze
    const grid = new THREE.GridHelper(300, 50, "#1a1c22", "#16181e");
    grid.position.y = -90;
    scene.add(grid);

    // --- ORBIT CONTROLS ---
    // Obsługa myszy/dotyku do obracania kamery
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;    // bezwładność kamery
    controls.dampingFactor = 0.055;
    controls.target.set(0, -15, 0);   // punkt wokół którego obracamy
    controls.minDistance = 20;
    controls.maxDistance = 400;

    // --- PĘTLA ANIMACJI ---
    let id;
    const animate = () => {
      id = requestAnimationFrame(animate);
      controls.update(); // wymagane dla dampingu
      renderer.render(scene, camera);
    };
    animate();

    // --- OBSŁUGA RESIZE ---
    const onResize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    sceneRef.current = { renderer, scene, camera, controls };

    // --- CLEANUP ---
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // ============================================================
  // PRZEBUDOWA GEOMETRII ŚRUBY
  // Uruchamia się gdy zmieni się diameter lub shankLength
  // ============================================================
  useEffect(() => {
    const { scene } = sceneRef.current;
    if (!scene) return;

    // Usuwamy poprzednią śrubę ze sceny i zwalniamy jej zasoby GPU
    if (boltGroupRef.current) {
      scene.remove(boltGroupRef.current);
      boltGroupRef.current.traverse((o) => {
        if (o.geometry) o.geometry.dispose(); // zwolnij geometrię
        if (o.material) o.material.dispose(); // zwolnij materiał
      });
    }

    // Materiał dla łba i trzpienia - metaliczny, jasny
    const matBody = new THREE.MeshStandardMaterial({
      color: 0xd4cfc5,
      metalness: 0.8,
      roughness: 0.2,
    });

    // Materiał dla kołnierza - nieco ciemniejszy
    const matCollar = new THREE.MeshStandardMaterial({
      color: 0xb8b0a0,
      metalness: 0.75,
      roughness: 0.28,
    });

    // Budujemy geometrie śruby
    const { headGeo, collarGeo, shaftGeo, chamferGeo, headHeight } = buildBolt(diameter, shankLength);

    // Tworzymy grupę - to kontener na wszystkie części śruby
    // Dzięki grupie możemy przesuwać/obracać całą śrubę naraz
    const boltGroup = new THREE.Group();

    // Dodajemy każdą część jako oddzielny Mesh
    const headMesh   = new THREE.Mesh(headGeo,   matBody);
    const collarMesh = new THREE.Mesh(collarGeo, matCollar);
    const shaftMesh  = new THREE.Mesh(shaftGeo,  matBody);
    const chamferMesh= new THREE.Mesh(chamferGeo,matBody);

    // Włączamy rzucanie cieni dla wszystkich części
    [headMesh, collarMesh, shaftMesh, chamferMesh].forEach(m => {
      m.castShadow = true;
    });

    boltGroup.add(headMesh, collarMesh, shaftMesh, chamferMesh);

    // Centrujemy śrubę pionowo żeby była widoczna w centrum sceny
    const totalLen = headHeight + shankLength;
    boltGroup.position.y = totalLen / 2 - headHeight;

    scene.add(boltGroup);
    boltGroupRef.current = boltGroup; // zapamiętujemy referencję do usunięcia potem
  }, [diameter, shankLength]);

  // ============================================================
  // FUNKCJA EKSPORTU
  // useCallback = zapamiętaj funkcję, odśwież tylko gdy zmienią się zależności
  // ============================================================
  const handleExport = useCallback(() => {
    const { scene } = sceneRef.current;
    if (!scene) return;

    setExporting(true); // pokaż "GENEROWANIE..." na przycisku

    // setTimeout daje React czas na przerenderowanie UI przed blokowaniem wątku
    setTimeout(() => {
      exportSTL(scene, `sruba_d${diameter}mm_l${shankLength}mm.stl`);
      setExporting(false);
    }, 100);
  }, [diameter, shankLength]);

  // ============================================================
  // OBLICZENIA PARAMETRÓW (przeliczane przy każdym renderze)
  // ============================================================
  const headHeight   = (diameter * 0.65).toFixed(1);  // wysokość łba
  const acrossFlats  = (diameter * 1.75).toFixed(1);  // rozmiar klucza SW
  const totalLength  = shankLength + parseFloat(headHeight); // całkowita długość

  // ============================================================
  // RENDER - układ responsywny
  // Na desktop: viewport po lewej, panel po prawej (flex-row)
  // Na mobile: viewport na górze, panel na dole (flex-column)
  // ============================================================
  return (
    <div style={isMobile ? styles.rootMobile : styles.root}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap" rel="stylesheet" />

      {/* Pasek nagłówka - zawsze na górze */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>ŚRUBA</span>
        <span style={styles.headerSub}>KONFIGURATOR</span>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...styles.exportBtn, borderColor: exporting ? "#4ade80" : "#1e1e22" }}
          onClick={handleExport}
          disabled={exporting}
        >
          <span style={{ color: "#4ade80", fontSize: "14px" }}>↓</span>
          {exporting ? "GENEROWANIE..." : "EKSPORT STL"}
        </button>
      </div>

      {/* Główna sekcja - viewport + panel obok siebie na desktop, pionowo na mobile */}
      <div style={isMobile ? styles.bodyMobile : styles.body}>

        {/* Kontener sceny Three.js */}
        <div ref={mountRef} style={isMobile ? styles.viewportMobile : styles.viewport} />

        {/* Panel kontrolny */}
        <div style={isMobile ? styles.panelMobile : styles.panel}>

          {/* Suwak średnicy */}
          <div style={styles.control}>
            <div style={styles.labelRow}>
              <span style={styles.label}>ŚREDNICA</span>
              <span style={styles.value}>{diameter} <span style={styles.unit}>mm</span></span>
            </div>
            <div style={styles.sliderWrap}>
              <input
                type="range"
                min={3} max={20} step={0.5}
                value={diameter}
                onChange={(e) => setDiameter(parseFloat(e.target.value))}
              />
              {/* Pasek wypełnienia - obliczamy % pozycji suwaka */}
              <div style={{ ...styles.sliderFill, width: `${((diameter - 3) / 17) * 100}%` }} />
            </div>
            <div style={styles.rangeLabels}><span>M3</span><span>M20</span></div>
          </div>

          {/* Suwak długości trzpienia */}
          <div style={styles.control}>
            <div style={styles.labelRow}>
              <span style={styles.label}>DŁUGOŚĆ TRZPIENIA</span>
              <span style={styles.value}>{shankLength} <span style={styles.unit}>mm</span></span>
            </div>
            <div style={styles.sliderWrap}>
              <input
                type="range"
                min={5} max={150} step={1}
                value={shankLength}
                onChange={(e) => setShankLength(parseFloat(e.target.value))}
              />
              <div style={{ ...styles.sliderFill, width: `${((shankLength - 5) / 145) * 100}%` }} />
            </div>
            <div style={styles.rangeLabels}><span>5</span><span>150</span></div>
          </div>

          {/* Tabela parametrów ISO */}
          <div style={styles.stats}>
            {[
              ["ŚREDNICA",    `M${diameter}`],
              ["DŁ. CAŁK.",   `${totalLength.toFixed(1)} mm`],
              ["WYS. ŁEBA",   `${headHeight} mm`],
              ["KLUCZ SW",    `${acrossFlats} mm`],
            ].map(([label, val]) => (
              <div key={label} style={styles.statItem}>
                <span style={styles.statLabel}>{label}</span>
                <span style={styles.statValue}>{val}</span>
              </div>
            ))}
          </div>

          {/* Podpowiedź sterowania */}
          <div style={styles.hint}>
            🖱 Lewy przycisk — obracaj &nbsp;|&nbsp; Scroll — zoom &nbsp;|&nbsp; Prawy — przesuń
          </div>
        </div>
      </div>

      {/* Style CSS dla suwaka - pseudo-elementy wymagają tagu <style> */}
      <style>{`
        * { box-sizing: border-box; }
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
// STYLE - rozdzielamy warianty desktop i mobile
// ============================================================
const styles = {

  // --- ROOT ---
  // Desktop: cały ekran, elementy układają się pionowo
  root:{
    fontFamily: FONT,
    background: "#0d0d0f",
    color: "#e8e0d0",
    display: "flex",
    flexDirection: "column", // header na górze, reszta poniżej
    height: "100vh",
    overflow: "hidden",
  },
  // Mobile: identyczny - responsywność realizujemy w środku (body)
  rootMobile:{
    fontFamily: FONT,
    background: "#0d0d0f",
    color: "#e8e0d0",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
  },

  // --- HEADER ---
  header:{
    display: "flex",
    alignItems: "center",     // wyśrodkuj elementy pionowo
    gap: "12px",
    padding: "10px 16px",
    borderBottom: "1px solid #1e1e22",
    flexShrink: 0,            // header zawsze ma swój rozmiar
  },
  headerTitle:{ fontFamily:"'Bebas Neue', sans-serif", fontSize:"24px", letterSpacing:"0.12em", color:"#ff5500" },
  headerSub:{ fontFamily:"'Bebas Neue', sans-serif", fontSize:"16px", letterSpacing:"0.2em", color:"#555" },
  exportBtn:{
    fontFamily: FONT, fontSize:"10px", letterSpacing:"0.1em",
    color:"#e8e0d0", background:"transparent",
    border:"1px solid #1e1e22", padding:"6px 12px", borderRadius:"3px",
    cursor:"pointer", display:"flex", alignItems:"center", gap:"6px",
    transition:"border-color .2s", flexShrink: 0,
  },

  // --- BODY (obszar pod headerem) ---
  // Desktop: viewport i panel obok siebie w poziomie
  body:{
    display: "flex",
    flexDirection: "row",     // ← poziomy układ na desktop
    flex: 1,
    minHeight: 0,
  },
  // Mobile: viewport i panel jeden pod drugim
  bodyMobile:{
    display: "flex",
    flexDirection: "column",  // ↓ pionowy układ na mobile
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },

  // --- VIEWPORT (scena 3D) ---
  // Desktop: zajmuje resztę miejsca obok panelu
  viewport:{
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  // Mobile: stała wysokość ~55% ekranu
  viewportMobile:{
    width: "100%",
    height: "55vw",           // kwadratowy viewport na telefonie
    minHeight: "200px",
    maxHeight: "320px",
    flexShrink: 0,
  },

  // --- PANEL KONTROLNY ---
  // Desktop: stała szerokość po prawej stronie
  panel:{
    width: "280px",           // stała szerokość panelu na desktop
    flexShrink: 0,
    padding: "16px",
    borderLeft: "1px solid #1e1e22",
    background: "#0d0d0f",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    overflowY: "auto",        // scroll gdy za dużo treści
  },
  // Mobile: pełna szerokość na dole, przewijany
  panelMobile:{
    width: "100%",
    padding: "12px 16px",
    borderTop: "1px solid #1e1e22",
    background: "#0d0d0f",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    overflowY: "auto",        // scroll gdy za dużo treści
    flex: 1,
    minHeight: 0,
  },

  // --- KONTROLKI SUWAKÓW ---
  control:{ display:"flex", flexDirection:"column", gap:"6px" },
  labelRow:{ display:"flex", justifyContent:"space-between", alignItems:"baseline" },
  label:{ fontSize:"9px", letterSpacing:"0.18em", color:"#666" },
  value:{ fontSize:"20px", fontWeight:"500", color:"#e8e0d0", letterSpacing:"-0.02em" },
  unit:{ fontSize:"12px", color:"#555", marginLeft:"2px" },
  sliderWrap:{
    position:"relative",
    height:"2px",
    background:"#222",
    borderRadius:"1px",
    marginTop:"4px",
  },
  sliderFill:{
    position:"absolute", top:0, left:0,
    height:"100%",
    background:"#ff5500",     // pomarańczowy pasek
    borderRadius:"1px",
    pointerEvents:"none",     // nie blokuje kliknięć
    transition:"width 0.05s",
  },
  rangeLabels:{ display:"flex", justifyContent:"space-between", fontSize:"9px", color:"#333", marginTop:"3px" },

  // --- TABELA STATYSTYK ---
  stats:{
    display:"grid",
    gridTemplateColumns:"1fr 1fr", // 2 kolumny - lepiej na wąskim panelu
    gap:"1px",
    background:"#1e1e22",          // kolor przerw między komórkami
    border:"1px solid #1e1e22",
    borderRadius:"4px",
    overflow:"hidden",
  },
  statItem:{
    padding:"8px 10px",
    display:"flex", flexDirection:"column", gap:"3px",
    background:"#0d0d0f",          // tło komórki
  },
  statLabel:{ fontSize:"8px", letterSpacing:"0.15em", color:"#444" },
  statValue:{ fontSize:"12px", color:"#e8e0d0", fontWeight:"500" },

  hint:{ fontSize:"9px", color:"#333", textAlign:"center", letterSpacing:"0.05em" },
};
