// bg3d.js — 阶段3:空间感动态背景 + 真·3D 水面 + 滚动下潜入水转场
// 水上:bg1 天空背板 + 实时反射水面 + 三层视差云 + 十字星光 + 尘埃
// 入水:白闪 + 气泡爆发 + FOV 冲击/镜头抖动
// 水下:bg2 动态背板 + 水面底面波光 + 水下色调/微晃
// 初始化成功 → 隐藏 CSS orb 背景;失败 → 静默退出,CSS 背景兜底
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

const PINK = 0xf2cbd9;
const WATER_Y = -16;
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = window.innerWidth < 760;

// ---------- 星形光点贴图:亮核 + 长十字光芒 + 短斜光芒 ----------
function makeStarSprite() {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const ray = (angle, len, wid, alpha) => {
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(angle);
    const lg = g.createLinearGradient(-len / 2, 0, len / 2, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, `rgba(255,255,255,${alpha})`);
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = lg;
    g.fillRect(-len / 2, -wid / 2, len, wid);
    g.restore();
  };
  g.globalCompositeOperation = 'lighter';
  ray(0, s, s * 0.045, 0.95);
  ray(Math.PI / 2, s, s * 0.045, 0.95);
  ray(Math.PI / 4, s * 0.5, s * 0.035, 0.45);
  ray(-Math.PI / 4, s * 0.5, s * 0.035, 0.45);
  const grad = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s * 0.16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,238,248,0.85)');
  grad.addColorStop(1, 'rgba(255,238,248,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeDotSprite() {
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,240,248,0.7)');
  grad.addColorStop(1, 'rgba(255,240,248,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- 可平铺云贴图 ----------
function makeCloudTexture() {
  const W = 512, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const puff = (x, y, r, a) => {
    for (const ox of [-W, 0, W]) {
      const grad = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      grad.addColorStop(0, `rgba(255,236,244,${a})`);
      grad.addColorStop(0.55, `rgba(252,222,236,${a * 0.5})`);
      grad.addColorStop(1, 'rgba(252,222,236,0)');
      g.fillStyle = grad;
      g.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 16; i++) {
    puff(rnd() * W, H * (0.3 + rnd() * 0.45), 34 + rnd() * 66, 0.10 + rnd() * 0.16);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePoints({ count, range, sprite, baseSize, color, opacity, sharpTwinkle }) {
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const speed = new Float32Array(count);
  const size = new Float32Array(count);
  const [x0, x1, y0, y1, z0, z1] = range;
  for (let i = 0; i < count; i++) {
    pos[i*3]   = x0 + Math.random() * (x1 - x0);
    pos[i*3+1] = y0 + Math.random() * (y1 - y0);
    pos[i*3+2] = z0 + Math.random() * (z1 - z0);
    phase[i] = Math.random() * Math.PI * 2;
    speed[i] = 0.6 + Math.random() * 1.8;
    size[i] = baseSize * (0.5 + Math.random());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: sprite },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity }
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aSize;
      varying float vTw;
      uniform float uTime;
      void main() {
        vec3 p = position;
        p.x += sin(uTime * 0.10 * aSpeed + aPhase) * 3.0;
        p.y += cos(uTime * 0.13 * aSpeed + aPhase * 1.7) * 2.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float s = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
        ${sharpTwinkle
          ? 'vTw = 0.18 + 0.82 * pow(s, 3.0);'
          : 'vTw = 0.55 + 0.45 * s;'}
        gl_PointSize = aSize * (0.55 + 0.9 * vTw) * (240.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vTw;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(uColor * tex.rgb, tex.a * uOpacity * vTw);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  return new THREE.Points(geo, mat);
}

function init() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no ctx');
  } catch (e) {
    console.warn('bg3d: WebGL 不可用,保留 CSS 背景', e);
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(PINK, 1);
  renderer.autoClear = false;

  const canvas = renderer.domElement;
  canvas.id = 'bg3d-canvas';
  canvas.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity 1.2s ease;';
  const meshBg = document.getElementById('mesh-bg');
  (meshBg ? meshBg.parentNode : document.body).insertBefore(canvas, meshBg || document.body.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1500);
  camera.position.set(0, 0, 30);
  const loader = new THREE.TextureLoader();

  // ---------- 天空背板(水上) ----------
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: null }, uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 uv = (vUv - 0.5) * 0.92 + 0.5;
        uv += vec2(sin(uTime * 0.021), cos(uTime * 0.017)) * 0.006;
        vec3 col = texture2D(uMap, uv).rgb;
        col *= 1.0 + 0.035 * sin(uTime * 0.12);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(1180, 664), skyMat);
  sky.position.set(0, 26, -420);
  scene.add(sky);

  // ---------- 真·3D 水面 ----------
  const waterNormals = loader.load('assets/waternormals.jpg', t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  });
  const water = new Water(new THREE.PlaneGeometry(4000, 4000), {
    textureWidth: MOBILE ? 256 : 512,
    textureHeight: MOBILE ? 256 : 512,
    waterNormals,
    sunDirection: new THREE.Vector3(0, 0.3, -0.8).normalize(),
    sunColor: 0xffe4d6,
    waterColor: 0xa06a88,
    distortionScale: 2.6,
    alpha: 1.0
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  water.material.uniforms.size.value = 4.0;
  scene.add(water);

  // 海平线雾带
  const hazeMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xf0c3d2) } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float a = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
        gl_FragColor = vec4(uColor, a * 0.85);
      }`,
    transparent: true,
    depthWrite: false
  });
  const haze = new THREE.Mesh(new THREE.PlaneGeometry(1500, 80), hazeMat);
  haze.position.set(0, -4, -400);
  haze.renderOrder = 2;
  scene.add(haze);

  // ---------- 水下背板(bg2,涟漪扰动 + 漂移) ----------
  const uwMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: null }, uTime: { value: 0 } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 uv = (vUv - 0.5) * 0.9 + 0.5;
        uv += vec2(sin(uTime * 0.03), cos(uTime * 0.023)) * 0.008;
        uv.x += sin(vUv.y * 22.0 + uTime * 0.7) * 0.004;      // 整体水体晃动
        uv.y += cos(vUv.x * 18.0 + uTime * 0.55) * 0.004;
        vec3 col = texture2D(uMap, uv).rgb;
        col *= 1.0 + 0.05 * sin(uTime * 0.18);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false
  });
  const uwBack = new THREE.Mesh(new THREE.PlaneGeometry(1180, 664), uwMat);
  uwBack.position.set(0, 0, -420);
  uwBack.visible = false;
  scene.add(uwBack);

  // ---------- 水面底面(水下抬头看到的流动波光) ----------
  const ceilMat = new THREE.ShaderMaterial({
    uniforms: {
      uNorm: { value: waterNormals },
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uFog: { value: new THREE.Color(0xc9a2b8) }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWp;
      void main() {
        vUv = uv * 42.0;
        vWp = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uNorm;
      uniform float uTime;
      uniform vec3 uCam;
      uniform vec3 uFog;
      varying vec2 vUv;
      varying vec3 vWp;
      void main() {
        vec3 n1 = texture2D(uNorm, vUv + vec2(uTime * 0.020, uTime * 0.013)).rgb;
        vec3 n2 = texture2D(uNorm, vUv * 1.7 - vec2(uTime * 0.016, uTime * 0.024)).rgb;
        vec3 n = normalize(n1 + n2 - 1.0);
        float c = pow(max(n.z, 0.0), 6.0);                    // 波光集中度
        vec3 col = uFog * 0.9 + vec3(1.0, 0.94, 0.97) * c * 1.1;
        float d = distance(vWp, uCam);
        float f = exp(-d * 0.007);                            // 距离雾
        gl_FragColor = vec4(mix(uFog, col, f), clamp(f * 1.4, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false
  });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), ceilMat);
  ceil.rotation.x = Math.PI / 2;                              // 法线朝下,只在水下可见
  ceil.position.y = WATER_Y - 0.2;
  ceil.renderOrder = 1;
  ceil.visible = false;
  scene.add(ceil);

  // ---------- 云 / 星光 / 尘埃 ----------
  const cloudTex = makeCloudTexture();
  const cloudLayers = [];
  const cloudDefs = [
    { z: -340, y: 95, w: 900, h: 210, op: 0.42, speed: 0.0045 },
    { z: -250, y: 70, w: 760, h: 180, op: 0.30, speed: -0.0072 },
    { z: -165, y: 52, w: 620, h: 150, op: 0.20, speed: 0.011 }
  ];
  for (const d of cloudDefs) {
    const tex = cloudTex.clone();
    tex.needsUpdate = true;
    tex.offset.x = Math.random();
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(d.w, d.h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: d.op, depthWrite: false })
    );
    m.position.set(0, d.y, d.z);
    scene.add(m);
    cloudLayers.push({ mesh: m, tex, speed: d.speed, baseY: d.y, ph: Math.random() * 6.28 });
  }
  const stars = makePoints({
    count: MOBILE ? 80 : 160,
    range: [-460, 460, 30, 250, -400, -140],
    sprite: makeStarSprite(), baseSize: 13,
    color: 0xfff6fb, opacity: 1.0, sharpTwinkle: true
  });
  scene.add(stars);
  const dust = makePoints({
    count: MOBILE ? 90 : 220,
    range: [-70, 70, -40, 40, -90, 12],
    sprite: makeDotSprite(), baseSize: 1.6,
    color: 0xffe8f2, opacity: 0.4, sharpTwinkle: false
  });
  scene.add(dust);

  // ---------- 入水气泡爆发 ----------
  const BN = MOBILE ? 70 : 150;
  const bPos = new Float32Array(BN * 3);
  const bVel = new Float32Array(BN * 3);
  const bSize = new Float32Array(BN);
  const bGeo = new THREE.BufferGeometry();
  bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
  bGeo.setAttribute('aSize', new THREE.BufferAttribute(bSize, 1));
  const bMat = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: makeDotSprite() }, uOpacity: { value: 0 } },
    vertexShader: `
      attribute float aSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * (240.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uOpacity;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(tex.rgb, tex.a * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const bubbles = new THREE.Points(bGeo, bMat);
  bubbles.visible = false;
  scene.add(bubbles);
  function spawnBubbles(camX) {
    for (let i = 0; i < BN; i++) {
      bPos[i*3]   = camX + (Math.random() - 0.5) * 30;
      bPos[i*3+1] = WATER_Y + (Math.random() - 0.5) * 6;
      bPos[i*3+2] = 20 - Math.random() * 44;                  // 相机(z=30)前方
      bVel[i*3]   = (Math.random() - 0.5) * 8;
      bVel[i*3+1] = 6 + Math.random() * 16;
      bVel[i*3+2] = (Math.random() - 0.5) * 8;
      bSize[i] = 1.2 + Math.random() * 3.4;
    }
    bGeo.attributes.position.needsUpdate = true;
    bGeo.attributes.aSize.needsUpdate = true;
    bubbles.visible = true;
  }

  // ---------- 后期叠加:颗粒 + 暗角 + 水下色调 + 白闪 + 冲刺速度线 ----------
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uWarp: { value: 0 },
      uUnder: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uFlash;
      uniform float uWarp;
      uniform float uUnder;
      varying vec2 vUv;
      float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float n = rnd(gl_FragCoord.xy + mod(uTime, 7.0) * 131.0);
        vec3 col = vec3(n);
        float a = 0.05;
        // 暗角
        float edge = smoothstep(0.5, 1.0, length(vUv - 0.5) * 1.35);
        col = mix(col, vec3(0.10, 0.05, 0.08), edge * 0.85);
        a += edge * 0.16;
        // 水下色调(青粉滤镜,暗角略加重)
        col = mix(col, vec3(0.55, 0.72, 0.78), uUnder * 0.55);
        a += uUnder * (0.10 + edge * 0.08);
        // 入水冲刺:垂直速度线
        float sb = rnd(vec2(floor(vUv.x * 150.0), 0.0));
        float band = fract(vUv.y * 1.6 - uTime * 5.5 + sb * 4.0);
        float streaks = smoothstep(0.86, 1.0, band) * (0.3 + sb * 0.7) * uWarp;
        col = mix(col, vec3(1.0, 0.98, 0.99), streaks);
        a += streaks * 0.45;
        // 白闪
        col = mix(col, vec3(1.0, 0.97, 0.98), uFlash);
        a = mix(a, 1.0, uFlash * uFlash);
        gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: false
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

  // ---------- 交互 ----------
  let mx = 0, my = 0, px = 0, py = 0, scrollVh = 0;
  window.addEventListener('mousemove', e => {
    mx = e.clientX / window.innerWidth - 0.5;
    my = e.clientY / window.innerHeight - 0.5;
  }, { passive: true });
  window.addEventListener('scroll', () => {
    scrollVh = Math.min(window.scrollY / window.innerHeight, 2);
  }, { passive: true });

  // 滚动 → 下潜深度:0.75 屏时穿越水面(-16),最深 -34
  function diveDepth(p) {
    if (p <= 0.5) return p * 12;
    return Math.min(6 + (p - 0.5) * 40, 34);
  }

  const clock = new THREE.Clock();
  let raf = 0, lastT = 0, dive = 0, under = false, underMix = 0, burstAt = -10;

  function setMode(u) {
    under = u;
    sky.visible = !u;
    haze.visible = !u;
    stars.visible = !u;
    water.visible = !u;                    // 水下用 ceil 表现水面,省掉反射渲染
    for (const c of cloudLayers) c.mesh.visible = !u;
    uwBack.visible = u;
    ceil.visible = u;
  }

  function frame() {
    const t = clock.getElapsedTime();
    const dt = Math.min(t - lastT, 0.05);
    lastT = t;

    px += (mx - px) * 0.04;
    py += (my - py) * 0.04;
    dive += (diveDepth(scrollVh) - dive) * 0.07;

    // 入水/出水检测(带 0.5 迟滞防抖)
    const camY = -py * 5 - dive;
    if (!under && camY < WATER_Y - 0.5) { setMode(true); burstAt = t; spawnBubbles(px * 9); }
    else if (under && camY > WATER_Y + 0.5) { setMode(false); burstAt = t; spawnBubbles(px * 9); }
    underMix += ((under ? 1 : 0) - underMix) * 0.06;

    // 转场包络:白闪(快起慢收)+ 冲击(中段峰值)
    const bt = t - burstAt;
    const flash = bt < 0.5 ? Math.pow(1 - bt / 0.5, 1.6) : 0;
    const punch = bt < 0.8 ? Math.sin(Math.PI * Math.min(bt / 0.8, 1)) : 0;

    camera.position.x = px * 9 + Math.sin(t * 47.0) * punch * 0.7;   // 抖动
    camera.position.y = camY + Math.cos(t * 39.0) * punch * 0.5;
    camera.fov = 55 + punch * 14;                                     // FOV 冲击
    camera.updateProjectionMatrix();
    camera.lookAt(px * 4, camera.position.y * 0.85 + 4, -420);
    camera.rotateZ(Math.sin(t * 0.4) * 0.014 * underMix);             // 水下微晃

    // 背板近似无穷远:竖直跟随相机
    sky.position.y = 26 + camera.position.y * 0.92;
    haze.position.y = camera.position.y * 0.92 - 4;
    uwBack.position.y = camera.position.y * 0.92;

    water.material.uniforms.time.value = t * 0.55;
    skyMat.uniforms.uTime.value = t;
    uwMat.uniforms.uTime.value = t;
    ceilMat.uniforms.uTime.value = t;
    ceilMat.uniforms.uCam.value.copy(camera.position);
    stars.material.uniforms.uTime.value = t;
    dust.material.uniforms.uTime.value = t;
    postMat.uniforms.uTime.value = t;
    postMat.uniforms.uFlash.value = flash;
    postMat.uniforms.uWarp.value = punch;
    postMat.uniforms.uUnder.value = underMix;

    for (const c of cloudLayers) {
      c.tex.offset.x += c.speed * 0.016;
      c.mesh.position.y = c.baseY + Math.sin(t * 0.07 + c.ph) * 4.0;
    }

    // 气泡爆发动力学(浮力 + 阻尼,1.2s 生命周期)
    if (bubbles.visible) {
      if (bt > 1.2) { bubbles.visible = false; }
      else {
        for (let i = 0; i < BN; i++) {
          bVel[i*3+1] += 14 * dt;
          bPos[i*3]   += bVel[i*3]   * dt;
          bPos[i*3+1] += bVel[i*3+1] * dt;
          bPos[i*3+2] += bVel[i*3+2] * dt;
        }
        bGeo.attributes.position.needsUpdate = true;
        bMat.uniforms.uOpacity.value = 0.85 * (1 - bt / 1.2);
      }
    }

    renderer.clear();
    renderer.render(scene, camera);
    renderer.render(postScene, postCam);
    if (!REDUCED) raf = requestAnimationFrame(frame);
  }

  // ---------- 纹理加载(bg1 成功后接管背景;bg2 异步就位) ----------
  loader.load('assets/bg2-wide.jpg', tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    uwMat.uniforms.uMap.value = tex;
  });
  loader.load('assets/bg1-wide.jpg', tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    skyMat.uniforms.uMap.value = tex;
    frame();
    canvas.style.opacity = '1';
    ['mesh-bg', 'orb-a', 'orb-b', 'orb-c', 'orb-d'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const veil = document.getElementById('mesh-veil');
    if (veil) { veil.style.background = 'rgba(255,255,255,0.34)'; veil.style.opacity = '1'; }
  }, undefined, err => {
    console.warn('bg3d: 背景图加载失败,保留 CSS 背景', err);
    canvas.remove();
    renderer.dispose();
  });

  // ---------- resize / 标签页隐藏时暂停 ----------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (REDUCED) frame();
  });
  document.addEventListener('visibilitychange', () => {
    if (REDUCED) return;
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && skyMat.uniforms.uMap.value) raf = requestAnimationFrame(frame);
  });
}

init();
