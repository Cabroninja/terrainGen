const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value)));
const byId = (id) => document.getElementById(id);

function perspective(fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2); const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * range * 2, 0,
  ]);
}

function normalize(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
}

function lookAt(eye, target, up) {
  const z = normalize([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize([
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0],
  ]);
  const y = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

function multiply(a, b) {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) {
    output[column * 4 + row] =
      a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] +
      a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
  }
  return output;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message || 'No se pudo compilar el visor.');
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'No se pudo enlazar el visor.');
  return program;
}

function cubeGeometry() {
  const positions = []; const normals = []; const uvs = [];
  const faces = [
    { n: [0, 1, 0], p: [[-.5,.5,-.5],[.5,.5,-.5],[.5,.5,.5],[-.5,.5,.5]] },
    { n: [0, -1, 0], p: [[-.5,-.5,.5],[.5,-.5,.5],[.5,-.5,-.5],[-.5,-.5,-.5]] },
    { n: [0, 0, 1], p: [[-.5,-.5,.5],[-.5,.5,.5],[.5,.5,.5],[.5,-.5,.5]] },
    { n: [0, 0, -1], p: [[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,-.5]] },
    { n: [1, 0, 0], p: [[.5,-.5,.5],[.5,.5,.5],[.5,.5,-.5],[.5,-.5,-.5]] },
    { n: [-1, 0, 0], p: [[-.5,-.5,-.5],[-.5,.5,-.5],[-.5,.5,.5],[-.5,-.5,.5]] },
  ];
  const faceUvs = [[0,0],[1,0],[1,1],[0,1]];
  for (const face of faces) {
    for (const index of [0, 1, 2, 0, 2, 3]) {
      positions.push(...face.p[index]); normals.push(...face.n); uvs.push(...faceUvs[index]);
    }
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), uvs: new Float32Array(uvs) };
}

class SchematicPreviewViewer {
  constructor({ canvas, status, resetButton, gridInput, boundsInput }) {
    this.canvas = canvas; this.status = status; this.resetButton = resetButton; this.gridInput = gridInput; this.boundsInput = boundsInput;
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    this.yaw = -0.72; this.pitch = 0.55; this.distance = 3.4; this.target = [0, 0, 0]; this.drag = null; this.ready = false; this.frame = 0;
    if (!this.gl) { status.textContent = 'WebGL 2 no está disponible.'; return; }
    try { this.initialize(); this.bind(); this.observe(); } catch (error) { status.textContent = `No se pudo iniciar la vista: ${error.message}`; }
  }

