const data = window.MAP_DATA;

const typeLabels = {
  area: "面积",
  lease: "租约到期",
  tenantType: "业态",
  salesEfficiency: "月坪效",
  monthlyRent: "月租金",
  rentSales: "租销比",
  traffic: "人流量",
};

const preferredTypeOrder = [
  "area",
  "lease",
  "tenantType",
  "salesEfficiency",
  "monthlyRent",
  "rentSales",
  "traffic",
];

const floorOrder = ["B1", "1F", "2F", "3F"];

const els = {
  analysis: document.querySelector("#analysisSelect"),
  floor: document.querySelector("#floorSelect"),
  search: document.querySelector("#searchInput"),
  mapCount: document.querySelector("#mapCount"),
  regionCount: document.querySelector("#regionCount"),
  legend: document.querySelector("#legendList"),
  title: document.querySelector("#currentTitle"),
  subtitle: document.querySelector("#currentSubtitle"),
  viewport: document.querySelector("#mapViewport"),
  content: document.querySelector("#mapContent"),
  image: document.querySelector("#mapImage"),
  hitLayer: document.querySelector("#hitLayer"),
  selectedTitle: document.querySelector("#selectedTitle"),
  detailRows: document.querySelector("#detailRows"),
  cropCanvas: document.querySelector("#cropCanvas"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  fitMap: document.querySelector("#fitMap"),
};

let currentMap = null;
let selectedRegion = null;
let scale = 1;
let panX = 0;
let panY = 0;
let drag = null;
let movedDuringPointer = false;

function init() {
  const types = preferredTypeOrder.filter((type) =>
    data.maps.some((map) => map.type === type),
  );

  els.analysis.innerHTML = types
    .map((type) => `<option value="${type}">${typeLabels[type] || type}</option>`)
    .join("");

  els.mapCount.textContent = data.maps.length;
  els.analysis.value = data.maps.some((map) => map.type === "area") ? "area" : types[0];
  updateFloorOptions("1F");
  wireEvents();
}

function wireEvents() {
  els.analysis.addEventListener("change", () => updateFloorOptions());
  els.floor.addEventListener("change", () => {
    const map = findMap(els.analysis.value, els.floor.value);
    if (map) renderMap(map);
  });
  els.search.addEventListener("input", applySearchFilter);
  els.zoomIn.addEventListener("click", () => zoomAtCenter(1.18));
  els.zoomOut.addEventListener("click", () => zoomAtCenter(1 / 1.18));
  els.fitMap.addEventListener("click", fitMapToViewport);
  window.addEventListener("resize", fitMapToViewport);

  els.viewport.addEventListener("wheel", handleWheel, { passive: false });
  els.viewport.addEventListener("pointerdown", startPan);
  window.addEventListener("pointermove", movePan);
  window.addEventListener("pointerup", endPan);
  els.viewport.addEventListener("click", selectRegionFromPoint);
}

function updateFloorOptions(preferredFloor) {
  const type = els.analysis.value;
  const floors = floorOrder.filter((floor) => data.maps.some((map) => map.type === type && map.floor === floor));
  els.floor.innerHTML = floors.map((floor) => `<option value="${floor}">${floor}</option>`).join("");
  const nextFloor = floors.includes(preferredFloor) ? preferredFloor : floors[0];
  els.floor.value = nextFloor;
  const map = findMap(type, nextFloor);
  if (map) renderMap(map);
}

function findMap(type, floor) {
  return data.maps.find((map) => map.type === type && map.floor === floor);
}

function renderMap(map) {
  currentMap = map;
  selectedRegion = null;
  els.title.textContent = `${map.title} · ${map.floor}`;
  els.subtitle.textContent = `${typeLabels[map.type] || map.type} / ${map.filename}`;
  els.regionCount.textContent = map.regionCount;
  els.content.style.width = `${map.width}px`;
  els.content.style.height = `${map.height}px`;
  els.hitLayer.style.width = `${map.width}px`;
  els.hitLayer.style.height = `${map.height}px`;
  els.hitLayer.innerHTML = "";
  els.image.onload = () => {
    fitMapToViewport();
    clearDetails();
  };
  els.image.src = map.image;
  renderLegend(map.legend);
  renderHitRegions(map.regions);
  applySearchFilter();
}

function renderLegend(items) {
  els.legend.innerHTML = items
    .map(
      (item) => `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${item.colorHex}"></span>
          <span>${item.label}</span>
        </div>
      `,
    )
    .join("");
}

function renderHitRegions(regions) {
  const fragment = document.createDocumentFragment();
  regions.forEach((region) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "region-hit";
    button.dataset.regionId = region.id;
    button.title = `${region.id} · ${region.category}`;
    button.style.left = `${region.x}px`;
    button.style.top = `${region.y}px`;
    button.style.width = `${region.w}px`;
    button.style.height = `${region.h}px`;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectRegion(region);
    });
    fragment.appendChild(button);
  });
  els.hitLayer.appendChild(fragment);
}

