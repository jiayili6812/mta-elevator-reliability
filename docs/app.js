/* app.js — v2 renderer (S3b1 core + S3b2 chrome + S3c a11y/UX pass). One
 * data-driven port of the live map's six folium MacroElements plus the landing
 * overlay/silk tween, hand-rolled station search (replaces leaflet-search,
 * spec §2.2) and the route-badge filter; consumes /data/{elevators.json,
 * stations.json,routes.geojson}. Leaflet 1.9.x core only — no plugins.
 * Parity reference: planning/s3/audit.md §C.1–C.9; deliberate S3c deviations
 * carry their audit §D.3 ids (U1 keyboard, U2 risk-in-words, U4 reduced
 * motion, U6 SIR, U7 permalinks, U10 semantics + unscored markers, list view,
 * mobile bottom bar). */
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

  // U4 (S3c): motion preference — gates the silk shader loop, silk tweens,
  // and every flyTo. CSS transitions are collapsed by the media query.
  var motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function prefersReducedMotion() { return !!(motionQuery && motionQuery.matches); }

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
    if (prefersReducedMotion()) {
      // Jump straight to the end state — no animated tween.
      window.silkParams.speed = toP.speed;
      window.silkParams.scale = toP.scale;
      window.silkParams.noiseIntensity = toP.noiseIntensity;
      window.silkRGB = toRGB.slice();
      silkTween = null;
      return;
    }
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
    // U4 (S3c): the rAF loop only self-reschedules while animation is wanted.
    // Under prefers-reduced-motion the shader still draws (it IS the page
    // background) but as a static frame; kick() paints one frame after
    // map moves/resizes or a motion-preference flip. The loop also parks
    // while the tab is hidden (battery).
    function shouldAnimate() {
      return !document.hidden && !prefersReducedMotion();
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
      animationFrame = shouldAnimate() ? requestAnimationFrame(render) : null;
    }
    function kick() {
      if (animationFrame === null && !document.hidden) {
        animationFrame = requestAnimationFrame(render);
      }
    }

    map.on('resize move zoom viewreset', function () {
      resize();
      syncPosition();
      kick();   // repaint once even when the loop is parked (reduced motion)
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (animationFrame !== null) { cancelAnimationFrame(animationFrame); animationFrame = null; }
      } else {
        kick();
      }
    });
    if (motionQuery && motionQuery.addEventListener) {
      motionQuery.addEventListener('change', kick);
    }
    resize();
    syncPosition();
    animationFrame = requestAnimationFrame(render);

    window.silkBaseLayer = {
      pane: pane,
      canvas: canvas,
      kick: kick,
      stop: function () { if (animationFrame !== null) cancelAnimationFrame(animationFrame); }
    };
  })();

  // ── Landing overlay wiring (audit C.1; U10/U1 S3c) ───────────────────────
  // While the landing overlay is up, the map chrome behind it is `inert`, so
  // the first Tab press lands on Explore (U10) instead of the invisible map.
  // dismissLanding(instant) is shared with the U7 permalink boot path.
  var LANDING_INERT_IDS = ['map', 'map-title', 'right-top-panel', 'elevator-detail-panel'];
  var dismissLanding = null;
  (function () {
    var overlay = document.getElementById('landing-overlay');
    var privacyBubble = document.getElementById('privacy-bubble');
    var privacyClose = document.getElementById('privacy-close-btn');
    var exploreBtn = document.getElementById('explore-btn');
    if (!overlay) return;

    LANDING_INERT_IDS.forEach(function (id) {
      var node = document.getElementById(id);
      if (node) node.setAttribute('inert', '');
    });

    setTimeout(function () { privacyBubble.style.opacity = '1'; }, 1000);

    privacyClose.addEventListener('click', function () {
      privacyBubble.style.transition = 'opacity 0.4s ease';
      privacyBubble.style.opacity = '0';
      setTimeout(function () { privacyBubble.style.display = 'none'; }, 400);
    });

    var dismissed = false;
    dismissLanding = function (instant) {
      if (dismissed) return;
      dismissed = true;
      LANDING_INERT_IDS.forEach(function (id) {
        // The drawer stays inert until openPanel lifts it (U1 focus handling).
        if (id === 'elevator-detail-panel') return;
        var node = document.getElementById(id);
        if (node) node.removeAttribute('inert');
      });
      var fromP = { speed: window.silkParams.speed, scale: window.silkParams.scale, noiseIntensity: window.silkParams.noiseIntensity, rotation: 0 };
      var fromRGB = window.silkRGB.slice();
      startSilkTween(fromP, fromRGB, SILK_MAP, SILK_MAP_RGB, 1500);
      if (window.silkBaseLayer && window.silkBaseLayer.kick) window.silkBaseLayer.kick();
      if (instant || prefersReducedMotion()) {
        map.setView([DEFAULT_LAT, DEFAULT_LNG], DEFAULT_ZOOM, { animate: false });
        overlay.classList.add('dismissed');
        overlay.style.display = 'none';
        document.body.classList.add('map-open');
      } else {
        map.flyTo([DEFAULT_LAT, DEFAULT_LNG], DEFAULT_ZOOM, { duration: 1.8, easeLinearity: 0.25 });
        overlay.classList.add('dismissed');
        setTimeout(function () {
          overlay.style.display = 'none';
          document.body.classList.add('map-open');
        }, 1100);
      }
    };

    exploreBtn.addEventListener('click', function () {
      dismissLanding(false);
      // Keyboard journey continues from the map itself (Leaflet's container
      // is a tab stop); mouse users are unaffected.
      map.getContainer().focus({ preventScroll: true });
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
    var stationsById = {};
    stations.forEach(function (st) { stationsById[st.complex_id] = st; });
    var riskWords = data.risk_words || {};

    // U4 (S3c): every map movement honors prefers-reduced-motion.
    function flyOrSet(center, zoom, options, instant) {
      if (instant || prefersReducedMotion()) {
        map.setView(center, zoom, { animate: false });
      } else {
        map.flyTo(center, zoom, options);
      }
    }

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

    // Keyboard marker index (U1): one roving tab stop over every marker that
    // carries elevator information (scored + unscored complexes), walked with
    // the arrow keys, sorted by station name so the order is predictable.
    var focusEntries = [];
    var markersByElevatorId = {};

    elevators.forEach(function (el) {
      var words = riskWords[el.tier] || {};
      var tooltip = '<span class="marker-tooltip-content">' +
        '<b>' + esc(el.station) + '</b><br>' +
        esc(el.id) + ' &nbsp;&middot;&nbsp; Risk: <b>' + pct0(el.p) + '</b>' +
        (words.short ? '<br><span class="tooltip-tier-words">' + esc(words.short) + '</span>' : '') +
        '</span>';
      var marker;
      if (el.tier === 'high') {
        marker = L.marker([el.lat, el.lon], { icon: triangleIcon(), pane: 'elevatorPane', keyboard: false });
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
      markersByElevatorId[el.id] = { marker: marker, el: el };
      marker.on('click', function () {
        openPanel(marker, el);
      });
      focusEntries.push({
        marker: marker,
        sortKey: el.station + ' ' + el.display_id,
        label: el.station + ', elevator ' + el.display_id + ': ' +
          TIER_LABELS[el.tier].toLowerCase() + ', ' + pct0(el.p) + ' failure probability' +
          (words.short ? '. ' + words.short : '') + '. Press Enter for details.',
        activate: function () { openPanel(marker, el); }
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

    // Unscored elevator complexes (KNOWN_ISSUE fix, spec §8 decision 2):
    // muted hollow-ring markers, searchable, honest per-reason labels.
    var UNSCORED_REASONS = {
      third_party: 'Not scored — maintained by a third party, not NYCT',
      insufficient_history: 'Too new to score — needs 6 months of service history'
    };
    var layerUnscored = L.featureGroup();
    var unscoredCount = 0;
    stations.forEach(function (st) {
      if (st.status !== 'unscored') return;
      unscoredCount += 1;
      var codes = st.elevator_ids.map(formatEquipmentCode).join(', ');
      var reason = UNSCORED_REASONS[st.unscored_reason] || 'Not scored';
      var tooltip = '<span class="marker-tooltip-content">' +
        '<b>' + esc(st.name) + '</b><br>' +
        esc(codes) +
        '<br><span class="tooltip-tier-words">' + esc(reason) + '</span></span>';
      var marker = L.circleMarker([st.lat, st.lon], {
        radius: 3, stroke: true, color: '#6b6b6b', weight: 1.5,
        fill: true, fillColor: '#ffffff', fillOpacity: 0.85, pane: 'elevatorPane'
      });
      marker._keepOwnOutline = true;   // updateMarkerOutlines must not restyle the ring
      marker.bindTooltip(tooltip, { sticky: true, className: 'marker-tooltip-box' });
      marker.stationRoutes = st.routes;
      marker.addTo(layerUnscored);
      routePreviewMarkers.push(marker);
      sizeBindings.push({ marker: marker, type: 'circle', base: 3 });
      focusEntries.push({
        marker: marker,
        sortKey: st.name + ' unscored',
        label: st.name + ', elevator' + (st.elevator_ids.length === 1 ? ' ' : 's ') + codes + ': ' + reason + '.',
        activate: function () { marker.openTooltip(); }
      });
    });

    layerHigh.addTo(map);
    layerMedium.addTo(map);
    layerLow.addTo(map);
    layerNoElevator.addTo(map);
    layerUnscored.addTo(map);

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
          binding.marker.setRadius((binding.base || 2) * multiplier);
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
        if (marker._keepOwnOutline) return;   // unscored rings keep their muted stroke
        if (marker.setStyle) marker.setStyle({ color: subwaySettings.color });
      });
    }
    function syncBadgePressed() {
      document.querySelectorAll('.subway-legend-swatch').forEach(function (swatch) {
        swatch.setAttribute('aria-pressed', swatch.classList.contains('is-active') ? 'true' : 'false');
      });
    }
    function clearActiveSwatch() {
      document.querySelectorAll('.subway-legend-swatch').forEach(function (swatch) {
        swatch.classList.remove('is-active');
      });
      syncBadgePressed();
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
      syncBadgePressed();
      applyColorHighlight([value]);
    }
    function markerPreviewColors(marker) {
      var seen = {};
      var previewColors = [];
      (marker.stationRoutes || []).forEach(function (route) {
        var color = routeColorMap[route];
        if (color && !seen[color]) { seen[color] = true; previewColors.push(color); }
      });
      return previewColors;
    }
    function previewMarkerRoutes(marker) {
      var previewColors = markerPreviewColors(marker);
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
      swatch.setAttribute('aria-pressed', 'false');   // U10: filter toggles announce state
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
    //    same zoom-17 setView, no result marker. S3c: all 445 complexes are
    //    searchable (the 10 unscored included — spec §8 decision 2); the
    //    input is an ARIA combobox and a polite live region announces the
    //    result count (U10). ──
    (function () {
      var slot = document.getElementById('station-search-slot');
      if (!slot) return;
      var input = slot.querySelector('input.search-input');
      var cancelBtn = slot.querySelector('.search-cancel');
      var tooltip = slot.querySelector('.search-tooltip');
      var statusEl = document.getElementById('search-results-status');

      function normalizeSearch(value) {           // normalize_search_text()
        return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
          .replace(/^ +| +$/g, '');
      }

      var searchIndex = stations.map(function (st) {
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

      function announce(text) {
        if (statusEl) statusEl.textContent = text;
      }
      function hideTips() {
        tooltip.style.display = 'none';
        tooltip.innerHTML = '';
        currentMatches = [];
        selectedIdx = -1;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
      }
      function markSelected() {
        var tips = tooltip.children;
        for (var i = 0; i < tips.length; i += 1) {
          tips[i].classList.toggle('search-tip-select', i === selectedIdx);
          tips[i].setAttribute('aria-selected', i === selectedIdx ? 'true' : 'false');
        }
        if (selectedIdx >= 0 && tips[selectedIdx]) {
          input.setAttribute('aria-activedescendant', tips[selectedIdx].id);
          if (tips[selectedIdx].scrollIntoView) {
            tips[selectedIdx].scrollIntoView({ block: 'nearest' });
          }
        } else {
          input.removeAttribute('aria-activedescendant');
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
          tip.id = 'search-opt-' + idx;
          tip.setAttribute('role', 'option');
          tip.setAttribute('aria-selected', 'false');
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
        input.setAttribute('aria-expanded', 'true');
        input.removeAttribute('aria-activedescendant');
      }

      input.addEventListener('input', function () {
        cancelBtn.style.display = input.value ? '' : 'none';
        var q = normalizeSearch(input.value);
        if (!q) { hideTips(); announce(''); return; }
        currentMatches = searchIndex
          .filter(function (m) { return m.text.indexOf(q) !== -1; })
          .sort(function (a, b) {
            var pa = a.text.indexOf(q), pb = b.text.indexOf(q);
            return pa - pb || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
          });
        renderTips(currentMatches);
        announce(currentMatches.length === 0 ? 'No stations found'
          : currentMatches.length === 1 ? '1 station found'
            : currentMatches.length + ' stations found');
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
          if (currentMatches.length) {
            // Consume the Esc for the dropdown; a second Esc reaches the
            // document handler (closes the drawer / list view).
            event.stopPropagation();
            hideTips();
          }
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
        announce('');
        input.focus();
      });
    })();

    // Shared by mouse hover and keyboard focus (U1). U6 (S3c): a marker with
    // no displayable route colors (SIR / shuttle-only stations ship
    // routes: []) must not dim the rest of the map while highlighting no
    // track — those markers get the halo + tooltip only.
    function markerEnterVisuals(marker) {
      var markerElement = markerVisualElement(marker);
      if (markerElement) markerElement.classList.add('marker-hover-halo');
      var previewColors = markerPreviewColors(marker);
      if (previewColors.length) {
        setOtherMarkersDimmed(marker, true);
        highlightSubwayLines('preview', previewColors, null);
      }
    }
    function markerLeaveVisuals(marker) {
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
    routePreviewMarkers.forEach(function (marker) {
      marker.on('mouseover', function () { markerEnterVisuals(marker); });
      marker.on('mouseout', function () { markerLeaveVisuals(marker); });
    });

    restoreActiveHighlight();
    updateMarkerOutlines();
    window._tweakSubway = { settings: subwaySettings, restore: restoreActiveHighlight };

    // ── Roving tabindex over the marker index (U1, S3c) ─────────────────────
    // One tab stop for all 362 elevator-bearing markers: Tab reaches the
    // current marker, arrows walk stations alphabetically, Home/End jump,
    // Enter opens the drawer, Esc (document-level) closes it. Markers whose
    // tier layer is toggled off are skipped. Focus shows the hover halo and
    // tooltip; aria-labels carry station, elevator ids, tier and risk words.
    focusEntries.sort(function (a, b) {
      return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    });
    var currentFocusIdx = 0;
    function entryElement(entry) {
      return entry.marker.getElement && entry.marker.getElement();
    }
    function entryOnMap(entry) {
      return !!entry.marker._map && !!entryElement(entry);
    }
    function nextOnMapIdx(from, delta) {
      var n = focusEntries.length;
      var i = from;
      for (var step = 0; step < n; step += 1) {
        i = (i + delta + n) % n;
        if (entryOnMap(focusEntries[i])) return i;
      }
      return from;
    }
    function applyRovingTabindex() {
      // Chrome walks bare SVG paths (track lines, no-elevator dots) in the
      // tab order; pin them to -1 so Tab goes chrome → marker → controls.
      document.querySelectorAll('#map path.leaflet-interactive:not([tabindex])')
        .forEach(function (pathEl) { pathEl.setAttribute('tabindex', '-1'); });
      if (!entryOnMap(focusEntries[currentFocusIdx])) {
        currentFocusIdx = nextOnMapIdx(currentFocusIdx, 1);
      }
      focusEntries.forEach(function (entry, i) {
        var elm = entryElement(entry);
        if (!elm) return;
        elm.setAttribute('tabindex', i === currentFocusIdx ? '0' : '-1');
        if (elm._a11yWired) return;
        elm._a11yWired = true;
        elm.setAttribute('role', 'button');
        elm.setAttribute('aria-label', entry.label);
        elm.addEventListener('keydown', function (event) { markerKeydown(event, entry); });
        elm.addEventListener('focus', function () {
          currentFocusIdx = focusEntries.indexOf(entry);
          markerEnterVisuals(entry.marker);
          entry.marker.openTooltip();
        });
        elm.addEventListener('blur', function () {
          entry.marker.closeTooltip();
          markerLeaveVisuals(entry.marker);
        });
      });
    }
    function focusEntryAt(idx) {
      currentFocusIdx = idx;
      applyRovingTabindex();
      var entry = focusEntries[idx];
      var latlng = entry.marker.getLatLng();
      if (!map.getBounds().pad(-0.08).contains(latlng)) {
        map.panTo(latlng, { animate: !prefersReducedMotion() });
      }
      var elm = entryElement(entry);
      if (elm) elm.focus({ preventScroll: true });
    }
    function markerKeydown(event, entry) {
      var key = event.key;
      if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
        event.preventDefault();
        event.stopPropagation();
        entry.activate();
      } else if (key === 'ArrowRight' || key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        focusEntryAt(nextOnMapIdx(focusEntries.indexOf(entry), 1));
      } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        focusEntryAt(nextOnMapIdx(focusEntries.indexOf(entry), -1));
      } else if (key === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        focusEntryAt(nextOnMapIdx(focusEntries.length - 1, 1));
      } else if (key === 'End') {
        event.preventDefault();
        event.stopPropagation();
        focusEntryAt(nextOnMapIdx(0, -1));
      }
    }
    map.on('layeradd', function () {
      // Re-added tier layers rebuild L.Marker icons — rewire fresh elements.
      requestAnimationFrame(applyRovingTabindex);
    });
    applyRovingTabindex();

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
      { id: 'no-elevator', layer: layerNoElevator, label: 'No-elevator stations &middot; ' + noElevatorCount },
      { id: 'unscored', layer: layerUnscored, label: 'Not scored &middot; ' + unscoredCount }
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
      unscored: layerUnscored,
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
    var openerMarker = null;   // U1: focus returns here on close

    L.DomEvent.disableClickPropagation(panel);
    L.DomEvent.disableScrollPropagation(panel);
    panel.setAttribute('inert', '');   // closed drawer is out of the tab order

    window.toggleAccordion = function (trigger) {
      var expanded = trigger.getAttribute('aria-expanded') === 'true';
      var body = document.getElementById(trigger.getAttribute('aria-controls'));
      trigger.setAttribute('aria-expanded', String(!expanded));
      if (body) body.classList.toggle('open', !expanded);
    };

    // U7 (S3c): the open drawer is a permalink — ?station=<complex_id> for
    // humans, #el=<equipment_code> to pin the exact elevator. replaceState
    // keeps Back for leaving the site, not for un-opening drawers.
    function updateUrlForPanel(el) {
      history.replaceState(null, '',
        location.pathname + '?station=' + el.complex_id + '#el=' + encodeURIComponent(el.id));
    }
    function clearUrlState() {
      history.replaceState(null, '', location.pathname);
    }

    function openPanel(marker, el, instant) {
      previousCenter = map.getCenter();
      previousZoom = map.getZoom();
      openerMarker = marker;
      var targetZoom = 14;
      var markerPoint = map.project(marker.getLatLng(), targetZoom);
      var visibleAreaCenter = markerPoint.add([panel.offsetWidth / 2, 0]);
      var targetCenter = map.unproject(visibleAreaCenter, targetZoom);

      content.innerHTML = renderDetail(el);
      panel.scrollTop = 0;

      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      panel.removeAttribute('inert');
      mapTitle.classList.add('drawer-open');
      rightTopPanel.classList.add('drawer-open');
      marker.closeTooltip();
      document.dispatchEvent(new CustomEvent('elevator-detail-open', { detail: { marker: marker } }));
      flyOrSet(targetCenter, targetZoom, { duration: 1.2 }, instant);
      updateUrlForPanel(el);
      panel.focus({ preventScroll: true });   // U1: focus moves into the dialog
    }
    function closePanel() {
      // U1: move focus back to the opening marker before hiding the drawer.
      var openerElement = openerMarker && openerMarker._map &&
        openerMarker.getElement && openerMarker.getElement();
      if (openerElement && openerElement.focus) {
        openerElement.focus({ preventScroll: true });
      } else {
        map.getContainer().focus({ preventScroll: true });
      }
      openerMarker = null;
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      panel.setAttribute('inert', '');
      mapTitle.classList.remove('drawer-open');
      rightTopPanel.classList.remove('drawer-open');
      document.dispatchEvent(new CustomEvent('elevator-detail-close'));
      if (previousCenter && previousZoom !== null) {
        flyOrSet(previousCenter, previousZoom, { duration: 1.2 });
      }
      clearUrlState();
    }
    panel.addEventListener('click', function (event) {
      if (event.target && event.target.id === 'elevator-detail-close') {
        event.stopPropagation();
        closePanel();
      }
    });
    // U1: Esc closes the drawer from anywhere (the search dropdown consumes
    // its own Esc first; the list view handler below runs earlier in the
    // capture order via its own check).
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      var listView = document.getElementById('station-list-view');
      if (listView && !listView.hidden) return;   // list view owns this Esc
      if (panel.classList.contains('is-open')) closePanel();
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
      var words = riskWords[el.tier] || {};
      return '<div class="maintenance-drawer tier-' + el.tier + '">' +
        '<div class="drawer-header">' +
        // U10: the drawer dialog is labelled by the station name.
        '<span class="station-name" id="drawer-title">' + esc(el.station) + '</span>' +
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
        // U2: plain-language tier sentence (wording ships in elevators.json).
        (words.sentence ? '<p class="risk-words">' + esc(words.sentence) + '</p>' : '') +
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

    // ── Station list view (PLAN 3c; audit E2 crawlable hook) ────────────────
    // Accessible table of every elevator, riskiest first, opened from the
    // legend. Built eagerly so the content exists in the DOM for crawlers.
    (function () {
      var listView = document.getElementById('station-list-view');
      var openBtn = document.getElementById('open-station-list');
      var closeBtn = document.getElementById('station-list-close');
      var note = document.getElementById('station-list-note');
      var tbody = document.querySelector('#station-list-table tbody');
      if (!listView || !openBtn || !tbody) return;

      note.textContent = elevators.length + ' scored elevators, highest predicted ' +
        'failure risk for ' + monthLabel(data.target_month) + ' first. The ' +
        'unscored elevators at ' + unscoredCount + ' stations are listed at the end.';

      var sorted = elevators.slice().sort(function (a, b) {
        return b.p - a.p || (a.station < b.station ? -1 : a.station > b.station ? 1 : 0);
      });
      function addRow(cells, tierClass, tierText, showHandler) {
        var tr = document.createElement('tr');
        var th = document.createElement('th');
        th.scope = 'row';
        th.textContent = cells.station;
        tr.appendChild(th);
        [cells.routes, cells.code].forEach(function (text) {
          var td = document.createElement('td');
          td.textContent = text;
          tr.appendChild(td);
        });
        var tierTd = document.createElement('td');
        var tierSpan = document.createElement('span');
        tierSpan.className = 'list-tier ' + tierClass;
        tierSpan.textContent = tierText;
        tierTd.appendChild(tierSpan);
        tr.appendChild(tierTd);
        var pTd = document.createElement('td');
        pTd.className = 'num';
        pTd.textContent = cells.p;
        tr.appendChild(pTd);
        var btnTd = document.createElement('td');
        var showBtn = document.createElement('button');
        showBtn.type = 'button';
        showBtn.className = 'list-show-btn';
        showBtn.textContent = 'Show on map';
        showBtn.setAttribute('aria-label', 'Show ' + cells.station + ' ' + cells.code + ' on the map');
        showBtn.addEventListener('click', showHandler);
        btnTd.appendChild(showBtn);
        tr.appendChild(btnTd);
        tbody.appendChild(tr);
      }
      sorted.forEach(function (el) {
        addRow(
          { station: el.station, routes: el.routes.join(' '), code: el.display_id, p: pct0(el.p) },
          'list-tier-' + el.tier, TIER_LABELS[el.tier],
          function () {
            closeListView(true);
            var target = markersByElevatorId[el.id];
            if (target) openPanel(target.marker, target.el);
          }
        );
      });
      stations.forEach(function (st) {
        if (st.status !== 'unscored') return;
        var reason = UNSCORED_REASONS[st.unscored_reason] || 'Not scored';
        st.elevator_ids.forEach(function (id) {
          addRow(
            { station: st.name, routes: st.routes.join(' '), code: formatEquipmentCode(id), p: '—' },
            'list-tier-unscored', reason,
            function () {
              closeListView(true);
              map.setView([st.lat, st.lon], 15, { animate: false });
            }
          );
        });
      });

      var INERT_BEHIND_LIST = ['map', 'map-title', 'right-top-panel', 'elevator-detail-panel'];
      function openListView() {
        listView.hidden = false;
        INERT_BEHIND_LIST.forEach(function (id) {
          var node = document.getElementById(id);
          if (node) node.setAttribute('inert', '');
        });
        closeBtn.focus();
      }
      function closeListView(skipRefocus) {
        listView.hidden = true;
        INERT_BEHIND_LIST.forEach(function (id) {
          // The drawer manages its own inert state (stays inert unless open).
          if (id === 'elevator-detail-panel' && !panel.classList.contains('is-open')) return;
          var node = document.getElementById(id);
          if (node) node.removeAttribute('inert');
        });
        if (!skipRefocus) openBtn.focus();
      }
      openBtn.addEventListener('click', openListView);
      closeBtn.addEventListener('click', function () { closeListView(false); });
      listView.addEventListener('click', function (event) {
        if (event.target === listView) closeListView(false);   // scrim click
      });
      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && !listView.hidden) closeListView(false);
      });
      L.DomEvent.disableClickPropagation(listView);
      L.DomEvent.disableScrollPropagation(listView);
    })();

    // ── Mobile bottom-bar chrome (owner request 2026-07-15) ─────────────────
    // ≤640px the search box and badge grid collapse into two thumb pills at
    // the bottom (CSS moves #right-top-panel down there); the pills expand
    // one panel at a time.
    (function () {
      var searchToggle = document.getElementById('mobile-search-toggle');
      var filterToggle = document.getElementById('mobile-filter-toggle');
      if (!searchToggle || !filterToggle) return;
      function setMobilePanel(which) {
        document.body.classList.toggle('mobile-search-open', which === 'search');
        document.body.classList.toggle('mobile-filter-open', which === 'filter');
        searchToggle.setAttribute('aria-expanded', which === 'search' ? 'true' : 'false');
        filterToggle.setAttribute('aria-expanded', which === 'filter' ? 'true' : 'false');
        if (which === 'search') {
          var input = document.querySelector('#station-search-slot input.search-input');
          if (input) input.focus();
        }
      }
      searchToggle.addEventListener('click', function () {
        setMobilePanel(document.body.classList.contains('mobile-search-open') ? null : 'search');
      });
      filterToggle.addEventListener('click', function () {
        setMobilePanel(document.body.classList.contains('mobile-filter-open') ? null : 'filter');
      });
    })();

    // ── Permalink boot (U7): /?station=<complex_id> and /#el=<code> ─────────
    // A valid deep link skips the landing intro and opens the target state
    // directly (instant view; no fly animation on load).
    (function () {
      var hashMatch = location.hash.match(/^#el=([^&]+)/);
      var code = hashMatch ? decodeURIComponent(hashMatch[1]) : null;
      var params = new URLSearchParams(location.search);
      var stationId = parseInt(params.get('station'), 10);
      var target = code && markersByElevatorId[code];
      if (!target && !isNaN(stationId)) {
        var best = null;
        elevators.forEach(function (el) {
          if (el.complex_id === stationId && (!best || el.p > best.p)) best = el;
        });
        if (best) target = markersByElevatorId[best.id];
      }
      if (target) {
        if (dismissLanding) dismissLanding(true);
        openPanel(target.marker, target.el, true);
        return;
      }
      if (!isNaN(stationId) && stationsById[stationId]) {
        var st = stationsById[stationId];
        if (dismissLanding) dismissLanding(true);
        map.setView([st.lat, st.lon], 15, { animate: false });
        var unscoredEntry = null;
        focusEntries.forEach(function (entry) {
          if (st.status === 'unscored' && entry.sortKey === st.name + ' unscored') unscoredEntry = entry;
        });
        if (unscoredEntry) unscoredEntry.marker.openTooltip();
      }
    })();
  }
})();
