/*
  日期：2026-08-12
  作者：Henry / WorkBuddy
  代码说明：MindMap 编辑器核心逻辑，涵盖数据模型、自动布局、SVG 渲染、交互、导入导出与撤销重做。
*/

(function () {
  'use strict';

  const CONFIG = {
    hGap: 80,
    vGap: 26,
    nodePaddingX: 14,
    nodePaddingY: 10,
    cornerRadius: 8,
    fontSize: 14,
    lineWidth: 2,
    minZoom: 0.1,
    maxZoom: 5,
    zoomStep: 1.15,
    historyLimit: 50
  };

  const THEMES = {
    colorful: {
      bg: '#ffffff',
      text: '#1f2937',
      rootFill: '#374151',
      rootText: '#ffffff',
      line: '#9ca3af',
      palette: ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#10b981', '#3b82f6']
    },
    dark: {
      bg: '#0f172a',
      text: '#e2e8f0',
      rootFill: '#334155',
      rootText: '#f8fafc',
      line: '#475569',
      palette: ['#818cf8', '#2dd4bf', '#fbbf24', '#f87171', '#a78bfa', '#f472b6', '#34d399', '#60a5fa']
    },
    simple: {
      bg: '#ffffff',
      text: '#111827',
      rootFill: '#e5e7eb',
      rootText: '#111827',
      line: '#9ca3af',
      palette: ['#6b7280']
    }
  };

  const state = {
    root: null,
    selectedId: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    layout: 'right',
    theme: 'colorful',
    history: [],
    historyIndex: -1,
    nextId: 1,
    matchedIds: new Set(),
    panning: null,
    dragging: null,
    editingId: null
  };

  const els = {
    svg: document.getElementById('mapSvg'),
    viewport: document.getElementById('viewport'),
    linksLayer: document.getElementById('linksLayer'),
    nodesLayer: document.getElementById('nodesLayer'),
    editOverlay: document.getElementById('editOverlay'),
    fileInput: document.getElementById('fileInput'),
    layoutSelect: document.getElementById('layoutSelect'),
    themeSelect: document.getElementById('themeSelect'),
    searchInput: document.getElementById('searchInput'),
    workspace: document.getElementById('workspace'),
    measureBox: null
  };

  /* ---------- 初始化 ---------- */
  function init() {
    initMeasureBox();
    bindEvents();
    loadInitialData();
    applyTheme();
    applyLayout();
    fitView();
    render();
    selectNode(state.root.id, false);
  }

  function initMeasureBox() {
    const box = document.createElement('div');
    box.id = 'measureBox';
    // 不能用 .hidden（display:none 会导致无法测量），靠 CSS 将其移出可视区域
    document.body.appendChild(box);
    els.measureBox = box;
  }

  function loadInitialData() {
    state.root = deserializeNode({
      id: 'node-1',
      text: '智能体',
      children: [
        {
          id: 'node-2',
          text: '大模型',
          children: [
            {
              id: 'node-3',
              text: '本地部署',
              children: [
                {
                  id: 'node-4',
                  text: 'Ollama',
                  children: [
                    { id: 'node-5', text: 'Deepseek R1' },
                    { id: 'node-6', text: 'Qwen3' }
                  ]
                }
              ]
            },
            {
              id: 'node-7',
              text: '远程调用',
              children: [
                {
                  id: 'node-8',
                  text: '阿里云百炼',
                  children: [
                    { id: 'node-9', text: 'Qwen3' },
                    { id: 'node-10', text: 'QWQ' },
                    { id: 'node-11', text: 'QVQ' }
                  ]
                }
              ]
            },
            { id: 'node-12', text: '大模型调用方法' }
          ]
        },
        {
          id: 'node-13',
          text: '工具',
          children: [
            { id: 'node-14', text: 'Function Calling' },
            { id: 'node-15', text: 'MCP工具' },
            { id: 'node-16', text: 'LangChain内置工具' },
            {
              id: 'node-17',
              text: '复杂工具',
              children: [
                { id: 'node-18', text: '浏览器控制' },
                { id: 'node-19', text: '终端控制' }
              ]
            }
          ]
        },
        {
          id: 'node-20',
          text: '智能体',
          children: [
            { id: 'node-21', text: 'React架构' }
          ]
        }
      ]
    });
    pushHistory();
  }

  /* ---------- 事件绑定 ---------- */
  function bindEvents() {
    // 工具栏
    document.getElementById('toolbar').addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn && btn.dataset.action) {
        e.preventDefault();
        handleAction(btn.dataset.action);
      }
    });

    els.layoutSelect.addEventListener('change', (e) => {
      state.layout = e.target.value;
      applyLayout();
      fitView();
      render();
    });

    els.themeSelect.addEventListener('change', (e) => {
      state.theme = e.target.value;
      applyTheme();
      applyLayout();
      render();
    });

    els.searchInput.addEventListener('input', (e) => doSearch(e.target.value));

    // 文件
    els.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) importJson(file);
      els.fileInput.value = '';
    });

    // 画布交互
    els.svg.addEventListener('pointerdown', onPointerDown);
    els.svg.addEventListener('pointermove', onPointerMove);
    els.svg.addEventListener('pointerup', onPointerUp);
    els.svg.addEventListener('pointerleave', onPointerUp);
    els.svg.addEventListener('wheel', onWheel, { passive: false });
    els.svg.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onKeyDown);

    // 编辑浮层
    els.editOverlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        cancelEdit();
      }
    });
    els.editOverlay.addEventListener('blur', () => commitEdit());

    window.addEventListener('resize', () => {
      render();
    });
  }

  /* ---------- 数据模型 ---------- */
  function generateId() {
    return 'node-' + (state.nextId++);
  }

  function createNode(text, parent) {
    return {
      id: generateId(),
      text: text || '新节点',
      children: [],
      collapsed: false,
      parent: parent || null,
      color: null,
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      w: 0,
      h: 0
    };
  }

  function traverse(node, cb, depth) {
    depth = depth || 0;
    cb(node, depth);
    if (!node.collapsed && node.children) {
      node.children.forEach((child) => traverse(child, cb, depth + 1));
    }
  }

  function allNodes() {
    const list = [];
    if (state.root) traverse(state.root, (n) => list.push(n));
    return list;
  }

  function findById(id) {
    return allNodes().find((n) => n.id === id) || null;
  }

  // 实际渲染坐标 = 自动布局坐标 + 手动拖拽偏移
  function effX(node) { return node.x + (node.dx || 0); }
  function effY(node) { return node.y + (node.dy || 0); }

  function countLeaves(node) {
    if (node.collapsed || !node.children || node.children.length === 0) return 1;
    return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
  }

  function serializeNode(node) {
    return {
      id: node.id,
      text: node.text,
      collapsed: node.collapsed,
      color: node.color,
      dx: node.dx || 0,
      dy: node.dy || 0,
      children: node.children.map(serializeNode)
    };
  }

  function deserializeNode(data, parent) {
    const node = createNode(data.text, parent);
    node.id = data.id;
    node.collapsed = !!data.collapsed;
    node.color = data.color || null;
    node.dx = data.dx || 0;
    node.dy = data.dy || 0;
    const num = parseInt((data.id || '').toString().replace(/^node-/, ''), 10);
    if (!isNaN(num)) state.nextId = Math.max(state.nextId, num + 1);
    if (data.children) {
      data.children.forEach((child) => node.children.push(deserializeNode(child, node)));
    }
    return node;
  }

  function snapshot() {
    return JSON.stringify(serializeNode(state.root));
  }

  function restore(json) {
    state.nextId = 1;
    state.root = deserializeNode(JSON.parse(json));
    applyLayout();
    render();
  }

  function pushHistory() {
    // 删除当前索引之后的历史
    if (state.historyIndex < state.history.length - 1) {
      state.history = state.history.slice(0, state.historyIndex + 1);
    }
    state.history.push(snapshot());
    if (state.history.length > CONFIG.historyLimit) {
      state.history.shift();
    } else {
      state.historyIndex++;
    }
  }

  function undo() {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      restore(state.history[state.historyIndex]);
    }
  }

  function redo() {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      restore(state.history[state.historyIndex]);
    }
  }

  /* ---------- 测量 ---------- */
  function measureText(text) {
    const span = document.createElement('span');
    span.className = 'measure-span';
    span.textContent = text || ' ';
    els.measureBox.appendChild(span);
    const rect = span.getBoundingClientRect();
    const size = { width: rect.width, height: rect.height };
    els.measureBox.removeChild(span);
    return size;
  }

  /* ---------- 颜色工具 ---------- */
  function nextBranchColor(index) {
    const palette = THEMES[state.theme].palette;
    return palette[index % palette.length];
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyTheme() {
    document.body.className = 'theme-' + state.theme;
  }

  /* ---------- 布局 ---------- */
  function applyLayout() {
    if (!state.root) return;
    const theme = THEMES[state.theme];
    if (state.layout === 'right') {
      layoutRight(state.root, 0, null, theme.rootFill);
    } else if (state.layout === 'down') {
      layoutDown(state.root, 0, null, theme.rootFill);
    } else if (state.layout === 'radial') {
      layoutRadial(state.root, -Math.PI / 2, 3 * Math.PI / 2, 0, null, theme.rootFill);
    }
  }

  function layoutRight(node, startY, parent, color) {
    const theme = THEMES[state.theme];
    const size = measureText(node.text);
    node.w = Math.max(size.width + CONFIG.nodePaddingX * 2, 70);
    node.h = Math.max(size.height + CONFIG.nodePaddingY * 2, 36);
    node.parent = parent || null;

    if (!parent) {
      node.color = theme.rootFill;
      node.x = 0;
    } else {
      node.color = color || parent.color;
      node.x = parent.x + parent.w / 2 + CONFIG.hGap + node.w / 2;
    }

    if (node.collapsed || !node.children || node.children.length === 0) {
      node.y = startY + node.h / 2;
      return { top: startY, bottom: startY + node.h };
    }

    let y = startY;
    node.children.forEach((child, i) => {
      const childColor = !parent ? nextBranchColor(i) : color;
      const sub = layoutRight(child, y, node, childColor);
      y = sub.bottom + CONFIG.vGap;
    });

    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    const top = first.y - first.h / 2;
    const bottom = last.y + last.h / 2;
    node.y = (top + bottom) / 2;
    return { top, bottom };
  }

  function layoutDown(node, startX, parent, color) {
    const theme = THEMES[state.theme];
    const size = measureText(node.text);
    node.w = Math.max(size.width + CONFIG.nodePaddingX * 2, 70);
    node.h = Math.max(size.height + CONFIG.nodePaddingY * 2, 36);
    node.parent = parent || null;

    if (!parent) {
      node.color = theme.rootFill;
      node.y = 0;
    } else {
      node.color = color || parent.color;
      node.y = parent.y + parent.h / 2 + CONFIG.hGap + node.h / 2;
    }

    if (node.collapsed || !node.children || node.children.length === 0) {
      node.x = startX + node.w / 2;
      return { left: startX, right: startX + node.w };
    }

    let x = startX;
    node.children.forEach((child, i) => {
      const childColor = !parent ? nextBranchColor(i) : color;
      const sub = layoutDown(child, x, node, childColor);
      x = sub.right + CONFIG.vGap;
    });

    const first = node.children[0];
    const last = node.children[node.children.length - 1];
    const left = first.x - first.w / 2;
    const right = last.x + last.w / 2;
    node.x = (left + right) / 2;
    return { left, right };
  }

  function layoutRadial(node, angleStart, angleEnd, depth, parent, color) {
    const theme = THEMES[state.theme];
    const size = measureText(node.text);
    node.w = Math.max(size.width + CONFIG.nodePaddingX * 2, 70);
    node.h = Math.max(size.height + CONFIG.nodePaddingY * 2, 36);
    node.parent = parent || null;

    if (!parent) {
      node.color = theme.rootFill;
      node.x = 0;
      node.y = 0;
    } else {
      node.color = color || parent.color;
      const radius = depth * (CONFIG.hGap + 90);
      const angle = (angleStart + angleEnd) / 2;
      node.x = radius * Math.cos(angle);
      node.y = radius * Math.sin(angle);
    }

    if (node.collapsed || !node.children || node.children.length === 0) return;

    const leaves = countLeaves(node);
    let current = angleStart;
    node.children.forEach((child, i) => {
      const childColor = !parent ? nextBranchColor(i) : color;
      const childLeaves = countLeaves(child);
      const span = (angleEnd - angleStart) * (leaves ? childLeaves / leaves : 1 / node.children.length);
      layoutRadial(child, current, current + span, depth + 1, node, childColor);
      current += span;
    });
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (!state.root) return;
    els.linksLayer.innerHTML = '';
    els.nodesLayer.innerHTML = '';

    // 先画连线（只连接展开的子节点）
    traverse(state.root, (node) => {
      if (node.parent && !node.parent.collapsed) {
        drawLink(node.parent, node);
      }
    });

    // 再画节点
    traverse(state.root, (node, depth) => {
      drawNode(node, depth);
    });

    updateTransform();
  }

  function updateTransform() {
    els.viewport.setAttribute(
      'transform',
      `translate(${state.pan.x}, ${state.pan.y}) scale(${state.zoom})`
    );
  }

  function drawLink(parent, child) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', child.color || THEMES[state.theme].line);
    path.setAttribute('stroke-width', CONFIG.lineWidth);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('d', linkPath(parent, child));
    els.linksLayer.appendChild(path);
  }

  function linkPath(parent, child) {
    const px = effX(parent), py = effY(parent);
    const cx = effX(child), cy = effY(child);
    if (state.layout === 'right') {
      const x1 = px + parent.w / 2;
      const y1 = py;
      const x2 = cx - child.w / 2;
      const y2 = cy;
      const mx = (x1 + x2) / 2;
      return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
    } else if (state.layout === 'down') {
      const x1 = px;
      const y1 = py + parent.h / 2;
      const x2 = cx;
      const y2 = cy - child.h / 2;
      const my = (y1 + y2) / 2;
      return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
    } else {
      // 径向用直线，更清爽
      return `M ${px} ${py} L ${cx} ${cy}`;
    }
  }

  function drawNode(node, depth) {
    const theme = THEMES[state.theme];
    const isRoot = !node.parent;
    const isSelected = node.id === state.selectedId;
    const isMatched = state.matchedIds.has(node.id);

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'node' + (isSelected ? ' selected' : '') + (isMatched ? ' matched' : ''));
    group.setAttribute('data-id', node.id);
    group.setAttribute('transform', `translate(${effX(node)}, ${effY(node)})`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', -node.w / 2);
    rect.setAttribute('y', -node.h / 2);
    rect.setAttribute('width', node.w);
    rect.setAttribute('height', node.h);
    rect.setAttribute('rx', CONFIG.cornerRadius);
    rect.setAttribute('ry', CONFIG.cornerRadius);

    if (isRoot) {
      rect.setAttribute('fill', theme.rootFill);
      rect.setAttribute('stroke', theme.rootFill);
    } else {
      rect.setAttribute('fill', hexToRgba(node.color || theme.line, state.theme === 'dark' ? 0.18 : 0.12));
      rect.setAttribute('stroke', node.color || theme.line);
    }
    rect.setAttribute('stroke-width', '2');
    group.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('fill', isRoot ? theme.rootText : theme.text);
    text.setAttribute('class', 'node-text');
    text.textContent = node.text;
    group.appendChild(text);

    // 折叠/展开图标
    if (node.children && node.children.length > 0) {
      const expander = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      expander.setAttribute('class', 'expander');
      expander.setAttribute('data-id', node.id);

      let ex, ey;
      if (state.layout === 'right') {
        ex = node.w / 2 + 10;
        ey = 0;
      } else if (state.layout === 'down') {
        ex = 0;
        ey = node.h / 2 + 10;
      } else {
        const angle = Math.atan2(effY(node), effX(node));
        ex = (node.w / 2 + 10) * Math.cos(angle);
        ey = (node.h / 2 + 10) * Math.sin(angle);
      }
      expander.setAttribute('transform', `translate(${ex}, ${ey})`);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', 6);
      expander.appendChild(circle);

      const sign = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      sign.textContent = node.collapsed ? '+' : '−';
      expander.appendChild(sign);

      group.appendChild(expander);
    }

    els.nodesLayer.appendChild(group);
  }

  /* ---------- 交互 ---------- */
  function onPointerDown(e) {
    if (state.editingId) return;
    const expander = e.target.closest('.expander');
    if (expander) {
      e.preventDefault();
      toggleNodeCollapse(expander.dataset.id);
      return;
    }

    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
      e.preventDefault();
      selectNode(nodeEl.dataset.id, false);
      // 准备拖拽（达到阈值后才算真正拖动，避免误触）
      // 注意：此处暂不 setPointerCapture，否则会拦截 dblclick，导致双击编辑失效。
      // 捕获延迟到首次移动时才设置（见 onPointerMove）。
      state.dragging = {
        id: nodeEl.dataset.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        moved: false
      };
      return;
    }

    // 平移画布
    els.svg.classList.add('panning');
    state.panning = {
      startX: e.clientX,
      startY: e.clientY,
      origX: state.pan.x,
      origY: state.pan.y
    };
    els.svg.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (state.dragging) {
      const node = findById(state.dragging.id);
      if (!node) return;
      const deltaPx = Math.hypot(e.clientX - state.dragging.startClientX, e.clientY - state.dragging.startClientY);
      if (!state.dragging.moved && deltaPx < 3) return; // 未达拖拽阈值
      if (!state.dragging.moved) {
        // 真正开始拖动时才捕获指针，静止双击不受影响
        try { els.svg.setPointerCapture(e.pointerId); } catch (_) {}
      }
      state.dragging.moved = true;
      const worldDx = (e.clientX - state.dragging.startClientX) / state.zoom;
      const worldDy = (e.clientY - state.dragging.startClientY) / state.zoom;
      const prevDx = node.dx || 0;
      const prevDy = node.dy || 0;
      const subDx = worldDx - prevDx;
      const subDy = worldDy - prevDy;
      // 节点本身用绝对偏移，子树跟随同一增量
      node.dx = worldDx;
      node.dy = worldDy;
      if (!node.collapsed) {
        traverse(node, (n) => {
          if (n === node) return;
          n.dx = (n.dx || 0) + subDx;
          n.dy = (n.dy || 0) + subDy;
        });
      }
      render();
      return;
    }

    if (!state.panning) return;
    const dx = e.clientX - state.panning.startX;
    const dy = e.clientY - state.panning.startY;
    state.pan.x = state.panning.origX + dx;
    state.pan.y = state.panning.origY + dy;
    updateTransform();
  }

  function onPointerUp(e) {
    if (state.dragging) {
      if (state.dragging.moved) {
        pushHistory(); // 拖拽产生位移才记入历史，支持撤销
        render();
      }
      state.dragging = null;
    }
    if (state.panning) {
      state.panning = null;
      els.svg.classList.remove('panning');
    }
    try { els.svg.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY < 0 ? CONFIG.zoomStep : 1 / CONFIG.zoomStep;
    const rect = els.workspace.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setZoom(state.zoom * delta, x, y);
  }

  function onDoubleClick(e) {
    const nodeEl = e.target.closest('.node');
    if (nodeEl) {
      const node = findById(nodeEl.dataset.id);
      if (node) startEdit(node);
    }
  }

  function onKeyDown(e) {
    // 编辑中或输入框内不处理快捷键
    if (state.editingId) return;
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;

    const isMod = e.ctrlKey || e.metaKey;

    if (isMod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      exportJson();
      return;
    }
    if (isMod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      els.fileInput.click();
      return;
    }
    if (isMod && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      exportSvg();
      return;
    }
    if (isMod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      newMap();
      return;
    }
    if (isMod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (isMod && (e.key === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      redo();
      return;
    }

    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        addChild();
        break;
      case 'Enter':
        e.preventDefault();
        addSibling();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        deleteNode();
        break;
      case ' ':
        e.preventDefault();
        toggleCollapse();
        break;
      case 'F2':
        e.preventDefault();
        const selected = findById(state.selectedId);
        if (selected) startEdit(selected);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        e.preventDefault();
        navigateByArrow(e.key);
        break;
      case '+':
      case '=':
        e.preventDefault();
        zoomIn();
        break;
      case '-':
      case '_':
        e.preventDefault();
        zoomOut();
        break;
    }
  }

  function handleAction(action) {
    switch (action) {
      case 'new': newMap(); break;
      case 'open': els.fileInput.click(); break;
      case 'save': exportJson(); break;
      case 'exportSvg': exportSvg(); break;
      case 'addChild': addChild(); break;
      case 'addSibling': addSibling(); break;
      case 'delete': deleteNode(); break;
      case 'collapse': toggleCollapse(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'zoomIn': zoomIn(); break;
      case 'zoomOut': zoomOut(); break;
      case 'fit': fitView(); render(); break;
    }
  }

  /* ---------- 节点操作 ---------- */
  function selectNode(id, scroll) {
    state.selectedId = id;
    // 只更新选中态，避免重建 DOM 打断双击事件
    updateSelection();
    if (!state.editingId) els.svg.focus();
    if (scroll) {
      const node = findById(id);
      if (node) centerOnNode(node);
    }
  }

  function updateSelection() {
    const groups = els.nodesLayer.querySelectorAll('.node');
    groups.forEach((g) => {
      if (g.dataset.id === state.selectedId) g.classList.add('selected');
      else g.classList.remove('selected');
    });
  }

  function startEdit(node) {
    state.editingId = node.id;
    const wsRect = els.workspace.getBoundingClientRect();
    const screenX = state.pan.x + effX(node) * state.zoom;
    const screenY = state.pan.y + effY(node) * state.zoom;
    const width = Math.max(node.w * state.zoom, 80);
    const height = Math.max(node.h * state.zoom, 28);

    els.editOverlay.style.left = (screenX - width / 2) + 'px';
    els.editOverlay.style.top = (screenY - height / 2) + 'px';
    els.editOverlay.style.width = width + 'px';
    els.editOverlay.style.minHeight = height + 'px';
    els.editOverlay.style.fontSize = (CONFIG.fontSize * state.zoom) + 'px';
    els.editOverlay.textContent = node.text;
    els.editOverlay.classList.remove('hidden');
    els.editOverlay.focus();
    // 全选
    const range = document.createRange();
    range.selectNodeContents(els.editOverlay);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function commitEdit() {
    if (!state.editingId) return;
    const node = findById(state.editingId);
    if (node) {
      const newText = els.editOverlay.textContent.trim();
      if (newText && newText !== node.text) {
        node.text = newText;
        applyLayout();
        pushHistory();
      } else {
        applyLayout();
      }
    }
    state.editingId = null;
    els.editOverlay.classList.add('hidden');
    els.editOverlay.blur();
    els.svg.focus();
    render();
  }

  function cancelEdit() {
    state.editingId = null;
    els.editOverlay.classList.add('hidden');
    els.editOverlay.blur();
    els.svg.focus();
  }

  function addChild() {
    const target = findById(state.selectedId) || state.root;
    if (!target) return;
    const child = createNode('新节点', target);
    target.children.push(child);
    target.collapsed = false;
    applyLayout();
    pushHistory();
    render();
    selectNode(child.id, true);
    startEdit(child);
  }

  function addSibling() {
    const target = findById(state.selectedId);
    if (!target || !target.parent) {
      addChild();
      return;
    }
    const parent = target.parent;
    const idx = parent.children.indexOf(target);
    const sibling = createNode('新节点', parent);
    parent.children.splice(idx + 1, 0, sibling);
    applyLayout();
    pushHistory();
    render();
    selectNode(sibling.id, true);
    startEdit(sibling);
  }

  function deleteNode() {
    const target = findById(state.selectedId);
    if (!target || !target.parent) return;
    const parent = target.parent;
    const idx = parent.children.indexOf(target);
    parent.children.splice(idx, 1);
    state.selectedId = parent.id;
    applyLayout();
    pushHistory();
    render();
  }

  function toggleCollapse() {
    const target = findById(state.selectedId);
    if (!target || !target.children || target.children.length === 0) return;
    target.collapsed = !target.collapsed;
    applyLayout();
    pushHistory();
    render();
  }

  function toggleNodeCollapse(id) {
    const node = findById(id);
    if (!node || !node.children || node.children.length === 0) return;
    node.collapsed = !node.collapsed;
    applyLayout();
    pushHistory();
    render();
  }

  function navigateByArrow(key) {
    const current = findById(state.selectedId);
    if (!current) return;
    const candidates = allNodes().filter((n) => n.id !== current.id);
    if (candidates.length === 0) return;

    // 优先树形语义
    if (state.layout === 'right') {
      if (key === 'ArrowRight' && current.children && current.children.length > 0 && !current.collapsed) {
        selectNode(current.children[0].id, true);
        return;
      }
      if (key === 'ArrowLeft' && current.parent) {
        selectNode(current.parent.id, true);
        return;
      }
    } else if (state.layout === 'down') {
      if (key === 'ArrowDown' && current.children && current.children.length > 0 && !current.collapsed) {
        selectNode(current.children[0].id, true);
        return;
      }
      if (key === 'ArrowUp' && current.parent) {
        selectNode(current.parent.id, true);
        return;
      }
    }

    // 几何最近
    let best = null;
    let bestScore = Infinity;
    candidates.forEach((n) => {
      const dx = effX(n) - effX(current);
      const dy = effY(n) - effY(current);
      let ok = false;
      if (key === 'ArrowUp' && dy < -1) ok = true;
      if (key === 'ArrowDown' && dy > 1) ok = true;
      if (key === 'ArrowLeft' && dx < -1) ok = true;
      if (key === 'ArrowRight' && dx > 1) ok = true;
      if (!ok) return;
      const dist = Math.hypot(dx, dy);
      if (dist < bestScore) {
        bestScore = dist;
        best = n;
      }
    });
    if (best) selectNode(best.id, true);
  }

  /* ---------- 缩放平移 ---------- */
  function setZoom(newZoom, anchorX, anchorY) {
    const oldZoom = state.zoom;
    newZoom = Math.max(CONFIG.minZoom, Math.min(CONFIG.maxZoom, newZoom));
    const worldX = (anchorX - state.pan.x) / oldZoom;
    const worldY = (anchorY - state.pan.y) / oldZoom;
    state.pan.x = anchorX - worldX * newZoom;
    state.pan.y = anchorY - worldY * newZoom;
    state.zoom = newZoom;
    updateTransform();
  }

  function zoomIn() {
    const rect = els.workspace.getBoundingClientRect();
    setZoom(state.zoom * CONFIG.zoomStep, rect.width / 2, rect.height / 2);
  }

  function zoomOut() {
    const rect = els.workspace.getBoundingClientRect();
    setZoom(state.zoom / CONFIG.zoomStep, rect.width / 2, rect.height / 2);
  }

  function fitView() {
    const nodes = allNodes();
    if (nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      minX = Math.min(minX, effX(n) - n.w / 2);
      minY = Math.min(minY, effY(n) - n.h / 2);
      maxX = Math.max(maxX, effX(n) + n.w / 2);
      maxY = Math.max(maxY, effY(n) + n.h / 2);
    });
    const bboxW = Math.max(maxX - minX, 100);
    const bboxH = Math.max(maxY - minY, 100);
    const rect = els.workspace.getBoundingClientRect();
    const scale = Math.min(rect.width / bboxW, rect.height / bboxH, 1) * 0.9;
    state.zoom = scale;
    state.pan.x = rect.width / 2 - (minX + maxX) / 2 * scale;
    state.pan.y = rect.height / 2 - (minY + maxY) / 2 * scale;
  }

  function centerOnNode(node) {
    const rect = els.workspace.getBoundingClientRect();
    state.pan.x = rect.width / 2 - effX(node) * state.zoom;
    state.pan.y = rect.height / 2 - effY(node) * state.zoom;
    updateTransform();
  }

  /* ---------- 新建/导入/导出 ---------- */
  function newMap() {
    state.nextId = 1;
    state.root = createNode('中心主题', null);
    state.selectedId = state.root.id;
    state.history = [];
    state.historyIndex = -1;
    applyLayout();
    fitView();
    pushHistory();
    render();
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        state.nextId = 1;
        state.root = deserializeNode(data);
        state.history = [];
        state.historyIndex = -1;
        state.selectedId = state.root.id;
        applyLayout();
        fitView();
        pushHistory();
        render();
      } catch (err) {
        alert('文件解析失败：' + err.message);
      }
    };
    reader.readAsText(file);
  }

  function exportJson() {
    const data = serializeNode(state.root);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadFile(blob, 'mindmap.json');
  }

  function exportSvg() {
    const svgCss = getSvgCss();
    const clone = els.svg.cloneNode(true);
    clone.removeAttribute('id');
    clone.removeAttribute('tabindex');
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = svgCss;
    clone.insertBefore(style, clone.firstChild);
    // 把当前 viewport 变换写死
    const vp = clone.querySelector('#viewport');
    if (vp) vp.setAttribute('transform', els.viewport.getAttribute('transform'));
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(clone);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    downloadFile(blob, 'mindmap.svg');
  }

  function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getSvgCss() {
    return `
      .node rect { stroke-width: 2; }
      .node text { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans SC", sans-serif; font-size: 14px; text-anchor: middle; dominant-baseline: central; }
      .expander circle { fill: #ffffff; stroke: #6b7280; }
      .expander text { fill: #6b7280; font-size: 12px; text-anchor: middle; dominant-baseline: central; }
    `;
  }

  /* ---------- 搜索 ---------- */
  function doSearch(query) {
    state.matchedIds.clear();
    const q = query.trim();
    if (q) {
      const lower = q.toLowerCase();
      allNodes().forEach((n) => {
        if (n.text.toLowerCase().includes(lower)) state.matchedIds.add(n.id);
      });
      if (state.matchedIds.size > 0) {
        const first = findById(Array.from(state.matchedIds)[0]);
        selectNode(first.id, true);
      }
    }
    render();
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
