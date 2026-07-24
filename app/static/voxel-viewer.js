const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const normalize = (vector) => {
  const length = Math.hypot(...vector) || 1;
  return vector.map((value) => value / length);
};

function perspective(fieldOfView, aspect, near, far) {
  const f = 1 / Math.tan(fieldOfView / 2); const range = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * range, -1,
    0, 0, near * far * range * 2, 0,
  ]);
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
    const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message || 'No se pudo compilar el shader voxel.');
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    in vec3 a_position; in vec3 a_normal; in vec4 a_color;
    uniform mat4 u_matrix; out vec3 v_normal; out vec4 v_color;
    void main(){ gl_Position=u_matrix*vec4(a_position,1.0); v_normal=a_normal; v_color=a_color; }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; in vec3 v_normal; in vec4 v_color; out vec4 out_color;
    void main(){ vec3 light=normalize(vec3(-0.45,0.90,0.35)); float diffuse=max(dot(normalize(v_normal),light),0.0); float level=0.48+diffuse*0.60; out_color=vec4(v_color.rgb*level,v_color.a); }
  `);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'No se pudo enlazar el shader voxel.');
  return program;
}

function createLineProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    in vec3 a_position; uniform mat4 u_matrix; void main(){ gl_Position=u_matrix*vec4(a_position,1.0); }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; uniform vec4 u_color; out vec4 out_color; void main(){ out_color=u_color; }
  `);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'No se pudo enlazar el shader de bordes.');
  return program;
}

const FACES = {
  top: { normal: [0, 1, 0], corners: (x, y, z) => [[x,y+1,z],[x+1,y+1,z],[x+1,y+1,z+1],[x,y+1,z+1]] },
  bottom: { normal: [0, -1, 0], corners: (x, y, z) => [[x,y,z+1],[x+1,y,z+1],[x+1,y,z],[x,y,z]] },
  north: { normal: [0, 0, -1], corners: (x, y, z) => [[x,y,z],[x,y+1,z],[x+1,y+1,z],[x+1,y,z]] },
  south: { normal: [0, 0, 1], corners: (x, y, z) => [[x+1,y,z+1],[x+1,y+1,z+1],[x,y+1,z+1],[x,y,z+1]] },
  west: { normal: [-1, 0, 0], corners: (x, y, z) => [[x,y,z+1],[x,y+1,z+1],[x,y+1,z],[x,y,z]] },
  east: { normal: [1, 0, 0], corners: (x, y, z) => [[x+1,y,z],[x+1,y+1,z],[x+1,y+1,z+1],[x+1,y,z+1]] },
};
const TRIANGLE_ORDER = [0, 1, 2, 0, 2, 3];
const EDGE_ORDER = [0,1,1,2,2,3,3,0];

function pushFace(target, lines, face, x, y, z, color) {
  const corners = face.corners(x, y, z);
  for (const index of TRIANGLE_ORDER) {
    target.positions.push(...corners[index]); target.normals.push(...face.normal); target.colors.push(...color);
  }
  for (const index of EDGE_ORDER) lines.push(...corners[index]);
}

export class VoxelTerrainViewer {
  constructor({ canvas, status, resetButton, expandButton, modeInput, renderDistanceInput, renderDistanceValue, edgesInput, waterInput, cutInput, cutValue }) {
    this.canvas = canvas; this.status = status; this.resetButton = resetButton; this.expandButton = expandButton; this.modeInput = modeInput;
    this.renderDistanceInput = renderDistanceInput; this.renderDistanceValue = renderDistanceValue; this.edgesInput = edgesInput; this.waterInput = waterInput;
    this.cutInput = cutInput; this.cutValue = cutValue; this.view = canvas.closest('.voxel-3d-view');
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    this.manifest = null; this.currentUrl = null; this.palette = new Map(); this.chunks = new Map(); this.loading = new Set(); this.generation = 0;
    this.yaw = -0.75; this.pitch = 0.55; this.distance = 96; this.target = [0, 40, 0]; this.position = [0, 55, 0];
    this.drag = null; this.keys = new Set(); this.lastFrame = performance.now(); this.frameRequested = false; this.animationFrame = null;
    this.remeshTimer = null; this.lastChunkCenter = null;
    if (!this.gl) { this.status.textContent = 'Este navegador no ofrece WebGL 2. La vista 2D sigue disponible.'; return; }
    try {
      this.program = createProgram(this.gl); this.lineProgram = createLineProgram(this.gl); this.cacheLocations(); this.bindEvents(); this.observeSize();
    } catch (error) { this.status.textContent = `No se pudo iniciar la vista Minecraft: ${error.message}`; }
  }

