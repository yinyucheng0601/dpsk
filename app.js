(function () {
  const data = window.DEEPSEEK_INTERPRETABILITY_DATA;
  const X6 = window.X6;
  const root = document.getElementById("app");

  if (!root || !data || !X6 || !X6.Graph || !X6.Node) {
    document.body.innerHTML = "<p style='padding:24px;font-family:sans-serif'>Missing X6 or data.js</p>";
    return;
  }

  root.innerHTML = '<div class="graph-shell"><div id="graph" class="graph-canvas"></div></div>';
  const graphContainer = document.getElementById("graph");

  const BG = "#ececec";
  const INK = "#111111";
  const LINE = "#1f1f1f";
  const PAPER = "#ffffff";
  const PAPER_ALT = "#f6f6f6";
  const MUTED = "#aaaaaa";
  const DASH = "#4f4f4f";

  const HEADER_H = 54;
  const MAIN_W = 264;
  const MAIN_H = 54;
  const GROUP_W = 564;
  const GROUP_INNER_TOP = 18;
  const GROUP_INNER_BOTTOM = 18;
  const STRIP_W = 298;
  const STRIP_H = 40;
  const OP_HEADER_H = 38;
  const OP_GAP = 14;
  const OP_BRANCH_GAP = 24;
  const OP_CENTER_GAP = 20;
  const L4_W = 126;
  const L4_H = 26;
  const L4_GAP = 8;
  const L4_TOP = 10;
  const L4_BOTTOM = 10;

  const PLUS_PATH = "M 8 12 16 12 M 12 8 12 16";
  const MINUS_PATH = "M 8 12 16 12";

  class FlowGroup extends X6.Node {
    toggleCollapse(collapsed) {
      const meta = this.getData() || {};
      if (!meta.collapsible) return;

      const target = collapsed == null ? !meta.collapsed : collapsed;
      this.setData({ ...meta, collapsed: target }, { silent: true });
      this.resize(this.getSize().width, target ? meta.collapsedHeight : meta.expandedHeight);
      this.attr("buttonSign", {
        d: target ? PLUS_PATH : MINUS_PATH,
      });
    }
  }

  FlowGroup.config({
    markup: [
      {
        tagName: "rect",
        selector: "body",
      },
      {
        tagName: "text",
        selector: "label",
      },
      {
        tagName: "g",
        selector: "buttonGroup",
        children: [
          {
            tagName: "rect",
            selector: "button",
            attrs: {
              "pointer-events": "visiblePainted",
            },
          },
          {
            tagName: "path",
            selector: "buttonSign",
            attrs: {
              fill: "none",
              "pointer-events": "none",
            },
          },
        ],
      },
    ],
    attrs: {
      body: {
        refWidth: "100%",
        refHeight: "100%",
        fill: PAPER,
        stroke: LINE,
        strokeWidth: 1.2,
        rx: 12,
        ry: 12,
      },
      label: {
        refX: "50%",
        refY: 26,
        textAnchor: "middle",
        fontSize: 14,
        fontWeight: 600,
        fill: INK,
        pointerEvents: "none",
      },
      buttonGroup: {
        refX: "100%",
        refX2: -34,
        refY: 10,
      },
      button: {
        width: 24,
        height: 24,
        rx: 5,
        ry: 5,
        fill: "#e5e5e5",
        stroke: "none",
        cursor: "pointer",
        event: "node:collapse",
      },
      buttonSign: {
        refX: 0,
        refY: 0,
        stroke: "#7a7a7a",
        strokeWidth: 1.2,
        strokeLinecap: "square",
      },
    },
  });

  const state = {
    selectedLayerId: 0,
    expanded: {},
    modelVersion: "v3",
  };

  let renderScheduled = false;
  let pendingResetView = false;

  const graph = new X6.Graph({
    container: graphContainer,
    width: graphContainer.clientWidth || window.innerWidth,
    height: graphContainer.clientHeight || window.innerHeight,
    autoResize: true,
    background: {
      color: BG,
    },
    grid: false,
    panning: {
      enabled: true,
      modifiers: null,
      eventTypes: ["leftMouseDown"],
    },
    mousewheel: {
      enabled: true,
      modifiers: ["ctrl", "meta"],
      factor: 1.1,
      minScale: 0.4,
      maxScale: 2.2,
      zoomAtMousePosition: true,
    },
    interacting: {
      nodeMovable: false,
      edgeMovable: false,
      edgeLabelMovable: false,
      arrowheadMovable: false,
      vertexMovable: false,
      vertexAddable: false,
      vertexDeletable: false,
      magnetConnectable: false,
      useEdgeTools: false,
      toolsAddable: false,
    },
  });

  function isDense(layer) {
    return layer.block_type === "dense_ffn";
  }

  function getSelectedLayer() {
    return data.layers.find((layer) => layer.layer_id === state.selectedLayerId) || data.layers[0];
  }

  function setDefaultExpanded(layer) {
    state.expanded = {
      __model: state.modelVersion,
      __layer: layer.layer_id,
      attention: false,
      feedforward: false,
    };
  }

  function ensureExpanded(layer) {
    if (state.expanded.__layer !== layer.layer_id || state.expanded.__model !== state.modelVersion) {
      setDefaultExpanded(layer);
    }
  }

  function setExpandedForLayer(layer, options) {
    state.expanded = {
      __model: state.modelVersion,
      __layer: layer.layer_id,
      attention: Boolean(options?.attention),
      feedforward: Boolean(options?.feedforward),
    };
  }

  function isExpanded(key) {
    return Boolean(state.expanded[key]);
  }

  function point(x, y) {
    return { x, y };
  }

  function anchor(node, side) {
    if (node?.anchors?.[side]) return node.anchors[side];
    if (side === "top") return point(node.x + node.w / 2, node.y);
    if (side === "bottom") return point(node.x + node.w / 2, node.y + node.h);
    if (side === "left") return point(node.x, node.y + node.h / 2);
    return point(node.x + node.w, node.y + node.h / 2);
  }

  function edgeSpec(kind, points) {
    return {
      type: "edge",
      kind,
      points,
    };
  }

  function edgeFromTo(kind, fromNode, fromSide, toNode, toSide, via) {
    return edgeSpec(kind, [anchor(fromNode, fromSide), ...(via || []), anchor(toNode, toSide)]);
  }

  function edgeFromPoint(kind, sourcePoint, toNode, toSide, via) {
    return edgeSpec(kind, [sourcePoint, ...(via || []), anchor(toNode, toSide)]);
  }

  function edgeToPoint(kind, fromNode, fromSide, targetPoint, via) {
    return edgeSpec(kind, [anchor(fromNode, fromSide), ...(via || []), targetPoint]);
  }

  function measureBounds(nodes) {
    if (!nodes.length) {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    const left = Math.min(...nodes.map((node) => node.x));
    const top = Math.min(...nodes.map((node) => node.y));
    const right = Math.max(...nodes.map((node) => node.x + node.w));
    const bottom = Math.max(...nodes.map((node) => node.y + node.h));
    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    };
  }

  function rectNode(id, text, x, y, w, h, variant, options) {
    return {
      type: "rect",
      id,
      text,
      x,
      y,
      w,
      h,
      variant,
      action: options?.action || null,
      disabled: Boolean(options?.disabled),
      labelRefX: options?.labelRefX,
      labelRefY: options?.labelRefY,
      labelAnchor: options?.labelAnchor,
      zIndex: options?.zIndex,
    };
  }

  function circleNode(id, text, x, y, size) {
    return {
      type: "circle",
      id,
      text,
      x,
      y,
      w: size,
      h: size,
      zIndex: 24,
    };
  }

  function groupNode(id, text, x, y, w, options) {
    const collapsedHeight = options?.collapsedHeight || HEADER_H;
    const expandedHeight = options?.expandedHeight || collapsedHeight;
    const collapsed = Boolean(options?.collapsed);

    return {
      type: "group",
      id,
      text,
      x,
      y,
      w,
      h: collapsed ? collapsedHeight : expandedHeight,
      key: options?.key || null,
      collapsible: Boolean(options?.collapsible),
      collapsed,
      collapsedHeight,
      expandedHeight,
      fill: options?.fill == null ? PAPER : options.fill,
      stroke: options?.stroke || LINE,
      strokeWidth: options?.strokeWidth == null ? 1.2 : options.strokeWidth,
      dashed: Boolean(options?.dashed),
      radius: options?.radius == null ? 12 : options.radius,
      fontSize: options?.fontSize || 14,
      fontWeight: options?.fontWeight || 600,
      showLabel: options?.showLabel !== false,
      labelY: options?.labelY,
      buttonY: options?.buttonY,
      buttonSize: options?.buttonSize,
      children: options?.children || [],
      edges: options?.edges || [],
      zIndex: options?.zIndex || 6,
    };
  }

  function summaryNode(id, title, x, y) {
    return rectNode(id, title, x, y, MAIN_W, MAIN_H, "summary");
  }

  function operatorNode(id, title, x, y, options) {
    return rectNode(id, title, x, y, options?.w || 152, options?.h || 38, "operator");
  }

  function fusionNode(id, title, x, y, options) {
    return buildExpandableOperator(id, title, x, y, {
      ...options,
      key: options?.key || id,
      details: options?.details == null ? getL4Details(id) : options.details,
    });
  }

  function addNode(id, x, y) {
    return circleNode(id, "+", x, y, 28);
  }

  function nodeBottom(node) {
    return node.y + node.h;
  }

  function stackFusionNodes(x, originY, defs, gap) {
    const nodes = [];
    let currentY = originY;

    defs.forEach((def) => {
      const node = fusionNode(def.id, def.title, x, currentY, def);
      nodes.push(node);
      currentY += node.h + (def.gap == null ? gap : def.gap);
    });

    return {
      nodes,
      bottom: nodes.length ? nodeBottom(nodes[nodes.length - 1]) : originY,
    };
  }

  function stackDetailNodes(parentId, prefix, x, originY, labels, width) {
    const nodes = [];
    const edges = [];
    let currentY = originY;
    let prevNode = null;

    labels.forEach((label, index) => {
      const node = rectNode(
        parentId + "__" + prefix + "_" + index,
        label,
        x,
        currentY,
        width,
        L4_H,
        "detail-op"
      );
      nodes.push(node);
      if (prevNode) {
        edges.push(edgeFromTo("operator-detail", prevNode, "bottom", node, "top"));
      }
      prevNode = node;
      currentY += L4_H + L4_GAP;
    });

    return {
      nodes,
      edges,
      firstNode: nodes[0] || null,
      lastNode: nodes[nodes.length - 1] || null,
      bottom: nodes.length ? nodeBottom(nodes[nodes.length - 1]) : originY,
    };
  }

  const L4_DETAILS = {
    v3: {
      attention_q_compress: ["Q_A projection"],
      attention_q_norm: ["RMSNorm Cq"],
      attention_q_expand: ["Q B projection"],
      attention_q_split: ["Split q_nope", "Split q_rope"],
      attention_kv_compress: ["KV A projection"],
      attention_kv_split1: ["Split KV latent", "Split K rope preimage"],
      attention_kv_expand: ["KV RMSNorm", "KV B projection"],
      attention_kv_split2: ["Split key", "Split value"],
      attention_kpe_broadcast: ["Broadcast K rope", "Align heads"],
      attention_kv_cache_update: ["Write K cache", "Write V cache"],
      attention_rope_compose: ["Apply RoPE (Q_PE + K_PE)", "Assemble Q (noPE + PE)", "Assemble K (noPE + PE)"],
      attention_score: ["QK matmul", "Scale by (d_head)^-0.5"],
      attention_softmax: ["Softmax (upcast fp32)", "Dropout (train only)"],
      attention_weighted_sum: ["Probabilities x value"],
      attention_out_projection: ["Head concat", "O projection"],
      ffn_gate_projection: ["Linear gate projection"],
      ffn_up_projection: ["Linear up projection"],
      ffn_swiglu: ["SiLU", "Elementwise multiply"],
      ffn_down_projection: ["Linear down projection"],
      moe_router_logits: ["Router linear", "Score logits"],
      moe_topk_router: ["Group routing", "Top-k experts"],
      moe_routing_scale: ["Normalize weights", "Scale by 2.5"],
      moe_dispatch: ["Token scatter", "Expert batch build"],
      moe_routed_experts: ["Gate projection", "Up projection", "SwiGLU", "Down projection"],
      moe_shared_experts: ["Shared gate projection", "Shared up projection", "SwiGLU", "Down projection"],
      moe_combine: ["Weighted combine", "Merge routed + shared"]
    },
    v3_2: {
      attention_q_compress: ["Dq projection"],
      attention_q_norm: ["RMSNorm Cq", "Dynamic quant", "Write q_norm"],
      attention_q_expand: ["Read q_norm", "Dequant", "UQ projection"],
      attention_q_split: ["UK projection", "Split q_nope", "Split q_rope"],
      attention_kv_compress: ["DKV projection"],
      attention_kv_split1: ["Split KV latent", "Split KR preimage"],
      attention_kv_norm: ["RMSNorm Ckv"],
      attention_kv_fp8_quant: ["FP8 quantize KV", "Dequant for compute", "Write kv_cache + pe_cache"],
      attention_kv_cache_update: ["Write kv_cache"],
      attention_kr_rope: ["KR projection", "RoPE", "Write kr_cache"],
      attention_idx_topk: ["fp8_index QK matmul", "Add attention mask", "Top-k select"],
      attention_rope_compose: ["Gather top-k KV", "Apply RoPE (Q_PE + K_PE)", "Assemble Q (noPE + PE)", "Assemble K (noPE + PE)"],
      attention_sparse_attn: ["Sparse QK matmul", "Softmax", "Score × V matmul", "Output projection"],
      attention_out_projection: ["Project to hidden size"],
      ffn_gate_projection: ["Linear gate projection"],
      ffn_up_projection: ["Linear up projection"],
      ffn_swiglu: ["SiLU", "Elementwise multiply"],
      ffn_down_projection: ["Linear down projection"],
      moe_router_logits: ["Router linear", "Score logits"],
      moe_topk_router: ["Group filter", "Top-k experts"],
      moe_routing_scale: ["Normalize weights", "Scale by 2.5"],
      moe_dispatch: ["Token scatter", "Expert batch build"],
      moe_routed_experts: ["Gate projection", "Up projection", "SwiGLU", "Down projection"],
      moe_shared_experts: ["Shared gate projection", "Shared up projection", "SwiGLU", "Down projection"],
      moe_combine: ["Weighted combine", "Merge routed + shared"]
    }
  };

  function getL4Details(id) {
    const modelDetails = L4_DETAILS[state.modelVersion] || {};
    return modelDetails[id] || [];
  }

  function buildL4DetailList(parentId, centerX, originY, labels, width) {
    const column = stackDetailNodes(parentId, "detail", centerX - width / 2, originY, labels, width);
    const bounds = measureBounds(column.nodes);
    return {
      nodes: column.nodes,
      edges: column.edges,
      height: bounds.height,
      entryPoints: column.firstNode ? [anchor(column.firstNode, "top")] : [],
      exitPoint: column.lastNode ? anchor(column.lastNode, "bottom") : null,
    };
  }

  function buildIndexerPrologL4(parentId, centerX, originY, width) {
    const labelH = 16;
    const labelGap = 10;
    const columnGap = 10;
    const columnWidth = Math.floor((width - columnGap * 2) / 3);
    const contentWidth = columnWidth * 3 + columnGap * 2;
    const leftX = centerX - Math.round(contentWidth / 2);
    const middleX = leftX + columnWidth + columnGap;
    const rightX = middleX + columnWidth + columnGap;
    const pathOriginY = originY + labelH + labelGap;

    const labels = [
      rectNode(parentId + "__label_q", "Query", leftX, originY, columnWidth, labelH, "detail-label"),
      rectNode(parentId + "__label_w", "Weight", middleX, originY, columnWidth, labelH, "detail-label"),
      rectNode(parentId + "__label_k", "Key", rightX, originY, columnWidth, labelH, "detail-label"),
    ];

    const queryPath = stackDetailNodes(parentId, "idx_q", leftX, pathOriginY, [
      "Q matmul",
      "Dequant",
      "Split",
      "RoPE",
      "Concat",
      "Hadamard",
      "Quant",
      "Write Q",
    ], columnWidth);
    const weightPath = stackDetailNodes(parentId, "idx_w", middleX, pathOriginY, [
      "Read x",
      "W proj",
      "Scale",
      "Write W",
    ], columnWidth);
    const keyPath = stackDetailNodes(parentId, "idx_k", rightX, pathOriginY, [
      "Read x",
      "K matmul",
      "LayerNorm",
      "Split",
      "RoPE",
      "Concat",
      "Hadamard",
      "Quant",
      "Write K",
    ], columnWidth);

    const nodes = [...labels, ...queryPath.nodes, ...weightPath.nodes, ...keyPath.nodes];
    const edges = [...queryPath.edges, ...weightPath.edges, ...keyPath.edges];
    // Three paths are parallel (no fan-in merge edges); exitPoint is a virtual bottom anchor only
    const bottomY = Math.max(queryPath.bottom, weightPath.bottom, keyPath.bottom) + L4_GAP;
    const exitPoint = point(centerX, bottomY);

    return {
      nodes,
      edges,
      height: exitPoint.y - originY,
      entryPoints: [queryPath.firstNode, weightPath.firstNode, keyPath.firstNode]
        .filter(Boolean)
        .map((node) => anchor(node, "top")),
      exitPoint,
    };
  }

  function buildExpandableOperator(id, title, x, y, options) {
    const details = options?.details || [];
    const width = options?.w || 152;
    const expanded = isExpanded(options?.key || id);
    const centerX = x + width / 2;
    const detailOriginY = y + OP_HEADER_H + L4_TOP;
    const detailWidth = Math.max(120, width - 24);
    const detailCluster = options?.builder
      ? options.builder(id, centerX, detailOriginY, detailWidth)
      : buildL4DetailList(id, centerX, detailOriginY, details, detailWidth);
    const collapsible = detailCluster.nodes.length > 0;
    const expandedHeight = collapsible
      ? OP_HEADER_H + L4_TOP + detailCluster.height + L4_BOTTOM
      : OP_HEADER_H;
    const edges = [];

    if (expanded && detailCluster.entryPoints.length) {
      const headerBottom = point(centerX, y + OP_HEADER_H);
      const splitY = detailOriginY - 6;
      detailCluster.entryPoints.forEach((entryPoint) => {
        edges.push(
          edgeSpec("operator-detail", [
            headerBottom,
            point(centerX, splitY),
            point(entryPoint.x, splitY),
            entryPoint,
          ])
        );
      });
      edges.push(...detailCluster.edges);
    }

    const spec = groupNode(id, title, x, y, width, {
      key: options?.key || id,
      collapsible,
      collapsed: !expanded,
      collapsedHeight: OP_HEADER_H,
      expandedHeight,
      fill: PAPER_ALT,
      stroke: LINE,
      strokeWidth: 1.2,
      radius: 8,
      fontSize: 11,
      fontWeight: 600,
      labelY: OP_HEADER_H / 2 + 1,
      buttonY: 7,
      buttonSize: 24,
      children: expanded ? detailCluster.nodes : [],
      edges,
      zIndex: 18,
    });

    spec.anchors = {
      bottom:
        expanded && detailCluster.exitPoint
          ? detailCluster.exitPoint
          : point(centerX, y + OP_HEADER_H),
    };

    return spec;
  }

  function buildAttentionCluster(centerX, originY) {
    const leftX = centerX - 222;
    const rightX = centerX + 70;
    const centerNodeX = centerX - 76;
    const wideCenterX = centerX - 100;
    const qColumn = stackFusionNodes(leftX, originY, [
      { id: "attention_q_compress", title: "Q compress" },
      { id: "attention_q_norm", title: "Q RMSNorm" },
      { id: "attention_q_expand", title: "Q expand" },
      { id: "attention_q_split", title: "Q split" },
    ], OP_GAP);
    const kvColumn = stackFusionNodes(rightX, originY, [
      { id: "attention_kv_compress", title: "KV compress" },
      { id: "attention_kv_split1", title: "Compressed KV split" },
      { id: "attention_kv_expand", title: "KV norm + expand" },
      { id: "attention_kv_split2", title: "KV split" },
      { id: "attention_kpe_broadcast", title: "K rope broadcast" },
      { id: "attention_kv_cache_update", title: "KV cache update" },
    ], OP_GAP);
    const [qCompress, qNorm, qExpand, qSplit] = qColumn.nodes;
    const [kvCompress, kvSplit1, kvExpand, kvSplit2, kpeBroadcast, kvCacheUpdate] = kvColumn.nodes;
    const ropeComposeY = Math.max(qColumn.bottom, kvColumn.bottom) + OP_BRANCH_GAP;
    const ropeCompose = fusionNode("attention_rope_compose", "RoPE + Q/K assemble", wideCenterX, ropeComposeY, { w: 200 });
    const score = fusionNode("attention_score", "Scaled dot-product", centerNodeX, nodeBottom(ropeCompose) + OP_CENTER_GAP);
    const softmax = fusionNode("attention_softmax", "Softmax", centerNodeX, nodeBottom(score) + OP_CENTER_GAP);
    const weightedSum = fusionNode("attention_weighted_sum", "Weighted sum", centerNodeX, nodeBottom(softmax) + OP_CENTER_GAP);
    const outProjection = fusionNode("attention_out_projection", "O projection", centerNodeX, nodeBottom(weightedSum) + OP_CENTER_GAP);
    const fanInY = ropeCompose.y - Math.round(OP_BRANCH_GAP / 2);

    const nodes = [
      qCompress, qNorm, qExpand, qSplit,
      kvCompress, kvSplit1, kvExpand, kvSplit2, kpeBroadcast, kvCacheUpdate,
      ropeCompose, score, softmax, weightedSum, outProjection,
    ];

    const edges = [
      // Q chain
      edgeFromTo("detail", qCompress, "bottom", qNorm, "top"),
      edgeFromTo("detail", qNorm, "bottom", qExpand, "top"),
      edgeFromTo("detail", qExpand, "bottom", qSplit, "top"),
      // KV chain
      edgeFromTo("detail", kvCompress, "bottom", kvSplit1, "top"),
      edgeFromTo("detail", kvSplit1, "bottom", kvExpand, "top"),
      edgeFromTo("detail", kvExpand, "bottom", kvSplit2, "top"),
      edgeFromTo("detail", kvSplit2, "bottom", kpeBroadcast, "top"),
      edgeFromTo("detail", kpeBroadcast, "bottom", kvCacheUpdate, "top"),
      // Fan-in: qSplit and kvCacheUpdate → ropeCompose
      edgeFromTo("detail", qSplit, "bottom", ropeCompose, "top", [
        point(anchor(qSplit, "bottom").x, fanInY),
        point(anchor(ropeCompose, "top").x, fanInY),
      ]),
      edgeFromTo("detail", kvCacheUpdate, "bottom", ropeCompose, "top", [
        point(anchor(kvCacheUpdate, "bottom").x, fanInY),
        point(anchor(ropeCompose, "top").x, fanInY),
      ]),
      // Center chain
      edgeFromTo("detail", ropeCompose, "bottom", score, "top"),
      edgeFromTo("detail", score, "bottom", softmax, "top"),
      edgeFromTo("detail", softmax, "bottom", weightedSum, "top"),
      edgeFromTo("detail", weightedSum, "bottom", outProjection, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [qCompress, kvCompress],
      exitNode: outProjection,
    };
  }

  function buildDenseCluster(centerX, originY) {
    const leftX = centerX - 222;
    const rightX = centerX + 70;
    const centerNodeX = centerX - 76;

    const gateProjection = fusionNode("ffn_gate_projection", "Gate projection", leftX, originY);
    const upProjection = fusionNode("ffn_up_projection", "Up projection", rightX, originY);
    const swigluY = Math.max(nodeBottom(gateProjection), nodeBottom(upProjection)) + OP_BRANCH_GAP;
    const swiglu = fusionNode("ffn_swiglu", "SwiGLU", centerNodeX, swigluY);
    const downProjection = fusionNode("ffn_down_projection", "Down projection", centerNodeX, nodeBottom(swiglu) + OP_CENTER_GAP);
    const fanInY = swiglu.y - Math.round(OP_BRANCH_GAP / 2);

    const nodes = [gateProjection, upProjection, swiglu, downProjection];
    const edges = [
      edgeFromTo("detail", gateProjection, "bottom", swiglu, "top", [
        point(anchor(gateProjection, "bottom").x, fanInY),
        point(anchor(swiglu, "top").x, fanInY),
      ]),
      edgeFromTo("detail", upProjection, "bottom", swiglu, "top", [
        point(anchor(upProjection, "bottom").x, fanInY),
        point(anchor(swiglu, "top").x, fanInY),
      ]),
      edgeFromTo("detail", swiglu, "bottom", downProjection, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [gateProjection, upProjection],
      exitNode: downProjection,
    };
  }

  function buildMoeCluster(centerX, originY) {
    const leftX = centerX - 222;
    const rightX = centerX + 70;
    const centerNodeX = centerX - 76;

    const routerLogits = fusionNode("moe_router_logits", "Router logits", centerNodeX, originY);
    const topkRouter = fusionNode("moe_topk_router", "Top-k router", centerNodeX, nodeBottom(routerLogits) + OP_GAP);
    const routingScale = fusionNode("moe_routing_scale", "Route scale", centerNodeX, nodeBottom(topkRouter) + OP_GAP);
    const dispatch = fusionNode("moe_dispatch", "Dispatch", centerNodeX, nodeBottom(routingScale) + OP_GAP);
    const branchY = nodeBottom(dispatch) + OP_BRANCH_GAP;
    const routedExperts = fusionNode("moe_routed_experts", "Routed experts", leftX, branchY);
    const sharedExperts = fusionNode("moe_shared_experts", "Shared experts", rightX, branchY);
    const combine = fusionNode("moe_combine", "Combine", centerNodeX, Math.max(nodeBottom(routedExperts), nodeBottom(sharedExperts)) + OP_BRANCH_GAP);
    const dispatchFanY = branchY - Math.round(OP_BRANCH_GAP / 2);
    const combineFanY = combine.y - Math.round(OP_BRANCH_GAP / 2);

    const nodes = [routerLogits, topkRouter, routingScale, dispatch, routedExperts, sharedExperts, combine];
    const edges = [
      edgeFromTo("detail", routerLogits, "bottom", topkRouter, "top"),
      edgeFromTo("detail", topkRouter, "bottom", routingScale, "top"),
      edgeFromTo("detail", routingScale, "bottom", dispatch, "top"),
      edgeFromTo("detail", dispatch, "bottom", routedExperts, "top", [
        point(anchor(dispatch, "bottom").x, dispatchFanY),
        point(anchor(routedExperts, "top").x, dispatchFanY),
      ]),
      edgeFromTo("detail", dispatch, "bottom", sharedExperts, "top", [
        point(anchor(dispatch, "bottom").x, dispatchFanY),
        point(anchor(sharedExperts, "top").x, dispatchFanY),
      ]),
      edgeFromTo("detail", routedExperts, "bottom", combine, "top", [
        point(anchor(routedExperts, "bottom").x, combineFanY),
        point(anchor(combine, "top").x, combineFanY),
      ]),
      edgeFromTo("detail", sharedExperts, "bottom", combine, "top", [
        point(anchor(sharedExperts, "bottom").x, combineFanY),
        point(anchor(combine, "top").x, combineFanY),
      ]),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [routerLogits],
      exitNode: combine,
    };
  }

  function buildExpandableGroup(id, title, key, x, y, expanded, builder) {
    const centerX = x + GROUP_W / 2;
    const clusterOriginY = y + HEADER_H + GROUP_INNER_TOP;
    const cluster = builder(centerX, clusterOriginY);
    const entryPoint = point(centerX, y + HEADER_H);
    const expandedHeight = HEADER_H + GROUP_INNER_TOP + cluster.height + GROUP_INNER_BOTTOM;
    const edges = [];

    if (expanded) {
      edges.push(...cluster.edges);
      cluster.entryNodes.forEach((entryNode) => {
        edges.push(
          edgeSpec("detail", [
            entryPoint,
            point(entryPoint.x, entryNode.y - 10),
            point(anchor(entryNode, "top").x, entryNode.y - 10),
            anchor(entryNode, "top"),
          ])
        );
      });
    }

    const spec = groupNode(id, title, x, y, GROUP_W, {
      key,
      collapsible: true,
      collapsed: !expanded,
      collapsedHeight: HEADER_H,
      expandedHeight,
      children: expanded ? cluster.nodes : [],
      edges,
    });

    spec.exitPoint = expanded ? anchor(cluster.exitNode, "bottom") : point(centerX, y + HEADER_H);
    spec.entryPoint = point(centerX, y);
    return spec;
  }

  function rectStyle(spec) {
    if (spec.variant === "summary") {
      return {
        fill: PAPER,
        stroke: LINE,
        strokeWidth: 1.8,
        rx: 12,
        ry: 12,
        fontSize: 14,
        fontWeight: 600,
        textFill: INK,
      };
    }

    if (spec.variant === "io") {
      return {
        fill: "#e5e5e5",
        stroke: "none",
        strokeWidth: 0,
        rx: 12,
        ry: 12,
        fontSize: 14,
        fontWeight: 600,
        textFill: INK,
      };
    }

    if (spec.variant === "operator") {
      return {
        fill: PAPER_ALT,
        stroke: LINE,
        strokeWidth: 1.2,
        rx: 8,
        ry: 8,
        fontSize: 11,
        fontWeight: 600,
        textFill: INK,
      };
    }

    if (spec.variant === "detail-op") {
      return {
        fill: PAPER,
        stroke: LINE,
        strokeWidth: 1,
        rx: 6,
        ry: 6,
        fontSize: 10,
        fontWeight: 500,
        textFill: INK,
      };
    }

    if (spec.variant === "nav") {
      return {
        fill: spec.disabled ? BG : "#e5e5e5",
        stroke: "none",
        strokeWidth: 0,
        rx: 5,
        ry: 5,
        fontSize: 14,
        fontWeight: 700,
        textFill: spec.disabled ? MUTED : INK,
      };
    }

    if (spec.variant === "version-active") {
      return {
        fill: INK,
        stroke: "none",
        strokeWidth: 0,
        rx: 6,
        ry: 6,
        fontSize: 12,
        fontWeight: 700,
        textFill: PAPER,
      };
    }

    if (spec.variant === "version-inactive") {
      return {
        fill: "#e5e5e5",
        stroke: "none",
        strokeWidth: 0,
        rx: 6,
        ry: 6,
        fontSize: 12,
        fontWeight: 700,
        textFill: INK,
      };
    }

    if (spec.variant === "annotation") {
      return {
        fill: "none",
        stroke: "none",
        strokeWidth: 0,
        rx: 0,
        ry: 0,
        fontSize: 11,
        fontWeight: 400,
        textFill: MUTED,
      };
    }

    if (spec.variant === "detail-label") {
      return {
        fill: "none",
        stroke: "none",
        strokeWidth: 0,
        rx: 0,
        ry: 0,
        fontSize: 11,
        fontWeight: 700,
        textFill: INK,
      };
    }

    if (spec.variant === "strip") {
      return {
        fill: BG,
        stroke: "none",
        strokeWidth: 0,
        rx: 0,
        ry: 0,
        fontSize: 12,
        fontWeight: 500,
        textFill: INK,
      };
    }

    return {
      fill: PAPER,
      stroke: LINE,
      strokeWidth: 1.2,
      rx: 8,
      ry: 8,
      fontSize: 12,
      fontWeight: 500,
      textFill: INK,
    };
  }

  function addRect(spec) {
    const style = rectStyle(spec);
    const clickable = Boolean(spec.action) && !spec.disabled;

    return graph.addNode({
      id: spec.id,
      shape: "rect",
      x: spec.x,
      y: spec.y,
      width: spec.w,
      height: spec.h,
      zIndex: spec.zIndex || 20,
      attrs: {
        body: {
          fill: style.fill,
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          rx: style.rx,
          ry: style.ry,
          cursor: clickable ? "pointer" : "default",
          pointerEvents: clickable ? "auto" : "none",
        },
        label: {
          text: spec.text,
          fill: style.textFill,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          textAnchor: spec.labelAnchor || "middle",
          textVerticalAnchor: "middle",
          refX: spec.labelRefX == null ? "50%" : spec.labelRefX,
          refY: spec.labelRefY == null ? "50%" : spec.labelRefY,
          pointerEvents: "none",
        },
      },
      data: spec.action
        ? {
            action: spec.action,
          }
        : {},
    });
  }

  function addCircle(spec) {
    return graph.addNode({
      id: spec.id,
      shape: "circle",
      x: spec.x,
      y: spec.y,
      width: spec.w,
      height: spec.h,
      zIndex: spec.zIndex || 24,
      attrs: {
        body: {
          fill: PAPER,
          stroke: LINE,
          strokeWidth: 1.8,
        },
        label: {
          text: spec.text,
          fill: INK,
          fontSize: 16,
          fontWeight: 700,
        },
      },
      data: {},
    });
  }

  function addEdge(spec) {
    const [source, ...rest] = spec.points;
    const target = rest[rest.length - 1];
    const vertices = rest.slice(0, -1);
    const isMain = spec.kind === "main";
    const isOperatorDetail = spec.kind === "operator-detail";

    return graph.addEdge({
      source,
      target,
      vertices,
      zIndex: isMain ? 10 : isOperatorDetail ? 19 : 8,
      connector: {
        name: "rounded",
        args: {
          radius: 0,
        },
      },
      attrs: {
        line: {
          stroke: LINE,
          strokeWidth: isMain ? 1.7 : 1.15,
          targetMarker: {
            name: "classic",
            size: 7,
          },
        },
      },
    });
  }

  function addGroup(spec) {
    const group = new FlowGroup({
      id: spec.id,
      x: spec.x,
      y: spec.y,
      width: spec.w,
      height: spec.collapsed ? spec.collapsedHeight : spec.expandedHeight,
      zIndex: spec.zIndex,
      attrs: {
        body: {
          fill: spec.fill,
          stroke: spec.stroke,
          strokeWidth: spec.strokeWidth,
          strokeDasharray: spec.dashed ? "8 6" : undefined,
          rx: spec.radius,
          ry: spec.radius,
        },
        label: {
          text: spec.showLabel ? spec.text : "",
          fontSize: spec.fontSize,
          fontWeight: spec.fontWeight,
          fill: INK,
          refY: spec.labelY == null ? 26 : spec.labelY,
        },
        buttonGroup: {
          visibility: spec.collapsible ? "visible" : "hidden",
          refY: spec.buttonY == null ? 10 : spec.buttonY,
          refX2: -((spec.buttonSize || 24) + 10),
        },
        button: {
          visibility: spec.collapsible ? "visible" : "hidden",
          width: spec.buttonSize || 24,
          height: spec.buttonSize || 24,
        },
        buttonSign: {
          visibility: spec.collapsible ? "visible" : "hidden",
          d: spec.collapsed ? PLUS_PATH : MINUS_PATH,
        },
      },
      data: {
        action: spec.collapsible ? "toggle-group" : null,
        key: spec.key,
        collapsible: spec.collapsible,
        collapsed: spec.collapsed,
        collapsedHeight: spec.collapsedHeight,
        expandedHeight: spec.expandedHeight,
      },
    });

    graph.addNode(group);

    if (spec.collapsible) {
      group.toggleCollapse(spec.collapsed);
    }

    spec.children.forEach((child) => {
      mountSpec(child, group);
    });

    spec.edges.forEach((childEdge) => {
      const edge = addEdge(childEdge);
      group.addChild(edge);
    });

    return group;
  }

  function mountSpec(spec, parent) {
    let cell;

    if (spec.type === "group") {
      cell = addGroup(spec);
    } else if (spec.type === "circle") {
      cell = addCircle(spec);
    } else {
      cell = addRect(spec);
    }

    if (parent) {
      parent.addChild(cell);
    }

    return cell;
  }

  // ── V3.2 cluster builders ────────────────────────────────────────────────

  function buildAttentionClusterV32(centerX, originY) {
    const leftX = centerX - 222;
    const rightX = centerX + 70;
    const centerNodeX = centerX - 76;
    const wideCenterX = centerX - 100;
    const qColumn = stackFusionNodes(leftX, originY, [
      { id: "attention_q_compress", title: "Q compress" },
      { id: "attention_q_norm", title: "Q RMSNorm + quant" },
      { id: "attention_q_expand", title: "Q expand" },
      { id: "attention_q_split", title: "Q split" },
    ], OP_GAP);
    const kvColumn = stackFusionNodes(rightX, originY, [
      { id: "attention_kv_compress", title: "KV compress" },
      { id: "attention_kv_split1", title: "KV split" },
      { id: "attention_kv_norm", title: "KV RMSNorm" },
      { id: "attention_kv_fp8_quant", title: "FP8 KV quant" },
      { id: "attention_kv_cache_update", title: "KV cache update" },
      { id: "attention_kr_rope", title: "KR RoPE + cache" },
    ], OP_GAP);
    const [qCompress, qNorm, qExpand, qSplit] = qColumn.nodes;
    const [kvCompress, kvSplit1, kvNorm, kvFp8Quant, kvCacheUpdate, krRope] = kvColumn.nodes;
    const idxProlog = fusionNode(
      "attention_idx_prolog",
      "Indexer prolog + quant",
      wideCenterX - 40,
      Math.max(qColumn.bottom, kvColumn.bottom) + OP_BRANCH_GAP,
      {
        w: 280,
        builder: buildIndexerPrologL4,
      }
    );
    const idxTopk = fusionNode("attention_idx_topk", "Lightning Indexer Top-K", wideCenterX, nodeBottom(idxProlog) + OP_CENTER_GAP, { w: 200 });
    const ropeCompose = fusionNode("attention_rope_compose", "RoPE + Q/K assemble", wideCenterX, Math.max(nodeBottom(qSplit), nodeBottom(idxTopk)) + OP_BRANCH_GAP, { w: 200 });
    const sparseAttn = fusionNode("attention_sparse_attn", "Selected sparse attn", centerNodeX, nodeBottom(ropeCompose) + OP_CENTER_GAP, { w: 180 });
    const outProjection = fusionNode("attention_out_projection", "O projection", centerNodeX, nodeBottom(sparseAttn) + OP_CENTER_GAP);
    const idxFanY = idxProlog.y - Math.round(OP_BRANCH_GAP / 2);
    const qBranchX = anchor(qNorm, "right").x + 24;
    const ropeFanY = ropeCompose.y - Math.round(OP_BRANCH_GAP / 2);

    const nodes = [
      qCompress, qNorm, qExpand, qSplit,
      kvCompress, kvSplit1, kvNorm, kvFp8Quant, kvCacheUpdate, krRope,
      idxProlog, idxTopk,
      ropeCompose, sparseAttn, outProjection,
    ];

    const edges = [
      // Q chain
      edgeFromTo("detail", qCompress, "bottom", qNorm, "top"),
      edgeFromTo("detail", qNorm, "bottom", qExpand, "top"),
      edgeFromTo("detail", qExpand, "bottom", qSplit, "top"),
      // KV chain
      edgeFromTo("detail", kvCompress, "bottom", kvSplit1, "top"),
      edgeFromTo("detail", kvSplit1, "bottom", kvNorm, "top"),
      edgeFromTo("detail", kvNorm, "bottom", kvFp8Quant, "top"),
      edgeFromTo("detail", kvFp8Quant, "bottom", kvCacheUpdate, "top"),
      edgeFromTo("detail", kvCacheUpdate, "bottom", krRope, "top"),
      // qNorm.right → idxProlog: passes qr (Q low-rank normed) to Indexer; Indexer also reads x internally
      edgeSpec("detail", [
        anchor(qNorm, "right"),
        point(qBranchX, anchor(qNorm, "right").y),
        point(qBranchX, idxFanY),
        point(anchor(idxProlog, "top").x, idxFanY),
        anchor(idxProlog, "top"),
      ]),
      edgeFromTo("detail", idxProlog, "bottom", idxTopk, "top"),
      edgeFromTo("detail", qSplit, "bottom", ropeCompose, "top", [
        point(anchor(qSplit, "bottom").x, ropeFanY),
        point(anchor(ropeCompose, "top").x, ropeFanY),
      ]),
      edgeFromTo("detail", idxTopk, "bottom", ropeCompose, "top"),
      edgeFromTo("detail", ropeCompose, "bottom", sparseAttn, "top"),
      edgeFromTo("detail", sparseAttn, "bottom", outProjection, "top"),
    ];

    const bounds = measureBounds(nodes);
    return {
      nodes,
      edges,
      height: bounds.height,
      entryNodes: [qCompress, kvCompress],
      exitNode: outProjection,
    };
  }

  function buildSceneV32(layer) {
    ensureExpanded(layer);

    const frameX = 144;
    const frameY = 88;
    const frameW = 772;
    const frameTopPad = 78;
    const frameBottomPad = 52;
    const rowGap = 26;

    const mainX = frameX + (frameW - MAIN_W) / 2;
    const mainCenterX = mainX + MAIN_W / 2;
    const groupX = frameX + (frameW - GROUP_W) / 2;
    const residualOuterX = groupX - 52;
    const stripX = frameX + 40;
    const stripY = frameY - STRIP_H / 2;

    const children = [];
    const edges = [];
    const refs = {};

    let cursorY = frameY + frameTopPad;

    children.push(
      rectNode("layer_strip", "Layer " + String(layer.layer_id + 1) + " / " + data.layers.length + (isDense(layer) ? "" : "  ·  MoE"), stripX, stripY, STRIP_W, STRIP_H, "strip", {
        labelRefX: 12,
        labelAnchor: "start",
      })
    );

    children.push(
      rectNode("layer_prev", "<", stripX + 220, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === 0 ? null : "prev-layer",
        disabled: layer.layer_id === 0,
      })
    );

    children.push(
      rectNode("layer_next", ">", stripX + 248, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === data.layers.length - 1 ? null : "next-layer",
        disabled: layer.layer_id === data.layers.length - 1,
      })
    );

    // V3.2 uses fused residual norm: attn_norm(x, residual) returns (normed, residual)
    refs.inputNorm = rectNode("input_norm", "RMSNorm (fused residual)", groupX, cursorY, GROUP_W, MAIN_H, "summary");
    children.push(refs.inputNorm);
    cursorY += MAIN_H + rowGap;

    refs.attention = buildExpandableGroup(
      "attention_group",
      "MLA + Lightning Indexer",
      "attention",
      groupX,
      cursorY,
      state.expanded.attention,
      buildAttentionClusterV32
    );
    children.push(refs.attention);
    cursorY += refs.attention.h + rowGap;

    // V3.2 fuses residual add into ffn_norm — show as a single fused norm node
    refs.postNorm = rectNode("post_norm", "RMSNorm (fused residual)", groupX, cursorY, GROUP_W, MAIN_H, "summary");
    children.push(refs.postNorm);
    cursorY += MAIN_H + rowGap;

    refs.feedforward = buildExpandableGroup(
      "feedforward_group",
      isDense(layer) ? "Feed-Forward" : "MoE Feed-Forward",
      "feedforward",
      groupX,
      cursorY,
      state.expanded.feedforward,
      isDense(layer) ? buildDenseCluster : buildMoeCluster
    );
    children.push(refs.feedforward);
    cursorY += refs.feedforward.h + rowGap;

    refs.addFfn = addNode("add_ffn", mainCenterX - 14, cursorY);
    children.push(refs.addFfn);
    cursorY += 28;

    const frameH = cursorY - frameY + frameBottomPad;
    const frameBottom = frameY + frameH;
    const inputPoint = point(mainCenterX, frameY - 30);
    const outputPoint = point(mainCenterX, frameBottom + 30);

    children.push(
      rectNode("label_input", "Hidden state in", mainX, inputPoint.y - MAIN_H - 28, MAIN_W, MAIN_H, "io"),
      rectNode("label_output", "Hidden state out", mainX, outputPoint.y, MAIN_W, MAIN_H, "io")
    );

    // V3.2: attn residual is absorbed into ffn_norm; no explicit add_attention node
    edges.push(
      edgeFromPoint("main", inputPoint, refs.inputNorm, "top"),
      edgeFromTo("main", refs.inputNorm, "bottom", refs.attention, "top"),
      edgeFromTo("main", refs.attention, "bottom", refs.postNorm, "top"),
      edgeFromTo("main", refs.postNorm, "bottom", refs.feedforward, "top"),
      edgeSpec("main", [refs.feedforward.exitPoint, anchor(refs.addFfn, "top")]),
      edgeToPoint("main", refs.addFfn, "bottom", outputPoint),
      // Residual bypass (outer): input → add_ffn (fused norms absorb the intermediate add)
      edgeSpec("main", [
        point(mainCenterX, frameY + 24),
        point(residualOuterX, frameY + 24),
        point(residualOuterX, anchor(refs.addFfn, "left").y),
        anchor(refs.addFfn, "left"),
      ])
    );

    const layerGroup = groupNode("layer_group", "", frameX, frameY, frameW, {
      collapsible: false,
      collapsedHeight: frameH,
      expandedHeight: frameH,
      fill: "none",
      stroke: DASH,
      strokeWidth: 1.4,
      dashed: true,
      radius: 0,
      showLabel: false,
      children,
      edges,
      zIndex: 1,
    });

    return { layerGroup };
  }

  function buildScene(layer) {
    ensureExpanded(layer);

    const frameX = 144;
    const frameY = 88;
    const frameW = 772;
    const frameTopPad = 78;
    const frameBottomPad = 52;
    const rowGap = 26;

    const mainX = frameX + (frameW - MAIN_W) / 2;
    const mainCenterX = mainX + MAIN_W / 2;
    const groupX = frameX + (frameW - GROUP_W) / 2;
    const residualOuterX = groupX - 52;
    const residualInnerX = groupX - 28;
    const stripX = frameX + 40;
    const stripY = frameY - STRIP_H / 2;

    const children = [];
    const edges = [];
    const refs = {};

    let cursorY = frameY + frameTopPad;

    children.push(
      rectNode("layer_strip", "Layer " + String(layer.layer_id + 1) + " / " + data.layers.length + (isDense(layer) ? "" : "  ·  MoE"), stripX, stripY, STRIP_W, STRIP_H, "strip", {
        labelRefX: 12,
        labelAnchor: "start",
      })
    );

    children.push(
      rectNode("layer_prev", "<", stripX + 220, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === 0 ? null : "prev-layer",
        disabled: layer.layer_id === 0,
      })
    );

    children.push(
      rectNode("layer_next", ">", stripX + 248, stripY + (STRIP_H - 24) / 2, 24, 24, "nav", {
        action: layer.layer_id === data.layers.length - 1 ? null : "next-layer",
        disabled: layer.layer_id === data.layers.length - 1,
      })
    );

    refs.inputNorm = rectNode("input_norm", "RMSNorm", groupX, cursorY, GROUP_W, MAIN_H, "summary");
    children.push(refs.inputNorm);
    cursorY += MAIN_H + rowGap;

    refs.attention = buildExpandableGroup(
      "attention_group",
      "Attention",
      "attention",
      groupX,
      cursorY,
      state.expanded.attention,
      buildAttentionCluster
    );
    children.push(refs.attention);
    cursorY += refs.attention.h + rowGap;

    refs.addAttention = addNode("add_attention", mainCenterX - 14, cursorY);
    children.push(refs.addAttention);
    cursorY += 28 + rowGap;

    refs.postNorm = rectNode("post_norm", "RMSNorm", groupX, cursorY, GROUP_W, MAIN_H, "summary");
    children.push(refs.postNorm);
    cursorY += MAIN_H + rowGap;

    refs.feedforward = buildExpandableGroup(
      "feedforward_group",
      isDense(layer) ? "Feed-Forward" : "MoE Feed-Forward",
      "feedforward",
      groupX,
      cursorY,
      state.expanded.feedforward,
      isDense(layer) ? buildDenseCluster : buildMoeCluster
    );
    children.push(refs.feedforward);
    cursorY += refs.feedforward.h + rowGap;

    refs.addFfn = addNode("add_ffn", mainCenterX - 14, cursorY);
    children.push(refs.addFfn);
    cursorY += 28;

    const frameH = cursorY - frameY + frameBottomPad;
    const frameBottom = frameY + frameH;
    const inputPoint = point(mainCenterX, frameY - 30);
    const outputPoint = point(mainCenterX, frameBottom + 30);

    children.push(
      rectNode("label_input", "Hidden state in", mainX, inputPoint.y - MAIN_H - 28, MAIN_W, MAIN_H, "io"),
      rectNode("label_output", "Hidden state out", mainX, outputPoint.y, MAIN_W, MAIN_H, "io")
    );

    edges.push(
      edgeFromPoint("main", inputPoint, refs.inputNorm, "top"),
      edgeFromTo("main", refs.inputNorm, "bottom", refs.attention, "top"),
      edgeSpec("main", [refs.attention.exitPoint, anchor(refs.addAttention, "top")]),
      edgeFromTo("main", refs.addAttention, "bottom", refs.postNorm, "top"),
      edgeFromTo("main", refs.postNorm, "bottom", refs.feedforward, "top"),
      edgeSpec("main", [refs.feedforward.exitPoint, anchor(refs.addFfn, "top")]),
      edgeToPoint("main", refs.addFfn, "bottom", outputPoint),
      edgeSpec("main", [
        point(mainCenterX, frameY + 24),
        point(residualOuterX, frameY + 24),
        point(residualOuterX, anchor(refs.addAttention, "left").y),
        anchor(refs.addAttention, "left"),
      ]),
      edgeSpec("main", [
        anchor(refs.addAttention, "bottom"),
        point(residualInnerX, anchor(refs.addAttention, "bottom").y),
        point(residualInnerX, anchor(refs.addFfn, "left").y),
        anchor(refs.addFfn, "left"),
      ])
    );

    const layerGroup = groupNode("layer_group", "", frameX, frameY, frameW, {
      collapsible: false,
      collapsedHeight: frameH,
      expandedHeight: frameH,
      fill: "none",
      stroke: DASH,
      strokeWidth: 1.4,
      dashed: true,
      radius: 0,
      showLabel: false,
      children,
      edges,
      zIndex: 1,
    });

    return {
      layerGroup,
    };
  }

  function clearGraph() {
    if (typeof graph.resetCells === "function") {
      graph.resetCells([]);
      return;
    }

    if (graph.model && typeof graph.model.resetCells === "function") {
      graph.model.resetCells([]);
      return;
    }

    graph.clearCells();
  }

  function render(resetView) {
    const layer = getSelectedLayer();
    const scene = state.modelVersion === "v3_2" ? buildSceneV32(layer) : buildScene(layer);

    clearGraph();
    addGroup(scene.layerGroup);

    if (resetView) {
      requestAnimationFrame(() => {
        graph.zoomToFit({
          padding: {
            top: 56,
            right: 56,
            bottom: 56,
            left: 56,
          },
          maxScale: 1,
        });
      });
    }
  }

  function scheduleRender(resetView) {
    pendingResetView = pendingResetView || resetView;

    if (renderScheduled) {
      return;
    }

    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      const shouldResetView = pendingResetView;
      pendingResetView = false;
      render(shouldResetView);
    });
  }

  graph.on("node:collapse", ({ node }) => {
    const payload = node.getData() || {};
    if (payload.action !== "toggle-group" || !payload.key) return;

    state.expanded[payload.key] = !state.expanded[payload.key];
    scheduleRender(false);
  });

  graph.on("node:click", ({ node }) => {
    const payload = node.getData() || {};
    if (!payload.action) return;

    if (payload.action === "prev-layer") {
      const prevLayer = getSelectedLayer();
      state.selectedLayerId = Math.max(0, state.selectedLayerId - 1);
      const nextLayer = getSelectedLayer();
      setExpandedForLayer(nextLayer, {
        attention: state.expanded.attention,
        feedforward: isDense(prevLayer) !== isDense(nextLayer) ? false : state.expanded.feedforward,
      });
      scheduleRender(false);
      return;
    }

    if (payload.action === "next-layer") {
      const prevLayer = getSelectedLayer();
      state.selectedLayerId = Math.min(data.layers.length - 1, state.selectedLayerId + 1);
      const nextLayer = getSelectedLayer();
      setExpandedForLayer(nextLayer, {
        attention: state.expanded.attention,
        feedforward: isDense(prevLayer) !== isDense(nextLayer) ? false : state.expanded.feedforward,
      });
      scheduleRender(false);
    }
  });

  graph.on("blank:dblclick", () => {
    graph.zoomToFit({
      padding: {
        top: 56,
        right: 56,
        bottom: 56,
        left: 56,
      },
      maxScale: 1,
    });
  });

  function updateVersionPicker() {
    const v3Btn = document.getElementById("btn-v3");
    const v32Btn = document.getElementById("btn-v3_2");
    if (v3Btn) v3Btn.classList.toggle("active", state.modelVersion === "v3");
    if (v32Btn) v32Btn.classList.toggle("active", state.modelVersion === "v3_2");
  }

  document.getElementById("btn-v3").addEventListener("click", () => {
    state.modelVersion = "v3";
    setExpandedForLayer(getSelectedLayer(), {
      attention: state.expanded.attention,
      feedforward: state.expanded.feedforward,
    });
    updateVersionPicker();
    scheduleRender(true);
  });

  document.getElementById("btn-v3_2").addEventListener("click", () => {
    state.modelVersion = "v3_2";
    setExpandedForLayer(getSelectedLayer(), {
      attention: state.expanded.attention,
      feedforward: state.expanded.feedforward,
    });
    updateVersionPicker();
    scheduleRender(true);
  });

  setDefaultExpanded(data.layers[0]);
  render(true);
})();