  initialize() {
    const gl = this.gl;
    this.program = createProgram(gl, `#version 300 es
      in vec3 a_position; in vec3 a_normal; in vec2 a_uv; in vec3 a_offset;
      in vec4 a_top_color; in vec4 a_left_color; in vec4 a_right_color; in vec4 a_accent_color;
      in float a_family; in float a_seed;
      uniform mat4 u_matrix; uniform vec3 u_center; uniform float u_scale;
      out vec3 v_normal; out vec3 v_local; out vec2 v_uv;
      flat out vec4 v_top_color; flat out vec4 v_left_color; flat out vec4 v_right_color; flat out vec4 v_accent_color;
      flat out float v_family; flat out float v_seed;
      void main(){
        vec3 world=(a_position+a_offset-u_center)*u_scale;
        gl_Position=u_matrix*vec4(world,1.0);
        v_normal=a_normal; v_local=a_position; v_uv=a_uv;
        v_top_color=a_top_color; v_left_color=a_left_color; v_right_color=a_right_color; v_accent_color=a_accent_color;
        v_family=a_family; v_seed=a_seed;
      }
    `, `#version 300 es
      precision highp float;
      in vec3 v_normal; in vec3 v_local; in vec2 v_uv;
      flat in vec4 v_top_color; flat in vec4 v_left_color; flat in vec4 v_right_color; flat in vec4 v_accent_color;
      flat in float v_family; flat in float v_seed;
      out vec4 out_color;

      float hash21(vec2 point){
        point=fract(point*vec2(123.34,456.21));
        point+=dot(point,point+45.32);
        return fract(point.x*point.y);
      }
      float familyIs(float value){ return 1.0-step(.45,abs(v_family-value)); }
      float pixelNoise(float scale, float salt){ return hash21(floor(v_uv*scale)+vec2(v_seed*.013+salt,v_seed*.021-salt)); }

      void main(){
        bool isTop=v_normal.y>.5;
        vec4 base=isTop?v_top_color:(abs(v_normal.x)>.5?(v_normal.x>0.0?v_right_color:v_left_color):(v_normal.z>0.0?v_left_color:v_right_color));
        vec3 color=base.rgb;
        vec3 accent=v_accent_color.rgb;
        float mask=0.0;
        float darkMask=0.0;
        float noise8=pixelNoise(8.0,1.0);
        float noise12=pixelNoise(12.0,4.0);

        if(familyIs(1.0)>.5){
          if(isTop){
            float ring=max(abs(v_uv.x-.5),abs(v_uv.y-.5));
            mask=step(.39,abs(fract(ring*8.0+v_seed*.0007)-.5));
          }else{
            mask=step(.77,fract(v_uv.x*5.0+v_seed*.003));
            darkMask=step(.9,noise12)*.35;
          }
        }else if(familyIs(2.0)>.5){
          mask=step(.60,noise8);
          darkMask=step(noise12,.13)*.28;
        }else if(familyIs(3.0)>.5){
          mask=step(.82,noise12)*.72;
          darkMask=step(noise8,.10)*.35;
        }else if(familyIs(4.0)>.5){
          float vein=step(.67,noise8)*step(.28,noise12);
          mask=vein;
          darkMask=step(noise12,.08)*.24;
        }else if(familyIs(5.0)>.5){
          if(isTop) mask=step(.70,noise12)*.72;
          else mask=step(.24,v_local.y)*.75;
        }else if(familyIs(6.0)>.5){
          mask=step(.82,noise12)*.35;
          darkMask=step(.92,fract((v_uv.y+v_seed*.001)*7.0))*.18;
        }else if(familyIs(7.0)>.5){
          float seams=min(abs(fract(v_uv.x*4.0)-.5),abs(fract(v_uv.y*4.0)-.5));
          darkMask=1.0-smoothstep(.035,.075,seams);
          mask=step(.88,noise12)*.24;
        }else if(familyIs(8.0)>.5){
          float row=floor(v_uv.y*5.0);
          float shifted=fract(v_uv.x*4.0+mod(row,2.0)*.5);
          float mortar=min(abs(fract(v_uv.y*5.0)-.5),abs(shifted-.5));
          darkMask=1.0-smoothstep(.04,.09,mortar);
        }else if(familyIs(9.0)>.5){
          float wave=abs(sin((v_uv.y*5.0+v_uv.x*.7+v_seed*.001)*6.2831));
          mask=step(.84,wave)*.42;
        }else if(familyIs(10.0)>.5){
          mask=step(.88,noise12)*.26;
        }else if(familyIs(11.0)>.5){
          mask=step(.72,noise8);
        }else if(familyIs(12.0)>.5){
          float petal=1.0-smoothstep(.13,.25,length(v_uv-.5));
          mask=max(petal,step(.92,noise12)*.4);
        }else if(familyIs(13.0)>.5){
          float diagonal=abs(fract((v_uv.x+v_uv.y)*3.0+v_seed*.001)-.5);
          mask=1.0-smoothstep(.035,.09,diagonal);
        }else if(familyIs(14.0)>.5){
          mask=step(.76,noise8)*.54;
          darkMask=step(noise12,.11)*.22;
        }else if(familyIs(15.0)>.5){
          mask=step(.77,noise12)*.34;
          darkMask=step(noise8,.09)*.25;
        }else{
          mask=step(.90,noise12)*.22;
        }

        color=mix(color,accent,clamp(mask,0.0,1.0));
        color*=1.0-clamp(darkMask,0.0,.55);
        float edgeDistance=min(min(v_uv.x,1.0-v_uv.x),min(v_uv.y,1.0-v_uv.y));
        color*=mix(.78,1.0,smoothstep(.015,.085,edgeDistance));
        vec3 light=normalize(vec3(-.55,.90,.36));
        float diffuse=max(dot(normalize(v_normal),light),0.0);
        float level=.47+diffuse*.60;
        out_color=vec4(color*level,max(.72,base.a));
      }
    `);
    this.lineProgram = createProgram(gl, `#version 300 es
      in vec3 a_position; uniform mat4 u_matrix; uniform vec3 u_center; uniform float u_scale;
      void main(){ gl_Position=u_matrix*vec4((a_position-u_center)*u_scale,1.0); }
    `, `#version 300 es
      precision highp float; uniform vec4 u_color; out vec4 out_color; void main(){ out_color=u_color; }
    `);
    this.locations = {
      position: gl.getAttribLocation(this.program, 'a_position'), normal: gl.getAttribLocation(this.program, 'a_normal'), uv: gl.getAttribLocation(this.program, 'a_uv'),
      offset: gl.getAttribLocation(this.program, 'a_offset'), topColor: gl.getAttribLocation(this.program, 'a_top_color'), leftColor: gl.getAttribLocation(this.program, 'a_left_color'),
      rightColor: gl.getAttribLocation(this.program, 'a_right_color'), accentColor: gl.getAttribLocation(this.program, 'a_accent_color'),
      family: gl.getAttribLocation(this.program, 'a_family'), seed: gl.getAttribLocation(this.program, 'a_seed'),
      matrix: gl.getUniformLocation(this.program, 'u_matrix'), center: gl.getUniformLocation(this.program, 'u_center'), scale: gl.getUniformLocation(this.program, 'u_scale'),
    };
    this.lineLocations = {
      position: gl.getAttribLocation(this.lineProgram, 'a_position'), matrix: gl.getUniformLocation(this.lineProgram, 'u_matrix'),
      center: gl.getUniformLocation(this.lineProgram, 'u_center'), scale: gl.getUniformLocation(this.lineProgram, 'u_scale'), color: gl.getUniformLocation(this.lineProgram, 'u_color'),
    };
    const cube = cubeGeometry();
    this.vertexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer); gl.bufferData(gl.ARRAY_BUFFER, cube.positions, gl.STATIC_DRAW);
    this.normalBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer); gl.bufferData(gl.ARRAY_BUFFER, cube.normals, gl.STATIC_DRAW);
    this.uvBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer); gl.bufferData(gl.ARRAY_BUFFER, cube.uvs, gl.STATIC_DRAW);
    this.offsetBuffer = gl.createBuffer(); this.materialBuffer = gl.createBuffer(); this.lineBuffer = gl.createBuffer();
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  bind() {
    this.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault(); this.canvas.setPointerCapture(event.pointerId); this.drag = { x: event.clientX, y: event.clientY, mode: event.shiftKey || event.button !== 0 ? 'pan' : 'orbit' };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return; const dx = event.clientX - this.drag.x; const dy = event.clientY - this.drag.y; this.drag.x = event.clientX; this.drag.y = event.clientY;
      if (this.drag.mode === 'orbit') { this.yaw -= dx * .008; this.pitch = clamp(this.pitch - dy * .008, .08, 1.48); }
      else { const factor = this.distance * .0018; this.target[0] -= dx * factor; this.target[1] += dy * factor; }
      this.requestRender();
    });
    const end = (event) => { this.drag = null; try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ } };
    this.canvas.addEventListener('pointerup', end); this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('wheel', (event) => { event.preventDefault(); this.distance = clamp(this.distance * Math.exp(event.deltaY * .001), 1.25, 9); this.requestRender(); }, { passive: false });
    this.resetButton.addEventListener('click', () => this.reset());
    this.gridInput.addEventListener('change', () => this.requestRender()); this.boundsInput.addEventListener('change', () => this.requestRender());
  }

  observe() {
    if ('ResizeObserver' in window) { this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.canvas.parentElement); }
    else window.addEventListener('resize', () => this.resize());
  }

  reset() { this.yaw = -0.72; this.pitch = 0.55; this.distance = 3.4; this.target = [0, 0, 0]; this.requestRender(); }

  clear(message = 'Selecciona una schematic para verla.') {
    this.ready = false; this.data = null; this.instanceCount = 0; this.status.textContent = message; this.requestRender();
  }

  async load(url, label = 'Schematic') {
    if (!this.gl || !url) { this.clear('Esta schematic no tiene vista previa disponible.'); return; }
    this.ready = false; this.status.textContent = `Cargando ${label}…`;
    try {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data?.format !== 'jkr-schematic-preview' || data.version !== 2 || !Array.isArray(data.blocks) || !Array.isArray(data.materials)) throw new Error('Formato de vista previa incompatible. Reinicia el servidor para regenerar la caché.');
      this.data = data; this.center = [data.width / 2, data.height / 2, data.length / 2]; this.scale = 2.05 / Math.max(1, data.width, data.height, data.length);
      const offsets = new Float32Array(data.blocks.length * 3); const materials = new Float32Array(data.blocks.length * 18);
      const fallback = [0, 160,160,160,255, 112,112,112,255, 136,136,136,255, 190,190,190,255, 0];
      data.blocks.forEach((block, index) => {
        offsets.set([Number(block[0]) + .5, Number(block[1]) + .5, Number(block[2]) + .5], index * 3);
        const source = data.materials[Number(block[3])] || fallback;
        const normalized = [
          Number(source[1]) / 255, Number(source[2]) / 255, Number(source[3]) / 255, Number(source[4]) / 255,
          Number(source[5]) / 255, Number(source[6]) / 255, Number(source[7]) / 255, Number(source[8]) / 255,
          Number(source[9]) / 255, Number(source[10]) / 255, Number(source[11]) / 255, Number(source[12]) / 255,
          Number(source[13]) / 255, Number(source[14]) / 255, Number(source[15]) / 255, Number(source[16]) / 255,
          Number(source[0]), Number(source[17]),
        ];
        materials.set(normalized, index * 18);
      });
      const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.offsetBuffer); gl.bufferData(gl.ARRAY_BUFFER, offsets, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.materialBuffer); gl.bufferData(gl.ARRAY_BUFFER, materials, gl.STATIC_DRAW);
      this.instanceCount = data.blocks.length; this.buildLines(); this.ready = true; this.reset();
      this.status.textContent = `${data.width}×${data.height}×${data.length} · ${Number(data.block_count).toLocaleString('es-CL')} bloques${data.sampled ? ` · muestra de ${Number(data.displayed_blocks).toLocaleString('es-CL')}` : ''}. Materiales Minecraft simplificados · arrastra para rotar; Shift+arrastre para mover.`;
      this.resize();
    } catch (error) { this.clear(`No se pudo cargar la vista previa: ${error.message}`); }
  }

  buildLines() {
    const { width: w, height: h, length: l } = this.data; const lines = [];
    const edge = (a, b) => lines.push(...a, ...b);
    for (const y of [0, h]) for (const z of [0, l]) edge([0, y, z], [w, y, z]);
    for (const y of [0, h]) for (const x of [0, w]) edge([x, y, 0], [x, y, l]);
    for (const x of [0, w]) for (const z of [0, l]) edge([x, 0, z], [x, h, z]);
    this.boundsStart = 0; this.boundsCount = lines.length / 3;
    const step = Math.max(1, Math.ceil(Math.max(w, l) / 20));
    this.gridStart = this.boundsCount;
    for (let x = 0; x <= w; x += step) edge([x, 0, 0], [x, 0, l]);
    for (let z = 0; z <= l; z += step) edge([0, 0, z], [w, 0, z]);
    this.gridCount = lines.length / 3 - this.gridStart;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.lineBuffer); this.gl.bufferData(this.gl.ARRAY_BUFFER, new Float32Array(lines), this.gl.STATIC_DRAW);
  }

  resize() {
    if (!this.gl) return; const ratio = Math.min(2, window.devicePixelRatio || 1); const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio)); const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.gl.viewport(0, 0, width, height); this.requestRender();
  }

  requestRender() { if (this.frame) return; this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); }); }

  matrix() {
    const aspect = Math.max(.1, this.canvas.width / Math.max(1, this.canvas.height)); const projection = perspective(Math.PI / 4, aspect, .05, 100);
    const cp = Math.cos(this.pitch); const eye = [this.target[0] + Math.cos(this.yaw) * cp * this.distance, this.target[1] + Math.sin(this.pitch) * this.distance, this.target[2] + Math.sin(this.yaw) * cp * this.distance];
    return multiply(projection, lookAt(eye, this.target, [0, 1, 0]));
  }

  render() {
    if (!this.gl) return; const gl = this.gl; gl.clearColor(.035, .05, .041, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); if (!this.ready) return;
    const matrix = this.matrix(); gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locations.matrix, false, matrix); gl.uniform3fv(this.locations.center, this.center); gl.uniform1f(this.locations.scale, this.scale);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer); gl.enableVertexAttribArray(this.locations.position); gl.vertexAttribPointer(this.locations.position, 3, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(this.locations.position, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer); gl.enableVertexAttribArray(this.locations.normal); gl.vertexAttribPointer(this.locations.normal, 3, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(this.locations.normal, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer); gl.enableVertexAttribArray(this.locations.uv); gl.vertexAttribPointer(this.locations.uv, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(this.locations.uv, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.offsetBuffer); gl.enableVertexAttribArray(this.locations.offset); gl.vertexAttribPointer(this.locations.offset, 3, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(this.locations.offset, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.materialBuffer);
    const stride = 18 * 4;
    const instanceAttribute = (location, size, offset) => { gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4); gl.vertexAttribDivisor(location, 1); };
    instanceAttribute(this.locations.topColor, 4, 0); instanceAttribute(this.locations.leftColor, 4, 4); instanceAttribute(this.locations.rightColor, 4, 8); instanceAttribute(this.locations.accentColor, 4, 12);
    instanceAttribute(this.locations.family, 1, 16); instanceAttribute(this.locations.seed, 1, 17);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.instanceCount);
    gl.useProgram(this.lineProgram); gl.uniformMatrix4fv(this.lineLocations.matrix, false, matrix); gl.uniform3fv(this.lineLocations.center, this.center); gl.uniform1f(this.lineLocations.scale, this.scale);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer); gl.enableVertexAttribArray(this.lineLocations.position); gl.vertexAttribPointer(this.lineLocations.position, 3, gl.FLOAT, false, 0, 0);
    if (this.boundsInput.checked) { gl.uniform4f(this.lineLocations.color, .62, .76, .66, .85); gl.drawArrays(gl.LINES, this.boundsStart, this.boundsCount); }
    if (this.gridInput.checked) { gl.uniform4f(this.lineLocations.color, .28, .38, .31, .62); gl.drawArrays(gl.LINES, this.gridStart, this.gridCount); }
  }
}

