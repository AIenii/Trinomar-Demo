/* Trinomar · Maqueta 3D de estudio
   El edificio completo como maqueta hecha a mano (cartón pluma, balsa, acrílico) sobre la mesa de un estudio de arquitectura.
   1 unidad = 1 m del edificio. La maqueta está a escala 1:200, así que los objetos de la mesa se modelan en cm reales × 2.
   Uso:
     const mq = await iniciarMaqueta(contenedor, {
       base: 'maqueta/',                       // carpeta con maqueta.glb y maqueta_info.json
       plano: 'img/planta.jpg',                // lámina impresa sobre la mesa (opcional)
       unidad: (nivel, u) => ({ codigo, tipo, estado, color }),   // datos de venta de cada apartamento (opcional)
       alElegir: (nivel, u) => {},             // al tocar un apartamento
       alCambiar: estado => {},                // vista actual: {vista:'edificio'|'nivel'|'unidad'|'recorrido', nivel, unidad}
       progreso: f => {} });
   API: inicio(), verNivel(id|'todo'), verUnidad(nivel,u), recorrer(nivel,u), salir(), muebles(bool), despiece(bool), entorno(bool), hora(h), pausar(bool) */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const K = 2;                          // metros de modelo por cm real (escala 1:200)
const LAT = 18.45, LON = -69.60, TZ = -4; // Boca Chica
const su = (x, y, z) => new THREE.Vector3(x, z, -y); // SketchUp -> escena

/* ------------------------------------------------------------------ texturas (canvas) */
let semilla = 7; const rnd = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
function lienzo(n, dibuja, m = n) { const c = document.createElement('canvas'); c.width = n; c.height = m; dibuja(c.getContext('2d'), n, m); return c; }
function ruido(ctx, n, cant, a, colores, tam = [0.5, 1.6], m = n) {
  for (let i = 0; i < cant; i++) { ctx.fillStyle = colores[(rnd() * colores.length) | 0]; ctx.globalAlpha = a * rnd();
    const s = tam[0] + rnd() * (tam[1] - tam[0]); ctx.fillRect(rnd() * n, rnd() * m, s, s); }
  ctx.globalAlpha = 1;
}
function tex(c, rep = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; }
const TEX = {
  // cartón pluma / cartulina: fibras muy finas
  papel: () => tex(lienzo(256, (x, n) => { x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); ruido(x, n, 9000, .05, ['#9a9284', '#c9c1b2', '#ffffff']);
    for (let i = 0; i < 260; i++) { x.strokeStyle = 'rgba(150,140,125,.06)'; x.beginPath(); const px = rnd() * n, py = rnd() * n, a = rnd() * 6.28; x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9); x.stroke(); } })),
  balsa: () => tex(lienzo(512, (x, n) => { x.fillStyle = '#fff'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 180; i++) { const y = rnd() * n, w = .6 + rnd() * 2.2; x.strokeStyle = `rgba(${150 + rnd() * 30},${110 + rnd() * 20},60,${.05 + rnd() * .12})`; x.lineWidth = w;
      x.beginPath(); x.moveTo(0, y); for (let k = 0; k <= 16; k++) x.lineTo(k * n / 16, y + Math.sin(k * .9 + i) * 2.2 + (rnd() - .5) * 1.5); x.stroke(); }
    ruido(x, n, 4000, .05, ['#8a6a3c', '#fff6e4']); })),
  // cartón gris prensado (calles) y lija fina (arena)
  prensado: () => tex(lienzo(256, (x, n) => { x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); ruido(x, n, 16000, .2, ['#6d665c', '#9b9387', '#d8d0c2', '#4b463f'], [.6, 2.2]); })),
  lija: () => tex(lienzo(256, (x, n) => { x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); ruido(x, n, 30000, .4, ['#b49a6c', '#e8d8b4', '#8f7a52', '#fff8e8'], [.5, 1.3]); })),
  flock: () => tex(lienzo(256, (x, n) => { x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); ruido(x, n, 26000, .3, ['#c9c4b4', '#e8e4d8', '#a7a290'], [.7, 1.8]); })),
  espuma: () => tex(lienzo(256, (x, n) => { x.fillStyle = '#fff'; x.fillRect(0, 0, n, n); ruido(x, n, 20000, .35, ['#b8c0a8', '#e9ecdf', '#98a387', '#ffffff'], [1, 3]); })),
  roble: () => tex(lienzo(1024, (x, n) => { const g = x.createLinearGradient(0, 0, 0, n); g.addColorStop(0, '#fff'); g.addColorStop(1, '#f4ece0'); x.fillStyle = g; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 420; i++) { const y = rnd() * n; x.strokeStyle = `rgba(${120 + rnd() * 40},${80 + rnd() * 25},40,${.04 + rnd() * .1})`; x.lineWidth = .5 + rnd() * 2.5;
      x.beginPath(); x.moveTo(0, y); for (let k = 0; k <= 32; k++) x.lineTo(k * n / 32, y + Math.sin(k * .45 + i * .3) * 4 + (rnd() - .5)); x.stroke(); }
    for (let i = 0; i < 6; i++) { x.strokeStyle = 'rgba(0,0,0,.06)'; x.lineWidth = 1.2; const y = (i + .5) * n / 6; x.beginPath(); x.moveTo(0, y); x.lineTo(n, y); x.stroke(); } })),
  // resina del mar: pinceladas de olas
  olas: () => tex(lienzo(512, (x, n) => { x.fillStyle = '#808080'; x.fillRect(0, 0, n, n);
    for (let i = 0; i < 900; i++) { const px = rnd() * n, py = rnd() * n, l = 8 + rnd() * 26; x.strokeStyle = rnd() < .5 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.10)'; x.lineWidth = 1 + rnd() * 2.5;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + l / 2, py - 2 - rnd() * 3, px + l, py); x.stroke();
      if (px + l > n) { x.beginPath(); x.moveTo(px - n, py); x.quadraticCurveTo(px - n + l / 2, py - 3, px - n + l, py); x.stroke(); } } })),
};

