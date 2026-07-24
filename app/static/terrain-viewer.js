const MATERIAL_COLORS = [
  [0.32, 0.44, 0.32], [0.31, 0.56, 0.28], [0.50, 0.36, 0.23], [0.45, 0.47, 0.49],
  [0.78, 0.70, 0.45], [0.91, 0.94, 0.95], [0.56, 0.55, 0.50], [0.20, 0.43, 0.67],
];

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
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      output[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }
  return output;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(message || 'No se pudo compilar el shader.');
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    in vec3 a_position;
    in vec3 a_normal;
    in vec3 a_color;
    uniform mat4 u_matrix;
    uniform float u_vertical_scale;
    uniform float u_point_size;
    out vec3 v_normal;
    out vec3 v_color;
    void main() {
      vec3 position = vec3(a_position.x, a_position.y * u_vertical_scale, a_position.z);
      gl_Position = u_matrix * vec4(position, 1.0);
      gl_PointSize = u_point_size;
      v_normal = normalize(vec3(a_normal.x * u_vertical_scale, a_normal.y, a_normal.z * u_vertical_scale));
      v_color = a_color;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float;
    in vec3 v_normal;
    in vec3 v_color;
    uniform bool u_flat;
    uniform vec4 u_flat_color;
    out vec4 out_color;
    void main() {
      if (u_flat) {
        out_color = u_flat_color;
      } else {
        vec3 light = normalize(vec3(-0.45, 0.90, 0.35));
        float diffuse = max(dot(normalize(v_normal), light), 0.0);
        float lighting = 0.50 + diffuse * 0.58;
        out_color = vec4(v_color * lighting, 1.0);
      }
    }
  `);
  const program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
  gl.deleteShader(vertex); gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'No se pudo enlazar el shader.');
  return program;
}

export class Terrain3DViewer {
  constructor({ canvas, status, scaleInput, scaleValue, wireframeInput, resetButton, expandButton }) {
    this.canvas = canvas; this.status = status; this.scaleInput = scaleInput; this.scaleValue = scaleValue;
    this.wireframeInput = wireframeInput; this.resetButton = resetButton; this.expandButton = expandButton; this.view = canvas.closest('.terrain-3d-view');
    this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    this.ready = false; this.currentUrl = null; this.data = null; this.buffers = null;
    this.yaw = -0.75; this.pitch = 0.62; this.distance = 3.15; this.target = [0, 0.12, 0];
    this.drag = null; this.frameRequested = false;
    this.expandButton?.addEventListener('click', () => this.setExpanded(!this.view?.classList.contains('is-expanded')));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && this.view?.classList.contains('is-expanded')) this.setExpanded(false); });
    if (!this.gl) { this.status.textContent = 'Este navegador no ofrece WebGL 2. La vista 2D sigue disponible.'; return; }
    try { this.program = createProgram(this.gl); this.cacheLocations(); this.bindEvents(); this.observeSize(); }
    catch (error) { this.status.textContent = `No se pudo iniciar la vista 3D: ${error.message}`; }
  }

  cacheLocations() {
    const gl = this.gl; const program = this.program;
    this.locations = {
      position: gl.getAttribLocation(program, 'a_position'), normal: gl.getAttribLocation(program, 'a_normal'), color: gl.getAttribLocation(program, 'a_color'),
      matrix: gl.getUniformLocation(program, 'u_matrix'), verticalScale: gl.getUniformLocation(program, 'u_vertical_scale'), pointSize: gl.getUniformLocation(program, 'u_point_size'),
      flat: gl.getUniformLocation(program, 'u_flat'), flatColor: gl.getUniformLocation(program, 'u_flat_color'),
    };
  }

  bindEvents() {
    this.canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault(); this.canvas.setPointerCapture(event.pointerId);
      this.drag = { x: event.clientX, y: event.clientY, mode: event.shiftKey || event.button !== 0 ? 'pan' : 'orbit' };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      const dx = event.clientX - this.drag.x; const dy = event.clientY - this.drag.y; this.drag.x = event.clientX; this.drag.y = event.clientY;
      if (this.drag.mode === 'orbit') { this.yaw -= dx * 0.008; this.pitch = clamp(this.pitch - dy * 0.008, 0.12, 1.42); }
      else { const factor = this.distance * 0.0016; this.target[0] -= dx * factor; this.target[2] -= dy * factor; }
      this.requestRender();
    });
    const endDrag = (event) => { this.drag = null; try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) { /* no-op */ } };
    this.canvas.addEventListener('pointerup', endDrag); this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    this.canvas.addEventListener('wheel', (event) => { event.preventDefault(); this.distance = clamp(this.distance * Math.exp(event.deltaY * 0.001), 1.3, 8); this.requestRender(); }, { passive: false });
    this.scaleInput.addEventListener('input', () => { this.scaleValue.textContent = `${this.scaleInput.value}%`; this.requestRender(); });
    this.wireframeInput.addEventListener('change', () => this.requestRender());
    this.resetButton.addEventListener('click', () => this.resetCamera());
  }

  setExpanded(expanded) {
    if (!this.view) return;
    this.view.classList.toggle('is-expanded', Boolean(expanded)); document.body.classList.toggle('terrain-3d-open', Boolean(expanded));
    if (this.expandButton) { this.expandButton.textContent = expanded ? 'Cerrar' : 'Ampliar'; this.expandButton.setAttribute('aria-pressed', String(Boolean(expanded))); }
    setTimeout(() => this.resize(), 0);
  }

  observeSize() {
    if ('ResizeObserver' in window) { this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(this.canvas.parentElement); }
    else window.addEventListener('resize', () => this.resize());
  }

  resetCamera() {
    this.yaw = -0.75; this.pitch = 0.62; this.distance = 3.15; this.target = [0, 0.12, 0]; this.requestRender();
  }

  async load(url) {
    if (!this.gl || !url) return;
    if (this.currentUrl === url && this.ready) { this.resize(); return; }
    this.currentUrl = url; this.ready = false; this.status.textContent = 'Cargando terreno 3D…';
    try {
      const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json(); this.validateData(data); this.data = data; this.buildMesh(data); this.ready = true;
      const sampled = data.width !== data.source_width || data.length !== data.source_length;
      this.status.textContent = `${data.source_width}×${data.source_length} bloques · malla ${data.width}×${data.length}${sampled ? ' optimizada para previsualización' : ''}. Arrastra para rotar; Shift+arrastre para mover; rueda para acercar.`;
      this.resetCamera(); this.resize();
    } catch (error) { this.status.textContent = `No se pudo cargar la vista 3D: ${error.message}`; }
  }

  validateData(data) {
    if (data?.format !== 'jkr-terrain-preview-3d' || ![1, 2].includes(data.version)) throw new Error('Formato 3D incompatible.');
    const total = Number(data.width) * Number(data.length);
    for (const key of ['height', 'material', 'roads', 'water', 'reserved', 'playable']) if (!Array.isArray(data[key]) || data[key].length !== total) throw new Error(`Datos 3D incompletos: ${key}.`);
    for (const key of ['mountain', 'exit_corridors', 'water_surface']) if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length !== total)) throw new Error(`Datos 3D inválidos: ${key}.`);
  }

  createArrayBuffer(values) {
    const gl = this.gl; const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW); return buffer;
  }

  createIndexBuffer(values) {
    const gl = this.gl; const buffer = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, values, gl.STATIC_DRAW); return buffer;
  }

  buildMesh(data) {
    this.disposeBuffers();
    const width = data.width; const length = data.length; const count = width * length;
    const maximumDimension = Math.max(data.source_width - 1, data.source_length - 1, 1);
    const yOrigin = data.min_height; const positions = new Float32Array(count * 3); const normals = new Float32Array(count * 3); const colors = new Float32Array(count * 3);
    const coordinateX = data.x_coordinates; const coordinateZ = data.z_coordinates;
    const xCenter = (data.source_width - 1) / 2; const zCenter = (data.source_length - 1) / 2;
    const yScale = 2 / maximumDimension;
    for (let z = 0; z < length; z += 1) for (let x = 0; x < width; x += 1) {
      const index = z * width + x; const offset = index * 3;
      positions[offset] = (coordinateX[x] - xCenter) * yScale; positions[offset + 1] = (data.height[index] - yOrigin) * yScale; positions[offset + 2] = (coordinateZ[z] - zCenter) * yScale;
      let color = MATERIAL_COLORS[data.material[index]] || MATERIAL_COLORS[0];
      if (!data.playable[index]) color = [0.22, 0.23, 0.24];
      const mountainStrength = (data.mountain?.[index] || 0) / 255;
      if (mountainStrength > 0) color = color.map((value, channel) => value * (1 - mountainStrength * 0.18) + [0.40, 0.41, 0.42][channel] * mountainStrength * 0.18);
      if (data.exit_corridors?.[index]) color = color.map((value, channel) => value * 0.86 + [0.48, 0.39, 0.27][channel] * 0.14);
      if (data.roads[index] === 1) color = [0.72, 0.66, 0.51]; else if (data.roads[index] === 2) color = [0.55, 0.39, 0.25];
      if (data.reserved[index]) color = color.map((value, channel) => value * 0.72 + [0.74, 0.44, 0.78][channel] * 0.28);
      colors.set(color, offset);
    }
    for (let z = 0; z < length; z += 1) for (let x = 0; x < width; x += 1) {
      const index = z * width + x; const left = z * width + Math.max(0, x - 1); const right = z * width + Math.min(width - 1, x + 1);
      const up = Math.max(0, z - 1) * width + x; const down = Math.min(length - 1, z + 1) * width + x;
      const dxDistance = Math.max(1, coordinateX[Math.min(width - 1, x + 1)] - coordinateX[Math.max(0, x - 1)]);
      const dzDistance = Math.max(1, coordinateZ[Math.min(length - 1, z + 1)] - coordinateZ[Math.max(0, z - 1)]);
      const dx = (data.height[right] - data.height[left]) / dxDistance; const dz = (data.height[down] - data.height[up]) / dzDistance;
      const normal = normalize([-dx, 1, -dz]); normals.set(normal, index * 3);
    }
    const triangles = new Uint32Array((width - 1) * (length - 1) * 6); const lines = new Uint32Array((width - 1) * (length - 1) * 8);
    let triangleOffset = 0; let lineOffset = 0; const waterTriangles = [];
    for (let z = 0; z < length - 1; z += 1) for (let x = 0; x < width - 1; x += 1) {
      const a = z * width + x; const b = a + 1; const c = a + width; const d = c + 1;
      triangles.set([a, c, b, b, c, d], triangleOffset); triangleOffset += 6;
      lines.set([a, b, b, d, d, c, c, a], lineOffset); lineOffset += 8;
      if (data.water[a] && data.water[c] && data.water[b]) waterTriangles.push(a, c, b);
      if (data.water[b] && data.water[c] && data.water[d]) waterTriangles.push(b, c, d);
    }
    const waterPositions = new Float32Array(positions); const waterNormals = new Float32Array(normals.length); const waterColors = new Float32Array(colors.length);
    for (let index = 0; index < count; index += 1) {
      const surfaceY = Array.isArray(data.water_surface) && data.water_surface[index] >= 0 ? data.water_surface[index] : data.sea_level;
      waterPositions[index * 3 + 1] = (surfaceY - yOrigin) * yScale; waterNormals.set([0, 1, 0], index * 3); waterColors.set([0.20, 0.48, 0.75], index * 3);
    }

    const markerPositions = []; const markerColors = [];
    for (const marker of data.markers || []) {
      let nearestX = 0; let nearestZ = 0;
      for (let index = 1; index < coordinateX.length; index += 1) if (Math.abs(coordinateX[index] - marker.x) < Math.abs(coordinateX[nearestX] - marker.x)) nearestX = index;
      for (let index = 1; index < coordinateZ.length; index += 1) if (Math.abs(coordinateZ[index] - marker.z) < Math.abs(coordinateZ[nearestZ] - marker.z)) nearestZ = index;
      const source = nearestZ * width + nearestX; markerPositions.push((marker.x - xCenter) * yScale, positions[source * 3 + 1] + 0.045, (marker.z - zCenter) * yScale);
      markerColors.push(...(marker.type === 'spawn' ? [1, 0.90, 0.25] : marker.type === 'exit' ? [1, 0.25, 0.25] : [0.95, 0.40, 1]));
    }

    this.buffers = {
      position: this.createArrayBuffer(positions), normal: this.createArrayBuffer(normals), color: this.createArrayBuffer(colors),
      triangles: this.createIndexBuffer(triangles), triangleCount: triangles.length,
      lines: this.createIndexBuffer(lines), lineCount: lines.length,
      waterPosition: this.createArrayBuffer(waterPositions), waterNormal: this.createArrayBuffer(waterNormals), waterColor: this.createArrayBuffer(waterColors),
      waterTriangles: this.createIndexBuffer(new Uint32Array(waterTriangles)), waterTriangleCount: waterTriangles.length,
      markerPosition: markerPositions.length ? this.createArrayBuffer(new Float32Array(markerPositions)) : null,
      markerNormal: markerPositions.length ? this.createArrayBuffer(this.markerNormals(markerPositions.length / 3)) : null,
      markerColor: markerColors.length ? this.createArrayBuffer(new Float32Array(markerColors)) : null,
      markerCount: markerPositions.length / 3,
    };
  }


  markerNormals(count) {
    const normals = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) normals[index * 3 + 1] = 1;
    return normals;
  }

  disposeBuffers() {
    if (!this.gl || !this.buffers) return;
    for (const [key, buffer] of Object.entries(this.buffers)) if (buffer && typeof buffer === 'object' && !key.endsWith('Count')) this.gl.deleteBuffer(buffer);
    this.buffers = null;
  }

  bindAttributes(position, normal, color) {
    const gl = this.gl; const locations = this.locations;
    for (const [buffer, location] of [[position, locations.position], [normal, locations.normal], [color, locations.color]]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    }
  }

  resize() {
    if (!this.gl) return;
    const rect = this.canvas.getBoundingClientRect(); const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(2, Math.round(rect.width * ratio)); const height = Math.max(2, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    this.requestRender();
  }

  requestRender() {
    if (this.frameRequested) return; this.frameRequested = true;
    requestAnimationFrame(() => { this.frameRequested = false; this.render(); });
  }

  render() {
    if (!this.gl || !this.ready || !this.buffers) return;
    const gl = this.gl; const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const cosPitch = Math.cos(this.pitch); const eye = [
      this.target[0] + this.distance * cosPitch * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cosPitch * Math.cos(this.yaw),
    ];
    const matrix = multiply(perspective(Math.PI / 4, aspect, 0.02, 30), lookAt(eye, this.target, [0, 1, 0]));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(0.045, 0.065, 0.052, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.locations.matrix, false, matrix); gl.uniform1f(this.locations.verticalScale, Number(this.scaleInput.value) / 100); gl.uniform1f(this.locations.pointSize, 9 * Math.min(devicePixelRatio || 1, 2));

    this.bindAttributes(this.buffers.position, this.buffers.normal, this.buffers.color); gl.uniform1i(this.locations.flat, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.triangles); gl.drawElements(gl.TRIANGLES, this.buffers.triangleCount, gl.UNSIGNED_INT, 0);

    if (this.buffers.waterTriangleCount) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      this.bindAttributes(this.buffers.waterPosition, this.buffers.waterNormal, this.buffers.waterColor); gl.uniform1i(this.locations.flat, 1); gl.uniform4f(this.locations.flatColor, 0.17, 0.48, 0.78, 0.64);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.waterTriangles); gl.drawElements(gl.TRIANGLES, this.buffers.waterTriangleCount, gl.UNSIGNED_INT, 0); gl.depthMask(true); gl.disable(gl.BLEND);
    }

    if (this.wireframeInput.checked) {
      this.bindAttributes(this.buffers.position, this.buffers.normal, this.buffers.color); gl.uniform1i(this.locations.flat, 1); gl.uniform4f(this.locations.flatColor, 0.04, 0.07, 0.05, 0.48);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.lines); gl.drawElements(gl.LINES, this.buffers.lineCount, gl.UNSIGNED_INT, 0); gl.disable(gl.BLEND);
    }

    if (this.buffers.markerCount) {
      this.bindAttributes(this.buffers.markerPosition, this.buffers.markerNormal, this.buffers.markerColor); gl.uniform1i(this.locations.flat, 0); gl.drawArrays(gl.POINTS, 0, this.buffers.markerCount);
    }
  }
}
