# DeepSeek Operator Explorer

**An interactive visualization of DeepSeek V3 / V3.2 decoder layer internals — for model developers who want to see operator structure, not token prediction.**

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://yinyucheng0601.github.io/dpsk/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 中文简介：按层查看 DeepSeek V3 / V3.2 decoder block 内部算子结构的可交互可视化工具，支持三层展开（L2 → L3 → L4 原语），可在浏览器中直接运行。

---

## Live Demo

**[yinyucheng0601.github.io/dpsk](https://yinyucheng0601.github.io/dpsk/)**

<!-- Add a screenshot or GIF here -->
<!-- ![demo](./assets/demo.gif) -->

---

## What It Shows

Most LLM visualizations explain *token generation*. This one explains *operator structure* — what computations actually happen inside a single decoder block, layer by layer.

Switch between **V3** and **V3.2** to see architectural differences:

| | DeepSeek V3 | DeepSeek V3.2 |
|---|---|---|
| Layers | 61 (3 dense + 58 MoE) | 61 (3 dense + 58 MoE) |
| Attention | MLA (Multi-head Latent Attention) | MLA + Sparse Lightning Indexer |
| KV cache | FP8 quantized | FP8 quantized + INT8 Indexer K Cache |
| FFN (MoE layers) | 256 routed experts + 1 shared, Top-2 | 256 routed experts + 1 shared, Top-2 |

---

## 3-Level Expandable Hierarchy

Each decoder layer is structured as a vertical flowchart with three levels of detail:

```
L2  ──  Main operators (always visible)
         RMSNorm → Attention → ⊕ → RMSNorm → FeedForward → ⊕

L3  ──  Expanded sub-operators (click +/- to expand)
         Attention:      Q proj → KV proj → RoPE → Scaled dot-product → Softmax → O proj
         FeedForward:    Gate proj → Up proj → SwiGLU → Down proj
         MoE:            Router logits → Top-k → Dispatch → Experts → Combine

L4  ──  Computation primitives (expand inside L3 operators)
         e.g. attention_score: "QK matmul" → "Scale by (d_head)^-0.5"
         e.g. softmax:         "Softmax (upcast fp32)" → "Dropout (train only)"
```

V3.2 additionally exposes the **Lightning Indexer** path in parallel with MLA:

```
qNorm ──→ attention_idx_prolog  ──→  attention_idx_topk  ──→  attention_sparse_attn
           (Q/K/W 3-pipeline,           (fp8_index QK          (Sparse QK matmul
            INT8 Hadamard quant)         matmul + Top-k)         → Softmax → O proj)
```

---

## Interactions

| Action | Result |
|---|---|
| Click `+` / `-` on Attention or FeedForward | Expand / collapse sub-operators |
| Click `<` `>` at the top | Navigate across 61 layers |
| Drag | Pan the canvas |
| `Ctrl` / `Cmd` + scroll | Zoom in / out |
| Double-click blank area | Zoom to fit |
| V3 / V3.2 buttons (top right) | Switch model variant |

---

## Extend to Any Model

A **Claude Code skill** is included to generate this same visualization for any HuggingFace model automatically.

### Setup

Copy `model-viz/SKILL.md` into your Claude Code skills directory:

```bash
mkdir -p ~/.claude/skills/model-viz
cp model-viz/SKILL.md ~/.claude/skills/model-viz/SKILL.md
```

### Usage

In Claude Code, run:

```
/model-viz
```

Then provide a HuggingFace model ID (e.g. `meta-llama/Llama-3.1-8B`, `Qwen/Qwen2.5-7B`, `mistralai/Mixtral-8x7B-v0.1`).

The skill will:
1. Fetch `modeling_*.py` + `config.json` from HuggingFace (or the `transformers` library source)
2. Extract the layer hierarchy: num_layers, dense/MoE split, attention type (MHA/GQA/MLA), FFN type
3. Generate `data.js` with operator trees for all layers
4. Generate a working `app.js` using AntV X6 with the same expandable group pattern
5. Copy `x6.min.js` from this repo and start a local static server

**Supported architectures:** standard MHA · GQA (LLaMA, Qwen, Mistral) · MoE (Mixtral, DeepSeek) · MLA (DeepSeek V3-style)

---

## Run Locally

No build step required — pure static files.

```bash
git clone https://github.com/yinyucheng0601/dpsk.git
cd dpsk
python3 -m http.server 8765
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/)

---

## Data Source

Operator data is extracted directly from DeepSeek V3 source code (not model card summaries):

- `configuration_deepseek.py` — model config (hidden size, heads, expert counts, etc.)
- `modeling_deepseek.py` — HuggingFace-style attention and FFN class definitions
- `inference/model.py` — inference-optimized operator layout
- `inference/kernel.py` — kernel-level fusion boundaries
- `inference/generate.py` — generation loop operator order

The extracted data preserves operator names, stages, weight names, shapes, and source references. The frontend currently renders only names to minimize visual noise.

---

## Tech Stack

- **[AntV X6](https://x6.antv.antgroup.com/)** — graph rendering, parent-child group nesting, canvas zoom/pan
- **Vanilla JS + CSS** — no framework, no build tooling
- Static files only — deployable to any CDN or GitHub Pages

X6 was chosen over plain DOM/SVG because it handles parent-child groups, collapse/expand, and canvas-level transforms natively — which matters for the L2 → L3 → L4 drill-down pattern.

---

## Roadmap

This is an MVP focused on interaction structure. Not yet included:

- [ ] Weight matrix heatmaps
- [ ] Runtime activation visualization from real tensors
- [ ] Multi-layer side-by-side comparison
- [ ] Auto-generated fine-grained fusion sub-graphs from source
- [ ] Backend-specific views (HF eager / FlashAttention2 / kernel paths)

---

## License

MIT