/* material con textura proyectada desde tres lados (las piezas de SketchUp no traen UV) + tapa de corte en las caras traseras */
function triplanar(p, t, escala, opc = {}) {
  const m = opc.physical ? new THREE.MeshPhysicalMaterial(p) : new THREE.MeshStandardMaterial(p);
  m.side = opc.side ?? THREE.DoubleSide;
  const tapa = opc.tapa ? new THREE.Color(opc.tapa) : null;
  m.onBeforeCompile = sh => {
    sh.uniforms.tTri = { value: t }; sh.uniforms.tEsc = { value: escala }; if (tapa) sh.uniforms.uTapa = { value: tapa };
    sh.vertexShader = 'varying vec3 vTriP; varying vec3 vTriN;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 tp = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        tp = instanceMatrix * tp;
      #endif
      vTriP = (modelMatrix * tp).xyz; vTriN = normalize(mat3(modelMatrix) * objectNormal);`);
    let f = 'uniform sampler2D tTri; uniform float tEsc; varying vec3 vTriP; varying vec3 vTriN;\n' + (tapa ? 'uniform vec3 uTapa;\n' : '') + sh.fragmentShader;
    f = f.replace('#include <map_fragment>', `
      vec3 bw = pow(abs(normalize(vTriN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
      vec3 tc = ${t ? 'texture2D(tTri, vTriP.zy * tEsc).rgb * bw.x + texture2D(tTri, vTriP.xz * tEsc).rgb * bw.y + texture2D(tTri, vTriP.xy * tEsc).rgb * bw.z' : 'vec3(1.0)'};
      diffuseColor.rgb *= tc;
      ${tapa ? 'if (!gl_FrontFacing) diffuseColor.rgb = uTapa * mix(0.92, 1.0, tc.r);' : ''}`);
    sh.fragmentShader = f;
    if (opc.extra) opc.extra(sh);
  };
  m.customProgramCacheKey = () => 'tri' + escala + (tapa ? 't' : '') + (opc.clave || '');
  return m;
}

function materialesMaqueta() {
  const papel = TEX.papel(), balsa = TEX.balsa(), prensado = TEX.prensado(), lija = TEX.lija(), flock = TEX.flock();
  const olas = TEX.olas();
  const mar = new THREE.MeshPhysicalMaterial({ color: 0x3d93ad, roughness: .16, metalness: 0, clearcoat: 1, clearcoatRoughness: .08, side: THREE.DoubleSide });
  mar.onBeforeCompile = sh => {
    sh.uniforms.tOlas = { value: olas }; sh.uniforms.tCosta = mar.userData.tCosta; sh.uniforms.uCosta = mar.userData.uCosta;
    sh.vertexShader = 'varying vec3 vMP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vMP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = 'uniform sampler2D tOlas; uniform sampler2D tCosta; uniform vec4 uCosta; varying vec3 vMP;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `
        vec2 uvC = (vMP.xz - uCosta.xy) / uCosta.zw; vec4 mc = texture2D(tCosta, uvC);
        float prof = 1.0 - mc.g;
        diffuseColor.rgb = mix(vec3(0.46, 0.78, 0.80), vec3(0.12, 0.40, 0.57), smoothstep(0.0, 0.8, prof));
        float o1 = texture2D(tOlas, vMP.xz * vec2(0.022, 0.05)).r, o2 = texture2D(tOlas, vMP.xz * vec2(0.051, 0.11) + 0.37).r;
        float costa = smoothstep(0.02, 0.5, mc.r);
        float espuma = smoothstep(0.56, 0.66, o1 * 0.6 + o2 * 0.6 - 0.1 + costa * 0.35) * (0.35 + costa * 0.65);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.98, 0.97), espuma * 0.85);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec2 e = vec2(0.6, 0.0);
        float h0 = texture2D(tOlas, vMP.xz * vec2(0.022, 0.05)).r + texture2D(tOlas, vMP.xz * vec2(0.051, 0.11) + 0.37).r;
        float hx = texture2D(tOlas, (vMP.xz + e.xy) * vec2(0.022, 0.05)).r + texture2D(tOlas, (vMP.xz + e.xy) * vec2(0.051, 0.11) + 0.37).r;
        float hz = texture2D(tOlas, (vMP.xz + e.yx) * vec2(0.022, 0.05)).r + texture2D(tOlas, (vMP.xz + e.yx) * vec2(0.051, 0.11) + 0.37).r;
        vec3 nW = normalize(vec3(-(hx - h0) * 1.6, 1.0, -(hz - h0) * 1.6));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`);
  };
  mar.userData.tCosta = { value: null }; mar.userData.uCosta = { value: new THREE.Vector4(0, 0, 1, 1) };
  mar.customProgramCacheKey = () => 'mar';
  return {
    carton: triplanar({ color: 0xf3efe7, roughness: .92 }, papel, .9, { tapa: 0xd9d2c4 }),
    blanco: triplanar({ color: 0xf6f4ef, roughness: .95 }, papel, .6, { tapa: 0xe0dbd0 }),
    terreno: triplanar({ color: 0xe9e5dc, roughness: .97 }, flock, .18),
    acera: triplanar({ color: 0xd2cdc3, roughness: .95 }, papel, .5),
    calle: triplanar({ color: 0x77736d, roughness: .98 }, prensado, .22),
    pintura: new THREE.MeshStandardMaterial({ color: 0xf6f3ea, roughness: .7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    arena: triplanar({ color: 0xf1dfba, roughness: 1 }, lija, .35),
    mueble: triplanar({ color: 0xfaf8f3, roughness: .88 }, papel, 2.5, { tapa: 0xe4ded2 }),
    balsa: triplanar({ color: 0xead6b4, roughness: .78 }, balsa, .55, { tapa: 0xdcc39c }),
    gris: triplanar({ color: 0xcfc9be, roughness: .95 }, prensado, .35, { tapa: 0xbdb6aa }),
    oscuro: triplanar({ color: 0x5b5753, roughness: .85 }, papel, 2, { tapa: 0x4a4744 }),
    cesped: triplanar({ color: 0xdfe3cf, roughness: 1 }, flock, .25),
    follaje: triplanar({ color: 0xc9d1b4, roughness: 1 }, TEX.espuma(), .6),
    agua: new THREE.MeshPhysicalMaterial({ color: 0x6fc2d2, roughness: .05, metalness: 0, transparent: true, opacity: .78, clearcoat: 1, clearcoatRoughness: .04, side: THREE.DoubleSide }),
    acrilico: new THREE.MeshPhysicalMaterial({ color: 0xeaf4f6, roughness: .04, metalness: 0, transparent: true, opacity: .22, depthWrite: false, clearcoat: 1, envMapIntensity: 1.4, side: THREE.DoubleSide }),
    mar,
  };
}

/* ------------------------------------------------------------------ árboles de maqueta */
function geoArbol() { // tronco de alambre/balsa y copa de espuma en bolitas
  const tronco = new THREE.CylinderGeometry(.06, .1, 1, 5).translate(0, .5, 0);
  const copas = [];
  for (let i = 0; i < 7; i++) { const g = new THREE.IcosahedronGeometry(.3 + rnd() * .16, 1); const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const s = 1 + (rnd() - .5) * .3; p.setXYZ(k, p.getX(k) * s, p.getY(k) * s, p.getZ(k) * s); }
    const a = i / 7 * 6.28; g.translate(Math.cos(a) * (i ? .28 : 0), .95 + rnd() * .3 + (i ? 0 : .2), Math.sin(a) * (i ? .28 : 0)); copas.push(g); }
  return { tronco, copa: mergeGeometries(copas) };
}
function geoPalma() { // tronco de alambre curvado y hojas de papel recortado
  const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(Math.sin(t * 1.4) * .12, t, 0)); }
  const tronco = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, .035, 5, false);
  const hojas = [];
  for (let i = 0; i < 9; i++) { const g = new THREE.PlaneGeometry(.75, .2, 6, 1); const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) { const x = p.getX(k) + .375; const w = Math.sin(Math.PI * Math.min(1, x / .75)) * (1 - x * .5); p.setXYZ(k, x, -x * x * .6, p.getY(k) * w * 1.1); }
    g.rotateZ(.12); g.rotateY(i / 9 * Math.PI * 2 + rnd() * .3); g.translate(.17, 1, 0); hojas.push(g); }
  return { tronco, copa: mergeGeometries(hojas) };
}

/* ------------------------------------------------------------------ la mesa del estudio */
function placaTexto(lineas) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 300; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1024, 300); g.addColorStop(0, '#b99a5d'); g.addColorStop(.45, '#e9d59e'); g.addColorStop(1, '#a8874c');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 300); x.strokeStyle = 'rgba(70,50,20,.45)'; x.lineWidth = 5; x.strokeRect(14, 14, 996, 272);
  x.fillStyle = '#33240e'; x.textAlign = 'center';
  x.font = '600 92px "Cormorant Garamond", Garamond, serif'; x.fillText(lineas[0], 512, 128);
  x.font = '500 34px "Jost", "Century Gothic", sans-serif'; x.fillText(lineas[1], 512, 196);
  x.font = '400 27px "Jost", "Century Gothic", sans-serif'; x.fillText(lineas[2], 512, 248);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function construirMesa(scene, B, planoUrl) {
  // B: tablero en coordenadas de escena {x0,x1,z0,z1,top} ; todo lo demás en cm reales × K
  const g = new THREE.Group(); scene.add(g);
  const roble = TEX.roble();
  const bw = B.x1 - B.x0, bd = B.z1 - B.z0, bcx = (B.x0 + B.x1) / 2, bcz = (B.z0 + B.z1) / 2;
  const espBase = 2.2 * K, marco = 1.6 * K;
  const yMesa = B.top - espBase;                 // cara de arriba de la mesa
  const W = bw + 150 * K, D = bd + 34 * K, cx = bcx + 52 * K, cz = bcz + 2 * K;
  // tablero de la mesa (roble) y patas de acero
  const tabMat = triplanar({ color: 0xe0cdb0, roughness: .5 }, roble, .006 / K * 2, { side: THREE.FrontSide });
  const tablero = new THREE.Mesh(new THREE.BoxGeometry(W, 4 * K, D), tabMat); tablero.position.set(cx, yMesa - 2 * K, cz); tablero.receiveShadow = true; g.add(tablero);
  const acero = new THREE.MeshStandardMaterial({ color: 0x2b2c2e, roughness: .4, metalness: .8 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(5 * K, 72 * K, 5 * K), acero); p.position.set(cx + sx * (W / 2 - 12 * K), yMesa - 40 * K, cz + sz * (D / 2 - 10 * K)); g.add(p); }
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(1400 * K, 1400 * K), triplanar({ color: 0x6b5340, roughness: .7 }, roble, .002, { side: THREE.FrontSide }));
  piso.rotation.x = -Math.PI / 2; piso.position.y = yMesa - 76 * K; piso.receiveShadow = true; g.add(piso);
  // base de la maqueta: MDF con marco de nogal
  const nogal = triplanar({ color: 0x6e4a31, roughness: .45 }, TEX.balsa(), .12, { side: THREE.FrontSide });
  const mdf = new THREE.Mesh(new THREE.BoxGeometry(bw, espBase, bd), triplanar({ color: 0xcfc6b6, roughness: .96 }, TEX.prensado(), .3, { side: THREE.FrontSide }));
  mdf.position.set(bcx, B.top - espBase / 2, bcz); mdf.receiveShadow = true; g.add(mdf);
  const altoMarco = espBase + B.borde;           // el marco tapa el canto del terreno recortado
  const listones = [[bw + 2 * marco, marco, bcx, B.z0 - marco / 2], [bw + 2 * marco, marco, bcx, B.z1 + marco / 2], [marco, bd, B.x0 - marco / 2, bcz], [marco, bd, B.x1 + marco / 2, bcz]];
  for (const [w, d, x, z] of listones) { const l = new THREE.Mesh(new THREE.BoxGeometry(w, altoMarco, d), nogal); l.position.set(x, B.top - espBase + altoMarco / 2, z); l.castShadow = l.receiveShadow = true; g.add(l); }
  const placa = new THREE.Mesh(new THREE.PlaneGeometry(26 * K, 7.6 * K), new THREE.MeshStandardMaterial({ map: placaTexto(['TRINOMAR', 'Seaside Living · Boca Chica, República Dominicana', 'Maqueta de estudio · Escala 1:200']), roughness: .3, metalness: .75 }));
  placa.position.set(bcx, B.top - espBase + altoMarco / 2, B.z1 + marco + .15); g.add(placa);
  // zona de trabajo a la derecha: plancha de corte, regla, cúter, escalímetro, lápices y recortes
  const pc = document.createElement('canvas'); pc.width = 1024; pc.height = 768; const x = pc.getContext('2d');
  x.fillStyle = '#2f5d4a'; x.fillRect(0, 0, 1024, 768);
  for (let i = 0; i <= 60; i++) { x.strokeStyle = i % 5 ? 'rgba(220,235,220,.16)' : 'rgba(240,250,240,.42)'; x.lineWidth = i % 5 ? 1 : 1.6; x.beginPath(); x.moveTo(i * 1024 / 60, 0); x.lineTo(i * 1024 / 60, 768); x.stroke(); }
  for (let i = 0; i <= 45; i++) { x.strokeStyle = i % 5 ? 'rgba(220,235,220,.16)' : 'rgba(240,250,240,.42)'; x.beginPath(); x.moveTo(0, i * 768 / 45); x.lineTo(1024, i * 768 / 45); x.stroke(); }
  x.strokeStyle = 'rgba(240,250,240,.3)'; x.beginPath(); x.moveTo(0, 0); x.lineTo(1024, 768); x.stroke(); x.beginPath(); x.arc(0, 768, 600, -Math.PI / 2, 0); x.stroke();
  const tPl = new THREE.CanvasTexture(pc); tPl.colorSpace = THREE.SRGBColorSpace; tPl.anisotropy = 8;
  const verde = new THREE.MeshStandardMaterial({ color: 0x2f5d4a, roughness: .8 });
  const plancha = new THREE.Mesh(new THREE.BoxGeometry(60 * K, .3 * K, 45 * K), [verde, verde, new THREE.MeshStandardMaterial({ map: tPl, roughness: .8 }), verde, verde, verde]);
  const px0 = B.x1 + marco + 48 * K, pz0 = bcz + 14 * K;
  plancha.position.set(px0, yMesa + .15 * K, pz0); plancha.rotation.y = -.05; plancha.receiveShadow = true; g.add(plancha);
  const yP = yMesa + .3 * K;
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: .25, metalness: 1 });
  const regla = new THREE.Mesh(new THREE.BoxGeometry(50 * K, .2 * K, 3.2 * K), metal); regla.position.set(px0 - 2 * K, yP + .1 * K, pz0 + 12 * K); regla.rotation.y = .1; regla.castShadow = true; g.add(regla);
  const cuter = new THREE.Group(); const mango = new THREE.Mesh(new THREE.BoxGeometry(13, 1, 1.7), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: .45 }));
  const hoja = new THREE.Mesh(new THREE.BoxGeometry(3, .15, 1.2), metal); hoja.position.x = 7.8; cuter.add(mango, hoja); cuter.scale.setScalar(K);
  cuter.position.set(px0 + 14 * K, yP + .5 * K, pz0 - 9 * K); cuter.rotation.y = .9; cuter.traverse(o => o.castShadow = true); g.add(cuter);
  const esc = new THREE.Mesh(new THREE.CylinderGeometry(1.6 * K, 1.6 * K, 30 * K, 3), new THREE.MeshStandardMaterial({ color: 0xf3f3f1, roughness: .5 }));
  esc.rotation.z = Math.PI / 2; esc.rotation.y = -.35; esc.position.set(B.x1 + marco + 12 * K, yMesa + .8 * K, B.z1 - 8 * K); esc.castShadow = true; g.add(esc);
  const amarillo = new THREE.MeshStandardMaterial({ color: 0xf0b929, roughness: .5 }), madera = new THREE.MeshStandardMaterial({ color: 0xe8c79a, roughness: .7 }), grafito = new THREE.MeshStandardMaterial({ color: 0x222222 });
  [[0, 0, .3], [2.4, 1.5, .5]].forEach(([dx, dz, r]) => { const l = new THREE.Group(); const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, 17, 6), amarillo);
    const punta = new THREE.Mesh(new THREE.ConeGeometry(.42, 1.6, 6), madera); punta.position.y = 9.3; const mina = new THREE.Mesh(new THREE.ConeGeometry(.12, .45, 6), grafito); mina.position.y = 10.2;
    l.add(cuerpo, punta, mina); l.scale.setScalar(K); l.rotation.z = Math.PI / 2; l.rotation.y = r; l.position.set(px0 + (24 + dx) * K, yP + .45 * K, pz0 + (17 + dz) * K); l.traverse(o => o.castShadow = true); g.add(l); });
  const cartonM = triplanar({ color: 0xf3efe7, roughness: .93 }, TEX.papel(), .9, { side: THREE.FrontSide }), balsaM = triplanar({ color: 0xe6c99f, roughness: .78 }, TEX.balsa(), .55, { side: THREE.FrontSide });
  [[6, -12, 16, 7, .5, cartonM, .2], [-10, -15, 10, 5, .5, cartonM, -.4], [20, 4, 25, .5, .5, balsaM, .3], [21.5, 6, 25, .5, .5, balsaM, .36], [23, 2, 18, .8, .8, balsaM, .25]].forEach(([dx, dz, w, d, h, m, r]) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w * K, h * K, d * K), m); o.position.set(px0 + dx * K, yP + h * K / 2, pz0 + dz * K); o.rotation.y = r; o.castShadow = o.receiveShadow = true; g.add(o); });
  // rollo de papel mantequilla al fondo
  const rollo = new THREE.Mesh(new THREE.CylinderGeometry(3.4 * K, 3.4 * K, 62 * K, 24), new THREE.MeshStandardMaterial({ color: 0xf6e9b0, roughness: .6, transparent: true, opacity: .93 }));
  rollo.rotation.z = Math.PI / 2; rollo.rotation.y = .12; rollo.position.set(px0 + 2 * K, yMesa + 3.4 * K, B.z0 - 4 * K); rollo.castShadow = true; g.add(rollo);
  // lámina impresa con la planta
  const lam = new THREE.Mesh(new THREE.PlaneGeometry(59.4 * K, 42 * K), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9 }));
  lam.rotation.x = -Math.PI / 2; lam.rotation.z = -.08; lam.position.set(px0 + 6 * K, yMesa + .05 * K, B.z1 - 2 * K); lam.receiveShadow = true; g.add(lam);
  if (planoUrl) new THREE.TextureLoader().load(planoUrl, t => {
    const im = t.image, c = document.createElement('canvas'); c.width = 1400; c.height = 990; const x = c.getContext('2d');
    x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, 1400, 990); x.filter = 'grayscale(1) contrast(1.5) brightness(1.15)'; x.globalAlpha = .9;
    const w = 1260, h = w * im.height / im.width; x.drawImage(im, 70, Math.max(60, 470 - h / 2), w, h); x.filter = 'none'; x.globalAlpha = 1;
    x.strokeStyle = '#222'; x.lineWidth = 3; x.strokeRect(30, 30, 1340, 930); x.strokeRect(1000, 830, 370, 130);
    x.fillStyle = '#222'; x.font = '600 34px "Jost", sans-serif'; x.fillText('TRINOMAR', 1020, 875); x.font = '400 20px "Jost", sans-serif'; x.fillText('Planta típica · Niveles 3 a 7 · 1:100', 1020, 910); x.fillText('Lámina A-103', 1020, 940);
    const tt = new THREE.CanvasTexture(c); tt.colorSpace = THREE.SRGBColorSpace; tt.anisotropy = 8; lam.material.map = tt; lam.material.needsUpdate = true; scene.userData.req && scene.userData.req(); });
  // taza de café
  const taza = new THREE.Group(); const cer = new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: .3, side: THREE.DoubleSide });
  const vaso = new THREE.Mesh(new THREE.CylinderGeometry(4, 3.6, 9, 28, 1, true), cer); vaso.position.y = 4.5;
  const fondo = new THREE.Mesh(new THREE.CircleGeometry(3.6, 28), cer); fondo.rotation.x = -Math.PI / 2; fondo.position.y = .05;
  const cafe = new THREE.Mesh(new THREE.CircleGeometry(3.8, 28), new THREE.MeshStandardMaterial({ color: 0x3b2414, roughness: .15 })); cafe.rotation.x = -Math.PI / 2; cafe.position.y = 7.6;
  const asa = new THREE.Mesh(new THREE.TorusGeometry(2.1, .45, 8, 16, Math.PI * 1.3), cer); asa.position.set(4.1, 4.8, 0); asa.rotation.z = -Math.PI * .65;
  taza.add(vaso, fondo, cafe, asa); taza.scale.setScalar(K); taza.position.set(B.x0 - 14 * K, yMesa, B.z0 + 22 * K); taza.traverse(o => o.castShadow = true); g.add(taza);
  // lámpara de arquitecto
  const lamp = new THREE.Group(); const negro = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: .35, metalness: .6, side: THREE.DoubleSide });
  const pie = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 2, 32), negro); pie.position.y = 1;
  const b1 = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 55, 10), negro); b1.position.set(0, 27, 0); b1.rotation.z = .35;
  const b2 = new THREE.Mesh(new THREE.CylinderGeometry(.6, .6, 50, 10), negro); b2.position.set(-21, 62, 0); b2.rotation.z = 1.2;
  const pantalla = new THREE.Mesh(new THREE.ConeGeometry(8, 13, 32, 1, true), negro); pantalla.position.set(-43, 66, 0); pantalla.rotation.z = -.6;
  const foco = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), new THREE.MeshStandardMaterial({ emissive: 0xfff1d6, emissiveIntensity: 3, color: 0xffffff }));
  foco.position.set(-40.5, 61.5, 0);
  lamp.add(pie, b1, b2, pantalla, foco); lamp.scale.setScalar(K); lamp.position.set(B.x1 + marco + 30 * K, yMesa, B.z0 + 6 * K); lamp.rotation.y = -2.2; lamp.traverse(o => o.castShadow = true); g.add(lamp);
  return { grupo: g, lampara: lamp, foco, yMesa, mesa: { cx, cz, W, D } };
}

/* ------------------------------------------------------------------ posición del sol (NOAA simplificado) */
function sol(hora, fecha = new Date()) {
  const ini = Date.UTC(fecha.getFullYear(), 0, 0); const dia = Math.floor((Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()) - ini) / 864e5);
  const g = 2 * Math.PI / 365 * (dia - 1 + (hora - 12) / 24);
  const eq = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
  const dec = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
  const ts = hora * 60 + eq + 4 * LON - 60 * TZ; const ha = (ts / 4 - 180) * Math.PI / 180; const la = LAT * Math.PI / 180;
  const cz = Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha); const zen = Math.acos(Math.min(1, Math.max(-1, cz)));
  let az = Math.acos(Math.min(1, Math.max(-1, (Math.sin(la) * Math.cos(zen) - Math.sin(dec)) / (Math.cos(la) * Math.sin(zen)))));
  az = ha > 0 ? (az + Math.PI) % (2 * Math.PI) : (3 * Math.PI - az) % (2 * Math.PI); // desde el norte, horario
  return { alt: Math.PI / 2 - zen, az };
}

/* ------------------------------------------------------------------ estilos de los rótulos y del modo recorrido */
const CSS = `
.mq-capa{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:Jost,'Century Gothic',system-ui,sans-serif}
.mq-r{position:absolute;left:0;top:0;white-space:nowrap;transition:opacity .35s;will-change:transform}
.mq-u{pointer-events:auto;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}
.mq-u b{display:flex;flex-direction:column;align-items:flex-start;gap:3px;background:rgba(255,255,255,.95);color:#1c2b44;font:600 14px/1 Jost,sans-serif;letter-spacing:.06em;padding:6px 10px 6px 9px;border-radius:3px;box-shadow:0 3px 12px rgba(0,0,0,.28);border-left:4px solid var(--c,#3a9d6a)}
.mq-u i{font:400 10.5px/1 Jost,sans-serif;letter-spacing:.04em;color:#5d6675;font-style:normal}
.mq-u:after{content:'';width:1px;height:16px;background:rgba(255,255,255,.85);box-shadow:0 0 2px rgba(0,0,0,.4)}
.mq-u:hover b{background:#fff;transform:translateY(-1px)}
.mq-a{font:500 11px/1 Jost,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#2a2622;background:rgba(255,253,248,.9);padding:5px 8px;border-radius:2px;box-shadow:0 1px 6px rgba(0,0,0,.18)}
.mq-oculto{opacity:0!important;pointer-events:none!important}
.mq-mira{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 1px rgba(0,0,0,.25);pointer-events:none;display:none}
.mq-paso{position:absolute;width:46px;height:46px;margin:-23px;border-radius:50%;border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.2),inset 0 0 0 1px rgba(0,0,0,.15);pointer-events:none;opacity:0;transition:opacity .2s;transform:scaleY(.45)}
`;

/* ------------------------------------------------------------------ visor */
export async function iniciarMaqueta(cont, opt = {}) {
  const base = opt.base || 'maqueta/';
  if (/[?&]prueba\b/.test(location.search)) Object.assign(opt, { calidad: 'baja', intervalo: 2500 }); // pruebas en navegador sin GPU
  const movil = matchMedia('(pointer: coarse)').matches || innerWidth < 760; const baja = opt.calidad === 'baja';
  if (!document.getElementById('mq-css')) { const st = document.createElement('style'); st.id = 'mq-css'; st.textContent = CSS; document.head.appendChild(st); }
  if (getComputedStyle(cont).position === 'static') cont.style.position = 'relative';
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(baja ? 1 : Math.min(devicePixelRatio, movil ? 1.5 : 2));
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  cont.appendChild(renderer.domElement); renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none';
  const capa = document.createElement('div'); capa.className = 'mq-capa'; cont.appendChild(capa);
  const mira = document.createElement('div'); mira.className = 'mq-mira'; capa.appendChild(mira);
  const paso = document.createElement('div'); paso.className = 'mq-paso'; capa.appendChild(paso);

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .5;
  const cam = new THREE.PerspectiveCamera(30, 1, 1, 9000);
  const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.dampingFactor = .08; ctl.maxPolarAngle = Math.PI * .46; ctl.minDistance = 10; ctl.maxDistance = 900; ctl.screenSpacePanning = true;
  ctl.zoomToCursor = true;

  // cielo del estudio: degradado que cambia con la hora
  const cielo = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false,
    uniforms: { cA: { value: new THREE.Color() }, cB: { value: new THREE.Color() }, cC: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 cA,cB,cC; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(cB, cA, pow(h, .6)) : mix(cB, cC, pow(-h, .5)); gl_FragColor = vec4(c,1.0);\n#include <colorspace_fragment>\n}' }));
  scene.add(cielo);

  // cargar maqueta
  const info = await (await fetch(base + 'maqueta_info.json')).json();
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  if (opt.glbJson) { // el modelo viaja como base64 dentro de un .json (el hosting no sirve .glb)
    const r = await fetch(base + opt.glbJson); const total = +r.headers.get('content-length') || 0; const rd = r.body.getReader(); const partes = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; partes.push(value); n += value.length; if (opt.progreso && total) opt.progreso(Math.min(.98, n / total)); }
    const txt = new TextDecoder().decode(await new Blob(partes).arrayBuffer()); const b64 = JSON.parse(txt).b64;
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    gltf = await new Promise((res, rej) => loader.parse(bin.buffer, '', res, rej));
  } else gltf = await new Promise((res, rej) => loader.load(base + 'maqueta.glb', res, ev => opt.progreso && ev.total && opt.progreso(ev.loaded / ev.total), rej));
  const raiz = gltf.scene; scene.add(raiz);
  const M = materialesMaqueta();
  const niveles = {}; const unidades = {}; const muebles = {}; let sitio = null;
  raiz.traverse(o => {
    const name = o.name || '';
    if (/^nivel:?/.test(name) && !o.isMesh) niveles[name.replace(/^nivel:?/, '')] = { g: o }; // el cargador quita los ':'
    if (name === 'sitio') sitio = o;
  });
  raiz.traverse(o => {
    if (!o.isMesh) return;
    let p = o; while (p && !/^nivel/.test(p.name) && p.name !== 'sitio') p = p.parent;
    const enSitio = p && p.name === 'sitio';
    const n = o.material && o.material.name;
    o.material = (enSitio && n === 'agua') ? M.mar : (M[n] || M.carton);
    const transp = n === 'acrilico' || n === 'agua';
    o.castShadow = !transp && n !== 'pintura' && !(enSitio && n !== 'blanco'); o.receiveShadow = true; if (n === 'acrilico') o.renderOrder = 2;
  });
  raiz.traverse(o => { const ex = o.userData || {}; if (!ex.nivel || o === raiz) return;
    if (ex.muebles) (muebles[ex.nivel + ex.unidad] = o);
    else if (ex.unidad && ex.unidad !== 'comun' && ex.nivel !== 'sitio') (unidades[ex.nivel + ex.unidad] ||= []).push(o); });

  // máscara de la costa (para la espuma pintada y el degradado del agua): se dibuja la tierra vista desde arriba
  { const T0 = info.tablero, W = 512, H = Math.round(512 * (T0.y1 - T0.y0) / (T0.x1 - T0.x0));
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff';
    const v = new THREE.Vector3(); const px = p => [(p.x - T0.x0) / (T0.x1 - T0.x0) * W, (p.z + T0.y1) / (T0.y1 - T0.y0) * H];
    if (sitio) sitio.traverse(o => { if (!o.isMesh || o.material === M.mar) return; o.updateWorldMatrix(true, false); const g = o.geometry, P = g.attributes.position, I = g.index;
      const n = I ? I.count : P.count; for (let i = 0; i < n; i += 3) { const pts = []; let alto = true;
        for (let k = 0; k < 3; k++) { v.fromBufferAttribute(P, I ? I.getX(i + k) : i + k).applyMatrix4(o.matrixWorld); if (v.y < -1.2) alto = false; pts.push(px(v)); }
        if (!alto) continue; x.beginPath(); x.moveTo(...pts[0]); x.lineTo(...pts[1]); x.lineTo(...pts[2]); x.closePath(); x.fill(); } });
    const capaBlur = r => { const d = document.createElement('canvas'); d.width = W; d.height = H; const y = d.getContext('2d'); y.filter = `blur(${r}px)`; y.drawImage(c, 0, 0); return y.getImageData(0, 0, W, H).data; };
    const a = capaBlur(2.5), b = capaBlur(22), out = x.createImageData(W, H);
    for (let i = 0; i < a.length; i += 4) { out.data[i] = a[i]; out.data[i + 1] = Math.min(255, b[i] * 1.8); out.data[i + 2] = 0; out.data[i + 3] = 255; }
    x.putImageData(out, 0, 0); window.__costa = c; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.needsUpdate = true;
    M.mar.userData.tCosta.value = t; M.mar.userData.uCosta.value.set(T0.x0, -T0.y1, T0.x1 - T0.x0, T0.y1 - T0.y0); }
  // tablero según el recorte del entorno
  const T = info.tablero; const B = { x0: T.x0, x1: T.x1, z0: -T.y1, z1: -T.y0, top: -2.35, borde: 2.6 };
  const mesa = construirMesa(scene, B, opt.plano);
  const caja = new THREE.Box3(); Object.values(niveles).forEach(n => caja.expandByObject(n.g));
  const cs = caja.getSize(new THREE.Vector3()), cc = caja.getCenter(new THREE.Vector3());

  // árboles (instancias)
  const arb = geoArbol(), pal = geoPalma();
  const mTronco = triplanar({ color: 0xc9b08a, roughness: .9 }, TEX.balsa(), 2), mCopa = triplanar({ color: 0xcfd3c2, roughness: 1 }, TEX.espuma(), 2.2),
    mHoja = triplanar({ color: 0xd9dccd, roughness: .9 }, TEX.papel(), 3);
  const veg = new THREE.Group(); scene.add(veg);
  function instancias(lista, geo, mat, escala) {
    if (!lista.length) return; const im = new THREE.InstancedMesh(geo, mat, lista.length); const m4 = new THREE.Matrix4();
    lista.forEach((a, i) => { const [sx, sy] = escala(a); m4.compose(su(a.x, a.y, a.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a.rot ??= rnd() * 6.28, 0)), new THREE.Vector3(sx, sy, sx)); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true; veg.add(im); return im;
  }
  const palmas = info.arboles.filter(a => a.tipo === 'palma'), arboles = info.arboles.filter(a => a.tipo !== 'palma');
  instancias(palmas, pal.tronco, mTronco, a => [1.2, Math.max(4, a.h)]); instancias(palmas, pal.copa, mHoja, a => [Math.max(2.6, a.r * 1.2), Math.max(4, a.h)]);
  instancias(arboles, arb.tronco, mTronco, a => [Math.max(.8, a.r * .7), Math.max(1.2, a.h * .6)]); instancias(arboles, arb.copa, mCopa, a => [Math.max(1, a.r * 1.55), Math.max(1, a.h * .72)]);

  // luces: sol (heliodón del estudio), cielo y lámpara de mesa
  const hemi = new THREE.HemisphereLight(0xfff4e6, 0x8a7a6a, .45); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6); scene.add(sun, sun.target);
  sun.castShadow = true; { const sm = baja ? 1024 : movil ? 2048 : 4096; sun.shadow.mapSize.set(sm, sm); } sun.shadow.bias = -.0003; sun.shadow.normalBias = .03; sun.shadow.radius = 2.5;
  const relleno = new THREE.PointLight(0xfff2e2, 0, 10, 1.4); scene.add(relleno);
  const spot = new THREE.SpotLight(0xffd9a6, 0, 900, .55, .7, 1.2); scene.add(spot, spot.target);
  mesa.foco.updateWorldMatrix(true, false); spot.position.copy(mesa.foco.getWorldPosition(new THREE.Vector3())); spot.target.position.set(cc.x + 30, B.top, cc.z);
  let horaActual = opt.hora ?? 10;
  const C = (h, s, l) => new THREE.Color().setHSL(h, s, l);
  function ponerHora(h) {
    horaActual = h; const s = sol(h); const alt = Math.max(s.alt, -.05);
    const dir = new THREE.Vector3(Math.sin(s.az) * Math.cos(alt), Math.sin(alt), -Math.cos(s.az) * Math.cos(alt));
    sun.userData.dir = dir; ajustarSombra();
    const dia = THREE.MathUtils.smoothstep(alt, -.02, .25);       // 0 al amanecer/atardecer, 1 a pleno día
    const luz = THREE.MathUtils.smoothstep(alt, -.06, .06);
    sun.intensity = 2.7 * luz * (.6 + .4 * dia);
    sun.color.copy(C(.075 + .04 * dia, .9 - .55 * dia, .62 + .3 * dia));
    hemi.intensity = .32 + .3 * dia; scene.environmentIntensity = .22 + .22 * dia; hemi.color.copy(C(.58 - .5 * (1 - dia), .35, .82));
    spot.intensity = 60000 * (1 - dia) ** 2;
    const U = cielo.material.uniforms;
    U.cA.value.copy(dia > .5 ? C(.58, .35, .74) : C(.6 - .02 * dia, .32, .3 + .4 * dia));
    U.cB.value.copy(C(.07 + .5 * dia * dia, .55 - .25 * dia, .55 + .25 * dia));
    U.cC.value.copy(C(.07, .2, .1));
    renderer.toneMappingExposure = .78 + .1 * dia;
    req();
  }
  function ajustarSombra() {
    const d = sun.userData.dir; if (!d) return;
    const t = ctl.target; const dist = cam.position.distanceTo(t);
    const r = THREE.MathUtils.clamp(dist * (enRecorrido ? 1.2 : .62), 18, 190);
    sun.position.copy(t).addScaledVector(d, 420); sun.target.position.copy(t);
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 200, far: 700 }); sun.shadow.camera.updateProjectionMatrix();
    const texel = 2 * r / sun.shadow.mapSize.x; sun.shadow.normalBias = texel * 1.4; sun.shadow.bias = -texel * .0006;
  }

  // ------------------------------------------------------------------ rótulos
  const ORD = info.niveles.map(n => n.id);
  const numNivel = id => id === 'R' ? 'Roof' : id === 'N1' ? 'Lobby' : id.slice(1);
  const datosU = (nv, u) => Object.assign({ codigo: numNivel(nv) + u, tipo: '', estado: '', color: '#3a9d6a' }, opt.unidad ? opt.unidad(nv, u) || {} : {});
  const rotulos = [];
  function rotulo(clase, html, pos, grupo, alClic) {
    const el = document.createElement('div'); el.className = 'mq-r mq-oculto ' + clase; el.innerHTML = html; capa.appendChild(el);
    if (alClic) el.addEventListener('click', e => { e.stopPropagation(); alClic(); });
    const r = { el, pos, grupo, vis: false }; rotulos.push(r); return r;
  }
  for (const nv of ORD) { const us = info.unidades[nv]; if (!us) continue;
    for (const u of us) { const h = info.huella[u]; const z = info.niveles[ORD.indexOf(nv)].z;
      rotulo('mq-u', '', su((h[0] + h[2]) / 2, (h[1] + h[3]) / 2, z + 2.2), 'u:' + nv, () => opt.alElegir ? opt.alElegir(nv, u) : api.verUnidad(nv, u)).unidad = [nv, u]; } }
  for (const [k, list] of Object.entries(info.ambientes || {})) for (const a of list) rotulo('mq-a', a.t, su(a.x, a.y, a.z - .3), 'a:' + k);
  function refrescarDatos() { for (const r of rotulos) if (r.unidad) { const d = datosU(...r.unidad); r.el.style.setProperty('--c', d.color);
    r.el.innerHTML = `<b>${d.codigo}${d.tipo || d.estado ? `<i>${[d.tipo, d.estado].filter(Boolean).join(' · ')}</i>` : ''}</b>`; } }
  refrescarDatos();
  let grupoVisible = null;
  const v3 = new THREE.Vector3();
  function moverRotulos() {
    const w = cont.clientWidth, h = cont.clientHeight; const puestos = [];
    for (const r of rotulos) {
      const on = !enRecorrido && grupoVisible && (r.grupo === grupoVisible || (grupoVisible.startsWith('a:') && r.grupo === grupoVisible));
      if (!on) { if (r.vis) { r.el.classList.add('mq-oculto'); r.vis = false; } continue; }
      v3.copy(r.pos); v3.y += desplazamiento(r.grupo); v3.project(cam);
      if (v3.z > 1) { r.el.classList.add('mq-oculto'); r.vis = false; continue; }
      if (!r.vis) { r.el.classList.remove('mq-oculto'); r.vis = true; }
      if (!r.tam) r.tam = [r.el.offsetWidth || 90, r.el.offsetHeight || 24];
      const [ew, eh] = r.tam; let x = (v3.x * .5 + .5) * w - ew / 2, y = (-v3.y * .5 + .5) * h - (r.unidad ? eh : eh / 2);
      // que no se monten: se corre hacia abajo/arriba si choca con uno ya puesto
      for (let k = 0; k < 6; k++) { const c = puestos.find(p => x < p[0] + p[2] + 4 && x + ew + 4 > p[0] && y < p[1] + p[3] + 3 && y + eh + 3 > p[1]);
        if (!c) break; y = r.unidad ? c[1] - eh - 3 : c[1] + c[3] + 3; }
      puestos.push([x, y, ew, eh]);
      r.el.style.transform = `translate(${x}px,${y}px)`;
    }
  }
  const desplazamiento = g => { const id = g.startsWith('u:') ? g.slice(2) : g.slice(2, -1); const n = niveles[id]; return n ? n.g.position.y : 0; };

  // ------------------------------------------------------------------ estado e interacción
  let foco = null, despiece = 0, conMuebles = true, unidadSel = null, enRecorrido = false, conEntorno = true;
  const anim = []; let pedir = true; const req = () => { pedir = true; }; scene.userData.req = req;
  ctl.addEventListener('change', () => { req(); });
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function tween(obj, prop, to, ms = 650) { for (let i = anim.length - 1; i >= 0; i--) if (anim[i].obj === obj && anim[i].prop === prop) anim.splice(i, 1);
    anim.push({ obj, prop, from: obj[prop], to, t0: performance.now(), ms }); req(); }
  const fantasma = new Map();
  function atenuar(o, si) {
    o.traverse(m => { if (!m.isMesh) return;
      if (si && !m.userData.mat0) { m.userData.mat0 = m.material; let f = fantasma.get(m.material); if (!f) { f = m.material.clone(); f.transparent = true; f.opacity = .16; f.depthWrite = false; fantasma.set(m.material, f); } m.material = f; m.castShadow = false; }
      if (!si && m.userData.mat0) { m.material = m.userData.mat0; delete m.userData.mat0; m.castShadow = m.material !== M.acrilico && m.material !== M.agua; } });
  }
  function aplicar() {
    const i0 = foco && !enRecorrido ? ORD.indexOf(foco) : ORD.length - 1;
    ORD.forEach((id, i) => { const nv = niveles[id]; if (!nv) return;
      const arriba = i > i0;
      tween(nv.g.position, 'y', (arriba ? 140 + (i - i0) * 14 : 0) + (enRecorrido ? 0 : i * despiece), 900);
      if (!arriba) nv.g.visible = true; nv.g.userData.arriba = arriba;
      clearTimeout(nv.t); if (arriba) nv.t = setTimeout(() => { nv.g.visible = !nv.g.userData.arriba; req(); }, 860);
    });
    for (const [k, g] of Object.entries(muebles)) g.visible = conMuebles;
    for (const [k, list] of Object.entries(unidades)) { const at = !enRecorrido && unidadSel && k !== unidadSel && k.startsWith(foco); list.forEach(g => atenuar(g, at)); }
    for (const [k, g] of Object.entries(muebles)) atenuar(g, !enRecorrido && unidadSel && k !== unidadSel && k.startsWith(foco));
    grupoVisible = enRecorrido ? null : unidadSel ? 'a:' + unidadSel : foco && info.unidades[foco] ? 'u:' + foco : null;
    if (sitio) sitio.visible = conEntorno; veg.visible = conEntorno;
    opt.alCambiar && opt.alCambiar({ vista: enRecorrido ? 'recorrido' : unidadSel ? 'unidad' : foco ? 'nivel' : 'edificio', nivel: foco, unidad: unidadSel ? unidadSel.slice(foco.length) : null });
    req();
  }
  function volar(objetivo, dist, polar = 1.0, azim = null, ms = 1300) {
    const p0 = cam.position.clone(), t0c = ctl.target.clone(); const off = cam.position.clone().sub(ctl.target);
    const sph = new THREE.Spherical().setFromVector3(off); sph.radius = dist; sph.phi = polar; if (azim !== null) sph.theta = azim;
    const s0 = new THREE.Spherical().setFromVector3(off); let dth = sph.theta - s0.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    anim.push({ fn: t => { const s = new THREE.Spherical(s0.radius + (sph.radius - s0.radius) * t, s0.phi + (sph.phi - s0.phi) * t, s0.theta + dth * t);
      ctl.target.lerpVectors(t0c, objetivo, t); cam.position.copy(ctl.target).add(new THREE.Vector3().setFromSpherical(s)); }, t0: performance.now(), ms }); req();
  }
  const zNivel = id => info.niveles[ORD.indexOf(id)].z;
  function centroNivel(id) { return new THREE.Vector3(cc.x, zNivel(id) + 1.2 + ORD.indexOf(id) * despiece, cc.z); }

  // ------------------------------------------------------------------ recorrido en primera persona (dentro de la maqueta)
  const ojo = new THREE.Vector3(); let yaw = 0, pitch = 0, nivelRec = null; const teclas = {};
  const ALTO_OJO = 1.58;
  function mirar() { const d = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); cam.position.copy(ojo); relleno.position.copy(ojo).y += .5; cam.lookAt(ojo.clone().add(d)); req(); }
  function recorrer(nv, u) {
    const amb = (info.ambientes || {})[nv + u] || []; const sala = amb.find(a => /Sala/.test(a.t)) || amb[0]; const h = info.huella[u];
    const x = sala ? sala.x : (h[0] + h[2]) / 2, y = sala ? sala.y : (h[1] + h[3]) / 2;
    enRecorrido = true; foco = nv; unidadSel = nv + u; nivelRec = nv; despiece = 0; aplicar();
    ctl.enabled = false; relleno.intensity = 7; cam.near = .05; cam.fov = movil ? 70 : 62; cam.updateProjectionMatrix();
    const p0 = cam.position.clone(), q0 = cam.quaternion.clone();
    ojo.copy(su(x, y, zNivel(nv) + ALTO_OJO)); yaw = 0; pitch = -.04; // mirando al mar (sur = +z)
    const q1 = new THREE.Quaternion(); { const c2 = cam.clone(); c2.position.copy(ojo); c2.lookAt(ojo.clone().add(new THREE.Vector3(0, -.04, 1))); q1.copy(c2.quaternion); }
    anim.push({ fn: t => { cam.position.lerpVectors(p0, ojo, t); cam.quaternion.slerpQuaternions(q0, q1, t); }, t0: performance.now(), ms: 1800, fin: () => { mira.style.display = 'block'; mirar(); } });
    ajustarSombra(); req();
  }
  function salir(volarA = true) {
    if (!enRecorrido) return; enRecorrido = false; relleno.intensity = 0; paso.style.opacity = 0; mira.style.display = 'none'; ctl.enabled = true; cam.near = 1; cam.fov = 30; cam.updateProjectionMatrix();
    const [nv, u] = [foco, unidadSel.slice(foco.length)];
    ctl.target.copy(ojo); aplicar(); if (volarA) api.verUnidad(nv, u);
  }
  // mirar arrastrando, caminar con teclas o tocando el piso
  let arr = null;
  renderer.domElement.addEventListener('pointerdown', e => { arr = { x: e.clientX, y: e.clientY, yaw, pitch, t: performance.now(), mov: 0 }; });
  addEventListener('pointermove', e => {
    if (enRecorrido && !arr) { const hit = pisoBajo(e); if (hit) { const p = hit.point.clone().project(cam); paso.style.left = (p.x * .5 + .5) * cont.clientWidth + 'px'; paso.style.top = (-p.y * .5 + .5) * cont.clientHeight + 'px'; paso.style.opacity = .9; } else paso.style.opacity = 0; }
    if (!arr || !enRecorrido) return; const dx = e.clientX - arr.x, dy = e.clientY - arr.y; arr.mov = Math.max(arr.mov, Math.hypot(dx, dy));
    const s = movil ? .006 : .0042; yaw = arr.yaw - dx * s * (movil ? 1 : 1); pitch = THREE.MathUtils.clamp(arr.pitch + dy * s * .8, -1.2, 1.2); mirar(); paso.style.opacity = 0; });
  addEventListener('pointerup', e => { const a = arr; arr = null; if (!a) return; if (a.mov > 6) return;
    if (enRecorrido) { const hit = pisoBajo(e); if (hit) caminarA(hit.point); return; }
    elegir(e); });
  renderer.domElement.addEventListener('wheel', e => { if (!enRecorrido) return; e.preventDefault(); cam.fov = THREE.MathUtils.clamp(cam.fov + e.deltaY * .03, 35, 80); cam.updateProjectionMatrix(); req(); }, { passive: false });
  addEventListener('keydown', e => { teclas[e.key.toLowerCase()] = true; if (e.key === 'Escape' && enRecorrido) salir(); });
  addEventListener('keyup', e => { teclas[e.key.toLowerCase()] = false; });
  const ray = new THREE.Raycaster(); const ptr = new THREE.Vector2();
  function rayo(e) { const r = renderer.domElement.getBoundingClientRect(); ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, cam); }
  function golpe(e, obj) { rayo(e); return ray.intersectObject(obj, true).find(h => h.object.visible && visibleArriba(h.object) && !(h.object.material.transparent && h.object.material.opacity < .5)); }
  const visibleArriba = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  function pisoBajo(e) {
    const r = renderer.domElement.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    const hit = golpe(e, niveles[nivelRec].g); if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld); const zf = zNivel(nivelRec);
    if (n.y < .75 || hit.point.y < zf - .5 || hit.point.y > zf + .9 || hit.distance > 14) return null; return hit;
  }
  function caminarA(p) { const a = ojo.clone(), b = new THREE.Vector3(p.x, zNivel(nivelRec) + ALTO_OJO, p.z); const d = a.distanceTo(b);
    anim.push({ fn: t => { ojo.lerpVectors(a, b, t); mirar(); }, t0: performance.now(), ms: Math.min(1600, 350 + d * 160) }); }
  function teclado(dt) {
    if (!enRecorrido) return false; let f = 0, s = 0, g = 0;
    if (teclas['w'] || teclas['arrowup']) f += 1; if (teclas['s'] || teclas['arrowdown']) f -= 1; if (teclas['a']) s -= 1; if (teclas['d']) s += 1;
    if (teclas['arrowleft']) g += 1; if (teclas['arrowright']) g -= 1;
    if (!f && !s && !g) return false;
    yaw += g * dt * 1.6; const v = 1.4 * dt;
    const fw = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), rt = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const mov = fw.multiplyScalar(f * v).add(rt.multiplyScalar(s * v));
    if (mov.lengthSq()) { // no atravesar paredes: rayo a la altura de la cintura
      ray.set(ojo.clone().setY(ojo.y - .7), mov.clone().normalize()); ray.far = mov.length() + .35;
      const h = ray.intersectObject(niveles[nivelRec].g, true).find(x => x.object.visible && !(x.object.material.transparent && x.object.material.opacity < .5));
      ray.far = Infinity; if (!h) ojo.add(mov);
    }
    mirar(); return true;
  }

  function elegir(e) {
    if (!foco) { // edificio entero: tocar un piso
      const hit = golpe(e, raiz); if (!hit) return; let o = hit.object; while (o && !(o.userData && o.userData.nivel && o.userData.nivel !== 'sitio')) o = o.parent;
      if (o) api.verNivel(o.userData.nivel); return; }
    const hit = golpe(e, niveles[foco].g); if (!hit) return; let o = hit.object; while (o && !(o.userData && o.userData.unidad)) o = o.parent;
    if (o && o.userData.unidad !== 'comun') opt.alElegir ? opt.alElegir(o.userData.nivel, o.userData.unidad) : api.verUnidad(o.userData.nivel, o.userData.unidad);
  }

  const api = {
    niveles: info.niveles, huella: info.huella, unidadesPorNivel: info.unidades, ambientes: info.ambientes,
    verNivel(id) { if (enRecorrido) salir(false);
      foco = id === 'todo' ? null : id; unidadSel = null; aplicar();
      if (foco) volar(centroNivel(foco), movil ? 120 : 88, .5, null); else api.inicio(); },
    verUnidad(nv, u) { if (enRecorrido) salir(false);
      foco = nv; unidadSel = nv + u; aplicar(); const h = info.huella[u];
      const c = su((h[0] + h[2]) / 2, (h[1] + h[3]) / 2, zNivel(nv) + 1); c.y += ORD.indexOf(nv) * despiece;
      volar(c, movil ? 44 : 34, .58, null); },
    recorrer, salir: () => salir(true),
    muebles(v) { conMuebles = v; aplicar(); },
    despiece(v) { despiece = v ? 7 : 0; aplicar(); if (!foco) volar(cc.clone().setY(cs.y * .45 + (v ? 20 : 0)), Math.max(cs.x, cs.z) * (movil ? 6 : 4.4), 1.1, null, 900); },
    entorno(v) { conEntorno = v; aplicar(); },
    hora: ponerHora, get horaActual() { return horaActual; },
    inicio() { if (enRecorrido) salir(false); foco = null; unidadSel = null; aplicar(); volar(cc.clone().setY(cs.y * .32), movil ? 330 : 240, 1.08, .62, 1600); },
    vistaGeneral() { volar(new THREE.Vector3((B.x0 + B.x1) / 2, 0, (B.z0 + B.z1) / 2), movil ? 620 : 470, .78, .55, 1600); },
    refrescar: refrescarDatos, pausar(v) { pausado = v; if (!v) req(); },
    get estado() { return { foco, unidadSel, enRecorrido, despiece, conMuebles, conEntorno }; },
    _r: { renderer, scene, cam, ctl, THREE, niveles, cc, cs, M, TEX },
  };

  // bucle de dibujo a demanda
  let pausado = false, tPrev = performance.now();
  function tam() { const w = cont.clientWidth, h = cont.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); req(); }
  new ResizeObserver(tam).observe(cont); tam();
  cam.position.set(cc.x + 260, 160, cc.z + 330); ctl.target.copy(cc); ctl.update();
  let sombraT = 0;
  function loop(now) {
    requestAnimationFrame(loop); const dt = Math.min(.05, (now - tPrev) / 1000); tPrev = now; if (pausado) return;
    for (let i = anim.length - 1; i >= 0; i--) { const a = anim[i]; const t = Math.min(1, (now - a.t0) / a.ms); const e = ease(t);
      if (a.fn) a.fn(e); else a.obj[a.prop] = a.from + (a.to - a.from) * e; if (t >= 1) { anim.splice(i, 1); a.fin && a.fin(); } }
    if (teclado(dt)) pedir = true;
    const mov = ctl.enabled ? ctl.update() : false; if (anim.length || mov) pedir = true;
    if (!pedir) return; if (opt.intervalo && now - (loop.u || 0) < opt.intervalo) return; loop.u = now; pedir = false;
    if (now - sombraT > 120 || !anim.length) { ajustarSombra(); sombraT = now; }
    renderer.render(scene, cam); moverRotulos();
  }
  ponerHora(horaActual);
  requestAnimationFrame(loop);
  api.inicio();
  return api;
}