export class StructureLibraryManager {
  constructor(editor) {
    this.editor = editor; this.modal = byId('structure-library-modal'); this.gallery = byId('structure-library-gallery'); this.tree = byId('structure-library-tree');
    this.selectedCollectionId = null; this.selectedAssetIds = new Set(); this.focusedAssetId = null; this.viewMode = 'grid'; this.lastFocusedBeforeOpen = null;
    this.viewer = new SchematicPreviewViewer({ canvas: byId('structure-library-preview-canvas'), status: byId('structure-library-preview-status'), resetButton: byId('structure-library-preview-reset'), gridInput: byId('structure-library-preview-grid'), boundsInput: byId('structure-library-preview-bounds') });
    this.bind();
  }

  bind() {
    byId('structure-library-open').addEventListener('click', () => this.open());
    byId('structure-library-close').addEventListener('click', () => this.close()); byId('structure-library-footer-close').addEventListener('click', () => this.close());
    byId('structure-library-create').addEventListener('click', () => this.createCollection());
    byId('structure-library-collection-save').addEventListener('click', () => this.saveCollection());
    byId('structure-library-collection-delete').addEventListener('click', () => this.deleteCollection());
    byId('structure-library-import-files').addEventListener('change', (event) => this.importFiles([...(event.target.files || [])]));
    byId('structure-library-search').addEventListener('input', () => this.renderGallery());
    byId('structure-library-thumbnail-size').addEventListener('input', () => this.updateThumbnailSize());
    document.querySelectorAll('[data-structure-view]').forEach((button) => button.addEventListener('click', () => this.setView(button.dataset.structureView)));
    byId('structure-library-asset-save').addEventListener('click', () => this.saveAsset());
    byId('structure-library-move').addEventListener('click', () => this.moveSelected());
    byId('structure-library-delete-assets').addEventListener('click', () => this.deleteSelected());
    byId('structure-library-use-collection').addEventListener('click', () => this.useCollection());
    byId('structure-library-use-asset').addEventListener('click', () => this.useAsset());
    byId('structure-use-collection-source').addEventListener('click', () => { this.editor.activeStructureAssetId = null; this.editor.updateStructureUi(); this.editor.renderOverlay(); });
    const dropzone = byId('structure-library-dropzone');
    for (const eventName of ['dragenter', 'dragover']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add('dragging'); });
    for (const eventName of ['dragleave', 'drop']) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove('dragging'); });
    dropzone.addEventListener('drop', (event) => this.importFiles([...event.dataTransfer.files].filter((file) => file.name.toLowerCase().endsWith('.schem'))));
    this.modal.addEventListener('pointerdown', (event) => { if (event.target === this.modal) this.close(); });
    document.addEventListener('keydown', (event) => this.onKeyDown(event));
  }

  open() {
    this.lastFocusedBeforeOpen = document.activeElement; this.modal.hidden = false; document.body.classList.add('structure-library-open');
    const active = this.editor.activeStructureCollection();
    this.selectedCollectionId = active?.id || this.selectedCollectionId || this.editor.structureCollections[0]?.id || null;
    this.selectedAssetIds.clear(); this.focusedAssetId = null; this.refresh(); byId('structure-library-search').focus(); setTimeout(() => this.viewer.resize(), 0);
  }

  close() { if (this.modal.hidden) return; this.modal.hidden = true; document.body.classList.remove('structure-library-open'); this.lastFocusedBeforeOpen?.focus?.(); }

  isOpen() { return !this.modal.hidden; }

  collection() { return this.editor.structureCollections.find((item) => item.id === this.selectedCollectionId) || null; }
  asset(assetId) { return this.editor.structureAssets.find((item) => item.id === assetId) || null; }
  member(assetId) { return this.collection()?.members?.find((item) => item.asset_id === assetId) || null; }
  assetsInCollection() { const collection = this.collection(); return collection ? collection.members.map((member) => this.asset(member.asset_id)).filter(Boolean) : []; }

  refresh() {
    if (this.selectedCollectionId && !this.editor.structureCollections.some((item) => item.id === this.selectedCollectionId)) this.selectedCollectionId = this.editor.structureCollections[0]?.id || null;
    this.renderTree(); this.renderCollectionEditor(); this.renderGallery(); this.renderMoveTargets(); this.updateSelectionUi(); this.editor.updateStructureUi();
  }

  renderTree() {
    this.tree.replaceChildren();
    for (const category of [{ id: 'tree', label: 'Árboles', icon: '🌲' }, { id: 'rock', label: 'Rocas', icon: '🪨' }]) {
      const group = document.createElement('section'); group.className = 'structure-tree-group';
      const heading = document.createElement('div'); heading.className = 'structure-tree-heading';
      const collections = this.editor.structureCollections.filter((item) => item.category === category.id);
      heading.innerHTML = `<span>${category.icon} ${category.label}</span><b>${collections.length}</b>`; group.append(heading);
      if (!collections.length) { const empty = document.createElement('div'); empty.className = 'structure-tree-empty'; empty.textContent = 'Sin colecciones'; group.append(empty); }
      for (const collection of collections) {
        const button = document.createElement('button'); button.type = 'button'; button.className = collection.id === this.selectedCollectionId ? 'active' : '';
        const name = document.createElement('span'); name.textContent = collection.label;
        const count = document.createElement('small'); count.textContent = String(collection.members?.length || 0);
        button.append(name, count); button.addEventListener('click', () => this.selectCollection(collection.id)); group.append(button);
      }
      this.tree.append(group);
    }
  }

  selectCollection(id) { this.selectedCollectionId = id; this.selectedAssetIds.clear(); this.focusedAssetId = null; this.refresh(); this.viewer.clear(); }

  renderCollectionEditor() {
    const collection = this.collection(); const label = byId('structure-library-collection-label'); const category = byId('structure-library-collection-category');
    label.disabled = !collection; category.disabled = !collection; byId('structure-library-collection-save').disabled = !collection; byId('structure-library-collection-delete').disabled = !collection;
    label.value = collection?.label || ''; category.value = collection?.category || 'tree'; byId('structure-library-use-collection').disabled = !collection || !(collection.members?.length);
  }

  renderGallery() {
    this.gallery.replaceChildren(); this.gallery.classList.toggle('list-view', this.viewMode === 'list');
    const collection = this.collection(); if (!collection) { this.gallery.innerHTML = '<div class="empty-list">Selecciona o crea una colección.</div>'; return; }
    const query = byId('structure-library-search').value.trim().toLocaleLowerCase('es');
    const assets = this.assetsInCollection().filter((asset) => !query || `${asset.label} ${asset.filename || ''}`.toLocaleLowerCase('es').includes(query));
    if (!assets.length) { this.gallery.innerHTML = `<div class="empty-list">${query ? 'No hay coincidencias.' : 'Importa uno o más archivos .schem.'}</div>`; return; }
    for (const asset of assets) {
      const card = document.createElement('button'); card.type = 'button'; card.className = `structure-asset-card${this.selectedAssetIds.has(asset.id) ? ' selected' : ''}`; card.dataset.assetId = asset.id;
      const image = document.createElement('img'); image.alt = `Miniatura de ${asset.label}`; image.loading = 'lazy'; image.src = asset.thumbnail_url || `/api/library/structures/assets/${encodeURIComponent(asset.id)}/thumbnail`;
      image.addEventListener('error', () => { image.removeAttribute('src'); image.classList.add('missing'); });
      const info = document.createElement('span'); info.className = 'structure-card-info'; info.innerHTML = `<strong></strong><small>${asset.width}×${asset.height}×${asset.length} · ${Number(asset.block_count || 0).toLocaleString('es-CL')}</small>`; info.querySelector('strong').textContent = asset.label;
      const mark = document.createElement('span'); mark.className = 'structure-card-check'; mark.textContent = '✓'; card.append(image, info, mark);
      card.addEventListener('click', (event) => this.selectAsset(asset.id, event.ctrlKey || event.metaKey || event.shiftKey));
      card.addEventListener('dblclick', () => { this.selectAsset(asset.id, false); this.useAsset(); }); this.gallery.append(card);
    }
  }

  selectAsset(assetId, additive = false) {
    if (!additive) this.selectedAssetIds.clear();
    if (additive && this.selectedAssetIds.has(assetId)) this.selectedAssetIds.delete(assetId); else this.selectedAssetIds.add(assetId);
    this.focusedAssetId = this.selectedAssetIds.has(assetId) ? assetId : [...this.selectedAssetIds].at(-1) || null;
    this.renderGallery(); this.updateSelectionUi(); this.showFocusedAsset();
  }

  showFocusedAsset() {
    const asset = this.asset(this.focusedAssetId); const member = asset ? this.member(asset.id) : null; const fields = ['structure-library-asset-label','structure-library-asset-weight','structure-library-anchor-x','structure-library-anchor-y','structure-library-anchor-z'];
    fields.forEach((id) => { byId(id).disabled = !asset || this.selectedAssetIds.size !== 1; }); byId('structure-library-asset-save').disabled = !asset || this.selectedAssetIds.size !== 1;
    if (!asset) { byId('structure-library-asset-label').value = ''; byId('structure-library-asset-metadata').textContent = 'Sin selección.'; this.viewer.clear(); return; }
    byId('structure-library-asset-label').value = asset.label; byId('structure-library-asset-weight').value = String(member?.weight || 100);
    for (const [id, key, max] of [['structure-library-anchor-x','anchor_x',asset.width-1],['structure-library-anchor-y','anchor_y',asset.height-1],['structure-library-anchor-z','anchor_z',asset.length-1]]) { const input = byId(id); input.max = String(Math.max(0, max)); input.value = String(asset[key] || 0); }
    byId('structure-library-asset-metadata').textContent = `${asset.width} × ${asset.height} × ${asset.length} · ${Number(asset.block_count || 0).toLocaleString('es-CL')} bloques · ${asset.filename || 'archivo .schem'}`;
    this.viewer.load(asset.preview_url || `/api/library/structures/assets/${encodeURIComponent(asset.id)}/preview`, asset.label);
  }

  updateSelectionUi() {
    const count = this.selectedAssetIds.size; byId('structure-library-selection-summary').textContent = `${count} elemento${count === 1 ? '' : 's'} seleccionado${count === 1 ? '' : 's'}`;
    byId('structure-library-use-asset').disabled = count !== 1; byId('structure-library-delete-assets').disabled = count === 0; byId('structure-library-move').disabled = count === 0 || !byId('structure-library-move-target').value;
  }

  renderMoveTargets() {
    const select = byId('structure-library-move-target'); const current = select.value; select.replaceChildren();
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Selecciona destino'; select.append(placeholder);
    for (const collection of this.editor.structureCollections.filter((item) => item.id !== this.selectedCollectionId)) { const option = document.createElement('option'); option.value = collection.id; option.textContent = `${collection.category === 'rock' ? '🪨' : '🌲'} ${collection.label}`; select.append(option); }
    if ([...select.options].some((option) => option.value === current)) select.value = current;
    select.onchange = () => this.updateSelectionUi();
  }

  setView(mode) { this.viewMode = mode === 'list' ? 'list' : 'grid'; document.querySelectorAll('[data-structure-view]').forEach((button) => button.classList.toggle('active', button.dataset.structureView === this.viewMode)); this.renderGallery(); }
  updateThumbnailSize() { this.gallery.style.setProperty('--structure-card-size', `${byId('structure-library-thumbnail-size').value}px`); }
  progress(text = '') { byId('structure-library-progress').textContent = text; }

  async createCollection() {
    const label = byId('structure-library-new-name').value.trim(); if (!label) { this.editor.message('Escribe un nombre para la colección.', true); return; }
    try {
      const collection = await this.editor.apiJson('/api/library/structures/collections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, category: byId('structure-library-new-category').value }) });
      this.editor.structureCollections.push(collection); this.editor.libraryCollectionIds.add(collection.id); byId('structure-library-new-name').value = ''; this.selectedCollectionId = collection.id; this.editor.refreshStructureCollectionSelect(collection.id); this.editor.markDirty(); this.refresh();
    } catch (error) { this.editor.message(`No se pudo crear la colección: ${error.message}`, true); }
  }

  async saveCollection() {
    const collection = this.collection(); if (!collection) return; const patch = { label: byId('structure-library-collection-label').value.trim(), category: byId('structure-library-collection-category').value };
    if (!patch.label) { this.editor.message('La colección necesita un nombre.', true); return; }
    try {
      const updated = await this.editor.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
      Object.assign(collection, updated); for (const member of collection.members || []) { const asset = this.asset(member.asset_id); if (asset) asset.category = collection.category; }
      this.editor.refreshStructureCollectionSelect(collection.id); this.editor.markDirty(); this.refresh(); this.editor.message('Colección actualizada.');
    } catch (error) { this.editor.message(`No se pudo actualizar la colección: ${error.message}`, true); }
  }

  async deleteCollection() {
    const collection = this.collection(); if (!collection || !confirm(`¿Eliminar «${collection.label}» y sus schematics?`)) return;
    try {
      await this.editor.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}`, { method: 'DELETE' }); const assetIds = new Set(collection.members.map((item) => item.asset_id));
      this.editor.structureCollections = this.editor.structureCollections.filter((item) => item.id !== collection.id); this.editor.libraryCollectionIds.delete(collection.id); this.editor.structurePlacements = this.editor.structurePlacements.filter((item) => item.collection_id !== collection.id);
      const used = new Set(this.editor.structureCollections.flatMap((item) => item.members.map((member) => member.asset_id))); this.editor.structureAssets = this.editor.structureAssets.filter((item) => !assetIds.has(item.id) || used.has(item.id));
      this.selectedCollectionId = this.editor.structureCollections[0]?.id || null; this.selectedAssetIds.clear(); this.focusedAssetId = null; this.editor.refreshStructureCollectionSelect(this.selectedCollectionId); this.editor.markDirty(); this.refresh(); this.editor.render();
    } catch (error) { this.editor.message(`No se pudo eliminar la colección: ${error.message}`, true); }
  }

  async importFiles(files) {
    const collection = this.collection(); byId('structure-library-import-files').value = '';
    if (!collection) { this.editor.message('Selecciona o crea una colección.', true); return; }
    const schematics = files.filter((file) => file.name.toLowerCase().endsWith('.schem')); if (!schematics.length) return;
    let imported = 0;
    for (let index = 0; index < schematics.length; index += 1) {
      const file = schematics[index]; this.progress(`Importando ${index + 1} de ${schematics.length}: ${file.name}`);
      try {
        const form = new FormData(); form.append('file', file); const payload = await this.editor.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}/assets`, { method: 'POST', body: form });
        const assetIndex = this.editor.structureAssets.findIndex((item) => item.id === payload.asset.id); if (assetIndex >= 0) this.editor.structureAssets[assetIndex] = payload.asset; else this.editor.structureAssets.push(payload.asset);
        const collectionIndex = this.editor.structureCollections.findIndex((item) => item.id === collection.id); if (collectionIndex >= 0) this.editor.structureCollections[collectionIndex] = payload.collection; imported += 1;
      } catch (error) { this.editor.message(`No se pudo importar ${file.name}: ${error.message}`, true); }
    }
    this.progress(''); this.editor.refreshStructureCollectionSelect(collection.id); this.editor.markDirty(); this.refresh(); if (imported) this.editor.message(`${imported} schematic${imported === 1 ? '' : 's'} importado${imported === 1 ? '' : 's'} en «${collection.label}».`);
  }

  async saveAsset() {
    if (this.selectedAssetIds.size !== 1) return; const asset = this.asset([...this.selectedAssetIds][0]); const collection = this.collection(); const member = this.member(asset.id); if (!asset || !collection || !member) return;
    const patch = { label: byId('structure-library-asset-label').value.trim(), anchor_x: Math.round(clamp(byId('structure-library-anchor-x').value, 0, asset.width - 1)), anchor_y: Math.round(clamp(byId('structure-library-anchor-y').value, 0, asset.height - 1)), anchor_z: Math.round(clamp(byId('structure-library-anchor-z').value, 0, asset.length - 1)) };
    try {
      const updated = await this.editor.apiJson(`/api/library/structures/assets/${encodeURIComponent(asset.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }); Object.assign(asset, updated);
      member.weight = Math.round(clamp(byId('structure-library-asset-weight').value, 1, 10000)); await this.editor.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}/members/${encodeURIComponent(asset.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight: member.weight }) });
      this.editor.markDirty(); this.renderGallery(); this.showFocusedAsset(); this.editor.updateStructureUi(); this.editor.message('Schematic actualizado.');
    } catch (error) { this.editor.message(`No se pudo guardar el schematic: ${error.message}`, true); }
  }

  async moveSelected() {
    const source = this.collection(); const targetId = byId('structure-library-move-target').value; const assetIds = [...this.selectedAssetIds]; if (!source || !targetId || !assetIds.length) return;
    try {
      const payload = await this.editor.apiJson(`/api/library/structures/collections/${encodeURIComponent(source.id)}/move-assets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target_collection_id: targetId, asset_ids: assetIds }) });
      const sourceIndex = this.editor.structureCollections.findIndex((item) => item.id === source.id); const targetIndex = this.editor.structureCollections.findIndex((item) => item.id === targetId); if (sourceIndex >= 0) this.editor.structureCollections[sourceIndex] = payload.source; if (targetIndex >= 0) this.editor.structureCollections[targetIndex] = payload.target;
      for (const id of payload.moved || []) { const asset = this.asset(id); if (asset) asset.category = payload.target.category; }
      this.editor.structurePlacements = this.editor.structurePlacements.map((item) => assetIds.includes(item.asset_id) && item.collection_id === source.id ? { ...item, collection_id: targetId } : item);
      this.selectedAssetIds.clear(); this.focusedAssetId = null; this.editor.refreshStructureCollectionSelect(source.id); this.editor.markDirty(); this.refresh(); this.viewer.clear();
    } catch (error) { this.editor.message(`No se pudieron mover los schematics: ${error.message}`, true); }
  }

  async deleteSelected() {
    const collection = this.collection(); const ids = [...this.selectedAssetIds]; if (!collection || !ids.length || !confirm(`¿Eliminar ${ids.length} schematic${ids.length === 1 ? '' : 's'} y sus instancias?`)) return;
    let removed = 0;
    for (const assetId of ids) {
      try { await this.editor.apiJson(`/api/library/structures/collections/${encodeURIComponent(collection.id)}/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }); collection.members = collection.members.filter((item) => item.asset_id !== assetId); this.editor.structurePlacements = this.editor.structurePlacements.filter((item) => item.asset_id !== assetId); removed += 1; } catch (error) { this.editor.message(`No se pudo eliminar un schematic: ${error.message}`, true); }
    }
    const used = new Set(this.editor.structureCollections.flatMap((item) => item.members.map((member) => member.asset_id))); this.editor.structureAssets = this.editor.structureAssets.filter((item) => used.has(item.id)); this.selectedAssetIds.clear(); this.focusedAssetId = null; this.editor.refreshStructureCollectionSelect(collection.id); this.editor.markDirty(); this.refresh(); this.viewer.clear(); this.editor.render(); if (removed) this.editor.message(`${removed} schematic${removed === 1 ? '' : 's'} eliminado${removed === 1 ? '' : 's'}.`);
  }

  useCollection() {
    const collection = this.collection(); if (!collection) return; this.editor.refreshStructureCollectionSelect(collection.id); this.editor.activeStructureAssetId = null; this.editor.updateStructureUi(); this.editor.renderOverlay(); this.close(); this.editor.message(`Colección «${collection.label}» lista para pintar.`);
  }

  useAsset() {
    if (this.selectedAssetIds.size !== 1) return; const assetId = [...this.selectedAssetIds][0]; const collection = this.collection(); const asset = this.asset(assetId); if (!collection || !asset) return;
    this.editor.refreshStructureCollectionSelect(collection.id); this.editor.activeStructureAssetId = assetId; this.editor.updateStructureUi(); this.editor.renderOverlay(); this.close(); this.editor.message(`Schematic «${asset.label}» seleccionado como fuente.`);
  }

  onKeyDown(event) {
    if (!this.isOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const assets = this.assetsInCollection().filter((asset) => {
      const query = byId('structure-library-search').value.trim().toLocaleLowerCase('es'); return !query || `${asset.label} ${asset.filename || ''}`.toLocaleLowerCase('es').includes(query);
    });
    if (!assets.length || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return; event.preventDefault();
    const current = Math.max(0, assets.findIndex((item) => item.id === this.focusedAssetId)); const columns = this.viewMode === 'list' ? 1 : Math.max(1, Math.floor(this.gallery.clientWidth / (Number(byId('structure-library-thumbnail-size').value) + 14)));
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : columns; const next = assets[clamp(current + delta, 0, assets.length - 1)]; this.selectAsset(next.id, false); this.gallery.querySelector(`[data-asset-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
}