function applySearchFilter() {
  if (!currentMap) return;
  const term = els.search.value.trim().toLowerCase();
  currentMap.regions.forEach((region) => {
    const hit = els.hitLayer.querySelector(`[data-region-id="${cssEscape(region.id)}"]`);
    if (!hit) return;
    const haystack = `${region.id} ${region.category} ${region.color} ${currentMap.title} ${currentMap.floor}`.toLowerCase();
    hit.classList.toggle("is-filtered", Boolean(term) && !haystack.includes(term));
  });
}

function selectRegion(region) {
  selectedRegion = region;
  els.hitLayer.querySelectorAll(".region-hit").forEach((hit) => {
    hit.classList.toggle("is-selected", hit.dataset.regionId === region.id);
  });
  els.selectedTitle.textContent = region.id;
  els.detailRows.innerHTML = detailRows(region);
  drawCrop(region);
}

function detailRows(region) {
  const rows = [
    ["当前图层", `${currentMap.title} · ${currentMap.floor}`],
    [
      "分类",
      `<span class="category-pill"><span class="category-dot" style="background:${region.colorHex}"></span>${region.category}</span>`,
    ],
    ["图块位置", `中心 ${Math.round(region.cx)}, ${Math.round(region.cy)} / 框选 ${region.w} × ${region.h}px`],
    ["提取面积", `${region.pixels.toLocaleString("zh-CN")} 像素`],
    ["来源文件", currentMap.filename],
  ];
  return rows
    .map(
      ([label, value]) => `
        <div class="detail-row">
          <small>${label}</small>
          <span>${value}</span>
        </div>
      `,
    )
    .join("");
}

function clearDetails() {
  els.selectedTitle.textContent = "未选择图块";
  els.detailRows.innerHTML = '<p class="empty-copy">点击任意彩色图块后，这里会显示分类、位置和局部放大截图。</p>';
  const ctx = els.cropCanvas.getContext("2d");
  ctx.clearRect(0, 0, els.cropCanvas.width, els.cropCanvas.height);
}

function drawCrop(region) {
  const canvas = els.cropCanvas;
  const ctx = canvas.getContext("2d");
  const pad = Math.max(40, Math.min(160, Math.max(region.w, region.h) * 0.2));
  const sx = Math.max(0, Math.floor(region.x - pad));
  const sy = Math.max(0, Math.floor(region.y - pad));
  const sw = Math.min(currentMap.width - sx, Math.ceil(region.w + pad * 2));
  const sh = Math.min(currentMap.height - sy, Math.ceil(region.h + pad * 2));
  const fit = Math.min(canvas.width / sw, canvas.height / sh);
  const dw = sw * fit;
  const dh = sh * fit;
  const dx = (canvas.width - dw) / 2;
  const dy = (canvas.height - dh) / 2;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(els.image, sx, sy, sw, sh, dx, dy, dw, dh);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(dx + (region.x - sx) * fit, dy + (region.y - sy) * fit, region.w * fit, region.h * fit);
}

function fitMapToViewport() {
  if (!currentMap) return;
  const rect = els.viewport.getBoundingClientRect();
  const nextScale = Math.min(rect.width / currentMap.width, rect.height / currentMap.height) * 0.94;
  scale = clamp(nextScale, 0.08, 4);
  panX = (rect.width - currentMap.width * scale) / 2;
  panY = (rect.height - currentMap.height * scale) / 2;
  applyTransform();
}

function zoomAtCenter(multiplier) {
  const rect = els.viewport.getBoundingClientRect();
  zoomTo(rect.width / 2, rect.height / 2, scale * multiplier);
}

function handleWheel(event) {
  event.preventDefault();
  const rect = els.viewport.getBoundingClientRect();
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  zoomTo(event.clientX - rect.left, event.clientY - rect.top, scale * factor);
}

function zoomTo(screenX, screenY, nextScale) {
  const clamped = clamp(nextScale, 0.08, 5);
  const mapX = (screenX - panX) / scale;
  const mapY = (screenY - panY) / scale;
  scale = clamped;
  panX = screenX - mapX * scale;
  panY = screenY - mapY * scale;
  applyTransform();
}

function applyTransform() {
  els.content.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
}

function startPan(event) {
  if (event.button !== 0 || event.target.closest(".region-hit")) return;
  movedDuringPointer = false;
  drag = {
    x: event.clientX,
    y: event.clientY,
    panX,
    panY,
  };
  els.viewport.classList.add("is-dragging");
}

function movePan(event) {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) movedDuringPointer = true;
  panX = drag.panX + dx;
  panY = drag.panY + dy;
  applyTransform();
}

function endPan() {
  drag = null;
  els.viewport.classList.remove("is-dragging");
}

function selectRegionFromPoint(event) {
  if (!currentMap || movedDuringPointer || event.target.closest(".region-hit")) return;
  const rect = els.viewport.getBoundingClientRect();
  const x = (event.clientX - rect.left - panX) / scale;
  const y = (event.clientY - rect.top - panY) / scale;
  const region = findRegionAt(x, y);
  if (region) selectRegion(region);
}

function findRegionAt(x, y) {
  let best = null;
  let bestArea = Infinity;
  currentMap.regions.forEach((region) => {
    if (x < region.x || y < region.y || x > region.x + region.w || y > region.y + region.h) return;
    const area = region.w * region.h;
    if (area < bestArea) {
      best = region;
      bestArea = area;
    }
  });
  return best;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

init();