  cacheLocations() {
    const gl = this.gl;
    this.locations = {
      position: gl.getAttribLocation(this.program, 'a_position'), normal: gl.getAttribLocation(this.program, 'a_normal'), color: gl.getAttribLocation(this.program, 'a_color'),
      matrix: gl.getUniformLocation(this.program, 'u_matrix'), linePosition: gl.getAttribLocation(this.lineProgram, 'a_position'),
      lineMatrix: gl.getUniformLocation(this.lineProgram, 'u_matrix'), lineColor: gl.getUniformLocation(this.lineProgram, 'u_color'),
    };
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.modeInput.value === 'first-person') { this.canvas.requestPointerLock?.(); return; }
      this.canvas.setPointerCapture(event.pointerId); this.drag = { x: event.clientX, y: event.clientY, mode: event.shiftKey || event.button !== 0 ? 'pan' : 'orbit' };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag || this.modeInput.value !== 'orbit') return;
      const dx = event.clientX - this.drag.x; const dy = event.clientY - this.drag.y; this.drag.x = event.clientX; this.drag.y = event.clientY;
      if (this.drag.mode === 'orbit') { this.yaw -= dx * 0.008; this.pitch = clamp(this.pitch - dy * 0.008, -0.05, 1.48); }
      else {
        const factor = Math.max(0.08, this.distance * 0.0016); const rightX = Math.cos(this.yaw); const rightZ = -Math.sin(this.yaw);
        const forwardX = Math.sin(this.yaw); const forwardZ = Math.cos(this.yaw);
        this.target[0] -= rightX * dx * factor + forwardX * dy * factor; this.target[2] -= rightZ * dx * factor + forwardZ * dy * factor;
        this.scheduleChunkUpdate();
      }
      this.requestRender();
    });
    const end = (event) => { this.drag = null; try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ } };
    this.canvas.addEventListener('pointerup', end); this.canvas.addEventListener('pointercancel', end); this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      if (this.modeInput.value === 'orbit') this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.001), 12, this.maximumDimension() * 2.5);
      else this.firstPersonSpeed = clamp((this.firstPersonSpeed || 18) * Math.exp(-event.deltaY * 0.001), 2, 120);
      this.requestRender();
    }, { passive: false });
    document.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement !== this.canvas || this.modeInput.value !== 'first-person') return;
      this.yaw -= event.movementX * 0.0025; this.pitch = clamp(this.pitch - event.movementY * 0.0025, -1.48, 1.48); this.requestRender();
    });
    document.addEventListener('keydown', (event) => {
      if (this.modeInput.value === 'first-person' && ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight'].includes(event.code)) { event.preventDefault(); this.keys.add(event.code); this.startAnimation(); }
      if (event.key === 'Escape' && this.view?.classList.contains('is-expanded')) this.setExpanded(false);
    });
    document.addEventListener('keyup', (event) => this.keys.delete(event.code));
    this.resetButton.addEventListener('click', () => this.resetCamera());
    this.expandButton.addEventListener('click', () => this.setExpanded(!this.view?.classList.contains('is-expanded')));
    this.modeInput.addEventListener('change', () => { if (document.pointerLockElement === this.canvas) document.exitPointerLock?.(); this.resetCamera(); this.updateStatus(); });
    this.renderDistanceInput.addEventListener('input', () => { this.renderDistanceValue.textContent = `${this.renderDistanceInput.value} chunks`; try { localStorage.setItem('jkr-voxel-render-distance', this.renderDistanceInput.value); } catch (_) { /* no-op */ } this.updateChunks(true); });
    this.edgesInput.addEventListener('change', () => this.requestRender());
    this.waterInput.addEventListener('change', () => this.remeshLoadedChunks());
    this.cutInput.addEventListener('input', () => {
      this.cutValue.textContent = `Y ${this.cutInput.value}`; clearTimeout(this.remeshTimer); this.remeshTimer = setTimeout(() => this.remeshLoadedChunks(), 80);
    });
  }

  observeSize() {
    if ('ResizeObserver' in window) { this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.canvas.parentElement); }
    else window.addEventListener('resize', () => this.resize());
  }

  maximumDimension() { return Math.max(this.manifest?.width || 128, this.manifest?.length || 128, this.manifest?.schematic_height || 128); }

  setExpanded(expanded) {
    if (!this.view) return;
    this.view.classList.toggle('is-expanded', Boolean(expanded)); document.body.classList.toggle('voxel-3d-open', Boolean(expanded));
    this.expandButton.textContent = expanded ? 'Cerrar' : 'Ampliar'; this.expandButton.setAttribute('aria-pressed', String(Boolean(expanded))); setTimeout(() => this.resize(), 0);
  }

  resetCamera() {
    if (!this.manifest) return;
    const centerX = this.manifest.width / 2; const centerZ = this.manifest.length / 2; const centerY = (this.manifest.min_height + this.manifest.max_height) / 2;
    this.yaw = -0.75; this.pitch = 0.55; this.target = [centerX, centerY, centerZ];
    this.distance = Math.max(48, Number(this.renderDistanceInput.value) * this.manifest.chunk_size * 2.2);
    this.position = [centerX, Math.min(this.manifest.schematic_height - 2, centerY + 18), centerZ + this.manifest.chunk_size * 1.5]; this.firstPersonSpeed = 18;
    this.lastChunkCenter = null; this.updateChunks(true); this.requestRender();
  }

  async load(url) {
    if (!this.gl || !url) return;
    if (this.currentUrl === url && this.manifest) { this.resize(); return; }
    this.currentUrl = url; this.generation += 1; const generation = this.generation; this.status.textContent = 'Cargando manifiesto de bloques…'; this.clearChunks();
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json(); this.validateManifest(manifest); if (generation !== this.generation) return;
      this.manifest = manifest; this.palette = new Map(manifest.palette.map((item) => [Number(item.id), item]));
      this.renderDistanceInput.max = String(manifest.controls.maximum_render_distance || 16); let preferredDistance = manifest.controls.default_render_distance || 4; try { preferredDistance = Number(localStorage.getItem('jkr-voxel-render-distance')) || preferredDistance; } catch (_) { /* no-op */ } this.renderDistanceInput.value = String(clamp(preferredDistance, Number(this.renderDistanceInput.min || 1), Number(this.renderDistanceInput.max)));
      this.renderDistanceValue.textContent = `${this.renderDistanceInput.value} chunks`;
      this.cutInput.min = '0'; this.cutInput.max = String(manifest.schematic_height - 1); this.cutInput.value = String(manifest.controls.default_cut_y ?? manifest.schematic_height - 1); this.cutValue.textContent = `Y ${this.cutInput.value}`;
      this.resetCamera(); this.resize(); this.updateStatus();
    } catch (error) { this.status.textContent = `No se pudo cargar la vista Minecraft: ${error.message}`; }
  }

  validateManifest(data) {
    if (data?.format !== 'jkr-voxel-preview' || ![1, 2].includes(data.version)) throw new Error('Formato voxel incompatible.');
    for (const key of ['width','length','schematic_height','chunk_size','chunks_x','chunks_z','chunk_url','palette']) if (data[key] === undefined) throw new Error(`Manifiesto voxel incompleto: ${key}.`);
  }

  chunkCenter() {
    if (!this.manifest) return [0, 0]; const source = this.modeInput.value === 'first-person' ? this.position : this.target;
    return [clamp(Math.floor(source[0] / this.manifest.chunk_size), 0, this.manifest.chunks_x - 1), clamp(Math.floor(source[2] / this.manifest.chunk_size), 0, this.manifest.chunks_z - 1)];
  }

  scheduleChunkUpdate() { clearTimeout(this.chunkTimer); this.chunkTimer = setTimeout(() => this.updateChunks(), 60); }

  async updateChunks(force = false) {
    if (!this.manifest) return;
    const [centerX, centerZ] = this.chunkCenter(); const radius = Number(this.renderDistanceInput.value);
    if (!force && this.lastChunkCenter && this.lastChunkCenter[0] === centerX && this.lastChunkCenter[1] === centerZ) return;
    this.lastChunkCenter = [centerX, centerZ]; const wanted = new Set(); const requests = [];
    for (let dz = -radius; dz <= radius; dz += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const x = centerX + dx; const z = centerZ + dz; if (x < 0 || z < 0 || x >= this.manifest.chunks_x || z >= this.manifest.chunks_z) continue;
      const key = `${x},${z}`; wanted.add(key); if (!this.chunks.has(key) && !this.loading.has(key)) requests.push({ x, z, key, distance: dx * dx + dz * dz });
    }
    for (const [key, chunk] of this.chunks) if (!wanted.has(key)) { this.disposeChunk(chunk); this.chunks.delete(key); }
    requests.sort((a, b) => a.distance - b.distance);
    const generation = this.generation; const workers = Array.from({ length: Math.min(6, requests.length) }, async () => {
      while (requests.length) {
        const request = requests.shift(); if (!request || generation !== this.generation) return;
        await this.loadChunk(request.x, request.z, request.key, generation);
      }
    });
    await Promise.all(workers); this.updateStatus(); this.requestRender();
  }

  async loadChunk(x, z, key, generation) {
    this.loading.add(key);
    try {
      const url = this.manifest.chunk_url.replace('{x}', x).replace('{z}', z); const response = await fetch(url, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); if (generation !== this.generation) return; this.validateChunk(data); this.chunks.set(key, this.buildChunk(data));
    } catch (error) { console.error(`Chunk voxel ${key}:`, error); }
    finally { this.loading.delete(key); this.updateStatus(); this.requestRender(); }
  }

  validateChunk(data) {
    if (data?.format !== 'jkr-voxel-chunk' || ![1, 2].includes(data.version)) throw new Error('Chunk voxel incompatible.');
    const total = data.width * data.length;
    for (const key of ['height','material','top_block','playable','water']) if (!Array.isArray(data[key]) || data[key].length !== total) throw new Error(`Chunk voxel incompleto: ${key}.`);
    if (data.water_surface !== undefined && (!Array.isArray(data.water_surface) || data.water_surface.length !== total)) throw new Error('Chunk voxel incompleto: water_surface.');
    if (data.structure_blocks !== undefined && !Array.isArray(data.structure_blocks)) throw new Error('Chunk voxel incompleto: structure_blocks.');
    data.structureMap = new Map((data.structure_blocks || []).map((block) => [`${block[0]},${block[1]},${block[2]}`, Number(block[3])]));
  }

  baseBlockAt(data, globalX, globalZ, y) {
    if (globalX < 0 || globalZ < 0 || globalX >= this.manifest.width || globalZ >= this.manifest.length || y < 0 || y >= this.manifest.schematic_height) return 0;
    const localX = globalX - data.x0; const localZ = globalZ - data.z0;
    if (localX < 0 || localZ < 0 || localX >= data.width || localZ >= data.length) return 0;
    const index = localZ * data.width + localX; const surface = data.height[index]; const playable = Boolean(data.playable[index]); const water = Boolean(data.water[index]); const waterSurface = Array.isArray(data.water_surface) && data.water_surface[index] >= 0 ? data.water_surface[index] : this.manifest.sea_level;
    if (y === 0) return 1; if (!playable) return y <= surface ? 2 : 0;
    if (water && y > surface && y <= waterSurface) return 8;
    if (y > surface) return 0; if (y === surface) return data.top_block[index];
    if (y >= Math.max(1, surface - this.manifest.surface_depth)) return 3; return 2;
  }

  blockAt(data, globalX, globalZ, y) {
    const structure = data.structureMap?.get(`${globalX},${y},${globalZ}`); if (structure !== undefined) return structure;
    return this.baseBlockAt(data, globalX, globalZ, y);
  }

  color(blockId, faceName) {
    const base = this.palette.get(blockId)?.color || [0.8, 0.1, 0.8, 1]; const color = [...base];
    if (blockId === 4 && faceName !== 'top') { color[0] = 0.43; color[1] = 0.34; color[2] = 0.20; }
    return color;
  }

  buildChunk(data) {
    const terrain = { positions: [], normals: [], colors: [] }; const waterMesh = { positions: [], normals: [], colors: [] }; const lines = [];
    const cutY = Number(this.cutInput.value); const includeWater = this.waterInput.checked;
    const directions = [
      { dx: 0, dz: -1, face: FACES.north, name: 'north' }, { dx: 0, dz: 1, face: FACES.south, name: 'south' },
      { dx: -1, dz: 0, face: FACES.west, name: 'west' }, { dx: 1, dz: 0, face: FACES.east, name: 'east' },
    ];
    for (let z = data.core_z0; z < data.core_z0 + data.core_length; z += 1) for (let x = data.core_x0; x < data.core_x0 + data.core_width; x += 1) {
      const localIndex = (z - data.z0) * data.width + (x - data.x0); const surface = data.height[localIndex]; const terrainTop = Math.min(surface, cutY);
      if (terrainTop >= 0) {
        const topId = this.baseBlockAt(data, x, z, terrainTop); if (topId && topId !== 8) pushFace(terrain, lines, FACES.top, x, terrainTop, z, this.color(topId, 'top'));
        for (const direction of directions) {
          for (let y = terrainTop; y >= 0; y -= 1) {
            const block = this.baseBlockAt(data, x, z, y); if (!block || block === 8) continue;
            const neighbor = this.blockAt(data, x + direction.dx, z + direction.dz, y);
            if (neighbor === 0 || neighbor === 8) pushFace(terrain, lines, direction.face, x, y, z, this.color(block, direction.name));
            else if (y < terrainTop - this.manifest.surface_depth - 2) break;
          }
        }
      }
      if (includeWater && data.water[localIndex]) {
        const localWaterSurface = Array.isArray(data.water_surface) && data.water_surface[localIndex] >= 0 ? data.water_surface[localIndex] : this.manifest.sea_level;
        if (localWaterSurface <= surface || cutY <= surface) continue;
        const waterTop = Math.min(localWaterSurface, cutY); pushFace(waterMesh, [], FACES.top, x, waterTop, z, this.color(8, 'top'));
        for (const direction of directions) for (let y = surface + 1; y <= waterTop; y += 1) {
          if (this.blockAt(data, x + direction.dx, z + direction.dz, y) === 0) pushFace(waterMesh, [], direction.face, x, y, z, this.color(8, direction.name));
        }
      }
    }
    const structureDirections = [
      { dx: 0, dy: 1, dz: 0, face: FACES.top, name: 'top' }, { dx: 0, dy: -1, dz: 0, face: FACES.bottom, name: 'bottom' },
      { dx: 0, dy: 0, dz: -1, face: FACES.north, name: 'north' }, { dx: 0, dy: 0, dz: 1, face: FACES.south, name: 'south' },
      { dx: -1, dy: 0, dz: 0, face: FACES.west, name: 'west' }, { dx: 1, dy: 0, dz: 0, face: FACES.east, name: 'east' },
    ];
    for (const block of data.structure_blocks || []) {
      const [x, y, z, blockId] = block.map(Number); if (x < data.core_x0 || z < data.core_z0 || x >= data.core_x0 + data.core_width || z >= data.core_z0 + data.core_length || y > cutY) continue;
      for (const direction of structureDirections) {
        const neighbor = this.blockAt(data, x + direction.dx, z + direction.dz, y + direction.dy);
        if (neighbor === 0 || neighbor === 8) pushFace(terrain, lines, direction.face, x, y, z, this.color(blockId, direction.name));
      }
    }
    return {
      data,
      terrain: this.createMeshBuffers(terrain), water: this.createMeshBuffers(waterMesh),
      line: this.createLineBuffer(lines),
    };
  }

  createMeshBuffers(mesh) {
    const gl = this.gl; if (!mesh.positions.length) return null;
    const make = (target, values) => { const buffer = gl.createBuffer(); gl.bindBuffer(target, buffer); gl.bufferData(target, values, gl.STATIC_DRAW); return buffer; };
    return {
      position: make(gl.ARRAY_BUFFER, new Float32Array(mesh.positions)), normal: make(gl.ARRAY_BUFFER, new Float32Array(mesh.normals)),
      color: make(gl.ARRAY_BUFFER, new Float32Array(mesh.colors)), count: mesh.positions.length / 3,
    };
  }

  createLineBuffer(lines) {
    if (!lines.length) return null; const gl = this.gl; const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
    return { position: buffer, count: lines.length / 3 };
  }

  disposeMesh(mesh) { if (!mesh) return; for (const key of ['position','normal','color']) if (mesh[key]) this.gl.deleteBuffer(mesh[key]); }
  disposeChunk(chunk) { this.disposeMesh(chunk.terrain); this.disposeMesh(chunk.water); if (chunk.line?.position) this.gl.deleteBuffer(chunk.line.position); }
  clearChunks() { for (const chunk of this.chunks.values()) this.disposeChunk(chunk); this.chunks.clear(); this.loading.clear(); }
  remeshLoadedChunks() { for (const [key, chunk] of [...this.chunks]) { this.disposeChunk(chunk); this.chunks.set(key, this.buildChunk(chunk.data)); } this.requestRender(); this.updateStatus(); }

  bindMesh(mesh) {
    const gl = this.gl;
    for (const [buffer, location, size] of [[mesh.position,this.locations.position,3],[mesh.normal,this.locations.normal,3],[mesh.color,this.locations.color,4]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
  }

  resize() {
    if (!this.gl) return; const rect = this.canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(rect.width * ratio)); const height = Math.max(2, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; } this.requestRender();
  }

  camera() {
    if (this.modeInput.value === 'first-person') {
      const forward = [Math.cos(this.pitch) * Math.sin(this.yaw), Math.sin(this.pitch), Math.cos(this.pitch) * Math.cos(this.yaw)];
      return { eye: this.position, target: [this.position[0] + forward[0], this.position[1] + forward[1], this.position[2] + forward[2]] };
    }
    const cosPitch = Math.cos(this.pitch); return {
      eye: [this.target[0] + this.distance * cosPitch * Math.sin(this.yaw), this.target[1] + this.distance * Math.sin(this.pitch), this.target[2] + this.distance * cosPitch * Math.cos(this.yaw)],
      target: this.target,
    };
  }

  requestRender() { if (this.frameRequested) return; this.frameRequested = true; requestAnimationFrame(() => { this.frameRequested = false; this.render(); }); }
  startAnimation() { if (this.animationFrame) return; const step = (time) => { this.animationFrame = null; this.animate(time); if (this.modeInput.value === 'first-person' && this.keys.size) this.animationFrame = requestAnimationFrame(step); }; this.animationFrame = requestAnimationFrame(step); }

  animate(time) {
    const delta = Math.min(0.05, (time - this.lastFrame) / 1000); this.lastFrame = time; if (this.modeInput.value !== 'first-person') return;
    const speed = (this.firstPersonSpeed || 18) * delta; const forward = [Math.sin(this.yaw), 0, Math.cos(this.yaw)]; const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)];
    if (this.keys.has('KeyW')) { this.position[0] += forward[0] * speed; this.position[2] += forward[2] * speed; }
    if (this.keys.has('KeyS')) { this.position[0] -= forward[0] * speed; this.position[2] -= forward[2] * speed; }
    if (this.keys.has('KeyD')) { this.position[0] += right[0] * speed; this.position[2] += right[2] * speed; }
    if (this.keys.has('KeyA')) { this.position[0] -= right[0] * speed; this.position[2] -= right[2] * speed; }
    if (this.keys.has('Space')) this.position[1] += speed; if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) this.position[1] -= speed;
    this.position[0] = clamp(this.position[0], 0.1, this.manifest.width - 0.1); this.position[2] = clamp(this.position[2], 0.1, this.manifest.length - 0.1); this.position[1] = clamp(this.position[1], 1, this.manifest.schematic_height + 80);
    this.scheduleChunkUpdate(); this.requestRender(); this.updateStatus();
  }

  render() {
    if (!this.gl || !this.manifest) return; const gl = this.gl; const camera = this.camera(); const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const far = this.maximumDimension() * 4; const matrix = multiply(perspective(Math.PI / 3, aspect, 0.08, far), lookAt(camera.eye, camera.target, [0,1,0]));
    gl.viewport(0,0,this.canvas.width,this.canvas.height); gl.clearColor(0.045,0.065,0.052,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.program); gl.uniformMatrix4fv(this.locations.matrix,false,matrix);
    for (const chunk of this.chunks.values()) if (chunk.terrain) { this.bindMesh(chunk.terrain); gl.disable(gl.BLEND); gl.depthMask(true); gl.drawArrays(gl.TRIANGLES,0,chunk.terrain.count); }
    if (this.waterInput.checked) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      for (const chunk of this.chunks.values()) if (chunk.water) { this.bindMesh(chunk.water); gl.drawArrays(gl.TRIANGLES,0,chunk.water.count); }
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    if (this.edgesInput.checked) {
      gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA); gl.useProgram(this.lineProgram); gl.uniformMatrix4fv(this.locations.lineMatrix,false,matrix); gl.uniform4f(this.locations.lineColor,0.03,0.04,0.035,0.48);
      for (const chunk of this.chunks.values()) if (chunk.line) { gl.bindBuffer(gl.ARRAY_BUFFER,chunk.line.position); gl.enableVertexAttribArray(this.locations.linePosition); gl.vertexAttribPointer(this.locations.linePosition,3,gl.FLOAT,false,0,0); gl.drawArrays(gl.LINES,0,chunk.line.count); }
      gl.disable(gl.BLEND);
    }
  }

  updateStatus() {
    if (!this.manifest) return; const mode = this.modeInput.value === 'first-person' ? 'Primera persona: clic para capturar el ratón, WASD, Espacio/Shift; rueda cambia velocidad.' : 'Órbita: arrastra para rotar, Shift+arrastre para mover y rueda para acercar.';
    const faces = [...this.chunks.values()].reduce((sum, chunk) => sum + (chunk.terrain?.count || 0) / 6 + (chunk.water?.count || 0) / 6, 0);
    this.status.textContent = `${this.manifest.width}×${this.manifest.length}×${this.manifest.schematic_height} · ${this.chunks.size} chunks cargados${this.loading.size ? ` · ${this.loading.size} cargando` : ''} · ${Math.round(faces).toLocaleString('es-CL')} caras visibles · corte ${this.cutValue.textContent}. ${mode}`;
  }
}
