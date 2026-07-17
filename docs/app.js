/* app.js — v2 renderer (S3b1 core + S3b2 chrome). One data-driven port of the
 * live map's six folium MacroElements plus the landing overlay/silk tween,
 * hand-rolled station search (replaces leaflet-search, spec §2.2) and the
 * route-badge filter; consumes /data/{elevators.json,stations.json,
 * routes.geojson}. Leaflet 1.9.x core only — no plugins.
 * Parity reference: planning/s3/audit.md §C.1–C.9. */
(function () {
  'use strict';

  // ── Constants (mirrors of build_map.py display helpers) ──────────────────
  var MTA_LINE_COLORS = {
    A: '#0039A6', C: '#0039A6', E: '#0039A6',
    B: '#FF6319', D: '#FF6319', F: '#FF6319', M: '#FF6319',
    G: '#6CBE45',
    J: '#996633', Z: '#996633',
    L: '#A7A9AC',
    N: '#FCCC0A', Q: '#FCCC0A', R: '#FCCC0A', W: '#FCCC0A',
    1: '#EE352E', 2: '#EE352E', 3: '#EE352E',
    4: '#00933C', 5: '#00933C', 6: '#00933C',
    7: '#B933AD'
  };
  var DARK_TEXT_ROUTES = { N: true, Q: true, R: true, W: true };
  var ROUTE_BADGE_ORDER = ['1', '2', '3', 'B', 'D', 'F', 'M',
    'N', 'Q', 'R', 'W', '4', '5', '6', 'G',
    'A', 'C', 'E', '7', 'L', 'J', 'Z'];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  var TIER_LABELS = { high: 'HIGH RISK', medium: 'MEDIUM RISK', low: 'LOW RISK' };
  var NEARBY_TIER_LABELS = { high: 'HIGH RISK', medium: 'MED RISK', low: 'LOW RISK' };
  var REPO_URL = 'https://github.com/jiayili6812/mta-elevator-reliability';
  var DATASET_URL = 'https://data.ny.gov/Transportation/MTA-NYCT-Subway-Elevator-and-Escalator-Availabilit/rc78-7x78/about_data';

  // ── Python-format parity ──────────────────────────────────────────────────
  // Python's format() rounds half-to-even on exact decimal ties; toFixed
  // rounds half-up. Ties only occur for dyadic values whose decimal expansion
  // ends exactly one digit past nd — detectable via exact power-of-2 products.
  // Validated against every formatted value in the current export (0 diffs).
  function pyfmt(x, nd) {
    var hi = x * Math.pow(2, nd + 1);
    var lo = x * Math.pow(2, nd);
    if (Math.floor(hi) === hi && Math.floor(lo) !== lo) {
      var scaled = x * Math.pow(10, nd);
      var f = Math.floor(scaled);
      var r = (f % 2 === 0) ? f : f + 1;
      return (r / Math.pow(10, nd)).toFixed(nd);
    }
    return x.toFixed(nd);
  }
  function pct0(p) { return pyfmt(p * 100, 0) + '%'; }   // f"{p:.0%}"
  function pct1(v) { return pyfmt(v * 100, 1) + '%'; }   // f"{v:.1%}"

  function esc(value) {
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  }

  function parseYM(s) { var p = s.split('-'); return { y: +p[0], m: +p[1] }; }
  function monthLabel(s) {                                // %B %Y
    var d = parseYM(s); return MONTH_NAMES[d.m - 1] + ' ' + d.y;
  }
  function monthAbbr(s) { return MONTH_ABBR[parseYM(s).m - 1]; }  // %b
  function monthRangeLabel(months) {                      // month_range_label()
    if (!months.length) return '';
    var a = parseYM(months[0]), b = parseYM(months[months.length - 1]);
    if (a.y === b.y) return MONTH_ABBR[a.m - 1] + '–' + MONTH_ABBR[b.m - 1] + ' ' + b.y;
    return MONTH_ABBR[a.m - 1] + ' ' + a.y + '–' + MONTH_ABBR[b.m - 1] + ' ' + b.y;
  }

  function sortRoutes(routes) {                           // sort_routes_for_badges()
    return routes.slice().sort(function (a, b) {
      var ia = ROUTE_BADGE_ORDER.indexOf(a); if (ia < 0) ia = ROUTE_BADGE_ORDER.length;
      var ib = ROUTE_BADGE_ORDER.indexOf(b); if (ib < 0) ib = ROUTE_BADGE_ORDER.length;
      return ia - ib || (a < b ? -1 : a > b ? 1 : 0);
    });
  }

  function formatEquipmentCode(code) {                    // format_equipment_code()
    return /^EL\d+$/.test(code) ? 'EL-' + code.slice(2) : code;
  }

  function headerBadgesHtml(routes) {                     // route_badges_html(header=True)
    return routes.map(function (route) {
      var color = MTA_LINE_COLORS[route] || '#777777';
      var dark = DARK_TEXT_ROUTES[route] ? 'color:#111;' : '';
      return '<span class="line-badge" style="background:' + color + ';' + dark + '">' + esc(route) + '</span>';
    }).join('');
  }

  function miniBadgesHtml(routes) {                       // route_badges_html(small=True)
    return routes.map(function (route) {
      var color = MTA_LINE_COLORS[route] || '#777777';
      var dark = DARK_TEXT_ROUTES[route] ? ' popup-route-badge-dark' : '';
      return '<span class="popup-route-badge popup-route-badge-small' + dark + '" ' +
        'style="--route-color:' + color + '">' + esc(route) + '</span>';
    }).join('');
  }

  // ── Landing silk state + tween (port of landing_js; audit C.1) ───────────
  // Must run before the silk IIFE below: its render loop reads
  // window.silkParams / window.silkRGB every frame and keeps pre-set values.
  var SILK_LANDING = { speed: 5.0, scale: 1.0, noiseIntensity: 2.0, rotation: 0 };
  var SILK_LANDING_RGB = [0.467, 0.467, 0.467];   // #777777
  var SILK_MAP = { speed: 1.7, scale: 0.6, noiseIntensity: 0.9, rotation: 0 };
  var SILK_MAP_RGB = [1.0, 1.0, 1.0];             // #ffffff
  window.silkParams = { speed: SILK_LANDING.speed, scale: SILK_LANDING.scale, noiseIntensity: SILK_LANDING.noiseIntensity, rotation: 0 };
  window.silkRGB = SILK_LANDING_RGB.slice();

  var silkTween = null;
  function startSilkTween(fromP, fromRGB, toP, toRGB, durationMs) {
    silkTween = { start: performance.now(), duration: durationMs, fromP: fromP, fromRGB: fromRGB, toP: toP, toRGB: toRGB };
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function tickSilkTween(now) {
    if (!silkTween) return;
    var t = Math.min(1, (now - silkTween.start) / silkTween.duration);
    var e = 1 - Math.pow(1 - t, 3);
    window.silkParams.speed          = lerp(silkTween.fromP.speed,          silkTween.toP.speed,          e);
    window.silkParams.scale          = lerp(silkTween.fromP.scale,          silkTween.toP.scale,          e);
    window.silkParams.noiseIntensity = lerp(silkTween.fromP.noiseIntensity, silkTween.toP.noiseIntensity, e);
    window.silkRGB[0] = lerp(silkTween.fromRGB[0], silkTween.toRGB[0], e);
    window.silkRGB[1] = lerp(silkTween.fromRGB[1], silkTween.toRGB[1], e);
    window.silkRGB[2] = lerp(silkTween.fromRGB[2], silkTween.toRGB[2], e);
    if (t >= 1) silkTween = null;
  }

  // ── Map + panes + tiles + scale (audit C.2) ───────────────────────────────
  var LANDING_ZOOM = 14.5;
  var DEFAULT_LAT = 40.7454;
  var DEFAULT_LNG = -73.9832;
  var DEFAULT_ZOOM = 13;

  var map = L.map('map', {
    center: [DEFAULT_LAT, DEFAULT_LNG],
    zoom: DEFAULT_ZOOM,
    zoomControl: false
  });
  // Pre-position behind the landing overlay (~500 m view, no animation);
  // Explore flies back out to DEFAULT_ZOOM (audit C.1).
  map.setView([DEFAULT_LAT, DEFAULT_LNG], LANDING_ZOOM, { animate: false });
  L.control.scale().addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
  }).addTo(map);
  map.createPane('subwayPane').style.zIndex = 390;
  map.createPane('elevatorPane').style.zIndex = 430;

  // ── Silk WebGL base layer (port of SilkBaseLayer; audit C.2) ─────────────
  // No landing tween in 3b1, so the shader starts at the post-Explore map
  // state: speed 1.7 / scale 0.6 / noise 0.9, white (landing_js SILK_MAP_*).
  (function () {
    var SILK_OPTIONS = { speed: 1.7, scale: 0.6, color: '#ffffff', noiseIntensity: 0.9, rotation: 0 };
    function hexToRGB(h) {
      var c = h.replace('#', '');
      return [parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255];
    }
    if (!window.silkParams) window.silkParams = { speed: SILK_OPTIONS.speed, scale: SILK_OPTIONS.scale, noiseIntensity: SILK_OPTIONS.noiseIntensity, rotation: SILK_OPTIONS.rotation };
    if (!window.silkRGB) window.silkRGB = hexToRGB(SILK_OPTIONS.color);

    var vertexShaderSource = [
      'attribute vec2 aPosition;',
      'varying vec2 vUv;',
      'void main() {',
      '    vUv = aPosition * 0.5 + 0.5;',
      '    gl_Position = vec4(aPosition, 0.0, 1.0);',
      '}'
    ].join('\n');

    var fragmentShaderSource = [
      'precision mediump float;',
      'varying vec2 vUv;',
      'uniform float uTime;',
      'uniform vec3  uColor;',
      'uniform float uSpeed;',
      'uniform float uScale;',
      'uniform float uRotation;',
      'uniform float uNoiseIntensity;',
      'const float e = 2.71828182845904523536;',
      'float noise(vec2 texCoord) {',
      '    float G = e;',
      '    vec2 r = (G * sin(G * texCoord));',
      '    return fract(r.x * r.y * (1.0 + texCoord.x));',
      '}',
      'vec2 rotateUvs(vec2 uv, float angle) {',
      '    float c = cos(angle);',
      '    float s = sin(angle);',
      '    mat2 rot = mat2(c, -s, s, c);',
      '    return rot * uv;',
      '}',
      'void main() {',
      '    float rnd = noise(gl_FragCoord.xy);',
      '    vec2 uv = rotateUvs(vUv * uScale, uRotation);',
      '    vec2 tex = uv * uScale;',
      '    float tOffset = uSpeed * uTime;',
      '    tex.y += 0.03 * sin(8.0 * tex.x - tOffset);',
      '    float pattern = 0.6 +',
      '        0.4 * sin(5.0 * (tex.x + tex.y +',
      '        cos(3.0 * tex.x + 5.0 * tex.y) +',
      '        0.02 * tOffset) +',
      '        sin(20.0 * (tex.x + tex.y - 0.1 * tOffset)));',
      '    vec4 col = vec4(uColor, 1.0) * vec4(pattern) - rnd / 15.0 * uNoiseIntensity;',
      '    col.a = 1.0;',
      '    gl_FragColor = col;',
      '}'
    ].join('\n');

    function compileShader(gl, type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed');
      }
      return shader;
    }
    function createProgram(gl) {
      var program = gl.createProgram();
      gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource));
      gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Shader program link failed');
      }
      return program;
    }

    var pane = map.createPane('silkPane');
    pane.classList.add('leaflet-silk-pane');

    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    pane.appendChild(canvas);

    var gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) {
      pane.remove();
      return;
    }

    var program = createProgram(gl);
    var positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    var positionLocation = gl.getAttribLocation(program, 'aPosition');
    var uniforms = {
      time: gl.getUniformLocation(program, 'uTime'),
      color: gl.getUniformLocation(program, 'uColor'),
      speed: gl.getUniformLocation(program, 'uSpeed'),
      scale: gl.getUniformLocation(program, 'uScale'),
      rotation: gl.getUniformLocation(program, 'uRotation'),
      noiseIntensity: gl.getUniformLocation(program, 'uNoiseIntensity')
    };
    var start = performance.now();
    var animationFrame = null;

    function resize() {
      var size = map.getSize();
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
      var width = Math.max(1, Math.floor(size.x * ratio));
      var height = Math.max(1, Math.floor(size.y * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    function syncPosition() {
      var topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
    }
    function render(now) {
      tickSilkTween(now);   // landing → map silk tween (live wraps rAF instead)
      resize();
      syncPosition();
      var p = window.silkParams || SILK_OPTIONS;
      var rgb = window.silkRGB || [1, 1, 1];
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, (now - start) * 0.0001);
      gl.uniform3f(uniforms.color, rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(uniforms.speed, p.speed);
      gl.uniform1f(uniforms.scale, p.scale);
      gl.uniform1f(uniforms.rotation, p.rotation);
      gl.uniform1f(uniforms.noiseIntensity, p.noiseIntensity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animationFrame = requestAnimationFrame(render);
    }

    map.on('resize move zoom viewreset', function () {
      resize();
      syncPosition();
    });
    resize();
    syncPosition();
    animationFrame = requestAnimationFrame(render);

    window.silkBaseLayer = {
      pane: pane,
      canvas: canvas,
      stop: function () { if (animationFrame) cancelAnimationFrame(animationFrame); }
    };
  })();

  // ── Landing overlay wiring (audit C.1) ───────────────────────────────────
  (function () {
    var overlay = document.getElementById('landing-overlay');
    var privacyBubble = document.getElementById('privacy-bubble');
    var privacyClose = document.getElementById('privacy-close-btn');
    var exploreBtn = document.getElementById('explore-btn');
    if (!overlay) return;

    setTimeout(function () { privacyBubble.style.opacity = '1'; }, 1000);

    privacyClose.addEventListener('click', function () {
      privacyBubble.style.transition = 'opacity 0.4s ease';
      privacyBubble.style.opacity = '0';
      setTimeout(function () { privacyBubble.style.display = 'none'; }, 400);
    });

    exploreBtn.addEventListener('click', function () {
      var fromP = { speed: window.silkParams.speed, scale: window.silkParams.scale, noiseIntensity: window.silkParams.noiseIntensity, rotation: 0 };
      var fromRGB = window.silkRGB.slice();
      startSilkTween(fromP, fromRGB, SILK_MAP, SILK_MAP_RGB, 1500);
      map.flyTo([DEFAULT_LAT, DEFAULT_LNG], DEFAULT_ZOOM, { duration: 1.8, easeLinearity: 0.25 });
      overlay.classList.add('dismissed');
      setTimeout(function () {
        overlay.style.display = 'none';
        document.body.classList.add('map-open');
      }, 1100);
    });
  })();

  // ── Data load ─────────────────────────────────────────────────────────────
  // Root-absolute paths so the same app.js works from /v2/ (preview) and /
  // (post-cutover) — the site owns the domain root (cutover landmine 2).
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
      return r.json();
    });
  }

  Promise.all([
    getJSON('/data/elevators.json'),
    getJSON('/data/stations.json'),
    getJSON('/data/routes.geojson')
  ]).then(function (results) {
    init(results[0], results[1], results[2]);
  });

  function init(data, stationData, routesGeo) {
    var elevators = data.elevators;
    var stations = stationData.stations;
    var fleetMonthly = data.fleet.monthly_availability;
    var elevatorsById = {};
    elevators.forEach(function (el) { elevatorsById[el.id] = el; });

    // ── Subway track layer (audit C.3): live default is the JS-applied one ──
    var subwaySettings = { color: '#000000', weight: 1.0, defaultOpacity: 0.25 };
    var subwayLayer = L.geoJSON(routesGeo, {
      pane: 'subwayPane',
      style: function () {
        return { color: subwaySettings.color, weight: subwaySettings.weight, opacity: subwaySettings.defaultOpacity };
      }
    }).addTo(map);

    // ── Feature groups + markers (audit C.4) ────────────────────────────────
    var layerHigh = L.featureGroup();
    var layerMedium = L.featureGroup();
    var layerLow = L.featureGroup();
    var layerNoElevator = L.featureGroup();
    var tierGroups = { high: layerHigh, medium: layerMedium, low: layerLow };

    var routePreviewMarkers = [];
    var sizeBindings = [];

    var HIGH_MARKER_SIZE = 8;
    var SQUARE_HALF_SIZE = 3;

    function triangleIcon() {
      return L.divIcon({
        html: '<svg width="' + HIGH_MARKER_SIZE + '" height="' + HIGH_MARKER_SIZE + '" viewBox="0 0 6 6" ' +
          'xmlns="http://www.w3.org/2000/svg">' +
          '<polygon points="3,0.25 5.75,5.75 0.25,5.75" fill="#d12715"/></svg>',
        iconSize: [HIGH_MARKER_SIZE, HIGH_MARKER_SIZE],
        iconAnchor: [HIGH_MARKER_SIZE / 2, HIGH_MARKER_SIZE / 2],
        className: 'high-risk-triangle'
      });
    }

    // Native port of the live runtime shape patch (marker_shape_init_js):
    // medium = diamond, low = square, drawn as fixed half-size-3 paths and
    // zoom-scaled via the --marker-zoom-scale CSS var (sq-diamond rotates 45°).
    function makeShapeMarker(latlng, fillColor, rotate) {
      var marker = L.circleMarker(latlng, {
        radius: 2, stroke: false, color: '#777777', weight: 0,
        fill: true, fillColor: fillColor, fillOpacity: 0.5, pane: 'elevatorPane'
      });
      marker._updatePath = function () {
        L.CircleMarker.prototype._updatePath.call(this);
        var p = this._point, hs = SQUARE_HALF_SIZE;
        if (p && this._path) {
          this._path.setAttribute('d',
            'M' + (p.x - hs) + ',' + (p.y - hs) + ' L' + (p.x + hs) + ',' + (p.y - hs) +
            ' L' + (p.x + hs) + ',' + (p.y + hs) + ' L' + (p.x - hs) + ',' + (p.y + hs) + ' Z');
          this._path.removeAttribute('transform');
          this._path.classList.add(rotate ? 'sq-diamond' : 'sq-square');
        }
      };
      return marker;
    }

    elevators.forEach(function (el) {
      var tooltip = '<span class="marker-tooltip-content">' +
        '<b>' + esc(el.station) + '</b><br>' +
        esc(el.id) + ' &nbsp;&middot;&nbsp; Risk: <b>' + pct0(el.p) + '</b></span>';
      var marker;
      if (el.tier === 'high') {
        marker = L.marker([el.lat, el.lon], { icon: triangleIcon(), pane: 'elevatorPane' });
        sizeBindings.push({ marker: marker, type: 'triangle' });
      } else {
        marker = makeShapeMarker([el.lat, el.lon],
          el.tier === 'medium' ? '#f5968a' : '#ffffff',
          el.tier === 'medium');
        sizeBindings.push({ marker: marker, type: 'square' });
      }
      marker.bindTooltip(tooltip, { sticky: true, className: 'marker-tooltip-box' });
      marker.stationRoutes = el.routes;
      marker.addTo(tierGroups[el.tier]);
      routePreviewMarkers.push(marker);
      marker.on('click', function () {
        var markerElement = marker.getElement && marker.getElement();
        if (markerElement && markerElement.blur) markerElement.blur();
        openPanel(marker, el);
      });
    });

    stations.forEach(function (st) {
      if (st.status !== 'no_elevator') return;
      var routesText = st.routes.length ? st.routes.join(' ') : '—';
      var tooltip = '<span class="marker-tooltip-content">' +
        '<b>' + esc(st.name) + '</b><br>' +
        'Routes ' + esc(routesText) + ' &nbsp;&middot;&nbsp; No elevator</span>';
      var marker = L.circleMarker([st.lat, st.lon], {
        radius: 1.5, stroke: false, color: '#777777', weight: 0,
        fill: true, fillColor: '#000000', fillOpacity: 0.25, pane: 'elevatorPane'
      });
      marker.bindTooltip(tooltip, { sticky: true, className: 'marker-tooltip-box' });
      marker.stationRoutes = st.routes;
      marker.addTo(layerNoElevator);
      routePreviewMarkers.push(marker);
      sizeBindings.push({ marker: marker, type: 'circle' });
    });

    layerHigh.addTo(map);
    layerMedium.addTo(map);
    layerLow.addTo(map);
    layerNoElevator.addTo(map);

    // ── Zoom-scale curve (port of MarkerZoomScaleController; audit C.4) ─────
    var ZOOM_SCALE_POINTS = [
      [10, 0.75], [11, 1.0], [12, 1.15], [13, 1.3], [14, 1.5],
      [15, 1.7], [16, 1.9], [17, 2.1], [18, 2.3]
    ];
    function zoomMultiplier(zoom) {
      if (zoom <= ZOOM_SCALE_POINTS[0][0]) return ZOOM_SCALE_POINTS[0][1];
      var lastPoint = ZOOM_SCALE_POINTS[ZOOM_SCALE_POINTS.length - 1];
      if (zoom >= lastPoint[0]) return lastPoint[1];
      for (var index = 1; index < ZOOM_SCALE_POINTS.length; index += 1) {
        var upper = ZOOM_SCALE_POINTS[index];
        if (zoom <= upper[0]) {
          var lower = ZOOM_SCALE_POINTS[index - 1];
          var progress = (zoom - lower[0]) / (upper[0] - lower[0]);
          return lower[1] + progress * (upper[1] - lower[1]);
        }
      }
      return 1;
    }
    function applyMarkerScale() {
      var multiplier = zoomMultiplier(map.getZoom());
      sizeBindings.forEach(function (binding) {
        if (binding.type === 'circle') {
          binding.marker.setRadius(2 * multiplier);
        } else if (binding.type === 'square') {
          var pathEl = binding.marker._path;
          if (pathEl) pathEl.style.setProperty('--marker-zoom-scale', multiplier);
        } else {
          var markerElement = binding.marker.getElement && binding.marker.getElement();
          var triangleSvg = markerElement && markerElement.querySelector('svg');
          if (triangleSvg) triangleSvg.style.setProperty('--marker-zoom-scale', multiplier);
        }
      });
    }
    map.on('zoomend', applyMarkerScale);
    map.on('layeradd', applyMarkerScale);
    applyMarkerScale();

    // ── Hover halo/dim + route preview (port of SubwayHighlightController;
    //    audit C.5) ────────────────────────────────────────────────────────
    var activeType = null;
    var activeValue = null;
    var activeSwatchEl = null;
    var selectedMarker = null;
    var routeColorMap = {};
    Object.keys(MTA_LINE_COLORS).forEach(function (route) {
      routeColorMap[route] = MTA_LINE_COLORS[route].toUpperCase();
    });

    function lineStyle(opacity) {
      return { color: subwaySettings.color, opacity: opacity, weight: subwaySettings.weight };
    }
    function markerVisualElement(marker) {
      var markerElement = marker.getElement && marker.getElement();
      if (!markerElement) return null;
      return markerElement.classList.contains('high-risk-triangle')
        ? markerElement.querySelector('svg')
        : markerElement;
    }
    function setOtherMarkersDimmed(activeMarker, dimmed) {
      routePreviewMarkers.forEach(function (marker) {
        var markerElement = markerVisualElement(marker);
        if (!markerElement) return;
        markerElement.style.transition = 'opacity 180ms ease-out, filter 180ms ease-out, transform 180ms ease-out';
        markerElement.classList.toggle('marker-is-dimmed', dimmed && marker !== activeMarker);
      });
    }
    function applyLineMotion(layer) {
      var element = layer.getElement && layer.getElement();
      if (!element) return;
      element.style.transition = 'stroke 180ms ease-out, stroke-opacity 180ms ease-out';
    }
    function updateMarkerOutlines() {
      document.documentElement.style.setProperty('--subway-default-color', subwaySettings.color);
      routePreviewMarkers.forEach(function (marker) {
        if (marker.setStyle) marker.setStyle({ color: subwaySettings.color });
      });
    }
    function clearActiveSwatch() {
      document.querySelectorAll('.subway-legend-swatch').forEach(function (swatch) {
        swatch.classList.remove('is-active');
      });
    }
    function resetSubwayLines() {
      subwayLayer.eachLayer(function (layer) {
        layer.setStyle(lineStyle(subwaySettings.defaultOpacity));
        applyLineMotion(layer);
      });
      activeType = null;
      activeValue = null;
      activeSwatchEl = null;
      clearActiveSwatch();
    }
    function applyColorHighlight(colors) {
      var colorSet = {};
      colors.forEach(function (c) { colorSet[c] = true; });
      subwayLayer.eachLayer(function (layer) {
        var properties = layer.feature && layer.feature.properties;
        var name = properties && properties.name ? properties.name.trim() : '';
        var color = properties && properties.color ? properties.color.toUpperCase() : '';
        var matches = name && colorSet[color];
        layer.setStyle(matches
          ? { color: properties.color, opacity: 1.0, weight: subwaySettings.weight }
          : lineStyle(0.12));
        applyLineMotion(layer);
      });
    }
    function restoreActiveHighlight() {
      if (selectedMarker) {
        previewMarkerRoutes(selectedMarker);
        return;
      }
      if (activeType === 'color' && activeValue) {
        applyColorHighlight([activeValue]);
      } else {
        subwayLayer.eachLayer(function (layer) {
          layer.setStyle(lineStyle(subwaySettings.defaultOpacity));
          applyLineMotion(layer);
        });
      }
    }
    function highlightSubwayLines(type, value, activeSwatch) {
      if (type === 'preview') {
        applyColorHighlight(value);
        return;
      }
      if (activeType === type && activeValue === value) {
        if (activeSwatch && activeSwatch === activeSwatchEl) resetSubwayLines();
        return;
      }
      activeType = type;
      activeValue = value;
      activeSwatchEl = activeSwatch;
      clearActiveSwatch();
      if (activeSwatch) activeSwatch.classList.add('is-active');
      applyColorHighlight([value]);
    }
    function previewMarkerRoutes(marker) {
      var seen = {};
      var previewColors = [];
      (marker.stationRoutes || []).forEach(function (route) {
        var color = routeColorMap[route];
        if (color && !seen[color]) { seen[color] = true; previewColors.push(color); }
      });
      if (previewColors.length) highlightSubwayLines('preview', previewColors, null);
    }

    document.addEventListener('elevator-detail-open', function (event) {
      if (selectedMarker && selectedMarker !== event.detail.marker) {
        var previousElement = markerVisualElement(selectedMarker);
        if (previousElement) previousElement.classList.remove('marker-hover-halo');
      }
      selectedMarker = event.detail.marker;
      var markerElement = markerVisualElement(selectedMarker);
      if (markerElement) markerElement.classList.add('marker-hover-halo');
      setOtherMarkersDimmed(selectedMarker, true);
      previewMarkerRoutes(selectedMarker);
    });
    document.addEventListener('elevator-detail-close', function () {
      if (selectedMarker) {
        var markerElement = markerVisualElement(selectedMarker);
        if (markerElement) markerElement.classList.remove('marker-hover-halo');
      }
      selectedMarker = null;
      setOtherMarkersDimmed(null, false);
      restoreActiveHighlight();
    });

    // ── Route-badge filter grid (audit C.9) ─────────────────────────────────
    // Persistent trunk-color filter; highlightSubwayLines handles the
    // toggle-off (same badge), switch (other badge) and hover-preview
    // re-assert semantics exactly as the live SubwayHighlightController.
    document.querySelectorAll('.subway-legend-swatch').forEach(function (swatch) {
      swatch.addEventListener('click', function (event) {
        event.stopPropagation();
        highlightSubwayLines('color', swatch.dataset.subwayColor.toUpperCase(), swatch);
      });
    });
    var rightPanel = document.getElementById('right-top-panel');
    L.DomEvent.disableClickPropagation(rightPanel);
    L.DomEvent.disableScrollPropagation(rightPanel);

    // ── Station search (hand-rolled autocomplete over stations.json;
    //    audit C.8, spec §2.2). Replaces leaflet-search: same slot/skin,
    //    same zoom-17 setView, no result marker. The index excludes the 10
    //    unscored complexes (435 entries) until 3c makes them searchable. ──
    (function () {
      var slot = document.getElementById('station-search-slot');
      if (!slot) return;
      var input = slot.querySelector('input.search-input');
      var cancelBtn = slot.querySelector('.search-cancel');
      var tooltip = slot.querySelector('.search-tooltip');

      function normalizeSearch(value) {           // normalize_search_text()
        return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
          .replace(/^ +| +$/g, '');
      }

      var searchIndex = stations
        .filter(function (st) { return st.status !== 'unscored'; })
        .map(function (st) {
          return {
            label: st.name + ' (' + st.routes.join(',') + ')',
            text: st.search || normalizeSearch(st.name),
            lat: st.lat,
            lon: st.lon
          };
        });
      window._stationSearch = { count: searchIndex.length };

      var currentMatches = [];
      var selectedIdx = -1;

      function hideTips() {
        tooltip.style.display = 'none';
        tooltip.innerHTML = '';
        currentMatches = [];
        selectedIdx = -1;
      }
      function markSelected() {
        var tips = tooltip.children;
        for (var i = 0; i < tips.length; i += 1) {
          tips[i].classList.toggle('search-tip-select', i === selectedIdx);
        }
        if (selectedIdx >= 0 && tips[selectedIdx] && tips[selectedIdx].scrollIntoView) {
          tips[selectedIdx].scrollIntoView({ block: 'nearest' });
        }
      }
      function chooseStation(match) {
        input.value = match.label;
        hideTips();
        cancelBtn.style.display = '';
        // leaflet-search parity: instant setView at search_zoom, no marker.
        map.setView([match.lat, match.lon], 17);
      }
      function renderTips(matches) {
        if (!matches.length) { hideTips(); return; }
        tooltip.innerHTML = '';
        matches.forEach(function (match, idx) {
          var tip = document.createElement('a');
          tip.className = 'search-tip';
          tip.href = '#';
          tip.textContent = match.label;
          tip.style.display = 'block';
          tip.addEventListener('mousedown', function (event) {
            event.preventDefault();               // keep input focus; beat blur
            chooseStation(matches[idx]);
          });
          tooltip.appendChild(tip);
        });
        tooltip.style.display = '';
        tooltip.scrollTop = 0;
        selectedIdx = -1;
      }

      input.addEventListener('input', function () {
        cancelBtn.style.display = input.value ? '' : 'none';
        var q = normalizeSearch(input.value);
        if (!q) { hideTips(); return; }
        currentMatches = searchIndex
          .filter(function (m) { return m.text.indexOf(q) !== -1; })
          .sort(function (a, b) {
            var pa = a.text.indexOf(q), pb = b.text.indexOf(q);
            return pa - pb || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
          });
        renderTips(currentMatches);
      });
      input.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (!currentMatches.length) return;
          event.preventDefault();
          var step = event.key === 'ArrowDown' ? 1 : -1;
          selectedIdx = (selectedIdx + step + currentMatches.length) % currentMatches.length;
          markSelected();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          if (!currentMatches.length) return;
          chooseStation(currentMatches[selectedIdx >= 0 ? selectedIdx : 0]);
        } else if (event.key === 'Escape') {
          hideTips();
        }
      });
      input.addEventListener('blur', function () {
        setTimeout(hideTips, 150);
      });
      cancelBtn.addEventListener('click', function (event) {
        event.preventDefault();
        input.value = '';
        cancelBtn.style.display = 'none';
        hideTips();
        input.focus();
      });
    })();

    routePreviewMarkers.forEach(function (marker) {
      function handleMarkerEnter() {
        var markerElement = markerVisualElement(marker);
        if (markerElement) markerElement.classList.add('marker-hover-halo');
        setOtherMarkersDimmed(marker, true);
        previewMarkerRoutes(marker);
      }
      function handleMarkerLeave() {
        if (marker === selectedMarker) return;
        var markerElement = markerVisualElement(marker);
        if (markerElement) markerElement.classList.remove('marker-hover-halo');
        if (selectedMarker) {
          setOtherMarkersDimmed(selectedMarker, true);
        } else {
          setOtherMarkersDimmed(null, false);
        }
        restoreActiveHighlight();
      }
      marker.on('mouseover', handleMarkerEnter);
      marker.on('mouseout', handleMarkerLeave);
    });

    restoreActiveHighlight();
    updateMarkerOutlines();
    window._tweakSubway = { settings: subwaySettings, restore: restoreActiveHighlight };

    // ── Legend card + layer toggles (port of MarkerLayerControl; audit C.7) ─
    var counts = { high: 0, medium: 0, low: 0 };
    elevators.forEach(function (el) { counts[el.tier] += 1; });
    var noElevatorCount = stations.filter(function (st) { return st.status === 'no_elevator'; }).length;

    document.getElementById('legend-subtitle').textContent =
      'Forecasted risk of elevator failure in ' + monthLabel(data.target_month) +
      ' (' + elevators.length + ' elevators across ' + data.station_count + ' stations)';
    var landingSubtitle = document.getElementById('landing-subtitle');
    if (landingSubtitle) {
      landingSubtitle.textContent =
        'See predicted outage risk scores for ' + monthLabel(data.target_month);
    }
    document.getElementById('hairline-bottom').innerHTML =
      'Data Source: Monthly risk scores for the ' + elevators.length + ' elevators are estimated via ' +
      '<a href="' + REPO_URL + '" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">' +
      esc(data.model.type) + ' model</a>, using public ' +
      '<a href="' + DATASET_URL + '" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">MTA maintenance records</a> ' +
      'through ' + monthLabel(data.records_through) + '.';

    var markerLayers = [
      { id: 'high', layer: layerHigh, label: 'High risk &middot; ' + counts.high },
      { id: 'medium', layer: layerMedium, label: 'Medium risk &middot; ' + counts.medium },
      { id: 'low', layer: layerLow, label: 'Low risk &middot; ' + counts.low },
      { id: 'no-elevator', layer: layerNoElevator, label: 'No-elevator stations &middot; ' + noElevatorCount }
    ];
    var buttonContainer = document.getElementById('marker-layer-buttons');
    L.DomEvent.disableClickPropagation(buttonContainer);
    L.DomEvent.disableScrollPropagation(buttonContainer);
    markerLayers.forEach(function (item) {
      var button = buttonContainer.querySelector('[data-marker-layer="' + item.id + '"]');
      button.children[1].innerHTML = item.label;
      button.addEventListener('click', function () {
        var visible = map.hasLayer(item.layer);
        if (visible) {
          map.removeLayer(item.layer);
        } else {
          map.addLayer(item.layer);
        }
        button.setAttribute('aria-pressed', visible ? 'false' : 'true');
      });
    });
    layerNoElevator.on('mouseover', function () { document.body.classList.add('cursor-no-elevator'); });
    layerNoElevator.on('mouseout', function () { document.body.classList.remove('cursor-no-elevator'); });
    // Debug globals the live page also exposes (audit C.12) — kept for parity
    // and for the screenshot/verification scripts.
    window._tweakLayers = {
      high: layerHigh,
      medium: layerMedium,
      low: layerLow,
      noElevator: layerNoElevator,
      map: map
    };

    // ── Detail drawer (port of ElevatorDetailPanelController + the
    //    make_detail_html template family; audit C.6) ────────────────────────
    var panel = document.getElementById('elevator-detail-panel');
    var mapTitle = document.getElementById('map-title');
    var rightTopPanel = document.getElementById('right-top-panel');
    var content = document.getElementById('elevator-detail-content');
    var previousCenter = null;
    var previousZoom = null;

    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);

    window.toggleAccordion = function (trigger) {
      var expanded = trigger.getAttribute('aria-expanded') === 'true';
      var body = document.getElementById(trigger.getAttribute('aria-controls'));
      trigger.setAttribute('aria-expanded', String(!expanded));
      if (body) body.classList.toggle('open', !expanded);
    };

    function openPanel(marker, el) {
      previousCenter = map.getCenter();
      previousZoom = map.getZoom();
      var targetZoom = 14;
      var markerPoint = map.project(marker.getLatLng(), targetZoom);
      var visibleAreaCenter = markerPoint.add([panel.offsetWidth / 2, 0]);
      var targetCenter = map.unproject(visibleAreaCenter, targetZoom);

      content.innerHTML = renderDetail(el);
      panel.scrollTop = 0;

      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      mapTitle.classList.add('drawer-open');
      rightTopPanel.classList.add('drawer-open');
      marker.closeTooltip();
      document.dispatchEvent(new CustomEvent('elevator-detail-open', { detail: { marker: marker } }));
      map.flyTo(targetCenter, targetZoom, { duration: 1.2 });
    }
    function closePanel() {
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      mapTitle.classList.remove('drawer-open');
      rightTopPanel.classList.remove('drawer-open');
      document.dispatchEvent(new CustomEvent('elevator-detail-close'));
      if (previousCenter && previousZoom !== null) {
        map.flyTo(previousCenter, previousZoom, { duration: 1.2 });
      }
    }
    panel.addEventListener('click', function (event) {
      if (event.target && event.target.id === 'elevator-detail-close') {
        event.stopPropagation();
        closePanel();
      }
    });

    // ── Drawer template (client-side mirror of the build_map.py builders) ───
    function accordionHtml(title, bodyId, bodyHtml, innerClass) {
      if (!bodyHtml) return '';
      var cls = innerClass ? ' ' + innerClass : '';
      return '<div class="accordion-row">' +
        '<button class="accordion-trigger" aria-expanded="false" aria-controls="' + esc(bodyId) + '" onclick="toggleAccordion(this)">' +
        '<span class="sec-label" style="margin:0">' + esc(title) + '</span>' +
        '<span class="acc-icon" aria-hidden="true"><span class="acc-plus">+</span><span class="acc-minus">−</span></span>' +
        '</button>' +
        '<div class="accordion-body" id="' + esc(bodyId) + '" role="region">' +
        '<div class="sub-section"><div class="sub-inner' + cls + '">' + bodyHtml + '</div></div>' +
        '</div></div>';
    }

    function riskDriversHtml(el) {                       // risk_driver_html()
      return (el.drivers || []).map(function (driver) {
        return '<div class="risk-driver-row">' +
          '<div class="risk-driver-label">' + esc(driver.label) + '</div>' +
          '<div class="risk-driver-track"><span style="width:' + pyfmt(driver.w, 1) + '%"></span></div>' +
          '</div>';
      }).join('');
    }

    function lastMonthHtml(el) {                         // last_month_html()
      var lm = el.last_month;
      if (!lm) return '';
      var downtimeLabel = (lm.downtime_h === null || lm.downtime_h === undefined) ? '' : pyfmt(lm.downtime_h, 1) + 'h';
      var entrapmentLabel = lm.entrapments === 1 ? 'entrapment' : 'entrapments';
      return '<div class="flat-stats">' +
        '<div class="flat-stat' + (lm.entrapments > 0 ? ' is-alert' : '') + '"><strong>' + lm.entrapments + '</strong><span>' + entrapmentLabel + '</span></div>' +
        '<div class="flat-stat"><strong>' + lm.unplanned + '</strong><span>unplanned outages</span></div>' +
        '<div class="flat-stat"><strong>' + downtimeLabel + '</strong><span>total downtime</span></div>' +
        '</div>';
    }

    function trendSvgHtml(el) {                          // trend_svg_html()
      var trend = el.trend;
      if (!trend || trend.length < 2) return '';
      var width = 260, height = 44;
      var left = 12, right = 12, top = 8, bottom = 16;
      var chartW = width - left - right;
      var chartH = height - top - bottom;
      var n = trend.length;
      var values = trend.map(function (point) { return point.v; });
      var xs = [];
      for (var i = 0; i < n; i += 1) xs.push(left + (chartW * i) / (n - 1));

      var fleetVals = trend.map(function (point) {
        var v = fleetMonthly[point.m];
        return (v === undefined || v === null) ? null : v;
      });
      var fleetDomain = fleetVals.filter(function (v) { return v !== null; });

      var domain = values.concat(fleetDomain);
      var ymin = Math.max(0, Math.min.apply(null, domain) - 0.015);
      var ymax = Math.min(1, Math.max.apply(null, domain) + 0.015);
      if (ymax - ymin < 0.03) {
        var midpoint = (ymin + ymax) / 2;
        ymin = Math.max(0, midpoint - 0.015);
        ymax = Math.min(1, midpoint + 0.015);
      }
      function yFor(v) { return top + (ymax - v) / (ymax - ymin) * chartH; }

      var ys = values.map(yFor);
      var points = xs.map(function (x, idx) { return pyfmt(x, 1) + ',' + pyfmt(ys[idx], 1); }).join(' ');
      var finalX = xs[n - 1];
      var finalY = ys[n - 1];

      var fleetLine = '';
      var fleetPts = [];
      fleetVals.forEach(function (v, idx) {
        if (v !== null) fleetPts.push([xs[idx], yFor(v)]);
      });
      if (fleetPts.length) {
        var fleetPointsStr = fleetPts.map(function (pt) { return pyfmt(pt[0], 1) + ',' + pyfmt(pt[1], 1); }).join(' ');
        var labelY = Math.max(5, fleetPts[0][1] - 4);
        fleetLine = '<polyline class="fleet-line" points="' + fleetPointsStr + '"></polyline>' +
          '<text class="fleet-label" x="' + left + '" y="' + pyfmt(labelY, 1) + '">fleet avg</text>';
      }

      var labels = xs.map(function (x, idx) {
        var anchor = idx === 0 ? 'start' : (idx === n - 1 ? 'end' : 'middle');
        var cls = idx === n - 1 ? 'month-label is-current' : 'month-label';
        return '<text class="' + cls + '" x="' + pyfmt(x, 1) + '" y="' + (height - 5) + '" text-anchor="' + anchor + '">' + monthAbbr(trend[idx].m) + '</text>';
      }).join('');

      var valueX = Math.min(width - 46, Math.max(left, finalX - 34));
      var labelAbove = finalY - 9;
      var valueY = labelAbove >= 8 ? labelAbove : finalY + 12;

      var months = trend.map(function (point) { return point.m; });
      return '<svg class="availability-trend" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Six month availability trend">' +
        fleetLine +
        '<polyline class="trend-line" points="' + points + '"></polyline>' +
        '<circle class="trend-final-dot" cx="' + pyfmt(finalX, 1) + '" cy="' + pyfmt(finalY, 1) + '" r="3"></circle>' +
        '<text class="trend-final-value" x="' + pyfmt(valueX, 1) + '" y="' + pyfmt(valueY, 1) + '">' + pct1(values[n - 1]) + '</text>' +
        labels +
        '</svg>' +
        '<div class="trend-caption">Monthly availability · ' + esc(monthRangeLabel(months)) + '</div>';
    }

    function seasonalHtml(el) {                          // preventive_html()
      var values = el.seasonal;
      if (!values) return '';
      var maxValue = Math.max(Math.max.apply(null, values), 1.0);
      // Peak months come precomputed from the exporter (seasonal_top/near):
      // pandas' unstable tie ordering on unrounded means is not reproducible
      // from the 3-dp values shipped in the JSON.
      var topMonths = {};
      (el.seasonal_top || []).forEach(function (m) { topMonths[m] = true; });
      var nearMonths = {};
      (el.seasonal_near || []).forEach(function (m) { nearMonths[m] = true; });
      var bars = values.map(function (value, idx) {
        var monthNum = idx + 1;
        var cls = topMonths[monthNum] ? 'is-peak' : (nearMonths[monthNum] ? 'is-near-peak' : '');
        var label = topMonths[monthNum] ? '<b class="season-bar-label">' + pyfmt(value, 1) + '</b>' : '';
        var barHeight = Math.max(4, value / maxValue * 100);
        return '<div class="season-bar">' + label +
          '<span class="' + cls + '" style="height:' + pyfmt(barHeight, 1) + '%"></span>' +
          '<em>' + MONTH_INITIALS[idx] + '</em></div>';
      }).join('');
      return '<div class="season-chart">' + bars + '</div>' +
        '<div class="trend-caption">Avg unscheduled outages by month · ' + esc(el.seasonal_range) + '</div>';
    }

    function historicalHtml(el) {                        // historical_html()
      var totals = el.totals;
      if (!totals) return '';
      var hasAge = totals.overhaul_years !== undefined && totals.overhaul_years !== null;
      var ageValue = hasAge ? String(totals.overhaul_years) : 'Unknown';
      var ageLabel = hasAge ? 'years since last major overhaul' : 'major overhaul age unavailable';
      return '<div class="history-grid">' +
        '<div class="history-card' + (totals.entrapments > 0 ? ' is-alert' : '') + '"><strong>' + totals.entrapments + '</strong><span>entrapments since ' + totals.since + '</span></div>' +
        '<div class="history-card"><strong>' + totals.unplanned + '</strong><span>unplanned outages since ' + totals.since + '</span></div>' +
        '<div class="history-card"><strong>' + ageValue + '</strong><span>' + ageLabel + '</span></div>' +
        '</div>';
    }

    function nearbyHtml(el) {                            // nearby_html()
      var groups = el.nearby;
      if (!groups || !groups.length) return '';
      var currentRoutes = {};
      el.routes.forEach(function (route) { currentRoutes[route] = true; });

      var rows = groups.map(function (group) {
        var memberIds = [];
        Object.keys(group.ids).forEach(function (tier) {
          group.ids[tier].forEach(function (id) { memberIds.push(id); });
        });

        var label;
        if (group.current) {
          label = 'CURRENT STATION';
        } else {
          var member = elevatorsById[memberIds[0]];
          label = member ? member.station : '';
        }

        var distanceHtml = '';
        if (!group.current) {
          distanceHtml = '<div class="nearby-right"><div class="nearby-dist">' + pyfmt(group.mi, 1) + ' mi</div>' +
            '<div class="nearby-walk">~' + group.walk_min + ' min walk</div></div>';
        }

        var stationMetaHtml = '';
        if (!group.current) {
          var routeSet = {};
          memberIds.forEach(function (id) {
            var m = elevatorsById[id];
            if (m) m.routes.forEach(function (route) { routeSet[route] = true; });
          });
          var groupRoutes = sortRoutes(Object.keys(routeSet));
          var sameText = group.same_lines ? '<span class="nearby-same">includes same lines ✓</span>' : '';
          stationMetaHtml = '<div class="nearby-station-meta">' +
            '<span class="nearby-badges-inline">' + miniBadgesHtml(groupRoutes) + '</span>' +
            sameText + '</div>';
        }

        var equipmentLines = Object.keys(group.ids).map(function (tier) {
          var codes = group.ids[tier].map(function (id) { return esc(formatEquipmentCode(id)); }).join(', ');
          return '<div class="nearby-equipment-row">' +
            '<span class="nearby-risk nearby-' + tier + '">' + NEARBY_TIER_LABELS[tier] + '</span>' +
            '<span class="nearby-equipment">' + codes + '</span>' +
            '</div>';
        }).join('');

        var rowClass = group.current ? ' nearby-row-same-lines' : '';
        return '<div class="nearby-row' + rowClass + '">' +
          '<div class="nearby-left">' +
          '<div class="nearby-name-row"><span class="nearby-name">' + esc(label) + '</span></div>' +
          stationMetaHtml +
          '<div class="nearby-equipment-list">' + equipmentLines + '</div>' +
          '</div>' +
          distanceHtml +
          '</div>';
      }).join('');

      return '<section class="drawer-section drawer-section-nearby">' +
        '<h3>NEARBY ELEVATORS</h3>' +
        '<div class="nearby-list">' + rows + '</div>' +
        '</section>';
    }

    function renderDetail(el) {                          // make_detail_html()
      var suffix = el.id.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'elevator';
      var whyCopyIntro = 'This score is produced via a machine-learning model trained on MTA records ' +
        'through ' + monthLabel(data.records_through) + ', estimating the chance this elevator ' +
        'will have an entrapment or 2+ unscheduled outages in ' + monthLabel(data.target_month) + '.';
      return '<div class="maintenance-drawer tier-' + el.tier + '">' +
        '<div class="drawer-header">' +
        '<span class="station-name">' + esc(el.station) + '</span>' +
        '<div class="lines-row">' + headerBadgesHtml(el.routes) + '</div>' +
        '<button id="elevator-detail-close" type="button" aria-label="Close elevator details">&times;</button>' +
        '</div>' +
        '<header class="drawer-hero">' +
        '<div><div class="equipment-row">' +
        '<span class="equipment-code">' + esc(el.id) + '</span>' +
        '<span class="risk-badge">' + TIER_LABELS[el.tier] + '</span>' +
        '</div></div>' +
        '<div class="risk-score-block">' +
        '<strong>' + pct0(el.p) + '</strong>' +
        '<span>FAILURE PROBABILITY</span>' +
        '</div>' +
        '</header>' +
        '<section class="drawer-section drawer-section-risk">' +
        '<p class="why-copy">' + esc(whyCopyIntro) + '<br><br>' + esc('Key reliability signals:') + '</p>' +
        '<div class="risk-driver-list">' + riskDriversHtml(el) + '</div>' +
        '</section>' +
        accordionHtml('Last Month Performance', 'last-month-body-' + suffix, lastMonthHtml(el), '') +
        accordionHtml('6-Month Trend', 'trend-body-' + suffix, trendSvgHtml(el), 'no-top-pad') +
        accordionHtml('Seasonal Patterns', 'peak-body-' + suffix, seasonalHtml(el), 'no-top-pad') +
        accordionHtml('Historical Signals', 'signals-body-' + suffix, historicalHtml(el), '') +
        nearbyHtml(el) +
        '<div class="methodology-note"><a href="' + REPO_URL + '" target="_blank" rel="noopener noreferrer">ⓘ&nbsp;&nbsp;How scores are made (open source on GitHub ↗)</a></div>' +
        '</div>';
    }
  }
})();
