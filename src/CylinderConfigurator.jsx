import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const FONT = "'DM Mono', monospace";

export default function CylinderConfigurator() {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const [diameter, setDiameter] = useState(1.0);
  const [length, setLength] = useState(2.0);

  // Init Three.js scene
  useEffect(() => {
    const container = mountRef.current;
    const W = container.clientWidth;
    const H = container.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d0d0f");

    // Camera
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);
    camera.position.set(4, 2.5, 4);
    camera.lookAt(0, 0, 0);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x88ccff, 0.6);
    rimLight.position.set(-4, 2, -4);
    scene.add(rimLight);

    const fillLight = new THREE.PointLight(0xff6633, 0.4, 20);
    fillLight.position.set(-3, -2, 3);
    scene.add(fillLight);

    // Grid
    const grid = new THREE.GridHelper(10, 20, "#1a1a2e", "#1a1a2e");
    grid.position.y = -2;
    scene.add(grid);

    // Cylinder
    const mat = new THREE.MeshStandardMaterial({
      color: 0xe8e0d0,
      metalness: 0.15,
      roughness: 0.35,
    });

    const geo = new THREE.CylinderGeometry(0.5, 0.5, 2, 64, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xff5500,
      wireframe: true,
      transparent: true,
      opacity: 0.06,
    });
    const wireMesh = new THREE.Mesh(geo.clone(), wireMat);
    scene.add(wireMesh);

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 1.5;
    controls.maxDistance = 15;

    // Animate
    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    sceneRef.current = { renderer, scene, camera, mesh, wireMesh, controls, mat };

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  // Update geometry on slider change
  useEffect(() => {
    const { scene, mesh, wireMesh } = sceneRef.current;
    if (!mesh) return;

    const radius = diameter / 2;
    const newGeo = new THREE.CylinderGeometry(radius, radius, length, 64, 1);

    mesh.geometry.dispose();
    mesh.geometry = newGeo;

    wireMesh.geometry.dispose();
    wireMesh.geometry = newGeo.clone();
  }, [diameter, length]);

  const volume = Math.PI * Math.pow(diameter / 2, 2) * length;
  const surfaceArea = 2 * Math.PI * (diameter / 2) * length + 2 * Math.PI * Math.pow(diameter / 2, 2);

  return (
    <div style={styles.root}>
      {/* Google Fonts */}
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap"
        rel="stylesheet"
      />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>CYLINDER</span>
        <span style={styles.headerSub}>KONFIGURATOR</span>
      </div>

      {/* 3D Viewport */}
      <div ref={mountRef} style={styles.viewport} />

      {/* Control Panel */}
      <div style={styles.panel}>
        {/* Diameter */}
        <div style={styles.control}>
          <div style={styles.labelRow}>
            <span style={styles.label}>ŚREDNICA</span>
            <span style={styles.value}>{diameter.toFixed(2)} <span style={styles.unit}>m</span></span>
          </div>
          <div style={styles.sliderWrap}>
            <input
              type="range"
              min={0.2}
              max={4.0}
              step={0.01}
              value={diameter}
              onChange={(e) => setDiameter(parseFloat(e.target.value))}
              style={styles.slider}
            />
            <div
              style={{
                ...styles.sliderFill,
                width: `${((diameter - 0.2) / 3.8) * 100}%`,
              }}
            />
          </div>
          <div style={styles.rangeLabels}>
            <span>0.20</span><span>4.00</span>
          </div>
        </div>

        {/* Length */}
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
            <div
              style={{
                ...styles.sliderFill,
                width: `${((length - 0.2) / 7.8) * 100}%`,
              }}
            />
          </div>
          <div style={styles.rangeLabels}>
            <span>0.20</span><span>8.00</span>
          </div>
        </div>

        {/* Stats */}
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

        <div style={styles.hint}>
          🖱 Lewy przycisk — obracaj &nbsp;|&nbsp; Scroll — zoom &nbsp;|&nbsp; Prawy — przesuń
        </div>
      </div>

      <style>{`
        input[type=range] {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 2px;
          background: transparent;
          position: relative;
          z-index: 2;
          cursor: pointer;
          outline: none;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ff5500;
          border: 2px solid #0d0d0f;
          box-shadow: 0 0 10px #ff550088;
          cursor: pointer;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        input[type=range]::-webkit-slider-thumb:hover {
          transform: scale(1.25);
          box-shadow: 0 0 18px #ff5500cc;
        }
        input[type=range]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ff5500;
          border: 2px solid #0d0d0f;
          box-shadow: 0 0 10px #ff550088;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    fontFamily: FONT,
    background: "#0d0d0f",
    color: "#e8e0d0",
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    position: "relative",
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: "12px",
    padding: "14px 24px 10px",
    borderBottom: "1px solid #1e1e22",
    flexShrink: 0,
  },
  headerTitle: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: "28px",
    letterSpacing: "0.12em",
    color: "#ff5500",
  },
  headerSub: {
    fontFamily: "'Bebas Neue', sans-serif",
    fontSize: "18px",
    letterSpacing: "0.2em",
    color: "#555",
  },
  viewport: {
    flex: 1,
    minHeight: 0,
  },
  panel: {
    padding: "18px 24px 14px",
    borderTop: "1px solid #1e1e22",
    background: "#0d0d0f",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  control: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  labelRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  label: {
    fontSize: "10px",
    letterSpacing: "0.18em",
    color: "#666",
  },
  value: {
    fontSize: "22px",
    fontWeight: "500",
    color: "#e8e0d0",
    letterSpacing: "-0.02em",
  },
  unit: {
    fontSize: "13px",
    color: "#555",
    marginLeft: "2px",
  },
  sliderWrap: {
    position: "relative",
    height: "2px",
    background: "#222",
    borderRadius: "1px",
    marginTop: "4px",
  },
  sliderFill: {
    position: "absolute",
    top: 0,
    left: 0,
    height: "100%",
    background: "#ff5500",
    borderRadius: "1px",
    pointerEvents: "none",
    transition: "width 0.05s",
  },
  rangeLabels: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "9px",
    color: "#333",
    marginTop: "3px",
  },
  stats: {
    display: "flex",
    gap: "0",
    background: "#111",
    border: "1px solid #1e1e22",
    borderRadius: "4px",
    overflow: "hidden",
  },
  statItem: {
    flex: 1,
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  statDivider: {
    width: "1px",
    background: "#1e1e22",
  },
  statLabel: {
    fontSize: "9px",
    letterSpacing: "0.15em",
    color: "#444",
  },
  statValue: {
    fontSize: "13px",
    color: "#e8e0d0",
    fontWeight: "500",
  },
  hint: {
    fontSize: "10px",
    color: "#333",
    textAlign: "center",
    letterSpacing: "0.05em",
  },
};
